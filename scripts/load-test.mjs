/**
 * TeaRoom - Isolated Local Relay Load & Fan-Out Benchmark (Phase 10.6)
 * Spawns an ephemeral local server and measures concurrent Socket.IO connections,
 * ciphertext broadcast fan-out latency (p50/p95/p99), and RSS memory growth.
 */
import crypto from 'node:crypto';
import { io as ioClient } from 'socket.io-client';
import { createServer } from '../backend/server.js';

const NUM_CLIENTS = Number(process.env.LOAD_CLIENTS || 20);
const MESSAGES_PER_CLIENT = Number(process.env.LOAD_MSGS || 5);
const ROOM_NAME = 'benchmark-room';

function connectClient(url) {
  return new Promise((resolve, reject) => {
    const sock = ioClient(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    sock.on('connect', () => resolve(sock));
    sock.on('connect_error', reject);
  });
}

function emitAck(sock, event, payload) {
  return new Promise((resolve) => sock.emit(event, payload, resolve));
}

async function runLoadTest() {
  const { listen, close } = createServer({
    NODE_ENV: 'development',
    PORT: 0,
    MAX_CONNECTIONS: NUM_CLIENTS + 10,
    MAX_CONNECTIONS_PER_IP: NUM_CLIENTS + 10,
    MAX_ROOM_SIZE: NUM_CLIENTS + 5,
    RATE_LIMIT_MESSAGES: MESSAGES_PER_CLIENT * NUM_CLIENTS + 50,
    RATE_LIMIT_JOINS: NUM_CLIENTS + 20,
    INVITE_ONLY: false,
  });

  const { port } = await listen(0);
  const url = `http://127.0.0.1:${port}`;
  const rssStartMb = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;

  const sockets = [];
  const latenciesMs = [];
  let receivedBroadcasts = 0;

  try {
    // 1. Connect NUM_CLIENTS concurrent sockets and join ROOM_NAME
    const connectStart = performance.now();
    for (let i = 0; i < NUM_CLIENTS; i++) {
      const s = await connectClient(url);
      s.on('message', () => {
        receivedBroadcasts++;
      });
      const joinAck = await emitAck(s, 'join', {
        v: 1,
        room: ROOM_NAME,
        userId: `USR-BENCH-${i}`,
        nickname: `Bench${i}`,
      });
      if (!joinAck?.ok) throw new Error(`Join failed for client ${i}: ${joinAck?.code}`);
      sockets.push(s);
    }
    const connectElapsedMs = Math.round(performance.now() - connectStart);

    // 2. Broadcast synthetic encrypted payloads (1 KB ciphertext)
    const sampleIv = crypto.randomBytes(12).toString('base64');
    const sampleCt = crypto.randomBytes(1024).toString('base64');

    for (let m = 0; m < MESSAGES_PER_CLIENT; m++) {
      await Promise.all(
        sockets.map(async (s) => {
          const t0 = performance.now();
          const ack = await emitAck(s, 'message', {
            v: 1,
            id: crypto.randomUUID(),
            room: ROOM_NAME,
            iv: sampleIv,
            ct: sampleCt,
          });
          if (!ack?.ok) throw new Error(`Message rejected: ${ack?.code}`);
          latenciesMs.push(performance.now() - t0);
        })
      );
    }

    // Wait briefly for all room fan-out deliveries to settle
    await new Promise((r) => setTimeout(r, 100));

    latenciesMs.sort((a, b) => a - b);
    const p50 = latenciesMs[Math.floor(latenciesMs.length * 0.5)] || 0;
    const p95 = latenciesMs[Math.floor(latenciesMs.length * 0.95)] || 0;
    const p99 = latenciesMs[Math.floor(latenciesMs.length * 0.99)] || 0;
    const rssEndMb = Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;
    const expectedBroadcasts = NUM_CLIENTS * MESSAGES_PER_CLIENT * (NUM_CLIENTS - 1);

    console.log(
      JSON.stringify(
        {
          clients: NUM_CLIENTS,
          messagesSent: NUM_CLIENTS * MESSAGES_PER_CLIENT,
          broadcastsDelivered: receivedBroadcasts,
          expectedBroadcasts,
          connectAllMs: connectElapsedMs,
          ackLatencyMs: {
            p50: Math.round(p50 * 100) / 100,
            p95: Math.round(p95 * 100) / 100,
            p99: Math.round(p99 * 100) / 100,
          },
          memoryRssMb: { start: rssStartMb, end: rssEndMb, delta: Math.round((rssEndMb - rssStartMb) * 10) / 10 },
        },
        null,
        2
      )
    );
  } finally {
    for (const s of sockets) s.disconnect();
    await close();
  }
}

runLoadTest();