/**
 * TeaRoom (Private Chatroom) - Protocol v1/v2 Web Crypto Utilities
 * Client-side AES-256-GCM encryption, PBKDF2-HMAC-SHA256 (600k iterations),
 * ECDSA P-256 sender authentication, and Zero-Knowledge Admin-Invite Key Envelopes.
 * @author Exe01jb (https://github.com/Exe01jb)
 * @license MIT
 */

export const USERNAME_CREDENTIAL_REGEX = /^[A-Za-z0-9_-]{2,24}$/;
export const TEN_CHAR_CREDENTIAL_REGEX = /^[A-Za-z0-9]{10}$/;
const ALPHANUMERIC_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function getCrypto() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    return globalThis.crypto;
  }
  throw new Error('Web Crypto API is not available in this environment');
}

export function bytesToBase64(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

export function base64ToBytes(base64) {
  if (typeof base64 !== 'string' || base64.length === 0 || base64.length % 4 !== 0) {
    throw new Error('INVALID_BASE64');
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('INVALID_BASE64');
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function generateRandomSalt(length = 16) {
  const cryptoObj = getCrypto();
  const bytes = cryptoObj.getRandomValues(new Uint8Array(length));
  return {
    bytes,
    base64: bytesToBase64(bytes),
  };
}

/**
 * Generates a cryptographically random 10-character alphanumeric credential (unbiased rejection sampling).
 */
export function generateTenCharCredential(length = 10) {
  const cryptoObj = getCrypto();
  const charsetLen = ALPHANUMERIC_CHARS.length;
  const maxValidByte = 256 - (256 % charsetLen);
  let result = '';
  while (result.length < length) {
    const randomBytes = cryptoObj.getRandomValues(new Uint8Array(length * 2));
    for (let i = 0; i < randomBytes.length && result.length < length; i++) {
      if (randomBytes[i] < maxValidByte) {
        result += ALPHANUMERIC_CHARS[randomBytes[i] % charsetLen];
      }
    }
  }
  return result;
}

export const generateCredential10 = generateTenCharCredential;

/**
 * Computes a domain-separated one-way SHA-256 authentication token from username & password.
 * Sent to the relay server to redeem an invite without revealing the password or encryption key.
 */
export async function computeInviteAuthToken({ username, password }) {
  const cryptoObj = getCrypto();
  if (typeof username !== 'string' || !USERNAME_CREDENTIAL_REGEX.test(username.trim())) {
    throw new Error('Username must be 2 to 24 alphanumeric characters');
  }
  if (typeof password !== 'string' || password.length < 10) {
    throw new Error('Password must be at least 10 characters');
  }
  const normUser = username.trim().normalize('NFKC');
  const normPass = password.normalize('NFKC');
  const preimage = new TextEncoder().encode(`pcr/v2/invite-auth/${normUser}:${normPass}`);
  const digest = await cryptoObj.subtle.digest('SHA-256', preimage);
  return bytesToBase64(new Uint8Array(digest));
}

/**
 * Generates a fresh 256-bit (32-byte) cryptographically random master key for a room vault.
 */
export function generateRawRoomKeyBytes() {
  const cryptoObj = getCrypto();
  const bytes = cryptoObj.getRandomValues(new Uint8Array(32));
  return {
    bytes,
    base64: bytesToBase64(bytes),
  };
}

/**
 * Derives a deterministic 256-bit (32-byte) Room Master Key from a dedicated client-side
 * vault passphrase (distinct from the backend ADMIN_SECRET).
 */
export async function deriveAdminRoomMasterKey({
  vaultSecret,
  adminSecret,
  room,
  epoch = 1,
  iterations = 600000,
}) {
  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;
  const cleanRoom = String(room || '').trim();
  const effectiveSecret = String(vaultSecret || adminSecret || '').trim();
  if (!cleanRoom) throw new Error('Room name is required');
  if (!effectiveSecret) throw new Error('Client-side vault secret is required');

  const seedBytes = new TextEncoder().encode(
    `pcr/v2/admin-master-seed/${effectiveSecret.normalize('NFKC')}`
  );
  const saltInput = new TextEncoder().encode(`pcr/v2/admin-room-salt/${cleanRoom}/epoch-${epoch}`);
  const saltBuffer = await subtle.digest('SHA-256', saltInput);

  const baseKey = await subtle.importKey('raw', seedBytes, 'PBKDF2', false, ['deriveBits']);
  const derivedBits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(saltBuffer),
      iterations: Math.min(1000000, Math.max(300000, Number(iterations) || 600000)),
      hash: 'SHA-256',
    },
    baseKey,
    256
  );

  return bytesToBase64(new Uint8Array(derivedBits));
}

/**
 * Wraps (encrypts) a 256-bit Room Master Key inside an AES-256-GCM envelope
 * locked by the user's invite username and 10-character password.
 */
export async function createEncryptedInviteEnvelope({
  username,
  password,
  room,
  masterKeyBase64,
  epoch = 1,
  iterations = 600000,
}) {
  const cleanUser = String(username || '').trim();
  const cleanRoom = String(room || '').trim();

  if (!USERNAME_CREDENTIAL_REGEX.test(cleanUser)) {
    throw new Error('Username must be 2 to 24 alphanumeric characters');
  }
  if (typeof password !== 'string' || password.length < 10) {
    throw new Error('Password must be at least 10 characters');
  }
  if (!cleanRoom) {
    throw new Error('Target room name is required');
  }
  if (!masterKeyBase64 || base64ToBytes(masterKeyBase64).byteLength !== 32) {
    throw new Error('Valid 256-bit room master key is required');
  }

  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;

  const iterNum = Math.min(1000000, Math.max(300000, Number(iterations) || 600000));
  const wrapSaltBytes = cryptoObj.getRandomValues(new Uint8Array(16));
  const wrapIvBytes = cryptoObj.getRandomValues(new Uint8Array(12));
  const wrapSaltB64 = bytesToBase64(wrapSaltBytes);
  const wrapIvB64 = bytesToBase64(wrapIvBytes);

  const domainSaltInput = new TextEncoder().encode(
    `pcr/v2/invite-wrap/${cleanRoom}/${cleanUser}/${wrapSaltB64}`
  );
  const domainSaltBuf = await subtle.digest('SHA-256', domainSaltInput);

  const passBytes = new TextEncoder().encode(password.normalize('NFKC'));
  const baseKey = await subtle.importKey('raw', passBytes, 'PBKDF2', false, ['deriveKey']);

  const wrappingKey = await subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(domainSaltBuf),
      iterations: iterNum,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const aad = new TextEncoder().encode(`pcr|v2|envelope|${cleanRoom}|${cleanUser}`);
  const innerPlaintext = JSON.stringify({
    v: 2,
    room: cleanRoom,
    username: cleanUser,
    masterKey: masterKeyBase64,
    epoch: Number(epoch || 1),
    createdAt: Date.now(),
  });

  const cipherBuf = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: wrapIvBytes,
      additionalData: aad,
      tagLength: 128,
    },
    wrappingKey,
    new TextEncoder().encode(innerPlaintext)
  );

  const authToken = await computeInviteAuthToken({ username: cleanUser, password });

  return {
    username: cleanUser,
    room: cleanRoom,
    authToken,
    envelope: {
      v: 2,
      room: cleanRoom,
      epoch: Number(epoch || 1),
      salt: wrapSaltB64,
      iv: wrapIvB64,
      ct: bytesToBase64(new Uint8Array(cipherBuf)),
      iterations: iterNum,
    },
  };
}

