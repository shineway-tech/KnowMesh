import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const migrationHistoryTable = "migration_history";
const schemaVersionTable = "schema_version";

const workspaceMigrations = [
  {
    id: "001_workspace_foundation",
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspace_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workspace_paths (
          key TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workspace_preferences (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS knowledge_bases (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          template TEXT NOT NULL,
          status TEXT NOT NULL,
          mode TEXT NOT NULL DEFAULT '',
          source_root TEXT NOT NULL DEFAULT '',
          workspace_root TEXT NOT NULL DEFAULT '',
          latest_job_id TEXT NOT NULL DEFAULT '',
          latest_job_status TEXT NOT NULL DEFAULT '',
          setup_summary_json TEXT NOT NULL DEFAULT '{}',
          task_summary_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_knowledge_bases_updated_at
          ON knowledge_bases(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_knowledge_bases_template_status
          ON knowledge_bases(template, status);
      `);
    }
  }
];

const catalogMigrations = [
  {
    id: "001_catalog_foundation",
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS catalog_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS setup_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          draft_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS jobs (
          job_id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          mode TEXT NOT NULL DEFAULT '',
          template TEXT NOT NULL DEFAULT '',
          summary_json TEXT NOT NULL DEFAULT '{}',
          progress_json TEXT NOT NULL DEFAULT '{}',
          job_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS task_steps (
          job_id TEXT NOT NULL,
          step_key TEXT NOT NULL,
          sort_order INTEGER NOT NULL,
          status TEXT NOT NULL,
          label_json TEXT NOT NULL DEFAULT '{}',
          message_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL,
          PRIMARY KEY (job_id, step_key),
          FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS query_feedback (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          needs_review INTEGER NOT NULL DEFAULT 0,
          resolved INTEGER NOT NULL DEFAULT 0,
          question TEXT NOT NULL DEFAULT '',
          answer_status TEXT NOT NULL DEFAULT '',
          result_key TEXT NOT NULL DEFAULT '',
          citation_ids_json TEXT NOT NULL DEFAULT '[]',
          citation_refs_json TEXT NOT NULL DEFAULT '[]',
          message TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          resolved_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_jobs_updated_at
          ON jobs(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_jobs_status
          ON jobs(status);
        CREATE INDEX IF NOT EXISTS idx_task_steps_status
          ON task_steps(status);
        CREATE INDEX IF NOT EXISTS idx_query_feedback_queue
          ON query_feedback(needs_review, resolved, created_at DESC);
      `);
    }
  },
  {
    id: "002_catalog_asset_tables",
    version: 2,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS source_documents (
          document_id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          source_type TEXT NOT NULL DEFAULT '',
          original_path TEXT NOT NULL DEFAULT '',
          normalized_relative_path TEXT NOT NULL DEFAULT '',
          content_hash TEXT NOT NULL DEFAULT '',
          platform_path_hint TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active',
          quality_state TEXT NOT NULL DEFAULT 'primary',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS document_versions (
          version_id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          display_version TEXT NOT NULL DEFAULT 'v1.0.0',
          content_hash TEXT NOT NULL DEFAULT '',
          artifact_path TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (document_id) REFERENCES source_documents(document_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS pages (
          page_id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          version_id TEXT NOT NULL DEFAULT '',
          page_number INTEGER NOT NULL DEFAULT 0,
          artifact_path TEXT NOT NULL DEFAULT '',
          text_hash TEXT NOT NULL DEFAULT '',
          extraction_state TEXT NOT NULL DEFAULT 'pending',
          quality_state TEXT NOT NULL DEFAULT 'primary',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (document_id) REFERENCES source_documents(document_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS blocks (
          block_id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL,
          document_id TEXT NOT NULL,
          block_type TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          text_path TEXT NOT NULL DEFAULT '',
          text_hash TEXT NOT NULL DEFAULT '',
          structure_path TEXT NOT NULL DEFAULT '',
          quality_state TEXT NOT NULL DEFAULT 'primary',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (page_id) REFERENCES pages(page_id) ON DELETE CASCADE,
          FOREIGN KEY (document_id) REFERENCES source_documents(document_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS structure_nodes (
          node_id TEXT PRIMARY KEY,
          parent_id TEXT,
          document_id TEXT NOT NULL,
          node_type TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          page_start INTEGER,
          page_end INTEGER,
          path TEXT NOT NULL DEFAULT '',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (parent_id) REFERENCES structure_nodes(node_id) ON DELETE CASCADE,
          FOREIGN KEY (document_id) REFERENCES source_documents(document_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS knowledge_objects (
          object_id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          structure_node_id TEXT,
          object_type TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '',
          source_page INTEGER,
          quality_state TEXT NOT NULL DEFAULT 'primary',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (document_id) REFERENCES source_documents(document_id) ON DELETE CASCADE,
          FOREIGN KEY (structure_node_id) REFERENCES structure_nodes(node_id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS chunks (
          chunk_id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          object_id TEXT,
          block_id TEXT,
          structure_node_id TEXT,
          text_path TEXT NOT NULL DEFAULT '',
          text_hash TEXT NOT NULL DEFAULT '',
          token_count INTEGER NOT NULL DEFAULT 0,
          quality_state TEXT NOT NULL DEFAULT 'primary',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (document_id) REFERENCES source_documents(document_id) ON DELETE CASCADE,
          FOREIGN KEY (object_id) REFERENCES knowledge_objects(object_id) ON DELETE SET NULL,
          FOREIGN KEY (block_id) REFERENCES blocks(block_id) ON DELETE SET NULL,
          FOREIGN KEY (structure_node_id) REFERENCES structure_nodes(node_id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS citations (
          citation_id TEXT PRIMARY KEY,
          chunk_id TEXT,
          document_id TEXT NOT NULL,
          page_id TEXT,
          block_id TEXT,
          structure_node_id TEXT,
          source_label TEXT NOT NULL DEFAULT '',
          page_number INTEGER,
          anchor TEXT NOT NULL DEFAULT '',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (chunk_id) REFERENCES chunks(chunk_id) ON DELETE CASCADE,
          FOREIGN KEY (document_id) REFERENCES source_documents(document_id) ON DELETE CASCADE,
          FOREIGN KEY (page_id) REFERENCES pages(page_id) ON DELETE SET NULL,
          FOREIGN KEY (block_id) REFERENCES blocks(block_id) ON DELETE SET NULL,
          FOREIGN KEY (structure_node_id) REFERENCES structure_nodes(node_id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS index_records (
          record_id TEXT PRIMARY KEY,
          chunk_id TEXT,
          provider TEXT NOT NULL DEFAULT '',
          index_name TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          vector_id TEXT NOT NULL DEFAULT '',
          keyword_key TEXT NOT NULL DEFAULT '',
          structure_key TEXT NOT NULL DEFAULT '',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (chunk_id) REFERENCES chunks(chunk_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS quality_issues (
          issue_id TEXT PRIMARY KEY,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'review',
          status TEXT NOT NULL DEFAULT 'open',
          reason TEXT NOT NULL DEFAULT '',
          details_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS build_versions (
          build_id TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'draft',
          active INTEGER NOT NULL DEFAULT 0,
          parent_build_id TEXT,
          summary_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS release_manifests (
          release_id TEXT PRIMARY KEY,
          build_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          manifest_path TEXT NOT NULL DEFAULT '',
          summary_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (build_id) REFERENCES build_versions(build_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS evaluation_cases (
          case_id TEXT PRIMARY KEY,
          template TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT '',
          question TEXT NOT NULL DEFAULT '',
          expected_json TEXT NOT NULL DEFAULT '{}',
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS evaluation_results (
          result_id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          build_id TEXT,
          status TEXT NOT NULL DEFAULT '',
          scores_json TEXT NOT NULL DEFAULT '{}',
          details_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (case_id) REFERENCES evaluation_cases(case_id) ON DELETE CASCADE,
          FOREIGN KEY (build_id) REFERENCES build_versions(build_id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS artifact_registry (
          artifact_id TEXT PRIMARY KEY,
          owner_type TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          artifact_type TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          content_hash TEXT NOT NULL DEFAULT '',
          size_bytes INTEGER NOT NULL DEFAULT 0,
          media_type TEXT NOT NULL DEFAULT '',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS document_overrides (
          override_id TEXT PRIMARY KEY,
          document_key TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'excluded_by_user',
          reason TEXT NOT NULL DEFAULT '',
          document_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS query_feedback_resolutions (
          resolution_id TEXT PRIMARY KEY,
          feedback_id TEXT NOT NULL,
          action TEXT NOT NULL DEFAULT 'resolved',
          message TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          FOREIGN KEY (feedback_id) REFERENCES query_feedback(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_source_documents_status
          ON source_documents(status, quality_state, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_source_documents_hash
          ON source_documents(content_hash);
        CREATE INDEX IF NOT EXISTS idx_document_versions_document
          ON document_versions(document_id, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_pages_document
          ON pages(document_id, page_number);
        CREATE INDEX IF NOT EXISTS idx_pages_quality
          ON pages(quality_state, extraction_state);
        CREATE INDEX IF NOT EXISTS idx_blocks_page
          ON blocks(page_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_blocks_document
          ON blocks(document_id, block_type);
        CREATE INDEX IF NOT EXISTS idx_structure_nodes_parent
          ON structure_nodes(parent_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_structure_nodes_document
          ON structure_nodes(document_id, node_type, sort_order);
        CREATE INDEX IF NOT EXISTS idx_knowledge_objects_type
          ON knowledge_objects(object_type, quality_state, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_knowledge_objects_document
          ON knowledge_objects(document_id, structure_node_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_quality
          ON chunks(quality_state, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_chunks_document
          ON chunks(document_id, structure_node_id);
        CREATE INDEX IF NOT EXISTS idx_citations_chunk
          ON citations(chunk_id);
        CREATE INDEX IF NOT EXISTS idx_citations_document_page
          ON citations(document_id, page_number);
        CREATE INDEX IF NOT EXISTS idx_index_records_status
          ON index_records(status, provider, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_index_records_chunk
          ON index_records(chunk_id);
        CREATE INDEX IF NOT EXISTS idx_quality_issues_queue
          ON quality_issues(status, severity, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_quality_issues_target
          ON quality_issues(target_type, target_id);
        CREATE INDEX IF NOT EXISTS idx_build_versions_active
          ON build_versions(active, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_release_manifests_build
          ON release_manifests(build_id, status);
        CREATE INDEX IF NOT EXISTS idx_evaluation_cases_template
          ON evaluation_cases(template, active, category);
        CREATE INDEX IF NOT EXISTS idx_evaluation_results_case
          ON evaluation_results(case_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_artifact_registry_owner
          ON artifact_registry(owner_type, owner_id, artifact_type);
        CREATE INDEX IF NOT EXISTS idx_artifact_registry_path
          ON artifact_registry(relative_path);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_document_overrides_key
          ON document_overrides(document_key);
        CREATE INDEX IF NOT EXISTS idx_document_overrides_status
          ON document_overrides(status, updated_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_query_feedback_resolutions_feedback
          ON query_feedback_resolutions(feedback_id);
      `);
    }
  },
  {
    id: "003_catalog_search_indexes",
    version: 3,
    up(db) {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS source_documents_fts USING fts5(
          document_id UNINDEXED,
          title,
          normalized_relative_path,
          metadata
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS structure_nodes_fts USING fts5(
          node_id UNINDEXED,
          title,
          path,
          node_type
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_objects_fts USING fts5(
          object_id UNINDEXED,
          title,
          object_type,
          metadata
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS query_feedback_fts USING fts5(
          id UNINDEXED,
          question,
          message,
          result_key
        );

        INSERT INTO source_documents_fts(rowid, document_id, title, normalized_relative_path, metadata)
          SELECT rowid, document_id, title, normalized_relative_path, metadata_json FROM source_documents;
        INSERT INTO structure_nodes_fts(rowid, node_id, title, path, node_type)
          SELECT rowid, node_id, title, path, node_type FROM structure_nodes;
        INSERT INTO knowledge_objects_fts(rowid, object_id, title, object_type, metadata)
          SELECT rowid, object_id, title, object_type, metadata_json FROM knowledge_objects;
        INSERT INTO query_feedback_fts(rowid, id, question, message, result_key)
          SELECT rowid, id, question, message, result_key FROM query_feedback;

        CREATE TRIGGER IF NOT EXISTS source_documents_fts_ai
        AFTER INSERT ON source_documents BEGIN
          INSERT INTO source_documents_fts(rowid, document_id, title, normalized_relative_path, metadata)
          VALUES (new.rowid, new.document_id, new.title, new.normalized_relative_path, new.metadata_json);
        END;

        CREATE TRIGGER IF NOT EXISTS source_documents_fts_ad
        AFTER DELETE ON source_documents BEGIN
          DELETE FROM source_documents_fts WHERE rowid = old.rowid;
        END;

        CREATE TRIGGER IF NOT EXISTS source_documents_fts_au
        AFTER UPDATE ON source_documents BEGIN
          DELETE FROM source_documents_fts WHERE rowid = old.rowid;
          INSERT INTO source_documents_fts(rowid, document_id, title, normalized_relative_path, metadata)
          VALUES (new.rowid, new.document_id, new.title, new.normalized_relative_path, new.metadata_json);
        END;

        CREATE TRIGGER IF NOT EXISTS structure_nodes_fts_ai
        AFTER INSERT ON structure_nodes BEGIN
          INSERT INTO structure_nodes_fts(rowid, node_id, title, path, node_type)
          VALUES (new.rowid, new.node_id, new.title, new.path, new.node_type);
        END;

        CREATE TRIGGER IF NOT EXISTS structure_nodes_fts_ad
        AFTER DELETE ON structure_nodes BEGIN
          DELETE FROM structure_nodes_fts WHERE rowid = old.rowid;
        END;

        CREATE TRIGGER IF NOT EXISTS structure_nodes_fts_au
        AFTER UPDATE ON structure_nodes BEGIN
          DELETE FROM structure_nodes_fts WHERE rowid = old.rowid;
          INSERT INTO structure_nodes_fts(rowid, node_id, title, path, node_type)
          VALUES (new.rowid, new.node_id, new.title, new.path, new.node_type);
        END;

        CREATE TRIGGER IF NOT EXISTS knowledge_objects_fts_ai
        AFTER INSERT ON knowledge_objects BEGIN
          INSERT INTO knowledge_objects_fts(rowid, object_id, title, object_type, metadata)
          VALUES (new.rowid, new.object_id, new.title, new.object_type, new.metadata_json);
        END;

        CREATE TRIGGER IF NOT EXISTS knowledge_objects_fts_ad
        AFTER DELETE ON knowledge_objects BEGIN
          DELETE FROM knowledge_objects_fts WHERE rowid = old.rowid;
        END;

        CREATE TRIGGER IF NOT EXISTS knowledge_objects_fts_au
        AFTER UPDATE ON knowledge_objects BEGIN
          DELETE FROM knowledge_objects_fts WHERE rowid = old.rowid;
          INSERT INTO knowledge_objects_fts(rowid, object_id, title, object_type, metadata)
          VALUES (new.rowid, new.object_id, new.title, new.object_type, new.metadata_json);
        END;

        CREATE TRIGGER IF NOT EXISTS query_feedback_fts_ai
        AFTER INSERT ON query_feedback BEGIN
          INSERT INTO query_feedback_fts(rowid, id, question, message, result_key)
          VALUES (new.rowid, new.id, new.question, new.message, new.result_key);
        END;

        CREATE TRIGGER IF NOT EXISTS query_feedback_fts_ad
        AFTER DELETE ON query_feedback BEGIN
          DELETE FROM query_feedback_fts WHERE rowid = old.rowid;
        END;

        CREATE TRIGGER IF NOT EXISTS query_feedback_fts_au
        AFTER UPDATE ON query_feedback BEGIN
          DELETE FROM query_feedback_fts WHERE rowid = old.rowid;
          INSERT INTO query_feedback_fts(rowid, id, question, message, result_key)
          VALUES (new.rowid, new.id, new.question, new.message, new.result_key);
        END;

        CREATE INDEX IF NOT EXISTS idx_query_feedback_action_created
          ON query_feedback(action, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_query_feedback_result_key
          ON query_feedback(result_key);
        CREATE INDEX IF NOT EXISTS idx_quality_issues_updated
          ON quality_issues(updated_at DESC);
      `);
    }
  },
  {
    id: "004_catalog_object_relations",
    version: 4,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS object_relations (
          relation_id TEXT PRIMARY KEY,
          source_object_id TEXT NOT NULL,
          target_object_id TEXT NOT NULL,
          relation_type TEXT NOT NULL DEFAULT '',
          document_id TEXT NOT NULL DEFAULT '',
          structure_node_id TEXT,
          citation_id TEXT,
          quality_state TEXT NOT NULL DEFAULT 'primary',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (source_object_id) REFERENCES knowledge_objects(object_id) ON DELETE CASCADE,
          FOREIGN KEY (target_object_id) REFERENCES knowledge_objects(object_id) ON DELETE CASCADE,
          FOREIGN KEY (document_id) REFERENCES source_documents(document_id) ON DELETE CASCADE,
          FOREIGN KEY (structure_node_id) REFERENCES structure_nodes(node_id) ON DELETE SET NULL,
          FOREIGN KEY (citation_id) REFERENCES citations(citation_id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_object_relations_source
          ON object_relations(source_object_id, relation_type);
        CREATE INDEX IF NOT EXISTS idx_object_relations_target
          ON object_relations(target_object_id, relation_type);
        CREATE INDEX IF NOT EXISTS idx_object_relations_document
          ON object_relations(document_id, relation_type, quality_state);
      `);
    }
  },
  {
    id: "005_catalog_chunk_search",
    version: 5,
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chunks_document_quality_updated
          ON chunks(document_id, quality_state, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_chunks_structure_quality
          ON chunks(structure_node_id, quality_state);
        CREATE INDEX IF NOT EXISTS idx_citations_document_page_search
          ON citations(document_id, page_number);
        CREATE INDEX IF NOT EXISTS idx_index_records_provider_index_status
          ON index_records(provider, index_name, status);

        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          chunk_id UNINDEXED,
          document_id UNINDEXED,
          structure_node_id UNINDEXED,
          title,
          text,
          metadata
        );

        INSERT INTO chunks_fts(rowid, chunk_id, document_id, structure_node_id, title, text, metadata)
          SELECT
            c.rowid,
            c.chunk_id,
            c.document_id,
            c.structure_node_id,
            COALESCE(json_extract(c.metadata_json, '$.title'), json_extract(c.metadata_json, '$.metadata.title'), ''),
            substr(COALESCE(json_extract(c.metadata_json, '$.text'), json_extract(c.metadata_json, '$.textPreview'), c.metadata_json), 1, 4000),
            substr(c.metadata_json, 1, 4000)
          FROM chunks c
          WHERE NOT EXISTS (SELECT 1 FROM chunks_fts WHERE rowid = c.rowid);

        CREATE TRIGGER IF NOT EXISTS chunks_fts_ai
        AFTER INSERT ON chunks BEGIN
          INSERT INTO chunks_fts(rowid, chunk_id, document_id, structure_node_id, title, text, metadata)
          VALUES (
            new.rowid,
            new.chunk_id,
            new.document_id,
            new.structure_node_id,
            COALESCE(json_extract(new.metadata_json, '$.title'), json_extract(new.metadata_json, '$.metadata.title'), ''),
            substr(COALESCE(json_extract(new.metadata_json, '$.text'), json_extract(new.metadata_json, '$.textPreview'), new.metadata_json), 1, 4000),
            substr(new.metadata_json, 1, 4000)
          );
        END;

        CREATE TRIGGER IF NOT EXISTS chunks_fts_ad
        AFTER DELETE ON chunks BEGIN
          DELETE FROM chunks_fts WHERE rowid = old.rowid;
        END;

        CREATE TRIGGER IF NOT EXISTS chunks_fts_au
        AFTER UPDATE ON chunks BEGIN
          DELETE FROM chunks_fts WHERE rowid = old.rowid;
          INSERT INTO chunks_fts(rowid, chunk_id, document_id, structure_node_id, title, text, metadata)
          VALUES (
            new.rowid,
            new.chunk_id,
            new.document_id,
            new.structure_node_id,
            COALESCE(json_extract(new.metadata_json, '$.title'), json_extract(new.metadata_json, '$.metadata.title'), ''),
            substr(COALESCE(json_extract(new.metadata_json, '$.text'), json_extract(new.metadata_json, '$.textPreview'), new.metadata_json), 1, 4000),
            substr(new.metadata_json, 1, 4000)
          );
        END;
      `);
    }
  }
];

export function userDataRoot(state = {}) {
  if (state.userDataRoot) return state.userDataRoot;
  const home = os.homedir();
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || process.env.APPDATA || path.join(home, "AppData", "Local");
    return path.join(base, "KnowMesh");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "KnowMesh");
  }
  const base = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(base, "knowmesh");
}

export function workspaceDatabasePath(state = {}) {
  return path.join(userDataRoot(state), "workspace.sqlite");
}

export function knowledgeBaseDataRoot(state = {}, id = "") {
  const knowledgeBaseId = safeId(id);
  if (!knowledgeBaseId) throw new Error("Knowledge base is required.");
  return path.join(userDataRoot(state), "knowledge-bases", knowledgeBaseId);
}

export function catalogDatabasePath(state = {}, id = "") {
  return path.join(knowledgeBaseDataRoot(state, id), "catalog.sqlite");
}

export function openWorkspaceDatabase(state = {}) {
  return openDatabase(workspaceDatabasePath(state), workspaceMigrations);
}

export function openCatalogDatabase(state = {}, id = "") {
  return openDatabase(catalogDatabasePath(state, id), catalogMigrations);
}

export function safeId(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function nowIso() {
  return new Date().toISOString();
}

export function parseJson(value, fallback) {
  try {
    if (value === undefined || value === null || value === "") return fallback;
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

export function stableJson(value) {
  return JSON.stringify(value ?? {});
}

function openDatabase(file, migrations) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db, migrations);
  return db;
}

function migrate(db, migrations) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${schemaVersionTable} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${migrationHistoryTable} (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      applied_at TEXT NOT NULL
    );

    INSERT OR IGNORE INTO ${schemaVersionTable} (id, version) VALUES (1, 0);
  `);

  const applied = new Set(
    db.prepare(`SELECT id FROM ${migrationHistoryTable}`).all().map((row) => row.id)
  );
  const applyMigration = db.transaction((migration) => {
    migration.up(db);
    db.prepare(`UPDATE ${schemaVersionTable} SET version = ? WHERE id = 1`).run(migration.version);
    db.prepare(`INSERT INTO ${migrationHistoryTable} (id, version, applied_at) VALUES (?, ?, ?)`)
      .run(migration.id, migration.version, nowIso());
  });

  for (const migration of migrations) {
    if (!applied.has(migration.id)) applyMigration(migration);
  }
}
