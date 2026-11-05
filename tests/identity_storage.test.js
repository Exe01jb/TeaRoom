import test from 'node:test';
import assert from 'node:assert/strict';

import {
  saveIdentityKeyPair,
  loadIdentityKeyPair,
  loadOrCreateIdentityKeyPair,
  clearIdentityKeyPair,
  rotateIdentityKeyPair,
  exportIdentityBackup,
  importIdentityBackup,
  hasPersistedIdentity,
  getPersistedIdentitySync,
} from '../frontend/src/utils/identityStorage.js';

import {
  generateIdentityKeyPair,
  IdentityRegistry,
  encryptMessage,
  decryptMessage,
  deriveRoomKey,
} from '../frontend/src/utils/crypto.js';

test('identity-storage: saveIdentityKeyPair and loadIdentityKeyPair roundtrip ECDSA keypair', async () => {
  await clearIdentityKeyPair();

  const keyPair = await generateIdentityKeyPair({ extractable: true });
  const userId = 'USR-TEST-ALICE';

  const saveRes = await saveIdentityKeyPair({
    userId,
    keyPair,
  });
  assert.equal(saveRes.ok, true);
  assert.equal(saveRes.userId, userId);
  assert.equal(saveRes.publicKeySpki, keyPair.publicKeySpki);

  const loaded = await loadIdentityKeyPair();
  assert.ok(loaded, 'Should successfully load persisted identity');
  assert.equal(loaded.userId, userId);
  assert.equal(loaded.publicKeySpki, keyPair.publicKeySpki);
  assert.equal(loaded.fingerprintHex, keyPair.fingerprintHex);
  assert.ok(loaded.privateKey, 'Should have functional privateKey CryptoKey');
  assert.ok(loaded.publicKey, 'Should have functional publicKey CryptoKey');

  // Verify that loaded keys can sign and verify
  const sampleData = new TextEncoder().encode('Hello, TeaRoom persistence!');
  const signature = await globalThis.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    loaded.privateKey,
    sampleData
  );
  const isValid = await globalThis.crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    loaded.publicKey,
    signature,
    sampleData
  );
  assert.equal(isValid, true, 'Loaded key pair must successfully verify signatures');

  await clearIdentityKeyPair();
});

test('identity-storage: loadOrCreateIdentityKeyPair returns identical key across sessions without re-exchanging', async () => {
  await clearIdentityKeyPair();

  // First session: create identity
  const session1 = await loadOrCreateIdentityKeyPair({ userId: 'USR-RECONNECT-BOB' });
  assert.equal(session1.isNew, true);
  assert.equal(session1.userId, 'USR-RECONNECT-BOB');
  assert.ok(session1.publicKeySpki);
  assert.ok(session1.fingerprintHex);

  // Second session (simulating page refresh / reconnection): must load existing identity without re-generating
  const session2 = await loadOrCreateIdentityKeyPair({ userId: 'USR-RECONNECT-BOB' });
  assert.equal(session2.isNew, false);
  assert.equal(session2.userId, session1.userId);
  assert.equal(session2.publicKeySpki, session1.publicKeySpki, 'Public key SPKI must remain identical for seamless reconnection');
  assert.equal(session2.fingerprintHex, session1.fingerprintHex, 'Fingerprint must remain identical');

  // Verify that IdentityRegistry recognizes it as verified/trusted without triggering KEY_CHANGED
  const registry = new IdentityRegistry();
  const regResult1 = registry.registerOrVerify({
    userId: session1.userId,
    nickname: 'Bob',
    publicKeySpki: session1.publicKeySpki,
  });
  assert.equal(regResult1.status, 'TRUSTED_NEW');

  const regResult2 = registry.registerOrVerify({
    userId: session2.userId,
    nickname: 'Bob',
    publicKeySpki: session2.publicKeySpki,
  });
  assert.equal(regResult2.status, 'TRUSTED', 'Reconnecting user with persisted key must NOT trigger KEY_CHANGED');

  await clearIdentityKeyPair();
});