/**
 * Unwraps an Admin-created encrypted key envelope using the user's username and password,
 * returning a non-extractable 256-bit AES-GCM CryptoKey.
 * Supports both v2 JSON envelopes and raw 32-byte wrapped key envelopes for backward compatibility.
 */
export async function unwrapInviteEnvelope({
  username,
  password,
  envelope,
  room: fallbackRoom,
  iterations = 600000,
}) {
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    typeof envelope.salt !== 'string' ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.ct !== 'string'
  ) {
    throw new Error('INVALID_INVITE_ENVELOPE');
  }

  const cleanUser = String(username || '').trim();
  const cleanRoom = String(envelope.room || fallbackRoom || '').trim();

  if (!USERNAME_CREDENTIAL_REGEX.test(cleanUser) || typeof password !== 'string' || password.length < 10) {
    throw new Error('Invalid invite credentials');
  }

  const iterNum = Math.min(
    1000000,
    Math.max(300000, Number(envelope.iterations || iterations) || 600000)
  );

  // If the envelope was created with wrapRoomKeyEnvelope (raw 32-byte key format), support it seamlessly
  if (!envelope.room && fallbackRoom) {
    const unwrappedRaw = await unwrapRoomKeyEnvelope({
      envelope,
      secret: password,
      contextId: `user:${cleanUser}:room:${cleanRoom}`,
      extractable: false,
    });
    return {
      key: unwrappedRaw.cryptoKey,
      room: cleanRoom,
      username: cleanUser,
      epoch: Number(envelope.epoch || 1),
    };
  }

  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;

  const domainSaltInput = new TextEncoder().encode(
    `pcr/v2/invite-wrap/${cleanRoom}/${cleanUser}/${envelope.salt}`
  );
  const domainSaltBuf = await subtle.digest('SHA-256', domainSaltInput);

  const passBytes = new TextEncoder().encode(password.normalize('NFKC'));
  const baseKey = await subtle.importKey('raw', passBytes, 'PBKDF2', false, ['deriveKey']);

  const unwrappingKey = await subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(domainSaltBuf),
      iterations: iterNum,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const aad = new TextEncoder().encode(`pcr|v2|envelope|${cleanRoom}|${cleanUser}`);
  const ivBytes = base64ToBytes(envelope.iv);
  const ctBytes = base64ToBytes(envelope.ct);

  const plainBuf = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes,
      additionalData: aad,
      tagLength: 128,
    },
    unwrappingKey,
    ctBytes
  );

  const parsed = JSON.parse(new TextDecoder().decode(plainBuf));
  if (!parsed || parsed.room !== cleanRoom || parsed.username !== cleanUser || !parsed.masterKey) {
    throw new Error('CORRUPT_INVITE_ENVELOPE');
  }

  const rawMasterKey = base64ToBytes(parsed.masterKey);
  if (rawMasterKey.byteLength !== 32) {
    throw new Error('INVALID_MASTER_KEY_LENGTH');
  }

  const roomCryptoKey = await subtle.importKey(
    'raw',
    rawMasterKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  rawMasterKey.fill(0);

  return {
    key: roomCryptoKey,
    room: cleanRoom,
    username: cleanUser,
    epoch: Number(parsed.epoch || envelope.epoch || 1),
  };
}

export async function wrapRoomKeyEnvelope({
  rawKeyBytes,
  secret,
  contextId,
  iterations = 600000,
}) {
  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;
  if (typeof secret !== 'string' || secret.length < 10) {
    throw new Error('Wrapping secret must be at least 10 characters');
  }
  if (!contextId || typeof contextId !== 'string') {
    throw new Error('Missing envelope contextId');
  }

  const keyBytes =
    typeof rawKeyBytes === 'string' ? base64ToBytes(rawKeyBytes) : new Uint8Array(rawKeyBytes);
  if (keyBytes.byteLength !== 32) {
    throw new Error('Room master key must be exactly 32 bytes (256 bits)');
  }

  const iterNum = Math.min(1000000, Math.max(300000, Number(iterations) || 600000));
  const randomSalt = cryptoObj.getRandomValues(new Uint8Array(16));
  const iv = cryptoObj.getRandomValues(new Uint8Array(12));

  const enc = new TextEncoder();
  const normSecret = secret.normalize('NFKC');
  const saltPreimage = enc.encode(
    `pcr/v2/envelope-salt/${contextId}/${bytesToBase64(randomSalt)}`
  );
  const domainSaltBuf = await subtle.digest('SHA-256', saltPreimage);

  const baseKey = await subtle.importKey(
    'raw',
    enc.encode(normSecret),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const wrappingKey = await subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(domainSaltBuf),
      iterations: iterNum,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const aad = enc.encode(`pcr|v2|env|${contextId}`);
  const cipherBuffer = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: aad,
      tagLength: 128,
    },
    wrappingKey,
    keyBytes
  );

  return {
    v: 2,
    salt: bytesToBase64(randomSalt),
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(cipherBuffer)),
    iterations: iterNum,
  };
}

export async function unwrapRoomKeyEnvelope({
  envelope,
  secret,
  contextId,
  extractable = false,
}) {
  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    typeof envelope.salt !== 'string' ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.ct !== 'string'
  ) {
    throw new Error('INVALID_KEY_ENVELOPE');
  }
  if (typeof secret !== 'string' || secret.length < 10) {
    throw new Error('Secret must be at least 10 characters');
  }

  const iterNum = Math.min(1000000, Math.max(300000, Number(envelope.iterations) || 600000));
  const ivBytes = base64ToBytes(envelope.iv);
  const ctBytes = base64ToBytes(envelope.ct);

  const enc = new TextEncoder();
  const normSecret = secret.normalize('NFKC');
  const saltPreimage = enc.encode(`pcr/v2/envelope-salt/${contextId}/${envelope.salt}`);
  const domainSaltBuf = await subtle.digest('SHA-256', saltPreimage);

  const baseKey = await subtle.importKey(
    'raw',
    enc.encode(normSecret),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const unwrappingKey = await subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(domainSaltBuf),
      iterations: iterNum,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const aad = enc.encode(`pcr|v2|env|${contextId}`);
  const plainBuffer = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes,
      additionalData: aad,
      tagLength: 128,
    },
    unwrappingKey,
    ctBytes
  );

  const rawKeyBytes = new Uint8Array(plainBuffer);
  if (rawKeyBytes.byteLength !== 32) {
    throw new Error('UNWRAPPED_KEY_INVALID_LENGTH');
  }

  const cryptoKey = await subtle.importKey(
    'raw',
    rawKeyBytes,
    { name: 'AES-GCM', length: 256 },
    Boolean(extractable),
    ['encrypt', 'decrypt']
  );

  const exportedCopy = extractable ? new Uint8Array(rawKeyBytes) : null;
  if (!extractable) {
    rawKeyBytes.fill(0);
  }

  return {
    cryptoKey,
    rawKeyBytes: exportedCopy,
  };
}

