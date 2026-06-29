import fs from "node:fs";

export function readRtfText(filePath) {
  try {
    return rtfToText(fs.readFileSync(filePath, "utf8"));
  } catch {
    return "";
  }
}

export function rtfToText(input) {
  const text = String(input || "");
  const output = [];

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{" || char === "}") continue;
    if (char !== "\\") {
      output.push(char);
      continue;
    }

    const next = text[index + 1];
    if (next === "\\" || next === "{" || next === "}") {
      output.push(next);
      index += 1;
      continue;
    }

    if (next === "'") {
      const hex = text.slice(index + 2, index + 4);
      const code = Number.parseInt(hex, 16);
      if (Number.isFinite(code)) output.push(Buffer.from([code]).toString("latin1"));
      index += 3;
      continue;
    }

    const control = text.slice(index + 1).match(/^([a-zA-Z]+)(-?\d+)? ?/);
    if (!control) {
      index += 1;
      continue;
    }

    const word = control[1];
    const value = control[2];
    index += control[0].length;
    if (word === "par" || word === "line") output.push("\n");
    if (word === "tab") output.push("\t");
    if (word === "u" && value) {
      const codePoint = Number(value);
      output.push(String.fromCodePoint(codePoint < 0 ? codePoint + 65536 : codePoint));
      if (text[index + 1] === "?") index += 1;
    }
  }

  return normalizeRtfText(output.join(""));
}

function normalizeRtfText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}
