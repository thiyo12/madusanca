import { readdir } from "node:fs/promises";
import { join } from "node:path";

const directory = join(process.cwd(), "supabase", "migrations");
const files = (await readdir(directory)).filter((file) => file.endsWith(".sql"));
const versions = new Map();
const invalid = [];

for (const file of files) {
  const match = /^(\d+)_.*\.sql$/.exec(file);
  if (!match) {
    invalid.push(file);
    continue;
  }
  const version = match[1];
  const sameVersion = versions.get(version) ?? [];
  sameVersion.push(file);
  versions.set(version, sameVersion);
}

const duplicates = [...versions.entries()].filter(([, names]) => names.length > 1);
if (invalid.length || duplicates.length) {
  console.error("Migration version check failed; do not apply this sequence to any database.");
  for (const file of invalid) console.error(`- Invalid migration filename: ${file}`);
  for (const [version, names] of duplicates) {
    console.error(`- Duplicate version ${version}: ${names.join(", ")}`);
  }
  process.exit(1);
}

console.log(`Migration versions are unique (${files.length} files).`);
