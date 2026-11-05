/**
 * TeaRoom (Private Chatroom) - Client Application
 * @author Exe01jb (https://github.com/Exe01jb)
 * @license MIT
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sun, Moon, Mail, X, BookOpen, Shield } from 'lucide-react';
import { io } from 'socket.io-client';
// 1. Add to ./utils/crypto.js imports at top of frontend/src/App.jsx:
import {
  deriveRoomKey,
  deriveEpochKey,
  encryptMessage,
  decryptMessage,
  encryptTypingSignal,
  decryptTypingSignal,
  encryptReaction,
  decryptReaction,
  generateIdentityKeyPair,
  loadOrCreateIdentityKeyPair,
  rotateIdentityKeyPair,
  getPersistedIdentitySync,
  IdentityRegistry,
  TypingReplayDetector,
  computeInviteAuthToken,
  unwrapInviteEnvelope,
} from './utils/crypto.js';
import { IdDeduplicator } from './utils/lru.js';
import { Login } from './components/Login.jsx';
import { ChatBox } from './components/ChatBox.jsx';
import { AdminDashboard } from './components/AdminDashboard.jsx';
import { ActiveChatsSidebar } from './components/ActiveChatsSidebar.jsx';
import { DirectChatModal, JoinRoomModal } from './components/ChatModals.jsx';
import { NavigationRail } from './components/NavigationRail.jsx';
import { PlatformIntroModal } from './components/PlatformIntroModal.jsx';
import { ProfilePage } from './components/ProfilePage.jsx';
import { SessionExpiryModal } from './components/SessionExpiryAlert.jsx';
import { ExportModal } from './components/ExportModal.jsx';

// 2. Add INVALID_CREDENTIALS to FRIENDLY_ERRORS in frontend/src/App.jsx:
const FRIENDLY_ERRORS = {
  INVALID_CREDENTIALS: 'Invalid or revoked Admin Invite credentials.',
  INVITE_REQUIRED: 'An administrator invite is required to join this room.',
  INVITE_EXPIRED: 'This invitation has expired.',
  INVITE_CONSUMED: 'This single-use invitation has already been used.',
  INVITE_ROOM_MISMATCH: 'This invitation is not valid for the requested room.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  INVALID_PAYLOAD: 'The message payload was rejected as invalid.',
  INVALID_ROOM: 'Invalid room name specified.',
  NOT_IN_ROOM: 'You are not recognized as a member of this room.',
  TOO_LARGE: 'Message exceeds the maximum allowed size.',
  RATE_LIMITED: 'Rate limit reached. Please wait a few seconds before sending again.',
  ROOM_FULL: 'This room has reached its maximum member capacity.',
  SERVER_FULL: 'The relay server is currently at maximum capacity.',
  IP_BANNED: 'Your network IP address has been blocked by system administration.',
};

function generateUniqueUserId() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(2));
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    return `USR-${hex}`;
  }
  return `USR-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

export function App() {
  const [myUserId, setMyUserId] = useState(() => {
    try {
      const persisted = getPersistedIdentitySync();
      if (persisted?.userId) return persisted.userId;
    } catch {}
    return generateUniqueUserId();
  });

  const [viewMode, setViewMode] = useState('chat');

  const [isSecureContextAvailable, setIsSecureContextAvailable] = useState(true);
  useEffect(() => {
    const isSecure = window.isSecureContext && typeof window.crypto?.subtle !== 'undefined';
    setIsSecureContextAvailable(isSecure);
  }, []);

  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('pcr_theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return 'dark';
  });

  useEffect(() => {
    try {
      localStorage.setItem('pcr_theme', theme);
    } catch {}
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const socketRef = useRef(null);
  const [connectionState, setConnectionState] = useState('connecting');

  const [userNickname, setUserNickname] = useState(() => {
    try {
      const saved = localStorage.getItem('pcr_user_profile');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.nickname) return parsed.nickname;
      }
    } catch {}
    return '';
  });

  const [userProfile, setUserProfile] = useState(() => {
    try {
      const saved = localStorage.getItem('pcr_user_profile');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          nickname: parsed.nickname || '',
          avatarGradient: parsed.avatarGradient || 'from-emerald-600 to-teal-500',
          avatarEmoji: parsed.avatarEmoji || '🛡️',
          statusBio: parsed.statusBio || '🔒 End-to-end encrypted • Zero persistence',
          avatarImage: parsed.avatarImage || null,
        };
      }
    } catch {}
    return {
      nickname: '',
      avatarGradient: 'from-emerald-600 to-teal-500',
      avatarEmoji: '🛡️',
      statusBio: '🔒 End-to-end encrypted • Zero persistence',
      avatarImage: null,
    };
  });

  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [roomMembers, setRoomMembers] = useState([]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [isDirectModalOpen, setIsDirectModalOpen] = useState(false);
  const [isIntroModalOpen, setIsIntroModalOpen] = useState(false);
  const [targetMemberForDirect, setTargetMemberForDirect] = useState(null);
  const [incomingDirectInvite, setIncomingDirectInvite] = useState(null);

  const [loginError, setLoginError] = useState('');
  const [statusNotice, setStatusNotice] = useState('');
  const [isDerivingKey, setIsDerivingKey] = useState(false);

  const [typingUsersByRoom, setTypingUsersByRoom] = useState({});
  const typingTimersRef = useRef({});

  const DEFAULT_SESSION_SECONDS = 900;
  const [sessionSecondsRemaining, setSessionSecondsRemaining] = useState(DEFAULT_SESSION_SECONDS);
  const [isSessionExpiryModalOpen, setIsSessionExpiryModalOpen] = useState(false);
  const [isSessionExportOpen, setIsSessionExportOpen] = useState(false);
  const hasTriggeredExpiryModalRef = useRef(false);

  const deduplicatorRef = useRef(new IdDeduplicator(1000));
  const activeChatIdRef = useRef(null);
  const chatsRef = useRef([]);
  const userNicknameRef = useRef('');
  const directChatRoomsRef = useRef(new Set());
  const directChatPeersRef = useRef(new Set());

  const identityKeyPairRef = useRef(null);
  const identityRegistryRef = useRef(new IdentityRegistry());
  const typingReplayDetectorRef = useRef(new TypingReplayDetector());
  const [myIdentityFingerprint, setMyIdentityFingerprint] = useState(() => {
    const meta = getPersistedIdentitySync();
    return meta?.fingerprintHex || '';
  });
  const [isIdentityPersisted, setIsIdentityPersisted] = useState(false);

  useEffect(() => {
    loadOrCreateIdentityKeyPair({ userId: myUserId })
      .then((identity) => {
        if (identity.userId && identity.userId !== myUserId) {
          setMyUserId(identity.userId);
        }
        identityKeyPairRef.current = identity;
        setMyIdentityFingerprint(identity.fingerprintHex);
        setIsIdentityPersisted(true);
      })
      .catch((err) => {
        console.error('Failed to initialize persistent identity keypair:', err);
        generateIdentityKeyPair({ extractable: true }).then((kp) => {
          identityKeyPairRef.current = kp;
          setMyIdentityFingerprint(kp.fingerprintHex);
        });
      });
  }, [myUserId]);

  const handleRotateIdentityKey = useCallback(async () => {
    try {
      const rotated = await rotateIdentityKeyPair({ userId: myUserId });
      identityKeyPairRef.current = rotated;
      setMyIdentityFingerprint(rotated.fingerprintHex);
      setIsIdentityPersisted(true);
      setStatusNotice('Cryptographic identity rotated and persisted successfully.');
      setTimeout(() => setStatusNotice(''), 3000);
    } catch (err) {
      console.error('Failed to rotate identity key:', err);
      setStatusNotice('Error rotating identity key.');
      setTimeout(() => setStatusNotice(''), 3000);
    }
  }, [myUserId]);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    chatsRef.current = chats;
    for (const c of chats) {
      if (c.type === 'direct') {
        if (c.id) directChatRoomsRef.current.add(c.id);
        if (c.peerId) directChatPeersRef.current.add(c.peerId);
      }
    }
  }, [chats]);

  useEffect(() => {
    if (incomingDirectInvite) {
      const alreadyJoined =
        directChatRoomsRef.current.has(incomingDirectInvite.room) ||
        directChatPeersRef.current.has(incomingDirectInvite.fromUserId) ||
        chats.some(
          (c) =>
            c.id === incomingDirectInvite.room ||
            (c.type === 'direct' && c.peerId === incomingDirectInvite.fromUserId)
        );
      if (alreadyJoined) {
        setIncomingDirectInvite(null);
      }
    }
  }, [chats, incomingDirectInvite]);

  useEffect(() => {
    userNicknameRef.current = userNickname;
  }, [userNickname]);

  // Connect socket once on mount
  useEffect(() => {
    const socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionState('connected');
      setStatusNotice('');
      if (chatsRef.current.length > 0) {
        for (const c of chatsRef.current) {
          socket.emit(
            'join',
            {
              v: 1,
              room: c.id,
              salt: c.salt,
              userId: myUserId,
              nickname: userNicknameRef.current || undefined,
            },
            (res) => {
              if (res && res.ok) {
                if (res.count) updateChatPresence(c.id, res.count);
                if (userNicknameRef.current) {
                  socket.emit('announce_presence', {
                    v: 1,
                    room: c.id,
                    userId: myUserId,
                    nickname: userNicknameRef.current,
                  });
                }
              }
            }
          );
        }
      }
    });

    socket.on('disconnect', () => {
      setConnectionState('disconnected');
      for (const key of Object.keys(typingTimersRef.current)) {
        clearTimeout(typingTimersRef.current[key]);
      }
      typingTimersRef.current = {};
      setTypingUsersByRoom({});
    });

    socket.on('connect_error', () => {
      setConnectionState('disconnected');
    });

    socket.on('error', (err) => {
      if (err === 'IP_BANNED') {
        setLoginError('Your network IP has been blocked by system administrator moderation.');
        setChats([]);
        setActiveChatId(null);
        activeChatIdRef.current = null;
      }
    });

    socket.on('presence', ({ room, count }) => {
      updateChatPresence(room, count);
    });

    socket.on('member_presence', ({ room, userId, nickname, action }) => {
      if (!userId || userId === myUserId) return;
      if (action === 'leave') {
        setRoomMembers((prev) => prev.filter((m) => m.userId !== userId));
        if (room) {
          const timerKey = `${room}:${userId}`;
          if (typingTimersRef.current[timerKey]) {
            clearTimeout(typingTimersRef.current[timerKey]);
            delete typingTimersRef.current[timerKey];
          }
          setTypingUsersByRoom((prev) => {
            const list = prev[room] || [];
            return {
              ...prev,
              [room]: list.filter((u) => u.userId !== userId),
            };
          });
        }
      } else {
        setRoomMembers((prev) => {
          const exists = prev.some((m) => m.userId === userId);
          if (!exists) {
            return [...prev, { userId, nickname: nickname || userId }];
          }
          return prev.map((m) =>
            m.userId === userId ? { ...m, nickname: nickname || m.nickname } : m
          );
        });
      }
    });

    socket.on('request_presence', ({ room }) => {
      if (userNicknameRef.current) {
        socket.emit('announce_presence', {
          v: 1,
          room,
          userId: myUserId,
          nickname: userNicknameRef.current,
        });
      }
    });

    socket.on('dm_invite', ({ fromUserId, fromNickname, room }) => {
      if (!fromUserId || fromUserId === myUserId) return;
      const isAlreadyInChat =
        directChatRoomsRef.current.has(room) ||
        directChatPeersRef.current.has(fromUserId) ||
        chatsRef.current.some(
          (c) => c.id === room || (c.type === 'direct' && c.peerId === fromUserId)
        );
      if (isAlreadyInChat) {
        return;
      }
      setIncomingDirectInvite({
        fromUserId,
        fromNickname: fromNickname || fromUserId,
        room,
      });
    });

    socket.on('room_terminated', ({ room, reason }) => {
      setChats((prev) => prev.filter((c) => c.id !== room));
      if (activeChatIdRef.current === room) {
        setActiveChatId(null);
        activeChatIdRef.current = null;
        setLoginError(reason || 'Room was terminated by administrator moderation.');
      }
    });

    socket.on('evicted', ({ room, reason }) => {
      setChats((prev) => prev.filter((c) => c.id !== room));
      if (activeChatIdRef.current === room) {
        setActiveChatId(null);
        activeChatIdRef.current = null;
      }
      setStatusNotice(`You were removed from #${room} (${reason || 'MEMBER_EVICTED'}).`);
    });

    socket.on('member_evicted', ({ room, targetUserId }) => {
      setRoomMembers((prev) => prev.filter((m) => m.userId !== targetUserId));
      setStatusNotice(`Participant ${targetUserId} was evicted from #${room}.`);
    });

    socket.on('delivery', ({ id, room }) => {
      if (!id || !room) return;
      setChats((prev) =>
        prev.map((c) => {
          if (c.id === room) {
            return {
              ...c,
              messages: c.messages.map((m) => {
                if (m.id === id && m.status !== 'read') {
                  return {
                    ...m,
                    status: 'delivered',
                    delivered: true,
                  };
                }
                return m;
              }),
            };
          }
          return c;
        })
      );
    });

    socket.on('receipt', ({ id, room, readerId, readAt }) => {
      if (!id || !room) return;
      setChats((prev) =>
        prev.map((c) => {
          if (c.id === room) {
            return {
              ...c,
              messages: c.messages.map((m) => {
                if (m.id === id) {
                  const currentReadBy = m.readBy || [];
                  const updatedReadBy =
                    readerId && !currentReadBy.includes(readerId)
                      ? [...currentReadBy, readerId]
                      : currentReadBy;
                  return {
                    ...m,
                    status: 'read',
                    isRead: true,
                    delivered: true,
                    readAt: readAt || Date.now(),
                    readBy: updatedReadBy,
                  };
                }
                return m;
              }),
            };
          }
          return c;
        })
      );
    });

    socket.on('typing', async (payload) => {
      if (!payload || !payload.room) return;
      const room = payload.room;
      if (!payload.ciphertext || !payload.iv) {
        return;
      }

      const targetChat = chatsRef.current.find((c) => c.id === room);
      if (!targetChat || !targetChat.key) return;

      const decrypted = await decryptTypingSignal({
        key: targetChat.key,
        room,
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        ttl: payload.ttl,
        signalId: payload.signalId,
        identityRegistry: identityRegistryRef.current,
        replayDetector: typingReplayDetectorRef.current,
      });

      if (!decrypted) return;

      const { isTyping, userId, nickname, ttl } = decrypted;
      if (!userId || userId === myUserId) return;

      const timerKey = `${room}:${userId}`;
      if (typingTimersRef.current[timerKey]) {
        clearTimeout(typingTimersRef.current[timerKey]);
        delete typingTimersRef.current[timerKey];
      }

      setTypingUsersByRoom((prev) => {
        const currentList = prev[room] || [];
        if (!isTyping) {
          return {
            ...prev,
            [room]: currentList.filter((u) => u.userId !== userId),
          };
        }
        const filtered = currentList.filter((u) => u.userId !== userId);
        return {
          ...prev,
          [room]: [...filtered, { userId, nickname: nickname || 'Someone' }],
        };
      });

      if (isTyping) {
        const autoClearMs = Math.min(Math.max(1000, ttl || 3000), 5000);
        typingTimersRef.current[timerKey] = setTimeout(() => {
          setTypingUsersByRoom((prev) => {
            const currentList = prev[room] || [];
            return {
              ...prev,
              [room]: currentList.filter((u) => u.userId !== userId),
            };
          });
          delete typingTimersRef.current[timerKey];
        }, autoClearMs);
      }
    });

    socket.on('reaction', async (payload) => {
      if (!payload || !payload.room || !payload.targetMessageId || !payload.iv || !payload.ct)
        return;
      const room = payload.room;
      const targetChat = chatsRef.current.find((c) => c.id === room);
      if (!targetChat || !targetChat.key) return;

      try {
        const decrypted = await decryptReaction({
          key: targetChat.key,
          payload,
          identityRegistry: identityRegistryRef.current,
        });
        if (!decrypted) return;

        const { targetMessageId, emoji, action, userId, nickname } = decrypted;

        setChats((prev) =>
          prev.map((c) => {
            if (c.id === room) {
              const updatedMessages = c.messages.map((m) => {
                if (m.id === targetMessageId) {
                  const existingReactions = { ...(m.reactions || {}) };
                  const currentEmojiData = existingReactions[emoji]
                    ? {
                        users: [...(existingReactions[emoji].users || [])],
                        names: [...(existingReactions[emoji].names || [])],
                      }
                    : { users: [], names: [] };

                  if (action === 'remove') {
                    const idx = currentEmojiData.users.indexOf(userId);
                    if (idx !== -1) {
                      currentEmojiData.users.splice(idx, 1);
                      currentEmojiData.names.splice(idx, 1);
                    }
                  } else {
                    if (!currentEmojiData.users.includes(userId)) {
                      currentEmojiData.users.push(userId);
                      currentEmojiData.names.push(nickname || userId);
                    }
                  }

                  if (currentEmojiData.users.length === 0) {
                    delete existingReactions[emoji];
                  } else {
                    existingReactions[emoji] = {
                      count: currentEmojiData.users.length,
                      users: currentEmojiData.users,
                      names: currentEmojiData.names,
                    };
                  }

                  return {
                    ...m,
                    reactions: existingReactions,
                  };
                }
                return m;
              });

              return {
                ...c,
                messages: updatedMessages,
              };
            }
            return c;
          })
        );
      } catch {
        // Drop malformed or invalid reactions
      }
    });

    socket.on('message', async (payload) => {
      if (!payload || !payload.id || !payload.room) return;

      if (!deduplicatorRef.current.checkAndAdd(payload.id)) {
        return;
      }

      if (socketRef.current) {
        socketRef.current.emit('delivery', {
          v: 1,
          id: payload.id,
          room: payload.room,
          recipientId: myUserId,
        });
      }

      const chat = chatsRef.current.find((c) => c.id === payload.room);
      if (!chat || !chat.key) return;

      try {
        const decrypted = await decryptMessage({
          key: chat.key,
          payload,
          expectedEpoch: chat.epoch || 1,
        });

        if (socketRef.current) {
          socketRef.current.emit('receipt', {
            v: 1,
            id: payload.id,
            room: payload.room,
            readerId: myUserId,
          });
        }

        if (decrypted.userId) {
          setRoomMembers((prev) => {
            const exists = prev.some((m) => m.userId === decrypted.userId);
            if (!exists) {
              return [...prev, { userId: decrypted.userId, nickname: decrypted.nickname }];
            }
            return prev;
          });
        }

        let identityWarning = null;
        if (decrypted.userId && decrypted.senderPublicKeySpki) {
          const regCheck = identityRegistryRef.current.registerOrVerify({
            userId: decrypted.userId,
            nickname: decrypted.nickname,
            publicKeySpki: decrypted.senderPublicKeySpki,
          });
          if (regCheck.status === 'KEY_CHANGED') {
            identityWarning = 'KEY_CHANGED';
            setStatusNotice(
              `⚠️ SECURITY WARNING: Cryptographic identity change detected for participant "${decrypted.nickname}" (${decrypted.userId}). Public key signature mismatch!`
            );
          } else if (regCheck.warning === 'NICKNAME_CHANGED') {
            setStatusNotice(
              `Participant (${decrypted.userId}) updated display name from "${regCheck.oldNickname}" to "${regCheck.newNickname}".`
            );
          }
        }

        const newMsg = {
          id: payload.id,
          nickname: decrypted.nickname,
          userId: decrypted.userId,
          avatarImage: decrypted.avatarImage || null,
          avatarEmoji: decrypted.avatarEmoji || null,
          avatarGradient: decrypted.avatarGradient || null,
          text: decrypted.text || '',
          file: decrypted.file || null,
          timestamp: decrypted.timestamp,
          serverTime: payload.serverTime,
          replyTo: decrypted.replyTo,
          isOwn: false,
          isSigned: Boolean(decrypted.isSigned),
          identityWarning: identityWarning,
          senderPublicKeySpki: decrypted.senderPublicKeySpki || null,
        };

        const fileLabel = decrypted.file
          ? decrypted.file.isVoiceNote ||
            (decrypted.file.type && decrypted.file.type.startsWith('audio/'))
            ? '🎤 [Voice Note] '
            : decrypted.file.type && decrypted.file.type.startsWith('image/')
            ? '📷 [Image] '
            : '📎 [File] '
          : '';
        const previewText = decrypted.text
          ? decrypted.text.slice(0, 30)
          : decrypted.file?.isVoiceNote
          ? `${Math.round(decrypted.file.duration || 0)}s voice note`
          : decrypted.file?.name || 'Attachment';

        setChats((prev) =>
          prev.map((c) => {
            if (c.id === payload.room) {
              const isCurrent = c.id === activeChatIdRef.current;
              return {
                ...c,
                messages: [...c.messages, newMsg],
                lastMessage: `${decrypted.nickname}: ${fileLabel}${previewText}`,
                unreadCount: isCurrent ? 0 : (c.unreadCount || 0) + 1,
              };
            }
            return c;
          })
        );
      } catch {
        setChats((prev) =>
          prev.map((c) => {
            if (c.id === payload.room) {
              return {
                ...c,
                failedDecryptCount: (c.failedDecryptCount || 0) + 1,
              };
            }
            return c;
          })
        );
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [myUserId]);

  function updateChatPresence(room, count) {
    setChats((prev) =>
      prev.map((c) => (c.id === room ? { ...c, presenceCount: count } : c))
    );
  }

  // Handle Initial Login / Join (joins room first to retrieve server-generated salt & epoch)
// 3. Replace handleInitialJoin in frontend/src/App.jsx:
  const handleInitialJoin = useCallback(
    async ({ username, password }) => {
      setLoginError('');
      setIsDerivingKey(true);

      if (!socketRef.current) {
        setIsDerivingKey(false);
        setLoginError('Relay connection unavailable');
        return;
      }

      try {
        const cleanUsername = username.trim();
        const authToken = await computeInviteAuthToken({
          username: cleanUsername,
          password,
        });

        socketRef.current.emit(
          'redeem_invite',
          {
            v: 1,
            username: cleanUsername,
            authToken,
            userId: myUserId,
          },
          async (response) => {
            if (!response || !response.ok || !response.envelope) {
              setIsDerivingKey(false);
              const code = response?.code || 'INVALID_CREDENTIALS';
              setLoginError(
                FRIENDLY_ERRORS[code] || 'Invalid or revoked 10-character invite credentials.'
              );
              return;
            }

            try {
              const iterations = Number(import.meta.env?.VITE_PBKDF2_ITERATIONS || 600000);
              const unwrapped = await unwrapInviteEnvelope({
                username: cleanUsername,
                password,
                envelope: response.envelope,
                iterations,
              });

              // Wipe plaintext password immediately
              password = '';

              const room = unwrapped.room;
              setIsDerivingKey(false);
              setUserNickname(cleanUsername);
              setUserProfile((prev) => ({ ...prev, nickname: cleanUsername }));

              const initialChat = {
                id: room,
                name: room,
                type: 'room',
                key: unwrapped.key,
                salt: response.salt,
                epoch: unwrapped.epoch || response.epoch || 1,
                messages: [],
                presenceCount: response.count || 1,
                failedDecryptCount: 0,
                lastMessage: 'Vault unlocked via Admin Invite',
                unreadCount: 0,
              };

              setChats([initialChat]);
              setActiveChatId(room);
              activeChatIdRef.current = room;
              setRoomMembers([{ userId: myUserId, nickname: cleanUsername }]);
              setStatusNotice('');

              socketRef.current.emit('announce_presence', {
                v: 1,
                room,
                userId: myUserId,
                nickname: cleanUsername,
              });
              socketRef.current.emit('request_presence', {
                v: 1,
                room,
              });
            } catch (unwrapErr) {
              setIsDerivingKey(false);
              if (response.room) {
                socketRef.current.emit('leave', { room: response.room });
              }
              setLoginError('Failed to unwrap AES-256-GCM room key: invalid invite password.');
            }
          }
        );
      } catch (err) {
        setIsDerivingKey(false);
        setLoginError(err.message || 'Invalid 10-character credentials.');
      }
    },
    [myUserId]
  );

  // Switch Active Chat
  const handleSelectChat = useCallback((chatId) => {
    if (chatId === activeChatIdRef.current) {
      setIsSidebarOpen(false);
      return;
    }

    if (socketRef.current) {
      socketRef.current.emit('join', { v: 1, room: chatId }, (res) => {
        if (res && res.ok && res.count) {
          updateChatPresence(chatId, res.count);
        }
      });
    }

    setActiveChatId(chatId);
    activeChatIdRef.current = chatId;
    setReplyingTo(null);
    setStatusNotice('');
    setIsSidebarOpen(false);

    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, unreadCount: 0 } : c))
    );
  }, []);

  // Join or Create an Additional Room
  const handleJoinAdditionalRoom = useCallback(
    async ({ room, password }) => {
      if (!socketRef.current) return;

      socketRef.current.emit(
        'join',
        { v: 1, room, userId: myUserId, nickname: userNickname },
        async (response) => {
          if (!response || !response.ok) {
            const code = response?.code || 'ERROR';
            setStatusNotice(FRIENDLY_ERRORS[code] || 'Failed to join room.');
            return;
          }

          try {
            const iterations = Number(import.meta.env?.VITE_PBKDF2_ITERATIONS || 600000);
            const roomSalt = response.salt || undefined;
            const roomEpoch = response.epoch || 1;

            const key = await deriveRoomKey({
              password,
              roomName: room,
              salt: roomSalt,
              epoch: roomEpoch,
              iterations,
            });
            password = '';

            const newChat = {
              id: room,
              name: room,
              type: 'room',
              key,
              salt: roomSalt,
              epoch: roomEpoch,
              messages: [],
              presenceCount: response.count || 1,
              failedDecryptCount: 0,
              lastMessage: 'Room joined',
              unreadCount: 0,
            };

            setChats((prev) => {
              const filtered = prev.filter((c) => c.id !== room);
              return [...filtered, newChat];
            });
            setActiveChatId(room);
            activeChatIdRef.current = room;
            setIsJoinModalOpen(false);
            setStatusNotice('');

            if (socketRef.current && userNickname) {
              socketRef.current.emit('announce_presence', {
                v: 1,
                room,
                userId: myUserId,
                nickname: userNickname,
              });
              socketRef.current.emit('request_presence', {
                v: 1,
                room,
              });
            }
          } catch (err) {
            socketRef.current.emit('leave', { room });
            setStatusNotice(err.message || 'Key derivation failed.');
          }
        }
      );
    },
    [myUserId, userNickname]
  );

  // Start Direct 1-on-1 Private Chat
  const handleStartDirectChat = useCallback(
    async ({ peerId, peerName, password, isAcceptingInvite }) => {
      if (!socketRef.current) return;
      const sortedIds = [myUserId, peerId].sort();
      const pairwiseRoom = `dm-${sortedIds[0]}-${sortedIds[1]}`;

      socketRef.current.emit(
        'join',
        { v: 1, room: pairwiseRoom, userId: myUserId, nickname: userNickname },
        async (response) => {
          if (!response || !response.ok) {
            const code = response?.code || 'ERROR';
            setStatusNotice(FRIENDLY_ERRORS[code] || 'Failed to establish direct chat.');
            return;
          }

          try {
            const iterations = Number(import.meta.env?.VITE_PBKDF2_ITERATIONS || 600000);
            const roomSalt = response.salt || undefined;
            const roomEpoch = response.epoch || 1;

            const key = await deriveRoomKey({
              password,
              roomName: pairwiseRoom,
              salt: roomSalt,
              epoch: roomEpoch,
              iterations,
            });
            password = '';

            directChatRoomsRef.current.add(pairwiseRoom);
            directChatPeersRef.current.add(peerId);

            const directChat = {
              id: pairwiseRoom,
              name: peerName || peerId,
              type: 'direct',
              peerId,
              peerName: peerName || peerId,
              key,
              salt: roomSalt,
              epoch: roomEpoch,
              messages: [],
              presenceCount: response.count || 1,
              failedDecryptCount: 0,
              lastMessage: 'Direct chat established',
              unreadCount: 0,
            };

            setChats((prev) => {
              const filtered = prev.filter((c) => c.id !== pairwiseRoom);
              return [...filtered, directChat];
            });
            setActiveChatId(pairwiseRoom);
            activeChatIdRef.current = pairwiseRoom;
            setIsDirectModalOpen(false);
            setTargetMemberForDirect(null);
            setIncomingDirectInvite(null);
            setStatusNotice('');

            if (socketRef.current && userNickname) {
              socketRef.current.emit('announce_presence', {
                v: 1,
                room: pairwiseRoom,
                userId: myUserId,
                nickname: userNickname,
              });
            }

            if (!isAcceptingInvite && (response.count === undefined || response.count < 2)) {
              socketRef.current.emit('dm_invite', {
                v: 1,
                targetUserId: peerId,
                fromUserId: myUserId,
                fromNickname: userNickname,
                room: pairwiseRoom,
              });
            }
          } catch (err) {
            socketRef.current.emit('leave', { room: pairwiseRoom });
            setStatusNotice(err.message || 'Key derivation failed.');
          }
        }
      );
    },
    [myUserId, userNickname]
  );

  // Send Message
  const handleSendMessage = useCallback(
    async (text, replyContext, file) => {
      const currentChat = chatsRef.current.find((c) => c.id === activeChatIdRef.current);
      if (!currentChat || !currentChat.key || !socketRef.current) return;

      try {
        const payload = await encryptMessage({
          key: currentChat.key,
          room: currentChat.id,
          text: text || '',
          nickname: userNickname,
          userId: myUserId,
          avatarImage: userProfile?.avatarImage || null,
          avatarEmoji: userProfile?.avatarEmoji || null,
          avatarGradient: userProfile?.avatarGradient || null,
          replyTo: replyContext || null,
          file: file || null,
          identityKeyPair: identityKeyPairRef.current,
          epoch: currentChat.epoch || 1,
        });

        deduplicatorRef.current.checkAndAdd(payload.id);

        socketRef.current.emit('message', payload, (response) => {
          if (response && response.ok) {
            const isDeliveredInitial = Boolean(response?.delivered);
            const ownMsg = {
              id: payload.id,
              nickname: userNickname,
              userId: myUserId,
              avatarImage: userProfile?.avatarImage || null,
              avatarEmoji: userProfile?.avatarEmoji || null,
              avatarGradient: userProfile?.avatarGradient || null,
              text: text || '',
              file: file || null,
              timestamp: Date.now(),
              replyTo: replyContext
                ? {
                    id: String(replyContext.id),
                    nickname: String(replyContext.nickname || ''),
                    text: String(
                      replyContext.text ||
                        (replyContext.file
                          ? replyContext.file.isVoiceNote
                            ? '🎤 Voice note'
                            : replyContext.file.type && replyContext.file.type.startsWith('image/')
                            ? '📷 Photo'
                            : `📎 ${replyContext.file.name || 'Attachment'}`
                          : '')
                    ),
                  }
                : null,
              isOwn: true,
              status: isDeliveredInitial ? 'delivered' : 'sent',
              delivered: isDeliveredInitial,
              isRead: false,
              readBy: [],
            };

            const fileLabel = file
              ? file.isVoiceNote || (file.type && file.type.startsWith('audio/'))
                ? '🎤 [Voice Note] '
                : file.type && file.type.startsWith('image/')
                ? '📷 [Image] '
                : '📎 [File] '
              : '';
            const previewText = text
              ? text.slice(0, 30)
              : file?.isVoiceNote
              ? `${Math.round(file.duration || 0)}s voice note`
              : file?.name || 'Attachment';

            setChats((prev) =>
              prev.map((c) => {
                if (c.id === currentChat.id) {
                  return {
                    ...c,
                    messages: [...c.messages, ownMsg],
                    lastMessage: `You: ${fileLabel}${previewText}`,
                  };
                }
                return c;
              })
            );
            setStatusNotice('');
          } else {
            const code = response?.code || 'ERROR';
            setStatusNotice(FRIENDLY_ERRORS[code] || 'Message transmission failed.');
          }
        });
      } catch (err) {
        setStatusNotice(err?.message || 'Encryption error: unable to send message.');
      }
    },
    [userNickname, myUserId, userProfile]
  );

  // Broadcast typing status
  const handleTyping = useCallback(
    async (isTyping) => {
      if (!socketRef.current || !activeChatIdRef.current) return;
      const roomId = activeChatIdRef.current;
      const currentChat = chatsRef.current.find((c) => c.id === roomId);

      if (currentChat && currentChat.key) {
        try {
          const encryptedSignal = await encryptTypingSignal({
            key: currentChat.key,
            room: roomId,
            isTyping,
            userId: myUserId,
            nickname: userNickname,
            ttl: 3000,
            identityKeyPair: identityKeyPairRef.current,
          });
          socketRef.current.emit('typing', {
            v: 1,
            room: roomId,
            ciphertext: encryptedSignal.ciphertext,
            iv: encryptedSignal.iv,
            ttl: encryptedSignal.ttl,
            signalId: encryptedSignal.signalId,
          });
        } catch {
          return;
        }
      }
    },
    [myUserId, userNickname]
  );

  // Send or toggle encrypted emoji reaction
  const handleReact = useCallback(
    async (targetMessageId, emoji) => {
      if (!socketRef.current || !activeChatIdRef.current || !targetMessageId || !emoji) return;
      const roomId = activeChatIdRef.current;
      const currentChat = chatsRef.current.find((c) => c.id === roomId);
      if (!currentChat || !currentChat.key) return;

      const targetMsg = currentChat.messages.find((m) => m.id === targetMessageId);
      if (!targetMsg) return;

      const existingReactions = targetMsg.reactions || {};
      const currentData = existingReactions[emoji];
      const hasMyReaction = currentData?.users ? currentData.users.includes(myUserId) : false;
      const action = hasMyReaction ? 'remove' : 'add';

      setChats((prev) =>
        prev.map((c) => {
          if (c.id === roomId) {
            return {
              ...c,
              messages: c.messages.map((m) => {
                if (m.id === targetMessageId) {
                  const updatedReactions = { ...(m.reactions || {}) };
                  const userList = [...(updatedReactions[emoji]?.users || [])];
                  const nameList = [...(updatedReactions[emoji]?.names || [])];

                  if (action === 'remove') {
                    const idx = userList.indexOf(myUserId);
                    if (idx !== -1) {
                      userList.splice(idx, 1);
                      nameList.splice(idx, 1);
                    }
                    if (userList.length === 0) {
                      delete updatedReactions[emoji];
                    } else {
                      updatedReactions[emoji] = {
                        count: userList.length,
                        users: userList,
                        names: nameList,
                      };
                    }
                  } else {
                    if (!userList.includes(myUserId)) {
                      userList.push(myUserId);
                      nameList.push(userNickname || myUserId);
                    }
                    updatedReactions[emoji] = {
                      count: userList.length,
                      users: userList,
                      names: nameList,
                    };
                  }

                  return {
                    ...m,
                    reactions: updatedReactions,
                  };
                }
                return m;
              }),
            };
          }
          return c;
        })
      );

      try {
        const encrypted = await encryptReaction({
          key: currentChat.key,
          room: roomId,
          targetMessageId,
          emoji,
          action,
          userId: myUserId,
          nickname: userNickname,
          identityKeyPair: identityKeyPairRef.current,
        });
        socketRef.current.emit('reaction', encrypted);
      } catch (err) {
        console.error('Failed to encrypt reaction:', err);
      }
    },
    [myUserId, userNickname]
  );

  // Leave a specific Chat
  const handleLeaveChat = useCallback((chatId) => {
    if (socketRef.current) {
      socketRef.current.emit('leave', { room: chatId });
    }
    directChatRoomsRef.current.delete(chatId);
    const leavingChat = chatsRef.current.find((c) => c.id === chatId);
    if (leavingChat?.peerId) {
      directChatPeersRef.current.delete(leavingChat.peerId);
    }
    setChats((prev) => {
      const remaining = prev.filter((c) => c.id !== chatId);
      if (activeChatIdRef.current === chatId) {
        const nextActive = remaining.length > 0 ? remaining[0].id : null;
        setActiveChatId(nextActive);
        activeChatIdRef.current = nextActive;
      }
      return remaining;
    });
    setReplyingTo(null);
    setStatusNotice('');
  }, []);

  const handleLeaveCurrent = useCallback(() => {
    if (activeChatId) {
      handleLeaveChat(activeChatId);
    }
  }, [activeChatId, handleLeaveChat]);

  const handleClearChatHistory = useCallback((chatId) => {
    if (!chatId) return;
    setChats((prev) =>
      prev.map((c) => {
        if (c.id === chatId) {
          return {
            ...c,
            messages: [],
            unreadCount: 0,
            failedDecryptCount: 0,
            lastMessage: 'Session history cleared',
          };
        }
        return c;
      })
    );
    setReplyingTo(null);
    setStatusNotice('Session history cleared from local memory.');
  }, []);

  const handleStartDirectWithMember = (member) => {
    if (!member || !member.userId) return;
    const existingChat = chats.find(
      (c) => c.type === 'direct' && c.peerId === member.userId
    );
    if (existingChat) {
      handleSelectChat(existingChat.id);
      return;
    }
    setTargetMemberForDirect(member);
    setIsDirectModalOpen(true);
  };

  const handleAcceptDirectInvite = (invite) => {
    if (invite?.fromUserId) {
      directChatPeersRef.current.add(invite.fromUserId);
    }
    if (invite?.room) {
      directChatRoomsRef.current.add(invite.room);
    }
    setTargetMemberForDirect({
      userId: invite.fromUserId,
      nickname: invite.fromNickname,
      isAcceptingInvite: true,
    });
    setIncomingDirectInvite(null);
    setIsDirectModalOpen(true);
  };

  if (!isSecureContextAvailable) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full p-6 bg-rose-950/20 border border-rose-800/60 rounded-xl text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-full bg-rose-900/40 text-rose-400 flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="text-base font-mono font-bold text-rose-300">
            Secure Context Required
          </h2>
          <p className="text-xs font-mono text-zinc-400 leading-relaxed">
            Browser Web Crypto APIs are disabled because this page is not served over a secure HTTPS connection or localhost.
          </p>
          <p className="text-xs font-mono text-zinc-500">
            Please access this application via HTTPS or through an SSH tunnel to localhost.
          </p>
        </div>
      </div>
    );
  }

  const handleUpdateUserProfile = useCallback(
    ({ nickname, avatarGradient, avatarEmoji, statusBio, avatarImage }) => {
      const updated = {
        nickname,
        avatarGradient,
        avatarEmoji,
        statusBio,
        avatarImage: avatarImage || null,
      };
      setUserProfile(updated);
      setUserNickname(nickname);
      try {
        localStorage.setItem('pcr_user_profile', JSON.stringify(updated));
      } catch {}
      setStatusNotice('Profile updated successfully!');
      if (socketRef.current) {
        chats.forEach((chat) => {
          socketRef.current.emit('announce_presence', {
            v: 1,
            room: chat.id,
            userId: myUserId,
            nickname,
          });
        });
      }
    },
    [chats, myUserId]
  );

  const handleUpdateGroupProfile = useCallback((chatId, newGroupProfile) => {
    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, groupProfile: newGroupProfile } : c))
    );
    setStatusNotice('Group profile updated successfully.');
  }, []);

  const handleSessionExpired = useCallback(() => {
    setChats([]);
    setActiveChatId(null);
    setReplyingTo(null);
    setIsSessionExpiryModalOpen(false);
    setIsSessionExportOpen(false);
    setLoginError('Your encrypted session expired and was securely wiped from volatile memory.');
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current.connect();
    }
  }, []);

  const handleExtendSession = useCallback((secondsToAdd = 900) => {
    setSessionSecondsRemaining((prev) => Math.min(prev + secondsToAdd, 7200));
    setIsSessionExpiryModalOpen(false);
    hasTriggeredExpiryModalRef.current = false;
    setStatusNotice(`Encrypted session extended by ${Math.round(secondsToAdd / 60)} minutes.`);
  }, []);

  useEffect(() => {
    if (chats.length === 0 || !activeChatId) {
      setSessionSecondsRemaining(DEFAULT_SESSION_SECONDS);
      hasTriggeredExpiryModalRef.current = false;
      return;
    }

    const interval = setInterval(() => {
      setSessionSecondsRemaining((prev) => {
        if (prev <= 1) {
          handleSessionExpired();
          return 0;
        }
        if (prev <= 121 && !hasTriggeredExpiryModalRef.current) {
          hasTriggeredExpiryModalRef.current = true;
          setIsSessionExpiryModalOpen(true);
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [chats.length, activeChatId, handleSessionExpired]);

  if (viewMode === 'admin') {
    return (
      <div className="min-h-screen bg-[#f8f9fa] dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 transition-colors relative">
        <AdminDashboard onBackToChat={() => setViewMode('chat')} />
        {toggleTheme && (
          <div className="fixed bottom-4 left-4 z-40">
            <button
              type="button"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label="Toggle theme"
              className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-white/90 dark:bg-zinc-900/90 border border-zinc-200/90 dark:border-zinc-800 shadow-xl backdrop-blur-md text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white transition-all cursor-pointer"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-500" />
                  <span>Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Dark</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (viewMode === 'profile') {
    return (
      <ProfilePage
        userProfile={userProfile}
        onUpdateUserProfile={handleUpdateUserProfile}
        userId={myUserId}
        chats={chats}
        activeChatId={activeChatId}
        onUpdateGroupProfile={handleUpdateGroupProfile}
        onBackToChat={() => setViewMode('chat')}
        roomMembers={roomMembers}
        theme={theme}
        onToggleTheme={toggleTheme}
        onRotateIdentityKey={handleRotateIdentityKey}
        myIdentityFingerprint={myIdentityFingerprint}
        isIdentityPersisted={isIdentityPersisted}
      />
    );
  }

  const currentChat = chats.find((c) => c.id === activeChatId);

  return (
    <div className="min-h-screen text-zinc-900 dark:text-zinc-100 flex flex-col font-sans relative transition-colors duration-200">
      {/* Incoming Direct Chat Invitation Notification Bar */}
      {incomingDirectInvite && (
        <div className="fixed top-3 right-3 sm:right-6 z-50 max-w-sm sm:max-w-md bg-white dark:bg-zinc-900 border border-cyan-500 rounded-2xl p-4 shadow-2xl dark:shadow-[0_0_25px_rgba(6,182,212,0.3)] flex flex-col gap-2.5 font-sans animate-bubble">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Mail className="w-5 h-5 text-cyan-500 shrink-0" />
              <div>
                <h3 className="text-xs font-bold text-cyan-700 dark:text-cyan-300">
                  Incoming Private Chat Request
                </h3>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-300 mt-0.5">
                  <strong className="text-zinc-900 dark:text-white font-semibold">
                    {incomingDirectInvite.fromNickname}
                  </strong>{' '}
                  <span className="text-cyan-600 dark:text-cyan-400 text-[10px] font-mono">
                    ({incomingDirectInvite.fromUserId})
                  </span>{' '}
                  invited you to a direct 1-on-1 chat!
                </p>
              </div>
            </div>
            <button
              onClick={() => setIncomingDirectInvite(null)}
              className="text-zinc-400 hover:text-zinc-700 dark:hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 pt-1 border-t border-zinc-200 dark:border-zinc-800">
            <button
              onClick={() => handleAcceptDirectInvite(incomingDirectInvite)}
              className="flex-1 py-1.5 px-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-bold text-xs uppercase transition-colors cursor-pointer"
            >
              Join Direct Chat
            </button>
            <button
              onClick={() => setIncomingDirectInvite(null)}
              className="py-1.5 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs transition-colors cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {chats.length === 0 || !currentChat ? (
        <div className="flex-1 flex flex-col justify-center items-center p-4 sm:p-6 my-auto">
          <Login
            onJoin={handleInitialJoin}
            isDerivingKey={isDerivingKey}
            connectionState={connectionState}
            errorMessage={loginError}
            userId={myUserId}
            onOpenIntro={() => setIsIntroModalOpen(true)}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
          <div className="text-center mt-6 flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 text-xs">
            <span className="font-mono text-zinc-700 dark:text-zinc-400">
              Your User ID:{' '}
              <strong className="text-emerald-700 dark:text-emerald-400 font-mono">
                {myUserId}
              </strong>
            </span>
            <span className="text-zinc-400 dark:text-zinc-600">•</span>
            <button
              onClick={() => setIsIntroModalOpen(true)}
              className="font-medium text-zinc-800 dark:text-zinc-300 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors inline-flex items-center gap-1.5 cursor-pointer underline decoration-zinc-300 dark:decoration-zinc-700 underline-offset-2"
            >
              <BookOpen className="w-3.5 h-3.5 shrink-0" />
              <span>Platform Architecture & Specs</span>
            </button>
            <span className="text-zinc-400 dark:text-zinc-600">•</span>
            <button
              onClick={() => setViewMode('admin')}
              className="font-medium text-zinc-800 dark:text-zinc-300 hover:text-amber-600 dark:hover:text-amber-400 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Shield className="w-3.5 h-3.5 shrink-0" />
              <span>Admin Console</span>
            </button>
          </div>
          <footer className="mt-8 text-center text-[11px] font-sans text-zinc-600 dark:text-zinc-500 border-t border-zinc-200/80 dark:border-zinc-800/80 pt-4 max-w-md w-full">
            Private Chatroom • Zero-Persistence Encrypted Relay • Protocol v1
          </footer>
        </div>
      ) : (
        <div className="flex h-screen overflow-hidden relative">
          <NavigationRail
            nickname={userNickname}
            userId={myUserId}
            userProfile={userProfile}
            activeView={
              viewMode === 'admin' ? 'admin' : viewMode === 'profile' ? 'profile' : 'messages'
            }
            onSelectView={(v) => {
              if (v === 'messages') setViewMode('chat');
              if (v === 'admin') setViewMode('admin');
              if (v === 'profile') setViewMode('profile');
            }}
            onOpenNewRoom={() => setIsJoinModalOpen(true)}
            onOpenDirectChat={() => {
              setTargetMemberForDirect(null);
              setIsDirectModalOpen(true);
            }}
            onOpenAdmin={() => setViewMode('admin')}
            onOpenProfile={() => setViewMode('profile')}
            onOpenIntro={() => setIsIntroModalOpen(true)}
            theme={theme}
            onToggleTheme={toggleTheme}
            presenceCount={currentChat.presenceCount}
          />
          <ActiveChatsSidebar
            userId={myUserId}
            nickname={userNickname}
            userProfile={userProfile}
            activeChatId={activeChatId}
            chats={chats}
            onSelectChat={handleSelectChat}
            onOpenNewRoomModal={() => setIsJoinModalOpen(true)}
            onOpenDirectChatModal={() => {
              setTargetMemberForDirect(null);
              setIsDirectModalOpen(true);
            }}
            onLeaveChat={handleLeaveChat}
            onOpenAdmin={() => setViewMode('admin')}
            onOpenProfile={() => setViewMode('profile')}
            roomMembers={roomMembers}
            onStartDirectWithMember={handleStartDirectWithMember}
            isOpen={isSidebarOpen}
            onCloseMobile={() => setIsSidebarOpen(false)}
            typingUsersByRoom={typingUsersByRoom}
            theme={theme}
            onToggleTheme={toggleTheme}
            onOpenIntro={() => setIsIntroModalOpen(true)}
          />
          <main className="flex-1 flex flex-col min-w-0 h-full">
            <ChatBox
              room={currentChat.name}
              chatKey={currentChat.key}
              nickname={userNickname}
              presenceCount={currentChat.presenceCount}
              connectionState={connectionState}
              messages={currentChat.messages}
              failedDecryptCount={currentChat.failedDecryptCount}
              onSendMessage={handleSendMessage}
              onLeaveRoom={handleLeaveCurrent}
              onClearSession={() => handleClearChatHistory(currentChat.id)}
              statusNotice={statusNotice}
              onDismissNotice={() => setStatusNotice('')}
              onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
              onBackToSidebar={() => setIsSidebarOpen(true)}
              replyingTo={replyingTo}
              onSetReplyingTo={(msg) => setReplyingTo(msg)}
              onCancelReply={() => setReplyingTo(null)}
              chatType={currentChat.type}
              peerName={currentChat.peerName}
              peerId={currentChat.peerId}
              onTyping={handleTyping}
              typingUsers={typingUsersByRoom[currentChat.id] || []}
              onOpenIntro={() => setIsIntroModalOpen(true)}
              theme={theme}
              onToggleTheme={toggleTheme}
              groupProfile={currentChat.groupProfile}
              onOpenGroupProfile={() => setViewMode('profile')}
              sessionSecondsRemaining={sessionSecondsRemaining}
              onExtendSession={handleExtendSession}
              onOpenExpiryModal={() => setIsSessionExpiryModalOpen(true)}
              myPublicKeySpki={identityKeyPairRef.current?.publicKeySpki || null}
              peerPublicKeySpki={
                currentChat.peerId
                  ? identityRegistryRef.current.getIdentity(currentChat.peerId)?.publicKeySpki ||
                    null
                  : null
              }
              onReact={handleReact}
              myUserId={myUserId}
            />
          </main>
        </div>
      )}

      {/* Modals */}
      {isJoinModalOpen && (
        <JoinRoomModal
          onClose={() => setIsJoinModalOpen(false)}
          onJoinRoom={handleJoinAdditionalRoom}
        />
      )}

      {isDirectModalOpen && (
        <DirectChatModal
          myUserId={myUserId}
          targetMember={targetMemberForDirect}
          onlineMembers={roomMembers.filter((m) => m.userId !== myUserId)}
          onClose={() => {
            setIsDirectModalOpen(false);
            setTargetMemberForDirect(null);
          }}
          onStartDirect={handleStartDirectChat}
        />
      )}

      <PlatformIntroModal
        isOpen={isIntroModalOpen}
        onClose={() => setIsIntroModalOpen(false)}
      />

      <SessionExpiryModal
        isOpen={isSessionExpiryModalOpen}
        secondsRemaining={sessionSecondsRemaining}
        onExtendSession={() => handleExtendSession(900)}
        onPurgeNow={handleSessionExpired}
        onExportBackup={() => {
          setIsSessionExpiryModalOpen(false);
          setIsSessionExportOpen(true);
        }}
        onClose={() => setIsSessionExpiryModalOpen(false)}
      />

      {currentChat && (
        <ExportModal
          isOpen={isSessionExportOpen}
          onClose={() => setIsSessionExportOpen(false)}
          room={currentChat.name}
          chatType={currentChat.type}
          peerName={currentChat.peerName}
          peerId={currentChat.peerId}
          messages={currentChat.messages}
          onClearSession={() => handleClearChatHistory(currentChat.id)}
        />
      )}
    </div>
  );
}