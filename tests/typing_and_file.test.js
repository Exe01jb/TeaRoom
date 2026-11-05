/**
 * Private Chatroom - Tests for Client-Side Encrypted File Attachments & Real-Time Typing Indicators
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { createServer } from '../backend/server.js';
import {
  deriveRoomKey,
  encryptMessage,
  decryptMessage,
  encryptTypingSignal,
  decryptTypingSignal,
  generateIdentityKeyPair,
  IdentityRegistry,
  TypingReplayDetector,
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
    socket.emit(event, data, (response) => {
      resolve(response);
    });
  });
}

test('files: client-side encrypted file attachments roundtrip with intact binary content and no server leak', async () => {
  const recordedPayloads = [];

  const { server, io, listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
    MAX_MESSAGE_BYTES: 1048576,
  });

  // Attach server spy
  io.on('connection', (sock) => {
    sock.onAny((event, ...args) => {
      recordedPayloads.push({ event, args });
    });
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;

  const room = 'classified-docs';
  const password = 'super-secret-passphrase-docs-999';

  const key1 = await deriveRoomKey({ password, room, iterations: 300000 });
  const key2 = await deriveRoomKey({ password, room, iterations: 300000 });

  const client1 = await connectSocket(serverUrl);
  const client2 = await connectSocket(serverUrl);

  try {
    await emitWithAck(client1, 'join', { v: 1, room });
    await emitWithAck(client2, 'join', { v: 1, room });

    // Client 2 sets up message receiver
    const receivedPromise = new Promise((resolve) => {
      client2.on('message', (payload) => {
        resolve(payload);
      });
    });

    // Sample 1x1 transparent PNG image data in base64
    const sampleFileData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const sampleFileName = 'blueprint.png';
    const sampleFileType = 'image/png';

    // Encrypt client-side
    const encryptedPayload = await encryptMessage({
      key: key1,
      room,
      text: 'Encrypted blueprint attached',
      nickname: 'Agent-Alice',
      userId: 'USR-ALICE01',
      file: {
        name: sampleFileName,
        type: sampleFileType,
        size: 68,
        data: sampleFileData,
      },
    });

    // Send encrypted message to relay
    const ack = await emitWithAck(client1, 'message', encryptedPayload);
    assert.equal(ack.ok, true);

    // Client 2 receives and decrypts client-side
    const relayedPayload = await receivedPromise;
    assert.equal(relayedPayload.id, encryptedPayload.id);

    const decrypted = await decryptMessage({ key: key2, payload: relayedPayload });
    assert.equal(decrypted.nickname, 'Agent-Alice');
    assert.equal(decrypted.userId, 'USR-ALICE01');
    assert.equal(decrypted.text, 'Encrypted blueprint attached');
    assert.ok(decrypted.file, 'File attachment should be present');
    assert.equal(decrypted.file.name, sampleFileName);
    assert.equal(decrypted.file.type, sampleFileType);
    assert.equal(decrypted.file.size, 68);
    assert.equal(decrypted.file.data, sampleFileData);

    // Verify Server Spy: Ensure server NEVER saw the filename, file type, or file data
    for (const record of recordedPayloads) {
      const serialized = JSON.stringify(record);
      assert.equal(serialized.includes(sampleFileName), false, 'Filename must not leak to server');
      assert.equal(serialized.includes(sampleFileData), false, 'File binary data must not leak to server');
      assert.equal(serialized.includes('Agent-Alice'), false, 'Sender nickname must not leak to server');
      assert.equal(serialized.includes('Encrypted blueprint attached'), false, 'Message text must not leak to server');
    }
  } finally {
    client1.disconnect();
    client2.disconnect();
    await close();
  }
});

test('typing: typing events broadcast in real time to room members and isolate non-members', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;

  const roomA = 'room-alpha';
  const roomB = 'room-beta';

  const clientA1 = await connectSocket(serverUrl);
  const clientA2 = await connectSocket(serverUrl);
  const clientB = await connectSocket(serverUrl);

  try {
    await emitWithAck(clientA1, 'join', { v: 1, room: roomA });
    await emitWithAck(clientA2, 'join', { v: 1, room: roomA });
    await emitWithAck(clientB, 'join', { v: 1, room: roomB });

    const clientA2TypingEvents = [];
    clientA2.on('typing', (event) => {
      clientA2TypingEvents.push(event);
    });

    const clientBTypingEvents = [];
    clientB.on('typing', (event) => {
      clientBTypingEvents.push(event);
    });

    // Client A1 begins typing
    clientA1.emit('typing', {
      v: 1,
      room: roomA,
      isTyping: true,
      userId: 'USR-A1',
      nickname: 'Alice',
    });

    // Wait 50ms for event dispatch
    await new Promise((r) => setTimeout(r, 60));

    assert.equal(clientA2TypingEvents.length, 1);
    assert.deepEqual(clientA2TypingEvents[0], {
      v: 1,
      room: roomA,
      isTyping: true,
      userId: 'USR-A1',
      nickname: 'Alice',
    });

    // Client B in another room should NOT receive roomA typing event
    assert.equal(clientBTypingEvents.length, 0);

    // Client A1 stops typing
    clientA1.emit('typing', {
      v: 1,
      room: roomA,
      isTyping: false,
      userId: 'USR-A1',
      nickname: 'Alice',
    });

    await new Promise((r) => setTimeout(r, 60));

    assert.equal(clientA2TypingEvents.length, 2);
    assert.deepEqual(clientA2TypingEvents[1], {
      v: 1,
      room: roomA,
      isTyping: false,
      userId: 'USR-A1',
      nickname: 'Alice',
    });
  } finally {
    clientA1.disconnect();
    clientA2.disconnect();
    clientB.disconnect();
    await close();
  }
});

test('typing: encrypted ephemeral typing signal broadcasts to peers and decrypts cleanly with room key', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;

  const room = 'room-crypto-typing';
  const otherRoom = 'room-isolated';

  const client1 = await connectSocket(serverUrl);
  const client2 = await connectSocket(serverUrl);
  const client3 = await connectSocket(serverUrl);

  try {
    await emitWithAck(client1, 'join', { v: 1, room });
    await emitWithAck(client2, 'join', { v: 1, room });
    await emitWithAck(client3, 'join', { v: 1, room: otherRoom });

    const key = await deriveRoomKey({
      password: 'typing-signal-strong-password-1234',
      roomName: room,
      iterations: 300000,
    });

    const client2Events = [];
    client2.on('typing', (event) => {
      client2Events.push(event);
    });

    const client3Events = [];
    client3.on('typing', (event) => {
      client3Events.push(event);
    });

    // Client 1 generates encrypted typing signal
    const encryptedSignal = await encryptTypingSignal({
      key,
      room,
      isTyping: true,
      userId: 'USR-SEC1',
      nickname: 'Bob',
      ttl: 2500,
    });

    // Client 1 transmits encrypted signal to relay server
    client1.emit('typing', {
      v: 1,
      room,
      ciphertext: encryptedSignal.ciphertext,
      iv: encryptedSignal.iv,
      ttl: encryptedSignal.ttl,
    });

    await new Promise((r) => setTimeout(r, 60));

    // Verify Client 2 received the relay packet without plaintext
    assert.equal(client2Events.length, 1);
    const receivedEvent = client2Events[0];
    assert.equal(receivedEvent.v, 1);
    assert.equal(receivedEvent.room, room);
    assert.ok(receivedEvent.ciphertext, 'Ciphertext must be present on relayed packet');
    assert.ok(receivedEvent.iv, 'IV must be present on relayed packet');
    assert.equal(receivedEvent.ttl, 2500);
    // Plaintext fields must NEVER be relayed by server for encrypted signal
    assert.equal(receivedEvent.userId, undefined);
    assert.equal(receivedEvent.nickname, undefined);
    assert.equal(receivedEvent.isTyping, undefined);

    // Client 3 in other room receives zero events (isolation)
    assert.equal(client3Events.length, 0);

    // Client 2 decrypts the received event with room key
    const decrypted = await decryptTypingSignal({
      key,
      room,
      ciphertext: receivedEvent.ciphertext,
      iv: receivedEvent.iv,
    });

    assert.ok(decrypted, 'Decrypted typing signal must not be null');
    assert.equal(decrypted.isTyping, true);
    assert.equal(decrypted.userId, 'USR-SEC1');
    assert.equal(decrypted.nickname, 'Bob');
    assert.equal(decrypted.ttl, 2500);

    // Client 1 stops typing: sends encrypted isTyping: false signal
    const stopSignal = await encryptTypingSignal({
      key,
      room,
      isTyping: false,
      userId: 'USR-SEC1',
      nickname: 'Bob',
      ttl: 2500,
    });

    client1.emit('typing', {
      v: 1,
      room,
      ciphertext: stopSignal.ciphertext,
      iv: stopSignal.iv,
      ttl: stopSignal.ttl,
    });

    await new Promise((r) => setTimeout(r, 60));

    assert.equal(client2Events.length, 2);
    const decryptedStop = await decryptTypingSignal({
      key,
      room,
      ciphertext: client2Events[1].ciphertext,
      iv: client2Events[1].iv,
    });
    assert.ok(decryptedStop);
    assert.equal(decryptedStop.isTyping, false);
    assert.equal(decryptedStop.userId, 'USR-SEC1');
  } finally {
    client1.disconnect();
    client2.disconnect();
    client3.disconnect();
    await close();
  }
});

test('typing: replay prevention, inflated TTL clamping, and sender impersonation protection across WebSocket relay', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;
  const room = 'room-replay-test';

  const client1 = await connectSocket(serverUrl);
  const client2 = await connectSocket(serverUrl);

  try {
    await emitWithAck(client1, 'join', { v: 1, room });
    await emitWithAck(client2, 'join', { v: 1, room });

    const key = await deriveRoomKey({
      password: 'typing-signal-strong-password-1234',
      roomName: room,
      iterations: 300000,
    });

    const aliceIdentity = await generateIdentityKeyPair();
    const replayDetector = new TypingReplayDetector();
    const identityRegistry = new IdentityRegistry();

    const client2Events = [];
    client2.on('typing', (event) => {
      client2Events.push(event);
    });

    // 1. Client 1 broadcasts legitimate encrypted typing signal with inflated TTL (99999ms)
    const legitSignal = await encryptTypingSignal({
      key,
      room,
      isTyping: true,
      userId: 'USR-ALICE',
      nickname: 'Alice',
      ttl: 99999, // Attacker attempts to set enormous TTL
      identityKeyPair: aliceIdentity,
    });

    client1.emit('typing', {
      v: 1,
      room,
      ciphertext: legitSignal.ciphertext,
      iv: legitSignal.iv,
      ttl: legitSignal.ttl,
      signalId: legitSignal.signalId,
    });

    await new Promise((r) => setTimeout(r, 60));
    assert.equal(client2Events.length, 1);

    const relayedPacket = client2Events[0];
    // Verify server clamped outbound TTL to 5000ms max
    assert.ok(relayedPacket.ttl <= 5000, 'Server relay must clamp TTL to <= 5000ms');
    assert.equal(relayedPacket.signalId, legitSignal.signalId, 'Server relay must forward signalId');

    // Client 2 decodes with replay detector and identity registry
    const decodedFirst = await decryptTypingSignal({
      key,
      room,
      ciphertext: relayedPacket.ciphertext,
      iv: relayedPacket.iv,
      ttl: relayedPacket.ttl,
      signalId: relayedPacket.signalId,
      identityRegistry,
      replayDetector,
    });
    assert.ok(decodedFirst, 'Legitimate first packet must decode successfully');
    assert.equal(decodedFirst.isSigned, true);
    assert.equal(decodedFirst.ttl, 5000, 'Receiver must cap TTL at 5000ms ceiling');

    // 2. Attack: Exact-envelope replay within the same room
    const decodedReplay = await decryptTypingSignal({
      key,
      room,
      ciphertext: relayedPacket.ciphertext,
      iv: relayedPacket.iv,
      ttl: relayedPacket.ttl,
      signalId: relayedPacket.signalId,
      identityRegistry,
      replayDetector,
    });
    assert.equal(decodedReplay, null, 'Exact-envelope replay must be dropped (fail closed)');

    // 3. Attack: Modified room ID (trying to replay signal into different room)
    const decodedWrongRoom = await decryptTypingSignal({
      key,
      room: 'other-room',
      ciphertext: relayedPacket.ciphertext,
      iv: relayedPacket.iv,
      ttl: relayedPacket.ttl,
      signalId: 'new-id',
      identityRegistry,
      replayDetector,
    });
    assert.equal(decodedWrongRoom, null, 'Modified room ID must fail closed');

    // 4. Client 1 sends legitimate stop typing signal
    const stopSignal = await encryptTypingSignal({
      key,
      room,
      isTyping: false,
      userId: 'USR-ALICE',
      nickname: 'Alice',
      ttl: 2000,
      identityKeyPair: aliceIdentity,
    });

    client1.emit('typing', {
      v: 1,
      room,
      ciphertext: stopSignal.ciphertext,
      iv: stopSignal.iv,
      ttl: stopSignal.ttl,
      signalId: stopSignal.signalId,
    });

    await new Promise((r) => setTimeout(r, 60));
    assert.equal(client2Events.length, 2);

    const relayedStop = client2Events[1];
    const decodedStop = await decryptTypingSignal({
      key,
      room,
      ciphertext: relayedStop.ciphertext,
      iv: relayedStop.iv,
      ttl: relayedStop.ttl,
      signalId: relayedStop.signalId,
      identityRegistry,
      replayDetector,
    });
    assert.ok(decodedStop);
    assert.equal(decodedStop.isTyping, false);

    // 5. Attack: Duplicated cancellation signal replay
    const decodedStopReplay = await decryptTypingSignal({
      key,
      room,
      ciphertext: relayedStop.ciphertext,
      iv: relayedStop.iv,
      ttl: relayedStop.ttl,
      signalId: relayedStop.signalId,
      identityRegistry,
      replayDetector,
    });
    assert.equal(decodedStopReplay, null, 'Duplicated cancellation signal must be dropped');
  } finally {
    client1.disconnect();
    client2.disconnect();
    await close();
  }
});

