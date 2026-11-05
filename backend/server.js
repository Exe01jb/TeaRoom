/**
 * TeaRoom (Private Chatroom) - Express & Socket.io Server
 * Zero-persistence client-side encrypted chat relay with Administrator Moderation Dashboard.
 * @author Exe01jb (https://github.com/Exe01jb)
 * @license MIT
 */
import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { Server as SocketIOServer } from 'socket.io';
import { setupChatHandlers } from './sockets/chatHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DISALLOWED_PROD_SECRETS = new Set([
  '',
  'admin-secret-dev-key',
  'replace-with-strong-production-secret-key',
  '__CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_HEX_32__',
  'changeme',
]);

export function createServer(customConfig = {}) {
  const NODE_ENV = customConfig.NODE_ENV ?? process.env.NODE_ENV ?? 'development';
  const isProd = NODE_ENV === 'production';
  const HOST = customConfig.HOST ?? process.env.HOST ?? '127.0.0.1';
  const PORT = Number(customConfig.PORT ?? process.env.PORT ?? 3000);
  const CLIENT_ORIGIN = customConfig.CLIENT_ORIGIN ?? process.env.CLIENT_ORIGIN ?? '';
  const TRUST_PROXY =
    (customConfig.TRUST_PROXY ?? process.env.TRUST_PROXY ?? 'false') === 'true' ||
    customConfig.TRUST_PROXY === true;

  const INVITE_ONLY =
    customConfig.INVITE_ONLY !== undefined
      ? Boolean(customConfig.INVITE_ONLY === true || customConfig.INVITE_ONLY === 'true')
      : (process.env.INVITE_ONLY ?? 'false') === 'true';

  const STATE_FILE_PATH =
    customConfig.STATE_FILE_PATH ?? process.env.STATE_FILE_PATH ?? '';

  const rawAdminSecret = (
    customConfig.ADMIN_SECRET ??
    process.env.ADMIN_SECRET ??
    (isProd ? '' : 'admin-secret-dev-key')
  ).trim();

  if (isProd) {
    if (!CLIENT_ORIGIN || CLIENT_ORIGIN.trim() === '' || CLIENT_ORIGIN.trim() === '*') {
      throw new Error(
        'FATAL: CLIENT_ORIGIN must be set to an explicit origin in production (cannot be empty or "*")'
      );
    }
    if (DISALLOWED_PROD_SECRETS.has(rawAdminSecret) || rawAdminSecret.length < 16) {
      throw new Error(
        'FATAL: ADMIN_SECRET must be explicitly set to a strong secret (>= 16 chars, not a placeholder) in production'
      );
    }
  }

  const ADMIN_SECRET = rawAdminSecret;
  const ADMIN_SESSION_TTL_MS = Number(
    customConfig.ADMIN_SESSION_TTL_MS ?? process.env.ADMIN_SESSION_TTL_MS ?? 3600000
  );

  const MAX_CONNECTIONS = Number(customConfig.MAX_CONNECTIONS ?? process.env.MAX_CONNECTIONS ?? 200);
  const MAX_CONNECTIONS_PER_IP = Number(
    customConfig.MAX_CONNECTIONS_PER_IP ?? process.env.MAX_CONNECTIONS_PER_IP ?? 10
  );
  const MAX_ROOM_SIZE = Number(customConfig.MAX_ROOM_SIZE ?? process.env.MAX_ROOM_SIZE ?? 20);
  const MAX_MESSAGE_BYTES = Number(
    customConfig.MAX_MESSAGE_BYTES ?? process.env.MAX_MESSAGE_BYTES ?? 1048576
  );
  const RATE_LIMIT_WINDOW_MS = Number(
    customConfig.RATE_LIMIT_WINDOW_MS ?? process.env.RATE_LIMIT_WINDOW_MS ?? 10000
  );
  const RATE_LIMIT_MESSAGES = Number(
    customConfig.RATE_LIMIT_MESSAGES ?? process.env.RATE_LIMIT_MESSAGES ?? 15
  );
  const RATE_LIMIT_JOINS = Number(
    customConfig.RATE_LIMIT_JOINS ?? process.env.RATE_LIMIT_JOINS ?? 5
  );

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  if (TRUST_PROXY) {
    app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  }

  const connectSrc = ["'self'"];
  if (isProd) {
    if (CLIENT_ORIGIN && CLIENT_ORIGIN !== '*') {
      try {
        const url = new URL(CLIENT_ORIGIN);
        const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        connectSrc.push(CLIENT_ORIGIN);
        connectSrc.push(`${wsProtocol}//${url.host}`);
      } catch {
        // Ignored
      }
    }
  } else {
    connectSrc.push('ws://localhost:*', 'ws://127.0.0.1:*', 'wss://localhost:*');
    if (CLIENT_ORIGIN && CLIENT_ORIGIN !== '*') {
      try {
        const url = new URL(CLIENT_ORIGIN);
        const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        connectSrc.push(CLIENT_ORIGIN);
        connectSrc.push(`${wsProtocol}//${url.host}`);
      } catch {
        // Ignored
      }
    }
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc,
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          mediaSrc: ["'self'", 'blob:', 'data:'],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
        },
      },
      hsts: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Public configuration endpoint (preserves exact 2 keys expected by integration.test.js)
  app.get('/config', (_req, res) => {
    res.status(200).json({
      protocolVersion: 1,
      maxMessageBytes: MAX_MESSAGE_BYTES,
    });
  });

  const server = http.createServer(app);
  const activeIpConnections = new Map();

  function getReqIp(req) {
    if (TRUST_PROXY) {
      const xRealIp = req.headers['x-real-ip'];
      if (typeof xRealIp === 'string' && xRealIp.trim()) {
        return xRealIp.trim();
      }
    }
    return req.socket.remoteAddress || '127.0.0.1';
  }

  // Ephemeral Admin Session Store (tokenHashHex -> expiresAt)
  // Prevents reusing the permanent ADMIN_SECRET as a client session token
  const adminSessions = new Map();

  function safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const hashA = crypto.createHash('sha256').update(a).digest();
    const hashB = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(hashA, hashB);
  }

  function issueAdminSessionToken() {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
    adminSessions.set(tokenHash, expiresAt);
    return { token: rawToken, expiresAt };
  }

  function isValidAdminCredential(candidate) {
    if (!candidate || typeof candidate !== 'string') return false;
    const trimmed = candidate.trim();
    if (!trimmed) return false;

    // 1. Check ephemeral session tokens first
    const tokenHash = crypto.createHash('sha256').update(trimmed).digest('hex');
    const expiresAt = adminSessions.get(tokenHash);
    if (expiresAt) {
      if (Date.now() <= expiresAt) {
        return true;
      }
      adminSessions.delete(tokenHash);
    }

    // 2. Direct header key authentication (for stateless CLI/API callers & tests)
    return safeCompare(trimmed, ADMIN_SECRET);
  }

  const maxHttpBufferSize = Math.max(32768, (MAX_MESSAGE_BYTES + 1024) * 2);
  let moderationEngine = null;

  const io = new SocketIOServer(server, {
    maxHttpBufferSize,
    cors: {
      origin: (_origin, callback) => {
        callback(null, true);
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    allowRequest: (req, callback) => {
      const clientIp = getReqIp(req);

      if (moderationEngine && moderationEngine.isIpBlocked(clientIp)) {
        return callback('IP_BANNED', false);
      }

      const currentTotal = io.engine ? io.engine.clientsCount : 0;
      if (currentTotal >= MAX_CONNECTIONS) {
        return callback('SERVER_FULL', false);
      }

      const currentIpCount = activeIpConnections.get(clientIp) || 0;
      if (currentIpCount >= MAX_CONNECTIONS_PER_IP) {
        return callback('IP_LIMIT_EXCEEDED', false);
      }

      const origin = req.headers.origin;
      if (isProd) {
        if (!origin || origin !== CLIENT_ORIGIN) {
          return callback('DISALLOWED_ORIGIN', false);
        }
      } else if (CLIENT_ORIGIN && origin) {
        if (
          origin !== CLIENT_ORIGIN &&
          !origin.includes('localhost') &&
          !origin.includes('127.0.0.1')
        ) {
          return callback('DISALLOWED_ORIGIN', false);
        }
      }

      callback(null, true);
    },
  });

  io.on('connection', (socket) => {
    const headerIp = TRUST_PROXY ? socket.handshake.headers['x-real-ip'] : null;
    const clientIp =
      typeof headerIp === 'string' && headerIp.trim()
        ? headerIp.trim()
        : socket.handshake.address;
    const count = activeIpConnections.get(clientIp) || 0;
    activeIpConnections.set(clientIp, count + 1);

    socket.on('disconnect', () => {
      const c = activeIpConnections.get(clientIp) || 1;
      if (c <= 1) {
        activeIpConnections.delete(clientIp);
      } else {
        activeIpConnections.set(clientIp, c - 1);
      }
    });
  });

  moderationEngine = setupChatHandlers(io, {
    MAX_ROOM_SIZE,
    MAX_MESSAGE_BYTES,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MESSAGES,
    RATE_LIMIT_JOINS,
    TRUST_PROXY,
    INVITE_ONLY,
    STATE_FILE_PATH,
    verifyAdminToken: isValidAdminCredential,
  });

  function requireAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    const customHeader = req.headers['x-admin-key'];
    let candidate = '';
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      candidate = authHeader.slice(7).trim();
    } else if (typeof customHeader === 'string') {
      candidate = customHeader.trim();
    }
    if (!isValidAdminCredential(candidate)) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    }
    next();
  }

  const adminAuthAttempts = new Map();

  const adminCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of adminAuthAttempts.entries()) {
      if (now >= record.resetAt) {
        adminAuthAttempts.delete(ip);
      }
    }
    for (const [tokenHash, expiresAt] of adminSessions.entries()) {
      if (now > expiresAt) {
        adminSessions.delete(tokenHash);
      }
    }
  }, 60000).unref();

  app.post('/api/admin/auth', (req, res) => {
    const clientIp = getReqIp(req);
    const now = Date.now();
    const record = adminAuthAttempts.get(clientIp);
    if (record && now < record.resetAt) {
      if (record.count >= 5) {
        return res.status(429).json({ ok: false, error: 'TOO_MANY_ATTEMPTS' });
      }
      record.count += 1;
    } else {
      adminAuthAttempts.set(clientIp, { count: 1, resetAt: now + 60000 });
    }

    const { key } = req.body || {};
    if (!key || typeof key !== 'string' || !safeCompare(key.trim(), ADMIN_SECRET)) {
      return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
    }
    adminAuthAttempts.delete(clientIp);

    // Issue an ephemeral session token rather than returning ADMIN_SECRET
    const session = issueAdminSessionToken();
    return res.status(200).json({
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
    });
  });

  app.get('/api/admin/overview', requireAdmin, (_req, res) => {
    const overview = moderationEngine.getOverview();
    const memory = process.memoryUsage();
    res.status(200).json({
      ok: true,
      data: {
        ...overview,
        inviteOnly: INVITE_ONLY,
        memoryRssMb: Math.round(memory.rss / (1024 * 1024)),
        memoryHeapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
        limits: {
          maxConnections: MAX_CONNECTIONS,
          maxConnectionsPerIp: MAX_CONNECTIONS_PER_IP,
          maxRoomSize: MAX_ROOM_SIZE,
          maxMessageBytes: MAX_MESSAGE_BYTES,
          rateLimitMessages: RATE_LIMIT_MESSAGES,
          rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
        },
      },
    });
  });

  app.get('/api/admin/connections', requireAdmin, (_req, res) => {
    const connections = moderationEngine.getConnections();
    res.status(200).json({ ok: true, data: connections });
  });

  app.post('/api/admin/connections/:id/disconnect', requireAdmin, (req, res) => {
    const { id } = req.params;
    const success = moderationEngine.disconnectSocket(id);
    if (!success) {
      return res.status(404).json({ ok: false, error: 'SOCKET_NOT_FOUND' });
    }
    res.status(200).json({ ok: true, message: `Socket ${id} disconnected` });
  });

  app.post('/api/admin/rooms/:room/terminate', requireAdmin, (req, res) => {
    const { room } = req.params;
    const success = moderationEngine.terminateRoom(room);
    if (!success) {
      return res.status(404).json({ ok: false, error: 'ROOM_NOT_FOUND' });
    }
    res.status(200).json({ ok: true, message: `Room ${room} terminated` });
  });

  app.post('/api/admin/rooms/:room/evict', requireAdmin, (req, res) => {
    const { room } = req.params;
    const { targetUserId, reason } = req.body || {};
    if (!targetUserId || typeof targetUserId !== 'string') {
      return res.status(400).json({ ok: false, error: 'INVALID_TARGET_USER' });
    }
    const result = moderationEngine.evictRoomMember(room, targetUserId, reason || 'ADMIN_EVICTION');
    res.status(200).json({ ok: true, data: result });
  });

  app.get('/api/admin/blocked-ips', requireAdmin, (_req, res) => {
    const ips = moderationEngine.getBlockedIps();
    res.status(200).json({ ok: true, data: ips });
  });

  app.post('/api/admin/blocked-ips', requireAdmin, (req, res) => {
    const { ip, reason } = req.body || {};
    if (!ip || typeof ip !== 'string') {
      return res.status(400).json({ ok: false, error: 'INVALID_IP' });
    }
    moderationEngine.blockIp(ip, reason || 'Administrative ban');
    res.status(200).json({ ok: true, message: `IP ${ip} blocked` });
  });

  app.delete('/api/admin/blocked-ips/:ip', requireAdmin, (req, res) => {
    const { ip } = req.params;
    const success = moderationEngine.unblockIp(ip);
    if (!success) {
      return res.status(404).json({ ok: false, error: 'IP_NOT_BLOCKED' });
    }
    res.status(200).json({ ok: true, message: `IP ${ip} unblocked` });
  });

  app.get('/api/admin/invites', requireAdmin, (_req, res) => {
    const list = moderationEngine.listInvites();
    res.status(200).json({ ok: true, data: list });
  });

  app.post('/api/admin/invites', requireAdmin, (req, res) => {
    const result = moderationEngine.createInvite(req.body || {});
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    res.status(200).json({ ok: true, data: result });
  });

  app.delete('/api/admin/invites/:username', requireAdmin, (req, res) => {
    const { username } = req.params;
    const success = moderationEngine.revokeInvite(username);
    if (!success) {
      return res.status(404).json({ ok: false, error: 'INVITE_NOT_FOUND' });
    }
    res.status(200).json({ ok: true, message: `Invite ${username} revoked` });
  });

  const staticDir = customConfig.staticDir ?? path.resolve(__dirname, '../dist');
  app.use(express.static(staticDir));

  app.get('*', (req, res, next) => {
    if (
      req.path.startsWith('/socket.io') ||
      req.path.startsWith('/health') ||
      req.path.startsWith('/config') ||
      req.path.startsWith('/api')
    ) {
      return next();
    }
    res.sendFile(path.join(staticDir, 'index.html'), (err) => {
      if (err) {
        next();
      }
    });
  });

  return {
    app,
    server,
    io,
    moderationEngine,
    listen: (port = PORT, host = HOST) => {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          resolve({ port: server.address().port, host });
        });
      });
    },
    close: () => {
      clearInterval(adminCleanupInterval);
      return new Promise((resolve) => {
        io.close(() => {
          if (server.listening) {
            server.close(() => resolve());
          } else {
            resolve();
          }
        });
      });
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const config = {
    PORT: process.env.PORT || 3000,
    HOST: process.env.HOST || '127.0.0.1',
    NODE_ENV: process.env.NODE_ENV || 'development',
    ADMIN_SECRET: process.env.ADMIN_SECRET,
  };
  const { listen, close } = createServer(config);
  listen().then(({ port, host }) => {
    process.stdout.write(`Private Chatroom server running at http://${host}:${port}\n`);
  });

  process.on('SIGTERM', async () => {
    await close();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    await close();
    process.exit(0);
  });
}