/**
 * TeaRoom - Backup & Restore Verification Test (Phase 10.7)
 * Verifies that STATE_FILE_PATH backups can be restored into a fresh server
 * instance with 100% fidelity of encrypted invite envelopes and IP bans.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../backend/server.js';
import {
  generateTenCharCredential,
  deriveAdminRoomMasterKey,
  createEncryptedInviteEnvelope,
  unwrapInviteEnvelope,
} from '../frontend/src/utils/crypto.js';

async function verifyBackupAndRestore() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tearoom-dr-test-'));
  const liveStatePath = path.join(workDir, 'live', 'state.json');
  const backupStatePath = path.join(workDir, 'backup', 'state.json.bak');

  try {
    const username = generateTenCharCredential(10);
    const password = generateTenCharCredential(10);
    const masterKeyBase64 = await deriveAdminRoomMasterKey({
      vaultSecret: 'dr-test-vault-secret-key-999',
      room: 'dr-vault',
      iterations: 300000,
    });
    const { authToken, envelope } = await createEncryptedInviteEnvelope({
      username,
      password,
      room: 'dr-vault',
      masterKeyBase64,
      iterations: 300000,
    });

    // 1. Populate live state on Server 1
    const srv1 = createServer({
      NODE_ENV: 'development',
      PORT: 0,
      STATE_FILE_PATH: liveStatePath,
    });
    srv1.moderationEngine.createInvite({ username, room: 'dr-vault', authToken, envelope });
    srv1.moderationEngine.blockIp('198.51.100.77', 'DR backup test');
    await srv1.close();

    assert.ok(fs.existsSync(liveStatePath), 'Live state.json must exist');

    // 2. Perform backup copy
    fs.mkdirSync(path.dirname(backupStatePath), { recursive: true });
    fs.copyFileSync(liveStatePath, backupStatePath);

    // 3. Simulate disaster (delete live state directory)
    fs.rmSync(path.dirname(liveStatePath), { recursive: true, force: true });
    assert.equal(fs.existsSync(liveStatePath), false);

    // 4. Restore backup to live path
    fs.mkdirSync(path.dirname(liveStatePath), { recursive: true });
    fs.copyFileSync(backupStatePath, liveStatePath);

    // 5. Boot Server 2 from restored state and verify cryptographic envelope integrity
    const srv2 = createServer({
      NODE_ENV: 'development',
      PORT: 0,
      STATE_FILE_PATH: liveStatePath,
    });
    try {
      assert.equal(srv2.moderationEngine.isIpBlocked('198.51.100.77'), true);
      const invites = srv2.moderationEngine.listInvites();
      assert.equal(invites.length, 1);
      assert.equal(invites[0].username, username);
      assert.equal(invites[0].room, 'dr-vault');

      // Verify restored raw JSON envelope still unwraps cleanly with user password
      const restoredRaw = JSON.parse(fs.readFileSync(liveStatePath, 'utf8'));
      const restoredEnvelope = restoredRaw.invites[0].envelope;
      const unwrapped = await unwrapInviteEnvelope({
        username,
        password,
        envelope: restoredEnvelope,
        iterations: 300000,
      });
      assert.equal(unwrapped.room, 'dr-vault');
      assert.equal(unwrapped.key.extractable, false);
    } finally {
      await srv2.close();
    }

    console.log('✔ Backup & Restore DR verification passed: invites, envelopes, and IP bans restored cleanly.');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

verifyBackupAndRestore();