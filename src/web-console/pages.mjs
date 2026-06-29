import { getTemplateLibrary } from "../core/templates.mjs";
import { getAliyunModelCatalog, getAliyunModelSlots } from "../core/aliyun-model-catalog.mjs";
import { getDefaultRetrievalProfileId, getRetrievalMethods, getRetrievalProfiles } from "../core/retrieval-strategy-catalog.mjs";

const defaultMode = "aliyun";
const defaultTemplateId = "textbook-cn-k12";
const assetVersion = "0.1.9";
const templateLibrary = getTemplateLibrary();
const templateLibraryVersion = templateLibrary.version;
const templateSummaries = templateLibrary.templates;
const aliyunModelCatalog = getAliyunModelCatalog();
const aliyunModelSlots = getAliyunModelSlots();
const retrievalProfiles = getRetrievalProfiles();
const retrievalMethods = getRetrievalMethods();
const defaultRetrievalProfileId = getDefaultRetrievalProfileId();

const setupSteps = [
  { key: "mode", path: "/setup/mode", icon: "mode", scope: "all", group: "mode" },
  { key: "aliyun-account", path: "/setup/aliyun/account", icon: "settings", scope: "aliyun", group: "aliyun" },
  { key: "aliyun-credential", path: "/setup/aliyun/credential", icon: "settings", scope: "aliyun", group: "aliyun" },
  { key: "aliyun-permissions", path: "/setup/aliyun/permissions", icon: "environment", scope: "aliyun", group: "aliyun" },
  { key: "aliyun-storage", path: "/setup/aliyun/storage", icon: "build", scope: "aliyun", group: "aliyun" },
  { key: "aliyun-services", path: "/setup/aliyun/services", icon: "environment", scope: "aliyun", group: "aliyun" },
  { key: "aliyun-model-quality", path: "/setup/aliyun/model-quality", icon: "settings", scope: "aliyun", group: "aliyun" },
  { key: "aliyun-search", path: "/setup/aliyun/search", icon: "template", scope: "aliyun", group: "aliyun" },
  { key: "template", path: "/setup/template", icon: "template", scope: "all", group: "source" },
  { key: "retrieval", path: "/setup/retrieval", icon: "build", scope: "all", group: "source" },
  { key: "project", path: "/setup/project", icon: "settings", scope: "all", group: "source" },
  { key: "environment", path: "/setup/environment", icon: "environment", scope: "all", group: "environment" },
  { key: "scan", path: "/setup/scan", icon: "scan", scope: "all", group: "scan" },
  { key: "plan", path: "/setup/plan", icon: "build", scope: "all", group: "plan" },
  { key: "finish", path: "/setup/finish", icon: "check", scope: "all", group: "finish" }
];

const setupGroups = [
  { key: "mode", scope: "all", stepKeys: ["mode"] },
  {
    key: "aliyun",
    scope: "aliyun",
    stepKeys: [
      "aliyun-account",
      "aliyun-credential",
      "aliyun-permissions",
      "aliyun-storage",
      "aliyun-services",
      "aliyun-model-quality",
      "aliyun-search"
    ]
  },
  { key: "source", scope: "all", stepKeys: ["template", "retrieval", "project"] },
  { key: "environment", scope: "all", stepKeys: ["environment"] },
  { key: "scan", scope: "all", stepKeys: ["scan"] },
  { key: "plan", scope: "all", stepKeys: ["plan"] },
  { key: "finish", scope: "all", stepKeys: ["finish"] }
];

const setupDraftPanels = {
  "aliyun-account": {
    title: { zh: "账号路径", en: "Account Path" },
    note: {
      zh: "选择这次连接阿里云的账号路径。",
      en: "Choose how KnowMesh should connect to Aliyun this time."
    },
    fields: [
      {
        key: "aliyun.account.method",
        type: "select",
        label: { zh: "账号路径", en: "Account path" },
        options: [
          { value: "dedicated-ram", label: { zh: "使用专用 RAM 用户", en: "Use a dedicated RAM user" } },
          { value: "existing-profile", label: { zh: "检测本机配置", en: "Check local configuration" } },
          { value: "need-create", label: { zh: "查看创建指引", en: "Show creation guide" } }
        ]
      }
    ]
  },
  "aliyun-credential": {
    title: { zh: "阿里云连接凭证", en: "Aliyun Connection Credential" },
    note: {
      zh: "填写专用 RAM 用户的 AccessKey，先测试能否连接阿里云。",
      en: "Enter the dedicated RAM user's AccessKey and test the Aliyun connection first."
    },
    fields: [
      {
        key: "aliyun.credential.accessKeyId",
        type: "text",
        label: { zh: "AccessKey ID", en: "AccessKey ID" },
        placeholder: { zh: "粘贴 RAM 用户的 AccessKey ID", en: "Paste the RAM user's AccessKey ID" }
      },
      {
        key: "aliyun.credential.accessKeySecret",
        type: "password",
        sensitive: true,
        label: { zh: "AccessKey Secret", en: "AccessKey Secret" },
        placeholder: { zh: "只在本机使用，返回页面不会显示明文", en: "Used locally only; not shown again after navigation" }
      },
      {
        key: "aliyun.credential.saveTarget",
        type: "hidden",
        label: { zh: "保存位置", en: "Save location" },
        defaultValue: "secure-local"
      }
    ],
    checklist: [
      { zh: "使用专用 RAM 用户，不要使用主账号 AccessKey。", en: "Use a dedicated RAM user, not a root account AccessKey." },
      { zh: "测试连接只验证身份，不会上传资料。", en: "The connection test verifies identity only and uploads no files." },
      { zh: "测试通过后再继续检查账号。", en: "After the test passes, continue to the account check." }
    ],
    actions: [
      {
        key: "save-aliyun-credentials",
        endpoint: "/api/setup/aliyun/credentials/check",
        label: { zh: "测试凭证", en: "Test Credential" },
        loading: { zh: "正在测试凭证...", en: "Testing credential..." },
        idle: { zh: "先测试能否连接阿里云。测试通过后，再决定是否保存到本机。", en: "Test the Aliyun connection first. After it passes, choose whether to save locally." }
      },
      {
        key: "clear-aliyun-credentials",
        endpoint: "/api/setup/aliyun/credentials",
        method: "DELETE",
        resultKey: "save-aliyun-credentials",
        label: { zh: "清除凭证", en: "Clear" },
        loading: { zh: "正在清除凭证...", en: "Clearing credential..." },
        idle: { zh: "清除后需要重新填写 AccessKey 才能继续阿里云配置。", en: "After clearing, enter an AccessKey again to continue Aliyun setup." },
        danger: true,
        confirm: {
          title: { zh: "清除凭证", en: "Clear credential" },
          body: { zh: "这会删除本机保存的阿里云凭证，并移除 KnowMesh 写入项目 .env 的托管片段。之后需要重新填写才能继续。", en: "This removes the saved local Aliyun credential and the KnowMesh-managed block in the project .env. You must enter credentials again to continue." }
        }
      }
    ]
  },
  "aliyun-permissions": {
    title: { zh: "检查账号", en: "Check Account" },
    note: {
      zh: "只读确认这个账号能不能进入后续搭建。",
      en: "Read-only check for whether this account can continue setup."
    },
    actions: [
      {
        key: "check-aliyun-permissions",
        endpoint: "/api/aliyun/permissions/check",
        label: { zh: "检查账号", en: "Check Account" },
        loading: { zh: "正在检查阿里云账号...", en: "Checking Aliyun account..." },
        idle: { zh: "先确认连接、账号身份和保存空间读取能力。创建资源和调用服务会在后面对应步骤再次确认。", en: "Checks connection, account identity, and storage listing first. Resource creation and service calls are confirmed in later steps." }
      },
      {
        key: "copy-aliyun-policy",
        endpoint: "/api/aliyun/permissions/policy",
        resultKey: "check-aliyun-permissions",
        label: { zh: "生成权限清单", en: "Create Policy" },
        loading: { zh: "正在生成权限清单...", en: "Creating permission policy..." },
        idle: { zh: "生成可复制的 RAM 权限清单，用于到阿里云补齐缺失权限。", en: "Creates a copyable RAM policy for fixing missing Aliyun permissions." }
      }
    ]
  },
  "aliyun-storage": {
    title: { zh: "云端保存位置", en: "Cloud Storage Locations" },
    note: {
      zh: "选择资料和检索内容放在哪个地域、哪个保存空间。默认同一地域，复杂场景可单独设置检索位置。",
      en: "Choose regions and storage spaces for sources and searchable content. By default they share one region; advanced cases can split them."
    },
    fields: [
      {
        key: "aliyun.region",
        type: "select",
        label: { zh: "资料地域", en: "Source region" },
        options: [
          { value: "cn-hangzhou", label: { zh: "华东 1（杭州）", en: "China East 1 (Hangzhou)" } },
          { value: "cn-shanghai", label: { zh: "华东 2（上海）", en: "China East 2 (Shanghai)" } },
          { value: "cn-beijing", label: { zh: "华北 2（北京）", en: "China North 2 (Beijing)" } },
          { value: "cn-shenzhen", label: { zh: "华南 1（深圳）", en: "China South 1 (Shenzhen)" } },
          { value: "cn-heyuan", label: { zh: "华南 2（河源）", en: "China South 2 (Heyuan)" } },
          { value: "cn-chengdu", label: { zh: "西南 1（成都）", en: "China Southwest 1 (Chengdu)" } },
          { value: "cn-hongkong", label: { zh: "中国香港", en: "China (Hong Kong)" } },
          { value: "ap-southeast-1", label: { zh: "新加坡", en: "Singapore" } }
        ]
      },
      {
        key: "aliyun.storage.action",
        type: "select",
        label: { zh: "资料保存空间", en: "Source storage" },
        options: [
          { value: "create", label: { zh: "创建新的保存空间", en: "Create a new storage space" } },
          { value: "use-existing", label: { zh: "使用已有保存空间", en: "Use existing storage space" } }
        ]
      },
      {
        key: "aliyun.storage.bucket",
        type: "text",
        label: { zh: "资料 Bucket 名称", en: "Source bucket name" },
        placeholder: { zh: "例如：knowmesh-k12-source-20260616-a7f3", en: "Example: knowmesh-k12-source-20260616-a7f3" }
      },
      {
        key: "aliyun.search.storageMode",
        type: "select",
        label: { zh: "检索/向量位置", en: "Search/vector location" },
        options: [
          { value: "same-region", label: { zh: "同地域，创建向量 Bucket", en: "Same region, vector bucket" } },
          { value: "separate-region", label: { zh: "单独选择向量地域", en: "Choose vector region" } }
        ]
      },
      {
        key: "aliyun.search.region",
        type: "select",
        label: { zh: "检索/向量地域", en: "Search/vector region" },
        options: [
          { value: "", label: { zh: "跟随资料地域", en: "Follow source region" } },
          { value: "cn-hangzhou", label: { zh: "华东 1（杭州）", en: "China East 1 (Hangzhou)" } },
          { value: "cn-shanghai", label: { zh: "华东 2（上海）", en: "China East 2 (Shanghai)" } },
          { value: "cn-qingdao", label: { zh: "华北 1（青岛）", en: "China North 1 (Qingdao)" } },
          { value: "cn-beijing", label: { zh: "华北 2（北京）", en: "China North 2 (Beijing)" } },
          { value: "cn-shenzhen", label: { zh: "华南 1（深圳）", en: "China South 1 (Shenzhen)" } },
          { value: "cn-wulanchabu", label: { zh: "华北 6（乌兰察布）", en: "China North 6 (Ulanqab)" } },
          { value: "cn-hongkong", label: { zh: "中国香港", en: "China (Hong Kong)" } },
          { value: "ap-southeast-1", label: { zh: "新加坡", en: "Singapore" } },
          { value: "ap-southeast-5", label: { zh: "印度尼西亚（雅加达）", en: "Indonesia (Jakarta)" } },
          { value: "eu-central-1", label: { zh: "德国（法兰克福）", en: "Germany (Frankfurt)" } },
          { value: "us-west-1", label: { zh: "美国（硅谷）", en: "US (Silicon Valley)" } },
          { value: "us-east-1", label: { zh: "美国（弗吉尼亚）", en: "US (Virginia)" } }
        ]
      },
      {
        key: "aliyun.search.bucket",
        type: "text",
        label: { zh: "OSS 向量 Bucket 名称", en: "OSS vector bucket name" },
        placeholder: { zh: "例如：knowmesh-k12-vector-20260616-a7f3", en: "Example: knowmesh-k12-vector-20260616-a7f3" }
      }
    ],
    checklist: [
      { zh: "地域只能选择，不能手动输入。", en: "Regions are selected from a list, not typed manually." },
      { zh: "Bucket 名称会先检查格式和当前账号状态。", en: "Bucket names are checked for format and account state first." },
      { zh: "真正创建或绑定前会再次确认地域、名称、权限和影响。", en: "Before creating or binding, KnowMesh confirms regions, names, permissions, and impact." }
    ],
    actions: [
      {
        key: "preview-aliyun-storage",
        endpoint: "/api/aliyun/storage/preview",
        label: { zh: "检查保存位置", en: "Check Locations" },
        loading: { zh: "正在检查保存位置...", en: "Checking locations..." },
        idle: { zh: "先检查地域、Bucket 名称和当前账号状态；确认创建或保存后才可以继续。", en: "Checks regions, bucket names, and account state first; continue is enabled only after creation or saving is confirmed." }
      }
    ]
  },
  "aliyun-search": {
    fields: [
      {
        key: "aliyun.search.action",
        type: "select",
        label: { zh: "检索索引", en: "Search index" },
        options: [
          { value: "create", label: { zh: "创建新的索引", en: "Create a new index" } },
          { value: "use-existing", label: { zh: "使用已有索引", en: "Use existing index" } }
        ]
      },
      {
        key: "aliyun.search.index",
        type: "text",
        label: { zh: "索引名称", en: "Index name" },
        placeholder: { zh: "例如：textbookv1", en: "Example: textbookv1" }
      }
    ],
    action: {
      key: "save-aliyun-search",
      endpoint: "/api/setup/aliyun/search",
      label: { zh: "保存索引配置", en: "Save Index Setup" },
      loading: { zh: "正在保存索引配置...", en: "Saving index setup..." },
      idle: { zh: "保存后，开始前确认会按这个索引准备知识检索。", en: "After saving, the ready check uses this index for knowledge search." }
    }
  },
  "aliyun-services": {
    title: { zh: "模型服务", en: "Model Service" },
    note: {
      zh: "先接通阿里百炼，后面才能选择 OCR、整理、向量化等模型。",
      en: "Connect Alibaba Cloud Model Studio first, then choose OCR, organization, and embedding models."
    },
    fields: [
      {
        key: "aliyun.model.provider",
        type: "select",
        label: { zh: "模型供应商", en: "Model provider" },
        defaultValue: "aliyun-bailian",
        options: [
          { value: "aliyun-bailian", label: { zh: "阿里百炼", en: "Alibaba Cloud Model Studio" } }
        ]
      },
      {
        key: "aliyun.model.protocol",
        type: "select",
        label: { zh: "接入方式", en: "Access mode" },
        defaultValue: "openai-compatible",
        options: [
          { value: "openai-compatible", label: { zh: "OpenAI 兼容（推荐）", en: "OpenAI compatible (recommended)" } },
          { value: "dashscope-native", label: { zh: "DashScope 原生", en: "DashScope native" } }
        ]
      },
      {
        key: "aliyun.model.region",
        type: "select",
        label: { zh: "服务地域", en: "Service region" },
        defaultValue: "cn-beijing",
        options: [
          { value: "cn-beijing", label: { zh: "中国内地（北京）", en: "Mainland China (Beijing)" } },
          { value: "ap-southeast-1", label: { zh: "新加坡", en: "Singapore" } },
          { value: "eu-central-1", label: { zh: "德国", en: "Germany" } }
        ]
      },
      {
        key: "aliyun.model.workspaceId",
        type: "text",
        label: { zh: "Workspace ID", en: "Workspace ID" },
        placeholder: { zh: "新加坡/德国地域需要填写", en: "Required for Singapore/Germany regions" }
      },
      {
        key: "aliyun.model.baseUrl",
        type: "text",
        label: { zh: "Base URL", en: "Base URL" },
        defaultValue: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        placeholder: { zh: "默认会按地域自动带出", en: "Filled automatically from the region by default" }
      },
      {
        key: "aliyun.model.apiKey",
        type: "password",
        sensitive: true,
        label: { zh: "百炼 API Key", en: "Model Studio API Key" },
        placeholder: { zh: "粘贴阿里百炼 API Key", en: "Paste the Alibaba Cloud Model Studio API Key" }
      },
    ],
    action: {
      key: "test-aliyun-model-provider",
      endpoint: "/api/aliyun/model-provider/preview",
      label: { zh: "测试连接", en: "Test Connection" },
      loading: { zh: "正在检查模型服务...", en: "Checking model service..." },
      idle: { zh: "先确认模型供应商、Base URL 和 API Key 是否可用于后续模型配置。", en: "Confirm the provider, Base URL, and API Key before choosing later models." }
    }
  },
  "aliyun-model-quality": {
    title: { zh: "模型与质量方案", en: "Model and Quality Profile" },
    note: {
      zh: "选择这次知识库使用的识别、整理和向量化方案。这里只保存配置，不调用模型。",
      en: "Choose recognition, organization, and embedding settings for this knowledge base. This only saves settings and calls no model."
    },
    fields: [
      {
        key: "aliyun.services.profile",
        type: "hidden",
        label: { zh: "处理方案", en: "Processing profile" },
        defaultValue: "recommended",
        options: [
          { value: "recommended", label: { zh: "推荐配置", en: "Recommended" } },
          { value: "high-quality", label: { zh: "高质量配置", en: "High quality" } },
          { value: "low-cost", label: { zh: "低成本配置", en: "Lower cost" } }
        ]
      },
      {
        key: "aliyun.services.ocr",
        type: "select",
        label: { zh: "OCR / 文档识别", en: "OCR / document recognition" },
        defaultValue: "qwen-vl-ocr-2025-11-20",
        options: catalogFieldOptions("ocr")
      },
      {
        key: "aliyun.services.organizer",
        type: "select",
        label: { zh: "内容整理模型", en: "Organization model" },
        defaultValue: "qwen-plus",
        options: catalogFieldOptions("organizer")
      },
      {
        key: "aliyun.services.embedding",
        type: "select",
        label: { zh: "向量化模型", en: "Embedding model" },
        defaultValue: "text-embedding-v4",
        options: catalogFieldOptions("embedding")
      },
      {
        key: "aliyun.services.rerank",
        type: "select",
        label: { zh: "重排模型", en: "Rerank model" },
        defaultValue: "qwen3-rerank",
        options: catalogFieldOptions("rerank")
      }
    ],
    action: {
      key: "save-aliyun-model-quality",
      endpoint: "/api/setup/aliyun/model-quality",
      label: { zh: "保存模型方案", en: "Save Model Profile" },
      loading: { zh: "正在保存模型方案...", en: "Saving model profile..." },
      idle: { zh: "保存后，后续索引和开始前确认会按这套模型方案计算。", en: "After saving, later indexing and ready checks use this model profile." }
    }
  },
  retrieval: {
    title: { zh: "问答效果策略", en: "Answer Strategy" },
    note: {
      zh: "选择用户提问时怎么找资料、怎么排序和怎么校验引用。这里只保存策略，不读取资料、不调用模型。",
      en: "Choose how questions find sources, rank evidence, and check citations. This only saves settings; it reads no sources and calls no model."
    },
    fields: [
      {
        key: "retrieval.profile",
        type: "hidden",
        label: { zh: "问答策略", en: "Answer strategy" },
        defaultValue: defaultRetrievalProfileId,
        options: retrievalProfiles.map((profile) => ({
          value: profile.id,
          label: profile.label
        }))
      }
    ],
    action: {
      key: "save-retrieval-strategy",
      endpoint: "/api/setup/retrieval-strategy",
      label: { zh: "保存问答策略", en: "Save Answer Strategy" },
      loading: { zh: "正在保存问答策略...", en: "Saving answer strategy..." },
      idle: { zh: "保存后，执行预览和后续问答会按这套策略准备检索、重排、引用和无答案处理。", en: "After saving, the run preview and later Q&A use this strategy for retrieval, rerank, citations, and no-answer behavior." }
    }
  },
  environment: {
    title: { zh: "开始扫描前检查", en: "Pre-scan Check" },
    note: {
      zh: "确认资料目录、工作目录、资料范围和当前模式配置是否已经能进入扫描预览。这里只检查状态，不读取正文、不上传资料、不调用模型。",
      en: "Confirm that source folder, work folder, source scope, and current mode settings are ready for scan preview. This checks state only; it does not read body text, upload sources, or call models."
    },
    fields: [],
    checklist: [
      { zh: "资料目录和工作目录可用。", en: "Source and work folders are usable." },
      { zh: "资料范围已经补齐。", en: "Source scope is complete." },
      { zh: "当前模式需要的配置已经保存。", en: "Settings required by the current mode are saved." }
    ],
    action: {
      key: "check-environment",
      endpoint: "/api/environment/check",
      label: { zh: "检查", en: "Check" },
      loading: { zh: "正在检查...", en: "Checking..." },
      idle: { zh: "这里不会读取正文内容、不会上传资料、不会调用模型；只确认能否进入扫描预览。", en: "This does not read body text, upload sources, or call models; it only confirms whether scan preview can start." }
    }
  },
  project: {
    title: { zh: "资料目录草稿", en: "Source Folder Draft" },
    note: {
      zh: "选择本机资料目录和工作目录。也可以手动粘贴路径。KnowMesh 会先只读扫描资料，不会直接上传。",
      en: "Choose the local source folder and work folder, or paste paths manually. KnowMesh scans read-only first and does not upload directly."
    },
    fields: [
      {
        key: "project.source",
        type: "text",
        label: { zh: "资料目录", en: "Source folder" },
        placeholder: { zh: "默认：项目根目录/source", en: "Default: project root/source" }
      },
      {
        key: "project.workspace",
        type: "text",
        label: { zh: "工作目录", en: "Work folder" },
        placeholder: { zh: "默认：项目根目录/workspace", en: "Default: project root/workspace" }
      },
      {
        key: "metadata.stage",
        type: "multi-select",
        label: { zh: "学段范围", en: "School stages" },
        options: [
          { value: "小学", label: { zh: "小学", en: "Primary" } },
          { value: "初中", label: { zh: "初中", en: "Junior high" } },
          { value: "高中", label: { zh: "高中", en: "Senior high" } }
        ]
      },
      {
        key: "metadata.subject",
        type: "multi-select",
        label: { zh: "学科范围", en: "Subjects" },
        options: [
          { value: "语文", label: { zh: "语文", en: "Chinese" }, stages: ["小学", "初中", "高中"] },
          { value: "数学", label: { zh: "数学", en: "Mathematics" }, stages: ["小学", "初中", "高中"] },
          { value: "英语", label: { zh: "英语", en: "English" }, stages: ["小学", "初中", "高中"] },
          { value: "道德与法治", label: { zh: "道德与法治", en: "Morality and Law" }, stages: ["小学", "初中"] },
          { value: "科学", label: { zh: "科学", en: "Science" }, stages: ["小学"] },
          { value: "历史", label: { zh: "历史", en: "History" }, stages: ["初中", "高中"] },
          { value: "地理", label: { zh: "地理", en: "Geography" }, stages: ["初中", "高中"] },
          { value: "物理", label: { zh: "物理", en: "Physics" }, stages: ["初中", "高中"] },
          { value: "化学", label: { zh: "化学", en: "Chemistry" }, stages: ["初中", "高中"] },
          { value: "生物", label: { zh: "生物", en: "Biology" }, stages: ["初中", "高中"] },
          { value: "思想政治", label: { zh: "思想政治", en: "Politics" }, stages: ["高中"] },
          { value: "信息科技", label: { zh: "信息科技", en: "Information Technology" }, stages: ["小学", "初中", "高中"] },
          { value: "体育与健康", label: { zh: "体育与健康", en: "PE and Health" }, stages: ["小学", "初中", "高中"] },
          { value: "音乐", label: { zh: "音乐", en: "Music" }, stages: ["小学", "初中", "高中"] },
          { value: "美术", label: { zh: "美术", en: "Fine Arts" }, stages: ["小学", "初中", "高中"] }
        ]
      },
      {
        key: "metadata.grade",
        type: "multi-select",
        label: { zh: "年级范围", en: "Grades" },
        options: [
          { value: "一年级", label: { zh: "一年级", en: "Grade 1" }, stages: ["小学"] },
          { value: "二年级", label: { zh: "二年级", en: "Grade 2" }, stages: ["小学"] },
          { value: "三年级", label: { zh: "三年级", en: "Grade 3" }, stages: ["小学"] },
          { value: "四年级", label: { zh: "四年级", en: "Grade 4" }, stages: ["小学"] },
          { value: "五年级", label: { zh: "五年级", en: "Grade 5" }, stages: ["小学"] },
          { value: "六年级", label: { zh: "六年级", en: "Grade 6" }, stages: ["小学"] },
          { value: "七年级", label: { zh: "七年级", en: "Grade 7" }, stages: ["初中"] },
          { value: "八年级", label: { zh: "八年级", en: "Grade 8" }, stages: ["初中"] },
          { value: "九年级", label: { zh: "九年级", en: "Grade 9" }, stages: ["初中"] },
          { value: "高一", label: { zh: "高一", en: "Senior 1" }, stages: ["高中"] },
          { value: "高二", label: { zh: "高二", en: "Senior 2" }, stages: ["高中"] },
          { value: "高三", label: { zh: "高三", en: "Senior 3" }, stages: ["高中"] }
        ]
      },
      {
        key: "metadata.volume",
        type: "multi-select",
        label: { zh: "册别范围", en: "Volumes" },
        options: [
          { value: "上册", label: { zh: "上册", en: "Volume 1" }, stages: ["小学", "初中"] },
          { value: "下册", label: { zh: "下册", en: "Volume 2" }, stages: ["小学", "初中"] },
          { value: "全一册", label: { zh: "全一册", en: "Single volume" }, stages: ["初中"] },
          { value: "必修", label: { zh: "必修", en: "Compulsory" }, stages: ["高中"] },
          { value: "选择性必修", label: { zh: "选择性必修", en: "Selective compulsory" }, stages: ["高中"] }
        ]
      },
      {
        key: "metadata.publisher",
        type: "text",
        label: { zh: "出版社", en: "Publisher" },
        placeholder: { zh: "可选", en: "Optional" }
      },
      {
        key: "metadata.edition",
        type: "text",
        label: { zh: "版本/版次", en: "Edition" },
        placeholder: { zh: "可选", en: "Optional" }
      }
    ],
    checklist: [
      { zh: "资料目录只读扫描。", en: "Source folder is scanned read-only." },
      { zh: "工作目录保存中间结果、报告和可回滚版本。", en: "Work folder stores intermediate data, reports, and restorable versions." },
      { zh: "资料范围选择学段、学科和年级。", en: "Source scope covers stages, subjects, and grades." }
    ]
  },
  scan: {
    title: { zh: "扫描预览", en: "Scan Preview" },
    note: {
      zh: "按当前模板只读扫描用户选择的资料目录，先看文件数量、分卷合并和需要补齐的信息。",
      en: "Scan the selected source folder read-only with the selected template, then preview file counts, handling groups, split PDFs, and missing fields."
    },
    fields: [],
    checklist: [
      { zh: "只读取文件名、大小、类型和分卷关系。", en: "Reads only names, sizes, types, and split-file relations." },
      { zh: "不会上传资料，不会做 OCR，也不会生成检索数据。", en: "Does not upload sources, run OCR, or create search data." },
      { zh: "发现缺失项时会提示回到对应配置。", en: "Missing items point back to the related setup step." }
    ],
    action: {
      key: "preview-scan",
      endpoint: "/api/scan/preview",
      label: { zh: "生成扫描预览", en: "Generate Scan Preview" },
      loading: { zh: "正在只读扫描...", en: "Scanning read-only..." },
      idle: { zh: "这一步只做本机只读扫描。确认执行前不会整理、上传或写入知识库。", en: "This is a local read-only scan. It does not organize, upload, or write to the knowledge base before confirmation." }
    }
  },
  plan: {
    title: { zh: "确认能否开始", en: "Ready to Start" },
    note: {
      zh: "确认这批资料现在能不能开始处理。没有必须处理的问题后，就可以进入最后确认。",
      en: "Confirm whether these sources are ready to process now. Continue unlocks after required issues are clear."
    },
    fields: [],
    checklist: [
      { zh: "展示本地动作、云端动作和必须先处理的问题。", en: "Shows local actions, cloud actions, and required fixes." },
      { zh: "有缺失配置时直接提示回到对应步骤。", en: "Missing settings point back to the related step." },
      { zh: "预览不会上传、不会调用模型、不会写入知识库。", en: "Preview does not upload, call models, or write to the knowledge base." }
    ],
    action: {
      key: "preview-run",
      endpoint: "/api/plan/preview",
      label: { zh: "生成本次计划", en: "Generate Plan" },
      loading: { zh: "正在生成计划...", en: "Generating plan..." },
      idle: { zh: "生成通过后才能继续。正式执行上传、模型调用或写入时，还会再次让你确认。", en: "Continue unlocks after a passing plan. Uploads, model calls, and writes still ask for confirmation before running." }
    }
  }
};

const setupTaskBriefs = {
  "aliyun-account": {
    focus: { zh: "确认这次连接阿里云要使用哪个账号。", en: "Confirm which Aliyun account this build will use." },
    next: { zh: "下一步测试连接凭证，通过后再保存。", en: "Next, test the connection credential, then save it after it passes." },
    guard: { zh: "不使用主账号密钥，也不会创建云资源。", en: "No root key is used and no cloud resource is created." }
  },
  "aliyun-credential": {
    focus: { zh: "先测试 AccessKey 是否能连接阿里云，通过后再保存到本机。", en: "Test whether the AccessKey can connect to Aliyun first, then save it locally after it passes." },
    next: { zh: "保存完成后检查这个账号能不能继续搭建。", en: "After saving, check whether this account can continue setup." },
    guard: { zh: "密钥只保存在本机，返回页面不显示明文。", en: "The secret stays local and is not shown again." }
  },
  "aliyun-permissions": {
    focus: { zh: "确认账号能连接阿里云、身份安全，并能读取保存空间。", en: "Confirm the account connects to Aliyun, is safe to use, and can list storage." },
    next: { zh: "账号检查通过后配置资料和检索保存位置。", en: "After the account passes, configure source and search storage." },
    guard: { zh: "这里只读检查，不会修改阿里云配置。", en: "This is read-only and does not change Aliyun." }
  },
  "aliyun-storage": {
    focus: { zh: "选择资料和检索内容分别保存在哪个地域、哪个 Bucket。", en: "Choose the regions and buckets for sources and searchable content." },
    next: { zh: "保存位置准备好后继续确认模型与质量。", en: "After storage locations are ready, confirm model and quality settings." },
    guard: { zh: "检查通过后会再次确认，确认后才创建缺失 Bucket 或保存已有 Bucket。", en: "After the check passes, KnowMesh asks again before creating missing buckets or saving existing ones." }
  },
  "aliyun-search": {
    focus: { zh: "为整理后的知识片段设置索引名称。", en: "Set the index name for organized knowledge chunks." },
    next: { zh: "接下来选择模板和资料目录。", en: "Next, choose the template and source folder." },
    guard: { zh: "写入知识库前必须先看过滤报告。", en: "A filter report is required before writing." }
  },
  template: {
    focus: { zh: "先选择最接近资料类型的模板。", en: "Choose the template closest to your source type first." },
    next: { zh: "字段、过滤规则和验证问题会随模板更新。", en: "Fields, filters, and validation update with the template." },
    guard: { zh: "选择模板只改本机草稿，不扫描、不上传。", en: "Template choice changes the local draft only." }
  },
  project: {
    focus: { zh: "选择资料目录、工作目录和资料范围。", en: "Choose the source folder, work folder, and source scope." },
    next: { zh: "完成后做扫描前检查，再预览资料。", en: "Then run the pre-scan check before previewing sources." },
    guard: { zh: "资料目录只读使用，不移动原始文件。", en: "The source folder is read-only; originals are not moved." }
  },
  environment: {
    focus: { zh: "确认这批资料是否能进入扫描预览。", en: "Confirm whether these sources can enter scan preview." },
    next: { zh: "缺失项会提示回到对应配置页。", en: "Missing items point back to the right setup page." },
    guard: { zh: "不读取正文、不上传资料、不调用模型。", en: "No body text is read, no source is uploaded, and no model is called." }
  },
  scan: {
    focus: { zh: "只读扫描文件、分卷和模板缺失项。", en: "Read-only scan files, split parts, and missing fields." },
    next: { zh: "扫描结果会进入开始前确认。", en: "Scan results feed the ready check." },
    guard: { zh: "不识别扫描页、不上传、不写入知识库。", en: "No OCR, upload, or knowledge-base write happens." }
  },
  plan: {
    focus: { zh: "确认现在能不能开始，以及正式执行前还会让你确认哪些动作。", en: "Confirm whether processing can start now, and which actions will ask again before running." },
    next: { zh: "没有必须处理的问题后，进入完整控制台执行。", en: "When required fixes are clear, open the full console to run." },
    guard: { zh: "预览不会调用模型或写入知识库。", en: "Preview does not call models or write to the knowledge base." }
  }
};

const setupAliyunGuides = {
  "aliyun-account": {
    prepare: { zh: "准备一个专门给 KnowMesh 用的阿里云 RAM 用户。", en: "Prepare an Aliyun RAM user dedicated to KnowMesh." },
    check: { zh: "页面会记录你准备用哪类账号，后续再验证连接。", en: "This page records the account type; connection is verified later." },
    fix: { zh: "如果还没有专用账号，先去阿里云创建 RAM 用户，再回到这里继续。", en: "If there is no dedicated account yet, create a RAM user in Aliyun first, then return." }
  },
  "aliyun-credential": {
    prepare: { zh: "粘贴 AccessKey ID 和 Secret，选择测试通过后的保存方式。", en: "Paste AccessKey ID and Secret, then choose how to save it after the test passes." },
    check: { zh: "系统先验证身份是否能连接，测试通过后再询问是否保存。", en: "KnowMesh verifies identity connectivity first, then asks whether to save after the test passes." },
    fix: { zh: "失败时优先检查密钥是否属于当前 RAM 用户、是否已启用、是否复制完整。", en: "If it fails, check that the key belongs to the RAM user, is enabled, and was copied fully." }
  },
  "aliyun-permissions": {
    prepare: { zh: "使用刚保存的 AccessKey，不需要再填写新内容。", en: "Use the saved AccessKey; no new field is required here." },
    check: { zh: "系统只读确认阿里云连接、RAM 用户身份和 OSS 保存空间读取能力。", en: "KnowMesh checks connection, RAM user identity, and OSS storage listing read-only." },
    fix: { zh: "如果不是 RAM 用户或缺少 OSS 读取权限，按提示到阿里云 RAM 补齐后重新检查。", en: "If the account is not a RAM user or cannot list OSS storage, fix it in Aliyun RAM and check again." }
  },
  "aliyun-storage": {
    prepare: { zh: "选择地域，填写资料 Bucket 和 OSS 向量 Bucket 名称。", en: "Choose regions and enter source plus OSS vector bucket names." },
    check: { zh: "系统检查名称、地域和当前账号状态，再由你确认创建或保存。", en: "KnowMesh checks names, regions, and account state, then asks you to confirm creation or saving." },
    fix: { zh: "名称冲突时改为使用已有 Bucket，或生成新名称后重新检查并确认。", en: "If a name conflicts, use the existing bucket or generate a new name, then check and confirm again." }
  },
  "aliyun-search": {
    prepare: { zh: "填写索引名称，用来区分知识库版本。", en: "Enter an index name to separate knowledge-base versions." },
    check: { zh: "系统确认索引名称和模型关系，不会现在写入知识库。", en: "KnowMesh confirms the index and model relation; it does not write now." },
    fix: { zh: "如果名称不清楚，先用资料主题和版本命名，后续写入前仍可返回修改。", en: "If naming is unclear, use the source topic and version; you can still change it before writes." }
  }
};

const projectDraftSections = {
  source: {
    title: { zh: "资料目录", en: "Source Folder" },
    note: { zh: "选择原始资料所在文件夹，只读扫描。", en: "Choose the folder with original sources; scanned read-only." }
  },
  workspace: {
    title: { zh: "工作目录", en: "Work Folder" },
    note: { zh: "选择保存中间结果、报告和可回滚版本的位置。", en: "Choose where intermediate data, reports, and restorable versions are stored." }
  },
  metadata: {
    title: { zh: "资料范围", en: "Source Scope" },
    note: { zh: "选择这批资料大概覆盖哪些学段、学科和年级。扫描时会再识别每个文件的具体归属。", en: "Choose the stages, subjects, and grades covered by this folder. Each file is classified during scanning." }
  }
};

const consoleNavItems = [
  { key: "overview", path: "/overview", icon: "home" },
  { key: "build", path: "/build", icon: "build" },
  { key: "execution", path: "/build/execution", icon: "run" },
  { key: "ask", path: "/use/ask", icon: "ask" },
  { key: "integration", path: "/use/integration", icon: "api" },
  { key: "api-docs", path: "/use/api-docs", icon: "api" },
  { key: "feedback", path: "/use/feedback", icon: "feedback" },
  { key: "documents", path: "/maintain/documents", icon: "template" },
  { key: "document-asset", path: "/maintain/document", icon: "template" },
  { key: "versions", path: "/maintain/versions", icon: "clock" },
  { key: "evaluation", path: "/maintain/evaluation", icon: "check" },
  { key: "feedback-review", path: "/maintain/feedback", icon: "feedback" },
  { key: "maintenance", path: "/maintain/diagnostics", icon: "maintenance" },
  { key: "knowledge-bases", path: "/knowledge-bases", icon: "database" },
];

const consoleNavSections = [
  { key: "overview", item: "overview" },
  { key: "build-workflow", icon: "build", items: ["build", "execution"] },
  { key: "use-knowledge", icon: "ask", items: ["ask", "integration", "api-docs", "feedback"] },
  { key: "maintain-knowledge", icon: "template", items: ["documents", "versions", "evaluation", "feedback-review", "maintenance"] },
  { key: "settings", icon: "settings", href: "/setup/mode" }
];

