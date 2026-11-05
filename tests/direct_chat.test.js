/**
 * Private Chatroom - Tests for Multi-Room Subscriptions, Direct Messaging, and Presence
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

test('direct-chat: multi-room sockets receive messages across both group and direct chats concurrently', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;

  const groupRoom = 'general-lobby';
  const dmRoom = 'dm-USR-ALICE-USR-BOB';

  const groupPassword = 'group-encryption-password-1234';
  const dmPassword = 'pairwise-direct-secret-passkey-9999';

  const groupKeyA = await deriveRoomKey({ password: groupPassword, room: groupRoom, iterations: 300000 });
  const groupKeyB = await deriveRoomKey({ password: groupPassword, room: groupRoom, iterations: 300000 });

  const dmKeyA = await deriveRoomKey({ password: dmPassword, room: dmRoom, iterations: 300000 });
  const dmKeyB = await deriveRoomKey({ password: dmPassword, room: dmRoom, iterations: 300000 });

  const clientA = await connectSocket(serverUrl);
  const clientB = await connectSocket(serverUrl);

  try {
    // Both join group room
    const ackA1 = await emitWithAck(clientA, 'join', { v: 1, room: groupRoom });
    assert.equal(ackA1.ok, true);
    const ackB1 = await emitWithAck(clientB, 'join', { v: 1, room: groupRoom });
    assert.equal(ackB1.ok, true);

    // Both join pairwise direct chat room without leaving group room
    const ackA2 = await emitWithAck(clientA, 'join', { v: 1, room: dmRoom });
    assert.equal(ackA2.ok, true);
    const ackB2 = await emitWithAck(clientB, 'join', { v: 1, room: dmRoom });
    assert.equal(ackB2.ok, true);

    const clientAReceived = [];
    clientA.on('message', (msg) => clientAReceived.push(msg));

    const clientBReceived = [];
    clientB.on('message', (msg) => clientBReceived.push(msg));

    // 1. Client A sends message to DM room
    const dmMsgPayload = await encryptMessage({
      key: dmKeyA,
      room: dmRoom,
      text: 'Direct message from Alice to Bob',
      nickname: 'Alice',
      userId: 'USR-ALICE',
    });
    const ackDMSend = await emitWithAck(clientA, 'message', dmMsgPayload);
    assert.equal(ackDMSend.ok, true);

    // 2. Client B sends message to Group room
    const groupMsgPayload = await encryptMessage({
      key: groupKeyB,
      room: groupRoom,
      text: 'Public message from Bob to everyone in lobby',
      nickname: 'Bob',
      userId: 'USR-BOB',
    });
    const ackGroupSend = await emitWithAck(clientB, 'message', groupMsgPayload);
    assert.equal(ackGroupSend.ok, true);

    // Wait for delivery
    await new Promise((r) => setTimeout(r, 60));

    // Client B must have received the DM message and can decrypt it
    assert.equal(clientBReceived.length, 1);
    assert.equal(clientBReceived[0].room, dmRoom);
    const decryptedDM = await decryptMessage({ key: dmKeyB, payload: clientBReceived[0] });
    assert.equal(decryptedDM.text, 'Direct message from Alice to Bob');

    // Client A must have received the Group message and can decrypt it
    assert.equal(clientAReceived.length, 1);
    assert.equal(clientAReceived[0].room, groupRoom);
    const decryptedGroup = await decryptMessage({ key: groupKeyA, payload: clientAReceived[0] });
    assert.equal(decryptedGroup.text, 'Public message from Bob to everyone in lobby');
  } finally {
    clientA.disconnect();
    clientB.disconnect();
    await close();
  }
});

test('direct-chat: dm_invite event notifies target socket and presence announce works in real-time', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;

  const room = 'main-lounge';
  const clientA = await connectSocket(serverUrl);
  const clientB = await connectSocket(serverUrl);

  try {
    await emitWithAck(clientA, 'join', { v: 1, room });
    await emitWithAck(clientB, 'join', { v: 1, room });

    // Client A and B announce presence with userIds
    clientA.emit('announce_presence', { v: 1, room, userId: 'USR-A', nickname: 'Alice' });
    clientB.emit('announce_presence', { v: 1, room, userId: 'USR-B', nickname: 'Bob' });

    await new Promise((r) => setTimeout(r, 60));

    // Client B listens for incoming DM invite
    const invitePromise = new Promise((resolve) => {
      clientB.on('dm_invite', (invite) => resolve(invite));
    });

    // Client A sends direct chat invite targeting USR-B
    const ackInvite = await emitWithAck(clientA, 'dm_invite', {
      v: 1,
      targetUserId: 'USR-B',
      fromUserId: 'USR-A',
      fromNickname: 'Alice',
      room: 'dm-USR-A-USR-B',
    });

    assert.equal(ackInvite.ok, true);
    assert.equal(ackInvite.delivered, true);

    const receivedInvite = await invitePromise;
    assert.deepEqual(receivedInvite, {
      v: 1,
      fromUserId: 'USR-A',
      fromNickname: 'Alice',
      room: 'dm-USR-A-USR-B',
    });
  } finally {
    clientA.disconnect();
    clientB.disconnect();
    await close();
  }
});

test('direct-chat: once client B joins the room, client B is not sent further invitations for the same room', async () => {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
  });

  const { port } = await listen(0);
  const serverUrl = `http://127.0.0.1:${port}`;

  const room = 'main-lounge';
  const dmRoom = 'dm-USR-A-USR-B';
  const clientA = await connectSocket(serverUrl);
  const clientB = await connectSocket(serverUrl);

  try {
    await emitWithAck(clientA, 'join', { v: 1, room });
    await emitWithAck(clientB, 'join', { v: 1, room });

    clientA.emit('announce_presence', { v: 1, room, userId: 'USR-A', nickname: 'Alice' });
    clientB.emit('announce_presence', { v: 1, room, userId: 'USR-B', nickname: 'Bob' });

    await new Promise((r) => setTimeout(r, 60));

    // Both join the DM room
    await emitWithAck(clientA, 'join', { v: 1, room: dmRoom });
    await emitWithAck(clientB, 'join', { v: 1, room: dmRoom });

    let extraInviteReceived = false;
    clientB.on('dm_invite', () => {
      extraInviteReceived = true;
    });

    // Client A attempts to send direct chat invite targeting USR-B for dmRoom
    const ackInvite = await emitWithAck(clientA, 'dm_invite', {
      v: 1,
      targetUserId: 'USR-B',
      fromUserId: 'USR-A',
      fromNickname: 'Alice',
      room: dmRoom,
    });

    assert.equal(ackInvite.ok, true);
    assert.equal(ackInvite.delivered, false); // Not delivered since USR-B already joined dmRoom

    await new Promise((r) => setTimeout(r, 60));
    assert.equal(extraInviteReceived, false);
  } finally {
    clientA.disconnect();
    clientB.disconnect();
    await close();
  }
});