export async function deriveRoomKey({
  password,
  roomName,
  room,
  salt: providedSalt,
  iterations = 600000,
  epoch = 1,
}) {
  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;
  if (!subtle) {
    throw new Error('WebCrypto subtle is not available');
  }

  const effectiveRoom = roomName || room;

  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Password must be at least 12 characters');
  }
  if (typeof effectiveRoom !== 'string' || !effectiveRoom.trim()) {
    throw new Error('Invalid room name');
  }

  const iterNum = Number(iterations);
  if (Number.isNaN(iterNum) || iterNum < 300000) {
    throw new Error('PBKDF2 iterations must be at least 300,000');
  }
  const iter = Math.min(1000000, iterNum);

  const normalizedPassword = password.normalize('NFKC');
  const passwordBytes = new TextEncoder().encode(normalizedPassword);

  let salt;
  if (providedSalt) {
    let rawSaltBytes;
    if (typeof providedSalt === 'string') {
      rawSaltBytes = base64ToBytes(providedSalt);
    } else if (providedSalt instanceof Uint8Array) {
      rawSaltBytes = providedSalt;
    } else {
      throw new Error('Invalid salt format; expected Uint8Array or Base64 string');
    }
    const prefix = new TextEncoder().encode(`pcr/v2/salt/${effectiveRoom}/${epoch}/`);
    const combined = new Uint8Array(prefix.length + rawSaltBytes.length);
    combined.set(prefix, 0);
    combined.set(rawSaltBytes, prefix.length);
    const saltBuffer = await subtle.digest('SHA-256', combined);
    salt = new Uint8Array(saltBuffer);
  } else {
    const saltData = new TextEncoder().encode(`private-chatroom/v1/salt/${effectiveRoom}`);
    const saltBuffer = await subtle.digest('SHA-256', saltData);
    salt = new Uint8Array(saltBuffer);
  }

  const baseKey = await subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey']);

  const derivedKey = await subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: iter,
      hash: 'SHA-256',
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  );

  return derivedKey;
}

export async function deriveEpochKey({
  password,
  roomName,
  room,
  salt,
  epoch = 1,
  iterations = 600000,
}) {
  return deriveRoomKey({
    password,
    roomName,
    room,
    salt,
    epoch,
    iterations,
  });
}

export async function computeMessageContentDigest({ text, replyTo, file }) {
  const cryptoObj = getCrypto();
  const enc = new TextEncoder();
  const parts = [];

  const appendPrefixed = (tag, val) => {
    const str = String(val == null ? '' : val);
    const bytes = enc.encode(str);
    parts.push(enc.encode(`${tag}:${bytes.length}:`));
    parts.push(bytes);
    parts.push(enc.encode(';'));
  };

  appendPrefixed('text', text || '');

  if (replyTo && typeof replyTo === 'object' && typeof replyTo.id === 'string') {
    appendPrefixed('rep_id', replyTo.id);
    appendPrefixed('rep_nick', replyTo.nickname || replyTo.n || '');
    appendPrefixed('rep_text', replyTo.text || replyTo.t || '');
  } else {
    appendPrefixed('rep', 'none');
  }

  if (file && typeof file === 'object') {
    appendPrefixed('f_name', file.name || '');
    appendPrefixed('f_type', file.type || '');
    appendPrefixed('f_size', file.size != null ? file.size : '');
    appendPrefixed('f_hash', file.fileHash || file.fh || '');
    appendPrefixed('f_vn', file.isVoiceNote ? '1' : '0');
    appendPrefixed('f_dur', file.duration != null ? file.duration : file.dur != null ? file.dur : '');
    if (Array.isArray(file.waveform) || Array.isArray(file.wf)) {
      appendPrefixed('f_wf', JSON.stringify(file.waveform || file.wf));
    } else {
      appendPrefixed('f_wf', '');
    }
  } else {
    appendPrefixed('f', 'none');
  }

  let totalLen = 0;
  for (const p of parts) totalLen += p.length;
  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    merged.set(p, offset);
    offset += p.length;
  }

  const hashBuf = await cryptoObj.subtle.digest('SHA-256', merged);
  return bytesToBase64(new Uint8Array(hashBuf));
}

export async function encryptMessage({
  key,
  room,
  text,
  nickname,
  id,
  userId,
  replyTo,
  file,
  avatarImage,
  avatarEmoji,
  avatarGradient,
  maxMessageBytes = 1048576,
  identityKeyPair,
  epoch = 1,
}) {
  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;

  if (!key) {
    throw new Error('Missing encryption key');
  }
  if (typeof nickname !== 'string' || nickname.length < 1 || nickname.length > 24) {
    throw new Error('Nickname must be between 1 and 24 characters');
  }

  const messageText = typeof text === 'string' ? text : '';
  const hasFile = file && typeof file === 'object' && typeof file.data === 'string';

  if (messageText.trim().length === 0 && !hasFile) {
    throw new Error('Message text or file attachment is required');
  }

  const messageId = id || cryptoObj.randomUUID();
  const ivBytes = cryptoObj.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`pcr|1|${room}|${messageId}`);

  const innerObject = {
    n: nickname,
    t: messageText,
    ts: Date.now(),
  };

  if (userId && typeof userId === 'string') {
    innerObject.u = userId;
  }

  innerObject.ep = Number(epoch || 1);

  if (avatarImage && typeof avatarImage === 'string') {
    innerObject.av = avatarImage.slice(0, 150000);
  }
  if (avatarEmoji && typeof avatarEmoji === 'string') {
    innerObject.em = avatarEmoji.slice(0, 16);
  }
  if (avatarGradient && typeof avatarGradient === 'string') {
    innerObject.ag = avatarGradient.slice(0, 80);
  }

  if (replyTo && typeof replyTo === 'object' && typeof replyTo.id === 'string') {
    const snippet =
      replyTo.text ||
      replyTo.t ||
      (replyTo.file
        ? replyTo.file.isVoiceNote
          ? '🎤 Voice note'
          : replyTo.file.type && replyTo.file.type.startsWith('image/')
          ? '📷 Photo'
          : `📎 ${replyTo.file.name || 'Attachment'}`
        : '');
    innerObject.r = {
      id: String(replyTo.id),
      n: String(replyTo.nickname || replyTo.n || '').slice(0, 24),
      t: String(snippet).slice(0, 140),
    };
  }

  if (hasFile) {
    innerObject.f = {
      name: String(file.name || 'attachment').slice(0, 100),
      type: String(file.type || 'application/octet-stream').slice(0, 60),
      size: Number(file.size || 0),
      data: file.data,
    };
    if (file.isVoiceNote || (file.type && file.type.startsWith('audio/'))) {
      innerObject.f.isVoiceNote = true;
    }
    if (typeof file.duration === 'number' && Number.isFinite(file.duration)) {
      innerObject.f.dur = Math.round(file.duration * 10) / 10;
    }
    if (Array.isArray(file.waveform) && file.waveform.length > 0) {
      innerObject.f.wf = file.waveform
        .slice(0, 64)
        .map((v) => Math.min(100, Math.max(0, Math.round(v))));
    }
    if (file.fileKey && typeof file.fileKey === 'string') {
      innerObject.f.fk = file.fileKey;
    }
    if (file.fileIv && typeof file.fileIv === 'string') {
      innerObject.f.fiv = file.fileIv;
    }
    if (file.fileHash && typeof file.fileHash === 'string') {
      innerObject.f.fh = file.fileHash;
    }
  }

  const contentDigest = await computeMessageContentDigest({
    text: innerObject.t,
    replyTo: innerObject.r,
    file: innerObject.f,
  });
  innerObject.cd = contentDigest;

  if (identityKeyPair && identityKeyPair.privateKey) {
    const epochVal = innerObject.ep;
    const canonical = `pcr|v2|msg|${room}|${messageId}|${innerObject.ts}|${userId || ''}|${nickname}|${contentDigest}|${epochVal}`;
    const sigBuffer = await subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      identityKeyPair.privateKey,
      new TextEncoder().encode(canonical)
    );
    innerObject.sig = bytesToBase64(new Uint8Array(sigBuffer));
    innerObject.spki = identityKeyPair.publicKeySpki;
  }

  const innerPayload = JSON.stringify(innerObject);
  const innerBytes = new TextEncoder().encode(innerPayload);

  if (innerBytes.byteLength > maxMessageBytes) {
    throw new Error(`Message payload exceeds maximum size of ${maxMessageBytes} bytes`);
  }

  const cipherBuffer = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes,
      additionalData: aad,
      tagLength: 128,
    },
    key,
    innerBytes
  );

  return {
    v: 1,
    id: messageId,
    room,
    epoch: innerObject.ep,
    iv: bytesToBase64(ivBytes),
    ct: bytesToBase64(new Uint8Array(cipherBuffer)),
  };
}

