/**
 * Private Chatroom - Administrator Moderation & Dashboard API Tests
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { createServer } from '../backend/server.js';

const ADMIN_SECRET = 'top-secret-admin-pass-999';

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
    socket.emit(event, data, (response) => {
      resolve(response);
    });
  });
}

test('admin: authentication requires valid secret key and issues ephemeral session token', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
    ADMIN_SECRET,
  });

  const { port } = await listen(0);
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Unauthenticated request to /api/admin/overview fails with 401
    const unauthRes = await fetch(`${baseUrl}/api/admin/overview`);
    assert.equal(unauthRes.status, 401);

    // 2. Wrong key to /api/admin/auth fails with 401
    const badAuthRes = await fetch(`${baseUrl}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'wrong-key' }),
    });
    assert.equal(badAuthRes.status, 401);

    // 3. Valid key to /api/admin/auth succeeds and returns an ephemeral token != ADMIN_SECRET
    const goodAuthRes = await fetch(`${baseUrl}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: ADMIN_SECRET }),
    });
    assert.equal(goodAuthRes.status, 200);
    const goodJson = await goodAuthRes.json();
    assert.equal(goodJson.ok, true);
    assert.ok(typeof goodJson.token === 'string' && goodJson.token.length >= 32);
    assert.notEqual(
      goodJson.token,
      ADMIN_SECRET,
      'Session token must be ephemeral and distinct from ADMIN_SECRET'
    );

    // 4. Using the issued ephemeral session token grants access to /api/admin/overview
    const ovRes = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${goodJson.token}` },
    });
    assert.equal(ovRes.status, 200);
  } finally {
    await close();
  }
});

test('admin: overview tracks active users, chatrooms, and message rates', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
    ADMIN_SECRET,
  });

  const { port } = await listen(0);
  const baseUrl = `http://127.0.0.1:${port}`;
  const client = await connectSocket(baseUrl);

  try {
    await emitWithAck(client, 'join', { v: 1, room: 'ops-room' });
    await emitWithAck(client, 'message', {
      v: 1,
      id: '11111111-1111-4111-8111-111111111111',
      room: 'ops-room',
      iv: Buffer.alloc(12).toString('base64'),
      ct: Buffer.alloc(32).toString('base64'),
    });

    const res = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.data.activeConnectionsCount, 1);
    assert.equal(json.data.activeRoomsCount, 1);
    assert.equal(json.data.totalRelayedMessages, 1);
    assert.equal(json.data.rooms[0].name, 'ops-room');
  } finally {
    client.disconnect();
    await close();
  }
});

test('admin: room termination evicts members and fires room_terminated event', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
    ADMIN_SECRET,
  });

  const { port } = await listen(0);
  const baseUrl = `http://127.0.0.1:${port}`;
  const client = await connectSocket(baseUrl);

  try {
    await emitWithAck(client, 'join', { v: 1, room: 'doomed-room' });

    let terminatedEvent = null;
    client.on('room_terminated', (ev) => {
      terminatedEvent = ev;
    });

    const termRes = await fetch(`${baseUrl}/api/admin/rooms/doomed-room/terminate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
    });
    assert.equal(termRes.status, 200);

    await new Promise((r) => setTimeout(r, 80));
    assert.ok(terminatedEvent);
    assert.equal(terminatedEvent.room, 'doomed-room');
  } finally {
    client.disconnect();
    await close();
  }
});

test('admin: IP blocklist disconnects active sockets and rejects subsequent handshakes', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
    ADMIN_SECRET,
    TRUST_PROXY: true,
  });

  const { port } = await listen(0);
  const baseUrl = `http://127.0.0.1:${port}`;

  const client = await connectSocket(baseUrl, {
    extraHeaders: { 'x-real-ip': '198.51.100.42' },
  });

  try {
    assert.equal(client.connected, true);

    const blockRes = await fetch(`${baseUrl}/api/admin/blocked-ips`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ADMIN_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ip: '198.51.100.42', reason: 'Spamming' }),
    });
    assert.equal(blockRes.status, 200);

    await new Promise((r) => setTimeout(r, 80));
    assert.equal(client.connected, false);

    // Subsequent connection from blocked IP must be rejected
    const client2 = await connectSocket(baseUrl, {
      extraHeaders: { 'x-real-ip': '198.51.100.42' },
    });
    assert.equal(client2.connected, false);
    client2.disconnect();

    // Unblock IP
    const unblockRes = await fetch(`${baseUrl}/api/admin/blocked-ips/198.51.100.42`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
    });
    assert.equal(unblockRes.status, 200);
  } finally {
    client.disconnect();
    await close();
  }
});
