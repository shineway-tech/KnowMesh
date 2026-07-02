export const extensionLifecycleStages = ["official", "certified", "community", "experimental"];

export function validateExpertExtension(expert = {}) {
  const issues = [];
  const stage = String(expert.lifecycle?.stage || "").trim();
  if (!extensionLifecycleStages.includes(stage)) issues.push("lifecycle.stage");
  if (hasInternalSqliteDependency(expert.capabilities)) issues.push("internalSQLiteDependency");
  if (hasUnsafePermissions(expert.permissions)) issues.push("unsafePermissions");
  if (expert.mutatesCoreTables === true) issues.push("coreTableMutation");
  return {
    ok: issues.length === 0,
    issues
  };
}

export function validateProviderAdapterContract(contract = {}) {
  const issues = [];
  const stage = String(contract.lifecycle?.stage || "").trim();
  if (!extensionLifecycleStages.includes(stage)) issues.push("lifecycle.stage");
  if (!Array.isArray(contract.requiredMethods) || contract.requiredMethods.length === 0) issues.push("requiredMethods");
  if (!contract.interfaceVersion) issues.push("interfaceVersion");
  if (!contract.id) issues.push("id");
  if (hasInternalSqliteDependency(contract)) issues.push("internalSQLiteDependency");
  if (hasUnsafePermissions(contract.permissions)) issues.push("unsafePermissions");
  return {
    ok: issues.length === 0,
    issues
  };
}

export function extensionLifecyclePolicy() {
  return {
    stages: extensionLifecycleStages,
    graduation: [
      "experimental",
      "community",
      "certified",
      "official"
    ],
    rules: [
      "Use public Core interfaces.",
      "Do not read or mutate internal SQLite files directly.",
      "Declare permissions, cost, privacy, and external-call boundaries.",
      "Ship tests and bilingual docs before moving beyond experimental."
    ]
  };
}

function hasInternalSqliteDependency(value, seen = new Set()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    const text = typeof item === "string" ? item : typeof key === "string" ? key : "";
    if (/catalog\.sqlite|workspace\.sqlite|internal-sqlite|directCatalog/i.test(text)) return true;
    if (item && typeof item === "object" && hasInternalSqliteDependency(item, seen)) return true;
  }
  return false;
}

function hasUnsafePermissions(permissions) {
  if (!Array.isArray(permissions)) return false;
  return permissions.some((item) => ["*", "admin", "root", "filesystem:all", "sqlite:write"].includes(String(item || "").trim()));
}