export async function decryptMessage({ key, payload, identityRegistry, expectedEpoch }) {
  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;

  if (!key) {
    throw new Error('Missing decryption key');
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
    throw new Error('INVALID_PAYLOAD_STRUCTURE');
  }

  const ivBytes = base64ToBytes(payload.iv);
  if (ivBytes.byteLength !== 12) {
    throw new Error('INVALID_IV_LENGTH');
  }

  const ctBytes = base64ToBytes(payload.ct);
  if (ctBytes.byteLength < 16) {
    throw new Error('INVALID_CIPHERTEXT_LENGTH');
  }

  const aad = new TextEncoder().encode(`pcr|1|${payload.room}|${payload.id}`);

  const plainBuffer = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes,
      additionalData: aad,
      tagLength: 128,
    },
    key,
    ctBytes
  );

  const plainText = new TextDecoder().decode(plainBuffer);
  const parsed = JSON.parse(plainText);

  if (
    typeof parsed.n !== 'string' ||
    typeof parsed.t !== 'string' ||
    typeof parsed.ts !== 'number'
  ) {
    throw new Error('CORRUPT_INNER_PAYLOAD');
  }

  const messageEpoch = typeof parsed.ep === 'number' ? parsed.ep : 1;
  if (typeof expectedEpoch === 'number' && messageEpoch < expectedEpoch) {
    throw new Error('OBSOLETE_EPOCH_MESSAGE');
  }

  let isSigned = false;
  let senderPublicKeySpki = null;
  let authStatus = 'UNAUTHENTICATED';
  let identityWarning = null;

  if (parsed.sig && parsed.spki) {
    try {
      const computedContentDigest = await computeMessageContentDigest({
        text: parsed.t,
        replyTo: parsed.r,
        file: parsed.f,
      });

      if (parsed.cd && parsed.cd !== computedContentDigest) {
        throw new Error('SENDER_SIGNATURE_VERIFICATION_FAILED');
      }

      const canonicalV2 = `pcr|v2|msg|${payload.room}|${payload.id}|${parsed.ts}|${parsed.u || ''}|${parsed.n}|${computedContentDigest}|${messageEpoch}`;
      const spkiBytes = base64ToBytes(parsed.spki);
      const sigBytes = base64ToBytes(parsed.sig);

      const pubKey = await subtle.importKey(
        'spki',
        spkiBytes,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      );

      let isValid = await subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        pubKey,
        sigBytes,
        new TextEncoder().encode(canonicalV2)
      );

      if (!isValid && !parsed.cd) {
        const fileHash = parsed.f && parsed.f.fh ? parsed.f.fh : '';
        const canonicalV1 = `pcr|v1|msg|${payload.room}|${payload.id}|${parsed.ts}|${parsed.u || ''}|${parsed.n}|${fileHash}`;
        isValid = await subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          pubKey,
          sigBytes,
          new TextEncoder().encode(canonicalV1)
        );
      }

      if (!isValid) {
        throw new Error('SENDER_SIGNATURE_VERIFICATION_FAILED');
      }

      isSigned = true;
      senderPublicKeySpki = parsed.spki;

      if (identityRegistry && parsed.u) {
        const idCheck = identityRegistry.registerOrVerify({
          userId: parsed.u,
          nickname: parsed.n,
          publicKeySpki: parsed.spki,
        });
        if (idCheck.status === 'KEY_CHANGED') {
          identityWarning = 'KEY_CHANGED';
          authStatus = 'KEY_CHANGED';
        } else if (idCheck.status === 'VERIFIED') {
          authStatus = 'VERIFIED';
        } else {
          authStatus = 'FIRST_SEEN';
        }
      } else {
        authStatus = 'FIRST_SEEN';
      }
    } catch (err) {
      if (err && err.message === 'SENDER_SIGNATURE_VERIFICATION_FAILED') {
        throw err;
      }
      throw new Error('SENDER_SIGNATURE_VERIFICATION_FAILED');
    }
  } else {
    if (identityRegistry && parsed.u) {
      const known = identityRegistry.getIdentity(parsed.u);
      if (known) {
        identityWarning = 'UNAUTHENTICATED_SENDER';
        authStatus = 'UNAUTHENTICATED';
      }
    }
  }

  return {
    nickname: parsed.n,
    text: parsed.t,
    timestamp: parsed.ts,
    userId: typeof parsed.u === 'string' ? parsed.u : null,
    epoch: messageEpoch,
    avatarImage: typeof parsed.av === 'string' ? parsed.av : null,
    avatarEmoji: typeof parsed.em === 'string' ? parsed.em : null,
    avatarGradient: typeof parsed.ag === 'string' ? parsed.ag : null,
    senderPublicKeySpki,
    isSigned,
    authStatus,
    identityWarning,
    replyTo:
      parsed.r && typeof parsed.r === 'object' && typeof parsed.r.id === 'string'
        ? {
            id: String(parsed.r.id),
            nickname: String(parsed.r.n || ''),
            text: String(parsed.r.t || ''),
          }
        : null,
    file:
      parsed.f && typeof parsed.f === 'object' && typeof parsed.f.data === 'string'
        ? {
            name: String(parsed.f.name || 'attachment'),
            type: String(parsed.f.type || 'application/octet-stream'),
            size: Number(parsed.f.size || 0),
            data: parsed.f.data,
            isVoiceNote: Boolean(
              parsed.f.isVoiceNote || (parsed.f.type && parsed.f.type.startsWith('audio/'))
            ),
            duration:
              typeof parsed.f.dur === 'number'
                ? parsed.f.dur
                : typeof parsed.f.duration === 'number'
                ? parsed.f.duration
                : null,
            waveform: Array.isArray(parsed.f.wf)
              ? parsed.f.wf
              : Array.isArray(parsed.f.waveform)
              ? parsed.f.waveform
              : null,
            fileKey: typeof parsed.f.fk === 'string' ? parsed.f.fk : null,
            fileIv: typeof parsed.f.fiv === 'string' ? parsed.f.fiv : null,
            fileHash: typeof parsed.f.fh === 'string' ? parsed.f.fh : null,
          }
        : null,
  };
}

