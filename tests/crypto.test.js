/**
 * Private Chatroom - Unit tests for crypto.js
 * Using Node.js built-in test runner
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveRoomKey,
  deriveEpochKey,
  generateRandomSalt,
  computeMessageContentDigest,
  encryptMessage,
  decryptMessage,
  bytesToBase64,
  base64ToBytes,
  computeSafetyNumber,
  computeIdentitySafetyNumber,
  computePairwiseSafetyNumber,
  generateIdentityKeyPair,
  IdentityRegistry,
  TypingReplayDetector,
  encryptFileAttachment,
  decryptFileAttachment,
  encryptTypingSignal,
  decryptTypingSignal,
  CRYPTO_SPEC,
  PROTOCOL_GUARANTEES,
} from '../frontend/src/utils/crypto.js';

test('crypto: deriveRoomKey creates a valid non-extractable key with >= 12 char password', async () => {
  const key = await deriveRoomKey({
    password: 'correct-horse-battery-staple-1234',
    roomName: 'cyber-vault',
    iterations: 300000,
  });

  assert.ok(key);
  assert.equal(key.algorithm.name, 'AES-GCM');
  assert.equal(key.extractable, false);

  // Attempting to export a non-extractable key must throw
  await assert.rejects(
    async () => {
      await crypto.subtle.exportKey('raw', key);
    },
    (err) => {
      return err instanceof Error;
    }
  );
});

test('crypto: iterations below 300,000 throw an error', async () => {
  await assert.rejects(
    async () => {
      await deriveRoomKey({
        password: 'valid-length-password-123',
        roomName: 'room-a',
        iterations: 299999,
      });
    },
    {
      message: 'PBKDF2 iterations must be at least 300,000',
    }
  );
});

test('crypto: password under 12 characters throws an error', async () => {
  await assert.rejects(
    async () => {
      await deriveRoomKey({
        password: 'short-pass',
        roomName: 'room-a',
        iterations: 300000,
      });
    },
    {
      message: 'Password must be at least 12 characters',
    }
  );
});

test('crypto: NFKC-equivalent passwords derive the same key', async () => {
  // \u00C5 (Å) vs \u0041\u030A (A + combining ring above)
  const pass1 = 'Angstrom\u00C5_password_123456';
  const pass2 = 'Angstrom\u0041\u030A_password_123456';

  const key1 = await deriveRoomKey({
    password: pass1,
    roomName: 'nfkc-room',
    iterations: 300000,
  });

  const key2 = await deriveRoomKey({
    password: pass2,
    roomName: 'nfkc-room',
    iterations: 300000,
  });

  // Encrypt with key1, decrypt with key2
  const enc = await encryptMessage({
    key: key1,
    room: 'nfkc-room',
    text: 'NFKC test message',
    nickname: 'Alice',
  });

  const dec = await decryptMessage({
    key: key2,
    payload: enc,
  });

  assert.equal(dec.text, 'NFKC test message');
  assert.equal(dec.nickname, 'Alice');
});

test('crypto: roundtrip with Persian, emojis, and multiline text', async () => {
  const roomName = 'multilingual-zone';
  const key = await deriveRoomKey({
    password: 'super-secure-room-key-999999',
    roomName,
    iterations: 300000,
  });

  const complexText = `سلام دنیا! این یک پیام رمزنگاری شده است.
خط دوم با ایموجی: 🔒🛡️⚡✨
Line 3 with mixed text: آزمایش end-to-end encryption`;

  const payload = await encryptMessage({
    key,
    room: roomName,
    text: complexText,
    nickname: 'امیر',
  });

  assert.equal(payload.v, 1);
  assert.equal(payload.room, roomName);
  assert.ok(payload.id);
  assert.ok(payload.iv);
  assert.ok(payload.ct);

  const decrypted = await decryptMessage({ key, payload });
  assert.equal(decrypted.text, complexText);
  assert.equal(decrypted.nickname, 'امیر');
  assert.ok(typeof decrypted.timestamp === 'number');
});

test('crypto: IVs are unique across consecutive messages', async () => {
  const key = await deriveRoomKey({
    password: 'password-for-iv-uniqueness-test',
    roomName: 'iv-test',
    iterations: 300000,
  });

  const ivSet = new Set();
  for (let i = 0; i < 25; i++) {
    const payload = await encryptMessage({
      key,
      room: 'iv-test',
      text: `Message ${i}`,
      nickname: 'Bot',
    });
    assert.equal(ivSet.has(payload.iv), false, 'IV collision detected');
    ivSet.add(payload.iv);
  }
});

test('crypto: wrong password fails decryption', async () => {
  const roomName = 'secret-chamber';
  const keyA = await deriveRoomKey({
    password: 'first-password-secret-12345',
    roomName,
    iterations: 300000,
  });
  const keyB = await deriveRoomKey({
    password: 'second-password-secret-67890',
    roomName,
    iterations: 300000,
  });

  const payload = await encryptMessage({
    key: keyA,
    room: roomName,
    text: 'Top secret plan',
    nickname: 'Agent007',
  });

  await assert.rejects(async () => {
    await decryptMessage({ key: keyB, payload });
  });
});

test('crypto: wrong salt/room name fails decryption', async () => {
  const keyRoomA = await deriveRoomKey({
    password: 'shared-room-password-123456',
    roomName: 'room-alpha',
    iterations: 300000,
  });
  const keyRoomB = await deriveRoomKey({
    password: 'shared-room-password-123456',
    roomName: 'room-beta',
    iterations: 300000,
  });

  const payload = await encryptMessage({
    key: keyRoomA,
    room: 'room-alpha',
    text: 'Target Alpha',
    nickname: 'Bob',
  });

  await assert.rejects(async () => {
    await decryptMessage({ key: keyRoomB, payload });
  });
});

test('crypto: modifying AAD (room, id, or version) causes decryption to fail', async () => {
  const room = 'aad-integrity-room';
  const key = await deriveRoomKey({
    password: 'aad-integrity-password-12345',
    room,
    iterations: 300000,
  });

  const payload = await encryptMessage({
    key,
    room,
    text: 'Integrity check',
    nickname: 'Carol',
  });

  // Tampered room in wire payload
  const tamperedRoomPayload = { ...payload, room: 'aad-different-room' };
  await assert.rejects(async () => {
    await decryptMessage({ key, payload: tamperedRoomPayload });
  });

  // Tampered id in wire payload
  const tamperedIdPayload = { ...payload, id: crypto.randomUUID() };
  await assert.rejects(async () => {
    await decryptMessage({ key, payload: tamperedIdPayload });
  });

  // Tampered protocol version
  const tamperedVersionPayload = { ...payload, v: 2 };
  await assert.rejects(async () => {
    await decryptMessage({ key, payload: tamperedVersionPayload });
  });
});

test('crypto: flipped ciphertext bit causes decryption to fail', async () => {
  const room = 'bitflip-room';
  const key = await deriveRoomKey({
    password: 'bitflip-password-test-12345',
    room,
    iterations: 300000,
  });

  const payload = await encryptMessage({
    key,
    room,
    text: 'Do not modify me',
    nickname: 'Dave',
  });

  // Decode ciphertext, flip one byte, re-encode
  const ctBytes = base64ToBytes(payload.ct);
  ctBytes[0] ^= 0x01; // flip 1 bit
  const tamperedCt = bytesToBase64(ctBytes);

  const tamperedPayload = { ...payload, ct: tamperedCt };
  await assert.rejects(async () => {
    await decryptMessage({ key, payload: tamperedPayload });
  });
});

test('crypto: reply metadata and user ID roundtrip cleanly in encrypted payload', async () => {
  const room = 'reply-room';
  const key = await deriveRoomKey({
    password: 'reply-password-test-12345',
    room,
    iterations: 300000,
  });

  const replyContext = {
    id: 'original-uuid-1234',
    nickname: 'Eve',
    text: 'What is the secret passkey?',
  };

  const payload = await encryptMessage({
    key,
    room,
    text: 'It is strictly encrypted!',
    nickname: 'Frank',
    userId: 'USR-7F3A',
    replyTo: replyContext,
  });

  const decrypted = await decryptMessage({ key, payload });
  assert.equal(decrypted.text, 'It is strictly encrypted!');
  assert.equal(decrypted.nickname, 'Frank');
  assert.equal(decrypted.userId, 'USR-7F3A');
  assert.ok(decrypted.replyTo);
  assert.equal(decrypted.replyTo.id, 'original-uuid-1234');
  assert.equal(decrypted.replyTo.nickname, 'Eve');
  assert.equal(decrypted.replyTo.text, 'What is the secret passkey?');
});

test('crypto: client-side encrypted file attachment roundtrips with intact binary data', async () => {
  const room = 'file-chamber';
  const key = await deriveRoomKey({
    password: 'file-encryption-test-pass-1234',
    room,
    iterations: 300000,
  });

  const filePayload = {
    name: 'secret-document.png',
    type: 'image/png',
    size: 1024,
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  };

  const payload = await encryptMessage({
    key,
    room,
    text: 'Check out this encrypted visual asset',
    nickname: 'Grace',
    userId: 'USR-FILE1',
    file: filePayload,
  });

  const decrypted = await decryptMessage({ key, payload });
  assert.equal(decrypted.nickname, 'Grace');
  assert.equal(decrypted.text, 'Check out this encrypted visual asset');
  assert.ok(decrypted.file);
  assert.equal(decrypted.file.name, 'secret-document.png');
  assert.equal(decrypted.file.type, 'image/png');
  assert.equal(decrypted.file.size, 1024);
  assert.equal(decrypted.file.data, filePayload.data);
});

test('crypto: computeSafetyNumber is deterministic for identical keys and rooms', async () => {
  const room = 'verification-room-alpha';
  const pass = 'super-secret-room-pass-998877';

  const key1 = await deriveRoomKey({ password: pass, roomName: room, iterations: 300000 });
  const key2 = await deriveRoomKey({ password: pass, roomName: room, iterations: 300000 });

  const sn1 = await computeSafetyNumber({ key: key1, room });
  const sn2 = await computeSafetyNumber({ key: key2, room });

  assert.ok(sn1.numeric);
  assert.ok(sn1.hex);
  assert.ok(sn1.rawHex);

  // Must match exactly
  assert.equal(sn1.numeric, sn2.numeric, 'Numeric safety numbers must match for identical key');
  assert.equal(sn1.hex, sn2.hex, 'Hex safety numbers must match for identical key');
  assert.equal(sn1.rawHex, sn2.rawHex);

  // Check 60-digit formatting (12 groups of 5 digits separated by spaces)
  const numericGroups = sn1.numeric.split(' ');
  assert.equal(numericGroups.length, 12, 'Must have 12 numeric groups');
  for (const group of numericGroups) {
    assert.equal(group.length, 5, 'Each numeric group must have 5 digits');
    assert.match(group, /^\d{5}$/, 'Each group must consist of decimal digits');
  }
});

test('crypto: computeSafetyNumber differs for distinct keys and detects MITM/wrong key', async () => {
  const room = 'verification-room-beta';
  const keyAlice = await deriveRoomKey({ password: 'alice-room-password-112233', roomName: room, iterations: 300000 });
  const keyEve = await deriveRoomKey({ password: 'eve-injected-password-445566', roomName: room, iterations: 300000 });

  const snAlice = await computeSafetyNumber({ key: keyAlice, room });
  const snEve = await computeSafetyNumber({ key: keyEve, room });

  assert.notEqual(snAlice.numeric, snEve.numeric, 'Different keys must have different safety numbers');
  assert.notEqual(snAlice.hex, snEve.hex, 'Different keys must have different hex fingerprints');
});

test('crypto: encryptFileAttachment and decryptFileAttachment roundtrip with SHA-256 verification', async () => {
  const originalData = 'VGhpcyBpcyBhbiBlbmNyeXB0ZWQgZmlsZSBjb250ZW50IHRlc3Qh'; // "This is an encrypted file content test!" in base64
  const encResult = await encryptFileAttachment({
    data: originalData,
    name: 'financial-report.pdf',
    type: 'application/pdf',
    size: 42,
  });

  assert.ok(encResult.fileKey, 'File key must be generated');
  assert.ok(encResult.fileIv, 'File IV must be generated');
  assert.ok(encResult.fileHash, 'Plaintext SHA-256 hash must be generated');
  assert.notEqual(encResult.data, originalData, 'Ciphertext must differ from plaintext');

  // Decrypt with correct keys
  const decrypted = await decryptFileAttachment({
    data: encResult.data,
    fileKey: encResult.fileKey,
    fileIv: encResult.fileIv,
    fileHash: encResult.fileHash,
  });

  assert.equal(decrypted, originalData, 'Decrypted file data must match original plaintext');

  // Tampered ciphertext must fail decryption or integrity verification
  const tamperedCipherBytes = base64ToBytes(encResult.data);
  tamperedCipherBytes[0] ^= 0x01;
  const tamperedData = bytesToBase64(tamperedCipherBytes);

  await assert.rejects(
    async () => {
      await decryptFileAttachment({
        data: tamperedData,
        fileKey: encResult.fileKey,
        fileIv: encResult.fileIv,
        fileHash: encResult.fileHash,
      });
    },
    (err) => err instanceof Error,
    'Tampered file data must throw on decryption'
  );
});

test('crypto: CRYPTO_SPEC constants match security requirements', () => {
  assert.equal(CRYPTO_SPEC.PROTOCOL_VERSION, 1);
  assert.equal(CRYPTO_SPEC.ALGORITHM, 'AES-256-GCM');
  assert.equal(CRYPTO_SPEC.KEY_LENGTH_BITS, 256);
  assert.equal(CRYPTO_SPEC.KDF_ITERATIONS, 600000);
  assert.equal(CRYPTO_SPEC.TAG_LENGTH_BITS, 128);
  assert.equal(CRYPTO_SPEC.IV_LENGTH_BYTES, 12);
  assert.equal(CRYPTO_SPEC.EXTRACTABLE, false);
});

test('crypto: encryptTypingSignal and decryptTypingSignal roundtrip successfully with AAD binding', async () => {
  const key = await deriveRoomKey({
    password: 'secure-password-for-typing-test-1234',
    roomName: 'room-typing-test',
    iterations: 300000,
  });

  const signal = await encryptTypingSignal({
    key,
    room: 'room-typing-test',
    isTyping: true,
    userId: 'USR-TYP1',
    nickname: 'Grace',
    ttl: 3000,
  });

  assert.ok(signal.ciphertext, 'Ciphertext must be present');
  assert.ok(signal.iv, 'IV must be present');
  assert.equal(signal.ttl, 3000);

  const decrypted = await decryptTypingSignal({
    key,
    room: 'room-typing-test',
    ciphertext: signal.ciphertext,
    iv: signal.iv,
  });

  assert.ok(decrypted, 'Decrypted signal must not be null');
  assert.equal(decrypted.isTyping, true);
  assert.equal(decrypted.userId, 'USR-TYP1');
  assert.equal(decrypted.nickname, 'Grace');
  assert.equal(decrypted.ttl, 3000);
});

test('crypto: decryptTypingSignal returns null on tampered ciphertext, bad key, or wrong room (fails closed)', async () => {
  const keyA = await deriveRoomKey({
    password: 'password-client-alpha-12345',
    roomName: 'room-typing-test',
    iterations: 300000,
  });
  const keyB = await deriveRoomKey({
    password: 'password-client-bravo-12345',
    roomName: 'room-typing-test',
    iterations: 300000,
  });

  const signal = await encryptTypingSignal({
    key: keyA,
    room: 'room-typing-test',
    isTyping: true,
    userId: 'USR-TYP2',
    nickname: 'Bob',
    ttl: 3000,
  });

  // Decrypt with wrong key -> returns null
  const withWrongKey = await decryptTypingSignal({
    key: keyB,
    room: 'room-typing-test',
    ciphertext: signal.ciphertext,
    iv: signal.iv,
  });
  assert.equal(withWrongKey, null, 'Decrypt with wrong key must return null (fail closed)');

  // Decrypt with wrong room (AAD mismatch) -> returns null
  const withWrongRoom = await decryptTypingSignal({
    key: keyA,
    room: 'wrong-room-name',
    ciphertext: signal.ciphertext,
    iv: signal.iv,
  });
  assert.equal(withWrongRoom, null, 'Decrypt with mismatched room AAD must return null');

  // Decrypt with tampered ciphertext bit -> returns null
  const cipherBytes = base64ToBytes(signal.ciphertext);
  cipherBytes[0] ^= 0x01;
  const tamperedCiphertext = bytesToBase64(cipherBytes);

  const withTamperedCipher = await decryptTypingSignal({
    key: keyA,
    room: 'room-typing-test',
    ciphertext: tamperedCiphertext,
    iv: signal.iv,
  });
  assert.equal(withTamperedCipher, null, 'Tampered ciphertext must fail closed and return null');
});

test('crypto: generateIdentityKeyPair generates non-extractable ECDSA P-256 keypair and SPKI public key', async () => {
  const kp = await generateIdentityKeyPair();
  assert.ok(kp);
  assert.ok(kp.publicKey);
  assert.ok(kp.privateKey);
  assert.equal(kp.privateKey.extractable, false);
  assert.equal(kp.privateKey.algorithm.name, 'ECDSA');
  assert.equal(kp.privateKey.algorithm.namedCurve, 'P-256');
  assert.ok(kp.publicKeySpki);
  assert.ok(kp.fingerprintHex);
  assert.equal(kp.fingerprintHex.length, 64);
});

test('crypto: computeIdentitySafetyNumber is deterministic for public key and detects key substitution', async () => {
  const kp1 = await generateIdentityKeyPair();
  const kp2 = await generateIdentityKeyPair();

  const sn1 = await computeIdentitySafetyNumber({ publicKeySpki: kp1.publicKeySpki });
  const sn1Again = await computeIdentitySafetyNumber({ publicKeySpki: kp1.publicKeySpki });
  const sn2 = await computeIdentitySafetyNumber({ publicKeySpki: kp2.publicKeySpki });

  assert.equal(sn1.type, 'participant-identity');
  assert.equal(sn1.numeric, sn1Again.numeric);
  assert.equal(sn1.hex, sn1Again.hex);
  assert.notEqual(sn1.numeric, sn2.numeric, 'Distinct identity keys must yield distinct safety numbers');
  assert.notEqual(sn1.hex, sn2.hex);
});

test('crypto: computePairwiseSafetyNumber is symmetric, deterministic, and distinct for different key pairs', async () => {
  const alice = await generateIdentityKeyPair();
  const bob = await generateIdentityKeyPair();
  const eve = await generateIdentityKeyPair();

  // Symmetric: party order must not change the pairwise safety number
  const snAliceBob = await computePairwiseSafetyNumber({
    myPublicKeySpki: alice.publicKeySpki,
    peerPublicKeySpki: bob.publicKeySpki,
    room: 'direct-room',
  });
  const snBobAlice = await computePairwiseSafetyNumber({
    myPublicKeySpki: bob.publicKeySpki,
    peerPublicKeySpki: alice.publicKeySpki,
    room: 'direct-room',
  });

  assert.equal(snAliceBob.type, 'pairwise-peer-identity');
  assert.equal(snAliceBob.numeric, snBobAlice.numeric);
  assert.equal(snAliceBob.hex, snBobAlice.hex);

  // Distinct pair yields distinct safety number
  const snAliceEve = await computePairwiseSafetyNumber({
    myPublicKeySpki: alice.publicKeySpki,
    peerPublicKeySpki: eve.publicKeySpki,
    room: 'direct-room',
  });
  assert.notEqual(snAliceBob.numeric, snAliceEve.numeric);
});

test('crypto: computeSafetyNumber correctly reports type shared-room-key', async () => {
  const key = await deriveRoomKey({
    password: 'room-passkey-long-1234',
    roomName: 'main-room',
    iterations: 300000,
  });
  const res = await computeSafetyNumber({ key, room: 'main-room' });
  assert.equal(res.type, 'shared-room-key');
  assert.ok(res.note.includes('shared room key'));
});

test('crypto: encryptMessage with identityKeyPair produces verifiable ECDSA signature', async () => {
  const key = await deriveRoomKey({
    password: 'room-passkey-long-1234',
    roomName: 'main-room',
    iterations: 300000,
  });
  const alice = await generateIdentityKeyPair();

  const encrypted = await encryptMessage({
    key,
    room: 'main-room',
    text: 'Hello from authenticated Alice',
    nickname: 'Alice',
    userId: 'USR-ALICE',
    identityKeyPair: alice,
  });

  const decrypted = await decryptMessage({
    key,
    payload: encrypted,
  });

  assert.equal(decrypted.isSigned, true);
  assert.equal(decrypted.senderPublicKeySpki, alice.publicKeySpki);
  assert.equal(decrypted.text, 'Hello from authenticated Alice');
  assert.equal(decrypted.userId, 'USR-ALICE');
});

test('crypto: decryptMessage detects forged sender signature or tampered content and rejects', async () => {
  const key = await deriveRoomKey({
    password: 'room-passkey-long-1234',
    roomName: 'main-room',
    iterations: 300000,
  });
  const alice = await generateIdentityKeyPair();
  const eve = await generateIdentityKeyPair();

  // Alice encrypts message
  const encrypted = await encryptMessage({
    key,
    room: 'main-room',
    text: 'Legitimate message from Alice',
    nickname: 'Alice',
    userId: 'USR-ALICE',
    identityKeyPair: alice,
  });

  // Decrypt inner payload using room key to simulate malicious inner modification
  // In a shared room, Eve knows the room key, so Eve could try to re-encrypt Alice's message claiming Alice's userId but signed with Eve's key or with invalid signature
  const fakeInner = JSON.stringify({
    n: 'Alice',
    t: 'Forged text by Eve pretending to be Alice',
    ts: Date.now(),
    u: 'USR-ALICE',
    sig: 'invalid-signature-bytes==',
    spki: eve.publicKeySpki, // Eve's key substituted for Alice
  });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`pcr|1|main-room|${encrypted.id}`);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    key,
    new TextEncoder().encode(fakeInner)
  );

  const forgedPayload = {
    v: 1,
    id: encrypted.id,
    room: 'main-room',
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(cipherBuffer)),
  };

  // decryptMessage must throw SENDER_SIGNATURE_VERIFICATION_FAILED
  await assert.rejects(
    async () => {
      await decryptMessage({ key, payload: forgedPayload });
    },
    (err) => err instanceof Error && err.message === 'SENDER_SIGNATURE_VERIFICATION_FAILED'
  );
});

test('crypto: IdentityRegistry detects new identity, trusted matching key, nickname updates, and key substitution (impersonation)', () => {
  const registry = new IdentityRegistry();

  // 1. First seen Alice -> TRUSTED_NEW
  const reg1 = registry.registerOrVerify({
    userId: 'usr-1',
    nickname: 'Alice',
    publicKeySpki: 'SPKI_ALICE_KEY_AAA',
  });
  assert.equal(reg1.status, 'TRUSTED_NEW');

  // 2. Alice sends another message with same key -> TRUSTED
  const reg2 = registry.registerOrVerify({
    userId: 'usr-1',
    nickname: 'Alice',
    publicKeySpki: 'SPKI_ALICE_KEY_AAA',
  });
  assert.equal(reg2.status, 'TRUSTED');
  assert.equal(reg2.warning, null);

  // 3. Alice updates nickname -> TRUSTED with NICKNAME_CHANGED warning
  const reg3 = registry.registerOrVerify({
    userId: 'usr-1',
    nickname: 'Alice In Wonderland',
    publicKeySpki: 'SPKI_ALICE_KEY_AAA',
  });
  assert.equal(reg3.status, 'TRUSTED');
  assert.equal(reg3.warning, 'NICKNAME_CHANGED');
  assert.equal(reg3.oldNickname, 'Alice');

  // 4. Impersonation attempt: Someone sends with usr-1 claiming to be Alice but with a DIFFERENT key!
  const reg4 = registry.registerOrVerify({
    userId: 'usr-1',
    nickname: 'Alice',
    publicKeySpki: 'SPKI_EVE_KEY_BBB',
  });
  assert.equal(reg4.status, 'KEY_CHANGED');
  assert.ok(reg4.warning.includes('IDENTITY_SUBSTITUTION_DETECTED'));
});

test('crypto: encryptTypingSignal binds signalId, ttl, and signs with identityKeyPair', async () => {
  const key = await deriveRoomKey({
    password: 'room-passkey-long-1234',
    roomName: 'main-room',
    iterations: 300000,
  });
  const alice = await generateIdentityKeyPair();

  const signal = await encryptTypingSignal({
    key,
    room: 'main-room',
    isTyping: true,
    userId: 'USR-ALICE',
    nickname: 'Alice',
    ttl: 3500,
    identityKeyPair: alice,
  });

  assert.ok(signal.ciphertext);
  assert.ok(signal.iv);
  assert.equal(signal.ttl, 3500);
  assert.ok(signal.signalId);

  const decrypted = await decryptTypingSignal({
    key,
    room: 'main-room',
    ciphertext: signal.ciphertext,
    iv: signal.iv,
  });

  assert.ok(decrypted);
  assert.equal(decrypted.isTyping, true);
  assert.equal(decrypted.userId, 'USR-ALICE');
  assert.equal(decrypted.nickname, 'Alice');
  assert.equal(decrypted.ttl, 3500);
  assert.equal(decrypted.isSigned, true);
  assert.equal(decrypted.senderSpki, alice.publicKeySpki);
});

test('crypto: decryptTypingSignal verifies ECDSA signature, rejects forged signatures (fails closed)', async () => {
  const key = await deriveRoomKey({
    password: 'room-passkey-long-1234',
    roomName: 'main-room',
    iterations: 300000,
  });
  const alice = await generateIdentityKeyPair();
  const eve = await generateIdentityKeyPair();

  // Signal encrypted with Alice's identity
  const signal = await encryptTypingSignal({
    key,
    room: 'main-room',
    isTyping: true,
    userId: 'USR-ALICE',
    nickname: 'Alice',
    identityKeyPair: alice,
  });

  // Decrypts cleanly with Alice's valid signature
  const valid = await decryptTypingSignal({
    key,
    room: 'main-room',
    ciphertext: signal.ciphertext,
    iv: signal.iv,
  });
  assert.ok(valid);
  assert.equal(valid.isSigned, true);

  // Forged signature simulation: Eve crafts a typing signal claiming to be Alice but with forged signature
  const fakeInner = JSON.stringify({
    v: 1,
    type: 'typing_signal',
    room: 'main-room',
    isTyping: true,
    userId: 'USR-ALICE',
    nickname: 'Alice',
    timestamp: Date.now(),
    ttl: 3000,
    signalId: 'sig-fake-123',
    sig: 'invalid-signature-bytes==',
    spki: alice.publicKeySpki,
  });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode('typ:v1:main-room');
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    key,
    new TextEncoder().encode(fakeInner)
  );

  const forgedResult = await decryptTypingSignal({
    key,
    room: 'main-room',
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
    iv: bytesToBase64(iv),
  });
  assert.equal(forgedResult, null, 'Forged signature must fail closed and return null');
});

test('crypto: TypingReplayDetector drops duplicate signalId (exact envelope replay)', () => {
  const detector = new TypingReplayDetector();
  const now = Date.now();

  const first = detector.checkAndRecord({
    signalId: 'sig-unique-001',
    userId: 'usr-1',
    timestamp: now,
    ttl: 3000,
  });
  assert.equal(first.valid, true);

  // Exact duplicate signalId
  const replay = detector.checkAndRecord({
    signalId: 'sig-unique-001',
    userId: 'usr-1',
    timestamp: now,
    ttl: 3000,
  });
  assert.equal(replay.valid, false);
  assert.equal(replay.reason, 'DUPLICATE_SIGNAL_ID');
});

test('crypto: TypingReplayDetector rejects expired timestamps and future timestamps beyond clock skew', () => {
  const detector = new TypingReplayDetector();
  const now = Date.now();

  // Expired timestamp: 10 seconds ago with 3000ms TTL
  const expired = detector.checkAndRecord({
    signalId: 'sig-old-1',
    userId: 'usr-1',
    timestamp: now - 10000,
    ttl: 3000,
  });
  assert.equal(expired.valid, false);
  assert.equal(expired.reason, 'EXPIRED_TIMESTAMP');

  // Future timestamp: 5 seconds in future (exceeding 1000ms skew allowance)
  const future = detector.checkAndRecord({
    signalId: 'sig-future-1',
    userId: 'usr-1',
    timestamp: now + 5000,
    ttl: 3000,
  });
  assert.equal(future.valid, false);
  assert.equal(future.reason, 'FUTURE_TIMESTAMP');
});

test('crypto: TypingReplayDetector rejects out-of-order timestamps and sequence replays per sender', () => {
  const detector = new TypingReplayDetector();
  const now = Date.now();

  // Signal at t=100
  const t1 = detector.checkAndRecord({
    signalId: 'sig-seq-1',
    userId: 'usr-2',
    timestamp: now,
    seq: 1,
    ttl: 3000,
  });
  assert.equal(t1.valid, true);

  // Out of order: older timestamp t=now-500
  const older = detector.checkAndRecord({
    signalId: 'sig-seq-2',
    userId: 'usr-2',
    timestamp: now - 500,
    seq: 0,
    ttl: 3000,
  });
  assert.equal(older.valid, false);
  assert.equal(older.reason, 'OUT_OF_ORDER_TIMESTAMP');

  // Replayed sequence with same timestamp
  const replayedSeq = detector.checkAndRecord({
    signalId: 'sig-seq-3',
    userId: 'usr-2',
    timestamp: now,
    seq: 1,
    ttl: 3000,
  });
  assert.equal(replayedSeq.valid, false);
  assert.equal(replayedSeq.reason, 'REPLAYED_SEQUENCE');
});

test('crypto: TypingReplayDetector handles client reconnect with fresh timestamp while rejecting old replayed signals', () => {
  const detector = new TypingReplayDetector();
  const tPreReconnect = Date.now() - 5000;

  // Signal before disconnect
  detector.checkAndRecord({
    signalId: 'sig-pre-disconnect',
    userId: 'usr-3',
    timestamp: tPreReconnect,
    seq: 1,
    ttl: 3000,
  });

  // Client reconnects after 5 seconds: reset sender state on disconnect
  detector.resetSender('usr-3');

  // Attacker tries to replay pre-disconnect signal -> rejected as expired or duplicate
  const replayOld = detector.checkAndRecord({
    signalId: 'sig-pre-disconnect',
    userId: 'usr-3',
    timestamp: tPreReconnect,
    seq: 1,
    ttl: 3000,
  });
  assert.equal(replayOld.valid, false);

  // Legitimate fresh signal after reconnect with current timestamp
  const freshPost = detector.checkAndRecord({
    signalId: 'sig-post-reconnect',
    userId: 'usr-3',
    timestamp: Date.now(),
    seq: 1,
    ttl: 3000,
  });
  assert.equal(freshPost.valid, true);
});

test('crypto: decryptTypingSignal enforces receiver-side maximum TTL ceiling (5000ms)', async () => {
  const key = await deriveRoomKey({
    password: 'room-passkey-long-1234',
    roomName: 'main-room',
    iterations: 300000,
  });

  // Sender or attacker attempts inflated TTL of 60,000ms
  const signal = await encryptTypingSignal({
    key,
    room: 'main-room',
    isTyping: true,
    userId: 'USR-INFLATED',
    nickname: 'Test',
    ttl: 60000, // Attacker passes 60s
  });

  // Receiver-enforced ceiling caps TTL at 5000ms
  const decrypted = await decryptTypingSignal({
    key,
    room: 'main-room',
    ciphertext: signal.ciphertext,
    iv: signal.iv,
  });

  assert.ok(decrypted);
  assert.equal(decrypted.ttl, 5000, 'Receiver must cap TTL at maximum 5000ms');
});

test('crypto: PBKDF2 parameters enforce 600,000 iterations default, context separation, and NFKC normalization', async () => {
  assert.equal(CRYPTO_SPEC.KDF_ITERATIONS, 600000);
  assert.equal(CRYPTO_SPEC.BACKUP_KDF_ITERATIONS, 300000);

  // Unicode NFKC normalization: composed vs decomposed derive identical key
  const composedPass = 'Caf\u00E9-Secret-Key-1234'; // é as single code point
  const decomposedPass = 'Cafe\u0301-Secret-Key-1234'; // e + combining acute accent

  const keyComposed = await deriveRoomKey({
    password: composedPass,
    roomName: 'unicode-room',
    iterations: 300000,
  });
  const keyDecomposed = await deriveRoomKey({
    password: decomposedPass,
    roomName: 'unicode-room',
    iterations: 300000,
  });

  const fp1 = await computeSafetyNumber({ key: keyComposed, room: 'unicode-room' });
  const fp2 = await computeSafetyNumber({ key: keyDecomposed, room: 'unicode-room' });
  assert.equal(fp1.numeric, fp2.numeric, 'NFKC normalized passwords must produce identical keys');

  // Context separation: distinct rooms produce distinct keys even with identical passwords
  const keyRoomB = await deriveRoomKey({
    password: composedPass,
    roomName: 'different-room',
    iterations: 300000,
  });
  const fpRoomB = await computeSafetyNumber({ key: keyRoomB, room: 'different-room' });
  assert.notEqual(fp1.numeric, fpRoomB.numeric, 'Domain-separated salts must produce distinct keys across rooms');
});

test('crypto: PROTOCOL_GUARANTEES accurately document security invariants and architecture boundaries', () => {
  assert.ok(PROTOCOL_GUARANTEES.ARCHITECTURE);
  assert.ok(PROTOCOL_GUARANTEES.CONFIDENTIALITY);
  assert.ok(PROTOCOL_GUARANTEES.SENDER_AUTHENTICATION);
  assert.ok(PROTOCOL_GUARANTEES.FORWARD_SECRECY.includes('LIMITED'));
  assert.ok(PROTOCOL_GUARANTEES.POST_COMPROMISE_SECURITY.includes('LIMITED'));
  assert.ok(PROTOCOL_GUARANTEES.HARDWARE_RAM_ERASURE.includes('NOT GUARANTEED'));
});

test('crypto: decryptTypingSignal rejects envelope signalId tampering (fails closed)', async () => {
  const key = await deriveRoomKey({
    password: 'room-passkey-long-1234',
    roomName: 'main-room',
    iterations: 300000,
  });
  const aliceIdentity = await generateIdentityKeyPair();

  const signal = await encryptTypingSignal({
    key,
    room: 'main-room',
    isTyping: true,
    userId: 'USR-ALICE',
    nickname: 'Alice',
    ttl: 3000,
    identityKeyPair: aliceIdentity,
  });

  // Tampered envelope signalId: outside envelope claims a different signalId
  const tamperedResult = await decryptTypingSignal({
    key,
    room: 'main-room',
    ciphertext: signal.ciphertext,
    iv: signal.iv,
    ttl: signal.ttl,
    signalId: 'tampered-envelope-sig-id-999',
  });
  assert.equal(tamperedResult, null, 'Mismatched envelope signalId must fail closed (return null)');

  // Matching envelope signalId succeeds
  const validResult = await decryptTypingSignal({
    key,
    room: 'main-room',
    ciphertext: signal.ciphertext,
    iv: signal.iv,
    ttl: signal.ttl,
    signalId: signal.signalId,
  });
  assert.ok(validResult);
  assert.equal(validResult.signalId, signal.signalId);
});

test('crypto: decryptTypingSignal rejects unsigned signals attempting to spoof a known registered sender', async () => {
  const key = await deriveRoomKey({
    password: 'room-passkey-long-1234',
    roomName: 'main-room',
    iterations: 300000,
  });
  const aliceIdentity = await generateIdentityKeyPair();
  const identityRegistry = new IdentityRegistry();

  // 1. Alice registers her authenticated identity via a signed typing signal
  const legitAliceSignal = await encryptTypingSignal({
    key,
    room: 'main-room',
    isTyping: true,
    userId: 'USR-ALICE',
    nickname: 'Alice',
    ttl: 3000,
    identityKeyPair: aliceIdentity,
  });

  const legitResult = await decryptTypingSignal({
    key,
    room: 'main-room',
    ciphertext: legitAliceSignal.ciphertext,
    iv: legitAliceSignal.iv,
    identityRegistry,
  });
  assert.ok(legitResult);
  assert.equal(legitResult.isSigned, true);

  // 2. Attacker in the same room (with knowledge of room key) creates an unsigned typing signal claiming Alice's userId
  const spoofedSignal = await encryptTypingSignal({
    key,
    room: 'main-room',
    isTyping: true,
    userId: 'USR-ALICE', // Claiming Alice
    nickname: 'Alice',
    ttl: 3000,
    // Omitting identityKeyPair (unsigned)
  });

  const spoofResult = await decryptTypingSignal({
    key,
    room: 'main-room',
    ciphertext: spoofedSignal.ciphertext,
    iv: spoofedSignal.iv,
    identityRegistry,
  });
  assert.equal(spoofResult, null, 'Unsigned signal claiming known sender must be rejected to prevent spoofing');
});

test('crypto: decryptTypingSignal enforces expectedSenderId match', async () => {
  const key = await deriveRoomKey({
    password: 'room-passkey-long-1234',
    roomName: 'main-room',
    iterations: 300000,
  });

  const signal = await encryptTypingSignal({
    key,
    room: 'main-room',
    isTyping: true,
    userId: 'USR-BOB',
    nickname: 'Bob',
    ttl: 3000,
  });

  // Mismatched expected sender
  const mismatched = await decryptTypingSignal({
    key,
    room: 'main-room',
    ciphertext: signal.ciphertext,
    iv: signal.iv,
    expectedSenderId: 'USR-CHARLIE',
  });
  assert.equal(mismatched, null, 'Mismatched expectedSenderId must return null');

  // Matching expected sender
  const matched = await decryptTypingSignal({
    key,
    room: 'main-room',
    ciphertext: signal.ciphertext,
    iv: signal.iv,
    expectedSenderId: 'USR-BOB',
  });
  assert.ok(matched);
  assert.equal(matched.userId, 'USR-BOB');
});

test('crypto: encryptTypingSignal strictly requires sender identity (userId)', async () => {
  const key = await deriveRoomKey({
    password: 'room-passkey-long-1234',
    roomName: 'main-room',
    iterations: 300000,
  });

  // Missing userId must throw
  await assert.rejects(
    async () => {
      await encryptTypingSignal({
        key,
        room: 'main-room',
        isTyping: true,
      });
    },
    /Sender identity \(userId\) is required/
  );

  // Empty string userId must throw
  await assert.rejects(
    async () => {
      await encryptTypingSignal({
        key,
        room: 'main-room',
        userId: '   ',
        isTyping: true,
      });
    },
    /Sender identity \(userId\) is required/
  );
});

test('crypto: decryptTypingSignal rejects signals when sender key fails IdentityRegistry verification', async () => {
  const key = await deriveRoomKey({
    password: 'room-passkey-long-1234',
    roomName: 'main-room',
    iterations: 300000,
  });

  const legitimateAlice = await generateIdentityKeyPair();
  const attacker = await generateIdentityKeyPair();
  const identityRegistry = new IdentityRegistry();

  // Register Alice's true key
  identityRegistry.registerOrVerify({
    userId: 'USR-ALICE',
    nickname: 'Alice',
    publicKeySpki: legitimateAlice.publicKeySpki,
  });

  // Attacker signs a signal claiming to be Alice using attacker's key
  const forgedSignal = await encryptTypingSignal({
    key,
    room: 'main-room',
    userId: 'USR-ALICE',
    nickname: 'Alice',
    isTyping: true,
    identityKeyPair: attacker,
  });

  const result = await decryptTypingSignal({
    key,
    room: 'main-room',
    ciphertext: forgedSignal.ciphertext,
    iv: forgedSignal.iv,
    identityRegistry,
  });

  assert.equal(result, null, 'Typing signal with substituted key must fail closed against IdentityRegistry');
});

test('crypto: decryptTypingSignal ignores untrusted relay envelope TTL and caps at receiver maximum TTL', async () => {
  const key = await deriveRoomKey({
    password: 'room-passkey-long-1234',
    roomName: 'main-room',
    iterations: 300000,
  });
  const alice = await generateIdentityKeyPair();

  const legitSignal = await encryptTypingSignal({
    key,
    room: 'main-room',
    userId: 'USR-ALICE',
    nickname: 'Alice',
    isTyping: true,
    ttl: 2500,
    identityKeyPair: alice,
  });

  // Untrusted relay forwards inflated envelope TTL of 999999ms
  const decrypted = await decryptTypingSignal({
    key,
    room: 'main-room',
    ciphertext: legitSignal.ciphertext,
    iv: legitSignal.iv,
    ttl: 999999, // Malicious relay tries to inflate TTL to create stale typing state
    signalId: legitSignal.signalId,
  });

  assert.ok(decrypted);
  assert.equal(decrypted.ttl, 2500, 'Receiver must use authenticated TTL, ignoring relay envelope TTL');
});

test('crypto: decryptMessage detects message body tampering without metadata modification and rejects (P0 content binding)', async () => {
  const key = await deriveRoomKey({
    password: 'secure-room-password-1234',
    roomName: 'secure-vault',
    iterations: 300000,
  });
  const alice = await generateIdentityKeyPair();

  // Alice sends signed message
  const original = await encryptMessage({
    key,
    room: 'secure-vault',
    text: 'Genuine text from Alice: transfer 10 coins',
    nickname: 'Alice',
    userId: 'USR-ALICE',
    identityKeyPair: alice,
  });

  // Eve (sharing the room key) decrypts the inner payload
  const iv = base64ToBytes(original.iv);
  const ct = base64ToBytes(original.ct);
  const aad = new TextEncoder().encode(`pcr|1|secure-vault|${original.id}`);
  const decryptedInner = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    key,
    ct
  );
  const inner = JSON.parse(new TextDecoder().decode(decryptedInner));

  // Eve modifies ONLY the text (leaving Alice's signature, timestamp, and metadata intact)
  inner.t = 'Forged text by Eve: transfer 1000000 coins to Eve!';
  // Note: inner.cd is still Alice's original or Eve leaves it intact
  const tamperedBytes = new TextEncoder().encode(JSON.stringify(inner));
  const newIv = crypto.getRandomValues(new Uint8Array(12));
  const newCipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: newIv, additionalData: aad, tagLength: 128 },
    key,
    tamperedBytes
  );

  const tamperedPayload = {
    v: 1,
    id: original.id,
    room: 'secure-vault',
    iv: bytesToBase64(newIv),
    ct: bytesToBase64(new Uint8Array(newCipher)),
  };

  // Recipient MUST reject because the signature does not authenticate the altered text
  await assert.rejects(
    async () => {
      await decryptMessage({ key, payload: tamperedPayload });
    },
    (err) => err instanceof Error && err.message === 'SENDER_SIGNATURE_VERIFICATION_FAILED'
  );
});

test('crypto: decryptMessage detects attachment replacement while metadata remains intact', async () => {
  const key = await deriveRoomKey({
    password: 'secure-room-password-1234',
    roomName: 'secure-vault',
    iterations: 300000,
  });
  const alice = await generateIdentityKeyPair();

  const original = await encryptMessage({
    key,
    room: 'secure-vault',
    text: 'Here is the approved invoice',
    nickname: 'Alice',
    userId: 'USR-ALICE',
    identityKeyPair: alice,
    file: {
      name: 'invoice.pdf',
      type: 'application/pdf',
      size: 1024,
      data: 'base64-invoice-data==',
      fileHash: 'legit-invoice-sha256-hash==',
    },
  });

  // Eve intercepts and modifies attachment content hash inside room ciphertext
  const iv = base64ToBytes(original.iv);
  const ct = base64ToBytes(original.ct);
  const aad = new TextEncoder().encode(`pcr|1|secure-vault|${original.id}`);
  const decryptedInner = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    key,
    ct
  );
  const inner = JSON.parse(new TextDecoder().decode(decryptedInner));

  // Eve replaces attachment file hash with malicious payload
  inner.f.fh = 'malicious-malware-hash==';
  const tamperedBytes = new TextEncoder().encode(JSON.stringify(inner));
  const newIv = crypto.getRandomValues(new Uint8Array(12));
  const newCipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: newIv, additionalData: aad, tagLength: 128 },
    key,
    tamperedBytes
  );

  const tamperedPayload = {
    v: 1,
    id: original.id,
    room: 'secure-vault',
    iv: bytesToBase64(newIv),
    ct: bytesToBase64(new Uint8Array(newCipher)),
  };

  await assert.rejects(
    async () => {
      await decryptMessage({ key, payload: tamperedPayload });
    },
    (err) => err instanceof Error && err.message === 'SENDER_SIGNATURE_VERIFICATION_FAILED'
  );
});

test('crypto: computeMessageContentDigest is length-prefixed and prevents delimiter injection', async () => {
  // Case A: normal text
  const digestA = await computeMessageContentDigest({
    text: 'hello;rep_id:5:12345;',
    replyTo: null,
  });

  // Case B: malicious attempt to simulate serialized structure in text field
  const digestB = await computeMessageContentDigest({
    text: 'hello',
    replyTo: { id: '12345', nickname: 'Bob', text: 'hi' },
  });

  assert.notEqual(digestA, digestB, 'Length-prefixed encoding must prevent delimiter injection');
});

test('crypto: IdentityRegistry distinguishes FIRST_SEEN from VERIFIED and detects key change', async () => {
  const registry = new IdentityRegistry();
  const aliceKey1 = (await generateIdentityKeyPair()).publicKeySpki;
  const aliceKey2 = (await generateIdentityKeyPair()).publicKeySpki;

  // 1. First seen
  const first = registry.registerOrVerify({
    userId: 'USR-ALICE',
    nickname: 'Alice',
    publicKeySpki: aliceKey1,
  });
  assert.equal(first.trustLevel, 'FIRST_SEEN');
  assert.equal(registry.isVerified('USR-ALICE'), false);
  assert.equal(registry.getTrustStatus('USR-ALICE', aliceKey1), 'FIRST_SEEN');

  // 2. User verifies out-of-band safety number
  assert.equal(registry.markVerified('USR-ALICE'), true);
  assert.equal(registry.isVerified('USR-ALICE'), true);
  assert.equal(registry.getTrustStatus('USR-ALICE', aliceKey1), 'VERIFIED');

  // 3. New message with same key maintains VERIFIED
  const second = registry.registerOrVerify({
    userId: 'USR-ALICE',
    nickname: 'Alice',
    publicKeySpki: aliceKey1,
  });
  assert.equal(second.status, 'VERIFIED');
  assert.equal(second.trustLevel, 'VERIFIED');

  // 4. Substituted key triggers KEY_CHANGED
  const changed = registry.registerOrVerify({
    userId: 'USR-ALICE',
    nickname: 'Alice',
    publicKeySpki: aliceKey2,
  });
  assert.equal(changed.status, 'KEY_CHANGED');
  assert.equal(registry.getTrustStatus('USR-ALICE', aliceKey2), 'KEY_CHANGED');
});

test('crypto: decryptTypingSignal strictly rejects unsigned signals (mandatory sender authentication)', async () => {
  const key = await deriveRoomKey({
    password: 'typing-mandatory-auth-1234',
    roomName: 'main-room',
    iterations: 300000,
  });

  // Manually construct an unsigned typing signal ciphertext (as a malicious room member might craft)
  const unsignedInner = JSON.stringify({
    v: 1,
    type: 'typing_signal',
    room: 'main-room',
    isTyping: true,
    userId: 'USR-SPOOF',
    nickname: 'Spoofed User',
    timestamp: Date.now(),
    ttl: 3000,
    signalId: 'sig-unsigned-123',
    // Missing sig and spki
  });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode('typ:v1:main-room');
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    key,
    new TextEncoder().encode(unsignedInner)
  );

  const unsignedSignal = {
    key,
    room: 'main-room',
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
    iv: bytesToBase64(iv),
    ttl: 3000,
    signalId: 'sig-unsigned-123',
  };

  const result = await decryptTypingSignal(unsignedSignal);
  assert.equal(result, null, 'Unsigned typing signal MUST be rejected (mandatory authentication)');
});

test('crypto: generateRandomSalt produces unique salts and distinct keys per room', async () => {
  const salt1 = generateRandomSalt(16);
  const salt2 = generateRandomSalt(16);
  assert.notEqual(salt1.base64, salt2.base64, 'Random salts must be distinct');

  const key1 = await deriveRoomKey({
    password: 'same-password-different-salts-1234',
    roomName: 'room-alpha',
    salt: salt1.base64,
    iterations: 300000,
  });

  const key2 = await deriveRoomKey({
    password: 'same-password-different-salts-1234',
    roomName: 'room-alpha',
    salt: salt2.base64,
    iterations: 300000,
  });

  const fp1 = await computeSafetyNumber({ key: key1, room: 'room-alpha' });
  const fp2 = await computeSafetyNumber({ key: key2, room: 'room-alpha' });
  assert.notEqual(fp1.numeric, fp2.numeric, 'Distinct random salts must derive distinct keys');
});

test('crypto: deriveEpochKey and message epoch handling enforces member revocation forward security', async () => {
  const salt = generateRandomSalt(16);
  const password = 'group-passkey-epoch-rotation-1234';
  const alice = await generateIdentityKeyPair();

  // Epoch 1 key (held by Alice, Bob, and Eve)
  const epoch1Key = await deriveEpochKey({
    password,
    roomName: 'project-room',
    salt: salt.base64,
    epoch: 1,
    iterations: 300000,
  });

  // Eve is evicted at end of Epoch 1.
  // Remaining members (Alice and Bob) transition to Epoch 2:
  const epoch2Key = await deriveEpochKey({
    password,
    roomName: 'project-room',
    salt: salt.base64,
    epoch: 2,
    iterations: 300000,
  });

  // Alice sends message in Epoch 2
  const epoch2Message = await encryptMessage({
    key: epoch2Key,
    room: 'project-room',
    text: 'Confidential message after Eve was evicted',
    nickname: 'Alice',
    userId: 'USR-ALICE',
    identityKeyPair: alice,
    epoch: 2,
  });

  // Remaining member Bob decrypts with Epoch 2 key -> Success
  const bobDecrypted = await decryptMessage({
    key: epoch2Key,
    payload: epoch2Message,
    expectedEpoch: 2,
  });
  assert.equal(bobDecrypted.text, 'Confidential message after Eve was evicted');
  assert.equal(bobDecrypted.epoch, 2);

  // Evicted member Eve attempts to decrypt with Epoch 1 key -> Must fail closed!
  await assert.rejects(
    async () => {
      await decryptMessage({
        key: epoch1Key,
        payload: epoch2Message,
        expectedEpoch: 1,
      });
    },
    (err) => err instanceof Error // AES-GCM tag verification fails because keys differ
  );
});

test('crypto: KDF iterations bounded to prevent excessive CPU DoS', async () => {
  const start = Date.now();
  // Attempting to pass 100,000,000 iterations must be clamped to 1,000,000 max
  const key = await deriveRoomKey({
    password: 'password-clamping-test-1234',
    roomName: 'speed-test',
    iterations: 100000000, // Malicious inflated parameter
  });
  const duration = Date.now() - start;
  assert.ok(key);
  // Clamped execution at 1,000,000 iterations typically takes < 2000ms
  assert.ok(duration < 5000, 'KDF execution time must remain bounded');
});



