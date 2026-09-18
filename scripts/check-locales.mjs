// Validates the mobile app's locale files (NH-08):
//  - every file parses as JSON (a trailing comma silently breaks one language
//    at runtime with no typecheck error);
//  - every locale has exactly the same keys as en.json (ship-change skill:
//    a new string goes into all eight files, never just one);
//  - every translation keeps the same {{placeholders}} as the English string,
//    so an interpolated value never goes missing in one language.
// Usage: node scripts/check-locales.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../apps/mobile/src/locales/", import.meta.url));
const REFERENCE = "en.json";

function flatten(obj, prefix = "", out = new Map()) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) flatten(value, path, out);
    else out.set(path, value);
  }
  return out;
}

const placeholders = (value) =>
  typeof value === "string" ? [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort() : [];

const problems = [];
const locales = new Map();
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  try {
    locales.set(file, flatten(JSON.parse(readFileSync(join(dir, file), "utf8"))));
  } catch (e) {
    problems.push(`${file}: invalid JSON — ${e.message}`);
  }
}

const reference = locales.get(REFERENCE);
if (!reference) {
  problems.push(`${REFERENCE}: missing or unparseable reference locale`);
} else {
  for (const [file, keys] of locales) {
    if (file === REFERENCE) continue;
    const missing = [...reference.keys()].filter((k) => !keys.has(k));
    const extra = [...keys.keys()].filter((k) => !reference.has(k));
    if (missing.length) problems.push(`${file}: missing ${missing.length} key(s): ${missing.join(", ")}`);
    if (extra.length) problems.push(`${file}: ${extra.length} key(s) not in ${REFERENCE}: ${extra.join(", ")}`);
    for (const [key, value] of keys) {
      if (!reference.has(key)) continue;
      const want = placeholders(reference.get(key)).join(",");
      const got = placeholders(value).join(",");
      if (want !== got) problems.push(`${file}: "${key}" placeholders {${got}} differ from ${REFERENCE} {${want}}`);
    }
  }
}

if (problems.length) {
  console.error(`Locale check failed (${problems.length} problem(s)):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`Locale check passed: ${locales.size} files, ${reference.size} keys each.`);