test('identity-storage: rotateIdentityKeyPair creates fresh key and updates storage', async () => {
  await clearIdentityKeyPair();

  const initial = await loadOrCreateIdentityKeyPair({ userId: 'USR-ROTATE-CHARLIE' });
  const rotated = await rotateIdentityKeyPair({ userId: 'USR-ROTATE-CHARLIE' });

  assert.notEqual(rotated.publicKeySpki, initial.publicKeySpki, 'Rotated key must have new public key SPKI');
  assert.notEqual(rotated.fingerprintHex, initial.fingerprintHex, 'Rotated key must have new fingerprint');

  // Subsequent load must return the rotated key
  const current = await loadIdentityKeyPair();
  assert.equal(current.publicKeySpki, rotated.publicKeySpki);

  await clearIdentityKeyPair();
});

test('identity-storage: clearIdentityKeyPair purges identity from storage', async () => {
  await clearIdentityKeyPair();

  await loadOrCreateIdentityKeyPair({ userId: 'USR-PURGE-DAVE' });
  const beforeClear = await loadIdentityKeyPair();
  assert.ok(beforeClear);

  await clearIdentityKeyPair();
  const afterClear = await loadIdentityKeyPair();
  assert.equal(afterClear, null, 'loadIdentityKeyPair must return null after clear');
});

test('identity-storage: exportIdentityBackup and importIdentityBackup preserves identity across devices', async () => {
  await clearIdentityKeyPair();

  const original = await loadOrCreateIdentityKeyPair({ userId: 'USR-BACKUP-EVE' });
  const backup = await exportIdentityBackup();

  assert.equal(backup.userId, original.userId);
  assert.equal(backup.publicKeySpki, original.publicKeySpki);
  assert.ok(backup.privateKeyJwk, 'Backup must contain privateKeyJwk');
  assert.ok(backup.publicKeyJwk, 'Backup must contain publicKeyJwk');

  // Clear local storage to simulate new device
  await clearIdentityKeyPair();
  assert.equal(await loadIdentityKeyPair(), null);

  // Restore from backup
  const imported = await importIdentityBackup(backup);
  assert.equal(imported.userId, original.userId);
  assert.equal(imported.publicKeySpki, original.publicKeySpki);
  assert.equal(imported.fingerprintHex, original.fingerprintHex);

  const reloaded = await loadIdentityKeyPair();
  assert.equal(reloaded.publicKeySpki, original.publicKeySpki);

  await clearIdentityKeyPair();
});

test('identity-storage: messages signed with loaded persistent identity encrypt and decrypt cleanly', async () => {
  await clearIdentityKeyPair();

  const senderIdentity = await loadOrCreateIdentityKeyPair({ userId: 'USR-PERSIST-FRANK' });

  const roomKey = await deriveRoomKey({
    password: 'secure-room-passkey-1234',
    roomName: 'main-lobby',
    iterations: 300000,
  });

  const encrypted = await encryptMessage({
    key: roomKey,
    room: 'main-lobby',
    text: 'Hello from reconnected client with persistent key!',
    nickname: 'Frank',
    userId: senderIdentity.userId,
    identityKeyPair: senderIdentity,
  });

  assert.ok(encrypted.ct);
  assert.ok(encrypted.iv);

  const registry = new IdentityRegistry();
  const decrypted = await decryptMessage({
    key: roomKey,
    payload: encrypted,
    identityRegistry: registry,
  });

  assert.ok(decrypted);
  assert.equal(decrypted.text, 'Hello from reconnected client with persistent key!');
  assert.equal(decrypted.userId, senderIdentity.userId);
  assert.equal(decrypted.senderPublicKeySpki, senderIdentity.publicKeySpki);
  assert.equal(decrypted.isSigned, true);
  assert.equal(decrypted.authStatus, 'FIRST_SEEN');

  await clearIdentityKeyPair();
});
