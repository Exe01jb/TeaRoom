import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterSessionMessages,
  isMessageMatch,
  hasLinks,
  isAudioMessage,
  isMediaMessage,
} from '../frontend/src/utils/searchMessages.js';

const mockMessages = [
  {
    id: 'msg-1',
    text: 'Hello from Alice, welcome to the encrypted channel!',
    nickname: 'Alice',
    userId: 'usr-alice-1234',
    timestamp: Date.now() - 50000,
    isOwn: false,
  },
  {
    id: 'msg-2',
    text: 'Hey Alice! Check this architecture design link https://github.com/privacy-relay',
    nickname: 'Bob',
    userId: 'usr-bob-5678',
    timestamp: Date.now() - 40000,
    isOwn: true,
  },
  {
    id: 'msg-3',
    text: 'Here is the diagram specification',
    nickname: 'Alice',
    userId: 'usr-alice-1234',
    timestamp: Date.now() - 30000,
    isOwn: false,
    file: {
      name: 'network-diagram.png',
      size: 1048576,
      type: 'image/png',
    },
  },
  {
    id: 'msg-4',
    text: '',
    nickname: 'Bob',
    userId: 'usr-bob-5678',
    timestamp: Date.now() - 20000,
    isOwn: true,
    file: {
      name: 'voice-note.webm',
      size: 45000,
      type: 'audio/webm',
      isVoiceNote: true,
      duration: 8.5,
    },
  },
  {
    id: 'msg-5',
    text: 'Quantum cipher keys rotated successfully',
    type: 'system',
    timestamp: Date.now() - 10000,
  },
  {
    id: 'msg-6',
    text: 'Check www.cryptography.io for more technical details',
    nickname: 'Carol',
    userId: 'usr-carol-9999',
    timestamp: Date.now() - 5000,
    isOwn: false,
  },
];

test('search: isMessageMatch finds keyword across text, nickname, user ID, and attachment name', () => {
  // Text matching
  assert.equal(isMessageMatch(mockMessages[0], 'encrypted'), true);
  assert.equal(isMessageMatch(mockMessages[0], 'ENCRYPTED'), true);
  assert.equal(isMessageMatch(mockMessages[0], 'nonexistent'), false);

  // Nickname matching
  assert.equal(isMessageMatch(mockMessages[0], 'Alice'), true);
  assert.equal(isMessageMatch(mockMessages[1], 'bob'), true);

  // User ID matching
  assert.equal(isMessageMatch(mockMessages[0], 'alice-1234'), true);
  assert.equal(isMessageMatch(mockMessages[1], '5678'), true);

  // Attachment name matching
  assert.equal(isMessageMatch(mockMessages[2], 'network-diagram'), true);
  assert.equal(isMessageMatch(mockMessages[2], '.png'), true);
  assert.equal(isMessageMatch(mockMessages[3], 'voice-note'), true);

  // System messages excluded
  assert.equal(isMessageMatch(mockMessages[4], 'Quantum'), false);
});

test('search: filterSessionMessages filters messages by free text keyword', () => {
  const resultsAlice = filterSessionMessages(mockMessages, { query: 'Alice' });
  // Should match msg-1 (nickname & text), msg-2 (text mentions Alice), msg-3 (nickname)
  assert.equal(resultsAlice.length, 3);
  assert.deepEqual(resultsAlice.map(m => m.id), ['msg-1', 'msg-2', 'msg-3']);

  const resultsDiagram = filterSessionMessages(mockMessages, { query: 'diagram' });
  // Should match msg-3 (text and filename)
  assert.equal(resultsDiagram.length, 1);
  assert.equal(resultsDiagram[0].id, 'msg-3');

  const resultsNone = filterSessionMessages(mockMessages, { query: 'completely-missing-term' });
  assert.equal(resultsNone.length, 0);
});

test('search: filterSessionMessages filters by content type facets', () => {
  // Text only (no file attached)
  const textOnly = filterSessionMessages(mockMessages, { contentType: 'text' });
  assert.deepEqual(textOnly.map(m => m.id), ['msg-1', 'msg-2', 'msg-6']);

  // Media / files (excluding voice notes)
  const mediaOnly = filterSessionMessages(mockMessages, { contentType: 'media' });
  assert.deepEqual(mediaOnly.map(m => m.id), ['msg-3']);

  // Audio / voice notes
  const audioOnly = filterSessionMessages(mockMessages, { contentType: 'audio' });
  assert.deepEqual(audioOnly.map(m => m.id), ['msg-4']);

  // Links
  const linksOnly = filterSessionMessages(mockMessages, { contentType: 'links' });
  assert.deepEqual(linksOnly.map(m => m.id), ['msg-2', 'msg-6']);
});

test('search: filterSessionMessages filters by sender facet', () => {
  const ownMessages = filterSessionMessages(mockMessages, { sender: 'me' });
  assert.deepEqual(ownMessages.map(m => m.id), ['msg-2', 'msg-4']);

  const peerMessages = filterSessionMessages(mockMessages, { sender: 'others' });
  assert.deepEqual(peerMessages.map(m => m.id), ['msg-1', 'msg-3', 'msg-6']);
});

test('search: filterSessionMessages combines keyword query and facet filters simultaneously', () => {
  // Query "architecture" with sender "me"
  const combined = filterSessionMessages(mockMessages, {
    query: 'architecture',
    sender: 'me',
  });
  assert.equal(combined.length, 1);
  assert.equal(combined[0].id, 'msg-2');

  // Query "architecture" with sender "others" -> 0 matches
  const combinedNoMatch = filterSessionMessages(mockMessages, {
    query: 'architecture',
    sender: 'others',
  });
  assert.equal(combinedNoMatch.length, 0);

  // Filter links with query "github"
  const linksWithGithub = filterSessionMessages(mockMessages, {
    contentType: 'links',
    query: 'github',
  });
  assert.equal(linksWithGithub.length, 1);
  assert.equal(linksWithGithub[0].id, 'msg-2');
});

test('search: helpers hasLinks, isAudioMessage, isMediaMessage function accurately', () => {
  assert.equal(hasLinks('visit https://example.com today'), true);
  assert.equal(hasLinks('visit www.example.com today'), true);
  assert.equal(hasLinks('just plain text without links'), false);
  assert.equal(hasLinks(''), false);
  assert.equal(hasLinks(null), false);

  assert.equal(isAudioMessage(mockMessages[3]), true);
  assert.equal(isAudioMessage(mockMessages[2]), false);
  assert.equal(isAudioMessage(mockMessages[0]), false);

  assert.equal(isMediaMessage(mockMessages[2]), true);
  assert.equal(isMediaMessage(mockMessages[3]), false);
  assert.equal(isMediaMessage(mockMessages[0]), false);
});
