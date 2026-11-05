import fs from 'node:fs';
import path from 'node:path';
import { transformSync } from 'esbuild';

const TARGET_DIRS = ['backend', 'frontend/src', 'src', 'tests'];
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

function collectFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, out);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(fullPath);
    }
  }
  return out;
}

const files = TARGET_DIRS.flatMap((d) => collectFiles(d));
let errorCount = 0;

for (const file of files) {
  const ext = path.extname(file).slice(1);
  const code = fs.readFileSync(file, 'utf8');

  try {
    transformSync(code, {
      loader: ext,
      sourcefile: file,
      target: 'es2022',
      logLevel: 'silent',
    });
  } catch (err) {
    console.error(`[LINT PARSE ERROR] ${file}:\n${err.message}`);
    errorCount++;
  }

  if (/\bdebugger\s*;/.test(code)) {
    console.error(`[LINT RULE] Disallowed 'debugger' statement in ${file}`);
    errorCount++;
  }
}

if (errorCount > 0) {
  console.error(`\nLint failed with ${errorCount} error(s) across ${files.length} files.`);
  process.exit(1);
}

console.log(`✔ Lint passed cleanly across ${files.length} source and test files.`);
