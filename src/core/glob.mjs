export function matchesAnyGlob(relativePath, patterns = ["**/*"]) {
  const normalized = toPosix(relativePath);
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

export function toPosix(value) {
  return String(value).replace(/\\/g, "/");
}

function globToRegExp(pattern) {
  const source = toPosix(pattern);
  let output = "^";

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    const afterNext = source[index + 2];

    if (char === "*" && next === "*" && afterNext === "/") {
      output += "(?:.*/)?";
      index += 2;
    } else if (char === "*" && next === "*") {
      output += ".*";
      index += 1;
    } else if (char === "*") {
      output += "[^/]*";
    } else if (char === "?") {
      output += "[^/]";
    } else {
      output += escapeRegExp(char);
    }
  }

  output += "$";
  return new RegExp(output, "i");
}

function escapeRegExp(char) {
  return char.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}
