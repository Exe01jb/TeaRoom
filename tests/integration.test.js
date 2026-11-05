/**
 * Private Chatroom - Integration Test Suite
 * Starts server in-process on random port, exercises all protocols and abuse controls
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { createServer } from '../backend/server.js';
import { deriveRoomKey, encryptMessage, decryptMessage } from '../frontend/src/utils/crypto.js';
import { IdDeduplicator } from '../frontend/src/utils/lru.js';

function connectSocket(url, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 3000,
      ...options,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => resolve(socket)); // resolve socket so caller can inspect error if testing rejection
  });
}

function emitWithAck(socket, event, data) {
  return new Promise((resolve) => {
    socket.emit(event, data, (response) => {
      resolve(response);
    });
  });
}

test('integration: evict_member rejects unauthorized peers and allows authorized room owner/admin to evict with epoch rotation', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;

  const socketAlice = await connectSocket(serverUrl);
  const socketEve = await connectSocket(serverUrl);
  const room = 'moderated-room';

  try {
    // 1. Alice creates the room (becomes server-recorded room owner)
    const joinAlice = await emitWithAck(socketAlice, 'join', {
      v: 1,
      room,
      userId: 'USR-ALICE',
      nickname: 'Alice',
    });
    assert.equal(joinAlice.ok, true);
    assert.ok(joinAlice.salt, 'Join ack must include random room salt');
    assert.equal(joinAlice.epoch, 1);

    // 2. Eve joins second as an ordinary participant
    const joinEve = await emitWithAck(socketEve, 'join', {
      v: 1,
      room,
      userId: 'USR-EVE',
      nickname: 'Eve',
    });
    assert.equal(joinEve.ok, true);
    assert.equal(joinEve.salt, joinAlice.salt, 'Same room must share identical random salt');

    let aliceEvictedEvent = null;
    socketAlice.on('evicted', (event) => {
      aliceEvictedEvent = event;
    });

    // 3. Unauthorized Eve attempts to evict Alice (even passing spoofed isAdmin: true)
    const unauthorizedEvict = await emitWithAck(socketEve, 'evict_member', {
      v: 1,
      room,
      targetUserId: 'USR-ALICE',
      isAdmin: true,
      reason: 'MALICIOUS_KICK',
    });
    assert.equal(unauthorizedEvict.ok, false);
    assert.equal(unauthorizedEvict.code, 'FORBIDDEN');
    assert.equal(aliceEvictedEvent, null, 'Unauthorized eviction must not emit evicted event');

    // Verify epoch did not change and Alice is still in the room
    const rejoinCheck = await emitWithAck(socketAlice, 'join', { v: 1, room });
    assert.equal(rejoinCheck.epoch, 1, 'Unauthorized eviction must not increment room epoch');

    // 4. Authorized owner Alice evicts Eve
    let eveEvictedEvent = null;
    socketEve.on('evicted', (event) => {
      eveEvictedEvent = event;
    });

    let aliceMemberEvictedEvent = null;
    socketAlice.on('member_evicted', (event) => {
      aliceMemberEvictedEvent = event;
    });

    const evictRes = await emitWithAck(socketAlice, 'evict_member', {
      v: 1,
      room,
      targetUserId: 'USR-EVE',
      reason: 'POLICY_VIOLATION',
    });
    assert.equal(evictRes.ok, true);
    assert.equal(evictRes.evicted, true);
    assert.equal(evictRes.newEpoch, 2);

    await new Promise((r) => setTimeout(r, 60));

    assert.ok(eveEvictedEvent, 'Target socket must receive evicted event');
    assert.equal(eveEvictedEvent.room, room);
    assert.equal(eveEvictedEvent.epoch, 2);

    assert.ok(aliceMemberEvictedEvent, 'Remaining member must receive member_evicted notification');
    assert.equal(aliceMemberEvictedEvent.targetUserId, 'USR-EVE');
    assert.equal(aliceMemberEvictedEvent.newEpoch, 2);

    // 5. Eve attempts to send a message after eviction -> rejected with NOT_IN_ROOM
    const msgRes = await emitWithAck(socketEve, 'message', {
      v: 1,
      id: '00000000-0000-0000-0000-000000000001',
      room,
      iv: 'AAAAAAAAAAAAAAAA',
      ct: 'AAAAAAAAAAAAAAAAAAAAAA==',
    });
    assert.equal(msgRes.ok, false);
    assert.equal(msgRes.code, 'NOT_IN_ROOM');
  } finally {
    socketAlice.disconnect();
    socketEve.disconnect();
    await close();
  }
});

test('integration: end-to-end encrypted relay, isolation, and server spy verification', async () => {
  const recordedPayloads = [];

  const { server, io, listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
    CLIENT_ORIGIN: 'http://localhost',
  });

  // Attach in-process server spy
  io.on('connection', (sock) => {
    sock.onAny((event, ...args) => {
      recordedPayloads.push({ event, args });
    });
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;

  const roomSecret = 'ultra-secure-room-password-789';
  const roomName = 'classified-vault';

  // Client 1 & 2 share valid password in room
  const key1 = await deriveRoomKey({ password: roomSecret, roomName, iterations: 300000 });
  const key2 = await deriveRoomKey({ password: roomSecret, roomName, iterations: 300000 });

  // Client 3 has wrong password in same room
  const keyWrong = await deriveRoomKey({ password: 'wrong-password-alt-999999', roomName, iterations: 300000 });

  // Client 4 is in a separate room
  const otherRoom = 'unrelated-lounge';
  const keyOther = await deriveRoomKey({ password: roomSecret, roomName: otherRoom, iterations: 300000 });

  const client1 = await connectSocket(serverUrl);
  const client2 = await connectSocket(serverUrl);
  const clientWrong = await connectSocket(serverUrl);
  const clientOther = await connectSocket(serverUrl);

  try {
    // Join rooms
    const ack1 = await emitWithAck(client1, 'join', { v: 1, room: roomName });
    assert.equal(ack1.ok, true);

    const ack2 = await emitWithAck(client2, 'join', { v: 1, room: roomName });
    assert.equal(ack2.ok, true);
    assert.equal(ack2.count, 2);

    const ackWrong = await emitWithAck(clientWrong, 'join', { v: 1, room: roomName });
    assert.equal(ackWrong.ok, true);

    const ackOther = await emitWithAck(clientOther, 'join', { v: 1, room: otherRoom });
    assert.equal(ackOther.ok, true);
    assert.equal(ackOther.count, 1);

    // Setup message listeners
    const client2Received = [];
    client2.on('message', (msg) => client2Received.push(msg));

    const clientWrongReceived = [];
    clientWrong.on('message', (msg) => clientWrongReceived.push(msg));

    const clientOtherReceived = [];
    clientOther.on('message', (msg) => clientOtherReceived.push(msg));

    // Client 1 encrypts and sends message
    const plaintext = 'Secret rendezvous at 0400 hours';
    const nickname = 'OperativeX';
    const encrypted = await encryptMessage({
      key: key1,
      room: roomName,
      text: plaintext,
      nickname,
    });

    const sendAck = await emitWithAck(client1, 'message', encrypted);
    assert.equal(sendAck.ok, true);

    // Wait 200ms for message distribution
    await new Promise((r) => setTimeout(r, 200));

    // Client 2 in the same room receives and decrypts successfully
    assert.equal(client2Received.length, 1);
    const decrypted = await decryptMessage({ key: key2, payload: client2Received[0] });
    assert.equal(decrypted.text, plaintext);
    assert.equal(decrypted.nickname, nickname);

    // Client 3 in the room with WRONG password receives ciphertext but fails decryption
    assert.equal(clientWrongReceived.length, 1);
    await assert.rejects(async () => {
      await decryptMessage({ key: keyWrong, payload: clientWrongReceived[0] });
    });

    // Client 4 in other room receives NOTHING
    assert.equal(clientOtherReceived.length, 0);

    // SERVER SPY VERIFICATION:
    // Assert no recorded server event contains plaintext, password, or nickname!
    const serializedHistory = JSON.stringify(recordedPayloads);
    assert.equal(serializedHistory.includes(plaintext), false, 'Server recorded plaintext!');
    assert.equal(serializedHistory.includes(roomSecret), false, 'Server recorded room password!');
    assert.equal(serializedHistory.includes(nickname), false, 'Server recorded nickname!');
  } finally {
    client1.disconnect();
    client2.disconnect();
    clientWrong.disconnect();
    clientOther.disconnect();
    await close();
  }
});

test('integration: server validation rejects invalid payloads with exact ack codes', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
    MAX_MESSAGE_BYTES: 100,
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;
  const client = await connectSocket(serverUrl);

  try {
    // 1. Invalid room name syntax
    const ackBadRoom = await emitWithAck(client, 'join', { v: 1, room: 'bad room with spaces!' });
    assert.equal(ackBadRoom.ok, false);
    assert.equal(ackBadRoom.code, 'INVALID_ROOM');

    // Join valid room
    const ackValidRoom = await emitWithAck(client, 'join', { v: 1, room: 'valid-room' });
    assert.equal(ackValidRoom.ok, true);

    // 2. Non-member send (claimed room != current room)
    const ackWrongRoom = await emitWithAck(client, 'message', {
      v: 1,
      id: '12345678-1234-4234-8234-1234567890ab',
      room: 'other-room',
      iv: 'MTIzNDU2Nzg5MDEy',
      ct: 'AAAAAAAAAAAAAAAAAAAAAAAA',
    });
    assert.equal(ackWrongRoom.ok, false);
    assert.equal(ackWrongRoom.code, 'NOT_IN_ROOM');

    // 3. Invalid IV length (16 bytes instead of 12)
    const ackBadIv = await emitWithAck(client, 'message', {
      v: 1,
      id: '12345678-1234-4234-8234-1234567890ab',
      room: 'valid-room',
      iv: Buffer.alloc(16).toString('base64'),
      ct: Buffer.alloc(32).toString('base64'),
    });
    assert.equal(ackBadIv.ok, false);
    assert.equal(ackBadIv.code, 'INVALID_PAYLOAD');

    // 4. Malformed Base64
    const ackBadBase64 = await emitWithAck(client, 'message', {
      v: 1,
      id: '12345678-1234-4234-8234-1234567890ab',
      room: 'valid-room',
      iv: 'MTIzNDU2Nzg5MDEy',
      ct: 'not-valid-base-64!!!',
    });
    assert.equal(ackBadBase64.ok, false);
    assert.equal(ackBadBase64.code, 'INVALID_PAYLOAD');

    // 5. Oversized ciphertext (> MAX_MESSAGE_BYTES + 1024)
    const ackTooLarge = await emitWithAck(client, 'message', {
      v: 1,
      id: '12345678-1234-4234-8234-1234567890ab',
      room: 'valid-room',
      iv: Buffer.alloc(12).toString('base64'),
      ct: Buffer.alloc(2000).toString('base64'),
    });
    assert.equal(ackTooLarge.ok, false);
    assert.equal(ackTooLarge.code, 'TOO_LARGE');
  } finally {
    client.disconnect();
    await close();
  }
});

test('integration: room capacity limit enforces ROOM_FULL', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
    MAX_ROOM_SIZE: 2,
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;

  const client1 = await connectSocket(serverUrl);
  const client2 = await connectSocket(serverUrl);
  const client3 = await connectSocket(serverUrl);

  try {
    const room = 'capacity-test';
    const ack1 = await emitWithAck(client1, 'join', { v: 1, room });
    assert.equal(ack1.ok, true);

    const ack2 = await emitWithAck(client2, 'join', { v: 1, room });
    assert.equal(ack2.ok, true);

    const ack3 = await emitWithAck(client3, 'join', { v: 1, room });
    assert.equal(ack3.ok, false);
    assert.equal(ack3.code, 'ROOM_FULL');
  } finally {
    client1.disconnect();
    client2.disconnect();
    client3.disconnect();
    await close();
  }
});

test('integration: rate limiting returns RATE_LIMITED', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
    RATE_LIMIT_MESSAGES: 2,
    RATE_LIMIT_WINDOW_MS: 5000,
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;
  const client = await connectSocket(serverUrl);

  try {
    const room = 'rate-limit-room';
    await emitWithAck(client, 'join', { v: 1, room });

    const msgTemplate = {
      v: 1,
      id: '12345678-1234-4234-8234-1234567890ab',
      room,
      iv: Buffer.alloc(12).toString('base64'),
      ct: Buffer.alloc(32).toString('base64'),
    };

    const ack1 = await emitWithAck(client, 'message', { ...msgTemplate, id: '11111111-1111-4111-8111-111111111111' });
    assert.equal(ack1.ok, true);

    const ack2 = await emitWithAck(client, 'message', { ...msgTemplate, id: '22222222-2222-4222-8222-222222222222' });
    assert.equal(ack2.ok, true);

    // Exceeds limit
    const ack3 = await emitWithAck(client, 'message', { ...msgTemplate, id: '33333333-3333-4333-8333-333333333333' });
    assert.equal(ack3.ok, false);
    assert.equal(ack3.code, 'RATE_LIMITED');
  } finally {
    client.disconnect();
    await close();
  }
});

test('integration: disallowed origin is rejected in production', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'production',
    PORT: 0,
    CLIENT_ORIGIN: 'https://chat.legitimate-domain.com',
    ADMIN_SECRET: 'prod-test-strong-admin-secret-999999',
    ADMIN_SECRET: 'prod-test-strong-admin-secret-999999',
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;

  const socket = await connectSocket(serverUrl, {
    extraHeaders: {
      origin: 'https://attacker.evil.com',
    },
  });

  try {
    // Sockets with disallowed origins should not connect
    assert.equal(socket.connected, false);
  } finally {
    socket.disconnect();
    await close();
  }
});

test('integration: client IdDeduplicator drops duplicate message IDs', () => {
  const deduplicator = new IdDeduplicator(5);
  const idA = 'msg-1';
  const idB = 'msg-2';

  assert.equal(deduplicator.checkAndAdd(idA), true);
  assert.equal(deduplicator.checkAndAdd(idA), false, 'Duplicate id must be rejected');

  assert.equal(deduplicator.checkAndAdd(idB), true);
  assert.equal(deduplicator.checkAndAdd(idB), false, 'Duplicate id must be rejected');

  // Fill up to bound
  deduplicator.checkAndAdd('msg-3');
  deduplicator.checkAndAdd('msg-4');
  deduplicator.checkAndAdd('msg-5');

  // Exceed bound: msg-1 should be evicted from the bounded LRU
  deduplicator.checkAndAdd('msg-6');
  assert.equal(deduplicator.has(idA), false, 'Oldest ID should have been evicted');
  assert.equal(deduplicator.has('msg-6'), true);
});

test('integration: production CSP restricts connect-src to explicit origin and excludes scheme-wide ws: and wss: wildcards', async () => {
  const prodOrigin = 'https://chat.tearoom-production.app';
  const { listen, close } = createServer({
    NODE_ENV: 'production',
    PORT: 0,
    CLIENT_ORIGIN: prodOrigin,
    ADMIN_SECRET: 'prod-test-strong-admin-secret-999999',
    ADMIN_SECRET: 'prod-test-strong-admin-secret-999999',
  });

  const { port } = await listen(0);
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${baseUrl}/health`);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'CSP header must be present');

    // Extract connect-src directive
    const match = csp.match(/connect-src\s+([^;]+)/);
    assert.ok(match, 'connect-src directive must be present in CSP');
    const connectSrcValue = match[1];

    // Assert that scheme-wide wildcards 'ws:' and 'wss:' are NOT present
    const sources = connectSrcValue.split(/\s+/);
    assert.equal(sources.includes('ws:'), false, 'Scheme-wide ws: wildcard must not be in production CSP');
    assert.equal(sources.includes('wss:'), false, 'Scheme-wide wss: wildcard must not be in production CSP');

    // Assert that explicit origins are present
    assert.ok(sources.includes("'self'"), "'self' must be permitted in connect-src");
    assert.ok(sources.includes(prodOrigin), 'Explicit production HTTPS origin must be in connect-src');
    assert.ok(sources.includes('wss://chat.tearoom-production.app'), 'Explicit production WSS origin must be in connect-src');
  } finally {
    await close();
  }
});

test('integration: evict_member removes target socket from room and notifies remaining members with new epoch', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;

  const socketAlice = await connectSocket(serverUrl);
  const socketEve = await connectSocket(serverUrl);

  const room = 'moderated-room';

  try {
    // 1. Both join room
    const joinAlice = await emitWithAck(socketAlice, 'join', { v: 1, room });
    assert.equal(joinAlice.ok, true);
    assert.ok(joinAlice.salt, 'Join ack must include random room salt');
    assert.equal(joinAlice.epoch, 1);

    const joinEve = await emitWithAck(socketEve, 'join', { v: 1, room });
    assert.equal(joinEve.ok, true);
    assert.equal(joinEve.salt, joinAlice.salt, 'Same room must share identical random salt');

    // Announce userIds
    socketAlice.emit('announce_presence', { v: 1, room, userId: 'USR-ALICE', nickname: 'Alice' });
    socketEve.emit('announce_presence', { v: 1, room, userId: 'USR-EVE', nickname: 'Eve' });
    await new Promise((r) => setTimeout(r, 50));

    // Listeners for eviction events
    let eveEvictedEvent = null;
    socketEve.on('evicted', (event) => {
      eveEvictedEvent = event;
    });

    let aliceMemberEvictedEvent = null;
    socketAlice.on('member_evicted', (event) => {
      aliceMemberEvictedEvent = event;
    });

    // 2. Alice evicts Eve
    const evictRes = await emitWithAck(socketAlice, 'evict_member', {
      v: 1,
      room,
      targetUserId: 'USR-EVE',
      reason: 'POLICY_VIOLATION',
    });

    assert.equal(evictRes.ok, true);
    assert.equal(evictRes.evicted, true);
    assert.equal(evictRes.newEpoch, 2);

    await new Promise((r) => setTimeout(r, 60));

    // Eve received 'evicted' event
    assert.ok(eveEvictedEvent, 'Target socket must receive evicted event');
    assert.equal(eveEvictedEvent.room, room);
    assert.equal(eveEvictedEvent.epoch, 2);

    // Alice received 'member_evicted' notification with new epoch
    assert.ok(aliceMemberEvictedEvent, 'Remaining member must receive member_evicted notification');
    assert.equal(aliceMemberEvictedEvent.targetUserId, 'USR-EVE');
    assert.equal(aliceMemberEvictedEvent.newEpoch, 2);

    // 3. Eve attempts to send a message to the room after eviction -> must be rejected with NOT_IN_ROOM
    const msgRes = await emitWithAck(socketEve, 'message', {
      v: 1,
      id: '00000000-0000-0000-0000-000000000001',
      room,
      iv: 'AAAAAAAAAAAAAAAA',
      ct: 'AAAAAAAAAAAAAAAAAAAAAA==',
    });
    assert.equal(msgRes.ok, false);
    assert.equal(msgRes.code, 'NOT_IN_ROOM', 'Evicted socket must be rejected from transmitting to room');
  } finally {
    socketAlice.disconnect();
    socketEve.disconnect();
    await close();
  }
});

test('integration: encrypted reactions are relayed in real-time and decrypted across clients', async () => {
  const { encryptReaction, decryptReaction, generateIdentityKeyPair } = await import('../frontend/src/utils/crypto.js');
  const { server, io, listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
    CLIENT_ORIGIN: 'http://localhost',
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;
  const roomName = 'react-relay-vault';

  const roomSecret = 'super-secret-passkey-react-1234';
  const keyAlice = await deriveRoomKey({ password: roomSecret, roomName, iterations: 300000 });
  const keyBob = await deriveRoomKey({ password: roomSecret, roomName, iterations: 300000 });

  const aliceKp = await generateIdentityKeyPair();
  const bobKp = await generateIdentityKeyPair();

  const clientAlice = await connectSocket(serverUrl);
  const clientBob = await connectSocket(serverUrl);

  try {
    await emitWithAck(clientAlice, 'join', { v: 1, room: roomName });
    await emitWithAck(clientBob, 'join', { v: 1, room: roomName });

    const bobReactions = [];
    clientBob.on('reaction', (data) => bobReactions.push(data));

    // Alice sends reaction to a message
    const targetMsgId = '99998888-7777-4666-8555-444433332222';
    const encryptedReaction = await encryptReaction({
      key: keyAlice,
      room: roomName,
      targetMessageId: targetMsgId,
      emoji: 'ðŸ‘',
      action: 'add',
      userId: 'USR-ALICE',
      nickname: 'Alice',
      identityKeyPair: aliceKp,
    });

    const sendAck = await emitWithAck(clientAlice, 'reaction', encryptedReaction);
    assert.equal(sendAck.ok, true);

    await new Promise((r) => setTimeout(r, 100));

    assert.equal(bobReactions.length, 1);
    assert.equal(bobReactions[0].targetMessageId, targetMsgId);

    // Bob decrypts Alice's reaction
    const decryptedReaction = await decryptReaction({
      key: keyBob,
      payload: bobReactions[0],
    });

    assert.equal(decryptedReaction.targetMessageId, targetMsgId);
    assert.equal(decryptedReaction.emoji, 'ðŸ‘');
    assert.equal(decryptedReaction.action, 'add');
    assert.equal(decryptedReaction.userId, 'USR-ALICE');
    assert.equal(decryptedReaction.isSigned, true);
  } finally {
    clientAlice.disconnect();
    clientBob.disconnect();
    await close();
  }
});



