import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateDecryptedJsonExport,
  generateTextTranscriptExport,
  generateEncryptedBackupExport,
} from '../frontend/src/utils/exportChat.js';
import { base64ToBytes } from '../frontend/src/utils/crypto.js';

test('export: generateDecryptedJsonExport formats messages with complete metadata', () => {
  const sampleMessages = [
    {
      id: 'msg-1',
      timestamp: 1728590000000,
      nickname: 'Alice',
      userId: 'usr-1111',
      text: 'Hello confidential room!',
      isOwn: true,
      status: 'delivered',
    },
    {
      id: 'msg-2',
      timestamp: 1728590005000,
      nickname: 'Bob',
      userId: 'usr-2222',
      text: 'Encrypted reply received.',
      isOwn: false,
      status: 'read',
      replyTo: {
        id: 'msg-1',
        nickname: 'Alice',
        text: 'Hello confidential room!',
      },
      file: {
        name: 'secret.pdf',
        type: 'application/pdf',
        size: 1024,
      },
    },
  ];

  const exportData = generateDecryptedJsonExport({
    room: 'test-room',
    chatType: 'room',
    peerName: null,
    peerId: null,
    messages: sampleMessages,
  });

  assert.equal(exportData.exportVersion, 1);
  assert.equal(exportData.session.room, 'test-room');
  assert.equal(exportData.session.totalMessages, 2);
  assert.equal(exportData.messages.length, 2);
  assert.equal(exportData.messages[0].nickname, 'Alice');
  assert.equal(exportData.messages[1].replyTo.id, 'msg-1');
  assert.equal(exportData.messages[1].file.name, 'secret.pdf');
});

test('export: generateTextTranscriptExport formats human readable log with headers', () => {
  const sampleMessages = [
    {
      id: 'msg-1',
      timestamp: 1728590000000,
      nickname: 'Alice',
      userId: 'usr-1111',
      text: 'Top secret briefing notes.',
    },
  ];

  const transcript = generateTextTranscriptExport({
    room: 'secure-vault',
    chatType: 'room',
    messages: sampleMessages,
  });

  assert.ok(transcript.includes('SECURE CHAT TRANSCRIPT'));
  assert.ok(transcript.includes('#secure-vault'));
  assert.ok(transcript.includes('Alice'));
  assert.ok(transcript.includes('Top secret briefing notes.'));
  assert.ok(transcript.includes('END OF CHAT SESSION TRANSCRIPT'));
});

test('export: generateEncryptedBackupExport encrypts history and decrypts cleanly with passkey', async () => {
  const sampleMessages = [
    {
      id: 'msg-3',
      timestamp: 1728590010000,
      nickname: 'Charlie',
      userId: 'usr-3333',
      text: 'This should remain confidential in backup.',
    },
  ];

  const passphrase = 'my-super-secret-backup-passphrase-2026';
  const backup = await generateEncryptedBackupExport({
    room: 'vault-alpha',
    chatType: 'room',
    messages: sampleMessages,
    password: passphrase,
    iterations: 300000,
  });

  assert.equal(backup.format, 'pcr-encrypted-backup');
  assert.equal(backup.algorithm, 'AES-256-GCM');
  assert.equal(backup.version, 1);
  assert.ok(backup.salt);
  assert.ok(backup.iv);
  assert.ok(backup.ciphertext);

  // Verify decryption using Web Crypto
  const saltBytes = base64ToBytes(backup.salt);
  const ivBytes = base64ToBytes(backup.iv);
  const cipherBytes = base64ToBytes(backup.ciphertext);

  const subtle = globalThis.crypto.subtle;
  const passBytes = new TextEncoder().encode(passphrase.normalize('NFKC'));

  const baseKey = await subtle.importKey(
    'raw',
    passBytes,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const aesKey = await subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: backup.iterations,
      hash: 'SHA-256',
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['decrypt']
  );

  const aad = new TextEncoder().encode(`pcr-backup|v1|${backup.session.room}|${backup.exportedAt}`);
  const decryptedBuf = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes,
      additionalData: aad,
      tagLength: 128,
    },
    aesKey,
    cipherBytes
  );

  const recoveredJson = JSON.parse(new TextDecoder().decode(decryptedBuf));
  assert.equal(recoveredJson.session.room, 'vault-alpha');
  assert.equal(recoveredJson.messages[0].text, 'This should remain confidential in backup.');
});