const consoleNavItemByKey = new Map(consoleNavItems.map((item) => [item.key, item]));

const copy = {
  zh: {
    app: {
      subtitle: "本地知识库搭建台",
      service: "本地服务",
      currentMode: "当前模式",
      currentTemplate: "当前模板",
      recommended: "推荐",
      builtIn: "内置",
      requiredFields: "必填项",
      fields: "字段",
      required: "必填",
      optional: "可选",
      filterPolicy: "过滤策略",
      templateContract: "模板策略",
      searchContract: "检索字段",
      citationContract: "引用字段",
      filterContract: "问题过滤",
      sidecarContract: "阿里云存储",
      templateLibraryVersion: "模板库",
      currentTemplateVersion: "当前模板",
      chunkingStrategy: "分片策略",
      qualityGates: "质量门禁",
      pitfalls: "常见问题",
      acceptanceCriteria: "验收标准",
      defaultSource: "推荐资料目录",
      language: "语言",
      theme: "主题",
      sidebar: "折叠菜单",
      expandSidebar: "展开菜单",
      editSetup: "修改配置",
      dark: "暗",
      light: "亮"
    },
    modes: {
      aliyun: {
        label: "阿里云模式",
        short: "阿里云",
        description: "默认模式，使用阿里云保存资料、整理内容并支持知识检索。"
      },
      local: {
        label: "本地模式",
        short: "本地",
        description: "只使用本机文件与本地流程，不需要云端密钥。"
      }
    },
    jobs: {
      latest: {
        badge: "当前任务",
        title: "执行任务",
        note: "任务创建后，这里会显示每一步的进度、回显和处理结果。",
        create: "去创建任务",
        openPlan: "查看生成计划",
        emptyTitle: "还没有任务",
        emptyBody: "创建任务后，这里会显示扫描、清洗、分片、写入和质量检查进度。",
        nextTitle: "下一步",
        nextBody: "先在生成知识库页完成扫描和计划；计划通过后点击“创建任务”，创建成功后会自动进入这里。",
        emptySteps: [
          ["扫描资料", "确认文件范围和可处理内容。"],
          ["整理内容", "按模板完成清洗、分片和索引准备。"],
          ["写入知识库", "执行前确认风险，完成后再提问测试。"]
        ],
        refresh: "刷新状态",
        test: "测试当前步骤",
        ask: "提问测试",
        artifacts: "查看本地产物",
        statusLoading: "正在读取任务",
        statusBody: "读取完成后，底部只保留当前可执行的操作。",
        advance: "推进下一步",
        retry: "重试当前步骤",
        run: "执行剩余步骤",
        pause: "暂停任务",
        resume: "恢复任务",
        stop: "终止任务",
        pauseConfirmTitle: "暂停这个任务？",
        pauseConfirmBody: "暂停后，KnowMesh 会等当前正在执行的步骤结束，再停止继续执行后续步骤。已完成的进度会保留，之后可以恢复。",
        stopConfirmTitle: "终止这个任务？",
        stopConfirmBody: "终止后，等待中或执行中的步骤不会继续推进。已经生成的处理文件会保留，但这个任务不能再恢复。",
        advanceLoading: "正在推进任务...",
        runLoading: "正在执行剩余步骤...",
        pauseLoading: "正在暂停任务...",
        resumeLoading: "正在恢复任务...",
        stopLoading: "正在终止任务...",
        testLoading: "正在测试当前步骤...",
        loading: "正在读取任务..."
      }
    },
    knowledgeBases: {
      title: "知识库管理",
      lead: "每个知识库都有独立配置、任务、版本和待确认内容。切换后再维护对应知识库。",
      current: "当前知识库",
      latestJob: "最近任务",
      noJob: "还没有任务",
      source: "资料目录",
      noSource: "未设置资料目录",
      emptyTitle: "先新建一个知识库",
      emptyBody: "每个知识库都有独立配置和任务。新建后再进入搭建向导。",
      create: "新建知识库",
      switch: "切换",
      currentBadge: "当前",
      promptTitle: "新建知识库",
      promptBody: "给这个知识库起一个容易识别的名称。",
      promptPlaceholder: "例如：小学数学教材库",
      creating: "正在创建知识库...",
      created: "知识库已创建，请继续配置。",
      switched: "已切换知识库。",
      manage: "管理",
      contextLabel: "当前知识库",
      switchContext: "切换知识库",
      continueBuild: "继续生成",
      openTask: "查看任务",
      validate: "提问测试",
      editSetup: "修改配置",
      workspace: "工作目录",
      noWorkspace: "未设置工作目录",
      template: "模板",
      status: "状态"
    },
    documentsPanel: {
      title: "资料资产",
      lead: "查看当前知识库纳入的原始资料、处理页、分片和引用状态。排除或恢复会在下一次执行时生效。",
      loading: "正在读取资料...",
      check: "检查资料变化",
      search: "搜索资料",
      all: "全部",
      included: "已纳入",
      excluded: "已排除",
      attention: "需处理",
      emptyTitle: "还没有资料清单",
      emptyBody: "先配置资料目录，或执行一次扫描后再查看。",
      total: "资料总数",
      source: "资料路径",
      type: "类型",
      status: "状态",
      actionExclude: "排除",
      actionRestore: "恢复",
      confirmExcludeTitle: "排除这份资料？",
      confirmExcludeBody: "排除后，这份资料不会进入下一次扫描、清洗、向量化或写入。已有版本不会立即删除，重新执行后才生效。",
      confirmRestoreTitle: "恢复这份资料？",
      confirmRestoreBody: "恢复后，这份资料会重新进入当前知识库后续执行。请先检查资料变化，再继续任务。",
      excludedByUser: "用户已排除",
      includedStatus: "已纳入",
      added: "新增",
      modified: "已修改",
      missing: "缺失",
      noChanges: "未发现变化",
      changes: "发现资料变化",
      loadMore: "加载更多",
      locate: "定位文件",
      openAsset: "查看全文",
      assetTitle: "资料全文",
      assetLead: "按页查看这份资料处理后的文本、分片、引用和质量状态。",
      assetLoading: "正在读取资料全文...",
      assetMissing: "没有找到这份资料的全文资产。请确认任务已完成写入，或重新生成知识库。",
      backToAssets: "返回资料资产",
      page: "页码",
      pages: "页",
      chunks: "分片",
      sourceParts: "来源分卷",
      activeChunks: "已写入分片",
      reviewChunks: "待确认分片",
      lowScoreChunks: "低分片段",
      pageText: "页面文本",
      pageChunks: "本页分片",
      loadMorePages: "加载更多页",
      noSidecar: "还没有可查看的 Sidecar 分片。",
      sidecarReady: "Sidecar 已就绪",
      moreActions: "更多操作",
      menuView: "查看",
      menuMaintain: "维护",
      copyPath: "复制路径",
      pathCopied: "路径已复制",
      version: "版本",
      updated: "最后记录",
      fingerprint: "内容指纹",
      unknown: "未记录",
      loaded: "已显示",
      matched: "找到",
      locatedFile: "已打开并定位文件",
      openedDirectory: "已打开所在目录",
      locatedSourcePart: "已定位第一个分卷文件"
    },

    integrationPanel: {
      title: "接入并测试当前知识库",
      note: "先复制当前知识库接口，再用下方测试区确认外部应用会拿到的答案、引用和反馈。",
      endpointTitle: "接口地址",
      endpointBody: "已绑定当前知识库，可用于应用、工作流、脚本或内部系统。",
      copyEndpoint: "复制接口",
      copyContractEndpoint: "复制契约",
      copyCode: "复制代码",
      copyCodeFor: "复制 {label}",
      copyBrief: "复制接入说明",
      flowTitle: "最短接入路径",
      flowBody: "字段说明和代码示例统一放在 API 文档里。",
      flowSteps: [
        ["调用 Query Runtime", "把用户问题发送到当前知识库接口。"],
        ["只展示可靠答案", "只有 ok=true 且 status=answered 时展示 answer.text。"],
        ["显示引用来源", "把文件、页码和原文片段展示给用户确认。"],
        ["提交使用反馈", "有帮助只记正向信号；引用不对和回答漏点进入问答反馈待复核。"]
      ],
      testTitle: "测试接入结果",
      testBody: "这里调用的就是外部应用会使用的 Query Runtime。",
      questionLabel: "测试问题",
      questionPlaceholder: "例如：五年级统编版语文第三单元第一课是什么？",
      resultAnswered: "已返回可靠答案",
      resultNoAnswer: "暂时不能回答",
      resultError: "调用需要处理",
      emptyQuestion: "请先输入一个测试问题。",
      statusLabel: "状态",
      runtimeLabel: "运行时",
      durationLabel: "耗时",
      citationsLabel: "引用",
      citationsUnit: "条",
      safetyTitle: "本地接入边界",
      safetyBody: "默认只监听 127.0.0.1。开放给局域网或服务器前，先确认访问控制、日志和密钥保护。",
      examplesTitle: "调用示例",
      contractTitle: "接口契约",
      contractBody: "第三方应用只需要遵守这份契约；本地提问和外部调用走同一套运行时。",
      requestTitle: "请求",
      responseTitle: "响应字段",
      statusTitle: "状态",
      errorsTitle: "错误码",
      feedbackTitle: "反馈闭环",
      integrationBriefTitle: "交给开发者的接入说明",
      integrationBriefBody: "复制后可以直接放进你的业务系统接入任务里。",
      requestFields: [
        ["POST", "发送到当前知识库的 Query Runtime 地址。"],
        ["Content-Type", "使用 application/json。"],
        ["question", "必填。用户提出的问题。"],
        ["query", "可选。question 的兼容字段，二选一即可。"]
      ],
      fields: [
        ["ok", "布尔值。true 表示已得到可靠答案。"],
        ["status", "answered、no_answer、invalid_request 或 runtime_error。"],
        ["answer.text", "最终答案；只有找到可靠来源后才会给出。"],
        ["citations", "来源文件、页码、原文片段和可维护链接。"],
        ["query.understanding", "问题理解结果，例如学段、年级、学科、册别和单元。"],
        ["query.retrieval", "检索范围、命中数量、过滤原因和来源类型。"],
        ["feedback.endpoint", "第三方应用可提交“有帮助、引用不对、回答漏点”等反馈。"]
      ],
      statusFields: [
        ["answered", "已找到可靠来源并生成答案。"],
        ["no_answer", "没有足够可靠的来源，业务系统应提示用户换问法或补充资料。"],
        ["invalid_request", "请求缺少必要字段，例如 question 为空。"],
        ["runtime_error", "模型、向量检索、Sidecar 或服务运行时异常。"]
      ],
      errorFields: [
        ["missing_question", "没有传入可查询的问题。"],
        ["runtime_error", "运行时异常；查看 error.message 和本地日志定位。"]
      ],
      feedbackFields: [
        ["POST feedback.endpoint", "提交用户反馈，默认写入当前知识库。"],
        ["useful", "只作为正向信号记录，不进入待复核。"],
        ["wrong_citation", "引用不对，会进入问答反馈页复核。"],
        ["missed_point", "回答漏点，会进入问答反馈页复核。"],
        ["question", "原始问题。"],
        ["citationIds", "用户指出有问题的引用片段 ID。"],
        ["citationRefs", "建议同时提交引用标题、页码、资料入口和片段摘要，方便维护者定位。"],
        ["问答反馈", "通过反馈接口或问答反馈页查看待复核记录。"]
      ]
    },

    askPanel: {
      title: "提问测试",
      note: "这里和第三方接入使用同一个 Query Runtime。页面里能查到、能引用、能反馈的结果，外部应用调用接口时也是同一套链路。",
      questionLabel: "问题",
      questionPlaceholder: "例如：五年级统编版语文第三单元第一课是什么？"
    },
    feedbackPanel: {
      title: "反馈记录",
      note: "查看提问测试和外部应用提交的反馈概况。需要处理的反馈会集中进入维护页。",
      loading: "正在读取反馈记录..."
    },
    feedbackReviewPanel: {
      title: "问答反馈维护",
      note: "处理引用不对和回答漏点，处理记录会保留在当前知识库。",
      loading: "正在读取待复核反馈..."
    },

    versionRecordsPanel: {
      title: "版本记录",
      note: "查看当前知识库的构建版本、当前生效版本、写入目标和 Sidecar 状态。",
      loading: "正在读取版本记录..."
    },
    evaluationDashboardPanel: {
      title: "评测看板",
      note: "查看评测覆盖、失败类别、最近构建和下一步维护动作；题干和期望答案不会在这里展示。",
      loading: "正在读取评测看板..."
    },

    apiDocsPanel: {
      title: "API 文档",
      note: "第三方系统只需要看这里：接口、字段、状态码、反馈契约和最小代码示例。",
      briefAction: "复制接入说明",
      endpointsTitle: "接口清单",
      queryEndpoint: "问答接口",
      contractEndpoint: "契约接口",
      feedbackEndpoint: "反馈接口"
    },

    queryRuntime: {
      questionLabel: "问题",
      runAction: "查询",
      running: "正在调用 Query Runtime...",
      emptyQuestion: "请先输入一个问题。",
      statusLabel: "状态",
      runtimeLabel: "运行时",
      durationLabel: "耗时",
      citationsLabel: "引用",
      citationsUnit: "条",
      answerTitle: "回答",
      sourcesTitle: "引用来源",
      resultAnswered: "已返回可靠答案",
      resultNoAnswer: "暂时不能回答",
      resultError: "需要处理",
      feedbackTitle: "这次结果有帮助吗？",
      feedbackBody: "反馈会写入当前知识库；引用不对和回答漏点会进入问答反馈待复核。"
    },
    maintenancePanel: {
      title: "诊断导出",
      note: "检查本地服务、最近任务、更新通道和云端元数据契约。问答反馈和资料维护已拆到独立页面。",
      loading: "正在检查诊断状态...",
      exportAction: "导出诊断 JSON"
    },
    welcome: {
      title: "把资料变成可验证、可追溯、可维护的知识库",
      titlePrefix: "构建",
      titleAccent: "可验证",
      titleSuffix: "知识资产",
      lead: "KnowMesh 面向本地运行和开源协作，把资料、处理过程、质量检查、引用和版本放进一条可追踪链路。",
      headerConsole: "进入控制台",
      noKnowledgeBase: "还没有知识库",
      workspaceLabel: "当前知识库",
      footerLinks: ["Open Source (MIT)", "Documentation", "GitHub", "Community", "Changelog"],
      statusLabel: "当前状态",
      nextStepLabel: "下一步",
      licenseLabel: "开源协议",
      states: {
        empty: "先创建一个知识库。每个知识库都有独立配置、任务、日志和资产。",
        draft: "这个知识库还没完成配置，可以继续配置或切换到其它知识库。",
        configured: "配置已保存，可以继续生成知识库。",
        running: "当前有任务正在执行，可以查看实时进度。",
        paused: "任务已暂停，可以进入任务页恢复。",
        failed: "最近任务需要处理，进入任务页查看原因并重试。",
        ready: "知识库已可用，可以提问测试、接入应用或维护资料。"
      },
      actions: {
        create: "新建知识库",
        manage: "管理知识库",
        openConsole: "进入控制台",
        openTask: "查看任务",
        fixTask: "处理任务问题",
        continueBuild: "继续生成知识库",
        editSetup: "修改配置",
        continueSetup: "继续配置",
        ask: "提问测试",
        integrate: "接入应用",
        maintainDocuments: "维护资料"
      },
      architectureTitle: "不是普通向量库导入工具",
      architectureLead: "KnowMesh 把通用流程、行业增强和质量约束拆开，让普通用户能用，也让技术用户能扩展。",
      architectureSummary: "通用引擎负责稳定处理，专家策略增强行业理解，质量门禁决定哪些内容可以写入知识库。",
      architecture: [
        ["SOURCE", "Source Files", "PDF、Word、Excel、Markdown、TXT、图片和扫描资料。"],
        ["CORE", "KnowMesh Core", "扫描、抽取、OCR、清洗、分片、向量化、写入和恢复。"],
        ["EXPERT", "KnowMesh Expert", "模板策略和少量行业处理器增强 K12、法律、客服等行业语义。"],
        ["QUALITY", "Quality Gates", "低置信度、缺引用和范围不匹配的内容不会悄悄进入结果。"],
        ["TRACE", "Traceable Knowledge", "答案能回到文件、页码、章节或原文片段。"],
        ["VERSION", "Versioned Knowledge", "资料更新、排除、恢复和重建都有版本记录。"],
        ["ASSETS", "Knowledge Assets", "向量索引、元数据、来源映射和版本历史一起形成知识资产。"]
      ],
      openSourceText: "MIT License"
    },
    nav: {
      overview: "总览",
      "knowledge-bases": "知识库管理",
      build: "扫描与计划",
      execution: "执行任务",
      ask: "提问测试",
      integration: "接入向导",
      "api-docs": "API 文档",
      feedback: "反馈记录",
      documents: "资料资产",
      "document-asset": "资料全文",
      versions: "版本记录",
      evaluation: "评测看板",
      "feedback-review": "问答反馈",
      maintenance: "诊断导出",
      settings: "配置"
    },
    navGroups: {
      overview: "总览",
      "build-workflow": "生成知识库",
      "use-knowledge": "使用知识库",
      "maintain-knowledge": "维护知识库",
      settings: "配置"
    },
    setup: {
      title: "搭建向导",
      step: "步骤",
      locked: "先完成上一项",
      previous: "上一步",
      testCurrent: "测试当前步骤",
      testConnection: "测试连接",
      testCredential: "测试凭证",
      saveCredential: "保存",
      doneNext: "继续",
      finish: "进入控制台",
      currentOperation: "当前操作",
      planEmpty: {
        title: "先生成本次计划",
        body: "KnowMesh 会按当前资料范围、运行方式和已保存配置，判断现在能不能开始处理。",
        items: [
          "没有红色问题才可以继续",
          "正式执行前会再次确认上传和写入",
          "配置变化后需要重新生成"
        ]
      },
      hintBadge: "提示",
      whyThisStep: "为什么需要这一步",
      draftSaved: "已保存到本机。",
      draftSaving: "正在保存...",
      draftLocal: "已保存在本机浏览器。",
      selectPlaceholder: "请选择",
      multiSelectHint: "可多选",
      chooseStageFirst: "先选择学段后，再选择学科、年级和册别。",
      selectAll: "全选",
      clearSelection: "清空",
      sourceScope: {
        statusMissing: "还差：{fields}",
        statusReady: "已选择：{stages} · {subjects} 个学科 · {grades} 个年级",
        none: "未选择",
        requiredHint: "学段、学科和年级都选好后才能继续。",
        steps: {
          stage: {
            title: "先选学段",
            desc: "可以选小学、初中、高中，也可以一次选择全学段。"
          },
          subject: {
            title: "再选学科",
            desc: "学科会按已选学段自动过滤，不显示不适用的科目。"
          },
          grade: {
            title: "最后选年级",
            desc: "年级会按已选学段自动过滤。"
          }
        },
        allStages: "全学段",
        allSubjects: "全科目",
        coreSubjects: "语数英",
        scienceSubjects: "理科",
        humanitiesSubjects: "文科",
        artsSubjects: "艺体",
        allGrades: "全部年级",
        allVolumes: "全部册别",
        extraTitle: "补充信息",
        extraNote: "可选，用于后续引用和筛选。"
      },
      folderPicker: {
        source: "选择目录",
        workspace: "选择目录",
        working: "正在打开系统目录选择...",
        selected: "已选择目录",
        canceled: "没有选择目录，可以继续手动粘贴路径。",
        unavailable: "没有打开系统目录选择框，请直接粘贴路径。"
      },
      folderBrowser: {
        sourceTitle: "选择资料文件夹",
        workspaceTitle: "选择工作目录",
        sourceBody: "默认使用项目根目录下的 source，也可以选择其它资料目录。",
        workspaceBody: "默认使用项目根目录下的 workspace，也可以选择其它工作目录。",
        choose: "选择文件夹",
        pasteLabel: "也可以粘贴路径",
        usePath: "使用路径",
        dropUnavailable: "浏览器不能读取拖入目录的完整本机路径，请点击“选择文件夹”或粘贴路径。"
      },
      supportTitle: "辅助说明",
      modeChoiceTitle: "选择后会影响后续步骤",
      currentChoice: "已选择",
      modePrepareLabel: "需要准备",
      modeNextLabel: "下一步",
      templateChoice: {
        nextLabel: "下一步",
        next: "选择资料目录和工作目录。",
        guardLabel: "提示",
        guard: "这里只保存模板选择，不扫描、不上传资料。"
      },
      modeResultAliyun: "连接阿里云账号，先检查账号和保存位置。",
      modeResultLocal: "选择模板和资料目录，再检查本机处理能力。",
      storage: {
        sourceBadge: "资料",
        sourceTitle: "资料保存空间",
        sourceBody: "选择原始资料和处理文件保存到哪个普通 OSS Bucket。",
        searchBadge: "检索",
        searchTitle: "OSS 向量 Bucket",
        searchBody: "用于保存向量索引和向量数据。默认和资料同地域；需要分区、合规或成本隔离时，可以单独设置。",
        hintBadge: "提示",
        hintTitle: "名称建议",
        hintBody: "资料 Bucket 最长 63 位；OSS 向量 Bucket 最长 32 位。名称只能用小写字母、数字和连字符。",
        generateName: "生成名称"
      },
      modelProvider: {
        badge: "当前操作",
        title: "连接模型服务",
        body: "先验证模型服务是否可用。通过后，再选择 OCR、整理、向量化和重排模型。",
        accessTitle: "模型服务连接",
        accessBody: "填写阿里百炼 API Key，并确认当前地域和接口地址可以正常连接。",
        keyTitle: "API Key 只保存在本机",
        keyBody: "页面只会用于检测连接和后续模型调用，不会把 Key 写入资料内容。",
        keyPathLabel: "本机安全凭证",
        workspaceTip: "新加坡或德国地域需要 Workspace ID；中国内地默认使用公共 Base URL。",
        hintBadge: "提示"
      },
      search: {
        badge: "当前操作",
        title: "确认知识库索引",
        body: "填写索引名称，确认后续知识片段会写入哪个索引。这里不会写入知识库。",
        indexTitle: "设置这次使用的索引",
        indexBody: "建议用资料类型、版本或项目名命名，后续升级或重建时更容易区分。",
        modelNoteBadge: "提示",
        modelNoteTitle: "沿用模型配置",
        modelNoteBody: "索引会和上一步确认的向量化模型保持一致。真正写入前，会先展示过滤报告、写入位置和影响范围。",
        guardBadge: "安全边界",
        guardTitle: "现在不会写入",
        guardBody: "本页只保存索引配置，不上传资料、不生成向量、不调用模型。"
      },
      modelQuality: {
        badge: "当前操作",
        title: "选择模型与质量方案",
        body: "先选择质量倾向，再确认各环节使用的当前可用模型。",
        contextUnset: "待确认",
        profileTitle: "选择处理质量",
        profileBody: "KnowMesh 会根据方案填入模型组合，你仍然可以逐项调整。",
        fieldsTitle: "确认模型",
        fieldsBody: "只展示当前推荐或可用模型；旧模型不会作为推荐项。",
        refreshModels: "刷新模型列表",
        catalogBuiltIn: "模型列表：本地推荐",
        catalogSyncing: "模型列表：同步中",
        catalogOfficial: "模型列表：已同步",
        catalogFallback: "模型列表：本地推荐",
        catalogHelp: "打开本页时会自动尝试同步官方模型列表；如果暂时无法连接，就使用本机内置推荐。",
        modelDetail: "模型详情",
        modelPrice: "价格",
        hintBadge: "提示",
        hintTitle: "正式执行前还会再确认",
        hintBody: "模型方案只保存配置。真正 OCR、整理、向量化或重排前，KnowMesh 会展示处理数量、使用模型和费用预估。",
        recommendedFit: "适合大多数资料",
        highQualityFit: "扫描页和复杂内容更多",
        lowCostFit: "先用小样本试跑"
      },
      retrievalStrategy: {
        badge: "当前操作",
        title: "选择问答效果策略",
        body: "选择用户提问时怎么找资料、怎么排序、怎么给引用。普通用户选一个方案即可。",
        profileTitle: "选择效果倾向",
        profileBody: "策略会影响后续问答的命中率、引用严格度、速度和模型调用次数。",
        methodsTitle: "会启用什么",
        methodsBody: "这些是策略明细，普通用户不用逐项配置。",
        advancedTitle: "策略明细",
        hintBadge: "提示",
        hintTitle: "正式问答时才会使用",
        hintBody: "本页只保存策略。真正问答时，KnowMesh 会按这套策略检索资料、重排候选片段，并要求答案带来源。"
      },
      accountCheckLoading: "正在检测本机阿里云配置...",
      accountCheckPass: "已检测到可用配置。可以继续检查账号。",
      accountCheckFail: "没有检测到可用配置。请改为填写本机凭证。",
      accountContinuePermissions: "继续检查账号",
      accountContinueCredential: "去填写凭证",
      accountGuide: {
        badge: "创建指引",
        title: "先创建一个专用 RAM 用户",
        body: "不要使用主账号密钥。创建专用用户后，回到 KnowMesh 填写 AccessKey，并继续做只读身份验证。",
        steps: [
          "打开阿里云 RAM 用户页面，创建只给 KnowMesh 使用的用户。",
          "为这个用户创建 AccessKey，并只授予后续保存资料、检索和智能服务需要的权限。",
          "创建完成后回到这里，进入本机凭证页填写 AccessKey。"
        ],
        openRam: "打开阿里云 RAM",
        continue: "已创建，去保存凭证"
      },
      credentialCurrent: "当前选择",
      credentialCurrentMethod: "使用专用 RAM 用户",
      credentialRequiredTitle: "填写这两项",
      credentialRequiredBody: "从阿里云 RAM 用户的 AccessKey 页面复制 ID 和 Secret。先测试连接，测试通过后再保存到本机。",
      credentialAdvanced: "高级保存方式",
      credentialAdvancedNote: "默认保存到本机安全凭证。需要命令行或其它工具复用时，可以同时写入项目 .env 文件。",
      credentialSecurePathLabel: "默认保存到本机安全凭证",
      credentialEnvPathLabel: "项目 .env 文件",
      credentialEnvCopy: "同时写入项目 .env 文件",
      credentialSecurityLabel: "保护方式",
      copyPath: "复制路径",
      openDirectory: "打开目录",
      pathCopied: "路径已复制",
      pathCopyFailed: "没有复制成功，请手动选择路径复制。",
      pathOpenStarted: "已打开本地目录",
      pathOpenFailed: "没有打开目录，请按路径手动查看。",
      dialogCancel: "取消",
      dialogConfirm: "确定",
      credentialHelp: {
        sourceTitle: "从哪里复制？",
        sourceBody: "在阿里云 RAM 控制台打开专用用户，为它创建 AccessKey，然后把 ID 和 Secret 粘贴到左侧。",
        rootTitle: "不要用主账号",
        rootBody: "主账号权限太大，后续也不方便单独停用或轮换。专用 RAM 用户更安全。",
        testTitle: "测试会做什么？",
        testBody: "KnowMesh 会先连接阿里云身份服务确认凭证可用。测试通过后，由你决定是否保存到本机。"
      },
      permissionCheck: {
        badge: "当前操作",
        title: "检查阿里云账号是否可用",
        body: "KnowMesh 会先确认这个账号能连接阿里云、身份适合使用，并具备读取保存空间的基础权限。后续创建资源和调用服务，会在对应步骤再确认。",
        statusPending: "待检查",
        scopeTitle: "会检查",
        scope: [
          {
            key: "identity",
            title: "阿里云连接",
            body: "能连接并识别当前账号"
          },
          {
            key: "ram",
            title: "专用 RAM 用户",
            body: "不是主账号，便于单独授权"
          },
          {
            key: "storage",
            title: "保存空间读取",
            body: "能读取 OSS 保存空间列表"
          }
        ],
        fixBadge: "提示",
        fixTitle: "检查未通过时",
        fixBody: "按结果处理 RAM 用户或 OSS 读取权限；需要补权限时可生成清单，到阿里云 RAM 补齐后再回来检查。",
        ramLink: "打开 RAM 控制台"
      },
      taskBriefLabels: {
        focus: "本页完成",
        next: "接下来",
        guard: "安全边界"
      },
      actionGuideLabels: {
        prepare: "你需要准备",
        check: "系统会检查",
        fix: "失败后处理"
      },
      summary: {
        mode: "运行方式",
        template: "模板",
        source: "资料目录",
        workspace: "工作目录",
        step: "本步状态",
        empty: "未选择",
        pending: "待确认",
        confirmed: "已确认"
      },
      groups: {
        mode: {
          label: "运行方式",
          description: "选择阿里云或本地"
        },
        aliyun: {
          label: "阿里云配置",
          description: "账号、凭证、权限和云资源"
        },
        source: {
          label: "模板与资料",
          description: "模板、资料目录和工作目录"
        },
        environment: {
          label: "处理前检查",
          description: "确认可以开始扫描"
        },
        scan: {
          label: "扫描预览",
          description: "只读扫描资料目录"
        },
        plan: {
          label: "开始前确认",
          description: "确认现在能否开始"
        },
        finish: {
          label: "完成",
          description: "进入完整控制台"
        }
      },
      steps: {
        mode: {
          label: "选择运行方式",
          title: "选择资料处理方式",
          lead: "这会决定后面需要连接哪些服务，以及资料在哪里完成识别、清洗和检索。",
          cards: [
            [
              "阿里云模式",
              "适合大批量资料和长期使用",
              "资料会放到你的阿里云资源中，KnowMesh 会先检查账号、保存位置，再在后续步骤确认识别和检索服务。适合教材、制度、报告等资料较多，希望稳定跑完整流程的场景。",
              "推荐",
              "需要准备",
              "阿里云账号、OSS Bucket 或允许 KnowMesh 引导创建、访问凭证。",
              "下一步",
              "连接阿里云账号，先检查账号和保存位置。",
              "选择阿里云模式"
            ],
            [
              "本地模式",
              "适合先试跑或资料不出本机",
              "只使用本机文件和本地处理流程，不连接云端账号。适合先用少量资料验证效果，或资料暂时不方便上传的场景。",
              "本机",
              "需要准备",
              "本机磁盘空间，以及后续检测到的 OCR、向量化处理能力。",
              "下一步",
              "选择模板和资料目录，再检查本机处理能力。",
              "选择本地模式"
            ],
            ["放心选择", "涉及上传、创建资源或写入数据的动作，都会在执行前再次确认。", "提示"]
          ]
        },
        "aliyun-account": {
          label: "连接阿里云",
          title: "你准备用哪个阿里云账号？",
          lead: "选择你现在最容易完成的连接方式。推荐使用专用 RAM 用户，后续更安全、也更容易停用或更换。",
          cards: [
            [
              "使用专用 RAM 用户",
              "适合正式搭建知识库",
              "推荐为 KnowMesh 准备一个单独的 RAM 用户。权限清楚，后续可单独停用、轮换或删除。",
              "推荐",
              "你需要准备",
              "一个只给 KnowMesh 使用的 RAM 用户和 AccessKey。",
              "接下来会做什么",
              "先测试连接，测试通过后再保存凭证。",
              "使用专用 RAM 用户"
            ],
            [
              "检测本机配置",
              "适合已经配置过阿里云工具的用户",
              "如果本机已有环境变量或配置文件，KnowMesh 会优先检测现有连接，减少重复粘贴密钥。",
              "已有配置",
              "你需要准备",
              "本机已经配置过可用的阿里云环境变量或配置文件。",
              "接下来会做什么",
              "先检测现有连接，检测失败再填写 AccessKey。",
              "检测本机配置"
            ],
            [
              "查看创建指引",
              "适合第一次配置阿里云的用户",
              "如果还没有可用账号，先按指引创建专用 RAM 用户，并复制最小权限策略。",
              "新手",
              "你需要准备",
              "一个阿里云账号，并按指引创建专用 RAM 用户。",
              "接下来会做什么",
              "创建完成后回到这里填写 AccessKey 并测试连接。",
              "查看创建指引"
            ]
          ]
        },
        "aliyun-credential": {
          label: "保存凭证",
          title: "填写阿里云连接凭证",
          lead: "粘贴专用 RAM 用户的 AccessKey。先测试能否连接阿里云，测试通过后再保存到本机。",
          cards: [
            ["本机保存", "优先使用本机安全凭证，也可选择 .env 或已有环境变量。", "本机"],
            ["不回显密钥", "返回页面时不会重新显示密钥明文。", "安全"],
            ["可更换", "后续可以重新连接或清除凭证。", "可控"]
          ]
        },
        "aliyun-permissions": {
          label: "检查账号",
          title: "检查阿里云账号是否可用",
          lead: "只读确认这个账号能连接阿里云、不是主账号，并能读取 OSS 保存空间列表。",
          cards: [
            ["阿里云连接", "确认 AccessKey 能连接并识别当前账号。", "必过"],
            ["专用 RAM 用户", "确认不是主账号，后续可以单独授权和轮换。", "必过"],
            ["保存空间读取", "确认可以读取 OSS 保存空间列表。", "必过"]
          ]
        },
        "aliyun-storage": {
          label: "保存位置",
          title: "配置云端保存位置",
          lead: "选择资料和检索内容放在哪个地域、哪个 Bucket。默认同一地域；需要分区时可单独设置检索/向量位置。",
          cards: [
            ["资料 Bucket", "保存原始资料和处理中间文件。", "必填"],
            ["OSS 向量 Bucket", "保存后续向量索引和向量数据。", "默认同区"],
            ["检查并确认", "检查通过后会弹出确认，完成创建或保存后才能继续。", "保护"]
          ]
        },
        "aliyun-search": {
          label: "知识检索",
          title: "设置知识库索引",
          lead: "保存位置和模型与质量方案已经在上一步确认。这里设置索引名称，用来区分不同知识库或版本。",
          cards: [
            ["索引名称", "用于区分不同知识库或版本。", "必填"],
            ["模型关系", "索引会和上一步确认的向量模型保持一致。", "检查"],
            ["先预览", "写入前必须先确认过滤报告和开始前计划。", "保护"]
          ]
        },
        "aliyun-services": {
          label: "模型服务",
          title: "连接阿里百炼",
          lead: "先把模型服务接通，再选择 OCR、内容整理、向量化和重排模型。",
          cards: [
            ["阿里百炼", "默认使用阿里百炼，后续再扩展其它供应商。", "默认"],
            ["OpenAI 兼容", "优先用兼容接口，后续接入成本低。", "推荐"],
            ["本机保存", "API Key 只用于本机检测和后续模型调用。", "安全"]
          ]
        },
        "aliyun-model-quality": {
          label: "模型方案",
          title: "模型与质量方案",
          lead: "选择这次知识库的处理质量，再确认 OCR、内容整理、向量化和可选重排模型。",
          cards: [
            ["推荐配置", "适合 K12 教材、制度、报告等多数资料。", "推荐"],
            ["高质量配置", "更适合扫描页、公式、表格和复杂章节。", "质量"],
            ["低成本配置", "适合先用少量资料试跑。", "成本"]
          ]
        },
        retrieval: {
          label: "问答效果",
          title: "问答效果策略",
          lead: "选择用户提问时怎么找到正确资料、怎么排序证据，以及找不到来源时怎么处理。",
          cards: [
            ["稳健推荐", "适合正式知识库默认使用", "推荐"],
            ["覆盖优先", "适合问法不固定或资料口径复杂", "召回"],
            ["精确引用", "适合教材、制度、合规和可追溯回答", "严谨"],
            ["低成本试跑", "适合先用少量资料验证效果", "试跑"]
          ]
        },
        template: {
          label: "选择模板",
          title: "选择资料整理模板",
          lead: "模板会自动带出适合这类资料的字段、整理规则、分段方式和验证问题。",
          cards: [
            ["K12 教材", "适合已有教材目录和页码引用。", "推荐"],
            ["通用文档", "适合 Office、WPS、PDF、图片和文本类资料。", "通用"],
            ["可审计", "模板会保留扫描、整理、引用和确认记录。", "规则"]
          ]
        },
        project: {
          label: "选择资料目录",
          title: "选择资料目录和保存位置",
          modes: {
            aliyun: {
              lead: "阿里云模式需要资料路径、工作目录、阿里云保存位置、检索库和智能服务配置。",
              cards: [
                ["资料目录", "选择原始文件目录，KnowMesh 只读扫描。", "路径"],
                ["阿里云设置", "配置保存位置、知识库索引和相关连接信息。", "阿里云"],
                ["服务密钥", "只检查密钥状态，不在页面展示明文。", "安全"]
              ]
            },
            local: {
              lead: "本地模式只需要资料路径、工作目录和本地处理策略。",
              cards: [
                ["资料目录", "选择原始文件目录，KnowMesh 只读扫描。", "路径"],
                ["工作目录", "生成数据写入独立目录，便于清理和回滚。", "本地"],
                ["处理策略", "配置资料整理、分段、引用和问答效果检查，不要求云服务。", "本地"]
              ]
            }
          }
        },
        environment: {
          label: "处理前检查",
          title: "开始扫描前检查",
          modes: {
            aliyun: {
              lead: "确认资料目录、工作目录、资料范围、云端保存位置、模型服务和知识检索是否已经可以进入扫描预览。",
              cards: [
                ["目录可用性", "资料目录可读、工作目录可写。", "必需"],
                ["资料范围", "学段、学科和年级已经选好。", "必需"],
                ["阿里云配置", "保存位置、模型服务和知识检索已经保存。", "云端"]
              ]
            },
            local: {
              lead: "确认资料目录、工作目录和资料范围是否已经可以进入扫描预览。本地模式不会检查云端配置。",
              cards: [
                ["目录可用性", "资料目录可读、工作目录可写。", "必需"],
                ["资料范围", "学段、学科和年级已经选好。", "必需"],
                ["文件识别", "Office、WPS、PDF、图片和文本类资料可只读扫描。", "本地"]
              ]
            }
          }
        },
        scan: {
          label: "扫描资料",
          title: "扫描并预览资料",
          lead: "先预览已选择目录中的文件、分卷、缺失项和风险，不直接生成联网结果。",
          cards: [
            ["文件识别", "识别 Office、WPS、PDF、图片和文本类资料。", "扫描"],
            ["分卷归并", ".pdf.1、.pdf.2 会作为同一本资料处理。", "规则"],
            ["风险预览", "展示过大文件、缺失页和无法读取项。", "检查"]
          ]
        },
        plan: {
          label: "预览执行内容",
          title: "确认执行前预览",
          lead: "执行前先展示步骤、联网动作、费用预估、需要确认的事项和可回滚性。",
          cards: [
            ["步骤", "展示每一项处理动作和执行顺序。", "预览"],
            ["费用", "调用智能服务前展示服务、规模和费用预估。", "透明"],
            ["确认", "上传、OCR、生成检索数据和写入知识库会在正式执行前再次确认。", "保护"]
          ]
        },
        finish: {
          label: "完成",
          title: "准备好了，可以开始使用",
          lead: "现在可以进入完整控制台，后续页面会按已选模式继续工作。",
          cards: [
            ["控制台", "总览、扫描、构建、执行、问答和维护会完整开放。", "解锁"],
            ["继续可改", "模式、模板和配置仍可在控制台里调整。", "可改"],
            ["安全不变", "联网动作和写入动作仍需要二次确认。", "保护"]
          ]
        }
      }
    },
    console: {
      buildWorkflow: {
        routeSteps: [
          ["01", "扫描资料", "只读检查目录"],
          ["02", "生成计划", "确认写入前动作"],
          ["03", "执行任务", "创建后进入执行页"]
        ],
        scanTitle: "扫描资料",
        scanBody: "只读扫描资料目录，确认文件、分卷、格式和需要处理的问题。",
        planTitle: "生成开始前计划",
        planBody: "按当前配置生成执行步骤，确认没有必须处理的问题后再创建任务。",
        scanPendingTitle: "还没有扫描",
        scanPendingBody: "先扫描资料目录，结果会保留在本机浏览器中。",
        scanDoneTitle: "已扫描",
        scanDoneBody: "已有扫描结果，不需要重复扫描；修改配置后再重新扫描。",
        scanIssueTitle: "扫描需要处理",
        scanIssueBody: "查看结果并处理问题，处理后再重新扫描。",
        scanRerun: "重新扫描",
        scanOpen: "查看扫描",
        planPendingTitle: "还没有计划",
        planPendingBody: "扫描通过后生成计划，确认本次执行会做什么。",
        planDoneTitle: "计划已生成",
        planDoneBody: "已有计划结果，不需要重复生成；可以查看计划并创建任务。",
        planIssueTitle: "计划需要处理",
        planIssueBody: "查看结果并处理阻塞项，处理后再重新生成。",
        planRerun: "重新生成计划",
        planOpen: "查看计划",
        createTask: "创建任务",
        createTaskLoading: "正在创建任务..."
      },
      pages: {
        overview: {
          eyebrow: "控制台",
          title: "开始生成知识库",
          lead: "按顺序完成扫描、计划和任务执行。需要改模式、密钥、模板或目录时，随时回到配置流程。",
          primary: "生成知识库",
          secondary: "修改配置",
          cards: [
            ["1", "扫描资料", "先只读扫描目录，确认文件数量、格式、分卷和不可处理项。"],
            ["2", "生成计划", "按当前配置生成执行步骤，确认 OCR、分片、向量化和写入动作。"],
            ["3", "执行任务", "创建任务后再逐步执行，可暂停、继续或终止。"]
          ]
        },
        "knowledge-bases": {
          eyebrow: "知识库管理",
          title: "管理知识库",
          lead: "切换、继续生成或修改不同知识库。每个知识库的配置、任务和本地产物互相独立。",
          primary: "新建知识库",
          secondary: "继续生成"
        },
        build: {
          eyebrow: "生成知识库",
          title: "从扫描到创建任务",
          lead: "先扫描资料，再生成执行计划。没有必须处理的问题后，创建任务并进入执行页。",
          primary: "扫描资料",
          secondary: "生成计划",
          cards: [
            ["扫描", "只读检查目录，不上传、不写入。", "第一步"],
            ["计划", "展示 OCR、清洗、分片、向量化、索引和写入步骤。", "第二步"],
            ["任务", "创建任务后再开始执行，期间可暂停或终止。", "第三步"]
          ]
        },
        execution: {
          eyebrow: "任务执行",
          title: "执行知识库任务",
          lead: "查看最新任务，按步骤运行、暂停、继续或终止。失败后保留原因，方便定位和重试。",
          primary: "查看任务",
          secondary: "失败重试"
        },
        documents: {
          eyebrow: "资料资产",
          title: "维护资料资产",
          lead: "查看当前知识库包含哪些原始资料，打开处理后的全文、定位原文件，并排除暂时不想处理的资料。",
          primary: "检查资料变化",
          secondary: "排除资料"
        },
        "document-asset": {
          eyebrow: "资料资产",
          title: "查看资料全文",
          lead: "按页查看这份资料处理后的文本、分片、引用状态和来源文件。",
          primary: "返回资料资产",
          secondary: "定位文件"
        },
        versions: {
          eyebrow: "版本维护",
          title: "查看知识库版本",
          lead: "查看当前知识库已经生成过哪些版本、当前生效版本、写入位置和 Sidecar 状态。",
          primary: "刷新版本",
          secondary: "查看产物"
        },
        evaluation: {
          eyebrow: "评测维护",
          title: "查看评测闭环",
          lead: "查看当前知识库评测覆盖、通过率、失败类别和下一步维护动作。",
          primary: "刷新评测",
          secondary: "处理失败"
        },
        integration: {
          eyebrow: "接入使用",
          title: "把知识库接入你的应用",
          lead: "复制当前知识库接口，并用同一运行时测试外部应用会拿到的答案和引用。",
          primary: "复制接口",
          secondary: "查看示例"
        },
        "api-docs": {
          eyebrow: "接入使用",
          title: "API 文档",
          lead: "给业务系统接入当前知识库时使用的请求、响应、错误和反馈契约。",
          primary: "复制说明",
          secondary: "返回接入"
        },
        ask: {
          eyebrow: "使用知识库",
          title: "提问测试",
          lead: "用真实问题检查当前知识库的回答、引用和来源。这里和外部应用调用同一个 Query Runtime。",
          primary: "开始提问",
          secondary: "查看反馈"
        },
        feedback: {
          eyebrow: "使用知识库",
          title: "反馈记录",
          lead: "查看反馈概况；需要处理的引用错误和回答漏点在维护页集中处理。",
          primary: "查看反馈",
          secondary: "处理反馈"
        },
        "feedback-review": {
          eyebrow: "质量维护",
          title: "处理问答反馈",
          lead: "集中处理引用不对、回答漏点等反馈。处理记录会按当前知识库保存，方便后续改进资料和版本。",
          primary: "查看反馈",
          secondary: "回到提问"
        },
        maintenance: {
          eyebrow: "诊断导出",
          title: "检查服务与契约",
          lead: "检查本地服务、版本、最近任务、更新通道和云端元数据契约。问答反馈在单独页面处理。",
          primary: "检查状态",
          secondary: "预览更新"
        }
      }
    }
  },
  en: {
    app: {
      subtitle: "Local Knowledge Builder",
      service: "Local Service",
      currentMode: "Current Mode",
      currentTemplate: "Current Template",
      recommended: "Recommended",
      builtIn: "Built-in",
      requiredFields: "Required Fields",
      fields: "Fields",
      required: "Required",
      optional: "Optional",
      filterPolicy: "Filter Policy",
      templateContract: "Template Strategy",
      searchContract: "Search Fields",
      citationContract: "Citation Fields",
      filterContract: "Question Filters",
      sidecarContract: "Aliyun Storage",
      templateLibraryVersion: "Template Library",
      currentTemplateVersion: "Current Template",
      chunkingStrategy: "Chunking",
      qualityGates: "Quality Gates",
      pitfalls: "Pitfalls",
      acceptanceCriteria: "Acceptance",
      defaultSource: "Suggested Source",
      language: "Language",
      theme: "Theme",
      sidebar: "Collapse menu",
      expandSidebar: "Expand menu",
      editSetup: "Edit Setup",
      dark: "Dark",
      light: "Light"
    },
    modes: {
      aliyun: {
        label: "Aliyun Mode",
        short: "Aliyun",
        description: "Default mode using Aliyun to save sources, organize content, and support knowledge search."
      },
      local: {
        label: "Local Mode",
        short: "Local",
        description: "Uses local files and local flow only; no cloud service key required."
      }
    },
    jobs: {
      latest: {
        badge: "Current Job",
        title: "Run Job",
        note: "After a job is created, this page shows each step, log, and result.",
        create: "Start Task Creation",
        openPlan: "View Build Plan",
        emptyTitle: "No job yet",
        emptyBody: "After a job is created, this page shows scanning, cleaning, chunking, embedding, and write progress.",
        nextTitle: "Next Step",
        nextBody: "Go to Build, finish scan and plan, then choose Create Task. After creation, KnowMesh opens this page automatically.",
        emptySteps: [
          ["Scan Sources", "Confirm file scope and processable content."],
          ["Organize Content", "Clean, chunk, and prepare indexes with the selected template."],
          ["Write Knowledge Base", "Confirm risks before running, then validate answers after the full run."]
        ],
        refresh: "Refresh",
        test: "Test Current Step",
        ask: "Ask & Test",
        artifacts: "View Local Outputs",
        statusLoading: "Loading job",
        statusBody: "After loading, only actions available for the current state stay visible.",
        advance: "Advance Next Step",
        retry: "Retry Current Step",
        run: "Run Remaining",
        pause: "Pause Job",
        resume: "Resume Job",
        stop: "Stop Job",
        pauseConfirmTitle: "Pause this job?",
        pauseConfirmBody: "KnowMesh will finish the current running step, then stop before continuing. Completed progress is kept and can be resumed later.",
        stopConfirmTitle: "Stop this job?",
        stopConfirmBody: "Waiting or running steps will not continue. Generated local files remain, but this job cannot be resumed.",
        advanceLoading: "Advancing job...",
        runLoading: "Running remaining steps...",
        pauseLoading: "Pausing job...",
        resumeLoading: "Resuming job...",
        stopLoading: "Stopping job...",
        testLoading: "Testing current step...",
        loading: "Loading job..."
      }
    },

    knowledgeBases: {
      title: "Knowledge Bases",
      lead: "Each knowledge base keeps its own setup, jobs, versions, and review queue. Switch before maintaining that knowledge base.",
      current: "Current Knowledge Base",
      latestJob: "Latest Job",
      noJob: "No task yet",
      source: "Source Folder",
      noSource: "No source folder",
      emptyTitle: "Create a knowledge base first",
      emptyBody: "Each knowledge base keeps its own setup and tasks. Create one before opening the guide.",
      create: "New Knowledge Base",
      switch: "Switch",
      currentBadge: "Current",
      promptTitle: "New Knowledge Base",
      promptBody: "Name this knowledge base so it is easy to recognize later.",
      promptPlaceholder: "Example: Elementary math textbooks",
      creating: "Creating knowledge base...",
      created: "Knowledge base created. Continue setup.",
      switched: "Knowledge base switched.",
      manage: "Manage",
      contextLabel: "Current Knowledge Base",
      switchContext: "Switch Knowledge Base",
      continueBuild: "Continue Build",
      openTask: "Open Task",
      validate: "Ask and Test",
      editSetup: "Edit Setup",
      workspace: "Work Folder",
      noWorkspace: "No work folder",
      template: "Template",
      status: "Status"
    },

    documentsPanel: {
      title: "Source Assets",
      lead: "Review source documents, processed pages, chunks, and citation state for the current knowledge base. Exclude or restore changes apply on the next run.",
      loading: "Loading documents...",
      check: "Check Changes",
      search: "Search documents",
      all: "All",
      included: "Included",
      excluded: "Excluded",
      attention: "Needs Attention",
      emptyTitle: "No document list yet",
      emptyBody: "Configure a source folder or run a scan first.",
      total: "Total Sources",
      source: "Source Path",
      type: "Type",
      status: "Status",
      actionExclude: "Exclude",
      actionRestore: "Restore",
      confirmExcludeTitle: "Exclude this document?",
      confirmExcludeBody: "Excluded files will not enter the next scan, cleaning, embedding, or write run. Existing versions are not removed immediately; changes apply after rerun.",
      confirmRestoreTitle: "Restore this document?",
      confirmRestoreBody: "Restored files will enter future runs for this knowledge base. Check source changes before continuing the task.",
      excludedByUser: "Excluded by user",
      includedStatus: "Included",
      added: "Added",
      modified: "Modified",
      missing: "Missing",
      noChanges: "No changes found",
      changes: "Source changes found",
      loadMore: "Load More",
      locate: "Reveal File",
      openAsset: "Open Text",
      assetTitle: "Source Document",
      assetLead: "Read processed text by page, with chunks, citations, and quality state.",
      assetLoading: "Loading document text...",
      assetMissing: "No readable asset was found for this document. Finish the write task or rebuild the knowledge base.",
      backToAssets: "Back to Assets",
      page: "Page",
      pages: "Pages",
      chunks: "Chunks",
      sourceParts: "Source parts",
      activeChunks: "Written chunks",
      reviewChunks: "Review chunks",
      lowScoreChunks: "Low-score chunks",
      pageText: "Page Text",
      pageChunks: "Page Chunks",
      loadMorePages: "Load More Pages",
      noSidecar: "No Sidecar chunks are available yet.",
      sidecarReady: "Sidecar ready",
      moreActions: "More actions",
      menuView: "View",
      menuMaintain: "Maintenance",
      copyPath: "Copy Path",
      pathCopied: "Path copied",
      version: "Version",
      updated: "Last Recorded",
      fingerprint: "Content fingerprint",
      unknown: "Not recorded",
      loaded: "Loaded",
      matched: "Matched",
      locatedFile: "File revealed",
      openedDirectory: "Folder opened",
      locatedSourcePart: "First source part revealed"
    },

    integrationPanel: {
      title: "Integrate and Test This Knowledge Base",
      note: "Copy this knowledge-base endpoint, then test the exact answer, citation, and feedback path your app will use.",
      endpointTitle: "Endpoint",
      endpointBody: "Scoped to the current knowledge base for apps, workflows, scripts, or internal systems.",
      copyEndpoint: "Copy Endpoint",
      copyContractEndpoint: "Copy Contract",
      copyCode: "Copy Code",
      copyCodeFor: "Copy {label}",
      copyBrief: "Copy Integration Brief",
      flowTitle: "Shortest Integration Path",
      flowBody: "Field details and code examples live in API Docs.",
      flowSteps: [
        ["Call Query Runtime", "Send the user's question to the current knowledge-base endpoint."],
        ["Render reliable answers only", "Show answer.text only when ok=true and status=answered."],
        ["Show source citations", "Display the file, page, and excerpt so users can verify the answer."],
        ["Submit feedback", "Useful feedback is positive only; wrong citations and missed points enter Answer Feedback review."]
      ],
      testTitle: "Test Integration",
      testBody: "This calls the same Query Runtime your application will use.",
      questionLabel: "Test Question",
      questionPlaceholder: "Example: What is lesson 1 in unit 3 of grade 5 Chinese?",
      resultAnswered: "Reliable answer returned",
      resultNoAnswer: "No reliable answer yet",
      resultError: "Action needed",
      emptyQuestion: "Enter a test question first.",
      statusLabel: "Status",
      runtimeLabel: "Runtime",
      durationLabel: "Duration",
      citationsLabel: "Citations",
      citationsUnit: "",
      safetyTitle: "Local Access Boundary",
      safetyBody: "KnowMesh listens on 127.0.0.1 by default. Before exposing it to LAN or servers, confirm access control, logs, and secret handling.",
      examplesTitle: "Examples",
      contractTitle: "API Contract",
      contractBody: "External apps only need this contract; local testing and external calls use the same runtime.",
      requestTitle: "Request",
      responseTitle: "Response Fields",
      statusTitle: "Status",
      errorsTitle: "Error Codes",
      feedbackTitle: "Feedback Loop",
      integrationBriefTitle: "Integration Brief for Developers",
      integrationBriefBody: "Copy this into your own integration task.",
      requestFields: [
        ["POST", "Send the request to the current knowledge base Query Runtime endpoint."],
        ["Content-Type", "Use application/json."],
        ["question", "Required. The user's question."],
        ["query", "Optional alias for question; use one of them."]
      ],
      fields: [
        ["ok", "Boolean. true means a reliable answer was returned."],
        ["status", "answered, no_answer, invalid_request, or runtime_error."],
        ["answer.text", "Final answer; returned only when reliable sources are found."],
        ["citations", "Source file, page, excerpt, and maintenance links."],
        ["query.understanding", "Parsed stage, grade, subject, volume, unit, and related intent."],
        ["query.retrieval", "Retrieval scope, hit counts, filtering reasons, and source type."],
        ["feedback.endpoint", "Submit useful, wrong citation, or missed point feedback."]
      ],
      statusFields: [
        ["answered", "Reliable sources were found and an answer was generated."],
        ["no_answer", "No reliable source is available; ask differently or add source material."],
        ["invalid_request", "A required request field is missing, such as an empty question."],
        ["runtime_error", "Model, vector retrieval, Sidecar, or service runtime failed."]
      ],
      errorFields: [
        ["missing_question", "No queryable question was provided."],
        ["runtime_error", "Runtime failed; check error.message and local logs."]
      ],
      feedbackFields: [
        ["POST feedback.endpoint", "Submit feedback into the current knowledge base."],
        ["useful", "Recorded as a positive signal; not sent to review."],
        ["wrong_citation", "Queued for review in Maintenance."],
        ["missed_point", "Queued for review in Maintenance."],
        ["question", "The original question."],
        ["citationIds", "Citation chunk IDs reported by the user."],
        ["citationRefs", "Recommended source title, page, document link, and excerpt for maintenance."],
        ["Answer Feedback", "Use the feedback endpoint or Answer Feedback page to review items that need attention."]
      ]
    },

    askPanel: {
      title: "Ask and Test",
      note: "This page uses the same Query Runtime as third-party integrations. If a result can be retrieved, cited, and fed back here, external apps use the same path.",
      questionLabel: "Question",
      questionPlaceholder: "Example: What is lesson 1 in unit 3 of grade 5 Chinese?"
    },
    feedbackPanel: {
      title: "Feedback Records",
      note: "Review feedback from ask testing and external apps. Items that need action are handled in Maintenance.",
      loading: "Loading feedback records..."
    },
    feedbackReviewPanel: {
      title: "Answer Feedback Maintenance",
      note: "Handle wrong citations and missed points. Resolution records stay with the current knowledge base.",
      loading: "Loading feedback to review..."
    },

    versionRecordsPanel: {
      title: "Version Records",
      note: "Review build versions, the active version, write target, and Sidecar status for this knowledge base.",
      loading: "Loading version records..."
    },
    evaluationDashboardPanel: {
      title: "Evaluation Dashboard",
      note: "Review coverage, failure categories, recent builds, and next actions. Questions and expected answers are not shown here.",
      loading: "Loading evaluation dashboard..."
    },

    apiDocsPanel: {
      title: "API Docs",
      note: "Everything an external system needs: endpoints, fields, statuses, feedback contract, and minimal code examples.",
      briefAction: "Copy Integration Brief",
      endpointsTitle: "Endpoint List",
      queryEndpoint: "Query API",
      contractEndpoint: "Contract API",
      feedbackEndpoint: "Feedback API"
    },

    queryRuntime: {
      questionLabel: "Question",
      runAction: "Query",
      running: "Calling Query Runtime...",
      emptyQuestion: "Enter a question first.",
      statusLabel: "Status",
      runtimeLabel: "Runtime",
      durationLabel: "Duration",
      citationsLabel: "Citations",
      citationsUnit: "",
      answerTitle: "Answer",
      sourcesTitle: "Sources",
      resultAnswered: "Reliable answer returned",
      resultNoAnswer: "No reliable answer yet",
      resultError: "Action needed",
      feedbackTitle: "Was this result useful?",
      feedbackBody: "Feedback is saved to the current knowledge base; wrong citations and missed points enter Answer Feedback review."
    },
    maintenancePanel: {
      title: "Diagnostics Export",
      note: "Check local service, latest job, update channel, and cloud metadata contract. Feedback and source maintenance live on dedicated pages.",
      loading: "Checking maintenance status...",
      exportAction: "Export Diagnostics JSON"
    },
    welcome: {
      title: "Build verifiable, traceable, maintainable knowledge bases",
      titlePrefix: "Build",
      titleAccent: "verifiable",
      titleSuffix: "knowledge assets",
      lead: "KnowMesh is local-first and open-source. It keeps sources, processing, quality checks, citations, and versions in one traceable workflow.",
      headerConsole: "Open Console",
      noKnowledgeBase: "No knowledge base yet",
      workspaceLabel: "Current Workspace",
      footerLinks: ["Open Source (MIT)", "Documentation", "GitHub", "Community", "Changelog"],
      statusLabel: "Current Status",
      nextStepLabel: "Next Step",
      licenseLabel: "License",
      states: {
        empty: "Create a knowledge base first. Each one keeps separate setup, jobs, logs, and assets.",
        draft: "This knowledge base is not configured yet. Continue setup or switch to another one.",
        configured: "Setup is saved. Continue building the knowledge base.",
        running: "A task is running. Open the task page for live progress.",
        paused: "The latest task is paused. Open the task page to resume.",
        failed: "The latest task needs attention. Inspect the reason and retry the step.",
        ready: "This knowledge base is ready. Ask, integrate, or maintain sources."
      },
      actions: {
        create: "Create Knowledge Base",
        manage: "Manage Knowledge Bases",
        openConsole: "Open Console",
        openTask: "View Task",
        fixTask: "Fix Task Issue",
        continueBuild: "Continue Build",
        editSetup: "Edit Setup",
        continueSetup: "Continue Setup",
        ask: "Ask and Test",
        integrate: "Integrate App",
        maintainDocuments: "Manage Sources"
      },
      architectureTitle: "More than vector-store import",
      architectureLead: "KnowMesh separates the universal pipeline, domain intelligence, and quality constraints so users can run it and contributors can extend it.",
      architectureSummary: "Core runs the stable workflow, Expert adds domain strategy, and Quality Gates decide what can be written.",
      architecture: [
        ["SOURCE", "Source Files", "PDF, Word, Excel, Markdown, TXT, images, and scanned sources."],
        ["CORE", "KnowMesh Core", "Scanning, extraction, OCR, cleaning, chunking, embedding, writing, and recovery."],
        ["EXPERT", "KnowMesh Expert", "Template strategies and focused processors for education, legal, support, and more."],
        ["QUALITY", "Quality Gates", "Low-confidence, missing-citation, or out-of-scope content is not silently mixed in."],
        ["TRACE", "Traceable Knowledge", "Answers point back to files, pages, sections, or source snippets."],
        ["VERSION", "Versioned Knowledge", "Updates, exclusions, restores, and rebuilds keep version records."],
        ["ASSETS", "Knowledge Assets", "Vector indexes, metadata, source mapping, and history become maintainable assets."]
      ],
      openSourceText: "MIT License"
    },
    nav: {
      overview: "Overview",
      "knowledge-bases": "Knowledge Bases",
      build: "Scan & Plan",
      execution: "Run Task",
      ask: "Ask & Test",
      integration: "Integration Guide",
      "api-docs": "API Docs",
      feedback: "Feedback Records",
      documents: "Source Assets",
      "document-asset": "Source Document",
      versions: "Version Records",
      evaluation: "Evaluation Dashboard",
      "feedback-review": "Answer Feedback",
      maintenance: "Diagnostics Export",
      settings: "Settings"
    },
    navGroups: {
      overview: "Overview",
      "build-workflow": "Build Knowledge Base",
      "use-knowledge": "Use Knowledge Base",
      "maintain-knowledge": "Maintain Knowledge Base",
      settings: "Settings"
    },
    setup: {
      title: "Build Guide",
      step: "Step",
      locked: "Finish the previous step first",
      previous: "Back",
      testCurrent: "Test Step",
      testConnection: "Test Connection",
      testCredential: "Test Credential",
      saveCredential: "Save",
      doneNext: "Continue",
      finish: "Open Console",
      currentOperation: "Current Action",
      planEmpty: {
        title: "Generate This Plan First",
        body: "KnowMesh uses the current source scope, run method, and saved settings to decide whether processing can start now.",
        items: [
          "Continue unlocks only when there are no red issues",
          "Risky actions are confirmed again before running",
          "Generate again after configuration changes"
        ]
      },
      hintBadge: "Tip",
      whyThisStep: "Why This Step",
      draftSaved: "Saved locally.",
      draftSaving: "Saving...",
      draftLocal: "Saved in this browser.",
      selectPlaceholder: "Choose",
      multiSelectHint: "Multiple choice",
      chooseStageFirst: "Choose stages first, then select subjects, grades, and volumes.",
      selectAll: "Select all",
      clearSelection: "Clear",
      sourceScope: {
        statusMissing: "Missing: {fields}",
        statusReady: "Selected: {stages} · {subjects} subjects · {grades} grades",
        none: "Not selected",
        requiredHint: "Select stages, subjects, and grades before continuing.",
        steps: {
          stage: {
            title: "Choose stages",
            desc: "Pick primary, junior high, senior high, or all stages."
          },
          subject: {
            title: "Choose subjects",
            desc: "Subjects are filtered by the selected stages."
          },
          grade: {
            title: "Choose grades",
            desc: "Grades are filtered by the selected stages."
          }
        },
        allStages: "All stages",
        allSubjects: "All subjects",
        coreSubjects: "Core",
        scienceSubjects: "Science",
        humanitiesSubjects: "Humanities",
        artsSubjects: "Arts & PE",
        allGrades: "All grades",
        allVolumes: "All volumes",
        extraTitle: "More details",
        extraNote: "Optional; used later for citation and filtering."
      },
      folderPicker: {
        source: "Choose",
        workspace: "Choose",
        working: "Opening the system folder picker...",
        selected: "Folder selected",
        canceled: "No folder was selected. You can paste the path manually.",
        unavailable: "The system folder picker did not open. Paste the path manually."
      },
      folderBrowser: {
        sourceTitle: "Choose a source folder",
        workspaceTitle: "Choose a work folder",
        sourceBody: "Defaults to source under the project root; you can choose another folder.",
        workspaceBody: "Defaults to workspace under the project root; you can choose another folder.",
        choose: "Choose Folder",
        pasteLabel: "Or paste a path",
        usePath: "Use Path",
        dropUnavailable: "The browser cannot read the full local path from a dropped folder. Choose a folder or paste the path instead."
      },
      supportTitle: "Helpful Context",
      modeChoiceTitle: "Your choice changes later steps",
      currentChoice: "Selected",
      modePrepareLabel: "Prepare",
      modeNextLabel: "Next",
      templateChoice: {
        nextLabel: "Next",
        next: "Choose source and work folders.",
        guardLabel: "Tip",
        guard: "This only saves the template choice. No scan or upload starts here."
      },
      modeResultAliyun: "Connect Aliyun, then check the account and storage.",
      modeResultLocal: "Choose a template and folder, then run the pre-scan check.",
      storage: {
        sourceBadge: "Source",
        sourceTitle: "Source Storage",
        sourceBody: "Choose the standard OSS bucket for original sources and processing files.",
        searchBadge: "Search",
        searchTitle: "OSS Vector Bucket",
        searchBody: "Stores vector indexes and vector data. It follows the source region by default, and can be split for compliance, cost, or isolation.",
        hintBadge: "Tip",
        hintTitle: "Naming",
        hintBody: "Source buckets allow up to 63 characters; OSS vector buckets allow up to 32. Use lowercase letters, numbers, and hyphens only.",
        generateName: "Generate"
      },
      modelProvider: {
        badge: "Current Action",
        title: "Connect Model Service",
        body: "Verify that the model service is available first. After it passes, choose OCR, organization, embedding, and rerank models.",
        accessTitle: "Model Service Connection",
        accessBody: "Enter the Model Studio API Key and confirm the region and endpoint can connect.",
        keyTitle: "API Key stays local",
        keyBody: "The page uses it only for connection checks and later model calls. It is not written into source content.",
        keyPathLabel: "Secure local credential",
        workspaceTip: "Singapore or Germany regions need a Workspace ID. Mainland China uses the shared Base URL by default.",
        hintBadge: "Tip"
      },
      search: {
        badge: "Current Action",
        title: "Confirm Knowledge Index",
        body: "Enter the index name and confirm where searchable chunks will be written later. Nothing is written now.",
        indexTitle: "Set the Index for This Run",
        indexBody: "Use a source type, version, or project name so later upgrades or rebuilds are easy to distinguish.",
        modelNoteBadge: "Tip",
        modelNoteTitle: "Uses model setup",
        modelNoteBody: "The index stays aligned with the embedding model confirmed in the previous step. Before any write, KnowMesh shows the filter report, write scope, and risk.",
        guardBadge: "Guardrail",
        guardTitle: "No write happens now",
        guardBody: "This page only saves index configuration. It does not upload sources, create vectors, or call models."
      },
      modelQuality: {
        badge: "Current Action",
        title: "Choose Model and Quality Profile",
        body: "Choose the quality target first, then confirm current available models for each stage.",
        contextUnset: "Not confirmed",
        profileTitle: "Choose Quality",
        profileBody: "KnowMesh fills the matching model set, and you can still adjust each model.",
        fieldsTitle: "Confirm Models",
        fieldsBody: "Only current recommended or available models are shown; old models are not recommended.",
        refreshModels: "Refresh Models",
        catalogBuiltIn: "Model list: local recommendations",
        catalogSyncing: "Model list: syncing",
        catalogOfficial: "Model list: synced",
        catalogFallback: "Model list: local recommendations",
        catalogHelp: "This page automatically tries to sync the official model list. If the network is unavailable, it uses built-in recommendations.",
        modelDetail: "Model Details",
        modelPrice: "Pricing",
        hintBadge: "Tip",
        hintTitle: "You will confirm again before execution",
        hintBody: "This page only saves settings. Before OCR, organization, embedding, or rerank runs, KnowMesh shows scope and cost risk.",
        recommendedFit: "Best for most sources",
        highQualityFit: "More scanned and complex content",
        lowCostFit: "Small trial run first"
      },
      retrievalStrategy: {
        badge: "Current Action",
        title: "Choose Answer Strategy",
        body: "Choose how questions find sources, rank evidence, and return citations. Most users only need one profile.",
        profileTitle: "Choose Answer Behavior",
        profileBody: "This affects answer hit rate, citation strictness, speed, and model-call count.",
        methodsTitle: "What It Enables",
        methodsBody: "These are strategy details. Most users do not need to tune each item.",
        advancedTitle: "Strategy Details",
        hintBadge: "Tip",
        hintTitle: "Used only when answering",
        hintBody: "This page only saves the strategy. During Q&A, KnowMesh uses it to retrieve sources, rerank candidate snippets, and require citations."
      },
      accountCheckLoading: "Checking local Aliyun configuration...",
      accountCheckPass: "A usable configuration was found. Continue to the account check.",
      accountCheckFail: "No usable configuration was found. Enter a local credential instead.",
      accountContinuePermissions: "Continue to Account Check",
      accountContinueCredential: "Enter Credentials",
      accountGuide: {
        badge: "Creation Guide",
        title: "Create a dedicated RAM user first",
        body: "Do not use root account keys. After creating a dedicated user, return to KnowMesh, enter the AccessKey, and run a read-only identity check.",
        steps: [
          "Open the Aliyun RAM user page and create a user only for KnowMesh.",
          "Create an AccessKey for that user and grant only the permissions needed for storage, search, and smart services.",
          "Return here after creation, then open local credentials and enter the AccessKey."
        ],
        openRam: "Open Aliyun RAM",
        continue: "Created, Save Credentials"
      },
      credentialCurrent: "Current Choice",
      credentialCurrentMethod: "Use a Dedicated RAM User",
      credentialRequiredTitle: "Fill these two fields",
      credentialRequiredBody: "Copy the ID and Secret from the Aliyun RAM user's AccessKey page. Test the connection first, then save it locally after it passes.",
      credentialAdvanced: "Advanced Save Method",
      credentialAdvancedNote: "By default, KnowMesh saves to the secure local credential. You can also write to the project .env if command-line tools need to reuse it.",
      credentialSecurePathLabel: "Default secure local credential",
      credentialEnvPathLabel: "Project .env file",
      credentialEnvCopy: "Also write to project .env file",
      credentialSecurityLabel: "Protection",
      copyPath: "Copy Path",
      openDirectory: "Open Folder",
      pathCopied: "Path copied",
      pathCopyFailed: "The path was not copied. Select and copy it manually.",
      pathOpenStarted: "Local folder opened",
      pathOpenFailed: "The folder did not open. Use the path to check it manually.",
      dialogCancel: "Cancel",
      dialogConfirm: "Confirm",
      credentialHelp: {
        sourceTitle: "Where do I copy it?",
        sourceBody: "Open the dedicated user in Aliyun RAM, create an AccessKey for it, then paste the ID and Secret on the left.",
        rootTitle: "Do not use root keys",
        rootBody: "Root account keys are too broad and hard to rotate or disable safely. A dedicated RAM user is safer.",
        testTitle: "What does the test do?",
        testBody: "KnowMesh contacts Aliyun identity service first. After the test passes, you decide whether to save it locally."
      },
      permissionCheck: {
        badge: "Current Action",
        title: "Check Whether This Aliyun Account Works",
        body: "KnowMesh first confirms this account can connect to Aliyun, is safe to use, and can list storage spaces. Resource creation and service calls are confirmed in their own later steps.",
        statusPending: "Pending",
        scopeTitle: "Checks",
        scope: [
          {
            key: "identity",
            title: "Aliyun Connection",
            body: "Connects and identifies the account"
          },
          {
            key: "ram",
            title: "Dedicated RAM User",
            body: "Not a root account; easy to permission"
          },
          {
            key: "storage",
            title: "Storage Listing",
            body: "Can list OSS storage spaces"
          }
        ],
        fixBadge: "Tip",
        fixTitle: "If the check fails",
        fixBody: "Fix the RAM user or OSS listing permission shown in the result. If access must be granted, create a policy and add it in Aliyun RAM, then check again.",
        ramLink: "Open RAM Console"
      },
      taskBriefLabels: {
        focus: "This Page",
        next: "Next",
        guard: "Guardrail"
      },
      actionGuideLabels: {
        prepare: "Prepare",
        check: "KnowMesh Checks",
        fix: "If It Fails"
      },
      summary: {
        mode: "Run Method",
        template: "Template",
        source: "Source",
        workspace: "Work Folder",
        step: "Step Status",
        empty: "Not selected",
        pending: "Pending",
        confirmed: "Confirmed"
      },
      groups: {
        mode: {
          label: "Run Method",
          description: "Choose Aliyun or local"
        },
        aliyun: {
          label: "Aliyun Setup",
          description: "Account, keys, permissions, cloud resources"
        },
        source: {
          label: "Template and Sources",
          description: "Template, source folder, work folder"
        },
        environment: {
          label: "Pre-scan Check",
          description: "Confirm scan can start"
        },
        scan: {
          label: "Scan Preview",
          description: "Read-only source scan"
        },
        plan: {
          label: "Ready Check",
          description: "Confirm whether processing can start"
        },
        finish: {
          label: "Finish",
          description: "Open the full console"
        }
      },
      steps: {
        mode: {
          label: "Run Method",
          title: "Choose a Processing Mode",
          lead: "This decides which services you connect next and where recognition, cleaning, and search will happen.",
          cards: [
            [
              "Aliyun Mode",
              "For large source sets and long-term use",
              "Your files are saved in your Aliyun resources. KnowMesh checks the account and storage first, then confirms recognition and search services in later steps.",
              "Recommended",
              "Prepare",
              "Aliyun account, OSS bucket or permission for guided creation, and an access credential.",
              "Next",
              "Connect Aliyun, then check the account and storage.",
              "Select Aliyun Mode"
            ],
            [
              "Local Mode",
              "For trial runs or files that stay on this machine",
              "KnowMesh uses local files and local processing only, with no cloud account connection. Good for testing a small sample first.",
              "Local",
              "Prepare",
              "Local disk space plus any OCR or vector tools detected later.",
              "Next",
              "Choose a template and folder, then run the pre-scan check.",
              "Select Local Mode"
            ],
            ["Safe to Choose", "Uploads, resource creation, and writes always ask for confirmation before execution.", "Note"]
          ]
        },
        "aliyun-account": {
          label: "Connect Aliyun",
          title: "Which Aliyun account will you use?",
          lead: "Choose the connection path you can complete now. A dedicated RAM user is recommended because it is safer and easier to disable or replace later.",
          cards: [
            [
              "Use a Dedicated RAM User",
              "Best for a real knowledge-base build",
              "Create or use a RAM user just for KnowMesh. Permissions are clear and can be rotated, disabled, or removed later.",
              "Recommended",
              "Prepare",
              "A RAM user used only by KnowMesh, plus its AccessKey.",
              "What happens next",
              "Test the connection first, then save the credential after it passes.",
              "Use Dedicated RAM User"
            ],
            [
              "Check Local Configuration",
              "For users who already configured Aliyun tools",
              "If this machine already has environment variables or a local profile, KnowMesh checks that connection first.",
              "Existing",
              "Prepare",
              "Existing Aliyun environment variables or a local profile on this machine.",
              "What happens next",
              "Check the existing connection first; enter an AccessKey if it fails.",
              "Check Local Configuration"
            ],
            [
              "Show Creation Guide",
              "For first-time Aliyun setup",
              "If you do not have a usable account yet, create a dedicated RAM user and copy the least-privilege policy first.",
              "New",
              "Prepare",
              "An Aliyun account, then create a dedicated RAM user with guidance.",
              "What happens next",
              "Return here after creation, enter the AccessKey, and test the connection.",
              "Show Creation Guide"
            ]
          ]
        },
        "aliyun-credential": {
          label: "Save Credentials",
          title: "Enter Aliyun Connection Credentials",
          lead: "Paste the dedicated RAM user's AccessKey. Test whether it can connect to Aliyun first, then save it locally after it passes.",
          cards: [
            ["Local Save", "Prefer secure local credentials, with .env or existing variables as options.", "Local"],
            ["No Echo", "The secret is not shown again when you return.", "Safe"],
            ["Replaceable", "You can reconnect or clear the local credential later.", "Control"]
          ]
        },
        "aliyun-permissions": {
          label: "Check Account",
          title: "Check Whether This Aliyun Account Works",
          lead: "Read-only check that this account connects to Aliyun, is not a root account, and can list OSS storage spaces.",
          cards: [
            ["Aliyun Connection", "Confirm the AccessKey connects and identifies the account.", "Required"],
            ["Dedicated RAM User", "Confirm it is not a root account and can be permissioned separately.", "Required"],
            ["Storage Listing", "Confirm it can list OSS storage spaces.", "Required"]
          ]
        },
        "aliyun-storage": {
          label: "Storage",
          title: "Configure Cloud Storage Locations",
          lead: "Choose regions and buckets for sources and searchable content. By default they share one region; advanced cases can split search/vector storage.",
          cards: [
            ["Source Bucket", "Stores original sources and processing files.", "Required"],
            ["OSS Vector Bucket", "Stores vector indexes and vector data later.", "Same region"],
            ["Check and Confirm", "After the check passes, confirm creation or saving before continuing.", "Gate"]
          ]
        },
        "aliyun-search": {
          label: "Knowledge Search",
          title: "Set the Knowledge Index",
          lead: "Storage and the model quality profile were confirmed in the previous step. Set the index name that separates knowledge bases or versions.",
          cards: [
            ["Index Name", "Separates knowledge bases or versions.", "Required"],
            ["Model Relation", "The index stays aligned with the embedding model confirmed in the previous step.", "Check"],
            ["Preview First", "Filter report and run preview are required before writes.", "Gate"]
          ]
        },
        "aliyun-services": {
          label: "Model Service",
          title: "Connect Model Studio",
          lead: "Connect the model service first, then choose OCR, organization, embedding, and rerank models.",
          cards: [
            ["Model Studio", "Alibaba Cloud Model Studio is the default provider; other providers can be added later.", "Default"],
            ["OpenAI Compatible", "The compatible endpoint keeps later integration simple.", "Recommended"],
            ["Local Save", "The API Key is only used for local checks and later model calls.", "Safe"]
          ]
        },
        "aliyun-model-quality": {
          label: "Model Profile",
          title: "Model and Quality Profile",
          lead: "Choose the processing quality, then confirm OCR, organization, embedding, and optional rerank models.",
          cards: [
            ["Recommended", "For K12 textbooks, policies, reports, and most sources.", "Recommended"],
            ["High quality", "For scanned pages, formulas, tables, and complex chapters.", "Quality"],
            ["Lower cost", "For a small trial run before full processing.", "Cost"]
          ]
        },
        retrieval: {
          label: "Answer Quality",
          title: "Answer Strategy",
          lead: "Choose how user questions find the right sources, rank evidence, and behave when no source is found.",
          cards: [
            ["Balanced", "Good default for production knowledge bases", "Recommended"],
            ["Coverage first", "For varied wording or complex source language", "Recall"],
            ["Precise citations", "For textbooks, policies, compliance, and traceability", "Strict"],
            ["Lower-cost trial", "For validating a small sample first", "Trial"]
          ]
        },
        template: {
          label: "Template",
          title: "Choose a Source Template",
          lead: "Templates bring the right fields, organization rules, sectioning method, and validation questions for this source type.",
          cards: [
            ["K12 Textbooks", "For existing textbook folders and page citations.", "Recommended"],
            ["Generic Docs", "For mixed Office, WPS, PDF, image, and text sources.", "General"],
            ["Auditable", "Templates keep scan, organization, citation, and gate rules.", "Rules"]
          ]
        },
        project: {
          label: "Choose Sources",
          title: "Choose Source Folder and Save Location",
          modes: {
            aliyun: {
              lead: "Aliyun mode needs source path, work folder, Aliyun save location, search library, and smart service settings.",
              cards: [
                ["Source Path", "Pick the original folder; KnowMesh scans it read-only.", "Path"],
                ["Aliyun Setup", "Set storage locations, knowledge index, and connection details.", "Aliyun"],
                ["Service Keys", "Only key status is checked; secrets are never shown.", "Safe"]
              ]
            },
            local: {
              lead: "Local mode only needs source path, work folder, and local processing policy.",
              cards: [
                ["Source Path", "Pick the original folder; KnowMesh scans it read-only.", "Path"],
                ["Work Folder", "Generated data goes to a separate folder.", "Local"],
                ["Processing", "Organizing, sectioning, citations, and answer quality checks need no cloud service.", "Local"]
              ]
            }
          }
        },
        environment: {
          label: "Pre-scan Check",
          title: "Pre-scan Check",
          modes: {
            aliyun: {
              lead: "Confirm that source folder, work folder, source scope, cloud storage, model service, and knowledge search are ready for scan preview.",
              cards: [
                ["Folders", "Source folder is readable and work folder is writable.", "Required"],
                ["Source Scope", "Stages, subjects, and grades are selected.", "Required"],
                ["Aliyun Setup", "Storage, model service, and knowledge search are saved.", "Cloud"]
              ]
            },
            local: {
              lead: "Confirm that source folder, work folder, and source scope are ready for scan preview. Local mode does not check cloud settings.",
              cards: [
                ["Folders", "Source folder is readable and work folder is writable.", "Required"],
                ["Source Scope", "Stages, subjects, and grades are selected.", "Required"],
                ["File Detection", "Office, WPS, PDF, image, and text sources can be scanned read-only.", "Local"]
              ]
            }
          }
        },
        scan: {
          label: "Scan Sources",
          title: "Scan and Preview Sources",
          lead: "Preview files, split parts, missing items, and risks in the selected folder before any online result.",
          cards: [
            ["Detect", "Office, WPS, PDF, image, and text sources.", "Scan"],
            ["Join Parts", ".pdf.1 and .pdf.2 are handled as one source.", "Rule"],
            ["Risks", "Show huge files, missing pages, and unreadable items.", "Review"]
          ]
        },
        plan: {
          label: "Review Run",
          title: "Review Before Starting",
          lead: "Review steps, cost, online actions, safety gates, and rollback before running.",
          cards: [
            ["Steps", "Show each processing action and its order.", "Preview"],
            ["Cost", "Service, scale, and risk are shown before smart service calls.", "Clear"],
            ["Approval", "Upload, text recognition, content organization, and search-library updates stay blocked.", "Gate"]
          ]
        },
        finish: {
          label: "Finish",
          title: "Ready to Start Using KnowMesh",
          lead: "The full console is now unlocked and will continue with the selected mode.",
          cards: [
            ["Console", "Overview, scan, build, run, use, and maintenance are available.", "Unlocked"],
            ["Editable", "Mode, template, and settings can still be changed later.", "Flexible"],
            ["Safety", "Online and risky actions still need confirmation.", "Gate"]
          ]
        }
      }
    },
    console: {
      buildWorkflow: {
        routeSteps: [
          ["01", "Scan Sources", "Read-only folder check"],
          ["02", "Generate Plan", "Confirm write actions"],
          ["03", "Run Task", "Create and open execution"]
        ],
        scanTitle: "Scan Sources",
        scanBody: "Read the source folder only and review files, split parts, formats, and issues.",
        planTitle: "Generate Run Plan",
        planBody: "Generate steps from the current setup. Create a local task only after required issues are clear.",
        scanPendingTitle: "Not scanned yet",
        scanPendingBody: "Scan the source folder first. The result is kept in this browser.",
        scanDoneTitle: "Scanned",
        scanDoneBody: "A scan result already exists. Rescan only after changing setup.",
        scanIssueTitle: "Scan needs attention",
        scanIssueBody: "View the result, fix the issues, then scan again.",
        scanRerun: "Rescan",
        scanOpen: "View Scan",
        planPendingTitle: "No plan yet",
        planPendingBody: "Generate the plan after a passing scan to review what this run will do.",
        planDoneTitle: "Plan ready",
        planDoneBody: "A plan already exists. View it and create the task when ready.",
        planIssueTitle: "Plan needs attention",
        planIssueBody: "View the blockers, fix them, then regenerate the plan.",
        planRerun: "Regenerate Plan",
        planOpen: "View Plan",
        createTask: "Create Task",
        createTaskLoading: "Creating task..."
      },
      pages: {
        overview: {
          eyebrow: "Console",
          title: "Start Building",
          lead: "Follow scan, plan, and task execution. Return to setup anytime to change mode, keys, template, or folders.",
          primary: "Build Knowledge Base",
          secondary: "Edit Setup",
          cards: [
            ["1", "Scan sources", "Read the folder only and review file counts, formats, split parts, and unsupported items."],
            ["2", "Generate plan", "Review OCR, cleaning, chunking, embedding, and write actions for this run."],
            ["3", "Run task", "Create a local task, then run step by step with pause, resume, and stop controls."]
          ]
        },
        "knowledge-bases": {
          eyebrow: "Knowledge Bases",
          title: "Manage Knowledge Bases",
          lead: "Switch, continue building, or edit different knowledge bases. Setup, jobs, and local outputs stay separate.",
          primary: "New Knowledge Base",
          secondary: "Continue Build"
        },
        build: {
          eyebrow: "Build",
          title: "Scan, Plan, and Create Task",
          lead: "Scan sources first, then generate the run plan. When no required issue remains, create a local task and open execution.",
          primary: "Scan Sources",
          secondary: "Generate Plan",
          cards: [
            ["Scan", "Read-only folder check. No upload and no write.", "Step 1"],
            ["Plan", "Review OCR, cleaning, chunking, embedding, indexing, and write steps.", "Step 2"],
            ["Task", "Create a local task, then run it with pause and stop controls.", "Step 3"]
          ]
        },
        execution: {
          eyebrow: "Execution",
          title: "Run Knowledge-Base Tasks",
          lead: "Open the latest task, then run, pause, resume, or stop it step by step. Failure details stay available for retry.",
          primary: "View Jobs",
          secondary: "Retry Failed"
        },
        documents: {
          eyebrow: "Source Assets",
          title: "Source Assets",
          lead: "Review source documents, open processed text, locate original files, and exclude files you do not want in the next run.",
          primary: "Check Changes",
          secondary: "Exclude Sources"
        },
        "document-asset": {
          eyebrow: "Source Assets",
          title: "Source Document",
          lead: "Read the processed text, page chunks, citation state, and source file for one document.",
          primary: "Back to Assets",
          secondary: "Reveal File"
        },
        versions: {
          eyebrow: "Version Maintenance",
          title: "Review Knowledge Versions",
          lead: "See generated versions, the active version, write target, and Sidecar status for the current knowledge base.",
          primary: "Refresh Versions",
          secondary: "Review Artifacts"
        },
        evaluation: {
          eyebrow: "Evaluation Maintenance",
          title: "Review Evaluation Closure",
          lead: "Review coverage, pass rate, failed categories, and next maintenance actions for this knowledge base.",
          primary: "Refresh Evaluation",
          secondary: "Handle Failures"
        },
        integration: {
          eyebrow: "Integration",
          title: "Connect This Knowledge Base to Your App",
          lead: "Follow the steps to connect Query Runtime and test the same endpoint here. Fields, statuses, and examples live in API Docs.",
          primary: "Copy Endpoint",
          secondary: "View Examples"
        },
        "api-docs": {
          eyebrow: "Integration",
          title: "API Docs",
          lead: "Request, response, error, and feedback contract for connecting external systems to this knowledge base.",
          primary: "Copy Brief",
          secondary: "Back to Guide"
        },
        ask: {
          eyebrow: "Use Knowledge Base",
          title: "Ask and Test",
          lead: "Ask real questions and check answers, citations, and source evidence. This page uses the same Query Runtime as external apps.",
          primary: "Ask",
          secondary: "View Feedback"
        },
        feedback: {
          eyebrow: "Use Knowledge Base",
          title: "Feedback Records",
          lead: "Review feedback submitted from ask testing and external apps. Wrong citations and missed points enter Answer Feedback review.",
          primary: "View Feedback",
          secondary: "Handle Feedback"
        },
        "feedback-review": {
          eyebrow: "Quality Maintenance",
          title: "Review Answer Feedback",
          lead: "Handle wrong citations and missed points in one place. Resolution records are saved to the current knowledge base for future improvement.",
          primary: "View Feedback",
          secondary: "Back to Ask"
        },
        maintenance: {
          eyebrow: "Diagnostics Export",
          title: "Check Service and Contracts",
          lead: "Check local service, version, latest job, update channel, and cloud metadata contract. Answer feedback lives on its own page.",
          primary: "Check Status",
          secondary: "Preview Update"
        }
      }
    }
  }
};

