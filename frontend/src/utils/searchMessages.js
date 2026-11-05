/**
 * In-memory local message search and filtering engine for ephemeral session chats.
 * Operates purely on client-side browser memory without sending queries over the network.
 */

const URL_REGEX = /(https?:\/\/|www\.)[^\s]+/i;

/**
 * Check if a message contains web hyperlinks
 */
export function hasLinks(text) {
  if (!text || typeof text !== 'string') return false;
  return URL_REGEX.test(text);
}

/**
 * Check if a message is an audio / voice note
 */
export function isAudioMessage(message) {
  if (!message || !message.file) return false;
  return Boolean(
    message.file.isVoiceNote ||
    (message.file.type && message.file.type.startsWith('audio/'))
  );
}

/**
 * Check if a message has image or non-audio document attachment
 */
export function isMediaMessage(message) {
  if (!message || !message.file) return false;
  return !isAudioMessage(message);
}

/**
 * Test whether an individual message matches a search query keyword
 * Searches across:
 * - Decrypted text message content
 * - Sender nickname
 * - Sender User ID
 * - Attached file name
 */
export function isMessageMatch(message, query) {
  if (!message || message.type === 'system') return false;
  if (!query || typeof query !== 'string') return true;

  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  // 1. Text content
  if (message.text && typeof message.text === 'string') {
    if (message.text.toLowerCase().includes(normalized)) return true;
  }

  // 2. Sender nickname
  if (message.nickname && typeof message.nickname === 'string') {
    if (message.nickname.toLowerCase().includes(normalized)) return true;
  }

  // 3. Sender User ID
  if (message.userId && typeof message.userId === 'string') {
    if (message.userId.toLowerCase().includes(normalized)) return true;
  }

  // 4. File attachment name
  if (message.file && message.file.name && typeof message.file.name === 'string') {
    if (message.file.name.toLowerCase().includes(normalized)) return true;
  }

  return false;
}

/**
 * Filter an array of ephemeral session messages by query and facets.
 *
 * @param {Array} messages - Decrypted messages in memory
 * @param {Object} options - Search & filter options
 * @param {string} [options.query] - Text keyword
 * @param {string} [options.contentType] - 'all' | 'text' | 'media' | 'audio' | 'links'
 * @param {string} [options.sender] - 'all' | 'me' | 'others'
 * @returns {Array} Filtered list of matching message items
 */
export function filterSessionMessages(messages = [], options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const query = (options.query || '').trim().toLowerCase();
  const contentType = options.contentType || 'all';
  const sender = options.sender || 'all';

  return messages.filter((message) => {
    // Exclude system notices from search results
    if (message.type === 'system') return false;

    // 1. Text keyword search
    if (query) {
      if (!isMessageMatch(message, query)) {
        return false;
      }
    }

    // 2. Content Type Facet
    if (contentType === 'text') {
      // Must have text, and must not be a standalone file attachment
      if (!message.text || message.file) return false;
    } else if (contentType === 'media') {
      // Must have an image or document file attachment
      if (!isMediaMessage(message)) return false;
    } else if (contentType === 'audio') {
      // Must be a voice recording or audio file
      if (!isAudioMessage(message)) return false;
    } else if (contentType === 'links') {
      // Must contain a web link in the text
      if (!hasLinks(message.text)) return false;
    }

    // 3. Sender Facet
    if (sender === 'me') {
      if (!message.isOwn) return false;
    } else if (sender === 'others') {
      if (message.isOwn) return false;
    }

    return true;
  });
}