export const CRYPTO_SPEC = Object.freeze({
  PROTOCOL_VERSION: 1,
  ALGORITHM: 'AES-256-GCM',
  KEY_LENGTH_BITS: 256,
  KDF: 'PBKDF2-HMAC-SHA256',
  KDF_ITERATIONS: 600000,
  BACKUP_KDF_ITERATIONS: 300000,
  TAG_LENGTH_BITS: 128,
  IV_LENGTH_BYTES: 12,
  AAD_PREFIX: 'pcr|1',
  MAX_MESSAGE_BYTES: 1048576,
  STORAGE: 'VOLATILE_MEMORY_ONLY',
  EXTRACTABLE: false,
  IDENTITY_ALGORITHM: 'ECDSA',
  IDENTITY_CURVE: 'P-256',
  RECEIVER_MAX_TYPING_TTL: 5000,
  RECEIVER_MIN_TYPING_TTL: 1000,
});

export const PROTOCOL_GUARANTEES = Object.freeze({
  ARCHITECTURE:
    'Admin-Invite-Only Zero-Knowledge Relay with 256-bit AES-GCM Key Envelopes & Authenticated ECDSA Identities',
  CONFIDENTIALITY:
    'AES-256-GCM symmetric encryption using 256-bit random room master keys unwrapped via PBKDF2-HMAC-SHA256 (600,000 iterations). Plaintext is never accessible to the relay server.',
  SENDER_AUTHENTICATION:
    'ECDSA P-256 digital signatures with unambiguous content digest (SHA-256 length-prefixed TLV) binding message text, attachments, reply context, and key epoch. TOFU key pinning per session user ID.',
  IDENTITY_CONTINUITY:
    'SESSION_SCOPED. Cryptographic identity keys are generated in volatile memory for each browser session. Identities are categorized as First-Seen (TOFU), Verified (via out-of-band Safety Number), or Key-Changed.',
  TYPING_AUTHENTICATION:
    'MANDATORY. Ephemeral typing signals require valid ECDSA signatures over canonical room, sender ID, signal ID, and TTL context; unauthenticated signals fail closed.',
  ROOM_SALT_SECURITY:
    'Cryptographically secure 16-byte random salts generated per envelope and domain-separated, preventing precomputed dictionary tables.',
  REPLAY_PROTECTION:
    'Authenticated Associated Data (AAD) binding message ID and room name; receiver-side LRU deduplication, signal ID tracking, and timestamp freshness windows.',
  FORWARD_SECRECY:
    'LIMITED. Static shared room keys do not provide automatic continuous Forward Secrecy (FS). Manual or eviction-triggered key rotation (Epoch transition) establishes post-eviction forward security.',
  POST_COMPROMISE_SECURITY:
    'LIMITED. Static shared room keys do not provide automatic PCS without explicit epoch key rotation.',
  GROUP_MEMBERSHIP_REMOVAL:
    'Authorized server-enforced room eviction combined with cryptographic Epoch Key Rotation (deriveEpochKey).',
  HISTORICAL_MESSAGES_AFTER_LEAVE:
    'Relay server operates with zero message persistence (RAM-only ephemeral relay). No server-side message history is stored or readable.',
  HARDWARE_RAM_ERASURE:
    'NOT GUARANTEED. Web browser JavaScript runtimes (V8/JavaScriptCore) do not guarantee physical memory zeroization due to garbage collection constraints.',
});

export async function generateIdentityKeyPair({ extractable = false } = {}) {
  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;

  const keyPair = await subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    Boolean(extractable),
    ['sign', 'verify']
  );

  const spkiBuffer = await subtle.exportKey('spki', keyPair.publicKey);
  const spkiBytes = new Uint8Array(spkiBuffer);
  const publicKeySpki = bytesToBase64(spkiBytes);

  const fpBuffer = await subtle.digest('SHA-256', spkiBytes);
  const fpBytes = new Uint8Array(fpBuffer);
  const fingerprintHex = Array.from(fpBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeySpki,
    fingerprintHex,
  };
}

