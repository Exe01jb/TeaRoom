import { bytesToBase64 } from './crypto.js';

function getCrypto() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    return globalThis.crypto;
  }
  throw new Error('Web Crypto API is not available');
}

/**
 * Triggers browser download of a given string or blob content.
 */
export function downloadFile({ content, filename, mimeType = 'text/plain;charset=utf-8' }) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}

/**
 * Generates structured JSON export of the current chat messages.
 */
export function generateDecryptedJsonExport({ room, chatType, peerName, peerId, messages }) {
  const exportTimestamp = new Date().toISOString();
  const sanitizedMessages = messages.map((m) => ({
    id: m.id,
    timestamp: m.timestamp,
    isoTime: m.timestamp ? new Date(m.timestamp).toISOString() : null,
    nickname: m.nickname,
    userId: m.userId || null,
    text: m.text || '',
    isOwn: Boolean(m.isOwn),
    status: m.status || (m.isRead ? 'read' : 'delivered'),
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          nickname: m.replyTo.nickname,
          text: m.replyTo.text,
        }
      : null,
    file: m.file
      ? {
          name: m.file.name,
          type: m.file.type,
          size: m.file.size,
          isVoiceNote: Boolean(m.file.isVoiceNote || (m.file.type && m.file.type.startsWith('audio/'))),
          duration: m.file.duration || null,
          waveform: m.file.waveform || null,
          // include base64 payload if present
          data: m.file.data || null,
        }
      : null,
    reactions: m.reactions || null,
  }));

  return {
    exportVersion: 1,
    exportedAt: exportTimestamp,
    session: {
      room,
      chatType: chatType || 'room',
      peerName: peerName || null,
      peerId: peerId || null,
      totalMessages: sanitizedMessages.length,
    },
    messages: sanitizedMessages,
  };
}

/**
 * Generates human-readable plain-text transcript log.
 */
export function generateTextTranscriptExport({ room, chatType, peerName, peerId, messages }) {
  const now = new Date();
  const dateStr = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const divider = '='.repeat(68);
  const subDivider = '-'.repeat(68);

  const lines = [
    divider,
    ` SECURE CHAT TRANSCRIPT - ${chatType === 'direct' ? `DIRECT: ${peerName || peerId}` : `#${room}`}`,
    ` Export Date : ${dateStr}`,
    ` Chat Type   : ${chatType === 'direct' ? '1-on-1 Direct Message' : 'Encrypted Chatroom'}`,
    ` Total Msgs  : ${messages.length}`,
    ` Security    : Zero-Persistence WebCrypto Protocol v1`,
    divider,
    '',
  ];

  if (messages.length === 0) {
    lines.push('(No messages recorded in this session history)');
  } else {
    messages.forEach((m, idx) => {
      const timeStr = m.timestamp
        ? new Date(m.timestamp).toISOString().replace('T', ' ').slice(0, 19)
        : 'Unknown Time';
      const sender = `${m.nickname || 'Anonymous'}${m.userId ? ` [${m.userId.slice(0, 8)}]` : ''}`;

      lines.push(`[${timeStr}] <${sender}>:`);

      if (m.replyTo) {
        lines.push(`  ↳ Replying to ${m.replyTo.nickname || 'message'}: "${(m.replyTo.text || '').slice(0, 80)}"`);
      }

      if (m.text) {
        // Indent multiline messages nicely
        const msgLines = m.text.split('\n');
        msgLines.forEach((l) => lines.push(`  ${l}`));
      }

      if (m.file) {
        if (m.file.isVoiceNote || (m.file.type && m.file.type.startsWith('audio/'))) {
          const durStr = m.file.duration ? ` - ${Math.round(m.file.duration)}s` : '';
          lines.push(`  🎙️ Encrypted Voice Note: ${m.file.name || 'voice-note.webm'}${durStr} (${formatBytes(m.file.size)})`);
        } else {
          lines.push(`  📎 Attached File: ${m.file.name || 'attachment'} (${formatBytes(m.file.size)}) [${m.file.type || 'unknown'}]`);
        }
      }

      if (m.reactions && Object.keys(m.reactions).length > 0) {
        const reactStr = Object.entries(m.reactions)
          .map(([emoji, data]) => {
            const count = typeof data === 'number' ? data : (data.count || (data.users ? data.users.length : 1));
            return `${emoji} ${count}`;
          })
          .join('  ');
        lines.push(`  Reactions: ${reactStr}`);
      }

      if (idx < messages.length - 1) {
        lines.push('');
      }
    });
  }

  lines.push('');
  lines.push(subDivider);
  lines.push(' END OF CHAT SESSION TRANSCRIPT');
  lines.push(divider);

  return lines.join('\n');
}

/**
 * Encrypts the entire conversation history into an encrypted JSON envelope
 * protected with a custom user passphrase using Web Crypto PBKDF2 + AES-GCM 256-bit.
 */
export async function generateEncryptedBackupExport({
  room,
  chatType,
  peerName,
  peerId,
  messages,
  password,
  iterations = 300000,
}) {
  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;

  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Backup encryption passphrase must be at least 8 characters');
  }

  // 1. Prepare plaintext payload
  const plainExport = generateDecryptedJsonExport({ room, chatType, peerName, peerId, messages });
  const plainJson = JSON.stringify(plainExport);
  const plainBytes = new TextEncoder().encode(plainJson);

  // 2. Generate random salt (16 bytes) and IV (12 bytes)
  const saltBytes = cryptoObj.getRandomValues(new Uint8Array(16));
  const ivBytes = cryptoObj.getRandomValues(new Uint8Array(12));

  // 3. Derive key via PBKDF2
  const normalizedPassword = password.normalize('NFKC');
  const passwordBytes = new TextEncoder().encode(normalizedPassword);

  const baseKey = await subtle.importKey(
    'raw',
    passwordBytes,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const aesKey = await subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt']
  );

  // 4. Authenticated Additional Data binds the room and timestamp
  const exportedAt = new Date().toISOString();
  const aad = new TextEncoder().encode(`pcr-backup|v1|${room}|${exportedAt}`);

  // 5. Encrypt
  const cipherBuffer = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes,
      additionalData: aad,
      tagLength: 128,
    },
    aesKey,
    plainBytes
  );

  return {
    format: 'pcr-encrypted-backup',
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations,
    exportedAt,
    session: {
      room,
      chatType: chatType || 'room',
      messageCount: messages.length,
    },
    salt: bytesToBase64(saltBytes),
    iv: bytesToBase64(ivBytes),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
  };
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
