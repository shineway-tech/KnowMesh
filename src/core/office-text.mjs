import fs from "node:fs";
import zlib from "node:zlib";

const wordTypes = new Set(["docx", "docm"]);
const spreadsheetTypes = new Set(["xlsx", "xlsm"]);
const presentationTypes = new Set(["pptx", "pptm"]);

export function readOfficeText(filePath, sourceType) {
  if (!wordTypes.has(sourceType) && !spreadsheetTypes.has(sourceType) && !presentationTypes.has(sourceType)) return "";
  try {
    const entries = readZipEntries(filePath);
    if (wordTypes.has(sourceType)) return readWordText(entries);
    if (spreadsheetTypes.has(sourceType)) return readSpreadsheetText(entries);
    if (presentationTypes.has(sourceType)) return readPresentationText(entries);
  } catch {
    return "";
  }
  return "";
}

function readWordText(entries) {
  const documentXml = readZipText(entries, "word/document.xml");
  if (!documentXml) return "";
  return extractOfficeXmlText(documentXml, {
    textPattern: /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g,
    paragraphPattern: /<\/w:p>/g,
    lineBreakPattern: /<w:br\b[^>]*\/>/g,
    tabPattern: /<w:tab\b[^>]*\/>/g
  });
}

function readPresentationText(entries) {
  const slideNames = [...entries.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(naturalCompare);
  const sections = [];
  slideNames.forEach((name, index) => {
    const text = extractOfficeXmlText(readZipText(entries, name), {
      textPattern: /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g,
      paragraphPattern: /<\/a:p>/g,
      lineBreakPattern: /<a:br\b[^>]*\/>/g,
      tabPattern: /<a:tab\b[^>]*\/>/g
    });
    if (text) sections.push(`第 ${index + 1} 页\n${text}`);
  });
  return sections.join("\n\n");
}

function readSpreadsheetText(entries) {
  const sharedStrings = readSharedStrings(entries);
  const sheetNames = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort(naturalCompare);
  const sections = [];

  sheetNames.forEach((name, sheetIndex) => {
    const xml = readZipText(entries, name);
    const rows = [];
    for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rowNumber = readXmlAttribute(rowMatch[1], "r") || String(rows.length + 1);
      const cells = [];
      for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const type = readXmlAttribute(cellMatch[1], "t");
        const cellXml = cellMatch[2];
        const value = readSpreadsheetCell(cellXml, type, sharedStrings);
        if (value) cells.push(value);
      }
      if (cells.length) rows.push(`第 ${rowNumber} 行: ${cells.join(" | ")}`);
    }
    if (rows.length) sections.push(`工作表 ${sheetIndex + 1}\n${rows.join("\n")}`);
  });

  return sections.join("\n\n");
}

function readSpreadsheetCell(cellXml, type, sharedStrings) {
  if (type === "s") {
    const index = Number(readTagText(cellXml, "v"));
    return Number.isInteger(index) ? sharedStrings[index] || "" : "";
  }
  if (type === "inlineStr") return extractGenericText(cellXml, "t");
  return decodeXmlEntities(readTagText(cellXml, "v") || extractGenericText(cellXml, "t"));
}

function readSharedStrings(entries) {
  const xml = readZipText(entries, "xl/sharedStrings.xml");
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
    .map((match) => extractGenericText(match[1], "t"))
    .map((value) => normalizeExtractedText(value));
}

function extractOfficeXmlText(xml, options) {
  if (!xml) return "";
  const working = xml
    .replace(options.lineBreakPattern, "\n")
    .replace(options.tabPattern, "\t")
    .replace(options.paragraphPattern, "\n")
    .replace(options.textPattern, (_, text) => decodeXmlEntities(text))
    .replace(/<[^>]+>/g, "");
  return normalizeExtractedText(working);
}

function extractGenericText(xml, localName) {
  const pattern = new RegExp(`<(?:[\\w-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${localName}>`, "g");
  return [...xml.matchAll(pattern)]
    .map((match) => decodeXmlEntities(match[1].replace(/<[^>]+>/g, "")))
    .join("");
}

function readTagText(xml, localName) {
  const pattern = new RegExp(`<(?:[\\w-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${localName}>`);
  const match = xml.match(pattern);
  return match ? decodeXmlEntities(match[1].replace(/<[^>]+>/g, "")).trim() : "";
}

function readXmlAttribute(text, name) {
  const match = text.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? decodeXmlEntities(match[1]) : "";
}

function normalizeExtractedText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function readZipEntries(filePath) {
  const buffer = fs.readFileSync(filePath);
  const endOffset = findEndOfCentralDirectory(buffer);
  if (endOffset < 0) return new Map();
  const totalEntries = buffer.readUInt16LE(endOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = new Map();
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const content = readZipEntryData(buffer, localHeaderOffset, compressedSize, compressionMethod);
    if (content) entries.set(name.replace(/\\/g, "/"), content);
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntryData(buffer, localHeaderOffset, compressedSize, compressionMethod) {
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) return null;
  const nameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
  const data = buffer.subarray(dataStart, dataStart + compressedSize);
  if (compressionMethod === 0) return Buffer.from(data);
  if (compressionMethod === 8) return zlib.inflateRawSync(data);
  return null;
}

function readZipText(entries, name) {
  const value = entries.get(name);
  return value ? value.toString("utf8") : "";
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function naturalCompare(left, right) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}