export async function computeIdentitySafetyNumber({ publicKeySpki }) {
  if (!publicKeySpki) {
    throw new Error('Missing publicKeySpki for identity safety number derivation');
  }
  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;

  const spkiBytes = base64ToBytes(publicKeySpki);
  const domainPrefix = new TextEncoder().encode('pcr|v1|identity-fingerprint|');
  const combined = new Uint8Array(domainPrefix.length + spkiBytes.length);
  combined.set(domainPrefix, 0);
  combined.set(spkiBytes, domainPrefix.length);

  const hashBuffer = await subtle.digest('SHA-256', combined);
  const hashBytes = new Uint8Array(hashBuffer);

  const hexParts = [];
  for (let i = 0; i < hashBytes.length; i += 2) {
    const hex = ((hashBytes[i] << 8) | hashBytes[i + 1])
      .toString(16)
      .padStart(4, '0')
      .toUpperCase();
    hexParts.push(hex);
  }
  const hexFingerprint = hexParts.join('-');

  const numericBlocks = [];
  for (let i = 0; i < 24; i += 2) {
    const val = (hashBytes[i] * 256 + hashBytes[i + 1]) % 100000;
    numericBlocks.push(val.toString().padStart(5, '0'));
  }
  const numericSafetyNumber = numericBlocks.join(' ');

  return {
    numeric: numericSafetyNumber,
    hex: hexFingerprint,
    rawHex: Array.from(hashBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    type: 'participant-identity',
    note: 'Verifies individual participant ECDSA identity key; immune to shared-room impersonation.',
  };
}

export async function computePairwiseSafetyNumber({
  myPublicKeySpki,
  peerPublicKeySpki,
  room = 'direct',
}) {
  if (!myPublicKeySpki || !peerPublicKeySpki) {
    throw new Error('Both public keys required for pairwise safety number derivation');
  }
  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;

  const sorted = [myPublicKeySpki, peerPublicKeySpki].sort();
  const rawA = base64ToBytes(sorted[0]);
  const rawB = base64ToBytes(sorted[1]);

  const prefix = new TextEncoder().encode(`pcr|v1|pairwise-safety-number|${room}|`);
  const combined = new Uint8Array(prefix.length + rawA.length + rawB.length);
  combined.set(prefix, 0);
  combined.set(rawA, prefix.length);
  combined.set(rawB, prefix.length + rawA.length);

  const hashBuffer = await subtle.digest('SHA-256', combined);
  const hashBytes = new Uint8Array(hashBuffer);

  const hexParts = [];
  for (let i = 0; i < hashBytes.length; i += 2) {
    const hex = ((hashBytes[i] << 8) | hashBytes[i + 1])
      .toString(16)
      .padStart(4, '0')
      .toUpperCase();
    hexParts.push(hex);
  }
  const hexFingerprint = hexParts.join('-');

  const numericBlocks = [];
  for (let i = 0; i < 24; i += 2) {
    const val = (hashBytes[i] * 256 + hashBytes[i + 1]) % 100000;
    numericBlocks.push(val.toString().padStart(5, '0'));
  }
  const numericSafetyNumber = numericBlocks.join(' ');

  return {
    numeric: numericSafetyNumber,
    hex: hexFingerprint,
    rawHex: Array.from(hashBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    type: 'pairwise-peer-identity',
    note: 'Verifies mutual identity across both participants for out-of-band verification.',
  };
}

export async function computeSafetyNumber({ key, room }) {
  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;

  if (!key) throw new Error('Missing key for safety number derivation');

  const domainConstant = new TextEncoder().encode(`pcr|v1|safety-number|${room || 'global'}`);
  const zeroIv = new Uint8Array(12);

  const cipherBuffer = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: zeroIv,
      tagLength: 128,
    },
    key,
    domainConstant
  );

  const hashBuffer = await subtle.digest('SHA-256', cipherBuffer);
  const hashBytes = new Uint8Array(hashBuffer);

  const hexParts = [];
  for (let i = 0; i < hashBytes.length; i += 2) {
    const hex = ((hashBytes[i] << 8) | hashBytes[i + 1])
      .toString(16)
      .padStart(4, '0')
      .toUpperCase();
    hexParts.push(hex);
  }
  const hexFingerprint = hexParts.join('-');

  const numericBlocks = [];
  for (let i = 0; i < 24; i += 2) {
    const val = (hashBytes[i] * 256 + hashBytes[i + 1]) % 100000;
    numericBlocks.push(val.toString().padStart(5, '0'));
  }
  const numericSafetyNumber = numericBlocks.join(' ');

  return {
    numeric: numericSafetyNumber,
    hex: hexFingerprint,
    rawHex: Array.from(hashBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    type: 'shared-room-key',
    note: 'Verifies shared room key derivation, not individual sender identity.',
  };
}

export class IdentityRegistry {
  constructor() {
    this.identities = new Map();
  }

  registerOrVerify({ userId, nickname, publicKeySpki }) {
    if (!userId || !publicKeySpki) {
      return {
        status: 'UNAUTHENTICATED',
        warning: 'MISSING_IDENTITY_CREDENTIALS',
        trustLevel: 'UNAUTHENTICATED',
      };
    }

    const existing = this.identities.get(userId);
    if (!existing) {
      this.identities.set(userId, {
        publicKeySpki,
        nickname: nickname || 'Someone',
        firstSeenAt: Date.now(),
        isVerified: false,
        verifiedAt: null,
      });
      return {
        status: 'TRUSTED_NEW',
        warning: null,
        trustLevel: 'FIRST_SEEN',
        isVerified: false,
      };
    }

    if (existing.publicKeySpki !== publicKeySpki) {
      return {
        status: 'KEY_CHANGED',
        warning: `IDENTITY_SUBSTITUTION_DETECTED: Cryptographic public key changed for user "${userId}"`,
        previousKey: existing.publicKeySpki,
        newKey: publicKeySpki,
        trustLevel: 'KEY_CHANGED',
        isVerified: false,
      };
    }

    if (nickname && existing.nickname !== nickname) {
      const oldNick = existing.nickname;
      existing.nickname = nickname;
      return {
        status: existing.isVerified ? 'VERIFIED' : 'TRUSTED',
        warning: 'NICKNAME_CHANGED',
        oldNickname: oldNick,
        newNickname: nickname,
        trustLevel: existing.isVerified ? 'VERIFIED' : 'FIRST_SEEN',
        isVerified: existing.isVerified,
      };
    }

    return {
      status: existing.isVerified ? 'VERIFIED' : 'TRUSTED',
      warning: null,
      trustLevel: existing.isVerified ? 'VERIFIED' : 'FIRST_SEEN',
      isVerified: existing.isVerified,
    };
  }

  markVerified(userId) {
    const existing = this.identities.get(userId);
    if (existing) {
      existing.isVerified = true;
      existing.verifiedAt = Date.now();
      return true;
    }
    return false;
  }

  isVerified(userId) {
    const existing = this.identities.get(userId);
    return Boolean(existing && existing.isVerified);
  }

  getTrustStatus(userId, publicKeySpki) {
    if (!userId || !publicKeySpki) return 'UNAUTHENTICATED';
    const existing = this.identities.get(userId);
    if (!existing) return 'UNKNOWN';
    if (existing.publicKeySpki !== publicKeySpki) return 'KEY_CHANGED';
    return existing.isVerified ? 'VERIFIED' : 'FIRST_SEEN';
  }

  getIdentity(userId) {
    return this.identities.get(userId) || null;
  }

  clear() {
    this.identities.clear();
  }
}

export class TypingReplayDetector {
  constructor({ maxCacheSize = 1000, maxClockSkewMs = 1000 } = {}) {
    this.seenSignalIds = new Set();
    this.signalOrder = [];
    this.senderStates = new Map();
    this.maxCacheSize = maxCacheSize;
    this.maxClockSkewMs = maxClockSkewMs;
  }

  checkAndRecord({ signalId, userId, timestamp, seq, ttl = 3000 }) {
    const now = Date.now();
    const effectiveTtl = Math.min(5000, Math.max(1000, Number(ttl) || 3000));

    if (signalId && typeof signalId === 'string') {
      if (this.seenSignalIds.has(signalId)) {
        return { valid: false, reason: 'DUPLICATE_SIGNAL_ID' };
      }
      this.seenSignalIds.add(signalId);
      this.signalOrder.push(signalId);
      if (this.signalOrder.length > this.maxCacheSize) {
        const oldest = this.signalOrder.shift();
        this.seenSignalIds.delete(oldest);
      }
    }

    if (typeof timestamp === 'number') {
      if (timestamp > now + this.maxClockSkewMs) {
        return { valid: false, reason: 'FUTURE_TIMESTAMP' };
      }
      if (now - timestamp > effectiveTtl + this.maxClockSkewMs) {
        return { valid: false, reason: 'EXPIRED_TIMESTAMP' };
      }
    }

    if (userId && typeof userId === 'string' && typeof timestamp === 'number') {
      const senderState = this.senderStates.get(userId);
      if (senderState) {
        if (timestamp < senderState.lastTimestamp) {
          return { valid: false, reason: 'OUT_OF_ORDER_TIMESTAMP' };
        }
        if (typeof seq === 'number' && typeof senderState.lastSeq === 'number') {
          if (seq <= senderState.lastSeq && timestamp <= senderState.lastTimestamp) {
            return { valid: false, reason: 'REPLAYED_SEQUENCE' };
          }
        }
      }
      this.senderStates.set(userId, {
        lastTimestamp: timestamp,
        lastSeq: typeof seq === 'number' ? seq : 0,
      });
    }

    return { valid: true };
  }

  resetSender(userId) {
    if (userId) this.senderStates.delete(userId);
  }

  clear() {
    this.seenSignalIds.clear();
    this.signalOrder = [];
    this.senderStates.clear();
  }
}

export async function encryptFileAttachment({ data, name, type, size }) {
  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;

  const fileKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);

  const rawKeyBytes = await subtle.exportKey('raw', fileKey);
  const fileKeyBase64 = bytesToBase64(new Uint8Array(rawKeyBytes));

  const fileIv = cryptoObj.getRandomValues(new Uint8Array(12));
  const fileIvBase64 = bytesToBase64(fileIv);

  const dataBytes = typeof data === 'string' ? base64ToBytes(data) : new Uint8Array(data);
  const hashBuffer = await subtle.digest('SHA-256', dataBytes);
  const fileHash = bytesToBase64(new Uint8Array(hashBuffer));

  const encryptedBuffer = await subtle.encrypt(
    { name: 'AES-GCM', iv: fileIv, tagLength: 128 },
    fileKey,
    dataBytes
  );

  return {
    name: String(name || 'attachment').slice(0, 100),
    type: String(type || 'application/octet-stream').slice(0, 60),
    size: Number(size || dataBytes.byteLength),
    data: bytesToBase64(new Uint8Array(encryptedBuffer)),
    fileKey: fileKeyBase64,
    fileIv: fileIvBase64,
    fileHash,
  };
}