const routes = new Map();
routes.set("/", { type: "welcome", key: "welcome", path: "/", icon: "home" });
routes.set("/index.html", routes.get("/"));

for (const step of setupSteps) {
  routes.set(step.path, { ...step, type: "setup" });
}

routes.set("/setup/aliyun/region", {
  ...setupSteps.find((step) => step.key === "aliyun-storage"),
  type: "setup",
  legacyPath: "/setup/aliyun/region"
});

for (const item of consoleNavItems) {
  routes.set(item.path, { ...item, type: "console" });
}

export function resolveConsoleRoute(pathname) {
  const normalized = normalizePath(pathname);
  return routes.get(normalized) || null;
}

export function renderConsolePage({ route, service }) {
  return route.type === "welcome"
    ? renderWelcomePage({ service })
    : route.type === "setup"
      ? renderSetupPage({ route, service })
      : renderFullConsolePage({ route, service });
}

function renderWelcomePage({ service }) {
  const state = buildPageState({ pageType: "welcome", service });
  const welcomeState = buildWelcomeState(service);
  const consoleHref = welcomeState.current ? scopedPagePath(service, "/overview") : pageHref(service, "/knowledge-bases");
  return `${renderDocumentStart({ pageType: "welcome", title: "KnowMesh", service })}
  ${renderIconSprite()}
  <div class="welcome-shell">
    <header class="welcome-top">
      <div class="welcome-top-left">
        ${renderWelcomeBrand(service)}
        ${renderKnowledgeBaseContext(service)}
      </div>
      <div class="welcome-top-right">
        ${renderWelcomeTopControls(consoleHref, { includeConsole: true })}
      </div>
    </header>
    <main class="welcome-main">
      <section class="welcome-hero" aria-labelledby="welcomeTitle">
        <div class="welcome-copy">
          <h1 id="welcomeTitle" aria-label="${escapeHtml(copy.zh.welcome.title)}">
            <span class="welcome-title-line">
              <span data-i18n="welcome.titlePrefix">${escapeHtml(copy.zh.welcome.titlePrefix)}</span>
              <em data-i18n="welcome.titleAccent">${escapeHtml(copy.zh.welcome.titleAccent)}</em>
            </span>
            <span class="welcome-title-line" data-i18n="welcome.titleSuffix">${escapeHtml(copy.zh.welcome.titleSuffix)}</span>
          </h1>
          <p class="lead" data-i18n="welcome.lead">${escapeHtml(copy.zh.welcome.lead)}</p>
          <div class="welcome-actions">
            ${renderWelcomePrimaryAction(welcomeState)}
            ${renderWelcomeSecondaryAction(welcomeState)}
          </div>
        </div>
        <aside class="welcome-current-panel" aria-label="Knowledge base state">
          ${renderWelcomeStatePanel(welcomeState)}
        </aside>
      </section>
      <section class="welcome-architecture" data-welcome-architecture>
        <h2 class="visually-hidden" data-i18n="welcome.architectureTitle">${escapeHtml(copy.zh.welcome.architectureTitle)}</h2>
        <div class="welcome-architecture-map" aria-label="KnowMesh architecture">
          ${renderWelcomeFlowLines()}
          ${copy.zh.welcome.architecture.map((item, index) => renderWelcomeArchitectureStage(item, index)).join("\n          ")}
        </div>
        <div class="welcome-engine-strip" aria-label="KnowMesh design principles">
          ${copy.zh.welcome.architecture.slice(1, 6).map((item, index) => renderWelcomeEngineCard(item, index + 1)).join("\n          ")}
        </div>
      </section>
      <footer class="welcome-footnote">
        ${renderWelcomeFooter(service)}
      </footer>
    </main>
  </div>
  ${renderStateScript(state)}
</body>
</html>`;
}
function buildWelcomeState(service = {}) {
  const current = getCurrentKnowledgeBase(service);
  const latestJobStatus = String(current?.latestJobStatus || "").toLowerCase();
  const knowledgeBaseStatus = String(current?.status || "").toLowerCase();
  const status = latestJobStatus || knowledgeBaseStatus;
  const hasCurrent = Boolean(current?.id);
  const isRunning = ["running", "pausing"].includes(latestJobStatus);
  const isPaused = latestJobStatus === "paused";
  const isFailed = ["failed", "blocked"].includes(latestJobStatus);
  const isReady = ["completed", "ready"].includes(latestJobStatus) || knowledgeBaseStatus === "ready";
  const isConfigured = ["configured", "active"].includes(knowledgeBaseStatus) || Boolean(current?.sourceRoot || current?.workspaceRoot || current?.latestJobId);
  let stateKey = "empty";
  let primaryKey = "welcome.actions.create";
  let primaryText = copy.zh.welcome.actions.create;
  let primaryHref = "/knowledge-bases";
  let primaryIsButton = true;
  let secondaryKey = "";
  let secondaryText = "";
  let secondaryHref = "";

  if (hasCurrent) {
    primaryIsButton = false;
      if (isRunning || isPaused) {
      stateKey = isPaused ? "paused" : "running";
      primaryKey = "welcome.actions.openTask";
      primaryText = copy.zh.welcome.actions.openTask;
      primaryHref = scopedPagePath(service, "/build/execution");
      secondaryKey = "welcome.actions.openConsole";
      secondaryText = copy.zh.welcome.actions.openConsole;
      secondaryHref = scopedPagePath(service, "/overview");
    } else if (isFailed) {
      stateKey = "failed";
      primaryKey = "welcome.actions.fixTask";
      primaryText = copy.zh.welcome.actions.fixTask;
      primaryHref = scopedPagePath(service, "/build/execution");
      secondaryKey = "welcome.actions.editSetup";
      secondaryText = copy.zh.welcome.actions.editSetup;
      secondaryHref = scopedPagePath(service, "/setup/mode");
      } else if (isReady) {
        stateKey = "ready";
        primaryKey = "welcome.actions.openConsole";
        primaryText = copy.zh.welcome.actions.openConsole;
        primaryHref = scopedPagePath(service, "/overview");
      } else if (isConfigured) {
      stateKey = "configured";
      primaryKey = "welcome.actions.continueBuild";
      primaryText = copy.zh.welcome.actions.continueBuild;
      primaryHref = scopedPagePath(service, "/build");
      secondaryKey = "welcome.actions.editSetup";
      secondaryText = copy.zh.welcome.actions.editSetup;
      secondaryHref = scopedPagePath(service, "/setup/mode");
      } else {
        stateKey = "draft";
        primaryKey = "welcome.actions.continueSetup";
        primaryText = copy.zh.welcome.actions.continueSetup;
        primaryHref = scopedPagePath(service, "/setup/mode");
      }
  }

  return {
    current,
    status,
    stateKey,
    statusClass: welcomeStatusClass(stateKey),
    progress: welcomeProgressForState(stateKey),
    primaryKey,
    primaryText,
    primaryHref,
    primaryIsButton,
    secondaryKey,
    secondaryText,
    secondaryHref
  };
}
function renderWelcomePrimaryAction(welcomeState) {
  if (welcomeState.primaryIsButton) {
    return `<button class="hero-cta" type="button" data-knowledge-base-create>
              <span class="hero-cta-icon"><svg class="icon" aria-hidden="true"><use href="#icon-run"></use></svg></span>
              <span data-i18n="${escapeHtml(welcomeState.primaryKey)}">${escapeHtml(welcomeState.primaryText)}</span>
            </button>`;
  }
  return `<a class="hero-cta" href="${escapeHtml(welcomeState.primaryHref)}">
            <span class="hero-cta-icon"><svg class="icon" aria-hidden="true"><use href="#icon-run"></use></svg></span>
            <span data-i18n="${escapeHtml(welcomeState.primaryKey)}">${escapeHtml(welcomeState.primaryText)}</span>
          </a>`;
}

