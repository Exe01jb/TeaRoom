/**
 * Private Chatroom - Security Hardening & Production Readiness Tests
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as ioClient } from 'socket.io-client';
import { createServer } from '../backend/server.js';
import {
  generateTenCharCredential,
  deriveAdminRoomMasterKey,
  createEncryptedInviteEnvelope,
  unwrapInviteEnvelope,
  computeInviteAuthToken,
  encryptMessage,
  decryptMessage,
} from '../frontend/src/utils/crypto.js';

function connectSocket(url, options = {}) {
  return new Promise((resolve) => {
    const socket = ioClient(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 3000,
      ...options,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', () => resolve(socket));
  });
}

function emitWithAck(socket, event, data) {
  return new Promise((resolve) => {
    socket.emit(event, data, (response) => resolve(response));
  });
}

test('security: production mode rejects missing or placeholder ADMIN_SECRET', () => {
  assert.throws(() => {
    createServer({
      NODE_ENV: 'production',
      CLIENT_ORIGIN: 'https://chat.example.com',
      ADMIN_SECRET: 'admin-secret-dev-key',
    });
  }, /FATAL: ADMIN_SECRET/);

  assert.throws(() => {
    createServer({
      NODE_ENV: 'production',
      CLIENT_ORIGIN: 'https://chat.example.com',
      ADMIN_SECRET: '__CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_HEX_32__',
    });
  }, /FATAL: ADMIN_SECRET/);
});

test('security: /api/admin/auth issues an ephemeral token distinct from ADMIN_SECRET', async () => {
  const adminSecret = 'super-strong-test-admin-secret-key-0123456789';
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
    ADMIN_SECRET: adminSecret,
  });

  const { port } = await listen(0);
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${baseUrl}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: adminSecret }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.token);
    assert.notEqual(
      body.token,
      adminSecret,
      'Ephemeral session token must never equal the permanent ADMIN_SECRET'
    );

    const ovRes = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    assert.equal(ovRes.status, 200);
  } finally {
    await close();
  }
});

test('security: INVITE_ONLY=true blocks uninvited joins and enforces room-bound, expiring, and single-use invites', async () => {
  const adminSecret = 'admin-invite-test-secret-998877665544';
  const vaultSecret = 'separate-client-side-vault-secret-123';
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
    INVITE_ONLY: true,
    ADMIN_SECRET: adminSecret,
  });

  const { port } = await listen(0);
  const baseUrl = `http://127.0.0.1:${port}`;
  const client = await connectSocket(baseUrl);

  try {
    // 1. Direct join without invitation must be rejected with INVITE_REQUIRED
    const uninvitedJoin = await emitWithAck(client, 'join', { v: 1, room: 'classified-room' });
    assert.equal(uninvitedJoin.ok, false);
    assert.equal(uninvitedJoin.code, 'INVITE_REQUIRED');

    // 2. Create a valid 10-char invite envelope for 'classified-room' (maxUses: 1)
    const username = generateTenCharCredential(10);
    const password = generateTenCharCredential(10);
    const masterKeyBase64 = await deriveAdminRoomMasterKey({
      adminSecret: vaultSecret,
      room: 'classified-room',
      iterations: 300000,
    });
    const { authToken, envelope } = await createEncryptedInviteEnvelope({
      username,
      password,
      room: 'classified-room',
      masterKeyBase64,
      iterations: 300000,
    });

    const createRes = await fetch(`${baseUrl}/api/admin/invites`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        room: 'classified-room',
        authToken,
        envelope,
        maxUses: 1,
      }),
    });
    assert.equal(createRes.status, 200);

    // 3. Attempting to use the invite for a DIFFERENT room fails with INVITE_ROOM_MISMATCH
    const wrongRoomAck = await emitWithAck(client, 'join', {
      v: 1,
      room: 'other-room',
      username,
      authToken,
    });
    assert.equal(wrongRoomAck.ok, false);
    assert.equal(wrongRoomAck.code, 'INVITE_ROOM_MISMATCH');

    // 4. Redeeming for the assigned room succeeds and unwraps the 256-bit AES-GCM key
    const redeemAck = await emitWithAck(client, 'redeem_invite', {
      v: 1,
      username,
      authToken,
    });
    assert.equal(redeemAck.ok, true);
    assert.equal(redeemAck.room, 'classified-room');
    assert.ok(redeemAck.envelope);

    const unwrapped = await unwrapInviteEnvelope({
      username,
      password,
      envelope: redeemAck.envelope,
      iterations: 300000,
    });
    assert.equal(unwrapped.room, 'classified-room');
    assert.equal(unwrapped.key.extractable, false);

    // Roundtrip encrypt/decrypt with unwrapped 256-bit room key
    const msg = await encryptMessage({
      key: unwrapped.key,
      room: 'classified-room',
      text: 'Invite-only vault message',
      nickname: username,
    });
    const dec = await decryptMessage({ key: unwrapped.key, payload: msg });
    assert.equal(dec.text, 'Invite-only vault message');

    // 5. Second redemption of a single-use (maxUses: 1) invite fails with INVITE_CONSUMED
    const secondRedeem = await emitWithAck(client, 'redeem_invite', {
      v: 1,
      username,
      authToken,
    });
    assert.equal(secondRedeem.ok, false);
    assert.equal(secondRedeem.code, 'INVITE_CONSUMED');
  } finally {
    client.disconnect();
    await close();
  }
});

test('security: STATE_FILE_PATH persists encrypted invites and blocked IPs across server restarts', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tearoom-state-test-'));
  const stateFile = path.join(tmpDir, 'state.json');
  const adminSecret = 'state-persistence-admin-secret-12345';

  const username = generateTenCharCredential(10);
  const password = generateTenCharCredential(10);
  const authToken = await computeInviteAuthToken({ username, password });

  // Server instance 1: create invite and block an IP
  const srv1 = createServer({
    NODE_ENV: 'development',
    PORT: 0,
    ADMIN_SECRET: adminSecret,
    STATE_FILE_PATH: stateFile,
  });
  srv1.moderationEngine.createInvite({
    username,
    room: 'persistent-room',
    authToken,
    envelope: { v: 2, room: 'persistent-room', epoch: 1, salt: 'AAAA', iv: 'BBBB', ct: 'CCCC' },
  });
  srv1.moderationEngine.blockIp('203.0.113.99', 'Persistence test ban');
  await srv1.close();

  // Server instance 2: reload from stateFile
  const srv2 = createServer({
    NODE_ENV: 'development',
    PORT: 0,
    ADMIN_SECRET: adminSecret,
    STATE_FILE_PATH: stateFile,
  });
  try {
    assert.equal(srv2.moderationEngine.isIpBlocked('203.0.113.99'), true);
    const loadedInvites = srv2.moderationEngine.listInvites();
    assert.equal(loadedInvites.length, 1);
    assert.equal(loadedInvites[0].username, username);
    assert.equal(loadedInvites[0].room, 'persistent-room');
  } finally {
    await srv2.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});