export async function decryptFileAttachment({ data, fileKey, fileIv, fileHash }) {
  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;

  if (!fileKey || !fileIv) {
    return data;
  }

  const rawKeyBytes = base64ToBytes(fileKey);
  const ivBytes = base64ToBytes(fileIv);
  const cipherBytes = base64ToBytes(data);

  const importedKey = await subtle.importKey(
    'raw',
    rawKeyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const decryptedBuffer = await subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes, tagLength: 128 },
    importedKey,
    cipherBytes
  );

  const plainBytes = new Uint8Array(decryptedBuffer);

  if (fileHash) {
    const hashBuffer = await subtle.digest('SHA-256', plainBytes);
    const computedHash = bytesToBase64(new Uint8Array(hashBuffer));
    if (computedHash !== fileHash) {
      throw new Error('FILE_INTEGRITY_VERIFICATION_FAILED');
    }
  }

  return bytesToBase64(plainBytes);
}

export async function encryptTypingSignal({
  key,
  room,
  isTyping,
  userId,
  nickname,
  ttl = 3000,
  signalId,
  seq = 0,
  identityKeyPair,
}) {
  if (!key || !room) throw new Error('Key and room are required for encrypted typing signal');
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    throw new Error('Sender identity (userId) is required for encrypted typing signal');
  }

  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;
  const iv = cryptoObj.getRandomValues(new Uint8Array(12));
  const normalizedRoom = String(room).trim();
  const cleanUserId = userId.trim().slice(0, 32);
  const cleanTtl = Math.min(
    CRYPTO_SPEC.RECEIVER_MAX_TYPING_TTL,
    Math.max(CRYPTO_SPEC.RECEIVER_MIN_TYPING_TTL, Math.round(Number(ttl) || 3000))
  );
  const effectiveSignalId =
    signalId ||
    (typeof cryptoObj.randomUUID === 'function'
      ? cryptoObj.randomUUID()
      : `sig-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
  const timestamp = Date.now();

  const innerObject = {
    v: 1,
    type: 'typing_signal',
    room: normalizedRoom,
    isTyping: Boolean(isTyping),
    userId: cleanUserId,
    nickname: typeof nickname === 'string' ? nickname.slice(0, 24) : 'Someone',
    timestamp,
    ttl: cleanTtl,
    signalId: effectiveSignalId,
    seq: Number(seq || 0),
  };

  let activeKeyPair = identityKeyPair;
  if (!activeKeyPair || !activeKeyPair.privateKey || !activeKeyPair.publicKeySpki) {
    activeKeyPair = await generateIdentityKeyPair();
  }

  const canonical = `pcr|v1|typ|${normalizedRoom}|${effectiveSignalId}|${timestamp}|${cleanTtl}|${isTyping ? '1' : '0'}|${cleanUserId}`;
  const sigBuffer = await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    activeKeyPair.privateKey,
    new TextEncoder().encode(canonical)
  );
  innerObject.sig = bytesToBase64(new Uint8Array(sigBuffer));
  innerObject.spki = activeKeyPair.publicKeySpki;

  const enc = new TextEncoder();
  const plaintextBytes = enc.encode(JSON.stringify(innerObject));
  const aad = enc.encode(`typ:v1:${normalizedRoom}`);

  const encryptedBuffer = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    key,
    plaintextBytes
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer)),
    iv: bytesToBase64(iv),
    ttl: cleanTtl,
    signalId: effectiveSignalId,
  };
}

export async function decryptTypingSignal({
  key,
  room,
  ciphertext,
  iv,
  ttl: envelopeTtl,
  signalId: envelopeSignalId,
  expectedSenderId,
  identityRegistry,
  replayDetector,
}) {
  if (!key || !room || !ciphertext || !iv) return null;

  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;
  const normalizedRoom = String(room).trim();
  const enc = new TextEncoder();
  const aad = enc.encode(`typ:v1:${normalizedRoom}`);

  try {
    const ivBytes = base64ToBytes(iv);
    const cipherBytes = base64ToBytes(ciphertext);

    const decryptedBuffer = await subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes, additionalData: aad, tagLength: 128 },
      key,
      cipherBytes
    );

    const dec = new TextDecoder();
    const parsed = JSON.parse(dec.decode(decryptedBuffer));

    if (
      parsed.type !== 'typing_signal' ||
      parsed.room !== normalizedRoom ||
      typeof parsed.isTyping !== 'boolean' ||
      !parsed.userId ||
      typeof parsed.userId !== 'string' ||
      !parsed.userId.trim()
    ) {
      return null;
    }

    if (!parsed.sig || !parsed.spki) {
      return null;
    }

    if (envelopeSignalId && parsed.signalId && envelopeSignalId !== parsed.signalId) {
      return null;
    }

    const authenticatedTtl = Math.min(
      CRYPTO_SPEC.RECEIVER_MAX_TYPING_TTL,
      Math.max(CRYPTO_SPEC.RECEIVER_MIN_TYPING_TTL, Math.round(Number(parsed.ttl) || 3000))
    );

    const now = Date.now();
    const timestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : now;

    if (timestamp > now + 1000 || now - timestamp > authenticatedTtl + 1000) {
      return null;
    }

    if (identityRegistry && parsed.userId) {
      const knownIdentity = identityRegistry.getIdentity(parsed.userId);
      if (knownIdentity && knownIdentity.publicKeySpki !== parsed.spki) {
        return null;
      }
    }

    let isSigned = false;
    let senderSpki = null;
    try {
      const canonical = `pcr|v1|typ|${normalizedRoom}|${parsed.signalId || ''}|${timestamp}|${authenticatedTtl}|${parsed.isTyping ? '1' : '0'}|${parsed.userId}`;
      const spkiBytes = base64ToBytes(parsed.spki);
      const sigBytes = base64ToBytes(parsed.sig);

      const pubKey = await subtle.importKey(
        'spki',
        spkiBytes,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      );

      const isValid = await subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        pubKey,
        sigBytes,
        new TextEncoder().encode(canonical)
      );

      if (!isValid) {
        return null;
      }
      isSigned = true;
      senderSpki = parsed.spki;

      if (identityRegistry && parsed.userId) {
        const idCheck = identityRegistry.registerOrVerify({
          userId: parsed.userId,
          nickname: parsed.nickname,
          publicKeySpki: parsed.spki,
        });
        if (idCheck.status === 'KEY_CHANGED' || idCheck.status === 'UNAUTHENTICATED') {
          return null;
        }
      }
    } catch {
      return null;
    }

    if (expectedSenderId && (!parsed.userId || parsed.userId !== expectedSenderId)) {
      return null;
    }

    if (replayDetector) {
      const replayCheck = replayDetector.checkAndRecord({
        signalId: parsed.signalId,
        userId: parsed.userId,
        timestamp,
        seq: parsed.seq,
        ttl: authenticatedTtl,
      });
      if (!replayCheck.valid) {
        return null;
      }
    }

    return {
      isTyping: parsed.isTyping,
      userId: parsed.userId,
      nickname: typeof parsed.nickname === 'string' ? parsed.nickname : 'Someone',
      timestamp,
      ttl: authenticatedTtl,
      signalId: parsed.signalId || null,
      senderSpki,
      isSigned,
    };
  } catch {
    return null;
  }
}

export async function encryptReaction({
  key,
  room,
  targetMessageId,
  emoji,
  action = 'add',
  userId,
  nickname,
  identityKeyPair,
}) {
  if (!key || !room || !targetMessageId || !emoji) {
    throw new Error('Key, room, targetMessageId, and emoji are required to encrypt reaction');
  }
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    throw new Error('Sender identity (userId) is required to encrypt reaction');
  }

  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;
  const normalizedRoom = String(room).trim();
  const cleanTargetId = String(targetMessageId).trim();
  const cleanEmoji = String(emoji).trim();
  const cleanAction = action === 'remove' ? 'remove' : 'add';
  const cleanUserId = userId.trim().slice(0, 32);
  const cleanNickname = typeof nickname === 'string' ? nickname.slice(0, 24) : 'Someone';
  const timestamp = Date.now();

  const iv = cryptoObj.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`pcr|1|react|${normalizedRoom}|${cleanTargetId}`);

  const innerObject = {
    v: 1,
    type: 'reaction',
    room: normalizedRoom,
    targetMessageId: cleanTargetId,
    emoji: cleanEmoji,
    action: cleanAction,
    userId: cleanUserId,
    nickname: cleanNickname,
    timestamp,
  };

  let activeKeyPair = identityKeyPair;
  if (!activeKeyPair || !activeKeyPair.privateKey || !activeKeyPair.publicKeySpki) {
    activeKeyPair = await generateIdentityKeyPair();
  }

  const canonical = `pcr|v1|react|${normalizedRoom}|${cleanTargetId}|${cleanEmoji}|${cleanAction}|${timestamp}|${cleanUserId}`;
  const sigBuffer = await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    activeKeyPair.privateKey,
    new TextEncoder().encode(canonical)
  );
  innerObject.sig = bytesToBase64(new Uint8Array(sigBuffer));
  innerObject.spki = activeKeyPair.publicKeySpki;

  const innerBytes = new TextEncoder().encode(JSON.stringify(innerObject));
  const encryptedBuffer = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    key,
    innerBytes
  );

  return {
    v: 1,
    room: normalizedRoom,
    targetMessageId: cleanTargetId,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(encryptedBuffer)),
  };
}

export async function decryptReaction({ key, payload, identityRegistry }) {
  if (!key || !payload || typeof payload !== 'object') {
    throw new Error('Key and payload are required');
  }
  if (!payload.room || !payload.targetMessageId || !payload.iv || !payload.ct) {
    throw new Error('INVALID_PAYLOAD_STRUCTURE');
  }

  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;
  const normalizedRoom = String(payload.room).trim();
  const targetId = String(payload.targetMessageId).trim();

  const ivBytes = base64ToBytes(payload.iv);
  const ctBytes = base64ToBytes(payload.ct);
  const aad = new TextEncoder().encode(`pcr|1|react|${normalizedRoom}|${targetId}`);

  const decryptedBuffer = await subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes, additionalData: aad, tagLength: 128 },
    key,
    ctBytes
  );

  const parsed = JSON.parse(new TextDecoder().decode(decryptedBuffer));

  if (
    parsed.type !== 'reaction' ||
    parsed.room !== normalizedRoom ||
    parsed.targetMessageId !== targetId ||
    typeof parsed.emoji !== 'string' ||
    !parsed.emoji.trim() ||
    typeof parsed.userId !== 'string'
  ) {
    throw new Error('CORRUPT_REACTION_PAYLOAD');
  }

  let isSigned = false;
  let authStatus = 'UNAUTHENTICATED';
  let identityWarning = null;

  if (parsed.sig && parsed.spki) {
    const canonical = `pcr|v1|react|${normalizedRoom}|${targetId}|${parsed.emoji}|${parsed.action || 'add'}|${parsed.timestamp}|${parsed.userId}`;
    const spkiBytes = base64ToBytes(parsed.spki);
    const sigBytes = base64ToBytes(parsed.sig);

    const pubKey = await subtle.importKey(
      'spki',
      spkiBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );

    const isValid = await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pubKey,
      sigBytes,
      new TextEncoder().encode(canonical)
    );

    if (!isValid) {
      throw new Error('REACTION_SIGNATURE_VERIFICATION_FAILED');
    }

    isSigned = true;

    if (identityRegistry && parsed.userId) {
      const idCheck = identityRegistry.registerOrVerify({
        userId: parsed.userId,
        nickname: parsed.nickname,
        publicKeySpki: parsed.spki,
      });
      if (idCheck.status === 'KEY_CHANGED') {
        identityWarning = 'KEY_CHANGED';
        authStatus = 'KEY_CHANGED';
      } else if (idCheck.status === 'VERIFIED') {
        authStatus = 'VERIFIED';
      } else {
        authStatus = 'FIRST_SEEN';
      }
    } else {
      authStatus = 'FIRST_SEEN';
    }
  }

  return {
    targetMessageId: parsed.targetMessageId,
    emoji: parsed.emoji,
    action: parsed.action || 'add',
    userId: parsed.userId,
    nickname: parsed.nickname || 'Someone',
    timestamp: parsed.timestamp || Date.now(),
    isSigned,
    authStatus,
    identityWarning,
    senderSpki: parsed.spki || null,
  };
}

export {
  saveIdentityKeyPair,
  loadIdentityKeyPair,
  loadOrCreateIdentityKeyPair,
  clearIdentityKeyPair,
  rotateIdentityKeyPair,
  exportIdentityBackup,
  importIdentityBackup,
  hasPersistedIdentity,
  getPersistedIdentitySync,
} from './identityStorage.js';