function renderWelcomeTopControls(consoleHref = "/overview", options = {}) {
  const consoleLink = options.includeConsole
    ? `<a class="welcome-console-link" href="${escapeHtml(consoleHref)}">
            <svg class="icon" aria-hidden="true"><use href="#icon-database"></use></svg>
            <span data-i18n="welcome.headerConsole">${escapeHtml(copy.zh.welcome.headerConsole)}</span>
          </a>`
    : "";
  return `<div class="welcome-controls">
          ${consoleLink}
          <details class="welcome-lang-control" data-global-disclosure>
            <summary aria-label="Language">
              <svg class="icon" aria-hidden="true"><use href="#icon-globe"></use></svg>
              <span class="welcome-current-lang welcome-current-lang--zh">中</span>
              <span class="welcome-current-lang welcome-current-lang--en">EN</span>
              <svg class="icon welcome-lang-chevron" aria-hidden="true"><use href="#icon-chevron-down"></use></svg>
            </summary>
            <div class="welcome-lang-menu" role="group" aria-label="Language">
              <button id="langZh" type="button" data-lang-option="zh">中文</button>
              <button id="langEn" type="button" data-lang-option="en">English</button>
            </div>
          </details>
          <div class="welcome-theme-control" role="group" aria-label="Theme">
            <button id="themeDark" type="button" data-theme-option="dark" aria-label="${escapeHtml(copy.zh.app.dark)}">
              <svg class="icon" aria-hidden="true"><use href="#icon-moon"></use></svg>
              <span data-i18n="app.dark">${escapeHtml(copy.zh.app.dark)}</span>
            </button>
            <button id="themeLight" type="button" data-theme-option="light" aria-label="${escapeHtml(copy.zh.app.light)}">
              <svg class="icon" aria-hidden="true"><use href="#icon-sun"></use></svg>
              <span data-i18n="app.light">${escapeHtml(copy.zh.app.light)}</span>
            </button>
          </div>
        </div>`;
}

function renderWelcomeSecondaryAction(welcomeState) {
  if (!welcomeState.secondaryKey || !welcomeState.secondaryText) return "";
  const href = welcomeState.secondaryHref || "/knowledge-bases";
  return `<a class="welcome-link-action" href="${escapeHtml(href)}">
            <span data-i18n="${escapeHtml(welcomeState.secondaryKey)}">${escapeHtml(welcomeState.secondaryText)}</span>
            <svg class="icon" aria-hidden="true"><use href="#icon-arrow-right"></use></svg>
          </a>`;
}

function renderWelcomeStatePanel(welcomeState) {
  const currentName = welcomeState.current?.name || copy.zh.welcome.noKnowledgeBase;
  const progress = Number.isFinite(welcomeState.progress) ? Math.max(0, Math.min(100, welcomeState.progress)) : 0;
  const primaryHref = welcomeState.primaryIsButton ? "/knowledge-bases" : welcomeState.primaryHref;
  return `<header class="welcome-current-head">
            <span class="welcome-current-menu" aria-hidden="true">•••</span>
            <span class="panel-label" data-i18n="welcome.workspaceLabel">${escapeHtml(copy.zh.welcome.workspaceLabel)}</span>
            <strong title="${escapeHtml(currentName)}">${escapeHtml(currentName)}</strong>
            <div class="welcome-current-status">
              <span class="welcome-status-dot welcome-status-dot--${escapeHtml(welcomeState.statusClass)}" aria-hidden="true"></span>
              <span data-i18n="welcome.states.${escapeHtml(welcomeState.stateKey)}">${escapeHtml(copy.zh.welcome.states[welcomeState.stateKey])}</span>
            </div>
            <div class="welcome-current-progress" aria-hidden="true">
              <span style="width: ${progress}%"></span>
              <em>${progress}%</em>
            </div>
          </header>
          <div class="welcome-next-step">
            <i aria-hidden="true"><svg class="icon"><use href="#icon-database"></use></svg></i>
            <span data-i18n="welcome.nextStepLabel">${escapeHtml(copy.zh.welcome.nextStepLabel)}</span>
            <strong data-i18n="${escapeHtml(welcomeState.primaryKey)}">${escapeHtml(welcomeState.primaryText)}</strong>
            <a class="welcome-next-arrow" href="${escapeHtml(primaryHref)}" aria-label="${escapeHtml(welcomeState.primaryText)}">
              <svg class="icon" aria-hidden="true"><use href="#icon-arrow-right"></use></svg>
            </a>
          </div>`;
}

function welcomeStatusClass(stateKey) {
  if (stateKey === "ready") return "success";
  if (stateKey === "running") return "running";
  if (stateKey === "failed") return "danger";
  if (stateKey === "paused") return "warn";
  return "neutral";
}

function welcomeProgressForState(stateKey) {
  if (stateKey === "empty") return 0;
  if (stateKey === "draft") return 18;
  if (stateKey === "configured") return 36;
  if (stateKey === "running" || stateKey === "paused" || stateKey === "failed") return 62;
  if (stateKey === "ready") return 100;
  return 0;
}

const welcomeArchitectureIcons = ["file", "layers", "mode", "shield", "link", "clock", "graph"];

function welcomeArchitectureIcon(index) {
  return welcomeArchitectureIcons[index] || "database";
}

function renderWelcomeFlowLines() {
  return `<svg class="welcome-flow-lines" viewBox="0 0 1400 128" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <marker id="welcome-flow-arrow" markerWidth="14" markerHeight="14" refX="11" refY="7" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M1 1 L12 7 L1 13" fill="none" stroke="rgba(222,236,236,.86)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
              </marker>
            </defs>
            <g class="welcome-flow-streams">
              ${[-25, -15, -5, 5, 15, 25].map((offset, index) => `<path d="M148 ${64 + offset} C 190 ${64 + offset}, 218 ${64 + offset * 0.44}, 242 ${64 + offset * 0.24}" data-flow-tone="${index === 1 || index === 4 ? "amber" : "teal"}"/>`).join("")}
              ${[-25, -15, -5, 5, 15, 25].map((offset, index) => `<path d="M358 ${64 + offset * 0.24} C 392 ${64 + offset * 0.5}, 424 ${64 + offset}, 458 ${64 + offset}" data-flow-tone="${index === 0 || index === 5 ? "amber" : "teal"}"/>`).join("")}
              ${[-18, -6, 7, 19].map((offset, index) => `<path d="M542 ${64 + offset} C 578 ${64 + offset}, 616 ${64 + offset}, 652 ${64 + offset * 0.32}" data-flow-tone="${index === 2 ? "amber" : "teal"}"/>`).join("")}
              <path d="M748 64 C 786 64, 816 64, 852 64" data-flow-tone="teal"/>
              <path d="M948 64 C 986 64, 1016 64, 1052 64" data-flow-tone="teal"/>
              <path d="M1150 64 C 1186 64, 1218 64, 1248 64" data-flow-tone="white" marker-end="url(#welcome-flow-arrow)"/>
            </g>
            <g class="welcome-flow-dots">
              ${[176, 200, 224, 398, 426, 584, 616, 800, 1014, 1230].map((x, index) => `<circle cx="${x}" cy="${index % 3 === 0 ? 53 : index % 3 === 1 ? 64 : 75}" r="${index % 4 === 0 ? 4 : 3}" data-flow-tone="${index % 5 === 0 ? "amber" : "teal"}"/>`).join("")}
            </g>
          </svg>`;
}

function renderSetupPage({ route, service }) {
  const step = copy.zh.setup.steps[route.key];
  const content = resolveModeContent(step, defaultMode);
  const visibleSteps = setupStepsForMode(defaultMode);
  const visibleGroups = setupGroupsForMode(defaultMode);
  const activeGroup = setupGroupForStep(route.key);
  const activeGroupIndex = visibleGroups.findIndex((item) => item.key === activeGroup?.key);
  const stepIndex = visibleSteps.findIndex((item) => item.key === route.key);
  const previous = visibleSteps[stepIndex - 1];
  const next = visibleSteps[stepIndex + 1];
  const state = buildPageState({
    pageType: "setup",
    activeSetupStep: route.key,
    service
  });
  const focusedPage = isFocusedSetupPage(route.key);
  const configSummary = focusedPage ? "" : renderSetupConfigSummary(route.key);
  const substeps = isFocusedSetupPage(route.key) ? "" : renderSetupSubsteps(route.key, service);
  const primaryContent = renderSetupPrimaryContent(route, content, step, service);
  const supportContent = renderSetupSupportContent(route, content, step);
  const taskLayoutClass = supportContent ? "setup-task-layout" : "setup-task-layout setup-task-layout--single";
  const setupPanelClass = setupPanelClassForRoute(route.key);

  return `${renderDocumentStart({ pageType: "setup", title: "KnowMesh Setup", service })}
  ${renderIconSprite()}
  <div class="setup-shell">
    <header class="setup-top">
      <div class="setup-top-left topbar-left">
        ${renderBrand(service)}
        ${renderKnowledgeBaseContext(service)}
      </div>
      ${renderTopControls(service, { includeConsole: true })}
    </header>
    <main class="setup-layout">
      <aside class="setup-rail" aria-label="Setup steps">
        <p data-i18n="setup.title">${escapeHtml(copy.zh.setup.title)}</p>
        <nav>
          ${setupGroups.map((item, index) => renderSetupGroupLink(item, index, route.key, service)).join("\n          ")}
        </nav>
      </aside>
      <section class="${setupPanelClass}">
        <div class="setup-panel-scroll" data-setup-panel-scroll>
          <header class="work-page-head setup-page-head">
            <div class="work-page-title-row">
              <h1 data-i18n="setup.steps.${route.key}.title">${escapeHtml(step.title)}</h1>
              <p class="work-page-kicker setup-page-kicker">
                <span data-i18n="setup.step">${escapeHtml(copy.zh.setup.step)}</span>
                <strong><span data-setup-progress-current>${activeGroupIndex + 1}</span>/<span data-setup-progress-total>${visibleGroups.length}</span></strong>
                <em data-i18n="setup.steps.${route.key}.label">${escapeHtml(step.label)}</em>
              </p>
              <details class="work-page-help" data-page-help>
                <summary aria-label="查看说明" title="查看说明">?</summary>
                <p class="work-page-note setup-page-note" data-setup-page-note ${setupPageNoteAttr(route, step, focusedPage)}>${escapeHtml(content.lead)}</p>
              </details>
            </div>
          </header>
          ${configSummary}
          ${substeps}
          <div class="${taskLayoutClass}">
            <div class="setup-task-main">
              ${primaryContent}
            </div>
            ${supportContent ? `<aside class="setup-task-help" aria-label="Setup context">
              ${supportContent}
            </aside>` : ""}
          </div>
        </div>
        <footer class="setup-actions" data-setup-action-bar>
          ${renderSetupActions(route, previous, next, service)}
        </footer>
      </section>
    </main>
  </div>
  ${renderStateScript(state)}
</body>
</html>`;
}

function setupPageNoteAttr(route, step, focusedPage) {
  if (focusedPage && step.modes) {
    return `data-focused-mode-i18n="setup.steps.${escapeHtml(route.key)}.modes.{mode}.lead"`;
  }
  return contentAttr(`setup.steps.${route.key}`, "lead", step);
}

function renderSetupConfigSummary(stepKey) {
  const selected = templateSummaries.find((template) => template.id === defaultTemplateId) || templateSummaries[0];
  const labels = copy.zh.setup.summary;
  const items = [
    { key: "mode", label: labels.mode, value: copy.zh.modes[defaultMode].short },
    { key: "template", label: labels.template, value: selected?.title?.zh || labels.empty },
    { key: "source", label: labels.source, value: labels.empty },
    { key: "workspace", label: labels.workspace, value: labels.empty },
    { key: "step", label: labels.step, value: stepKey === "mode" ? labels.pending : labels.pending }
  ];

  return `<section class="setup-config-summary" data-setup-config-summary aria-label="配置摘要">
          ${items.map((item) => `<article>
            <span data-i18n="setup.summary.${item.key === "step" ? "step" : item.key}">${escapeHtml(item.label)}</span>
            <strong data-summary-${escapeHtml(item.key)} title="${escapeHtml(item.value)}">${escapeHtml(item.value)}</strong>
          </article>`).join("\n          ")}
        </section>`;
}

function isSetupDecisionPage(stepKey) {
  return stepKey === "mode" || stepKey === "aliyun-account";
}

function isFocusedSetupPage(stepKey) {
  return isSetupDecisionPage(stepKey)
    || stepKey === "aliyun-credential"
    || stepKey === "aliyun-permissions"
    || stepKey === "aliyun-storage"
    || stepKey === "aliyun-services"
    || stepKey === "aliyun-model-quality"
    || stepKey === "aliyun-search"
    || stepKey === "template"
    || stepKey === "retrieval"
    || stepKey === "project"
    || stepKey === "environment"
    || stepKey === "scan"
    || stepKey === "plan"
    || stepKey === "finish";
}

function setupPanelClassForRoute(stepKey) {
  if (stepKey === "mode") return "setup-panel setup-panel--mode";
  if (stepKey === "aliyun-account") return "setup-panel setup-panel--account";
  if (stepKey === "aliyun-credential") return "setup-panel setup-panel--credential";
  if (stepKey === "aliyun-permissions") return "setup-panel setup-panel--permissions";
  if (stepKey === "aliyun-storage") return "setup-panel setup-panel--storage";
  if (stepKey === "aliyun-services") return "setup-panel setup-panel--model-provider";
  if (stepKey === "aliyun-model-quality") return "setup-panel setup-panel--model-quality";
  if (stepKey === "aliyun-search") return "setup-panel setup-panel--search";
  if (stepKey === "template") return "setup-panel setup-panel--template";
  if (stepKey === "retrieval") return "setup-panel setup-panel--retrieval";
  if (stepKey === "project") return "setup-panel setup-panel--project";
  return "setup-panel";
}

function getCurrentKnowledgeBase(service = {}) {
  const library = service.knowledgeBases || {};
  if (library.current) return library.current;
  if (Array.isArray(library.items) && library.items.length > 0) {
    return library.items.find((item) => item?.current) || library.items[0];
  }
  return null;
}

function renderKnowledgeBaseContext(service = {}) {
  const labels = copy.zh.knowledgeBases;
  const library = service.knowledgeBases || {};
  const current = getCurrentKnowledgeBase(service);
  const items = Array.isArray(library.items) ? library.items : [];
  if (!current) {
    return `<a class="welcome-kb-selector welcome-kb-selector--empty knowledge-base-context knowledge-base-context--empty" data-global-knowledge-base-switcher href="${pageHref(service, "/knowledge-bases")}" aria-label="${escapeHtml(labels.create)}">
          <svg class="icon" aria-hidden="true"><use href="#icon-database"></use></svg>
          <strong data-i18n="welcome.noKnowledgeBase">${escapeHtml(copy.zh.welcome.noKnowledgeBase)}</strong>
          <svg class="icon welcome-kb-chevron" aria-hidden="true"><use href="#icon-chevron-down"></use></svg>
        </a>`;
  }
  const name = current.name || current.id || labels.current;
  const title = `${labels.current}: ${name}`;
  return `<details class="welcome-kb-selector knowledge-base-context" data-global-knowledge-base-switcher data-global-disclosure>
          <summary aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}">
            <svg class="icon" aria-hidden="true"><use href="#icon-database"></use></svg>
            <strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
            <svg class="icon welcome-kb-chevron" aria-hidden="true"><use href="#icon-chevron-down"></use></svg>
          </summary>
          <div class="knowledge-base-switch-list">
            <div class="knowledge-base-switch-list-head">
              <strong data-i18n="knowledgeBases.switchContext">${escapeHtml(labels.switchContext)}</strong>
              <a href="${pageHref(service, "/knowledge-bases")}" data-i18n="knowledgeBases.manage">${escapeHtml(labels.manage)}</a>
            </div>
            ${items.map((item) => renderKnowledgeBaseSwitchItem(item, labels)).join("\n            ")}
            <button class="knowledge-base-switch-create" type="button" data-knowledge-base-create data-i18n="knowledgeBases.create">${escapeHtml(labels.create)}</button>
          </div>
        </details>`;
}

function renderKnowledgeBaseSwitchItem(item, labels) {
  const id = String(item?.id || "");
  const name = item?.name || id || labels.current;
  const status = item?.status || "draft";
  if (item?.current) {
    return `<div class="knowledge-base-switch-item is-current">
              <span>
                <strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
                <em>${escapeHtml(status)}</em>
              </span>
              <b data-i18n="knowledgeBases.currentBadge">${escapeHtml(labels.currentBadge)}</b>
            </div>`;
  }
  return `<button class="knowledge-base-switch-item" type="button" data-knowledge-base-switch="${escapeHtml(id)}">
            <span>
              <strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
              <em>${escapeHtml(status)}</em>
            </span>
            <b data-i18n="knowledgeBases.switch">${escapeHtml(labels.switch)}</b>
          </button>`;
}

function renderFullConsolePage({ route, service }) {
  const page = copy.zh.console.pages[route.key];
  const content = resolveModeContent(page, defaultMode);
  const currentKnowledgeBase = getCurrentKnowledgeBase(service);
  const state = buildPageState({
    pageType: "console",
    active: route.key,
    service
  });

  return `${renderDocumentStart({ pageType: "console", title: "KnowMesh Console", setupGated: true, service })}
  ${renderIconSprite()}
  <div class="app-shell">
    <aside class="sidebar" aria-label="KnowMesh navigation">
      <div class="sidebar-head">
        ${renderBrand(service)}
        <button class="icon-button sidebar-toggle" id="sidebarToggle" type="button" aria-label="折叠菜单">
          <svg class="icon" aria-hidden="true"><use href="#icon-menu"></use></svg>
        </button>
      </div>

      <div class="service-card" aria-label="Local service">
        <span class="status-dot" aria-hidden="true"></span>
        <span class="service-copy">
          <span data-i18n="app.service">${escapeHtml(copy.zh.app.service)}</span>
          <strong>${escapeHtml(service.endpoint)}</strong>
        </span>
      </div>

      <nav class="nav-list">
        ${renderConsoleNavSections({ service, activeKey: route.key, hasCurrent: Boolean(currentKnowledgeBase) })}
      </nav>
    </aside>

    <div class="page-shell">
      <header class="topbar">
        <div class="topbar-left">
          ${renderKnowledgeBaseContext(service)}
          ${renderConsoleRouteChip(route.key)}
        </div>
        <div class="topbar-right">
          ${renderTopControls(service)}
        </div>
      </header>

      <main class="content console-content console-content--${escapeHtml(route.key)}" data-console-content="${escapeHtml(route.key)}">
        <header class="work-page-head console-page-head">
          <div class="work-page-title-row">
            <h1 data-i18n="console.pages.${route.key}.title">${escapeHtml(page.title)}</h1>
            <p class="work-page-kicker console-page-kicker">
              <span data-i18n="console.pages.${route.key}.eyebrow">${escapeHtml(page.eyebrow)}</span>
              <strong data-i18n="nav.${route.key}">${escapeHtml(copy.zh.nav[route.key])}</strong>
            </p>
            <details class="work-page-help" data-page-help>
              <summary aria-label="查看说明" title="查看说明">?</summary>
              <p class="work-page-note console-page-note" data-console-page-note ${contentAttr(`console.pages.${route.key}`, "lead", page)}>${escapeHtml(content.lead)}</p>
            </details>
          </div>
        </header>

        ${renderConsoleMainContent(route, content, page, service)}
      </main>
    </div>
  </div>
  ${renderStateScript(state)}
</body>
</html>`;
}

