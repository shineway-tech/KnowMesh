import fs from "node:fs";

export function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const loaded = {};
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);

  for (const line of lines) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^([^=]+)=(.*)$/);
    if (!match) continue;

    const key = match[1].trim();
    const value = unquote(match[2].trim());
    loaded[key] = value;
    if (!(key in process.env)) process.env[key] = value;
  }

  return loaded;
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
