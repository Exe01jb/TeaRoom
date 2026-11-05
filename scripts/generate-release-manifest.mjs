/**
 * TeaRoom - Reproducible Release Manifest Generator (Phase 9 Step 2)
 * Computes SHA-256 digests of lockfiles, backend entrypoints, and compiled dist/ assets.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const bytes = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function collectFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else out.push(full);
  }
  return out;
}

let gitCommit = 'UNTRACKED_ARCHIVE';
try {
  gitCommit = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch {
  // Running from extracted source archive without .git directory
}

const targetFiles = [
  'LICENSE',
  'package.json',
  'bun.lock',
  'package-lock.json',
  'backend/server.js',
  'backend/sockets/chatHandler.js',
  'frontend/src/utils/crypto.js',
  'deploy/setup.sh',
  'deploy/update.sh',
  'deploy/uninstall.sh',
  ...collectFiles('dist'),
];

const artifacts = {};
for (const relPath of targetFiles) {
  const normalized = relPath.replace(/\\/g, '/');
  const digest = sha256File(relPath);
  if (digest) {
    artifacts[normalized] = digest;
  }
}

const manifest = {
  releaseId: `tearoom-rc-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  generatedAt: new Date().toISOString(),
  gitCommit,
  nodeVersion: process.version,
  platform: `${process.platform}-${process.arch}`,
  artifacts,
};

fs.writeFileSync('release-manifest.json', JSON.stringify(manifest, null, 2));
console.log(`✔ Generated release-manifest.json (${Object.keys(artifacts).length} artifacts hashed).`);