function consoleNavSectionForRoute(activeKey) {
  if (activeKey === "document-asset") return consoleNavSections.find((section) => section.key === "maintain-knowledge") || null;
  return consoleNavSections.find((section) => section.item === activeKey || section.items?.includes(activeKey)) || null;
}

function renderConsoleRouteChip(activeKey) {
  const section = consoleNavSectionForRoute(activeKey);
  const groupKey = section?.key || activeKey;
  const groupLabel = section ? (copy.zh.navGroups[groupKey] || groupKey) : "";
  const pageLabel = copy.zh.nav[activeKey] || groupLabel || activeKey;
  return `<div class="route-chip" aria-label="Current page">
            <span class="route-chip-mark" aria-hidden="true"></span>
            <span class="route-chip-copy">
              ${section ? `<em data-i18n="navGroups.${groupKey}">${escapeHtml(groupLabel)}</em>` : ""}
              <strong data-i18n="nav.${activeKey}">${escapeHtml(pageLabel)}</strong>
            </span>
          </div>`;
}

function renderConsoleNavSections({ service, activeKey, hasCurrent }) {
  if (!hasCurrent) {
    const manager = consoleNavItemByKey.get("knowledge-bases");
    return manager ? renderNavItem(manager, activeKey, service) : "";
  }
  return consoleNavSections
    .map((section) => renderConsoleNavSection(section, activeKey, service))
    .join("\n        ");
}

function renderConsoleNavSection(section, activeKey, service = {}) {
  const activeSection = consoleNavSectionForRoute(activeKey);
  const sectionActive = activeSection?.key === section.key;
  if (section.item) {
    const item = consoleNavItemByKey.get(section.item);
    return item ? `<div class="nav-section" data-nav-section="${escapeHtml(section.key)}">${renderNavItem(item, activeKey, service)}</div>` : "";
  }

  const firstItem = consoleNavItemByKey.get(section.items?.[0]);
  const href = section.href || firstItem?.path || "/overview";
  const title = copy.zh.navGroups[section.key] || section.key;

  return `<section class="nav-section${sectionActive ? " active" : ""}" data-nav-section="${escapeHtml(section.key)}">
            <a class="nav-link nav-section-main${sectionActive ? " active" : ""}" href="${pageHref(service, href)}" data-nav-section-key="${escapeHtml(section.key)}" title="${escapeHtml(title)}">
              <svg class="icon nav-icon" aria-hidden="true"><use href="#icon-${escapeHtml(section.icon || firstItem?.icon || "home")}"></use></svg>
              <span class="nav-text" data-i18n="navGroups.${section.key}">${escapeHtml(title)}</span>
            </a>
          </section>`;
}

function renderDocumentStart({ pageType, title, setupGated = false, service = {} }) {
  const gatedAttr = setupGated ? " data-setup-gated=\"true\"" : "";
  const basePath = normalizeBasePath(service.basePath || "");
  const apiBasePath = service.apiBasePath || (basePath ? `${basePath}/api` : "/api");
  return `<!doctype html>
<html lang="zh-CN" data-theme="dark" data-lang="zh" data-mode="${defaultMode}" data-sidebar="expanded">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='32' height='32' rx='7' fill='%2318202A'/%3E%3Cpath d='M10 23V8h3v6l7-6h4l-8 7 8 8h-4l-7-7v7z' fill='%2318A999'/%3E%3Ccircle cx='22' cy='8' r='3' fill='%23F2B84B'/%3E%3C/svg%3E">
  ${renderPreferenceBootScript()}
  <link rel="stylesheet" href="/web-console/styles.css?v=${assetVersion}">
</head>
<body data-page-type="${escapeHtml(pageType)}" data-base-path="${escapeHtml(basePath)}" data-api-base-path="${escapeHtml(apiBasePath)}"${gatedAttr}>`;
}

function normalizeBasePath(value) {
  const text = String(value || "").trim();
  if (!text || text === "/") return "";
  const normalized = text.startsWith("/") ? text : `/${text}`;
  return normalized.replace(/\/+$/, "");
}


function scopedPagePath(service = {}, value = "") {
  const raw = String(value || "");
  const basePath = normalizeBasePath(service.basePath || "");
  if (!basePath) return raw;
  return /^\/(?:setup|overview|knowledge-bases|build|use|maintain)(?:\/|$)/.test(raw)
    ? `${basePath}${raw}`
    : raw;
}

function scopedApiPath(service = {}, value = "") {
  const raw = String(value || "");
  if (!raw.startsWith("/api")) return raw;
  const basePath = normalizeBasePath(service.basePath || "");
  if (!basePath) return raw;
  const apiBasePath = service.apiBasePath || `${basePath}/api`;
  return `${apiBasePath}${raw.slice(4)}`;
}

function pageHref(service, value) {
  return escapeHtml(scopedPagePath(service, value));
}

function apiEndpoint(service, value) {
  return escapeHtml(scopedApiPath(service, value));
}
function renderPreferenceBootScript() {
  return `<script>
(function () {
  try {
    var root = document.documentElement;
    var theme = localStorage.getItem("knowmesh.theme");
    if (theme === "dark" || theme === "light") {
      root.dataset.theme = theme;
      root.style.colorScheme = theme;
    }
    var lang = localStorage.getItem("knowmesh.lang");
    if (lang === "zh" || lang === "en") {
      root.dataset.lang = lang;
      root.lang = lang === "zh" ? "zh-CN" : "en";
    }
    var sidebar = localStorage.getItem("knowmesh.sidebar");
    if (sidebar === "expanded" || sidebar === "collapsed") root.dataset.sidebar = sidebar;
    if (lang === "en") {
      root.dataset.preferenceHydrating = "true";
    }
  } catch {}
}());
  </script>`;
}

function renderBrand(service = {}) {
  const version = service.version ? `v${service.version}` : "";
  return `<a class="brand" href="/" aria-label="KnowMesh">
          <img src="/assets/brand/knowmesh-mark.svg" alt="" class="brand-mark">
          <span class="brand-copy">
            <span class="brand-line"><strong>KnowMesh</strong>${version ? `<em class="brand-version">${escapeHtml(version)}</em>` : ""}</span>
            <span data-i18n="app.subtitle">${escapeHtml(copy.zh.app.subtitle)}</span>
          </span>
        </a>`;
}

function renderWelcomeBrand(service = {}) {
  const version = service.version ? `v${service.version}` : "";
  return `<a class="welcome-brand" href="/" aria-label="KnowMesh">
          <img src="/assets/brand/knowmesh-mark.svg" alt="" class="welcome-brand-mark">
          <span class="welcome-brand-copy">
            <strong>KnowMesh</strong>
            ${version ? `<em>知络 · ${escapeHtml(version)}</em>` : `<em>知络</em>`}
          </span>
        </a>`;
}

function renderTopControls(service = {}, options = {}) {
  const currentKnowledgeBase = getCurrentKnowledgeBase(service);
  const consoleHref = currentKnowledgeBase ? scopedPagePath(service, "/overview") : pageHref(service, "/knowledge-bases");
  return `<div class="topbar-controls">${renderWelcomeTopControls(consoleHref, { includeConsole: options.includeConsole !== false })}</div>`;
}

function renderWelcomeArchitectureStage(item, index) {
  return `<article class="welcome-architecture-stage">
            <i class="welcome-stage-node" aria-hidden="true">
              <svg class="icon"><use href="#icon-${welcomeArchitectureIcon(index)}"></use></svg>
            </i>
            <span data-i18n="welcome.architecture.${index}.0">${escapeHtml(item[0])}</span>
            <strong data-i18n="welcome.architecture.${index}.1">${escapeHtml(item[1])}</strong>
            <p data-i18n="welcome.architecture.${index}.2">${escapeHtml(item[2])}</p>
          </article>`;
}

function renderWelcomeEngineCard(item, index) {
  return `<article class="welcome-engine-card">
            <svg class="icon" aria-hidden="true"><use href="#icon-${welcomeArchitectureIcon(index)}"></use></svg>
            <div>
              <strong data-i18n="welcome.architecture.${index}.1">${escapeHtml(item[1])}</strong>
              <span data-i18n="welcome.architecture.${index}.2">${escapeHtml(item[2])}</span>
            </div>
          </article>`;
}

function renderWelcomeFooter(service = {}) {
  const links = copy.zh.welcome.footerLinks;
  const hrefs = [
    pageHref(service, "/maintain/diagnostics"),
    pageHref(service, "/maintain/diagnostics"),
    "https://github.com/",
    pageHref(service, "/knowledge-bases"),
    pageHref(service, "/maintain/diagnostics")
  ];
  return links
    .map((label, index) => `<a href="${escapeHtml(hrefs[index])}"${hrefs[index].startsWith("http") ? ` target="_blank" rel="noreferrer"` : ""} data-i18n="welcome.footerLinks.${index}">${escapeHtml(label)}</a>`)
    .join("\n        ");
}

function renderSetupPrimaryContent(route, content, step, service = {}) {
  if (route.key === "mode") {
    return renderModeChoicePanel(content);
  }
  if (route.key === "aliyun-account") {
    return renderAliyunAccountDecision(content, service);
  }
  if (route.key === "aliyun-credential") {
    return renderAliyunCredentialPanel(service);
  }
  if (route.key === "aliyun-permissions") {
    return renderAliyunPermissionsPanel();
  }
  if (route.key === "aliyun-storage") {
    return renderAliyunStoragePanel();
  }
  if (route.key === "aliyun-services") {
    return renderAliyunServicesPanel(service);
  }
  if (route.key === "aliyun-model-quality") {
    return renderAliyunModelQualityPanel();
  }
  if (route.key === "aliyun-search") {
    return renderAliyunSearchPanel();
  }
  if (route.key === "template") {
    return renderSetupTemplateChoicePanel();
  }
  if (route.key === "retrieval") {
    return renderRetrievalStrategyPanel();
  }
  if (route.key === "project") {
    return renderSetupProjectPanel(service);
  }
  if (route.key === "environment" || route.key === "scan" || route.key === "plan") {
    return renderSetupStepWorkspace(route.key);
  }
  if (route.key === "finish") {
    return renderSetupFinishWorkspace(content);
  }

  const draftPanel = renderSetupDraftPanel(route.key, service);
  if (draftPanel) {
    return `${renderSetupTaskBrief(route.key)}
        ${renderAliyunStepGuide(route.key)}
        ${draftPanel}`;
  }
  return renderSetupFallbackPanel(route, content, step);
}

function renderSetupStepWorkspace(stepKey) {
  const panel = setupDraftPanels[stepKey];
  if (!panel) return "";
  if (stepKey === "plan") return renderSetupPlanWorkspace(panel);
  const action = setupPanelActions(panel)[0];
  const resultKey = action?.resultKey || action?.key || stepKey;
  const checklist = panel.checklist.map((item, index) => `<li class="step-workspace-scope-item" data-draft-check="${escapeHtml(stepKey)}.${index}">${escapeHtml(item.zh)}</li>`).join("\n              ");
  return `<section class="setup-step-workspace" data-setup-step-workspace="${escapeHtml(stepKey)}">
          <article class="step-workspace-card">
            <span class="card-kicker" data-i18n="setup.currentOperation">${escapeHtml(copy.zh.setup.currentOperation)}</span>
            <div class="step-workspace-head">
              <div>
                <h2 data-draft-panel-title="${escapeHtml(stepKey)}">${escapeHtml(panel.title.zh)}</h2>
                <p data-draft-panel-note="${escapeHtml(stepKey)}">${escapeHtml(panel.note.zh)}</p>
              </div>
              ${action ? `<span class="step-workspace-action-name" data-setup-workspace-action="${escapeHtml(action.key)}">${escapeHtml(action.label.zh)}</span>` : ""}
            </div>
            ${checklist ? `<ul class="step-workspace-scope" data-step-workspace-scope="${escapeHtml(stepKey)}">
              ${checklist}
            </ul>` : ""}
            ${action ? `<div class="api-result step-workspace-result" data-step-workspace-result="${escapeHtml(resultKey)}" data-api-result="${escapeHtml(resultKey)}" hidden></div>` : ""}
          </article>
          ${renderSetupStepHint(stepKey, panel)}
        </section>`;
}

function renderSetupPlanWorkspace(panel) {
  const action = setupPanelActions(panel)[0];
  const resultKey = action?.resultKey || action?.key || "plan";
  return `<section class="setup-step-workspace" data-setup-step-workspace="plan">
          <article class="step-workspace-card step-workspace-card--plan">
            <span class="card-kicker" data-i18n="setup.currentOperation">${escapeHtml(copy.zh.setup.currentOperation)}</span>
            <div class="step-workspace-head">
              <div>
                <h2 data-draft-panel-title="plan">${escapeHtml(panel.title.zh)}</h2>
                <p data-draft-panel-note="plan">${escapeHtml(panel.note.zh)}</p>
              </div>
              ${action ? `<span class="step-workspace-action-name" data-setup-workspace-action="${escapeHtml(action.key)}">${escapeHtml(action.label.zh)}</span>` : ""}
            </div>
            <div class="plan-preview-empty" data-plan-preview-empty>
              <strong data-i18n="setup.planEmpty.title">${escapeHtml(copy.zh.setup.planEmpty.title)}</strong>
              <p data-i18n="setup.planEmpty.body">${escapeHtml(copy.zh.setup.planEmpty.body)}</p>
              <ol>
                ${copy.zh.setup.planEmpty.items.map((item, index) => `<li data-i18n="setup.planEmpty.items.${index}">${escapeHtml(item)}</li>`).join("\n                ")}
              </ol>
            </div>
            ${action ? `<div class="api-result step-workspace-result plan-preview-result" data-step-workspace-result="${escapeHtml(resultKey)}" data-api-result="${escapeHtml(resultKey)}" hidden></div>` : ""}
          </article>
          ${renderSetupStepHint("plan", panel)}
        </section>`;
}

function renderSetupStepHint(stepKey, panel) {
  const action = setupPanelActions(panel)[0];
  if (!action?.idle) return "";
  return `<aside class="setup-step-hint" data-setup-step-hint="${escapeHtml(stepKey)}">
          <span class="card-kicker" data-i18n="setup.hintBadge">${escapeHtml(copy.zh.setup.hintBadge)}</span>
          <strong data-i18n="setup.whyThisStep">${escapeHtml(copy.zh.setup.whyThisStep)}</strong>
          <p data-api-action-idle="${escapeHtml(action.key)}">${escapeHtml(action.idle.zh)}</p>
        </aside>`;
}

function renderSetupFinishWorkspace(content) {
  const cards = content.cards || [];
  return `<section class="setup-step-workspace" data-setup-step-workspace="finish">
          <article class="step-workspace-card step-workspace-card--finish">
            <span class="card-kicker" data-i18n="setup.currentOperation">${escapeHtml(copy.zh.setup.currentOperation)}</span>
            <div class="step-workspace-head">
              <div>
                <h2 data-i18n="setup.steps.finish.title">${escapeHtml(content.title || copy.zh.setup.steps.finish.title)}</h2>
                <p ${contentAttr("setup.steps.finish", "lead", copy.zh.setup.steps.finish)}>${escapeHtml(content.lead || copy.zh.setup.steps.finish.lead)}</p>
              </div>
            </div>
            <ul class="step-workspace-scope">
              ${cards.map((card, index) => `<li class="step-workspace-scope-item">
                <strong data-i18n="setup.steps.finish.cards.${index}.0">${escapeHtml(card[0])}</strong>
                <span data-i18n="setup.steps.finish.cards.${index}.1">${escapeHtml(card[1])}</span>
              </li>`).join("\n              ")}
            </ul>
          </article>
        </section>`;
}

function renderSetupTaskBrief(stepKey) {
  const brief = setupTaskBriefs[stepKey];
  if (!brief) return "";
  return `<section class="setup-task-brief" data-setup-task-brief="${escapeHtml(stepKey)}">
          ${["focus", "next", "guard"].map((key) => `<article>
            <span data-i18n="setup.taskBriefLabels.${key}">${escapeHtml(copy.zh.setup.taskBriefLabels[key])}</span>
            <strong data-task-brief="${escapeHtml(stepKey)}.${key}">${escapeHtml(brief[key].zh)}</strong>
          </article>`).join("\n          ")}
        </section>`;
}

function renderAliyunStepGuide(stepKey) {
  const guide = setupAliyunGuides[stepKey];
  if (!guide) return "";
  return `<section class="aliyun-step-guide" data-aliyun-step-guide="${escapeHtml(stepKey)}">
          ${["prepare", "check", "fix"].map((key) => `<article>
            <span data-i18n="setup.actionGuideLabels.${key}">${escapeHtml(copy.zh.setup.actionGuideLabels[key])}</span>
            <p data-aliyun-guide="${escapeHtml(stepKey)}.${key}">${escapeHtml(guide[key].zh)}</p>
          </article>`).join("\n          ")}
        </section>`;
}

function renderModeChoicePanel(content) {
  const choices = [
    { key: "aliyun", card: content.cards[0], resultKey: "setup.modeResultAliyun" },
    { key: "local", card: content.cards[1], resultKey: "setup.modeResultLocal" }
  ];
  return `<section class="mode-decision" aria-label="Run method choices">
          <div class="mode-choice-panel">
            ${choices.map((choice) => {
              const index = choice.key === "aliyun" ? 0 : 1;
              const [title, fit, body, badge, prepareLabel, prepare, nextLabel, nextStep, cta] = choice.card;
              return `<button class="mode-choice-card" type="button" data-mode-option="${choice.key}" aria-pressed="${choice.key === defaultMode}">
                <span class="mode-choice-head">
                  <span class="card-kicker" data-i18n="setup.steps.mode.cards.${index}.3">${escapeHtml(badge)}</span>
                  <span class="mode-choice-selected" data-i18n="setup.currentChoice" aria-hidden="true">${escapeHtml(copy.zh.setup.currentChoice)}</span>
                </span>
                <strong data-i18n="setup.steps.mode.cards.${index}.0">${escapeHtml(title)}</strong>
                <span class="mode-choice-fit" data-i18n="setup.steps.mode.cards.${index}.1">${escapeHtml(fit)}</span>
                <span class="mode-choice-body" data-i18n="setup.steps.mode.cards.${index}.2">${escapeHtml(body)}</span>
                <span class="mode-choice-detail">
                  <span>
                    <b data-i18n="setup.modePrepareLabel">${escapeHtml(prepareLabel)}</b>
                    <em data-i18n="setup.steps.mode.cards.${index}.5">${escapeHtml(prepare)}</em>
                  </span>
                  <span>
                    <b data-i18n="setup.modeNextLabel">${escapeHtml(nextLabel)}</b>
                    <em data-i18n="${choice.resultKey}">${escapeHtml(nextStep)}</em>
                  </span>
                </span>
                <span class="mode-choice-cta" data-mode-choice-cta data-i18n="setup.steps.mode.cards.${index}.8">${escapeHtml(cta)}</span>
              </button>`;
            }).join("\n            ")}
          </div>
          ${renderModeChoiceHint(content.cards[2])}
        </section>`;
}

function renderModeChoiceHint(card) {
  if (!card) return "";
  return `<aside class="mode-choice-hint" data-mode-choice-hint>
          <span class="card-kicker" data-i18n="setup.steps.mode.cards.2.2">${escapeHtml(card[2])}</span>
          <strong data-i18n="setup.steps.mode.cards.2.0">${escapeHtml(card[0])}</strong>
          <p data-i18n="setup.steps.mode.cards.2.1">${escapeHtml(card[1])}</p>
        </aside>`;
}

function renderAliyunAccountDecision(content, service = {}) {
  const methods = [
    {
      key: "dedicated-ram",
      card: content.cards[0]
    },
    {
      key: "existing-profile",
      card: content.cards[1]
    },
    {
      key: "need-create",
      card: content.cards[2]
    }
  ];

  return `<section class="account-method-panel" aria-label="Aliyun account choices" data-account-method-panel>
          <input type="hidden" data-draft-field="aliyun.account.method" value="dedicated-ram">
          <div class="account-method-grid">
            ${methods.map((method, index) => {
              const [title, fit, body, badge, impactLabel, impact, nextLabel, nextStep] = method.card;
              return `<button class="account-method-card" type="button" data-account-method-card data-account-method-option="${escapeHtml(method.key)}" data-selected="${method.key === "dedicated-ram"}" aria-pressed="${method.key === "dedicated-ram"}">
                <span class="account-method-head">
                  <span class="card-kicker" data-i18n="setup.steps.aliyun-account.cards.${index}.3">${escapeHtml(badge)}</span>
                  <span class="account-method-selected" data-i18n="setup.currentChoice" aria-hidden="true">${escapeHtml(copy.zh.setup.currentChoice)}</span>
                </span>
                <strong data-i18n="setup.steps.aliyun-account.cards.${index}.0">${escapeHtml(title)}</strong>
                <span class="account-method-fit" data-i18n="setup.steps.aliyun-account.cards.${index}.1">${escapeHtml(fit)}</span>
                <span class="account-method-body" data-i18n="setup.steps.aliyun-account.cards.${index}.2">${escapeHtml(body)}</span>
                <span class="account-method-impact">
                  <span>
                    <b data-i18n="setup.steps.aliyun-account.cards.${index}.4">${escapeHtml(impactLabel)}</b>
                    <em data-i18n="setup.steps.aliyun-account.cards.${index}.5">${escapeHtml(impact)}</em>
                  </span>
                  <span>
                    <b data-i18n="setup.steps.aliyun-account.cards.${index}.6">${escapeHtml(nextLabel)}</b>
                    <em data-i18n="setup.steps.aliyun-account.cards.${index}.7">${escapeHtml(nextStep)}</em>
                  </span>
                </span>
              </button>`;
            }).join("\n            ")}
          </div>
          <section class="account-method-stage" data-account-method-stage data-stage-state="idle" aria-live="polite">
            <div class="account-method-result api-result" data-account-method-result data-api-result="account-method-result" hidden></div>
            ${renderAccountCreationGuide(service)}
          </section>
        </section>`;
}

function renderAccountCreationGuide(service = {}) {
  return `<div class="account-creation-guide" data-account-creation-guide hidden>
            <div>
              <span class="card-kicker" data-i18n="setup.accountGuide.badge">${escapeHtml(copy.zh.setup.accountGuide.badge)}</span>
              <strong data-i18n="setup.accountGuide.title">${escapeHtml(copy.zh.setup.accountGuide.title)}</strong>
              <p data-i18n="setup.accountGuide.body">${escapeHtml(copy.zh.setup.accountGuide.body)}</p>
            </div>
            <ol>
              ${copy.zh.setup.accountGuide.steps.map((item, index) => `<li data-i18n="setup.accountGuide.steps.${index}">${escapeHtml(item)}</li>`).join("\n              ")}
            </ol>
            <div class="account-guide-actions">
              <a class="secondary-action" href="https://ram.console.aliyun.com/users" target="_blank" rel="noreferrer" data-account-guide-link data-i18n="setup.accountGuide.openRam">${escapeHtml(copy.zh.setup.accountGuide.openRam)}</a>
              <button class="primary-action" type="button" data-account-guide-continue data-account-next="${pageHref(service, "/setup/aliyun/credential")}" data-i18n="setup.accountGuide.continue">${escapeHtml(copy.zh.setup.accountGuide.continue)}</button>
            </div>
          </div>`;
}

function renderAliyunCredentialPanel(service = {}) {
  const panel = setupDraftPanels["aliyun-credential"];
  const accessKeyId = panel.fields.find((field) => field.key === "aliyun.credential.accessKeyId");
  const accessKeySecret = panel.fields.find((field) => field.key === "aliyun.credential.accessKeySecret");
  const saveTarget = panel.fields.find((field) => field.key === "aliyun.credential.saveTarget");
  const locations = service.credentialLocations || {};

  return `<section class="credential-setup" data-credential-setup>
          <div class="credential-setup-grid">
            <div class="credential-form-card">
              <div class="credential-current-method" data-credential-current-method>
                <span data-i18n="setup.credentialCurrent">${escapeHtml(copy.zh.setup.credentialCurrent)}</span>
                <strong data-i18n="setup.credentialCurrentMethod">${escapeHtml(copy.zh.setup.credentialCurrentMethod)}</strong>
              </div>
              <form class="setup-draft-form credential-draft-form" autocomplete="off">
                <div class="credential-form-head">
                  <strong data-i18n="setup.credentialRequiredTitle">${escapeHtml(copy.zh.setup.credentialRequiredTitle)}</strong>
                  <p data-i18n="setup.credentialRequiredBody">${escapeHtml(copy.zh.setup.credentialRequiredBody)}</p>
                </div>
                <div class="setup-draft-fields credential-required-fields" data-draft-fields="aliyun-credential">
                  ${renderDraftField(accessKeyId)}
                  ${renderDraftField(accessKeySecret)}
                </div>
                <details class="credential-advanced" data-credential-advanced-toggle>
                  <summary data-i18n="setup.credentialAdvanced">${escapeHtml(copy.zh.setup.credentialAdvanced)}</summary>
                  <p data-i18n="setup.credentialAdvancedNote">${escapeHtml(copy.zh.setup.credentialAdvancedNote)}</p>
                  ${renderCredentialSaveTargetField(saveTarget)}
                  ${renderCredentialLocations(locations)}
                  <label class="credential-env-copy">
                    <input type="checkbox" data-credential-env-copy>
                    <span data-i18n="setup.credentialEnvCopy">${escapeHtml(copy.zh.setup.credentialEnvCopy)}</span>
                  </label>
                </details>
                <p class="draft-save-state" data-i18n="setup.draftLocal" data-status="local">${escapeHtml(copy.zh.setup.draftLocal)}</p>
              </form>
              <div class="api-result credential-api-result" data-api-result="save-aliyun-credentials" hidden></div>
            </div>
            <aside class="credential-help-card">
              ${renderCredentialHelpItem("source")}
              ${renderCredentialHelpItem("root")}
              ${renderCredentialHelpItem("test")}
            </aside>
          </div>
        </section>`;
}

function renderAliyunPermissionsPanel() {
  const permission = copy.zh.setup.permissionCheck;
  return `<section class="permission-check" data-permission-check-panel>
          <section class="permission-action-card" data-permission-primary-action>
            <div class="permission-action-copy">
              <span class="card-kicker" data-i18n="setup.permissionCheck.badge">${escapeHtml(permission.badge)}</span>
              <strong data-i18n="setup.permissionCheck.title">${escapeHtml(permission.title)}</strong>
              <p data-i18n="setup.permissionCheck.body">${escapeHtml(permission.body)}</p>
            </div>
            <div class="permission-scope-strip" aria-label="${escapeHtml(permission.scopeTitle)}">
              ${permission.scope.map((item, index) => `<article data-permission-scope="${escapeHtml(item.key)}">
                <span>${String(index + 1).padStart(2, "0")}</span>
                <strong data-i18n="setup.permissionCheck.scope.${index}.title">${escapeHtml(item.title)}</strong>
                <p data-i18n="setup.permissionCheck.scope.${index}.body">${escapeHtml(item.body)}</p>
                <em class="permission-scope-status" data-permission-scope-status data-permission-status="pending">${escapeHtml(permission.statusPending)}</em>
              </article>`).join("\n              ")}
            </div>
            <div class="api-result permission-api-result" data-permission-result-status data-api-result="check-aliyun-permissions" hidden></div>
          </section>
          <aside class="permission-fix-hint" data-permission-fix-hint>
            <span class="card-kicker" data-i18n="setup.permissionCheck.fixBadge">${escapeHtml(permission.fixBadge)}</span>
            <strong data-i18n="setup.permissionCheck.fixTitle">${escapeHtml(permission.fixTitle)}</strong>
            <p data-i18n="setup.permissionCheck.fixBody">${escapeHtml(permission.fixBody)}</p>
            <a href="https://ram.console.aliyun.com/users" target="_blank" rel="noreferrer" data-i18n="setup.permissionCheck.ramLink">${escapeHtml(permission.ramLink)}</a>
          </aside>
        </section>`;
}

function renderAliyunStoragePanel() {
  const panel = setupDraftPanels["aliyun-storage"];
  const sourceRegion = panel.fields.find((field) => field.key === "aliyun.region");
  const sourceAction = panel.fields.find((field) => field.key === "aliyun.storage.action");
  const sourceBucket = panel.fields.find((field) => field.key === "aliyun.storage.bucket");
  const searchMode = panel.fields.find((field) => field.key === "aliyun.search.storageMode");
  const searchRegion = panel.fields.find((field) => field.key === "aliyun.search.region");
  const searchBucket = panel.fields.find((field) => field.key === "aliyun.search.bucket");

  return `<section class="storage-setup" data-storage-setup>
          <div class="storage-card-grid">
            <article class="storage-card storage-card--source">
              <header class="storage-card-head">
                <span class="card-kicker" data-i18n="setup.storage.sourceBadge">${escapeHtml(copy.zh.setup.storage.sourceBadge)}</span>
                <strong data-i18n="setup.storage.sourceTitle">${escapeHtml(copy.zh.setup.storage.sourceTitle)}</strong>
                <p data-i18n="setup.storage.sourceBody">${escapeHtml(copy.zh.setup.storage.sourceBody)}</p>
              </header>
              <div class="storage-field-grid">
                ${renderDraftField(sourceRegion)}
                ${renderDraftField(sourceAction)}
                ${renderBucketNameField(sourceBucket, "source")}
              </div>
            </article>
            <article class="storage-card storage-card--search">
              <header class="storage-card-head">
                <span class="card-kicker" data-i18n="setup.storage.searchBadge">${escapeHtml(copy.zh.setup.storage.searchBadge)}</span>
                <strong data-i18n="setup.storage.searchTitle">${escapeHtml(copy.zh.setup.storage.searchTitle)}</strong>
                <p data-i18n="setup.storage.searchBody">${escapeHtml(copy.zh.setup.storage.searchBody)}</p>
              </header>
              <div class="storage-field-grid">
                ${renderDraftField(searchMode)}
                ${renderDraftField(searchRegion)}
                ${renderBucketNameField(searchBucket, "vector")}
              </div>
            </article>
          </div>
          <aside class="storage-hint">
            <span class="card-kicker" data-i18n="setup.storage.hintBadge">${escapeHtml(copy.zh.setup.storage.hintBadge)}</span>
            <strong data-i18n="setup.storage.hintTitle">${escapeHtml(copy.zh.setup.storage.hintTitle)}</strong>
            <p data-i18n="setup.storage.hintBody">${escapeHtml(copy.zh.setup.storage.hintBody)}</p>
          </aside>
          <div class="api-result storage-api-result" data-api-result="preview-aliyun-storage" hidden></div>
        </section>`;
}

function renderAliyunServicesPanel(service = {}) {
  const panel = setupDraftPanels["aliyun-services"];
  const providerCopy = copy.zh.setup.modelProvider;
  const locations = service.modelProviderLocations || {};
  const secureLocal = locations.secureLocal || "";

  return `<section class="model-provider-setup" data-model-provider-setup>
          <section class="model-provider-form-card">
            <header class="model-provider-card-head">
              <span class="card-kicker" data-i18n="setup.modelProvider.badge">${escapeHtml(providerCopy.badge)}</span>
              <strong data-i18n="setup.modelProvider.title">${escapeHtml(providerCopy.title)}</strong>
              <p data-i18n="setup.modelProvider.body">${escapeHtml(providerCopy.body)}</p>
            </header>
            <form class="model-provider-form setup-draft-form" autocomplete="off">
              <div class="model-provider-field-grid" data-draft-fields="aliyun-services">
                ${panel.fields.map((field) => renderDraftField(field)).join("\n                ")}
              </div>
              <details class="credential-advanced model-provider-location-toggle" data-model-provider-location-toggle>
                <summary data-i18n="setup.modelProvider.keyPathLabel">${escapeHtml(providerCopy.keyPathLabel)}</summary>
                <div class="model-provider-location" data-model-provider-location>
                  <code data-model-provider-secure-path data-local-path-value="model-provider-secure" title="${escapeHtml(secureLocal)}">${escapeHtml(secureLocal)}</code>
                  <div class="credential-path-actions">
                    <button class="secondary-action quiet-action" type="button" data-copy-local-path="model-provider-secure" data-i18n="setup.copyPath">${escapeHtml(copy.zh.setup.copyPath)}</button>
                    <button class="secondary-action quiet-action" type="button" data-open-local-path="model-provider-directory" data-i18n="setup.openDirectory">${escapeHtml(copy.zh.setup.openDirectory)}</button>
                  </div>
                </div>
              </details>
              <p class="draft-save-state" data-i18n="setup.draftLocal" data-status="local">${escapeHtml(copy.zh.setup.draftLocal)}</p>
            </form>
            <div class="api-result model-provider-api-result" data-api-result="test-aliyun-model-provider" hidden></div>
          </section>
          <aside class="model-provider-hint-strip" data-model-provider-hint-strip>
            <span class="card-kicker" data-i18n="setup.modelProvider.hintBadge">${escapeHtml(providerCopy.hintBadge)}</span>
            <strong data-i18n="setup.modelProvider.keyTitle">${escapeHtml(providerCopy.keyTitle)}</strong>
            <p><span data-i18n="setup.modelProvider.keyBody">${escapeHtml(providerCopy.keyBody)}</span> <span data-i18n="setup.modelProvider.workspaceTip">${escapeHtml(providerCopy.workspaceTip)}</span></p>
          </aside>
        </section>`;
}

function renderAliyunModelQualityPanel() {
  const panel = setupDraftPanels["aliyun-model-quality"];
  const profile = panel.fields.find((field) => field.key === "aliyun.services.profile");
  const modelCopy = copy.zh.setup.modelQuality;
  const profileCards = copy.zh.setup.steps["aliyun-model-quality"].cards;
  const profileValues = ["recommended", "high-quality", "low-cost"];

  return `<section class="model-quality-setup" data-model-quality-setup>
          <section class="model-quality-primary-card" data-model-quality-primary-card>
            <header class="model-quality-card-head">
              <span class="card-kicker" data-i18n="setup.modelQuality.badge">${escapeHtml(modelCopy.badge)}</span>
              <strong data-i18n="setup.modelQuality.title">${escapeHtml(modelCopy.title)}</strong>
              <p data-i18n="setup.modelQuality.body">${escapeHtml(modelCopy.body)}</p>
            </header>
            <form class="model-quality-form setup-draft-form" autocomplete="off">
              <div class="model-quality-profile-grid" data-model-quality-profile-grid>
                ${profileCards.map((card, index) => {
                  const [title, body, badge] = card;
                  const value = profileValues[index] || "";
                  return `<button class="model-quality-profile-card" type="button" data-model-quality-profile-card="${escapeHtml(value)}" data-selected="${index === 0}">
                    <span class="card-kicker" data-i18n="setup.steps.aliyun-model-quality.cards.${index}.2">${escapeHtml(badge)}</span>
                    <strong data-i18n="setup.steps.aliyun-model-quality.cards.${index}.0">${escapeHtml(title)}</strong>
                    <p data-i18n="setup.steps.aliyun-model-quality.cards.${index}.1">${escapeHtml(body)}</p>
                  </button>`;
                }).join("\n                ")}
              </div>
              <div class="model-catalog-toolbar" data-model-catalog-toolbar>
                <strong data-i18n="setup.modelQuality.fieldsTitle">${escapeHtml(modelCopy.fieldsTitle)}</strong>
                <span class="model-catalog-state" data-model-catalog-state data-model-catalog-status="local" data-i18n="setup.modelQuality.catalogBuiltIn">${escapeHtml(modelCopy.catalogBuiltIn)}</span>
                <button class="secondary-action model-catalog-refresh" type="button" data-refresh-model-catalog aria-label="${escapeHtml(modelCopy.refreshModels)}" title="${escapeHtml(modelCopy.refreshModels)}" data-i18n-aria-label="setup.modelQuality.refreshModels" data-i18n-title="setup.modelQuality.refreshModels">
                  <svg class="icon" aria-hidden="true"><use href="#icon-refresh"></use></svg>
                </button>
                <details class="model-catalog-help" data-model-catalog-help>
                  <summary aria-label="${escapeHtml(modelCopy.fieldsBody)}" title="${escapeHtml(modelCopy.fieldsBody)}">?</summary>
                  <p data-i18n="setup.modelQuality.catalogHelp">${escapeHtml(modelCopy.catalogHelp)}</p>
                </details>
              </div>
              <div class="model-slot-grid" data-draft-fields="aliyun-model-quality">
                ${renderDraftField(profile)}
                ${aliyunModelSlots.map((slot) => renderModelSlotCard(slot, panel)).join("\n                ")}
              </div>
            </form>
            <div class="api-result model-quality-api-result" data-api-result="save-aliyun-model-quality" hidden></div>
          </section>
          <aside class="model-quality-hint-strip" data-model-quality-hint-strip>
            <span class="card-kicker" data-i18n="setup.modelQuality.hintBadge">${escapeHtml(modelCopy.hintBadge)}</span>
            <strong data-i18n="setup.modelQuality.hintTitle">${escapeHtml(modelCopy.hintTitle)}</strong>
            <p data-i18n="setup.modelQuality.hintBody">${escapeHtml(modelCopy.hintBody)}</p>
          </aside>
        </section>`;
}

