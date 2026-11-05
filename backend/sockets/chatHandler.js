/**
 * TeaRoom (Private Chatroom) - Socket Event Handler & Moderation Engine
 * Server relays opaque ciphertext only. Never logs or decrypts payloads.
 * @author Exe01jb (https://github.com/Exe01jb)
 * @license MIT
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOM_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const CREDENTIAL_USER_REGEX = /^[A-Za-z0-9_-]{2,24}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64_STRICT_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

function getStrictBase64ByteLength(str) {
  if (typeof str !== 'string' || str.length === 0 || str.length % 4 !== 0) {
    return null;
  }
  if (!BASE64_STRICT_REGEX.test(str)) {
    return null;
  }
  try {
    const buf = Buffer.from(str, 'base64');
    if (buf.toString('base64') !== str) {
      return null;
    }
    return buf.length;
  } catch {
    return null;
  }
}

function hashAuthToken(authToken) {
  return crypto.createHash('sha256').update(String(authToken)).digest();
}

class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.tokens = limit;
    this.lastRefill = Date.now();
  }

  tryConsume() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > this.windowMs) {
      this.tokens = this.limit;
      this.lastRefill = now;
    } else {
      const added = (elapsed / this.windowMs) * this.limit;
      this.tokens = Math.min(this.limit, this.tokens + added);
      this.lastRefill = now;
    }
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

export function setupChatHandlers(io, config = {}) {
  const {
    MAX_ROOM_SIZE = 20,
    MAX_MESSAGE_BYTES = 1048576,
    RATE_LIMIT_WINDOW_MS = 10000,
    RATE_LIMIT_MESSAGES = 15,
    RATE_LIMIT_JOINS = 5,
    TRUST_PROXY = false,
    INVITE_ONLY = false,
    STATE_FILE_PATH = '',
    verifyAdminToken = () => false,
  } = config;

  const ipMessageLimiters = new Map();

  const startTime = Date.now();
  let totalRelayedMessages = 0;
  let totalRelayedBytes = 0;
  let totalRateLimitBlocks = 0;
  let totalViolations = 0;

  const messageTimestamps = [];

  const activeSockets = new Map();
  const roomsMeta = new Map();
  const blockedIps = new Map();
  const invites = new Map();
  const roomVaults = new Map();

  function loadPersistedState() {
    if (!STATE_FILE_PATH) return;
    try {
      if (!fs.existsSync(STATE_FILE_PATH)) return;
      const raw = fs.readFileSync(STATE_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.blockedIps)) {
        for (const item of parsed.blockedIps) {
          if (item && typeof item.ip === 'string') {
            blockedIps.set(item.ip, {
              ip: item.ip,
              reason: item.reason || 'Administrative ban',
              blockedAt: item.blockedAt || Date.now(),
            });
          }
        }
      }
      if (Array.isArray(parsed.invites)) {
        for (const inv of parsed.invites) {
          if (inv && typeof inv.username === 'string' && typeof inv.authTokenHashBase64 === 'string') {
            invites.set(inv.username, {
              username: inv.username,
              room: inv.room,
              authTokenHash: Buffer.from(inv.authTokenHashBase64, 'base64'),
              envelope: inv.envelope,
              createdAt: inv.createdAt || Date.now(),
              lastUsedAt: inv.lastUsedAt || null,
              expiresAt: inv.expiresAt || null,
              maxUses: inv.maxUses || null,
              usedCount: inv.usedCount || 0,
              boundUserId: inv.boundUserId || null,
            });
          }
        }
      }
    } catch {
      // Fail safe without crashing if state file is unreadable
    }
  }

  function savePersistedState() {
    if (!STATE_FILE_PATH) return;
    try {
      const dir = path.dirname(STATE_FILE_PATH);
      fs.mkdirSync(dir, { recursive: true });
      const serializedInvites = Array.from(invites.values()).map((inv) => ({
        username: inv.username,
        room: inv.room,
        authTokenHashBase64: inv.authTokenHash.toString('base64'),
        envelope: inv.envelope,
        createdAt: inv.createdAt,
        lastUsedAt: inv.lastUsedAt,
        expiresAt: inv.expiresAt,
        maxUses: inv.maxUses,
        usedCount: inv.usedCount,
        boundUserId: inv.boundUserId || null,
      }));
      const payload = JSON.stringify(
        {
          v: 1,
          updatedAt: Date.now(),
          blockedIps: Array.from(blockedIps.values()),
          invites: serializedInvites,
        },
        null,
        2
      );
      const tmpPath = `${STATE_FILE_PATH}.tmp.${process.pid}`;
      fs.writeFileSync(tmpPath, payload, { mode: 0o600 });
      fs.renameSync(tmpPath, STATE_FILE_PATH);
    } catch {
      // Ignore write errors in read-only environments
    }
  }

  loadPersistedState();

  function getClientIp(socket) {
    if (TRUST_PROXY) {
      const headerIp = socket.handshake.headers['x-real-ip'];
      if (headerIp && typeof headerIp === 'string') {
        return headerIp.trim();
      }
    }
    return socket.handshake.address;
  }

  function getIpLimiter(ip) {
    let limiter = ipMessageLimiters.get(ip);
    if (!limiter) {
      limiter = new RateLimiter(RATE_LIMIT_MESSAGES, RATE_LIMIT_WINDOW_MS);
      ipMessageLimiters.set(ip, limiter);
    }
    return limiter;
  }

  function performRoomEviction(room, targetUserId, reason = 'MEMBER_EVICTED') {
    const meta = roomsMeta.get(room) || {
      createdAt: Date.now(),
      totalMessages: 0,
      lastActivity: Date.now(),
      epoch: 1,
      salt: crypto.randomBytes(16).toString('base64'),
      ownerSocketId: null,
      ownerInviteUsername: null,
    };
    const newEpoch = (meta.epoch || 1) + 1;
    meta.epoch = newEpoch;
    roomsMeta.set(room, meta);

    let evictedAny = false;
    for (const [sId, sData] of activeSockets.entries()) {
      if (sData.userId === targetUserId && sData.rooms.includes(room)) {
        const targetSocket = io.sockets.sockets.get(sId);
        if (targetSocket) {
          targetSocket.leave(room);
          targetSocket.emit('evicted', {
            v: 1,
            room,
            reason,
            epoch: newEpoch,
          });
          evictedAny = true;
        }
        if (sData.joinedRoomsSet) {
          sData.joinedRoomsSet.delete(room);
        }
        if (sData.authorizedRooms) {
          sData.authorizedRooms.delete(room);
        }
        sData.rooms = sData.rooms.filter((r) => r !== room);
        if (sData.room === room) {
          sData.room = sData.rooms.length > 0 ? sData.rooms[0] : null;
        }
      }
    }

    const roomObj = io.sockets.adapter.rooms.get(room);
    const remainingCount = roomObj ? roomObj.size : 0;

    io.to(room).emit('presence', {
      room,
      count: remainingCount,
    });

    io.to(room).emit('member_evicted', {
      v: 1,
      room,
      targetUserId,
      newEpoch,
      reason,
    });

    return { ok: true, evicted: evictedAny, newEpoch };
  }

  setInterval(() => {
    const now = Date.now();
    for (const [ip, limiter] of ipMessageLimiters.entries()) {
      if (now - limiter.lastRefill > RATE_LIMIT_WINDOW_MS * 2) {
        ipMessageLimiters.delete(ip);
      }
    }
    while (messageTimestamps.length > 0 && messageTimestamps[0] < now - 10000) {
      messageTimestamps.shift();
    }
  }, 2000).unref();

  io.on('connection', (socket) => {
    const clientIp = getClientIp(socket);

    if (blockedIps.has(clientIp)) {
      socket.emit('error', 'IP_BANNED');
      socket.disconnect(true);
      return;
    }

    const joinedRooms = new Set();
    const authorizedRooms = new Set();
    let violationCount = 0;

    activeSockets.set(socket.id, {
      id: socket.id,
      ip: clientIp,
      room: null,
      rooms: [],
      joinedRoomsSet: joinedRooms,
      authorizedRooms,
      connectedAt: Date.now(),
      messageCount: 0,
      violationCount: 0,
      userId: null,
      nickname: null,
      inviteUsername: null,
    });

    const messageLimiter = new RateLimiter(RATE_LIMIT_MESSAGES, RATE_LIMIT_WINDOW_MS);
    const joinLimiter = new RateLimiter(RATE_LIMIT_JOINS, RATE_LIMIT_WINDOW_MS);
    const auxLimiter = new RateLimiter(RATE_LIMIT_MESSAGES * 2, RATE_LIMIT_WINDOW_MS);

    function recordViolation() {
      violationCount++;
      totalViolations++;
      const s = activeSockets.get(socket.id);
      if (s) s.violationCount = violationCount;
      if (violationCount >= 5) {
        socket.disconnect(true);
      }
    }

    function safeAck(ack, response) {
      if (typeof ack === 'function') {
        try {
          ack(response);
        } catch {
          // ignore
        }
      }
    }

    function leaveRoom(roomToLeave) {
      if (!roomToLeave || !joinedRooms.has(roomToLeave)) return;
      socket.leave(roomToLeave);
      joinedRooms.delete(roomToLeave);

      const s = activeSockets.get(socket.id);
      if (s) {
        s.rooms = Array.from(joinedRooms);
        s.room = joinedRooms.size > 0 ? Array.from(joinedRooms)[0] : null;
      }

      const roomObj = io.sockets.adapter.rooms.get(roomToLeave);
      const remainingCount = roomObj ? roomObj.size : 0;

      io.to(roomToLeave).emit('presence', {
        room: roomToLeave,
        count: remainingCount,
      });

      if (s && s.userId) {
        socket.to(roomToLeave).emit('member_presence', {
          v: 1,
          room: roomToLeave,
          userId: s.userId,
          nickname: s.nickname || 'Someone',
          action: 'leave',
        });
        socket.to(roomToLeave).emit('typing', {
          v: 1,
          room: roomToLeave,
          isTyping: false,
          userId: s.userId,
        });
      }

      if (remainingCount === 0) {
        roomsMeta.delete(roomToLeave);
      }
    }

    function leaveAllRooms() {
      for (const r of Array.from(joinedRooms)) {
        leaveRoom(r);
      }
    }

    function validateInviteCredentials(username, authToken, requestedRoom = null, isReconnect = false) {
      if (typeof username !== 'string' || typeof authToken !== 'string') {
        return { ok: false, code: 'INVALID_CREDENTIALS' };
      }
      const cleanUser = username.trim();
      if (!CREDENTIAL_USER_REGEX.test(cleanUser)) {
        return { ok: false, code: 'INVALID_CREDENTIALS' };
      }
      const invite = invites.get(cleanUser);
      if (!invite) {
        return { ok: false, code: 'INVALID_CREDENTIALS' };
      }
      if (invite.expiresAt && Date.now() > invite.expiresAt) {
        invites.delete(cleanUser);
        savePersistedState();
        return { ok: false, code: 'INVITE_EXPIRED' };
      }
      const candidateHash = hashAuthToken(authToken.trim());
      if (
        candidateHash.length !== invite.authTokenHash.length ||
        !crypto.timingSafeEqual(candidateHash, invite.authTokenHash)
      ) {
        return { ok: false, code: 'INVALID_CREDENTIALS' };
      }
      if (!isReconnect && invite.maxUses && invite.usedCount >= invite.maxUses) {
        return { ok: false, code: 'INVITE_CONSUMED' };
      }
      if (requestedRoom && invite.room !== requestedRoom) {
        return { ok: false, code: 'INVITE_ROOM_MISMATCH' };
      }
      return { ok: true, invite, username: cleanUser };
    }

    socket.on('redeem_invite', (data, ack) => {
      if (!joinLimiter.tryConsume()) {
        totalRateLimitBlocks++;
        safeAck(ack, { ok: false, code: 'RATE_LIMITED' });
        return;
      }

      if (
        !data ||
        typeof data !== 'object' ||
        typeof data.username !== 'string' ||
        typeof data.authToken !== 'string'
      ) {
        recordViolation();
        safeAck(ack, { ok: false, code: 'INVALID_PAYLOAD' });
        return;
      }

      const requestedRoom = typeof data.room === 'string' ? data.room.trim() : null;
      const check = validateInviteCredentials(data.username, data.authToken, requestedRoom, false);
      if (!check.ok) {
        recordViolation();
        safeAck(ack, { ok: false, code: check.code });
        return;
      }

      const { invite, username } = check;
      const room = invite.room;
      const existingRoom = io.sockets.adapter.rooms.get(room);
      const currentCount = existingRoom ? existingRoom.size : 0;

      if (!joinedRooms.has(room) && currentCount >= MAX_ROOM_SIZE) {
        safeAck(ack, { ok: false, code: 'ROOM_FULL' });
        return;
      }

      const resolvedUserId =
        typeof data.userId === 'string' && data.userId.trim()
          ? data.userId.trim().slice(0, 32)
          : username;

      socket.join(room);
      joinedRooms.add(room);
      authorizedRooms.add(room);
      invite.lastUsedAt = Date.now();
      invite.usedCount = (invite.usedCount || 0) + 1;
      if (!invite.boundUserId) {
        invite.boundUserId = resolvedUserId;
      }
      savePersistedState();

      const s = activeSockets.get(socket.id);
      if (s) {
        s.rooms = Array.from(joinedRooms);
        s.room = room;
        s.inviteUsername = username;
        s.userId = resolvedUserId;
        s.nickname = username;
      }

      if (!roomsMeta.has(room)) {
        roomsMeta.set(room, {
          createdAt: Date.now(),
          totalMessages: 0,
          lastActivity: Date.now(),
          salt: crypto.randomBytes(16).toString('base64'),
          epoch: invite.envelope?.epoch || 1,
          ownerSocketId: socket.id,
          ownerInviteUsername: username,
        });
      }

      const meta = roomsMeta.get(room);
      const newRoom = io.sockets.adapter.rooms.get(room);
      const newCount = newRoom ? newRoom.size : 1;

      io.to(room).emit('presence', {
        room,
        count: newCount,
      });

      safeAck(ack, {
        ok: true,
        room,
        username,
        count: newCount,
        salt: meta.salt,
        epoch: meta.epoch || 1,
        envelope: invite.envelope,
        userEnvelope: invite.envelope,
      });
    });

    socket.on('join', (data, ack) => {
      if (!joinLimiter.tryConsume()) {
        totalRateLimitBlocks++;
        safeAck(ack, { ok: false, code: 'RATE_LIMITED' });
        return;
      }

      if (!data || typeof data !== 'object' || data.v !== 1 || typeof data.room !== 'string') {
        recordViolation();
        safeAck(ack, { ok: false, code: 'INVALID_PAYLOAD' });
        return;
      }

      const room = data.room.trim();
      if (!ROOM_REGEX.test(room)) {
        recordViolation();
        safeAck(ack, { ok: false, code: 'INVALID_ROOM' });
        return;
      }

      const s = activeSockets.get(socket.id);

      if (INVITE_ONLY) {
        let isAuthorizedForRoom = authorizedRooms.has(room);

        if (!isAuthorizedForRoom && data.username && data.authToken) {
          const check = validateInviteCredentials(data.username, data.authToken, room, true);
          if (!check.ok) {
            recordViolation();
            safeAck(ack, { ok: false, code: check.code });
            return;
          }
          check.invite.lastUsedAt = Date.now();
          savePersistedState();
          authorizedRooms.add(room);
          if (s) s.inviteUsername = check.username;
          isAuthorizedForRoom = true;
        }

        if (!isAuthorizedForRoom && room.startsWith('dm-') && s && s.inviteUsername) {
          if (invites.has(s.inviteUsername)) {
            isAuthorizedForRoom = true;
          }
        }

        if (isAuthorizedForRoom && s && s.inviteUsername && !invites.has(s.inviteUsername)) {
          authorizedRooms.delete(room);
          isAuthorizedForRoom = false;
        }

        if (!isAuthorizedForRoom) {
          recordViolation();
          safeAck(ack, { ok: false, code: 'INVITE_REQUIRED' });
          return;
        }
      }

      const existingRoom = io.sockets.adapter.rooms.get(room);
      const currentCount = existingRoom ? existingRoom.size : 0;

      if (s) {
        if (typeof data.userId === 'string' && data.userId.trim()) {
          s.userId = data.userId.trim().slice(0, 32);
        }
        if (typeof data.nickname === 'string' && data.nickname.trim()) {
          s.nickname = data.nickname.trim().slice(0, 24);
        }
      }

      if (joinedRooms.has(room)) {
        const existingMeta = roomsMeta.get(room);
        safeAck(ack, {
          ok: true,
          count: currentCount,
          salt: existingMeta?.salt,
          epoch: existingMeta?.epoch || 1,
        });
        return;
      }

      if (joinedRooms.size >= 25) {
        safeAck(ack, { ok: false, code: 'TOO_MANY_ROOMS' });
        return;
      }

      if (currentCount >= MAX_ROOM_SIZE) {
        safeAck(ack, { ok: false, code: 'ROOM_FULL' });
        return;
      }

      socket.join(room);
      joinedRooms.add(room);

      if (s) {
        s.rooms = Array.from(joinedRooms);
        s.room = room;
      }

      if (!roomsMeta.has(room)) {
        const clientSalt =
          typeof data.salt === 'string' && getStrictBase64ByteLength(data.salt) === 16
            ? data.salt
            : crypto.randomBytes(16).toString('base64');

        roomsMeta.set(room, {
          createdAt: Date.now(),
          totalMessages: 0,
          lastActivity: Date.now(),
          salt: clientSalt,
          epoch: 1,
          ownerSocketId: socket.id,
          ownerInviteUsername: s?.inviteUsername || null,
        });
      }

      const meta = roomsMeta.get(room);
      const newRoom = io.sockets.adapter.rooms.get(room);
      const newCount = newRoom ? newRoom.size : 1;

      io.to(room).emit('presence', {
        room,
        count: newCount,
      });

      safeAck(ack, {
        ok: true,
        count: newCount,
        salt: meta.salt,
        epoch: meta.epoch || 1,
      });
    });

    socket.on('evict_member', (payload, ack) => {
      if (!joinLimiter.tryConsume()) {
        totalRateLimitBlocks++;
        safeAck(ack, { ok: false, code: 'RATE_LIMITED' });
        return;
      }

      if (
        !payload ||
        typeof payload !== 'object' ||
        payload.v !== 1 ||
        typeof payload.room !== 'string' ||
        typeof payload.targetUserId !== 'string'
      ) {
        recordViolation();
        safeAck(ack, { ok: false, code: 'INVALID_PAYLOAD' });
        return;
      }

      const room = payload.room.trim();
      const hasValidAdminToken =
        typeof payload.adminToken === 'string' && verifyAdminToken(payload.adminToken);

      if (!joinedRooms.has(room) && !hasValidAdminToken) {
        safeAck(ack, { ok: false, code: 'NOT_IN_ROOM' });
        return;
      }

      // Strict server-side ownership check:
      // Never trust client-supplied userId or isAdmin flags for eviction authorization.
      // Only the creator's socketId, their server-authenticated inviteUsername, or a valid
      // server-issued admin session token is authorized to evict a room member.
      const meta = roomsMeta.get(room);
      const s = activeSockets.get(socket.id);
      const isRoomOwner =
        Boolean(meta) &&
        (meta.ownerSocketId === socket.id ||
          (Boolean(meta.ownerInviteUsername) &&
            Boolean(s?.inviteUsername) &&
            meta.ownerInviteUsername === s.inviteUsername));

      if (!isRoomOwner && !hasValidAdminToken) {
        recordViolation();
        safeAck(ack, { ok: false, code: 'FORBIDDEN' });
        return;
      }

      const targetUserId = payload.targetUserId.trim();
      const result = performRoomEviction(room, targetUserId, payload.reason || 'MEMBER_EVICTED');
      safeAck(ack, result);
    });

    socket.on('announce_presence', (payload) => {
      if (!auxLimiter.tryConsume()) return;
      if (!payload || typeof payload !== 'object' || payload.v !== 1 || typeof payload.room !== 'string')
        return;
      if (!ROOM_REGEX.test(payload.room)) return;
      if (!joinedRooms.has(payload.room)) return;

      const userId = typeof payload.userId === 'string' ? payload.userId.slice(0, 32) : null;
      const nickname =
        typeof payload.nickname === 'string' ? payload.nickname.slice(0, 24) : 'Someone';

      const s = activeSockets.get(socket.id);
      if (s) {
        if (userId) s.userId = userId;
        if (nickname) s.nickname = nickname;
      }

      socket.to(payload.room).emit('member_presence', {
        v: 1,
        room: payload.room,
        userId,
        nickname,
        action: 'join',
      });
    });

    socket.on('request_presence', (payload) => {
      if (!auxLimiter.tryConsume()) return;
      if (!payload || typeof payload !== 'object' || payload.v !== 1 || typeof payload.room !== 'string')
        return;
      if (!ROOM_REGEX.test(payload.room)) return;
      if (!joinedRooms.has(payload.room)) return;

      socket.to(payload.room).emit('request_presence', {
        v: 1,
        room: payload.room,
      });
    });

    socket.on('dm_invite', (payload, ack) => {
      if (!joinLimiter.tryConsume()) {
        totalRateLimitBlocks++;
        safeAck(ack, { ok: false, code: 'RATE_LIMITED' });
        return;
      }

      if (
        !payload ||
        typeof payload !== 'object' ||
        payload.v !== 1 ||
        typeof payload.targetUserId !== 'string' ||
        typeof payload.room !== 'string'
      ) {
        safeAck(ack, { ok: false, code: 'INVALID_PAYLOAD' });
        return;
      }

      if (!ROOM_REGEX.test(payload.room)) {
        safeAck(ack, { ok: false, code: 'INVALID_ROOM' });
        return;
      }

      const targetUserId = payload.targetUserId.trim().slice(0, 32);
      const fromUserId =
        typeof payload.fromUserId === 'string' ? payload.fromUserId.slice(0, 32) : '';
      const fromNickname =
        typeof payload.fromNickname === 'string' ? payload.fromNickname.slice(0, 24) : 'Someone';

      let delivered = false;
      const roomObj = io.sockets.adapter.rooms.get(payload.room);

      for (const [sId, sMeta] of activeSockets.entries()) {
        if (sMeta.userId === targetUserId) {
          const isTargetInRoom =
            (roomObj && roomObj.has(sId)) ||
            (sMeta.joinedRoomsSet && sMeta.joinedRoomsSet.has(payload.room)) ||
            (Array.isArray(sMeta.rooms) && sMeta.rooms.includes(payload.room));
          if (isTargetInRoom) {
            continue;
          }

          const targetSock = io.sockets.sockets.get(sId);
          if (targetSock) {
            targetSock.emit('dm_invite', {
              v: 1,
              fromUserId,
              fromNickname,
              room: payload.room,
            });
            delivered = true;
          }
        }
      }

      safeAck(ack, { ok: true, delivered });
    });

    socket.on('message', (payload, ack) => {
      if (!messageLimiter.tryConsume()) {
        totalRateLimitBlocks++;
        safeAck(ack, { ok: false, code: 'RATE_LIMITED' });
        return;
      }

      const ipLimiter = getIpLimiter(clientIp);
      if (!ipLimiter.tryConsume()) {
        totalRateLimitBlocks++;
        safeAck(ack, { ok: false, code: 'RATE_LIMITED' });
        return;
      }

      if (
        !payload ||
        typeof payload !== 'object' ||
        payload.v !== 1 ||
        typeof payload.id !== 'string' ||
        typeof payload.room !== 'string' ||
        typeof payload.iv !== 'string' ||
        typeof payload.ct !== 'string'
      ) {
        recordViolation();
        safeAck(ack, { ok: false, code: 'INVALID_PAYLOAD' });
        return;
      }

      if (!ROOM_REGEX.test(payload.room)) {
        recordViolation();
        safeAck(ack, { ok: false, code: 'INVALID_ROOM' });
        return;
      }

      if (!joinedRooms.has(payload.room)) {
        recordViolation();
        safeAck(ack, { ok: false, code: 'NOT_IN_ROOM' });
        return;
      }

      if (!UUID_REGEX.test(payload.id)) {
        recordViolation();
        safeAck(ack, { ok: false, code: 'INVALID_PAYLOAD' });
        return;
      }

      const ivByteLength = getStrictBase64ByteLength(payload.iv);
      if (ivByteLength !== 12) {
        recordViolation();
        safeAck(ack, { ok: false, code: 'INVALID_PAYLOAD' });
        return;
      }

      const ctByteLength = getStrictBase64ByteLength(payload.ct);
      if (ctByteLength === null || ctByteLength < 16) {
        recordViolation();
        safeAck(ack, { ok: false, code: 'INVALID_PAYLOAD' });
        return;
      }

      if (ctByteLength > MAX_MESSAGE_BYTES + 1024) {
        safeAck(ack, { ok: false, code: 'TOO_LARGE' });
        return;
      }

      const now = Date.now();
      totalRelayedMessages++;
      totalRelayedBytes += ctByteLength;
      messageTimestamps.push(now);

      const s = activeSockets.get(socket.id);
      if (s) s.messageCount++;

      const r = roomsMeta.get(payload.room);
      if (r) {
        r.totalMessages++;
        r.lastActivity = now;
      }

      socket.to(payload.room).emit('message', {
        v: 1,
        id: payload.id,
        room: payload.room,
        iv: payload.iv,
        ct: payload.ct,
        serverTime: now,
      });

      const roomSockets = io.sockets.adapter.rooms.get(payload.room);
      const recipientCount = roomSockets ? Math.max(0, roomSockets.size - 1) : 0;
      const delivered = recipientCount > 0;

      safeAck(ack, { ok: true, delivered, recipientCount });
    });

    socket.on('delivery', (payload, ack) => {
      if (
        !payload ||
        typeof payload !== 'object' ||
        payload.v !== 1 ||
        typeof payload.id !== 'string' ||
        typeof payload.room !== 'string'
      ) {
        safeAck(ack, { ok: false, code: 'INVALID_PAYLOAD' });
        return;
      }
      if (!ROOM_REGEX.test(payload.room)) {
        safeAck(ack, { ok: false, code: 'INVALID_ROOM' });
        return;
      }
      if (!joinedRooms.has(payload.room)) {
        safeAck(ack, { ok: false, code: 'NOT_IN_ROOM' });
        return;
      }
      if (!UUID_REGEX.test(payload.id)) {
        safeAck(ack, { ok: false, code: 'INVALID_PAYLOAD' });
        return;
      }

      socket.to(payload.room).emit('delivery', {
        v: 1,
        id: payload.id,
        room: payload.room,
        recipientId:
          typeof payload.recipientId === 'string' ? payload.recipientId.slice(0, 32) : null,
        deliveredAt: Date.now(),
      });
      safeAck(ack, { ok: true });
    });

    socket.on('receipt', (payload, ack) => {
      if (
        !payload ||
        typeof payload !== 'object' ||
        payload.v !== 1 ||
        typeof payload.id !== 'string' ||
        typeof payload.room !== 'string'
      ) {
        safeAck(ack, { ok: false, code: 'INVALID_PAYLOAD' });
        return;
      }
      if (!ROOM_REGEX.test(payload.room)) {
        safeAck(ack, { ok: false, code: 'INVALID_ROOM' });
        return;
      }
      if (!joinedRooms.has(payload.room)) {
        safeAck(ack, { ok: false, code: 'NOT_IN_ROOM' });
        return;
      }
      if (!UUID_REGEX.test(payload.id)) {
        safeAck(ack, { ok: false, code: 'INVALID_PAYLOAD' });
        return;
      }

      socket.to(payload.room).emit('receipt', {
        v: 1,
        id: payload.id,
        room: payload.room,
        readerId: typeof payload.readerId === 'string' ? payload.readerId.slice(0, 32) : null,
        readAt: Date.now(),
      });
      safeAck(ack, { ok: true });
    });

    socket.on('reaction', (payload, ack) => {
      if (!auxLimiter.tryConsume()) {
        totalRateLimitBlocks++;
        safeAck(ack, { ok: false, code: 'RATE_LIMITED' });
        return;
      }

      if (
        !payload ||
        typeof payload !== 'object' ||
        payload.v !== 1 ||
        typeof payload.room !== 'string' ||
        typeof payload.targetMessageId !== 'string' ||
        typeof payload.iv !== 'string' ||
        typeof payload.ct !== 'string'
      ) {
        recordViolation();
        safeAck(ack, { ok: false, code: 'INVALID_PAYLOAD' });
        return;
      }

      if (!ROOM_REGEX.test(payload.room)) {
        recordViolation();
        safeAck(ack, { ok: false, code: 'INVALID_ROOM' });
        return;
      }

      if (!joinedRooms.has(payload.room)) {
        recordViolation();
        safeAck(ack, { ok: false, code: 'NOT_IN_ROOM' });
        return;
      }

      if (!UUID_REGEX.test(payload.targetMessageId)) {
        recordViolation();
        safeAck(ack, { ok: false, code: 'INVALID_PAYLOAD' });
        return;
      }

      const ivByteLength = getStrictBase64ByteLength(payload.iv);
      if (ivByteLength !== 12) {
        recordViolation();
        safeAck(ack, { ok: false, code: 'INVALID_PAYLOAD' });
        return;
      }

      const ctByteLength = getStrictBase64ByteLength(payload.ct);
      if (ctByteLength === null || ctByteLength < 16 || ctByteLength > 8192) {
        recordViolation();
        safeAck(ack, { ok: false, code: 'INVALID_PAYLOAD' });
        return;
      }

      socket.to(payload.room).emit('reaction', {
        v: 1,
        room: payload.room,
        targetMessageId: payload.targetMessageId,
        iv: payload.iv,
        ct: payload.ct,
        serverTime: Date.now(),
      });

      safeAck(ack, { ok: true });
    });

    socket.on('typing', (payload) => {
      if (!auxLimiter.tryConsume()) {
        totalRateLimitBlocks++;
        return;
      }

      if (
        !payload ||
        typeof payload !== 'object' ||
        payload.v !== 1 ||
        typeof payload.room !== 'string'
      ) {
        return;
      }
      if (!ROOM_REGEX.test(payload.room)) return;
      if (!joinedRooms.has(payload.room)) return;

      const outbound = {
        v: 1,
        room: payload.room,
      };

      if (typeof payload.ciphertext === 'string' && typeof payload.iv === 'string') {
        outbound.ciphertext = payload.ciphertext.slice(0, 2048);
        outbound.iv = payload.iv.slice(0, 64);
        if (typeof payload.ttl === 'number') {
          outbound.ttl = Math.min(Math.max(500, Math.round(payload.ttl)), 5000);
        }
        if (typeof payload.signalId === 'string') {
          outbound.signalId = payload.signalId.slice(0, 64);
        }
      } else {
        outbound.isTyping = Boolean(payload.isTyping);
        outbound.userId = typeof payload.userId === 'string' ? payload.userId.slice(0, 32) : null;
        outbound.nickname =
          typeof payload.nickname === 'string' ? payload.nickname.slice(0, 24) : 'Someone';
      }

      socket.to(payload.room).emit('typing', outbound);
    });

    socket.on('leave', (data) => {
      if (data && typeof data.room === 'string') {
        leaveRoom(data.room.trim());
      } else {
        leaveAllRooms();
      }
    });

    socket.on('disconnect', () => {
      leaveAllRooms();
      activeSockets.delete(socket.id);
    });
  });

  return {
    getOverview: () => {
      const now = Date.now();
      const windowCutoff = now - 5000;
      const recentCount = messageTimestamps.filter((ts) => ts >= windowCutoff).length;
      const currentRate = Math.round((recentCount / 5) * 10) / 10;

      const rooms = [];
      for (const [roomName, meta] of roomsMeta.entries()) {
        const roomObj = io.sockets.adapter.rooms.get(roomName);
        const memberCount = roomObj ? roomObj.size : 0;
        if (memberCount > 0) {
          rooms.push({
            name: roomName,
            memberCount,
            totalMessages: meta.totalMessages,
            createdAt: meta.createdAt,
            lastActivity: meta.lastActivity,
            epoch: meta.epoch || 1,
          });
        }
      }

      return {
        uptimeSeconds: Math.floor((now - startTime) / 1000),
        activeConnectionsCount: activeSockets.size,
        activeRoomsCount: rooms.length,
        totalRelayedMessages,
        totalRelayedBytes,
        currentMessageRate: currentRate,
        totalRateLimitBlocks,
        totalViolations,
        rooms,
        blockedIpsCount: blockedIps.size,
        activeInvitesCount: invites.size,
      };
    },
    getConnections: () => {
      const list = [];
      for (const [id, s] of activeSockets.entries()) {
        list.push({
          id,
          ip: s.ip,
          room: s.room,
          username: s.inviteUsername || s.nickname || null,
          connectedAt: s.connectedAt,
          messageCount: s.messageCount,
          violationCount: s.violationCount,
        });
      }
      return list;
    },
    createInvite: (payload = {}) => {
      const rawUser = typeof payload.username === 'string' ? payload.username.trim() : '';
      const rawEnvelope = payload.envelope || payload.userEnvelope;
      const rawRoom =
        typeof payload.room === 'string' && payload.room.trim()
          ? payload.room.trim()
          : typeof rawEnvelope?.room === 'string'
          ? rawEnvelope.room.trim()
          : '';
      const rawAuthToken =
        typeof payload.authToken === 'string' ? payload.authToken.trim() : '';

      if (!CREDENTIAL_USER_REGEX.test(rawUser)) {
        return { ok: false, error: 'Username must be 2 to 24 alphanumeric characters.' };
      }
      if (!ROOM_REGEX.test(rawRoom)) {
        return {
          ok: false,
          error: 'Room name must be 1 to 64 alphanumeric characters, dashes, or underscores.',
        };
      }
      if (!rawAuthToken) {
        return { ok: false, error: 'Missing authentication token.' };
      }
      if (
        !rawEnvelope ||
        typeof rawEnvelope !== 'object' ||
        !rawEnvelope.ct ||
        !rawEnvelope.iv ||
        !rawEnvelope.salt
      ) {
        return { ok: false, error: 'Missing encrypted key envelope.' };
      }

      if (payload.adminEnvelope && typeof payload.adminEnvelope === 'object') {
        roomVaults.set(rawRoom, {
          room: rawRoom,
          epoch: Number(payload.epoch || rawEnvelope.epoch || 1),
          adminEnvelope: payload.adminEnvelope,
          createdAt: roomVaults.get(rawRoom)?.createdAt || Date.now(),
          updatedAt: Date.now(),
        });
      }

      const expiresAt =
        typeof payload.expiresAt === 'number' && payload.expiresAt > Date.now()
          ? payload.expiresAt
          : null;
      const maxUses =
        typeof payload.maxUses === 'number' && payload.maxUses > 0
          ? Math.round(payload.maxUses)
          : null;

      invites.set(rawUser, {
        username: rawUser,
        room: rawRoom,
        authTokenHash: hashAuthToken(rawAuthToken),
        envelope: {
          v: 2,
          room: rawRoom,
          epoch: Number(rawEnvelope.epoch || payload.epoch || 1),
          salt: String(rawEnvelope.salt),
          iv: String(rawEnvelope.iv),
          ct: String(rawEnvelope.ct),
          iterations: Number(rawEnvelope.iterations || 600000),
        },
        createdAt: Date.now(),
        lastUsedAt: null,
        expiresAt,
        maxUses,
        usedCount: 0,
        boundUserId: null,
      });

      savePersistedState();
      return { ok: true, username: rawUser, room: rawRoom };
    },
    listInvites: () => {
      const activeUsers = new Set();
      for (const s of activeSockets.values()) {
        if (s.inviteUsername) activeUsers.add(s.inviteUsername);
      }
      const list = [];
      for (const inv of invites.values()) {
        list.push({
          username: inv.username,
          room: inv.room,
          epoch: inv.envelope?.epoch || 1,
          createdAt: inv.createdAt,
          lastUsedAt: inv.lastUsedAt,
          expiresAt: inv.expiresAt || null,
          maxUses: inv.maxUses || null,
          usedCount: inv.usedCount || 0,
          isOnline: activeUsers.has(inv.username),
        });
      }
      return list.sort((a, b) => b.createdAt - a.createdAt);
    },
    revokeInvite: (username) => {
      if (typeof username !== 'string') return false;
      const cleanUser = username.trim();
      const existing = invites.get(cleanUser);
      if (!existing) return false;

      invites.delete(cleanUser);
      savePersistedState();

      for (const [socketId, s] of activeSockets.entries()) {
        if (
          s.inviteUsername === cleanUser ||
          s.nickname === cleanUser ||
          s.userId === cleanUser
        ) {
          const sock = io.sockets.sockets.get(socketId);
          if (sock) {
            sock.emit('evicted', {
              v: 1,
              room: existing.room,
              reason: 'INVITE_REVOKED_BY_ADMIN',
            });
            sock.disconnect(true);
          }
          activeSockets.delete(socketId);
        }
      }
      return true;
    },
    evictRoomMember: (roomName, targetUserId, reason = 'ADMIN_EVICTION') => {
      return performRoomEviction(roomName, targetUserId, reason);
    },
    terminateRoom: (roomName) => {
      const roomObj = io.sockets.adapter.rooms.get(roomName);
      if (!roomObj) return false;

      io.to(roomName).emit('room_terminated', {
        room: roomName,
        reason: 'This room was terminated by system administrator moderation.',
      });

      for (const socketId of Array.from(roomObj)) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.leave(roomName);
        }
        const s = activeSockets.get(socketId);
        if (s) {
          if (s.joinedRoomsSet) {
            s.joinedRoomsSet.delete(roomName);
          }
          if (s.authorizedRooms) {
            s.authorizedRooms.delete(roomName);
          }
          if (Array.isArray(s.rooms)) {
            s.rooms = s.rooms.filter((r) => r !== roomName);
          }
          if (s.room === roomName) {
            s.room = s.rooms && s.rooms.length > 0 ? s.rooms[0] : null;
          }
        }
      }

      roomsMeta.delete(roomName);
      roomVaults.delete(roomName);
      return true;
    },
    disconnectSocket: (socketId) => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.disconnect(true);
        activeSockets.delete(socketId);
        return true;
      }
      return false;
    },
    blockIp: (ip, reason = 'Administrative ban') => {
      if (!ip || typeof ip !== 'string') return false;
      const cleanIp = ip.trim();
      blockedIps.set(cleanIp, {
        ip: cleanIp,
        reason,
        blockedAt: Date.now(),
      });
      savePersistedState();

      for (const [socketId, s] of activeSockets.entries()) {
        if (s.ip === cleanIp) {
          const socket = io.sockets.sockets.get(socketId);
          if (socket) {
            socket.emit('error', 'IP_BANNED');
            socket.disconnect(true);
          }
          activeSockets.delete(socketId);
        }
      }
      return true;
    },
    unblockIp: (ip) => {
      if (!ip || typeof ip !== 'string') return false;
      const deleted = blockedIps.delete(ip.trim());
      if (deleted) savePersistedState();
      return deleted;
    },
    getBlockedIps: () => {
      return Array.from(blockedIps.values());
    },
    isIpBlocked: (ip) => {
      return blockedIps.has(ip);
    },
  };
}