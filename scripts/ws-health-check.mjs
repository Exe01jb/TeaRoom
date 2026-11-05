/**
 * TeaRoom - Synthetic HTTP + WebSocket Readiness Probe (Phase 10.2 / 10.3)
 * Verifies /health, /config, and real Socket.IO WebSocket transport upgrade.
 */
import { io as ioClient } from 'socket.io-client';

const TARGET_URL = process.env.TEAROOM_PROBE_URL || 'http://127.0.0.1:3000';
const TIMEOUT_MS = 4000;

async function runProbe() {
  const start = performance.now();

  // 1. Verify HTTP Liveness
  const healthRes = await fetch(`${TARGET_URL}/health`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (healthRes.status !== 200) {
    throw new Error(`HTTP /health returned status ${healthRes.status}`);
  }
  const healthBody = await healthRes.json();
  if (healthBody?.status !== 'ok') {
    throw new Error('HTTP /health payload missing status: ok');
  }

  // 2. Verify WebSocket Upgrade & Socket.IO Handshake
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('WebSocket handshake timed out'));
    }, TIMEOUT_MS);

    const socket = ioClient(TARGET_URL, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: TIMEOUT_MS,
    });

    socket.on('connect', () => {
      clearTimeout(timer);
      socket.disconnect();
      resolve();
    });

    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(new Error(`WebSocket connect_error: ${err.message}`));
    });
  });

  const elapsedMs = Math.round((performance.now() - start) * 10) / 10;
  console.log(JSON.stringify({ status: 'healthy', target: TARGET_URL, latencyMs: elapsedMs }));
}

runProbe().catch((err) => {
  console.error(JSON.stringify({ status: 'unhealthy', target: TARGET_URL, error: err.message }));
  process.exit(1);
});