function renderRetrievalStrategyPanel() {
  const panel = setupDraftPanels.retrieval;
  const profileField = panel.fields.find((field) => field.key === "retrieval.profile");
  const strategyCopy = copy.zh.setup.retrievalStrategy;
  const defaultProfile = retrievalProfiles.find((profile) => profile.id === defaultRetrievalProfileId) || retrievalProfiles[0];

  return `<section class="retrieval-setup" data-retrieval-setup>
          <section class="retrieval-primary-card">
            <header class="retrieval-card-head">
              <span class="card-kicker" data-i18n="setup.retrievalStrategy.badge">${escapeHtml(strategyCopy.badge)}</span>
              <strong data-i18n="setup.retrievalStrategy.title">${escapeHtml(strategyCopy.title)}</strong>
              <p data-i18n="setup.retrievalStrategy.body">${escapeHtml(strategyCopy.body)}</p>
            </header>
            <form class="retrieval-form setup-draft-form" autocomplete="off">
              ${renderDraftField(profileField)}
              <div class="retrieval-profile-grid" data-retrieval-profile-grid>
                ${retrievalProfiles.map((profile, index) => `<button class="retrieval-profile-card" type="button" data-retrieval-profile-card="${escapeHtml(profile.id)}" data-selected="${profile.id === defaultRetrievalProfileId}">
                    <span class="card-kicker" data-retrieval-profile-badge="${escapeHtml(profile.id)}">${escapeHtml(profile.badge.zh)}</span>
                    <strong data-retrieval-profile-title="${escapeHtml(profile.id)}">${escapeHtml(profile.label.zh)}</strong>
                    <span class="retrieval-profile-fit" data-retrieval-profile-fit="${escapeHtml(profile.id)}">${escapeHtml(profile.fit.zh)}</span>
                    <p data-retrieval-profile-body="${escapeHtml(profile.id)}">${escapeHtml(profile.body.zh)}</p>
                  </button>`).join("\n                ")}
              </div>
              <details class="retrieval-advanced" data-retrieval-advanced>
                <summary>
                  <span data-i18n="setup.retrievalStrategy.advancedTitle">${escapeHtml(strategyCopy.advancedTitle)}</span>
                  <strong data-retrieval-profile-current>${escapeHtml(defaultProfile?.label?.zh || "")}</strong>
                </summary>
                <p data-i18n="setup.retrievalStrategy.methodsBody">${escapeHtml(strategyCopy.methodsBody)}</p>
                <div class="retrieval-method-list" data-retrieval-method-list>
                  ${renderRetrievalMethodItems(defaultProfile)}
                </div>
              </details>
            </form>
            <div class="api-result retrieval-api-result" data-api-result="save-retrieval-strategy" hidden></div>
          </section>
          <aside class="retrieval-hint-strip" data-retrieval-hint-strip>
            <span class="card-kicker" data-i18n="setup.retrievalStrategy.hintBadge">${escapeHtml(strategyCopy.hintBadge)}</span>
            <strong data-i18n="setup.retrievalStrategy.hintTitle">${escapeHtml(strategyCopy.hintTitle)}</strong>
            <p data-i18n="setup.retrievalStrategy.hintBody">${escapeHtml(strategyCopy.hintBody)}</p>
          </aside>
        </section>`;
}

function renderRetrievalMethodItems(profile) {
  const methods = profile?.methods || [];
  return methods.map((method) => {
    const item = retrievalMethods[method] || { label: { zh: method, en: method }, body: { zh: "", en: "" } };
    return `<article data-retrieval-method-item="${escapeHtml(method)}">
              <strong>${escapeHtml(item.label.zh)}</strong>
              <span>${escapeHtml(item.body.zh)}</span>
            </article>`;
  }).join("\n                  ");
}

function renderModelSlotCard(slot, panel) {
  const field = panel.fields.find((item) => item.key === slot.draftKey);
  const selected = aliyunModelCatalog[slot.key]?.find((item) => item.id === field?.defaultValue)
    || aliyunModelCatalog[slot.key]?.[0];
  const status = selected?.status || "available";
  return `<section class="model-slot-card" data-model-slot="${escapeHtml(slot.key)}">
            <header class="model-slot-head">
              <span class="model-slot-index">${escapeHtml(modelSlotNumber(slot.key))}</span>
              <strong data-model-slot-title="${escapeHtml(slot.key)}">${escapeHtml(slot.label.zh)}</strong>
              <span class="model-status-pill" data-model-slot-status="${escapeHtml(slot.key)}" data-status="${escapeHtml(status)}">${escapeHtml(modelStatusLabel(status).zh)}</span>
              <span class="model-slot-actions" data-model-slot-actions="${escapeHtml(slot.key)}">
                <a class="model-slot-icon-link" href="${escapeHtml(selected?.docUrl || "https://help.aliyun.com/zh/model-studio/models")}" target="_blank" rel="noreferrer" data-model-slot-doc="${escapeHtml(slot.key)}" aria-label="${escapeHtml(copy.zh.setup.modelQuality.modelDetail)}" title="${escapeHtml(copy.zh.setup.modelQuality.modelDetail)}" data-i18n-aria-label="setup.modelQuality.modelDetail" data-i18n-title="setup.modelQuality.modelDetail">
                  <svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>
                  <span class="visually-hidden" data-i18n="setup.modelQuality.modelDetail">${escapeHtml(copy.zh.setup.modelQuality.modelDetail)}</span>
                </a>
                <a class="model-slot-icon-link" href="${escapeHtml(selected?.pricingUrl || "https://help.aliyun.com/zh/model-studio/model-pricing")}" target="_blank" rel="noreferrer" data-model-slot-pricing="${escapeHtml(slot.key)}" aria-label="${escapeHtml(copy.zh.setup.modelQuality.modelPrice)}" title="${escapeHtml(copy.zh.setup.modelQuality.modelPrice)}" data-i18n-aria-label="setup.modelQuality.modelPrice" data-i18n-title="setup.modelQuality.modelPrice">
                  <svg class="icon" aria-hidden="true"><use href="#icon-receipt"></use></svg>
                  <span class="visually-hidden" data-i18n="setup.modelQuality.modelPrice">${escapeHtml(copy.zh.setup.modelQuality.modelPrice)}</span>
                </a>
              </span>
            </header>
            ${renderDraftFieldControl(field)}
            <div class="model-slot-detail" data-model-slot-detail="${escapeHtml(slot.key)}">
              <p data-model-slot-fit="${escapeHtml(slot.key)}">${escapeHtml(selected?.fit?.zh || "")}</p>
              <p data-model-slot-impact="${escapeHtml(slot.key)}">${escapeHtml(selected?.impact?.zh || "")}</p>
            </div>
          </section>`;
}

function renderDraftFieldControl(field) {
  const sensitiveAttr = field.sensitive ? " data-draft-sensitive=\"true\"" : "";
  const inputAttrs = `data-draft-field="${escapeHtml(field.key)}"${sensitiveAttr}`;
  const placeholder = field.placeholder?.zh ? ` placeholder="${escapeHtml(field.placeholder.zh)}"` : "";
  const valueAttr = !field.sensitive && field.defaultValue ? ` value="${escapeHtml(field.defaultValue)}"` : "";
  const label = escapeHtml(field.label?.zh || "");

  if (field.type === "select") {
    return `<div class="model-slot-control">
              <select ${inputAttrs} aria-label="${label}">
                ${field.options.map((option, index) => {
                  const selected = field.defaultValue === option.value ? " selected" : "";
                  return `<option value="${escapeHtml(option.value)}" data-draft-option="${escapeHtml(field.key)}.${index}"${selected}>${escapeHtml(option.label.zh)}</option>`;
                }).join("\n                ")}
              </select>
            </div>`;
  }

  return `<div class="model-slot-control">
            <input type="${field.type === "password" ? "password" : "text"}" ${inputAttrs}${placeholder}${valueAttr} aria-label="${label}">
          </div>`;
}

function catalogFieldOptions(slotKey) {
  return (aliyunModelCatalog[slotKey] || []).map((item) => ({
    value: item.id,
    label: {
      zh: `${item.label.zh}${item.status === "recommended" ? "（推荐）" : ""}`,
      en: `${item.label.en}${item.status === "recommended" ? " (recommended)" : ""}`
    }
  }));
}

function modelSlotNumber(slotKey) {
  return { ocr: "01", organizer: "02", embedding: "03", rerank: "04" }[slotKey] || "00";
}

function modelStatusLabel(status) {
  return {
    recommended: { zh: "推荐", en: "Recommended" },
    available: { zh: "可用", en: "Available" }
  }[status] || { zh: "可用", en: "Available" };
}

function renderAliyunSearchPanel() {
  const panel = setupDraftPanels["aliyun-search"];
  const searchAction = panel.fields.find((field) => field.key === "aliyun.search.action");
  const searchIndex = panel.fields.find((field) => field.key === "aliyun.search.index");
  const searchCopy = copy.zh.setup.search;

  return `<section class="search-setup" data-search-setup>
          <section class="search-primary-card" data-search-primary-card>
            <header class="search-card-head">
              <span class="card-kicker" data-i18n="setup.search.badge">${escapeHtml(searchCopy.badge)}</span>
              <strong data-i18n="setup.search.title">${escapeHtml(searchCopy.title)}</strong>
              <p data-i18n="setup.search.body">${escapeHtml(searchCopy.body)}</p>
            </header>
            <form class="search-index-form setup-draft-form" autocomplete="off">
              <div class="search-index-copy">
                <strong data-i18n="setup.search.indexTitle">${escapeHtml(searchCopy.indexTitle)}</strong>
                <p data-i18n="setup.search.indexBody">${escapeHtml(searchCopy.indexBody)}</p>
              </div>
              <div class="search-field-grid" data-draft-fields="aliyun-search">
                ${renderDraftField(searchAction)}
                ${renderDraftField(searchIndex)}
              </div>
            </form>
            <div class="api-result search-api-result" data-api-result="save-aliyun-search" hidden></div>
          </section>
          <aside class="search-side-notes">
            <article data-search-model-note>
              <span class="card-kicker" data-i18n="setup.search.modelNoteBadge">${escapeHtml(searchCopy.modelNoteBadge)}</span>
              <strong data-i18n="setup.search.modelNoteTitle">${escapeHtml(searchCopy.modelNoteTitle)}</strong>
              <p data-i18n="setup.search.modelNoteBody">${escapeHtml(searchCopy.modelNoteBody)}</p>
            </article>
            <article>
              <span class="card-kicker" data-i18n="setup.search.guardBadge">${escapeHtml(searchCopy.guardBadge)}</span>
              <strong data-i18n="setup.search.guardTitle">${escapeHtml(searchCopy.guardTitle)}</strong>
              <p data-i18n="setup.search.guardBody">${escapeHtml(searchCopy.guardBody)}</p>
            </article>
          </aside>
        </section>`;
}

function renderBucketNameField(field, bucketKind) {
  if (!field) return "";
  const inputId = draftFieldInputId(field.key);
  const placeholder = field.placeholder?.zh ? ` placeholder="${escapeHtml(field.placeholder.zh)}"` : "";
  return `<div class="draft-field storage-bucket-field" data-storage-bucket-field="${escapeHtml(bucketKind)}">
            <label for="${escapeHtml(inputId)}" data-draft-label="${escapeHtml(field.key)}">${escapeHtml(field.label.zh)}</label>
            <div class="draft-field-row storage-bucket-row">
              <input id="${escapeHtml(inputId)}" type="text" data-draft-field="${escapeHtml(field.key)}"${placeholder}>
              <button class="secondary-action path-picker-action" type="button" data-generate-bucket-name="${escapeHtml(bucketKind)}" data-bucket-target="${escapeHtml(field.key)}" data-i18n="setup.storage.generateName">${escapeHtml(copy.zh.setup.storage.generateName)}</button>
            </div>
          </div>`;
}

function renderCredentialSaveTargetField(field) {
  if (!field) return "";
  return `<input type="hidden" data-draft-field="${escapeHtml(field.key)}" value="${escapeHtml(field.defaultValue || "secure-local")}">`;
}

function renderCredentialLocations(locations = {}) {
  const secureLocal = locations.secureLocal || "";
  const envFile = locations.envFile || "";
  const securityLabelZh = locations.security?.label?.zh || copy.zh.setup.credentialSecurityLabel;
  const securityLabelEn = locations.security?.label?.en || securityLabelZh;
  return `<div class="credential-location-list">
              <article>
                <span data-i18n="setup.credentialSecurePathLabel">${escapeHtml(copy.zh.setup.credentialSecurePathLabel)}</span>
                <code data-credential-secure-path data-local-path-value="credential-secure" title="${escapeHtml(secureLocal)}">${escapeHtml(secureLocal)}</code>
                <small><span data-i18n="setup.credentialSecurityLabel">${escapeHtml(copy.zh.setup.credentialSecurityLabel)}</span>: <em data-credential-security-label data-security-label-zh="${escapeHtml(securityLabelZh)}" data-security-label-en="${escapeHtml(securityLabelEn)}">${escapeHtml(securityLabelZh)}</em></small>
                <div class="credential-path-actions">
                  <button class="secondary-action quiet-action" type="button" data-copy-local-path="credential-secure" data-i18n="setup.copyPath">${escapeHtml(copy.zh.setup.copyPath)}</button>
                  <button class="secondary-action quiet-action" type="button" data-open-local-path="credential-directory" data-i18n="setup.openDirectory">${escapeHtml(copy.zh.setup.openDirectory)}</button>
                </div>
              </article>
              <article>
                <span data-i18n="setup.credentialEnvPathLabel">${escapeHtml(copy.zh.setup.credentialEnvPathLabel)}</span>
                <code data-credential-env-path data-local-path-value="project-env" title="${escapeHtml(envFile)}">${escapeHtml(envFile)}</code>
                <div class="credential-path-actions">
                  <button class="secondary-action quiet-action" type="button" data-copy-local-path="project-env" data-i18n="setup.copyPath">${escapeHtml(copy.zh.setup.copyPath)}</button>
                  <button class="secondary-action quiet-action" type="button" data-open-local-path="project-env-directory" data-i18n="setup.openDirectory">${escapeHtml(copy.zh.setup.openDirectory)}</button>
                </div>
              </article>
            </div>`;
}

function renderCredentialHelpItem(key) {
  return `<article>
              <span class="card-kicker" data-i18n="setup.credentialHelp.${key}Title">${escapeHtml(copy.zh.setup.credentialHelp[`${key}Title`])}</span>
              <p data-i18n="setup.credentialHelp.${key}Body">${escapeHtml(copy.zh.setup.credentialHelp[`${key}Body`])}</p>
            </article>`;
}

function renderSetupFallbackPanel(route, content, step) {
  return `<section class="setup-focus-panel">
          <strong data-i18n="setup.steps.${route.key}.label">${escapeHtml(step.label)}</strong>
          <p ${contentAttr(`setup.steps.${route.key}`, "lead", step)}>${escapeHtml(content.lead)}</p>
        </section>`;
}

function renderSetupSupportContent(route, content, step) {
  if (isFocusedSetupPage(route.key)) return "";
  const modeContext = renderSetupModeContext();
  return `${modeContext}
          ${renderSetupSupportNotes(route, content.cards, step)}`;
}

function renderSetupModeContext() {
  return `<section class="setup-help-block setup-mode-context">
          <span class="panel-label" data-i18n="app.currentMode">${escapeHtml(copy.zh.app.currentMode)}</span>
          <strong data-mode-label>${escapeHtml(copy.zh.modes[defaultMode].label)}</strong>
          <p data-mode-description>${escapeHtml(copy.zh.modes[defaultMode].description)}</p>
        </section>`;
}

function renderSetupSupportNotes(route, cards, step) {
  if (!cards?.length) return "";
  return `<section class="setup-help-block">
          <span class="panel-label" data-i18n="${route.key === "mode" ? "setup.modeChoiceTitle" : "setup.supportTitle"}">${escapeHtml(route.key === "mode" ? copy.zh.setup.modeChoiceTitle : copy.zh.setup.supportTitle)}</span>
          <ul class="setup-note-list">
            ${cards.map((card, index) => renderSetupNote(route, card, route.key === "mode" ? index + 2 : index, step)).join("\n            ")}
          </ul>
        </section>`;
}

function renderSetupNote(route, card, index, step) {
  const prefix = step.modes ? `setup.steps.${route.key}.modes.{mode}.cards` : `setup.steps.${route.key}.cards`;
  const attr = step.modes ? "data-mode-i18n" : "data-i18n";
  return `<li>
              <span class="card-kicker" ${attr}="${prefix}.${index}.2">${escapeHtml(card[2])}</span>
              <strong ${attr}="${prefix}.${index}.0">${escapeHtml(card[0])}</strong>
              <p ${attr}="${prefix}.${index}.1">${escapeHtml(card[1])}</p>
            </li>`;
}

function renderConsoleMainContent(route, content, page, service = {}) {
  if (route.key === "overview") {
    return `${renderOverviewStatusPanel(service)}
        ${renderOverviewBuildFlow(content, page)}`;
  }
  if (route.key === "knowledge-bases") {
    return renderKnowledgeBaseManagement(service);
  }
  if (route.key === "build") {
    return renderBuildKnowledgePanel(content, page, service);
  }
  if (route.key === "execution") {
    return renderLatestJobPanel(service);
  }
  if (route.key === "documents") {
    return renderDocumentManagement(service);
  }
  if (route.key === "document-asset") {
    return renderDocumentAssetViewer(service);
  }
  if (route.key === "versions") {
    return renderVersionRecordsPanel(service);
  }
  if (route.key === "evaluation") {
    return renderEvaluationDashboardPanel(service);
  }
  if (route.key === "feedback-review") {
    return renderFeedbackReviewPanel(service);
  }
  if (route.key === "integration") {
    return renderIntegrationPanel(service);
  }
  if (route.key === "api-docs") {
    return renderApiDocsPanel(service);
  }
  if (route.key === "ask") {
    return renderAskPanel(service);
  }
  if (route.key === "feedback") {
    return renderQueryFeedbackPanel(service);
  }
  if (route.key === "maintenance") {
    return renderMaintenancePanel(service);
  }

  return `<section class="card-grid">
          ${content.cards.map((card, index) => renderCard(`console.pages.${route.key}`, card, index, page)).join("\n          ")}
        </section>`;
}

function renderOverviewStatusPanel(service = {}) {
  const labels = copy.zh.knowledgeBases;
  const welcomeState = buildWelcomeState(service);
  const current = welcomeState.current;
  const currentName = current?.name || copy.zh.welcome.noKnowledgeBase;
  const latestJobText = current?.latestJobStatus || labels.noJob;
  const sourceText = current?.sourceRoot || labels.noSource;
  const templateText = current?.template || "general-docs";
  const progress = Number.isFinite(welcomeState.progress) ? Math.max(0, Math.min(100, welcomeState.progress)) : 0;
  const primaryHref = welcomeState.primaryIsButton ? "/knowledge-bases" : welcomeState.primaryHref;
  const primaryAction = welcomeState.primaryIsButton
    ? `<button class="primary-action" type="button" data-knowledge-base-create data-i18n="${escapeHtml(welcomeState.primaryKey)}">${escapeHtml(welcomeState.primaryText)}</button>`
    : `<a class="primary-action" href="${escapeHtml(primaryHref)}" data-i18n="${escapeHtml(welcomeState.primaryKey)}">${escapeHtml(welcomeState.primaryText)}</a>`;
  return `<section class="overview-status-panel" data-overview-status-panel>
          <div class="overview-status-main">
            <span class="card-kicker" data-i18n="knowledgeBases.current">${escapeHtml(labels.current)}</span>
            <h2 title="${escapeHtml(currentName)}">${escapeHtml(currentName)}</h2>
            <p>
              <span class="welcome-status-dot welcome-status-dot--${escapeHtml(welcomeState.statusClass)}" aria-hidden="true"></span>
              <span data-i18n="welcome.states.${escapeHtml(welcomeState.stateKey)}">${escapeHtml(copy.zh.welcome.states[welcomeState.stateKey])}</span>
            </p>
            <div class="overview-status-progress" aria-hidden="true">
              <span><i style="width: ${progress}%"></i></span>
              <em>${progress}%</em>
            </div>
          </div>
          <dl class="overview-status-meta">
            <div>
              <dt data-i18n="knowledgeBases.latestJob">${escapeHtml(labels.latestJob)}</dt>
              <dd>${escapeHtml(latestJobText)}</dd>
            </div>
            <div>
              <dt data-i18n="knowledgeBases.template">${escapeHtml(labels.template)}</dt>
              <dd>${escapeHtml(templateText)}</dd>
            </div>
            <div>
              <dt data-i18n="knowledgeBases.source">${escapeHtml(labels.source)}</dt>
              <dd title="${escapeHtml(sourceText)}">${escapeHtml(sourceText)}</dd>
            </div>
          </dl>
          <div class="overview-status-action">
            ${primaryAction}
          </div>
        </section>`;
}

function renderDocumentManagement(service = {}) {
  const labels = copy.zh.documentsPanel;
  return `${renderMaintainKnowledgeTabs("documents", service)}
        <section class="document-management" data-document-management data-documents-endpoint="${apiEndpoint(service, "/api/documents")}" data-documents-check-endpoint="${apiEndpoint(service, "/api/documents/check")}" data-documents-exclude-endpoint="${apiEndpoint(service, "/api/documents/exclude")}" data-documents-restore-endpoint="${apiEndpoint(service, "/api/documents/restore")}" data-documents-reveal-endpoint="${apiEndpoint(service, "/api/documents/reveal")}">
          <div class="document-management-command">
            <div class="document-stats" data-document-stats>
              <span><strong data-document-stat="total">0</strong><em data-i18n="documentsPanel.total">${escapeHtml(labels.total)}</em></span>
              <span><strong data-document-stat="included">0</strong><em data-i18n="documentsPanel.included">${escapeHtml(labels.included)}</em></span>
              <span><strong data-document-stat="excluded">0</strong><em data-i18n="documentsPanel.excluded">${escapeHtml(labels.excluded)}</em></span>
              <span><strong data-document-stat="attention">0</strong><em data-i18n="documentsPanel.attention">${escapeHtml(labels.attention)}</em></span>
            </div>
            <button class="primary-action document-check-action" type="button" data-document-check data-i18n="documentsPanel.check">${escapeHtml(labels.check)}</button>
          </div>
          <div class="document-toolbar">
            <input type="search" data-document-search data-i18n-placeholder="documentsPanel.search" placeholder="${escapeHtml(labels.search)}">
            <div class="document-filters" role="group" aria-label="Document filters">
              <button type="button" data-document-filter="all" aria-pressed="true" data-i18n="documentsPanel.all">${escapeHtml(labels.all)}</button>
              <button type="button" data-document-filter="included" aria-pressed="false" data-i18n="documentsPanel.included">${escapeHtml(labels.included)}</button>
              <button type="button" data-document-filter="excluded" aria-pressed="false" data-i18n="documentsPanel.excluded">${escapeHtml(labels.excluded)}</button>
              <button type="button" data-document-filter="attention" aria-pressed="false" data-i18n="documentsPanel.attention">${escapeHtml(labels.attention)}</button>
            </div>
          </div>
          <div class="document-result-summary" data-document-result-summary aria-live="polite"></div>
          <div class="document-change-banner" data-document-change hidden></div>
          <div class="document-list" data-document-list aria-live="polite">
            <div class="document-empty">
              <strong data-i18n="documentsPanel.loading">${escapeHtml(labels.loading)}</strong>
            </div>
          </div>
          <div class="document-load-more-row">
            <button class="secondary-action" type="button" data-document-load-more hidden data-i18n="documentsPanel.loadMore">${escapeHtml(labels.loadMore)}</button>
          </div>
        </section>`;
}

function renderDocumentAssetViewer(service = {}) {
  const labels = copy.zh.documentsPanel;
  return `${renderMaintainKnowledgeTabs("documents", service)}
        <section class="document-asset-viewer" data-document-asset-viewer data-document-asset-endpoint="${apiEndpoint(service, "/api/documents/asset")}" data-documents-reveal-endpoint="${apiEndpoint(service, "/api/documents/reveal")}">
          <div class="document-asset-shell">
            <header class="document-asset-head">
              <div>
                <a class="quiet-link" href="${pageHref(service, "/maintain/documents")}" data-i18n="documentsPanel.backToAssets">${escapeHtml(labels.backToAssets)}</a>
                <h2 data-document-asset-title>${escapeHtml(labels.assetTitle)}</h2>
                <p data-document-asset-subtitle data-i18n="documentsPanel.assetLead">${escapeHtml(labels.assetLead)}</p>
              </div>
              <div class="document-asset-head-actions">
                <button class="secondary-action quiet-action" type="button" data-document-asset-reveal data-i18n="documentsPanel.locate">${escapeHtml(labels.locate)}</button>
              </div>
            </header>
            <div class="document-asset-summary" data-document-asset-summary>
              <span><strong>0</strong><em data-i18n="documentsPanel.pages">${escapeHtml(labels.pages)}</em></span>
              <span><strong>0</strong><em data-i18n="documentsPanel.chunks">${escapeHtml(labels.chunks)}</em></span>
              <span><strong>0</strong><em data-i18n="documentsPanel.sourceParts">${escapeHtml(labels.sourceParts)}</em></span>
              <span><strong>-</strong><em data-i18n="documentsPanel.version">${escapeHtml(labels.version)}</em></span>
            </div>
            <div class="document-asset-body" data-document-asset-body>
              <div class="document-empty"><strong data-i18n="documentsPanel.assetLoading">${escapeHtml(labels.assetLoading)}</strong></div>
            </div>
            <div class="document-load-more-row">
              <button class="secondary-action" type="button" data-document-asset-load-more hidden data-i18n="documentsPanel.loadMorePages">${escapeHtml(labels.loadMorePages)}</button>
            </div>
          </div>
        </section>`;
}

function renderUseKnowledgeTabs(activeKey, service = {}) {
  const items = [
    { key: "ask", href: "/use/ask", icon: "ask" },
    { key: "integration", href: "/use/integration", icon: "api" },
    { key: "api-docs", href: "/use/api-docs", icon: "api" },
    { key: "feedback", href: "/use/feedback", icon: "feedback" }
  ];
  return `<nav class="use-knowledge-tabs" aria-label="Use knowledge base">
          ${items.map((item) => {
            const active = item.key === activeKey;
            return `<a href="${pageHref(service, item.href)}" ${active ? "aria-current=\"page\"" : ""} data-nav-key="${escapeHtml(item.key)}">
              <svg class="icon" aria-hidden="true"><use href="#icon-${escapeHtml(item.icon)}"></use></svg>
              <span data-i18n="nav.${escapeHtml(item.key)}">${escapeHtml(copy.zh.nav[item.key] || item.key)}</span>
            </a>`;
          }).join("\n          ")}
        </nav>`;
}

function renderMaintainKnowledgeTabs(activeKey, service = {}) {
  const items = [
    { key: "documents", href: "/maintain/documents", icon: "template" },
    { key: "versions", href: "/maintain/versions", icon: "clock" },
    { key: "evaluation", href: "/maintain/evaluation", icon: "check" },
    { key: "feedback-review", href: "/maintain/feedback", icon: "feedback" },
    { key: "maintenance", href: "/maintain/diagnostics", icon: "maintenance" }
  ];
  return `<nav class="use-knowledge-tabs maintain-knowledge-tabs" aria-label="Maintain knowledge base">
          ${items.map((item) => {
            const active = item.key === activeKey;
            return `<a href="${pageHref(service, item.href)}" ${active ? "aria-current=\"page\"" : ""} data-nav-key="${escapeHtml(item.key)}">
              <svg class="icon" aria-hidden="true"><use href="#icon-${escapeHtml(item.icon)}"></use></svg>
              <span data-i18n="nav.${escapeHtml(item.key)}">${escapeHtml(copy.zh.nav[item.key] || item.key)}</span>
            </a>`;
          }).join("\n          ")}
        </nav>`;
}

function renderBuildKnowledgeTabs(activeKey, service = {}) {
  const items = [
    { key: "build", href: "/build", icon: "build" },
    { key: "execution", href: "/build/execution", icon: "run" }
  ];
  return `<nav class="use-knowledge-tabs build-knowledge-tabs" aria-label="Build knowledge base">
          ${items.map((item) => {
            const active = item.key === activeKey;
            return `<a href="${pageHref(service, item.href)}" ${active ? "aria-current=\"page\"" : ""} data-nav-key="${escapeHtml(item.key)}">
              <svg class="icon" aria-hidden="true"><use href="#icon-${escapeHtml(item.icon)}"></use></svg>
              <span data-i18n="nav.${escapeHtml(item.key)}">${escapeHtml(copy.zh.nav[item.key] || item.key)}</span>
            </a>`;
          }).join("\n          ")}
        </nav>`;
}

function renderIntegrationPanel(service = {}) {
  const labels = copy.zh.integrationPanel;
  const endpointUrl = `http://${service.endpoint || "127.0.0.1:7457"}${scopedApiPath(service, "/api/query")}`;
  const sampleQuestion = "五年级统编版语文第三单元第一课是什么？";
  return `${renderUseKnowledgeTabs("integration", service)}
        <section class="integration-console-panel integration-guide-panel">
          <header class="integration-panel-head">
            <div>
              <h2 data-i18n="integrationPanel.title">${escapeHtml(labels.title)}</h2>
              <p data-i18n="integrationPanel.note">${escapeHtml(labels.note)}</p>
            </div>
          </header>
          <div class="integration-quick-path">
            <div class="integration-endpoint-card">
              <div>
                <span class="card-kicker" data-i18n="integrationPanel.endpointTitle">${escapeHtml(labels.endpointTitle)}</span>
                <p data-i18n="integrationPanel.endpointBody">${escapeHtml(labels.endpointBody)}</p>
                <code>${escapeHtml(endpointUrl)}</code>
              </div>
              <button class="secondary-action" type="button" data-copy-text="${escapeHtml(endpointUrl)}" data-i18n="integrationPanel.copyEndpoint">${escapeHtml(labels.copyEndpoint)}</button>
            </div>
            <section class="integration-flow-section">
              <div>
                <h3 data-i18n="integrationPanel.flowTitle">${escapeHtml(labels.flowTitle)}</h3>
                <p data-i18n="integrationPanel.flowBody">${escapeHtml(labels.flowBody)}</p>
              </div>
              <ol>
                ${labels.flowSteps.map((item, index) => `<li>
                  <span>${String(index + 1).padStart(2, "0")}</span>
                  <strong data-i18n="integrationPanel.flowSteps.${index}.0">${escapeHtml(item[0])}</strong>
                  <p data-i18n="integrationPanel.flowSteps.${index}.1">${escapeHtml(item[1])}</p>
                </li>`).join("\n              ")}
              </ol>
            </section>
          </div>
          ${renderQueryRuntimePanel(service, { variant: "integration", sampleQuestion })}
          <aside class="integration-safety-note">
            <strong data-i18n="integrationPanel.safetyTitle">${escapeHtml(labels.safetyTitle)}</strong>
            <span data-i18n="integrationPanel.safetyBody">${escapeHtml(labels.safetyBody)}</span>
          </aside>
        </section>`;
}

function renderApiDocsPanel(service = {}) {
  const labels = copy.zh.integrationPanel;
  const docsLabels = copy.zh.apiDocsPanel;
  const endpointPath = scopedApiPath(service, "/api/query");
  const contractPath = scopedApiPath(service, "/api/query/contract");
  const feedbackPath = scopedApiPath(service, "/api/query/feedback");
  const origin = `http://${service.endpoint || "127.0.0.1:7457"}`;
  const endpointUrl = `${origin}${endpointPath}`;
  const contractUrl = `${origin}${contractPath}`;
  const feedbackUrl = `${origin}${feedbackPath}`;
  const sampleQuestion = "五年级统编版语文第三单元第一课是什么？";
  const curlSnippet = `curl -X POST "${endpointUrl}" \\
  -H "content-type: application/json" \\
  -d "{\\"question\\":\\"${sampleQuestion}\\"}"

# ok=true 时展示 answer.text；否则读取 status 和 error/message。`;
  const jsSnippet = `async function askKnowMesh(question) {
  const response = await fetch("${endpointUrl}", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question })
  });
  const result = await response.json();
  if (!response.ok) throw new Error("KnowMesh HTTP " + response.status);
  if (!result.ok) {
    return {
      status: result.status,
      message: result.answer?.message || result.error?.message?.zh || "No reliable answer",
      citations: []
    };
  }
  return {
    status: result.status,
    question,
    answer: result.answer.text,
    feedbackEndpoint: result.feedback?.endpoint,
    citations: result.citations.map((item) => ({
      id: item.id,
      title: item.title,
      pageNumber: item.pageNumber,
      excerpt: item.excerpt,
      links: item.links || {}
    }))
  };
}

async function sendKnowMeshFeedback(result, action) {
  const feedbackUrl = new URL(result.feedbackEndpoint || "${feedbackUrl}", "${origin}").toString();
  await fetch(feedbackUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      question: result.question,
      answerStatus: result.status,
      citationIds: result.citations.map((item) => item.id).filter(Boolean),
      citationRefs: result.citations.map((item) => ({
        id: item.id,
        title: item.title,
        pageNumber: item.pageNumber,
        documentHref: item.links?.document,
        excerpt: item.excerpt
      }))
    })
  });
}

const answer = await askKnowMesh("${sampleQuestion}");
if (answer.status === "answered") {
  await sendKnowMeshFeedback(answer, "useful");
}`;
  const pythonSnippet = `import requests
from urllib.parse import urljoin

def ask_knowmesh(question: str):
    response = requests.post(
        "${endpointUrl}",
        json={"question": question},
        timeout=60,
    )
    response.raise_for_status()
    result = response.json()
    if not result.get("ok"):
        return {
            "status": result.get("status"),
            "message": (result.get("answer") or {}).get("message")
                or (result.get("error") or {}).get("message"),
            "citations": [],
        }
    return {
        "status": result["status"],
        "answer": result["answer"]["text"],
        "citations": result["citations"],
        "feedback_endpoint": result["feedback"]["endpoint"],
        "question": question,
    }

def send_knowmesh_feedback(result: dict, action: str):
    feedback_url = urljoin("${origin}", result["feedback_endpoint"])
    requests.post(
        feedback_url,
        json={
            "action": action,
            "question": result["question"],
            "answerStatus": result["status"],
            "citationIds": [item["id"] for item in result["citations"] if item.get("id")],
            "citationRefs": [{
                "id": item.get("id"),
                "title": item.get("title"),
                "pageNumber": item.get("pageNumber"),
                "documentHref": (item.get("links") or {}).get("document"),
            } for item in result["citations"]],
        },
        timeout=30,
    ).raise_for_status()

answer = ask_knowmesh("${sampleQuestion}")
if answer["status"] == "answered":
    send_knowmesh_feedback(answer, "useful")`;
  const feedbackSnippet = `curl -X POST "${feedbackUrl}" \\
  -H "content-type: application/json" \\
  -d "{\\"action\\":\\"wrong_citation\\",\\"question\\":\\"${sampleQuestion}\\",\\"citationIds\\":[\\"citation-id-from-query-response\\"],\\"citationRefs\\":[{\\"id\\":\\"citation-id-from-query-response\\",\\"title\\":\\"引用来源标题\\",\\"documentHref\\":\\"/kb/current/maintain/document?documentId=source-document-id\\"}]}"

# useful 只记录正向信号；wrong_citation / missed_point 会进入问答反馈待复核。`;
  const briefZh = integrationBriefText("zh", { endpointUrl, feedbackUrl, sampleQuestion });
  const briefEn = integrationBriefText("en", { endpointUrl, feedbackUrl, sampleQuestion });
  return `${renderUseKnowledgeTabs("api-docs", service)}
        <section class="api-docs-console-panel">
          <template id="integration-brief-zh">${escapeHtml(briefZh)}</template>
          <template id="integration-brief-en">${escapeHtml(briefEn)}</template>
          <header class="integration-panel-head api-docs-head">
            <div>
              <h2 data-i18n="apiDocsPanel.title">${escapeHtml(docsLabels.title)}</h2>
              <p data-i18n="apiDocsPanel.note">${escapeHtml(docsLabels.note)}</p>
            </div>
            <button class="secondary-action" type="button" data-copy-target-zh="integration-brief-zh" data-copy-target-en="integration-brief-en" data-i18n="apiDocsPanel.briefAction">${escapeHtml(docsLabels.briefAction)}</button>
          </header>
          <section class="api-docs-endpoint-list" aria-label="${escapeHtml(docsLabels.endpointsTitle)}">
            <h3 data-i18n="apiDocsPanel.endpointsTitle">${escapeHtml(docsLabels.endpointsTitle)}</h3>
            ${renderApiDocsEndpointRow("POST", docsLabels.queryEndpoint, endpointUrl, labels.copyEndpoint, "apiDocsPanel.queryEndpoint", "integrationPanel.copyEndpoint")}
            ${renderApiDocsEndpointRow("GET", docsLabels.contractEndpoint, contractUrl, labels.copyContractEndpoint, "apiDocsPanel.contractEndpoint", "integrationPanel.copyContractEndpoint")}
            ${renderApiDocsEndpointRow("POST", docsLabels.feedbackEndpoint, feedbackUrl, labels.copyEndpoint, "apiDocsPanel.feedbackEndpoint", "integrationPanel.copyEndpoint")}
          </section>
          <details class="integration-contract-section" open>
            <summary>
              <div>
                <h3 data-i18n="integrationPanel.contractTitle">${escapeHtml(labels.contractTitle)}</h3>
                <p data-i18n="integrationPanel.contractBody">${escapeHtml(labels.contractBody)}</p>
              </div>
            </summary>
            <div class="integration-contract-grid">
              ${renderIntegrationContractCard("requestTitle", "requestFields", labels.requestFields)}
              ${renderIntegrationContractCard("responseTitle", "fields", labels.fields)}
              ${renderIntegrationContractCard("statusTitle", "statusFields", labels.statusFields)}
              ${renderIntegrationContractCard("errorsTitle", "errorFields", labels.errorFields)}
              ${renderIntegrationContractCard("feedbackTitle", "feedbackFields", labels.feedbackFields)}
            </div>
          </details>
          <details class="integration-code-section" open>
            <summary>
              <h3 data-i18n="integrationPanel.examplesTitle">${escapeHtml(labels.examplesTitle)}</h3>
            </summary>
            <div class="integration-code-grid">
              ${renderIntegrationCodeCard("cURL", curlSnippet, { zh: "cURL 示例", en: "cURL example" })}
              ${renderIntegrationCodeCard("JavaScript", jsSnippet, { zh: "JavaScript 示例", en: "JavaScript example" })}
              ${renderIntegrationCodeCard("Python", pythonSnippet, { zh: "Python 示例", en: "Python example" })}
              ${renderIntegrationCodeCard("Feedback", feedbackSnippet, { zh: "反馈示例", en: "Feedback example" })}
            </div>
          </details>
        </section>`;
}

