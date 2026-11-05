import test from 'node:test';
import assert from 'node:assert/strict';
import { EMOJI_CATEGORIES } from '../frontend/src/utils/emojiData.js';

test('emojis: categories are properly structured with required fields', () => {
  assert.ok(Array.isArray(EMOJI_CATEGORIES));
  assert.ok(EMOJI_CATEGORIES.length >= 6);

  const categoryIds = EMOJI_CATEGORIES.map((c) => c.id);
  assert.ok(categoryIds.includes('smileys'));
  assert.ok(categoryIds.includes('gestures'));
  assert.ok(categoryIds.includes('symbols'));
  assert.ok(categoryIds.includes('objects'));
  assert.ok(categoryIds.includes('animals'));
  assert.ok(categoryIds.includes('food'));

  for (const cat of EMOJI_CATEGORIES) {
    assert.ok(cat.id && typeof cat.id === 'string');
    assert.ok(cat.name && typeof cat.name === 'string');
    assert.ok(cat.icon && typeof cat.icon === 'string');
    assert.ok(Array.isArray(cat.emojis));
    assert.ok(cat.emojis.length > 0);

    for (const item of cat.emojis) {
      assert.ok(item.emoji && typeof item.emoji === 'string');
      assert.ok(item.name && typeof item.name === 'string');
      assert.ok(Array.isArray(item.keywords));
    }
  }
});

test('emojis: security and privacy emojis are present with accurate keywords', () => {
  const symbols = EMOJI_CATEGORIES.find((c) => c.id === 'symbols');
  assert.ok(symbols, 'symbols category must exist');

  const lock = symbols.emojis.find((e) => e.emoji === '🔒');
  assert.ok(lock, '🔒 emoji must exist');
  assert.ok(lock.keywords.includes('lock'));
  assert.ok(lock.keywords.includes('secure') || lock.keywords.includes('private'));

  const key = symbols.emojis.find((e) => e.emoji === '🔑');
  assert.ok(key, '🔑 emoji must exist');
  assert.ok(key.keywords.includes('passkey') || key.keywords.includes('password'));

  const shield = symbols.emojis.find((e) => e.emoji === '🛡️');
  assert.ok(shield, '🛡️ emoji must exist');
  assert.ok(shield.keywords.includes('protect') || shield.keywords.includes('security'));
});

test('emojis: search matching finds relevant emojis across names and keywords', () => {
  const query = 'fire';
  const matches = [];

  for (const cat of EMOJI_CATEGORIES) {
    for (const item of cat.emojis) {
      const matchName = item.name.toLowerCase().includes(query);
      const matchKeywords = item.keywords.some((k) => k.toLowerCase().includes(query));
      if (matchName || matchKeywords || item.emoji === query) {
        matches.push(item);
      }
    }
  }

  assert.ok(matches.length > 0);
  assert.ok(matches.some((m) => m.emoji === '🔥'));
});

test('emojis: no third-party network or CDN imports in EmojiPicker', async () => {
  const fs = await import('node:fs');
  const code = fs.readFileSync(new URL('../frontend/src/components/EmojiPicker.jsx', import.meta.url), 'utf-8');

  // Verify zero external network / telemetry requests
  assert.equal(code.includes('http://'), false);
  assert.equal(code.includes('https://'), false);
  assert.equal(code.includes('emoji-mart'), false);
  assert.equal(code.includes('cdn'), false);
  assert.equal(code.includes('unpkg'), false);
});

test('emojis: encryptReaction and decryptReaction work end-to-end with ECDSA signature verification', async () => {
  const {
    deriveRoomKey,
    encryptReaction,
    decryptReaction,
    generateIdentityKeyPair,
    IdentityRegistry,
  } = await import('../frontend/src/utils/crypto.js');

  const key = await deriveRoomKey({
    password: 'secure-room-password-reactions-1234',
    roomName: 'reaction-room',
    iterations: 300000,
  });

  const alice = await generateIdentityKeyPair();
  const registry = new IdentityRegistry();

  const reactionPayload = await encryptReaction({
    key,
    room: 'reaction-room',
    targetMessageId: '11111111-2222-4333-8444-555555555555',
    emoji: '🔥',
    action: 'add',
    userId: 'USR-ALICE',
    nickname: 'Alice',
    identityKeyPair: alice,
  });

  assert.ok(reactionPayload.ct);
  assert.ok(reactionPayload.iv);
  assert.equal(reactionPayload.targetMessageId, '11111111-2222-4333-8444-555555555555');

  // Decrypt reaction
  const decrypted = await decryptReaction({
    key,
    payload: reactionPayload,
    identityRegistry: registry,
  });

  assert.equal(decrypted.targetMessageId, '11111111-2222-4333-8444-555555555555');
  assert.equal(decrypted.emoji, '🔥');
  assert.equal(decrypted.action, 'add');
  assert.equal(decrypted.userId, 'USR-ALICE');
  assert.equal(decrypted.nickname, 'Alice');
  assert.equal(decrypted.isSigned, true);
  assert.equal(decrypted.authStatus, 'FIRST_SEEN');

  // Wrong key fails decryption
  const wrongKey = await deriveRoomKey({
    password: 'wrong-key-alt-password-9999',
    roomName: 'reaction-room',
    iterations: 300000,
  });

  await assert.rejects(async () => {
    await decryptReaction({
      key: wrongKey,
      payload: reactionPayload,
      identityRegistry: registry,
    });
  });
});

