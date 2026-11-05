/**
 * Private Chatroom - Read Receipt Tests
 * Tests receipt event triggering upon successful message decryption
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { createServer } from '../backend/server.js';
import { deriveRoomKey, encryptMessage, decryptMessage } from '../frontend/src/utils/crypto.js';

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

test('receipt: read receipt is relayed to sender after recipient decrypts message', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;
  const roomName = 'receipt-chamber';

  const client1 = await connectSocket(serverUrl);
  const client2 = await connectSocket(serverUrl);

  const sharedPassword = 'receipt-room-password-12345';
  const key1 = await deriveRoomKey({ password: sharedPassword, roomName, iterations: 300000 });
  const key2 = await deriveRoomKey({ password: sharedPassword, roomName, iterations: 300000 });

  try {
    await emitWithAck(client1, 'join', { v: 1, room: roomName });
    await emitWithAck(client2, 'join', { v: 1, room: roomName });

    let senderReceivedReceipt = null;
    client1.on('receipt', (receiptPayload) => {
      senderReceivedReceipt = receiptPayload;
    });

    // Client 2 listens for message, decrypts it, and emits receipt
    client2.on('message', async (encryptedWirePayload) => {
      try {
        const decrypted = await decryptMessage({ key: key2, payload: encryptedWirePayload });
        assert.equal(decrypted.text, 'Ping read receipt');

        // Successful decryption triggers read receipt
        client2.emit('receipt', {
          v: 1,
          id: encryptedWirePayload.id,
          room: encryptedWirePayload.room,
          readerId: 'USR-RECIPIENT',
        });
      } catch (err) {
        // Should not happen with correct key
      }
    });

    // Client 1 sends message
    const messageId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const encrypted = await encryptMessage({
      key: key1,
      room: roomName,
      text: 'Ping read receipt',
      nickname: 'SenderAlice',
      id: messageId,
    });

    const sendAck = await emitWithAck(client1, 'message', encrypted);
    assert.equal(sendAck.ok, true);

    // Wait 250ms for message distribution, decryption, and receipt bounce
    await new Promise((r) => setTimeout(r, 250));

    assert.ok(senderReceivedReceipt, 'Sender did not receive read receipt');
    assert.equal(senderReceivedReceipt.id, messageId);
    assert.equal(senderReceivedReceipt.room, roomName);
    assert.equal(senderReceivedReceipt.readerId, 'USR-RECIPIENT');
  } finally {
    client1.disconnect();
    client2.disconnect();
    await close();
  }
});

test('receipt: non-member or malformed receipt is rejected by server validation', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;
  const client = await connectSocket(serverUrl);

  try {
    // Non-member receipt
    const ack1 = await emitWithAck(client, 'receipt', {
      v: 1,
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      room: 'unjoined-room',
    });
    assert.equal(ack1.ok, false);
    assert.equal(ack1.code, 'NOT_IN_ROOM');

    // Join valid room
    await emitWithAck(client, 'join', { v: 1, room: 'my-room' });

    // Malformed ID
    const ack2 = await emitWithAck(client, 'receipt', {
      v: 1,
      id: 'not-a-uuid',
      room: 'my-room',
    });
    assert.equal(ack2.ok, false);
    assert.equal(ack2.code, 'INVALID_PAYLOAD');
  } finally {
    client.disconnect();
    await close();
  }
});

test('receipt: delivery status progression (sent -> delivered -> decrypted/read) triggers correctly', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;
  const roomName = 'status-indicators-room';

  const sender = await connectSocket(serverUrl);
  const recipient = await connectSocket(serverUrl);

  const sharedPassword = 'secret-passkey-indicators-123';
  const keySender = await deriveRoomKey({ password: sharedPassword, roomName, iterations: 300000 });
  const keyRecipient = await deriveRoomKey({ password: sharedPassword, roomName, iterations: 300000 });

  try {
    await emitWithAck(sender, 'join', { v: 1, room: roomName });
    await emitWithAck(recipient, 'join', { v: 1, room: roomName });

    let senderDeliveredEvent = null;
    let senderReadEvent = null;

    sender.on('delivery', (payload) => {
      senderDeliveredEvent = payload;
    });

    sender.on('receipt', (payload) => {
      senderReadEvent = payload;
    });

    recipient.on('message', async (encryptedPayload) => {
      // 1. Immediately signal delivery upon packet receipt
      recipient.emit('delivery', {
        v: 1,
        id: encryptedPayload.id,
        room: encryptedPayload.room,
        recipientId: 'USR-RECIPIENT-99',
      });

      // 2. Decrypt with Web Crypto AES-GCM
      const decrypted = await decryptMessage({ key: keyRecipient, payload: encryptedPayload });
      assert.equal(decrypted.text, 'Visual status feedback verification');

      // 3. Signal read/decrypted receipt
      recipient.emit('receipt', {
        v: 1,
        id: encryptedPayload.id,
        room: encryptedPayload.room,
        readerId: 'USR-RECIPIENT-99',
      });
    });

    const msgId = '11111111-2222-4333-8444-555555555555';
    const encrypted = await encryptMessage({
      key: keySender,
      room: roomName,
      text: 'Visual status feedback verification',
      nickname: 'SenderUser',
      id: msgId,
    });

    // Sender sends message: server ack confirms relay with delivered = true because recipient is connected
    const sendAck = await emitWithAck(sender, 'message', encrypted);
    assert.equal(sendAck.ok, true);
    assert.equal(sendAck.delivered, true);
    assert.equal(sendAck.recipientCount, 1);

    // Wait for delivery event and read receipt event
    await new Promise((r) => setTimeout(r, 250));

    assert.ok(senderDeliveredEvent, 'Sender should have received delivery event');
    assert.equal(senderDeliveredEvent.id, msgId);
    assert.equal(senderDeliveredEvent.room, roomName);

    assert.ok(senderReadEvent, 'Sender should have received read/decrypted event');
    assert.equal(senderReadEvent.id, msgId);
    assert.equal(senderReadEvent.room, roomName);
  } finally {
    sender.disconnect();
    recipient.disconnect();
    await close();
  }
});