function renderApiDocsEndpointRow(method, label, url, copyLabel, labelKey, copyKey) {
  return `<div class="api-docs-endpoint-row">
            <span>${escapeHtml(method)}</span>
            <strong data-i18n="${escapeHtml(labelKey)}">${escapeHtml(label)}</strong>
            <code>${escapeHtml(url)}</code>
            <button class="secondary-action quiet-action" type="button" data-copy-text="${escapeHtml(url)}" data-i18n="${escapeHtml(copyKey)}">${escapeHtml(copyLabel)}</button>
          </div>`;
}

function renderIntegrationCodeCard(title, code, copyLabel = {}) {
  const zhLabel = copyLabel.zh || title;
  const enLabel = copyLabel.en || title;
  const buttonLabel = copy.zh.integrationPanel.copyCodeFor.replace("{label}", zhLabel);
  return `<article class="integration-code-card">
            <header>
              <strong>${escapeHtml(title)}</strong>
              <button class="secondary-action quiet-action" type="button" data-copy-text="${escapeHtml(code)}" data-copy-code-label-zh="${escapeHtml(zhLabel)}" data-copy-code-label-en="${escapeHtml(enLabel)}" aria-label="${escapeHtml(buttonLabel)}">${escapeHtml(buttonLabel)}</button>
            </header>
            <pre><code>${escapeHtml(code)}</code></pre>
          </article>`;
}

function renderIntegrationContractCard(titleKey, listKey, items = []) {
  return `<article class="integration-contract-card">
            <h4 data-i18n="integrationPanel.${titleKey}">${escapeHtml(copy.zh.integrationPanel[titleKey])}</h4>
            <dl>
              ${items.map((item, index) => `<div>
                <dt data-i18n="integrationPanel.${listKey}.${index}.0">${escapeHtml(item[0])}</dt>
                <dd data-i18n="integrationPanel.${listKey}.${index}.1">${escapeHtml(item[1])}</dd>
              </div>`).join("\n              ")}
            </dl>
          </article>`;
}

function integrationBriefText(lang, context) {
  const { endpointUrl, feedbackUrl, sampleQuestion } = context;
  if (lang === "en") {
    return `KnowMesh integration brief

Endpoint
POST ${endpointUrl}
Content-Type: application/json

Request body
{"question":"${sampleQuestion}"}

Success response
- ok: true
- status: answered
- answer.text: answer generated from reliable sources
- citations: source file, page number, excerpt, metadata, and maintenance links

Non-answer response
- ok: false
- status: no_answer | invalid_request | runtime_error
- answer.message or error.message explains what your app should show next

Feedback
POST ${feedbackUrl}
Body: {"action":"wrong_citation","question":"...","citationIds":["..."],"citationRefs":[{"id":"...","title":"...","documentHref":"..."}]}
- useful is recorded as a positive signal.
- wrong_citation and missed_point enter Answer Feedback review.

Access boundary
KnowMesh listens on 127.0.0.1 by default. Expose it to LAN or servers only after deciding access control and logs.`;
  }
  return `KnowMesh 接入说明

接口地址
POST ${endpointUrl}
Content-Type: application/json

请求体
{"question":"${sampleQuestion}"}

成功响应
- ok: true
- status: answered
- answer.text: 基于可靠来源生成的答案
- citations: 来源文件、页码、原文片段、元数据和维护链接

不可回答或需要处理
- ok: false
- status: no_answer | invalid_request | runtime_error
- answer.message 或 error.message 用来提示用户下一步

反馈接口
POST ${feedbackUrl}
Body: {"action":"wrong_citation","question":"...","citationIds":["..."],"citationRefs":[{"id":"...","title":"...","documentHref":"..."}]}
- useful 只记录为正向信号。
- wrong_citation 和 missed_point 会进入问答反馈待复核。

访问边界
KnowMesh 默认只监听 127.0.0.1。开放给局域网或服务器前，需要先明确访问控制和日志留存。`;
}
function renderAskPanel(service = {}) {
  const labels = copy.zh.askPanel;
  return `${renderUseKnowledgeTabs("ask", service)}
        <section class="ask-console-panel">
          <div>
            <h2 data-i18n="askPanel.title">${escapeHtml(labels.title)}</h2>
            <p data-i18n="askPanel.note">${escapeHtml(labels.note)}</p>
          </div>
          ${renderQueryRuntimePanel(service, { variant: "ask" })}
        </section>`;
}

function renderQueryFeedbackPanel(service = {}) {
  const labels = copy.zh.feedbackPanel;
  return `${renderUseKnowledgeTabs("feedback", service)}
        <section class="feedback-console-panel">
          <header>
            <div>
              <h2 data-i18n="feedbackPanel.title">${escapeHtml(labels.title)}</h2>
              <p data-i18n="feedbackPanel.note">${escapeHtml(labels.note)}</p>
            </div>
          </header>
          <div class="api-result feedback-api-result"
            data-api-result="query-feedback-summary"
            data-query-feedback-mode="records"
            data-api-autoload="query-feedback-summary"
            data-api-autoload-endpoint="${apiEndpoint(service, "/api/query/feedback/summary")}"
            data-api-autoload-method="GET"
            data-api-autoload-loading-zh="${escapeHtml(labels.loading)}"
            data-api-autoload-loading-en="${escapeHtml(copy.en.feedbackPanel.loading)}"
            data-api-inline-result="true"
            hidden></div>
        </section>`;
}

function renderFeedbackReviewPanel(service = {}) {
  const labels = copy.zh.feedbackReviewPanel;
  return `${renderMaintainKnowledgeTabs("feedback-review", service)}
        <section class="feedback-console-panel feedback-review-panel">
          <header>
            <div>
              <h2 data-i18n="feedbackReviewPanel.title">${escapeHtml(labels.title)}</h2>
              <p data-i18n="feedbackReviewPanel.note">${escapeHtml(labels.note)}</p>
            </div>
          </header>
          <div class="api-result feedback-api-result"
            data-api-result="query-feedback-summary"
            data-query-feedback-mode="review"
            data-api-autoload="query-feedback-summary"
            data-api-autoload-endpoint="${apiEndpoint(service, "/api/query/feedback/summary")}"
            data-api-autoload-method="GET"
            data-api-autoload-loading-zh="${escapeHtml(labels.loading)}"
            data-api-autoload-loading-en="${escapeHtml(copy.en.feedbackReviewPanel.loading)}"
            data-api-inline-result="true"
            hidden></div>
        </section>`;
}

function renderVersionRecordsPanel(service = {}) {
  const labels = copy.zh.versionRecordsPanel;
  return `${renderMaintainKnowledgeTabs("versions", service)}
        <section class="version-records-panel">
          <header>
            <div>
              <h2 data-i18n="versionRecordsPanel.title">${escapeHtml(labels.title)}</h2>
              <p data-i18n="versionRecordsPanel.note">${escapeHtml(labels.note)}</p>
            </div>
          </header>
          <div class="api-result version-records-result"
            data-api-result="version-records"
            data-api-autoload="version-records"
            data-api-autoload-endpoint="${apiEndpoint(service, "/api/versions")}"
            data-api-autoload-method="GET"
            data-api-autoload-loading-zh="${escapeHtml(labels.loading)}"
            data-api-autoload-loading-en="${escapeHtml(copy.en.versionRecordsPanel.loading)}"
            data-api-inline-result="true"
            hidden></div>
        </section>`;
}

function renderEvaluationDashboardPanel(service = {}) {
  const labels = copy.zh.evaluationDashboardPanel;
  return `${renderMaintainKnowledgeTabs("evaluation", service)}
        <section class="evaluation-dashboard-panel">
          <header>
            <div>
              <h2 data-i18n="evaluationDashboardPanel.title">${escapeHtml(labels.title)}</h2>
              <p data-i18n="evaluationDashboardPanel.note">${escapeHtml(labels.note)}</p>
            </div>
          </header>
          <div class="api-result evaluation-dashboard-result"
            data-api-result="evaluation-dashboard"
            data-api-autoload="evaluation-dashboard"
            data-api-autoload-endpoint="${apiEndpoint(service, "/api/evaluation/dashboard")}"
            data-api-autoload-method="GET"
            data-api-autoload-loading-zh="${escapeHtml(labels.loading)}"
            data-api-autoload-loading-en="${escapeHtml(copy.en.evaluationDashboardPanel.loading)}"
            data-api-inline-result="true"
            hidden></div>
        </section>`;
}

function renderQueryRuntimePanel(service = {}, options = {}) {
  const labels = copy.zh.queryRuntime;
  const panelLabels = options.variant === "integration" ? copy.zh.integrationPanel : copy.zh.askPanel;
  const titleKey = options.variant === "integration" ? "integrationPanel.testTitle" : "askPanel.questionLabel";
  const bodyKey = options.variant === "integration" ? "integrationPanel.testBody" : "askPanel.note";
  const title = options.variant === "integration" ? panelLabels.testTitle : panelLabels.questionLabel;
  const body = options.variant === "integration" ? panelLabels.testBody : panelLabels.note;
  return `<section class="query-runtime-card query-runtime-card--${escapeHtml(options.variant || "ask")}"
            data-query-runtime-panel
            data-query-runtime-variant="${escapeHtml(options.variant || "ask")}"
            data-query-endpoint="${escapeHtml(apiEndpoint(service, "/api/query"))}"
            data-query-feedback-endpoint="${escapeHtml(apiEndpoint(service, "/api/query/feedback"))}">
            <div class="query-runtime-copy">
              <h3 data-i18n="${escapeHtml(titleKey)}">${escapeHtml(title)}</h3>
              <p data-i18n="${escapeHtml(bodyKey)}">${escapeHtml(body)}</p>
            </div>
            <label class="query-runtime-field">
              <span data-i18n="queryRuntime.questionLabel">${escapeHtml(labels.questionLabel)}</span>
              <textarea rows="${options.variant === "integration" ? "2" : "4"}" data-query-runtime-question data-i18n-placeholder="askPanel.questionPlaceholder" placeholder="${escapeHtml(copy.zh.askPanel.questionPlaceholder)}">${escapeHtml(options.sampleQuestion || "")}</textarea>
            </label>
            <div class="query-runtime-actions">
              <button class="primary-action" type="button" data-query-runtime-run data-i18n="queryRuntime.runAction">${escapeHtml(labels.runAction)}</button>
            </div>
            <div class="query-runtime-result" data-query-runtime-result hidden></div>
          </section>`;
}

function renderMaintenancePanel(service = {}) {
  return `${renderMaintainKnowledgeTabs("maintenance", service)}
        <section class="maintenance-console-panel">
          <div class="maintenance-console-panel-head">
            <div>
              <h2 data-i18n="maintenancePanel.title">${escapeHtml(copy.zh.maintenancePanel.title)}</h2>
              <p data-i18n="maintenancePanel.note">${escapeHtml(copy.zh.maintenancePanel.note)}</p>
            </div>
            <a class="secondary-action quiet-action" href="${apiEndpoint(service, "/api/maintenance/export")}" download="knowmesh-diagnostics.json" data-i18n="maintenancePanel.exportAction">${escapeHtml(copy.zh.maintenancePanel.exportAction)}</a>
          </div>
          <div class="api-result" data-api-result="maintenance-status" data-api-autoload="maintenance-status" data-api-autoload-endpoint="${apiEndpoint(service, "/api/maintenance/status")}" data-api-autoload-method="GET" data-api-autoload-loading-zh="${escapeHtml(copy.zh.maintenancePanel.loading)}" data-api-autoload-loading-en="${escapeHtml(copy.en.maintenancePanel.loading)}" data-api-inline-result="true" hidden></div>
          <div class="api-result" data-api-result="package-export-preview" data-api-autoload="package-export-preview" data-api-autoload-endpoint="${apiEndpoint(service, "/api/package/export/preview")}" data-api-autoload-method="GET" data-api-autoload-loading-zh="${escapeHtml(copy.zh.maintenancePanel.loading)}" data-api-autoload-loading-en="${escapeHtml(copy.en.maintenancePanel.loading)}" data-api-inline-result="true" hidden></div>
        </section>`;
}

function renderSetupTemplateChoicePanel() {
  const template = templateSummaries.find((item) => item.id === defaultTemplateId) || templateSummaries[0];
  const choiceCopy = copy.zh.setup.templateChoice;
  return `<section class="template-choice-setup" data-template-choice-setup>
          ${renderTemplateLibrary({ variant: "setup" })}
          ${renderTemplateContractPanel(template)}
          <section class="template-choice-status" data-selected-template-choice>
            <span class="status-dot pass" aria-hidden="true"></span>
            <strong data-i18n="setup.currentChoice">${escapeHtml(copy.zh.setup.currentChoice)}</strong>
            <span data-selected-template-title>${escapeHtml(template.title.zh)}</span>
            <span class="template-choice-status-note">
              <b data-i18n="setup.templateChoice.nextLabel">${escapeHtml(choiceCopy.nextLabel)}</b>
              <em data-template-choice-next data-i18n="setup.templateChoice.next">${escapeHtml(choiceCopy.next)}</em>
            </span>
            <span class="template-choice-status-note">
              <b data-i18n="setup.templateChoice.guardLabel">${escapeHtml(choiceCopy.guardLabel)}</b>
              <em data-i18n="setup.templateChoice.guard">${escapeHtml(choiceCopy.guard)}</em>
            </span>
          </section>
        </section>`;
}

function renderTemplateContractPanel(template = {}) {
  const metadataContract = template.metadataContract || {};
  const aliyunContract = template.aliyunMetadataContract || {};
  const filters = localizedList(metadataContract.queryFilters);
  const searchFields = localizedList(metadataContract.requiredForSearch);
  const citationFields = localizedList(metadataContract.requiredForCitation);
  return `<section class="template-contract-panel" data-template-contract-panel>
          <div class="template-contract-copy">
            <span class="card-kicker" data-i18n="app.templateContract">${escapeHtml(copy.zh.app.templateContract || "模板策略")}</span>
            <h2 data-template-contract-title>${escapeHtml(template.expertName || template.coreName || "KnowMesh Core")}</h2>
            <div class="template-version-strip" aria-label="Template versions">
              <span class="template-version-pill" data-template-library-version>${escapeHtml(`${copy.zh.app.templateLibraryVersion} v${templateLibraryVersion}`)}</span>
              <span class="template-version-pill" data-template-contract-version>${escapeHtml(`${copy.zh.app.currentTemplateVersion} v${template.version || "-"}`)}</span>
            </div>
            <p data-template-contract-summary>${escapeHtml(metadataContract.summary?.zh || template.summary?.zh || "")}</p>
          </div>
          <div class="template-contract-grid">
            <article>
              <strong data-i18n="app.searchContract">${escapeHtml(copy.zh.app.searchContract || "检索字段")}</strong>
              <p data-template-contract-search>${escapeHtml(searchFields.join(" · "))}</p>
            </article>
            <article>
              <strong data-i18n="app.citationContract">${escapeHtml(copy.zh.app.citationContract || "引用字段")}</strong>
              <p data-template-contract-citation>${escapeHtml(citationFields.join(" · "))}</p>
            </article>
            <article>
              <strong data-i18n="app.filterContract">${escapeHtml(copy.zh.app.filterContract || "问题过滤")}</strong>
              <p data-template-contract-filters>${escapeHtml(filters.join(" · "))}</p>
            </article>
            <article>
              <strong data-i18n="app.sidecarContract">${escapeHtml(copy.zh.app.sidecarContract || "阿里云存储")}</strong>
              <p data-template-contract-sidecar>${escapeHtml(aliyunContract.summary?.zh || "")}</p>
            </article>
          </div>
        </section>`;
}

function localizedList(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => typeof item === "object" ? item.zh || item.en || "" : item)
    .filter(Boolean);
}

function renderTemplateLibrary(options = {}) {
  const setupVariant = options.variant === "setup";
  const className = setupVariant ? "template-library template-library--setup" : "template-library";
  const setupAttr = setupVariant ? " data-template-library-setup" : "";
  return `<section class="${className}" data-template-library${setupAttr}>
          ${templateSummaries.map((template) => renderTemplateCard(template, options)).join("\n          ")}
        </section>`;
}

function renderTemplateCard(template, options = {}) {
  if (options.variant === "setup") return renderSetupTemplateCard(template);

  const recommended = template.recommended ? `<span class="card-kicker" data-template-recommended="${template.id}">${escapeHtml(copy.zh.app.recommended)}</span>` : "";
  const requiredCount = template.requiredFields.filter((field) => field.required).length;
  return `<button class="template-card" type="button" data-template-option="${escapeHtml(template.id)}" aria-pressed="${template.id === defaultTemplateId}">
            <span class="template-card-head">
              <span class="card-kicker" data-i18n="app.builtIn">${escapeHtml(copy.zh.app.builtIn)}</span>
              ${recommended}
            </span>
            <strong data-template-field="shortTitle" data-template-id="${escapeHtml(template.id)}">${escapeHtml(template.shortTitle.zh)}</strong>
            <span data-template-field="summary" data-template-id="${escapeHtml(template.id)}">${escapeHtml(template.summary.zh)}</span>
            <span class="template-card-meta">
              <span><b>${requiredCount}</b><em data-i18n="app.requiredFields">${escapeHtml(copy.zh.app.requiredFields)}</em></span>
              <span><b>${template.metadataFields.length}</b><em data-i18n="app.fields">${escapeHtml(copy.zh.app.fields)}</em></span>
            </span>
            <span class="template-filter-line">
              <em data-i18n="app.filterPolicy">${escapeHtml(copy.zh.app.filterPolicy)}</em>
              <span data-template-filter-label="${escapeHtml(template.id)}">${escapeHtml(template.vectorFilterPolicy.label.zh)}</span>
            </span>
          </button>`;
}

function renderSetupTemplateCard(template) {
  const badge = template.recommended ? copy.zh.app.recommended : copy.zh.app.builtIn;
  const badgeKey = template.recommended ? "app.recommended" : "app.builtIn";
  return `<button class="template-card template-card--setup" type="button" data-template-option="${escapeHtml(template.id)}" aria-pressed="${template.id === defaultTemplateId}">
            <span class="template-card-head">
              <span class="card-kicker" data-i18n="${escapeHtml(badgeKey)}">${escapeHtml(badge)}</span>
              <span class="template-choice-selected" data-i18n="setup.currentChoice" aria-hidden="true">${escapeHtml(copy.zh.setup.currentChoice)}</span>
            </span>
            <strong data-template-field="shortTitle" data-template-id="${escapeHtml(template.id)}">${escapeHtml(template.shortTitle.zh)}</strong>
            <span data-template-field="summary" data-template-id="${escapeHtml(template.id)}">${escapeHtml(template.summary.zh)}</span>
          </button>`;
}

function renderLatestJobPanel(service = {}) {
  return `${renderBuildKnowledgeTabs("execution", service)}
        <section class="job-execution-shell" data-job-execution-shell>
          <section class="job-console-panel" data-job-empty-state>
            <header class="job-console-empty-head">
              <span class="card-kicker" data-i18n="jobs.latest.badge">${escapeHtml(copy.zh.jobs.latest.badge)}</span>
              <div>
                <h2 data-i18n="jobs.latest.emptyTitle">${escapeHtml(copy.zh.jobs.latest.emptyTitle)}</h2>
                <p data-i18n="jobs.latest.emptyBody">${escapeHtml(copy.zh.jobs.latest.emptyBody)}</p>
              </div>
            </header>
            <div class="job-console-empty-layout">
              <div class="job-console-empty-steps" aria-label="Knowledge-base task steps">
                ${copy.zh.jobs.latest.emptySteps.map((item, index) => `<article>
                  <span>${String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong data-i18n="jobs.latest.emptySteps.${index}.0">${escapeHtml(item[0])}</strong>
                    <p data-i18n="jobs.latest.emptySteps.${index}.1">${escapeHtml(item[1])}</p>
                  </div>
                </article>`).join("\n                ")}
              </div>
            </div>
            <aside class="job-console-empty-next">
              <div class="job-console-empty-next-copy">
                <strong data-i18n="jobs.latest.nextTitle">${escapeHtml(copy.zh.jobs.latest.nextTitle)}</strong>
                <p data-i18n="jobs.latest.nextBody">${escapeHtml(copy.zh.jobs.latest.nextBody)}</p>
              </div>
              <div class="job-console-empty-actions">
                <a class="primary-action" href="${pageHref(service, "/build")}" data-job-action-control="create" data-i18n="jobs.latest.create">${escapeHtml(copy.zh.jobs.latest.create)}</a>
                <a class="secondary-action" href="${pageHref(service, "/build")}" data-job-action-control="plan" data-i18n="nav.build">${escapeHtml(copy.zh.nav.build)}</a>
              </div>
            </aside>
          </section>
          <div class="job-api-result" data-api-result="latest-job" hidden></div>
          <footer class="job-action-bar" data-job-action-bar>
            <div class="job-action-status" data-job-action-status>
              <strong data-job-action-status-title>${escapeHtml(copy.zh.jobs.latest.statusLoading)}</strong>
              <span data-job-action-status-body>${escapeHtml(copy.zh.jobs.latest.statusBody)}</span>
            </div>
            <div class="job-action-controls">
              <button class="secondary-action job-action-refresh" type="button" hidden data-job-action-control="refresh" data-console-api-action="latest-job" data-api-method="GET" data-api-endpoint="${apiEndpoint(service, "/api/jobs/latest")}" data-api-loading-zh="${escapeHtml(copy.zh.jobs.latest.loading)}" data-api-loading-en="${escapeHtml(copy.en.jobs.latest.loading)}" data-i18n="jobs.latest.refresh">${escapeHtml(copy.zh.jobs.latest.refresh)}</button>
              <button class="secondary-action" type="button" data-job-action-control="test" data-job-action-mode="test" data-console-api-action="test-job-task" data-api-result-key="latest-job" data-api-endpoint="${apiEndpoint(service, "/api/jobs/latest/test")}" data-api-loading-zh="${escapeHtml(copy.zh.jobs.latest.testLoading)}" data-api-loading-en="${escapeHtml(copy.en.jobs.latest.testLoading)}" data-i18n="jobs.latest.test">${escapeHtml(copy.zh.jobs.latest.test)}</button>
              <button class="primary-action job-action-main" type="button" data-job-action-control="advance" data-job-action-mode="step" data-console-api-action="advance-latest-job" data-api-result-key="latest-job" data-api-endpoint="${apiEndpoint(service, "/api/jobs/latest/advance")}" data-api-loading-zh="${escapeHtml(copy.zh.jobs.latest.advanceLoading)}" data-api-loading-en="${escapeHtml(copy.en.jobs.latest.advanceLoading)}" data-i18n="jobs.latest.advance">${escapeHtml(copy.zh.jobs.latest.advance)}</button>
              <button class="secondary-action" type="button" data-job-action-control="run" data-job-action-mode="continuous" data-console-api-action="run-latest-job" data-api-result-key="latest-job" data-api-endpoint="${apiEndpoint(service, "/api/jobs/latest/run")}" data-api-loading-zh="${escapeHtml(copy.zh.jobs.latest.runLoading)}" data-api-loading-en="${escapeHtml(copy.en.jobs.latest.runLoading)}" data-i18n="jobs.latest.run">${escapeHtml(copy.zh.jobs.latest.run)}</button>
              <button class="secondary-action" type="button" data-job-action-control="pause" data-console-api-action="pause-latest-job" data-api-result-key="latest-job" data-api-endpoint="${apiEndpoint(service, "/api/jobs/latest/pause")}" data-api-loading-zh="${escapeHtml(copy.zh.jobs.latest.pauseLoading)}" data-api-loading-en="${escapeHtml(copy.en.jobs.latest.pauseLoading)}" data-confirm-title-zh="${escapeHtml(copy.zh.jobs.latest.pauseConfirmTitle)}" data-confirm-title-en="${escapeHtml(copy.en.jobs.latest.pauseConfirmTitle)}" data-confirm-body-zh="${escapeHtml(copy.zh.jobs.latest.pauseConfirmBody)}" data-confirm-body-en="${escapeHtml(copy.en.jobs.latest.pauseConfirmBody)}" data-i18n="jobs.latest.pause">${escapeHtml(copy.zh.jobs.latest.pause)}</button>
              <button class="primary-action" type="button" data-job-action-control="resume" data-console-api-action="resume-latest-job" data-api-result-key="latest-job" data-api-endpoint="${apiEndpoint(service, "/api/jobs/latest/resume")}" data-api-loading-zh="${escapeHtml(copy.zh.jobs.latest.resumeLoading)}" data-api-loading-en="${escapeHtml(copy.en.jobs.latest.resumeLoading)}" data-i18n="jobs.latest.resume">${escapeHtml(copy.zh.jobs.latest.resume)}</button>
              <a class="primary-action job-action-main" href="${pageHref(service, "/use/ask")}" data-job-action-control="ask" data-i18n="jobs.latest.ask">${escapeHtml(copy.zh.jobs.latest.ask)}</a>
              <button class="danger-action" type="button" data-job-action-control="stop" data-console-api-action="stop-latest-job" data-api-result-key="latest-job" data-api-endpoint="${apiEndpoint(service, "/api/jobs/latest/stop")}" data-api-loading-zh="${escapeHtml(copy.zh.jobs.latest.stopLoading)}" data-api-loading-en="${escapeHtml(copy.en.jobs.latest.stopLoading)}" data-confirm-title-zh="${escapeHtml(copy.zh.jobs.latest.stopConfirmTitle)}" data-confirm-title-en="${escapeHtml(copy.en.jobs.latest.stopConfirmTitle)}" data-confirm-body-zh="${escapeHtml(copy.zh.jobs.latest.stopConfirmBody)}" data-confirm-body-en="${escapeHtml(copy.en.jobs.latest.stopConfirmBody)}" data-i18n="jobs.latest.stop">${escapeHtml(copy.zh.jobs.latest.stop)}</button>
            </div>
          </footer>
        </section>`;
}

function renderSetupDraftPanel(stepKey, service = {}) {
  const panel = setupDraftPanels[stepKey];
  if (!panel) return "";
  const fields = stepKey === "project"
    ? renderProjectDraftFieldSections(panel.fields)
    : panel.fields.map((field) => renderDraftField(field)).join("\n              ");
  return `<section class="setup-draft" data-setup-draft-panel="${escapeHtml(stepKey)}">
          <div class="setup-draft-copy">
            <p class="eyebrow" data-draft-panel-title="${escapeHtml(stepKey)}">${escapeHtml(panel.title.zh)}</p>
            <p data-draft-panel-note="${escapeHtml(stepKey)}">${escapeHtml(panel.note.zh)}</p>
          </div>
          <div class="setup-draft-grid">
            <form class="setup-draft-form" autocomplete="off">
              <div class="setup-draft-fields" data-draft-fields="${escapeHtml(stepKey)}">
              ${fields}
              </div>
              ${panel.fields.length ? `<p class="draft-save-state" data-i18n="setup.draftLocal" data-status="local">${escapeHtml(copy.zh.setup.draftLocal)}</p>` : ""}
            </form>
            <article class="setup-checklist">
              <span class="card-kicker" data-i18n="app.required">${escapeHtml(copy.zh.app.required)}</span>
              <ul data-draft-checklist="${escapeHtml(stepKey)}">
                ${panel.checklist.map((item, index) => `<li data-draft-check="${escapeHtml(stepKey)}.${index}">${escapeHtml(item.zh)}</li>`).join("\n                ")}
              </ul>
            </article>
            ${renderSetupApiActions(panel, service)}
            ${renderSetupFieldGate(stepKey, panel)}
          </div>
        </section>`;
}

function renderSetupProjectPanel(service = {}) {
  const panel = setupDraftPanels.project;
  return `<section class="project-setup" data-project-setup>
          <form class="project-setup-form" autocomplete="off">
            <div class="project-path-grid" data-draft-fields="project">
              ${renderProjectDraftFieldSections(panel.fields, service)}
            </div>
            ${renderSetupFieldGate("project", panel)}
          </form>
        </section>`;
}

function renderSetupApiActions(panel, service = {}) {
  const actions = setupPanelActions(panel);
  if (!actions.length) return "";
  const primary = actions[0];
  const resultKey = primary.resultKey || primary.key;
  return `<div class="setup-api-action" data-api-action-panel="${escapeHtml(primary.key)}">
                <p data-api-action-idle="${escapeHtml(primary.key)}">${escapeHtml(primary.idle.zh)}</p>
                <div class="setup-api-buttons">
                  ${actions.map((action, index) => {
                    const method = action.method ? ` data-api-method="${escapeHtml(action.method)}"` : "";
                    const resultAttr = action.resultKey ? ` data-api-result-key="${escapeHtml(action.resultKey)}"` : "";
                    const confirmAttr = renderConfirmAttrs(action.confirm);
                    const buttonClass = action.danger ? "danger-action" : index === 0 ? "secondary-action" : "secondary-action quiet-action";
                    return `<button class="${buttonClass}" type="button" data-setup-api-action="${escapeHtml(action.key)}" data-api-endpoint="${apiEndpoint(service, action.endpoint)}"${method}${resultAttr}${confirmAttr} data-api-loading-zh="${escapeHtml(action.loading.zh)}" data-api-loading-en="${escapeHtml(action.loading.en)}">${escapeHtml(action.label.zh)}</button>`;
                  }).join("\n                  ")}
                </div>
                <div class="api-result" data-api-result="${escapeHtml(resultKey)}" hidden></div>
              </div>`;
}

function renderConfirmAttrs(confirm) {
  if (!confirm) return "";
  const titleZh = confirm.title?.zh || "";
  const titleEn = confirm.title?.en || titleZh;
  const bodyZh = confirm.body?.zh || "";
  const bodyEn = confirm.body?.en || bodyZh;
  return ` data-confirm-title-zh="${escapeHtml(titleZh)}" data-confirm-title-en="${escapeHtml(titleEn)}" data-confirm-body-zh="${escapeHtml(bodyZh)}" data-confirm-body-en="${escapeHtml(bodyEn)}"`;
}

function setupPanelActions(panel) {
  if (Array.isArray(panel.actions)) return panel.actions;
  return panel.action ? [panel.action] : [];
}

function renderSetupFieldGate(stepKey, panel) {
  if (!setupStepUsesFieldGate(stepKey) || setupPanelActions(panel).length) return "";
  return `<div class="api-result setup-field-gate-result" data-field-gate-panel="${escapeHtml(stepKey)}" data-api-result="field-gate-${escapeHtml(stepKey)}" hidden></div>`;
}

function setupStepUsesFieldGate(stepKey) {
  return ["aliyun-account", "project"].includes(stepKey);
}

function renderProjectDraftFieldSections(fields, service = {}) {
  const sections = ["source", "workspace", "metadata"].map((sectionKey) => {
    const sectionFields = fields.filter((field) => projectSectionForFieldKey(field.key) === sectionKey);
    if (!sectionFields.length) return "";
    const section = projectDraftSections[sectionKey];
    if (sectionKey === "metadata" && sectionFields.some((field) => isSourceScopeFieldKey(field.key))) {
      return renderSourceScopeSection(sectionFields, section);
    }
    return `<section class="draft-field-section" data-project-field-section="${escapeHtml(sectionKey)}">
                <div class="draft-field-section-head">
                  <strong data-project-section-title="${escapeHtml(sectionKey)}">${escapeHtml(section.title.zh)}</strong>
                  <p data-project-section-note="${escapeHtml(sectionKey)}">${escapeHtml(section.note.zh)}</p>
                </div>
                <div class="draft-field-section-fields">
                  ${sectionFields.map((field) => renderDraftField(withProjectDefaultValue(field, service), { hideLabel: sectionKey === "source" || sectionKey === "workspace" })).join("\n                  ")}
                </div>
              </section>`;
  }).filter(Boolean);
  return `${sections.join("\n              ")}
              ${renderFolderPickerResultSlot()}`;
}

const sourceScopeRequiredKeys = ["metadata.stage", "metadata.subject", "metadata.grade"];
const sourceScopeExtraKeys = ["metadata.volume", "metadata.publisher", "metadata.edition"];

function isSourceScopeFieldKey(key) {
  return sourceScopeRequiredKeys.includes(key) || sourceScopeExtraKeys.includes(key);
}

function renderSourceScopeSection(fields, section) {
  const fieldMap = new Map(fields.map((field) => [field.key, field]));
  const scopeCopy = copy.zh.setup.sourceScope;
  const missing = sourceScopeRequiredKeys
    .map(sourceScopeFieldLabelZh)
    .join("、");
  const requiredSteps = sourceScopeRequiredKeys
    .map((key, index) => renderSourceScopeStep(fieldMap.get(key), index + 1))
    .join("\n                  ");
  const extraFields = sourceScopeExtraKeys
    .map((key) => fieldMap.get(key))
    .filter(Boolean)
    .map((field) => renderDraftField(field))
    .join("\n                    ");

  return `<section class="draft-field-section source-scope-section" data-project-field-section="metadata" data-source-scope>
                <div class="draft-field-section-head source-scope-head">
                  <div>
                    <strong data-project-section-title="metadata">${escapeHtml(section.title.zh)}</strong>
                    <p data-project-section-note="metadata">${escapeHtml(section.note.zh)}</p>
                  </div>
                  <div class="source-scope-status" data-source-scope-status data-state="missing">
                    <strong data-source-scope-status-title>${escapeHtml(scopeCopy.statusMissing.replace("{fields}", missing))}</strong>
                    <span data-source-scope-status-note>${escapeHtml(scopeCopy.requiredHint)}</span>
                  </div>
                </div>
                <div class="source-scope-steps">
                  ${requiredSteps}
                </div>
                ${extraFields ? `<details class="source-scope-extra" data-source-scope-extra>
                  <summary data-source-scope-extra-summary>${escapeHtml(scopeCopy.extraTitle)}<span>${escapeHtml(scopeCopy.extraNote)}</span></summary>
                  <div class="source-scope-extra-fields">
                    ${extraFields}
                  </div>
                </details>` : ""}
              </section>`;
}

function renderSourceScopeStep(field, index) {
  if (!field) return "";
  const stepKey = sourceScopeStepKey(field.key);
  const stepCopy = copy.zh.setup.sourceScope.steps[stepKey];
  return `<article class="source-scope-step" data-source-scope-step="${escapeHtml(field.key)}">
                    <div class="source-scope-step-head">
                      <span class="source-scope-step-index">${String(index).padStart(2, "0")}</span>
                      <div>
                        <strong>${escapeHtml(stepCopy.title)}</strong>
                        <p>${escapeHtml(stepCopy.desc)}</p>
                      </div>
                    </div>
                    ${renderSourceScopeMultiSelectDraftField(field)}
                  </article>`;
}

function sourceScopeStepKey(key) {
  if (key === "metadata.stage") return "stage";
  if (key === "metadata.subject") return "subject";
  return "grade";
}

function sourceScopeFieldLabelZh(key) {
  if (key === "metadata.stage") return "学段";
  if (key === "metadata.subject") return "学科";
  return "年级";
}

function renderSourceScopeMultiSelectDraftField(field) {
  const inputAttrs = `data-draft-field="${escapeHtml(field.key)}"`;
  return renderMultiSelectDraftField(field, inputAttrs, { sourceScope: true });
}

function withProjectDefaultValue(field, service = {}) {
  const defaultValue = defaultProjectFieldValue(field.key, service);
  if (!defaultValue || field.defaultValue) return field;
  return { ...field, defaultValue };
}

function defaultProjectFieldValue(key, service = {}) {
  if (key === "project.source" || key === "source.root") return service.defaultProjectFolders?.source || "";
  if (key === "project.workspace" || key === "workspace.root") return service.defaultProjectFolders?.workspace || "";
  return "";
}

function projectSectionForFieldKey(key) {
  if (key === "project.source" || key === "source.root") return "source";
  if (key === "project.workspace" || key === "workspace.root") return "workspace";
  return "metadata";
}

function renderDraftField(field, options = {}) {
  const sensitiveAttr = field.sensitive ? " data-draft-sensitive=\"true\"" : "";
  const inputAttrs = `data-draft-field="${escapeHtml(field.key)}"${sensitiveAttr}`;
  const placeholder = field.placeholder?.zh ? ` placeholder="${escapeHtml(field.placeholder.zh)}"` : "";
  const valueAttr = !field.sensitive && field.defaultValue ? ` value="${escapeHtml(field.defaultValue)}"` : "";
  const pickerTarget = fieldPickerTargetForDraftKey(field.key);

  if (field.type === "hidden") {
    return `<input type="hidden" ${inputAttrs}${valueAttr}>`;
  }

  if (field.type === "multi-select") {
    return renderMultiSelectDraftField(field, inputAttrs);
  }

  if (field.type === "select") {
    return `<label class="draft-field">
                <span data-draft-label="${escapeHtml(field.key)}">${escapeHtml(field.label.zh)}</span>
                <select ${inputAttrs}>
                  <option value="" data-i18n="setup.selectPlaceholder">${escapeHtml(copy.zh.setup.selectPlaceholder)}</option>
                  ${field.options.map((option, index) => {
                    const selected = field.defaultValue === option.value ? " selected" : "";
                    return `<option value="${escapeHtml(option.value)}" data-draft-option="${escapeHtml(field.key)}.${index}"${selected}>${escapeHtml(option.label.zh)}</option>`;
                  }).join("\n                  ")}
                </select>
              </label>`;
  }

  if (pickerTarget) {
    const inputId = draftFieldInputId(field.key);
    const titleKey = pickerTarget === "workspace" ? "workspaceTitle" : "sourceTitle";
    const bodyKey = pickerTarget === "workspace" ? "workspaceBody" : "sourceBody";
    const labelMarkup = options.hideLabel
      ? ""
      : `<label for="${escapeHtml(inputId)}" data-draft-label="${escapeHtml(field.key)}">${escapeHtml(field.label.zh)}</label>`;
    const ariaLabel = options.hideLabel ? ` aria-label="${escapeHtml(field.label.zh)}"` : "";
    return `<div class="draft-field draft-field-with-picker">
                ${labelMarkup}
                <div class="folder-dropzone" data-folder-dropzone="${escapeHtml(pickerTarget)}" data-folder-target="${escapeHtml(field.key)}" tabindex="0" role="button">
                  <span class="folder-dropzone-icon" aria-hidden="true"></span>
                  <strong data-i18n="setup.folderBrowser.${escapeHtml(titleKey)}">${escapeHtml(copy.zh.setup.folderBrowser[titleKey])}</strong>
                  <p data-i18n="setup.folderBrowser.${escapeHtml(bodyKey)}">${escapeHtml(copy.zh.setup.folderBrowser[bodyKey])}</p>
                  <div class="folder-dropzone-actions">
                    <button class="primary-action path-picker-action" type="button" data-folder-picker="${escapeHtml(pickerTarget)}" data-folder-target="${escapeHtml(field.key)}" data-i18n="setup.folderBrowser.choose">${escapeHtml(copy.zh.setup.folderBrowser.choose)}</button>
                  </div>
                </div>
                <div class="folder-path-entry">
                  <span data-i18n="setup.folderBrowser.pasteLabel">${escapeHtml(copy.zh.setup.folderBrowser.pasteLabel)}</span>
                  <div class="draft-field-row">
                    <input id="${escapeHtml(inputId)}" type="text" ${inputAttrs} data-path-precheck="${escapeHtml(pickerTarget)}"${ariaLabel}${placeholder}${valueAttr}>
                    <button class="secondary-action path-picker-action" type="button" data-folder-use-path="${escapeHtml(pickerTarget)}" data-folder-target="${escapeHtml(field.key)}" data-i18n="setup.folderBrowser.usePath">${escapeHtml(copy.zh.setup.folderBrowser.usePath)}</button>
                  </div>
                </div>
              </div>`;
  }

  return `<label class="draft-field">
                <span data-draft-label="${escapeHtml(field.key)}">${escapeHtml(field.label.zh)}</span>
                <input type="${field.type === "password" ? "password" : "text"}" ${inputAttrs}${placeholder}${valueAttr}>
              </label>`;
}

function renderMultiSelectDraftField(field, inputAttrs, options = {}) {
  const selected = normalizeMultiSelectValue(field.defaultValue);
  const valueAttr = ` value="${escapeHtml(JSON.stringify(selected))}"`;
  const isSourceScope = options.sourceScope === true;
  const head = isSourceScope
    ? `<span data-draft-label="${escapeHtml(field.key)}">${escapeHtml(field.label.zh)}</span>`
    : `<div class="k12-range-head">
              <span data-draft-label="${escapeHtml(field.key)}">${escapeHtml(field.label.zh)}</span>
            </div>`;
  return `<div class="draft-field k12-range-field" data-k12-range-field="${escapeHtml(field.key)}">
            ${head}
            <input type="hidden" ${inputAttrs} data-draft-multi-value="true"${valueAttr}>
            <div class="k12-range-options">
              ${(field.options || []).map((option) => {
                const pressed = selected.includes(option.value) ? "true" : "false";
                const stages = Array.isArray(option.stages) ? option.stages.join(" ") : "";
                return `<button class="k12-range-option" type="button" data-k12-option-stages="${escapeHtml(stages)}" data-k12-option="${escapeHtml(option.value)}" aria-pressed="${pressed}">${escapeHtml(option.label.zh)}</button>`;
              }).join("\n              ")}
            </div>
            <p class="k12-range-empty" data-k12-range-empty>${escapeHtml(copy.zh.setup.chooseStageFirst)}</p>
            <div class="k12-range-actions">
              ${renderK12RangeQuickActions(field.key)}
              <button class="secondary-action quiet-action" type="button" data-k12-clear="${escapeHtml(field.key)}">${escapeHtml(copy.zh.setup.clearSelection)}</button>
            </div>
          </div>`;
}

function renderK12RangeQuickActions(key) {
  const scopeCopy = copy.zh.setup.sourceScope;
  if (key === "metadata.stage") {
    return `<button class="secondary-action quiet-action" type="button" data-k12-select-all="${escapeHtml(key)}">${escapeHtml(scopeCopy.allStages)}</button>`;
  }
  if (key === "metadata.subject") {
    return [
      ["all", scopeCopy.allSubjects],
      ["core", scopeCopy.coreSubjects],
      ["science", scopeCopy.scienceSubjects],
      ["humanities", scopeCopy.humanitiesSubjects],
      ["arts", scopeCopy.artsSubjects]
    ].map(([preset, label]) => `<button class="secondary-action quiet-action" type="button" data-k12-preset="${escapeHtml(preset)}" data-k12-preset-target="${escapeHtml(key)}">${escapeHtml(label)}</button>`).join("\n              ");
  }
  if (key === "metadata.grade") {
    return `<button class="secondary-action quiet-action" type="button" data-k12-select-all="${escapeHtml(key)}">${escapeHtml(scopeCopy.allGrades)}</button>`;
  }
  if (key === "metadata.volume") {
    return `<button class="secondary-action quiet-action" type="button" data-k12-select-all="${escapeHtml(key)}">${escapeHtml(scopeCopy.allVolumes)}</button>`;
  }
  return `<button class="secondary-action quiet-action" type="button" data-k12-select-all="${escapeHtml(key)}">${escapeHtml(copy.zh.setup.selectAll)}</button>`;
}

function normalizeMultiSelectValue(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (!value) return [];
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return String(value).split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}

function renderFolderPickerResultSlot() {
  return `<div class="folder-picker-result" data-folder-picker-result="project" hidden></div>`;
}

function fieldPickerTargetForDraftKey(key) {
  if (key === "project.source" || key === "source.root") return "source";
  if (key === "project.workspace" || key === "workspace.root") return "workspace";
  return "";
}

function draftFieldInputId(key) {
  return `draft-${String(key).replace(/[^a-z0-9_-]+/gi, "-")}`;
}

function renderSetupGroupLink(group, index, activeKey, service = {}) {
  const groupSteps = stepsForGroup(group).filter((step) => step.scope === "all" || step.scope === defaultMode);
  const firstStep = groupSteps[0];
  const active = groupSteps.some((step) => step.key === activeKey) ? " active" : "";
  const label = copy.zh.setup.groups[group.key].label;
  const description = copy.zh.setup.groups[group.key].description;
  const currentStep = groupSteps.find((step) => step.key === activeKey) || firstStep;
  const currentLabel = copy.zh.setup.steps[currentStep?.key]?.label || "";
  const groupNumber = index + 1;
  const childLinks = groupSteps.length > 1
    ? `<ol class="setup-group-steps" data-setup-group-steps="${group.key}">
              ${groupSteps.map((step, stepIndex) => renderRailStepLink(step, group, groupNumber, stepIndex, activeKey, service)).join("\n              ")}
            </ol>`
    : "";
  return `<div class="setup-group${active}" data-setup-group-wrapper="${group.key}" data-setup-group-scope="${escapeHtml(group.scope)}">
            <a class="setup-group-link${active}" href="${pageHref(service, firstStep?.path || "/setup/mode")}" data-setup-group-link="${group.key}" data-setup-group-index="${index}" data-setup-group-scope="${escapeHtml(group.scope)}">
              <span class="setup-group-index">${groupNumber}</span>
              <span class="setup-group-copy">
                <strong data-i18n="setup.groups.${group.key}.label">${escapeHtml(label)}</strong>
                <em data-i18n="setup.groups.${group.key}.description">${escapeHtml(description)}</em>
                <small data-setup-group-current="${group.key}" data-i18n="setup.steps.${currentStep?.key}.label">${escapeHtml(currentLabel)}</small>
              </span>
            </a>
            ${childLinks}
          </div>`;
}

function renderRailStepLink(step, group, groupNumber, stepIndex, activeKey, service) {
  const active = step.key === activeKey ? " active" : "";
  const label = copy.zh.setup.steps[step.key].label;
  return `<li>
                <a class="setup-group-step-link${active}" href="${pageHref(service, step.path)}" data-setup-step-link="${step.key}" data-setup-step-group="${group.key}" data-setup-step-index="${stepIndex}" data-setup-step-scope="${escapeHtml(step.scope)}">
                  <span class="setup-step-number">${groupNumber}.${stepIndex + 1}</span>
                  <span data-i18n="setup.steps.${step.key}.label">${escapeHtml(label)}</span>
                </a>
              </li>`;
}

function renderSetupSubsteps(activeKey, service = {}) {
  const group = setupGroupForStep(activeKey);
  if (!group) return "";
  const steps = stepsForGroup(group);
  if (steps.length <= 1) return "";
  return `<nav class="setup-substeps" aria-label="Setup substeps">
          ${steps.map((step, index) => renderStepLink(step, index, activeKey, service)).join("\n          ")}
        </nav>`;
}

function renderStepLink(step, index, activeKey, service) {
  const active = step.key === activeKey ? " active" : "";
  const label = copy.zh.setup.steps[step.key].label;
  return `<a class="step-link setup-substep-link${active}" href="${pageHref(service, step.path)}" data-setup-step-link="${step.key}" data-setup-step-index="${index}" data-setup-step-scope="${escapeHtml(step.scope)}">
            <span class="step-index">${index + 1}</span>
            <span data-i18n="setup.steps.${step.key}.label">${escapeHtml(label)}</span>
          </a>`;
}

function renderSetupActions(route, previous, next, service = {}) {
  const back = previous
    ? `<a class="setup-nav-action setup-nav-action--back" href="${pageHref(service, previous.path)}" data-setup-back data-i18n="setup.previous">${escapeHtml(copy.zh.setup.previous)}</a>`
    : "";
  if (route.key === "aliyun-credential") {
    return renderCredentialSetupActions(back, next, service);
  }
  if (route.key === "aliyun-permissions") {
    return renderPermissionsSetupActions(back, route, next, service);
  }
  if (route.key === "aliyun-storage") {
    return renderStorageSetupActions(back, route, next, service);
  }
  if (route.key === "aliyun-services") {
    return renderModelProviderSetupActions(back, route, next, service);
  }
  if (route.key === "aliyun-model-quality") {
    return renderModelQualitySetupActions(back, route, next, service);
  }
  if (route.key === "aliyun-search") {
    return renderSearchSetupActions(back, route, next, service);
  }
  if (route.key === "retrieval") {
    return renderRetrievalSetupActions(back, route, next, service);
  }
  if (route.key === "environment" || route.key === "scan" || route.key === "plan") {
    return renderWorkspaceStepSetupActions(back, route, next, service);
  }
  const testAction = setupFooterTestAction(route.key);
  const testLabelKey = route.key === "aliyun-credential" ? "setup.testCredential" : "setup.testCurrent";
  const testLabel = route.key === "aliyun-credential" ? copy.zh.setup.testCredential : copy.zh.setup.testCurrent;
  const test = testAction
    ? `<button class="setup-tool-action setup-tool-action--secondary" type="button" data-setup-footer-test="${escapeHtml(testAction)}" data-i18n="${escapeHtml(testLabelKey)}">${escapeHtml(testLabel)}</button>`
    : "";
  const left = `<span class="setup-action-group setup-action-group--left">${back}${test}</span>`;
  let primary = "";

  if (route.key === "mode") {
    primary = `<button class="setup-nav-action setup-nav-action--continue" type="button" data-setup-complete="mode" data-i18n="setup.doneNext">${escapeHtml(copy.zh.setup.doneNext)}</button>`;
  } else if (route.key === "aliyun-account") {
    primary = `<button class="setup-nav-action setup-nav-action--continue" type="button" data-account-selected-action data-account-dedicated-next="${pageHref(service, "/setup/aliyun/credential")}" data-account-check-endpoint="${apiEndpoint(service, "/api/aliyun/identity/check")}" data-account-success-next="${pageHref(service, "/setup/aliyun/permissions")}" data-account-failure-next="${pageHref(service, "/setup/aliyun/credential")}" data-i18n="setup.doneNext">${escapeHtml(copy.zh.setup.doneNext)}</button>`;
  } else if (route.key === "finish") {
    primary = `<button class="setup-nav-action setup-nav-action--continue" type="button" data-setup-complete="finish" data-setup-finish="true" data-i18n="setup.finish">${escapeHtml(copy.zh.setup.finish)}</button>`;
  } else {
    primary = renderSetupContinueAction(route.key, next, "setup.doneNext", copy.zh.setup.doneNext, "", service);
  }

  return `${left}
          <span class="setup-action-group setup-action-group--right">${primary}</span>`;
}

function renderCredentialSetupActions(back, next, service = {}) {
  const credentialPanel = setupDraftPanels["aliyun-credential"];
  const testAction = credentialPanel.actions.find((action) => action.key === "save-aliyun-credentials");
  const clearAction = credentialPanel.actions.find((action) => action.key === "clear-aliyun-credentials");
  const clear = renderSetupFooterApiAction(clearAction, "setup-tool-action setup-tool-action--danger", " data-requires-saved-credential hidden", service);
  const test = renderSetupFooterApiAction(testAction, "setup-tool-action setup-tool-action--primary", "", service);
  const primary = renderSetupContinueAction("aliyun-credential", next, "setup.doneNext", copy.zh.setup.doneNext, "save-aliyun-credentials", service);
  return `<span class="setup-action-group setup-action-group--left">${back}${clear}</span>
          <span class="setup-action-group setup-action-group--right">${test}${primary}</span>`;
}

function renderPermissionsSetupActions(back, route, next, service = {}) {
  const permissionPanel = setupDraftPanels["aliyun-permissions"];
  const checkAction = permissionPanel.actions.find((action) => action.key === "check-aliyun-permissions");
  const policyAction = permissionPanel.actions.find((action) => action.key === "copy-aliyun-policy");
  const policy = renderSetupFooterApiAction(policyAction, "setup-tool-action setup-tool-action--secondary", "", service);
  const check = renderSetupFooterApiAction(checkAction, "setup-tool-action setup-tool-action--primary", "", service);
  const primary = renderSetupContinueAction(route.key, next, "setup.doneNext", copy.zh.setup.doneNext, "check-aliyun-permissions", service);
  return `<span class="setup-action-group setup-action-group--left">${back}</span>
          <span class="setup-action-group setup-action-group--right">${policy}${check}${primary}</span>`;
}

function renderStorageSetupActions(back, route, next, service = {}) {
  const storagePanel = setupDraftPanels["aliyun-storage"];
  const checkAction = storagePanel.actions.find((action) => action.key === "preview-aliyun-storage");
  const check = renderSetupFooterApiAction(checkAction, "setup-tool-action setup-tool-action--primary", "", service);
  const primary = renderSetupContinueAction(route.key, next, "setup.doneNext", copy.zh.setup.doneNext, "preview-aliyun-storage", service);
  return `<span class="setup-action-group setup-action-group--left">${back}</span>
          <span class="setup-action-group setup-action-group--right">${check}${primary}</span>`;
}

function renderModelProviderSetupActions(back, route, next, service = {}) {
  const servicesPanel = setupDraftPanels["aliyun-services"];
  const checkAction = setupPanelActions(servicesPanel).find((action) => action.key === "test-aliyun-model-provider");
  const check = renderSetupFooterApiAction(checkAction, "setup-tool-action setup-tool-action--primary", "", service);
  const primary = renderSetupContinueAction(route.key, next, "setup.doneNext", copy.zh.setup.doneNext, "test-aliyun-model-provider", service);
  return `<span class="setup-action-group setup-action-group--left">${back}</span>
          <span class="setup-action-group setup-action-group--right">${check}${primary}</span>`;
}

function renderModelQualitySetupActions(back, route, next, service = {}) {
  const qualityPanel = setupDraftPanels["aliyun-model-quality"];
  const checkAction = setupPanelActions(qualityPanel).find((action) => action.key === "save-aliyun-model-quality");
  const check = renderSetupFooterApiAction(checkAction, "setup-tool-action setup-tool-action--primary", "", service);
  const primary = renderSetupContinueAction(route.key, next, "setup.doneNext", copy.zh.setup.doneNext, "save-aliyun-model-quality", service);
  return `<span class="setup-action-group setup-action-group--left">${back}</span>
          <span class="setup-action-group setup-action-group--right">${check}${primary}</span>`;
}

function renderSearchSetupActions(back, route, next, service = {}) {
  const searchPanel = setupDraftPanels["aliyun-search"];
  const checkAction = setupPanelActions(searchPanel).find((action) => action.key === "save-aliyun-search");
  const check = renderSetupFooterApiAction(checkAction, "setup-tool-action setup-tool-action--primary", "", service);
  const primary = renderSetupContinueAction(route.key, next, "setup.doneNext", copy.zh.setup.doneNext, "save-aliyun-search", service);
  return `<span class="setup-action-group setup-action-group--left">${back}</span>
          <span class="setup-action-group setup-action-group--right">${check}${primary}</span>`;
}

function renderRetrievalSetupActions(back, route, next, service = {}) {
  const retrievalPanel = setupDraftPanels.retrieval;
  const checkAction = setupPanelActions(retrievalPanel).find((action) => action.key === "save-retrieval-strategy");
  const check = renderSetupFooterApiAction(checkAction, "setup-tool-action setup-tool-action--primary", "", service);
  const primary = renderSetupContinueAction(route.key, next, "setup.doneNext", copy.zh.setup.doneNext, "save-retrieval-strategy", service);
  return `<span class="setup-action-group setup-action-group--left">${back}</span>
          <span class="setup-action-group setup-action-group--right">${check}${primary}</span>`;
}

function renderWorkspaceStepSetupActions(back, route, next, service = {}) {
  const panel = setupDraftPanels[route.key];
  const checkAction = setupPanelActions(panel).find((action) => action.key && action.method !== "DELETE");
  const check = renderSetupFooterApiAction(checkAction, "setup-tool-action setup-tool-action--primary", "", service);
  const primary = renderSetupContinueAction(route.key, next, "setup.doneNext", copy.zh.setup.doneNext, checkAction?.key || "", service);
  return `<span class="setup-action-group setup-action-group--left">${back}</span>
          <span class="setup-action-group setup-action-group--right">${check}${primary}</span>`;
}

function renderSetupContinueAction(stepKey, next, i18nKey, label, requiredAction = "", service = {}) {
  const actionKey = requiredAction || setupFooterTestAction(stepKey);
  const nextAttr = next ? ` data-setup-next="${pageHref(service, next.path)}"` : "";
  const fieldGateAttr = !actionKey && setupStepUsesFieldGate(stepKey) ? ` data-setup-requires-fields="true" disabled aria-disabled="true"` : "";
  const gateAttr = actionKey ? ` data-setup-requires-passed-action="${escapeHtml(actionKey)}" disabled aria-disabled="true"` : fieldGateAttr;
  return `<button class="setup-nav-action setup-nav-action--continue" type="button" data-setup-complete="${escapeHtml(stepKey)}"${nextAttr}${gateAttr} data-i18n="${escapeHtml(i18nKey)}">${escapeHtml(label)}</button>`;
}

function renderSetupFooterApiAction(action, className, extraAttrs = "", service = {}) {
  if (!action) return "";
  const method = action.method ? ` data-api-method="${escapeHtml(action.method)}"` : "";
  const resultAttr = action.resultKey ? ` data-api-result-key="${escapeHtml(action.resultKey)}"` : "";
  const confirmAttr = renderConfirmAttrs(action.confirm);
  return `<button class="${escapeHtml(className)}" type="button" data-setup-api-source="footer" data-setup-api-action="${escapeHtml(action.key)}" data-api-endpoint="${apiEndpoint(service, action.endpoint)}"${method}${resultAttr}${confirmAttr} data-api-loading-zh="${escapeHtml(action.loading.zh)}" data-api-loading-en="${escapeHtml(action.loading.en)}"${extraAttrs}>${escapeHtml(action.label.zh)}</button>`;
}

function setupFooterTestAction(stepKey) {
  const actions = setupDraftPanels[stepKey]?.actions || [];
  return actions.find((action) => action.key && action.method !== "DELETE")?.key || "";
}

function renderKnowledgeBaseManagement(service = {}) {
  const library = service.knowledgeBases || { current: null, items: [] };
  const items = Array.isArray(library.items) ? library.items : [];
  const current = library.current || items[0] || null;
  const labels = copy.zh.knowledgeBases;
  if (!items.length) {
    return `<section class="knowledge-base-manager knowledge-base-manager--empty" data-knowledge-base-library data-knowledge-base-empty>
          <div class="knowledge-base-empty">
            <span class="card-kicker" data-i18n="knowledgeBases.current">${escapeHtml(labels.current)}</span>
            <h2 data-i18n="knowledgeBases.emptyTitle">${escapeHtml(labels.emptyTitle)}</h2>
            <p data-i18n="knowledgeBases.emptyBody">${escapeHtml(labels.emptyBody)}</p>
            <button class="primary-action" type="button" data-knowledge-base-create data-i18n="knowledgeBases.create">${escapeHtml(labels.create)}</button>
          </div>
        </section>`;
  }
  return `<section class="knowledge-base-manager" data-knowledge-base-library>
          <header class="knowledge-base-manager-head">
            <div>
              <span class="card-kicker" data-i18n="knowledgeBases.current">${escapeHtml(labels.current)}</span>
              <h2 data-i18n="knowledgeBases.title">${escapeHtml(labels.title)}</h2>
              <p data-i18n="knowledgeBases.lead">${escapeHtml(labels.lead)}</p>
            </div>
            <button class="primary-action" type="button" data-knowledge-base-create data-i18n="knowledgeBases.create">${escapeHtml(labels.create)}</button>
          </header>
          <div class="knowledge-base-manager-list">
            ${items.map((item) => renderKnowledgeBaseManagementItem(item, current?.id === item.id, service)).join("\n            ")}
          </div>
        </section>`;
}

function renderKnowledgeBaseManagementItem(item, isCurrent, service = {}) {
  const labels = copy.zh.knowledgeBases;
  const jobText = item.latestJobStatus || labels.noJob;
  const sourceText = item.sourceRoot || labels.noSource;
  const workspaceText = item.workspaceRoot || labels.noWorkspace;
  const templateText = item.template || "general-docs";
  return `<article class="knowledge-base-item knowledge-base-manager-item" data-current="${isCurrent ? "true" : "false"}">
              <div class="knowledge-base-item-main">
                <span class="status-dot ${isCurrent ? "pass" : ""}" aria-hidden="true"></span>
                <div>
                  <strong title="${escapeHtml(item.name || item.id)}">${escapeHtml(item.name || item.id)}</strong>
                  <p><span data-i18n="knowledgeBases.status">${escapeHtml(labels.status)}</span>: ${escapeHtml(item.status || "draft")} · <span data-i18n="knowledgeBases.latestJob">${escapeHtml(labels.latestJob)}</span>: ${escapeHtml(jobText)}</p>
                  <p><span data-i18n="knowledgeBases.template">${escapeHtml(labels.template)}</span>: <code>${escapeHtml(templateText)}</code></p>
                  <p><span data-i18n="knowledgeBases.source">${escapeHtml(labels.source)}</span>: <code title="${escapeHtml(sourceText)}">${escapeHtml(sourceText)}</code></p>
                  <p><span data-i18n="knowledgeBases.workspace">${escapeHtml(labels.workspace)}</span>: <code title="${escapeHtml(workspaceText)}">${escapeHtml(workspaceText)}</code></p>
                </div>
              </div>
              <div class="knowledge-base-manager-actions">
                ${isCurrent
                  ? `<span class="knowledge-base-current" data-i18n="knowledgeBases.currentBadge">${escapeHtml(labels.currentBadge)}</span>`
                  : `<button class="secondary-action quiet-action" type="button" data-knowledge-base-switch="${escapeHtml(item.id)}" data-i18n="knowledgeBases.switch">${escapeHtml(labels.switch)}</button>`}
              </div>
            </article>`;
}

function renderOverviewBuildFlow(content, page) {
  return `<section class="workbench-flow" data-workbench-flow="overview">
          ${content.cards.map((card, index) => `<article>
            <span>${escapeHtml(card[0])}</span>
            <div>
              <strong ${contentAttr("console.pages.overview", `cards.${index}.1`, page)}>${escapeHtml(card[1])}</strong>
              <p ${contentAttr("console.pages.overview", `cards.${index}.2`, page)}>${escapeHtml(card[2])}</p>
            </div>
          </article>`).join("\n          ")}
        </section>`;
}

function renderBuildWorkflowRail(service = {}) {
  const steps = copy.zh.console.buildWorkflow.routeSteps;
  const routes = ["#scan", "#plan", pageHref(service, "/build/execution")];
  return `<nav class="build-flow-rail" data-build-flow-rail aria-label="Build knowledge base path">
          ${steps.map((step, index) => `<a href="${escapeHtml(routes[index])}"${index === 0 ? ` aria-current="step"` : ""}>
            <span data-i18n="console.buildWorkflow.routeSteps.${index}.0">${escapeHtml(step[0])}</span>
            <strong data-i18n="console.buildWorkflow.routeSteps.${index}.1">${escapeHtml(step[1])}</strong>
            <small data-i18n="console.buildWorkflow.routeSteps.${index}.2">${escapeHtml(step[2])}</small>
          </a>`).join("\n          ")}
        </nav>`;
}

function renderBuildKnowledgePanel(content, page, service = {}) {
  const workflow = copy.zh.console.buildWorkflow;
  return `${renderBuildKnowledgeTabs("build", service)}
        ${renderBuildWorkflowRail(service)}
        <section class="build-workflow" data-build-workflow>
          <section class="build-step-panel" data-build-step="scan" id="scan">
            <header>
              <span class="build-step-index">01</span>
              <div>
                <h2 data-i18n="console.buildWorkflow.scanTitle">${escapeHtml(workflow.scanTitle)}</h2>
                <p data-i18n="console.buildWorkflow.scanBody">${escapeHtml(workflow.scanBody)}</p>
              </div>
            </header>
            <div class="build-step-status" data-build-result-summary="preview-scan" data-status="pending">
              <span class="status-dot" aria-hidden="true"></span>
              <strong data-build-result-title data-i18n="console.buildWorkflow.scanPendingTitle">${escapeHtml(workflow.scanPendingTitle)}</strong>
              <span data-build-result-body data-i18n="console.buildWorkflow.scanPendingBody">${escapeHtml(workflow.scanPendingBody)}</span>
            </div>
            <div class="build-step-actions">
              <button class="primary-action" type="button" data-console-api-action="preview-scan" data-build-action="preview-scan" data-api-endpoint="${apiEndpoint(service, "/api/scan/preview")}" data-api-loading-zh="正在扫描资料..." data-api-loading-en="Scanning sources..." data-label-initial-zh="${escapeHtml(content.primary)}" data-label-initial-en="${escapeHtml(copy.en.console.pages.build.primary)}" data-label-rerun-zh="${escapeHtml(workflow.scanRerun)}" data-label-rerun-en="${escapeHtml(copy.en.console.buildWorkflow.scanRerun)}" ${contentAttr("console.pages.build", "primary", page)}>${escapeHtml(content.primary)}</button>
              <button class="secondary-action" type="button" data-build-open-result="preview-scan" hidden data-i18n="console.buildWorkflow.scanOpen">${escapeHtml(workflow.scanOpen)}</button>
            </div>
            <div class="api-result build-api-result" data-api-result="preview-scan" hidden></div>
          </section>
          <section class="build-step-panel" data-build-step="plan" id="plan">
            <header>
              <span class="build-step-index">02</span>
              <div>
                <h2 data-i18n="console.buildWorkflow.planTitle">${escapeHtml(workflow.planTitle)}</h2>
                <p data-i18n="console.buildWorkflow.planBody">${escapeHtml(workflow.planBody)}</p>
              </div>
            </header>
            <div class="build-step-status" data-build-result-summary="preview-run" data-status="pending">
              <span class="status-dot" aria-hidden="true"></span>
              <strong data-build-result-title data-i18n="console.buildWorkflow.planPendingTitle">${escapeHtml(workflow.planPendingTitle)}</strong>
              <span data-build-result-body data-i18n="console.buildWorkflow.planPendingBody">${escapeHtml(workflow.planPendingBody)}</span>
            </div>
            <div class="build-step-actions">
              <button class="primary-action" type="button" data-console-api-action="preview-run" data-build-action="preview-run" data-api-endpoint="${apiEndpoint(service, "/api/plan/preview")}" data-api-loading-zh="正在生成计划..." data-api-loading-en="Generating plan..." data-label-initial-zh="${escapeHtml(content.secondary)}" data-label-initial-en="${escapeHtml(copy.en.console.pages.build.secondary)}" data-label-rerun-zh="${escapeHtml(workflow.planRerun)}" data-label-rerun-en="${escapeHtml(copy.en.console.buildWorkflow.planRerun)}" ${contentAttr("console.pages.build", "secondary", page)}>${escapeHtml(content.secondary)}</button>
              <button class="secondary-action" type="button" data-build-open-result="preview-run" hidden data-i18n="console.buildWorkflow.planOpen">${escapeHtml(workflow.planOpen)}</button>
              <button class="primary-action build-create-task-action" type="button" data-build-create-job hidden data-console-api-action="confirm-build-job" data-api-endpoint="${apiEndpoint(service, "/api/jobs/confirm")}" data-api-loading-zh="${escapeHtml(workflow.createTaskLoading)}" data-api-loading-en="${escapeHtml(copy.en.console.buildWorkflow.createTaskLoading)}" data-i18n="console.buildWorkflow.createTask">${escapeHtml(workflow.createTask)}</button>
            </div>
            <div class="api-result build-api-result plan-preview-result" data-api-result="preview-run" hidden></div>
            <div class="api-result build-api-result" data-api-result="confirm-build-job" hidden></div>
          </section>
        </section>`;
}

function renderNavItem(item, activeKey, service = {}) {
  const active = item.key === activeKey ? " aria-current=\"page\"" : "";
  const activeClass = item.key === activeKey ? " active" : "";
  return `<a class="nav-link${activeClass}" href="${pageHref(service, item.path)}"${active} data-nav-key="${item.key}" title="${escapeHtml(copy.zh.nav[item.key])}">
          <svg class="icon nav-icon" aria-hidden="true"><use href="#icon-${item.icon}"></use></svg>
          <span class="nav-text" data-i18n="nav.${item.key}">${escapeHtml(copy.zh.nav[item.key])}</span>
        </a>`;
}

function renderCard(pathPrefix, card, index, page) {
  const prefix = page.modes ? `${pathPrefix}.modes.{mode}.cards` : `${pathPrefix}.cards`;
  const attr = page.modes ? "data-mode-i18n" : "data-i18n";
  return `<article class="info-card">
            <span class="card-kicker" ${attr}="${prefix}.${index}.2">${escapeHtml(card[2])}</span>
            <h2 ${attr}="${prefix}.${index}.0">${escapeHtml(card[0])}</h2>
            <p ${attr}="${prefix}.${index}.1">${escapeHtml(card[1])}</p>
          </article>`;
}

function contentAttr(pathPrefix, prop, page) {
  if (page.modes) return `data-mode-i18n="${pathPrefix}.modes.{mode}.${prop}"`;
  return `data-i18n="${pathPrefix}.${prop}"`;
}

function resolveModeContent(page, mode) {
  return page.modes?.[mode] || page;
}

function setupStepsForMode(mode) {
  return setupSteps.filter((step) => step.scope === "all" || step.scope === mode);
}

function setupGroupsForMode(mode) {
  return setupGroups.filter((group) => group.scope === "all" || group.scope === mode);
}

function setupGroupForStep(stepKey) {
  const step = setupSteps.find((item) => item.key === stepKey);
  return step ? setupGroups.find((group) => group.key === step.group) : null;
}

function stepsForGroup(group) {
  return group.stepKeys
    .map((key) => setupSteps.find((step) => step.key === key))
    .filter(Boolean);
}

function buildPageState({ pageType, service, active, activeSetupStep }) {
  const basePath = normalizeBasePath(service.basePath || "");
  const apiBasePath = service.apiBasePath || (basePath ? `${basePath}/api` : "/api");
  return {
    pageType,
    active,
    activeSetupStep,
    basePath,
    apiBasePath,
    defaultMode,
    defaultTemplateId,
    endpoint: service.endpoint,
    version: service.version,
    setupState: service.setupState || {},
    knowledgeBases: service.knowledgeBases || { ok: true, current: null, items: [] },
    defaultProjectFolders: service.defaultProjectFolders || {},
    credentialLocations: service.credentialLocations || {},
    setupSteps,
    setupGroups,
    setupDraftPanels,
    aliyunModelCatalog,
    aliyunModelSlots,
    retrievalProfiles,
    retrievalMethods,
    defaultRetrievalProfileId,
    setupTaskBriefs,
    setupAliyunGuides,
    projectDraftSections,
    consoleNavItems,
    templateLibraryVersion,
    templates: templateSummaries,
    copy
  };
}

function renderStateScript(state) {
  return `${renderUiOverlays()}
  <script id="km-state" type="application/json">${escapeJson(state)}</script>
  <script src="/web-console/app.js?v=${assetVersion}"></script>`;
}

function renderUiOverlays() {
  return `<div class="app-dialog-backdrop" data-app-dialog-root hidden>
    <section class="app-dialog" role="dialog" aria-modal="true" aria-labelledby="appDialogTitle" aria-describedby="appDialogBody">
      <span class="card-kicker" data-app-dialog-kicker>KnowMesh</span>
      <h2 id="appDialogTitle" data-app-dialog-title></h2>
      <div class="app-dialog-body" id="appDialogBody" data-app-dialog-body></div>
      <input class="app-dialog-input" type="text" data-app-dialog-input hidden>
      <div class="app-dialog-actions">
        <button class="secondary-action" type="button" data-app-dialog-cancel data-i18n="setup.dialogCancel">${escapeHtml(copy.zh.setup.dialogCancel)}</button>
        <button class="primary-action" type="button" data-app-dialog-confirm data-i18n="setup.dialogConfirm">${escapeHtml(copy.zh.setup.dialogConfirm)}</button>
      </div>
    </section>
  </div>
  <div class="toast-region" data-toast-region aria-live="polite" aria-atomic="false"></div>`;
}

function normalizePath(pathname) {
  if (!pathname || pathname === "/") return "/";
  const withoutSlash = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return withoutSlash;
}

function renderIconSprite() {
  return `<svg class="icon-sprite" aria-hidden="true">
    <symbol id="icon-menu" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></symbol>
    <symbol id="icon-home" viewBox="0 0 24 24"><path d="m4 11 8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-6h4v6"/></symbol>
    <symbol id="icon-database" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/><path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></symbol>
    <symbol id="icon-file" viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></symbol>
    <symbol id="icon-layers" viewBox="0 0 24 24"><path d="m12 3 8 4-8 4-8-4z"/><path d="m4 12 8 4 8-4"/><path d="m4 17 8 4 8-4"/></symbol>
    <symbol id="icon-shield" viewBox="0 0 24 24"><path d="M12 3 19 6v5c0 5-3.2 8.2-7 10-3.8-1.8-7-5-7-10V6z"/><path d="m8.8 12 2.2 2.2 4.4-5"/></symbol>
    <symbol id="icon-link" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"/></symbol>
    <symbol id="icon-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></symbol>
    <symbol id="icon-graph" viewBox="0 0 24 24"><circle cx="6" cy="15" r="2"/><circle cx="12" cy="7" r="2"/><circle cx="18" cy="13" r="2"/><circle cx="15" cy="19" r="2"/><path d="m7.4 13.4 3.2-4.8M13.8 8.3l2.4 3.4M16.8 14.7l-1 2.6M8 15.5l5 3"/></symbol>
    <symbol id="icon-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.2 2.5 3.3 5.5 3.3 9S14.2 18.5 12 21"/><path d="M12 3C9.8 5.5 8.7 8.5 8.7 12S9.8 18.5 12 21"/></symbol>
    <symbol id="icon-arrow-right" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></symbol>
    <symbol id="icon-chevron-down" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
    <symbol id="icon-mode" viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M5 7h6"/><path d="M13 17h6"/><circle cx="5" cy="7" r="2"/><circle cx="19" cy="17" r="2"/></symbol>
    <symbol id="icon-template" viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="M4 10h16M10 10v9"/></symbol>
    <symbol id="icon-environment" viewBox="0 0 24 24"><path d="M20 7 9 18l-5-5"/><path d="M4 7h8"/></symbol>
    <symbol id="icon-settings" viewBox="0 0 24 24"><path d="M4 7h16M4 17h16"/><path d="M8 5v4M16 15v4"/></symbol>
    <symbol id="icon-scan" viewBox="0 0 24 24"><path d="M5 5h5M14 5h5M5 19h5M14 19h5"/><path d="M7 9v6M17 9v6M9 12h6"/></symbol>
    <symbol id="icon-build" viewBox="0 0 24 24"><path d="M4 17 12 7l8 10"/><path d="M7 17h10"/><path d="M12 7v10"/></symbol>
    <symbol id="icon-run" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></symbol>
    <symbol id="icon-api" viewBox="0 0 24 24"><path d="M8 7h8M8 12h8M8 17h5"/><path d="M4 4h16v16H4z"/><path d="M4 9H2M4 15H2M22 9h-2M22 15h-2"/></symbol>
    <symbol id="icon-ask" viewBox="0 0 24 24"><path d="M5 6h14v10H8l-3 3z"/><path d="M9 10h6M9 13h4"/></symbol>
    <symbol id="icon-feedback" viewBox="0 0 24 24"><path d="M5 5h14v10H8l-3 3z"/><path d="M9 9h6M9 12h4"/><path d="m15 18 2 2 4-5"/></symbol>
    <symbol id="icon-maintenance" viewBox="0 0 24 24"><path d="M14.5 6.5 17 4l3 3-2.5 2.5"/><path d="m14 7 3 3-8 8H6v-3z"/></symbol>
    <symbol id="icon-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol>
    <symbol id="icon-refresh" viewBox="0 0 24 24"><path d="M20 12a8 8 0 0 1-13.6 5.7"/><path d="M4 12A8 8 0 0 1 17.6 6.3"/><path d="M17 2v5h5"/><path d="M7 22v-5H2"/></symbol>
    <symbol id="icon-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 10v7"/><path d="M12 7h.01"/></symbol>
    <symbol id="icon-receipt" viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h4"/></symbol>
    <symbol id="icon-moon" viewBox="0 0 24 24"><path d="M20 15.5A8 8 0 0 1 8.5 4 7 7 0 1 0 20 15.5z"/></symbol>
    <symbol id="icon-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></symbol>
  </svg>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function escapeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}















