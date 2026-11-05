import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Message, DecryptFailureBanner } from './Message.jsx';
import { ExportModal } from './ExportModal.jsx';
import { VoiceNoteRecorder } from './VoiceNoteRecorder.jsx';
import { EmojiPicker } from './EmojiPicker.jsx';
import { SessionCountdownBadge } from './SessionExpiryAlert.jsx';
import { SecurityVerificationModal } from './SecurityVerificationModal.jsx';
import {
  Lock,
  Settings,
  ShieldCheck,
  BookOpen,
  Download,
  Trash2,
  LogOut,
  Megaphone,
  Search,
  X,
  Mic,
  Camera,
  Paperclip,
  Filter,
  ChevronUp,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Headphones,
  Link as LinkIcon,
} from 'lucide-react';
import { filterSessionMessages } from '../utils/searchMessages.js';

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const AVATAR_PALETTES = [
  'from-blue-600 to-indigo-500',
  'from-emerald-600 to-teal-500',
  'from-amber-500 to-orange-600',
  'from-purple-600 to-pink-500',
  'from-rose-500 to-red-600',
  'from-cyan-600 to-blue-500',
  'from-violet-600 to-purple-500',
];

function getAvatarGradient(name = '') {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[index];
}

export function ChatBox({
  room,
  chatKey,
  nickname,
  presenceCount,
  connectionState,
  messages,
  failedDecryptCount,
  onSendMessage,
  onLeaveRoom,
  onClearSession,
  maxMessageBytes = 1048576,
  statusNotice,
  onDismissNotice,
  onToggleSidebar,
  replyingTo,
  onSetReplyingTo,
  onCancelReply,
  chatType = 'room',
  peerName,
  peerId,
  onTyping,
  typingUsers = [],
  onOpenIntro,
  theme = 'dark',
  onToggleTheme,
  onBackToSidebar,
  groupProfile,
  onOpenGroupProfile,
  sessionSecondsRemaining,
  onExtendSession,
  onOpenExpiryModal,
  myPublicKeySpki,
  peerPublicKeySpki,
  onReact,
  myUserId,
}) {
  const [inputText, setInputText] = useState('');
  const [attachedFile, setAttachedFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [isRecordingVoiceNote, setIsRecordingVoiceNote] = useState(false);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [reactingToMessageId, setReactingToMessageId] = useState(null);

  const [isVerificationOpen, setIsVerificationOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [filterOnly, setFilterOnly] = useState(false);
  const [filterContentType, setFilterContentType] = useState('all');
  const [filterSender, setFilterSender] = useState('all');
  const [showFilterOptions, setShowFilterOptions] = useState(false);
  const searchInputRef = useRef(null);

  const messagesEndRef = useRef(null);
  const containerRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const isNearBottomRef = useRef(true);
  const typingTimeoutRef = useRef(null);

  const handleResetSearch = useCallback(() => {
    setSearchQuery('');
    setFilterContentType('all');
    setFilterSender('all');
    setCurrentMatchIndex(0);
  }, []);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    handleResetSearch();
    setIsSearchOpen(false);
  }, [room, handleResetSearch]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleOutsideClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isMenuOpen]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      if (onTyping) {
        onTyping(false);
      }
    };
  }, [room, onTyping]);

  const hasActiveFilter = Boolean(
    searchQuery.trim() || filterContentType !== 'all' || filterSender !== 'all'
  );
  const trimmedQuery = searchQuery.trim().toLowerCase();

  const matchingMessages = useMemo(() => {
    if (!hasActiveFilter) return [];
    return filterSessionMessages(messages, {
      query: searchQuery,
      contentType: filterContentType,
      sender: filterSender,
    });
  }, [messages, searchQuery, filterContentType, filterSender, hasActiveFilter]);

  useEffect(() => {
    if (matchingMessages.length > 0 && currentMatchIndex >= matchingMessages.length) {
      setCurrentMatchIndex(0);
    }
  }, [matchingMessages.length, currentMatchIndex]);

  const scrollToMatch = (index) => {
    if (matchingMessages.length === 0) return;
    const targetMsg = matchingMessages[index];
    if (!targetMsg) return;
    const el = document.getElementById(`msg-${targetMsg.id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleNextMatch = () => {
    if (matchingMessages.length === 0) return;
    const nextIdx = (currentMatchIndex + 1) % matchingMessages.length;
    setCurrentMatchIndex(nextIdx);
    scrollToMatch(nextIdx);
  };

  const handlePrevMatch = () => {
    if (matchingMessages.length === 0) return;
    const prevIdx = (currentMatchIndex - 1 + matchingMessages.length) % matchingMessages.length;
    setCurrentMatchIndex(prevIdx);
    scrollToMatch(prevIdx);
  };

  const displayedMessages = useMemo(() => {
    if (filterOnly && hasActiveFilter) {
      return matchingMessages;
    }
    return messages;
  }, [messages, matchingMessages, filterOnly, hasActiveFilter]);

  const inputBytes = new TextEncoder().encode(inputText).byteLength;
  const totalEstimatedBytes = inputBytes + (attachedFile ? attachedFile.size * 1.35 : 0);
  const isTooLarge = totalEstimatedBytes > maxMessageBytes;
  const canSend =
    connectionState === 'connected' &&
    (inputText.trim().length > 0 || attachedFile !== null) &&
    !isTooLarge;

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 100;
  };

  useEffect(() => {
    if (isNearBottomRef.current && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, failedDecryptCount]);

  useEffect(() => {
    if (replyingTo && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [replyingTo]);

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError('');

    if (file.size > 750 * 1024) {
      setFileError('File exceeds 750 KB limit. Please select a smaller file or image.');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        const base64Data = result.split(',')[1];
        setAttachedFile({
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          data: base64Data,
        });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleInputChange = (e) => {
    setInputText(e.target.value);
    if (onTyping) {
      onTyping(true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        onTyping(false);
      }, 2000);
    }
  };

  const handleSend = () => {
    if (!canSend) return;
    if (onTyping) {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      onTyping(false);
    }
    const textToSend = inputText;
    const replyContext = replyingTo;
    const fileToSend = attachedFile;
    setInputText('');
    setAttachedFile(null);
    setFileError('');
    if (onCancelReply) onCancelReply();
    onSendMessage(textToSend, replyContext, fileToSend);
  };

  const handleSendVoiceNote = (voiceNoteFile) => {
    setIsRecordingVoiceNote(false);
    const caption = inputText.trim();
    setInputText('');
    setAttachedFile(null);
    setFileError('');
    if (onCancelReply) onCancelReply();
    onSendMessage(caption, replyingTo, voiceNoteFile);
  };

  const handleSelectEmoji = (emojiChar) => {
    if (!emojiChar) return;

    if (reactingToMessageId) {
      if (onReact) {
        onReact(reactingToMessageId, emojiChar);
      }
      setReactingToMessageId(null);
      setIsEmojiPickerOpen(false);
      return;
    }

    if (textareaRef.current) {
      const textarea = textareaRef.current;
      const start = textarea.selectionStart ?? inputText.length;
      const end = textarea.selectionEnd ?? inputText.length;
      const newText = inputText.slice(0, start) + emojiChar + inputText.slice(end);
      setInputText(newText);

      if (onTyping) {
        onTyping(true);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
          onTyping(false);
        }, 2000);
      }

      setTimeout(() => {
        textarea.focus();
        const nextPos = start + emojiChar.length;
        textarea.setSelectionRange(nextPos, nextPos);
      }, 0);
    } else {
      setInputText((prev) => prev + emojiChar);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const currentDisplayName = chatType === 'direct' ? peerName || room : `#${room}`;

  return (
    <div className="flex flex-col h-full flex-1 min-w-0 bg-[#fdfefe] dark:bg-zinc-950 relative select-none">
      {/* Hidden File Picker */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        className="hidden"
        accept="image/*,.pdf,.txt,.zip,.json,.webm,.mp3"
      />

      {/* Top Header */}
      <header className="px-3 sm:px-5 py-2.5 sm:py-3.5 bg-white dark:bg-zinc-950 border-b border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between z-10 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3.5 min-w-0">
          {(onBackToSidebar || onToggleSidebar) && (
            <button
              type="button"
              onClick={onBackToSidebar || onToggleSidebar}
              title="Back to Conversations"
              className="md:hidden flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-semibold transition-colors cursor-pointer shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              <span className="hidden xs:inline">Chats</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenGroupProfile}
            title={chatType === 'direct' ? 'View Profile Information' : 'Configure Group / Room Profile'}
            className="flex items-center gap-2 sm:gap-3.5 min-w-0 text-left hover:opacity-85 transition-opacity cursor-pointer group"
          >
            <div className="relative shrink-0">
              <div
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full overflow-hidden border border-black/10 dark:border-white/10 flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform ${
                  groupProfile?.avatarImage
                    ? 'bg-zinc-800'
                    : `bg-gradient-to-tr ${groupProfile?.avatarGradient || getAvatarGradient(currentDisplayName)} text-white font-bold text-xs`
                }`}
              >
                {groupProfile?.avatarImage ? (
                  <img src={groupProfile.avatarImage} alt={currentDisplayName} className="w-full h-full object-cover" />
                ) : (
                  groupProfile?.emoji || (chatType === 'direct' ? currentDisplayName.slice(0, 2).toUpperCase() : '#')
                )}
              </div>
              <span
                className={`absolute bottom-0 right-0 w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full border-2 border-white dark:border-zinc-950 shadow-xs ${
                  connectionState === 'connected' ? 'bg-emerald-500' : 'bg-amber-400'
                }`}
              />
            </div>

            <div className="min-w-0 flex flex-col">
              <div className="flex items-center gap-1.5 min-w-0">
                <h2 className="text-xs sm:text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-tight truncate font-sans group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                  {groupProfile?.customTitle || currentDisplayName}
                </h2>
                {chatType === 'direct' ? (
                  <span className="text-[10px] text-cyan-600 dark:text-cyan-400 font-medium shrink-0 flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    <span>Direct</span>
                  </span>
                ) : (
                  <span className="text-[10px] text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 inline-flex items-center">
                    <Settings className="w-3.5 h-3.5" />
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] font-sans text-zinc-500 dark:text-zinc-400 truncate">
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>Online</span>
                </span>
                <span>•</span>
                <span className="text-zinc-400 dark:text-zinc-500 truncate">
                  {groupProfile?.topic ||
                    (chatType === 'direct'
                      ? peerId || 'Encrypted Pairwise'
                      : `${presenceCount} active member${presenceCount === 1 ? '' : 's'}`)}
                </span>
              </div>
            </div>
          </button>
        </div>

        {/* Right Header Controls */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {typeof sessionSecondsRemaining === 'number' && (
            <SessionCountdownBadge
              secondsRemaining={sessionSecondsRemaining}
              onExtendSession={onExtendSession}
              onOpenExpiryModal={onOpenExpiryModal}
            />
          )}

          <button
            type="button"
            onClick={() => setIsVerificationOpen(true)}
            title="Verify End-to-End Encryption & Safety Number"
            className="btn-3d px-2 sm:px-2.5 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-all cursor-pointer flex items-center gap-1.5 text-xs font-semibold shrink-0"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span className="hidden md:inline font-sans text-[11px]">Verify Keys</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsSearchOpen((prev) => {
                const next = !prev;
                if (!next) {
                  handleResetSearch();
                } else {
                  setTimeout(() => searchInputRef.current?.focus(), 50);
                }
                return next;
              });
            }}
            title="Search & filter messages in this session (Ctrl+F)"
            className={`p-1.5 sm:p-2 rounded-xl transition-all cursor-pointer ${
              isSearchOpen
                ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 shadow-xs'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Search className="w-4 h-4" />
          </button>

          {onOpenIntro && (
            <button
              type="button"
              onClick={onOpenIntro}
              title="Platform Architecture & Security Guide"
              className="hidden sm:flex p-2 rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-all cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsExportOpen(true)}
            title="Export Encrypted Chat Session"
            className="hidden sm:flex p-2 rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>

          <button
            type="button"
            onClick={onLeaveRoom}
            title="Leave Conversation"
            className="hidden sm:flex p-2 rounded-xl text-zinc-400 dark:text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-all cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>

          <div className="relative sm:hidden" ref={menuRef}>
            <button
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              title="More Options"
              className="p-1.5 rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all cursor-pointer"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="1.75" />
                <circle cx="12" cy="12" r="1.75" />
                <circle cx="12" cy="19" r="1.75" />
              </svg>
            </button>

            {isMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl shadow-2xl p-1.5 z-50 text-xs font-sans animate-bubble">
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    setIsSearchOpen(true);
                    setTimeout(() => searchInputRef.current?.focus(), 50);
                  }}
                  className="w-full px-3 py-2 rounded-xl text-left text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 cursor-pointer font-medium"
                >
                  <Search className="w-4 h-4 text-amber-500" />
                  <span>Search Session (Ctrl+F)</span>
                </button>
                {onOpenGroupProfile && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onOpenGroupProfile();
                    }}
                    className="w-full px-3 py-2 rounded-xl text-left text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 cursor-pointer"
                  >
                    <Settings className="w-4 h-4 text-zinc-500" />
                    <span>Group & Room Profile</span>
                  </button>
                )}
                {onOpenIntro && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onOpenIntro();
                    }}
                    className="w-full px-3 py-2 rounded-xl text-left text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 cursor-pointer"
                  >
                    <BookOpen className="w-4 h-4 text-zinc-500" />
                    <span>Platform Guide</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    setIsVerificationOpen(true);
                  }}
                  className="w-full px-3 py-2 rounded-xl text-left text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 flex items-center gap-2 cursor-pointer font-medium"
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  <span>Verify Safety Number</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    setIsExportOpen(true);
                  }}
                  className="w-full px-3 py-2 rounded-xl text-left text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4 text-zinc-500" />
                  <span>Export Chat History</span>
                </button>
                {onClearSession && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onClearSession();
                    }}
                    className="w-full px-3 py-2 rounded-xl text-left text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 flex items-center gap-2 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4 text-amber-500" />
                    <span>Clear Memory</span>
                  </button>
                )}
                <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onLeaveRoom();
                  }}
                  className="w-full px-3 py-2 rounded-xl text-left text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2 cursor-pointer font-medium"
                >
                  <LogOut className="w-4 h-4 text-rose-500" />
                  <span>Leave Conversation</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Group Profile Ephemeral Announcement Banner */}
      {groupProfile?.announcement && (
        <div className="px-3 sm:px-5 py-2 bg-emerald-500/10 dark:bg-emerald-950/50 border-b border-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-xs flex items-center justify-between gap-2 z-10 shrink-0 animate-bubble">
          <div className="flex items-center gap-2 truncate">
            <Megaphone className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="font-semibold truncate">{groupProfile.announcement}</span>
          </div>
          {onOpenGroupProfile && (
            <button
              onClick={onOpenGroupProfile}
              className="text-[11px] underline hover:text-emerald-950 dark:hover:text-emerald-200 cursor-pointer shrink-0 font-medium"
            >
              Room Settings
            </button>
          )}
        </div>
      )}

      {/* Security, Rate-Limit & Session Status Notice Banner */}
      {statusNotice && (
        <div
          role="status"
          className={`px-3 sm:px-5 py-2 border-b text-xs flex items-center justify-between gap-2 z-10 shrink-0 animate-bubble ${
            statusNotice.includes('SECURITY WARNING')
              ? 'bg-rose-500/15 dark:bg-rose-950/70 border-rose-500/30 text-rose-800 dark:text-rose-200 font-semibold'
              : 'bg-amber-500/10 dark:bg-zinc-900 border-amber-500/20 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200'
          }`}
        >
          <span className="truncate">{statusNotice}</span>
          {onDismissNotice && (
            <button
              type="button"
              onClick={onDismissNotice}
              className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-current cursor-pointer shrink-0"
              title="Dismiss notice"
              aria-label="Dismiss notice"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* In-Session Search & Filter Bar */}
      {isSearchOpen && (
        <div className="px-3 sm:px-5 py-2.5 bg-amber-50/95 dark:bg-zinc-900 border-b border-amber-200/80 dark:border-amber-900/60 shadow-xs flex flex-col gap-2 z-10 shrink-0 font-sans animate-bubble">
          <div className="flex items-center gap-2 sm:gap-2.5">
            <div className="relative flex-1 min-w-0 flex items-center">
              <Search className="w-4 h-4 absolute left-3 text-amber-600 dark:text-amber-400 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (e.shiftKey) handlePrevMatch();
                    else handleNextMatch();
                  } else if (e.key === 'Escape') {
                    if (searchQuery) {
                      setSearchQuery('');
                    } else {
                      setIsSearchOpen(false);
                      handleResetSearch();
                    }
                  }
                }}
                placeholder="Filter & search messages, files, or peers in this session..."
                className="w-full bg-white dark:bg-zinc-950 border border-amber-300/80 dark:border-amber-700/80 rounded-xl pl-9 pr-8 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-amber-500 font-sans shadow-inner"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-0.5 rounded cursor-pointer transition-colors"
                  title="Clear search text"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {hasActiveFilter && (
              <div className="flex items-center gap-1 text-xs shrink-0 font-mono">
                <span className="text-[11px] px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/70 border border-amber-300/60 dark:border-amber-800 text-amber-900 dark:text-amber-200 font-bold whitespace-nowrap">
                  {matchingMessages.length === 0
                    ? '0 found'
                    : `${currentMatchIndex + 1}/${matchingMessages.length}`}
                </span>
                <button
                  type="button"
                  onClick={handlePrevMatch}
                  disabled={matchingMessages.length === 0}
                  title="Previous match (Shift+Enter)"
                  className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-amber-100 dark:hover:bg-amber-950 text-zinc-700 dark:text-zinc-300 hover:text-amber-800 dark:hover:text-amber-200 disabled:opacity-30 border border-zinc-200 dark:border-zinc-700 transition-colors cursor-pointer"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleNextMatch}
                  disabled={matchingMessages.length === 0}
                  title="Next match (Enter)"
                  className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-amber-100 dark:hover:bg-amber-950 text-zinc-700 dark:text-zinc-300 hover:text-amber-800 dark:hover:text-amber-200 disabled:opacity-30 border border-zinc-200 dark:border-zinc-700 transition-colors cursor-pointer"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setFilterOnly((prev) => !prev)}
              title={
                filterOnly
                  ? 'Switch to highlight mode (shows all messages)'
                  : 'Filter timeline to only matching messages'
              }
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
                filterOnly
                  ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950 border-amber-600 shadow-xs'
                  : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700'
              }`}
            >
              <Filter className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">
                {filterOnly ? 'Filtered View' : 'Highlight Mode'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowFilterOptions((prev) => !prev)}
              title="Toggle filter facets (content type, sender)"
              className={`p-1.5 px-2 rounded-xl text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer border ${
                showFilterOptions || filterContentType !== 'all' || filterSender !== 'all'
                  ? 'bg-amber-100 dark:bg-amber-950/80 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200'
                  : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              <span className="text-[11px]">Filters</span>
              {(filterContentType !== 'all' || filterSender !== 'all') && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setIsSearchOpen(false);
                handleResetSearch();
              }}
              className="text-zinc-400 hover:text-zinc-700 dark:hover:text-white p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
              title="Close search (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {(showFilterOptions || filterContentType !== 'all' || filterSender !== 'all') && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-amber-200/60 dark:border-zinc-800 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mr-0.5">
                  Type:
                </span>
                {[
                  { id: 'all', label: 'All' },
                  { id: 'text', label: 'Text', icon: FileText },
                  { id: 'media', label: 'Media & Files', icon: ImageIcon },
                  { id: 'audio', label: 'Voice Notes', icon: Headphones },
                  { id: 'links', label: 'Links', icon: LinkIcon },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setFilterContentType(item.id)}
                      className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer inline-flex items-center gap-1 ${
                        filterContentType === item.id
                          ? 'bg-amber-500 text-zinc-950 font-bold shadow-2xs'
                          : 'bg-zinc-200/60 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                      }`}
                    >
                      {Icon && <Icon className="w-3 h-3" />}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
                <span className="text-zinc-300 dark:text-zinc-700 mx-1">|</span>
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mr-0.5">
                  Sender:
                </span>
                {[
                  { id: 'all', label: 'All' },
                  { id: 'me', label: 'Me' },
                  { id: 'others', label: 'Peers' },
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setFilterSender(s.id)}
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                      filterSender === s.id
                        ? 'bg-amber-500 text-zinc-950 font-bold shadow-2xs'
                        : 'bg-zinc-200/60 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {(searchQuery || filterContentType !== 'all' || filterSender !== 'all') && (
                <button
                  type="button"
                  onClick={handleResetSearch}
                  className="text-[11px] text-amber-700 dark:text-amber-400 hover:underline cursor-pointer font-medium ml-auto"
                >
                  Reset all filters
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Messages Container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2 scrollbar-thin select-text"
      >
        <DecryptFailureBanner count={failedDecryptCount} />

        {filterOnly && hasActiveFilter && (
          <div className="mb-3 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/70 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between gap-2 shadow-xs animate-fade-in">
            <span className="flex items-center gap-1.5 font-medium">
              <Filter className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>
                Filtering session: <strong>{displayedMessages.length}</strong> of{' '}
                <strong>{messages.length}</strong> messages shown
              </span>
            </span>
            <button
              type="button"
              onClick={() => setFilterOnly(false)}
              className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
            >
              Show Full Timeline
            </button>
          </div>
        )}

        {filterOnly && hasActiveFilter && displayedMessages.length === 0 ? (
          <div className="py-14 px-4 text-center max-w-sm mx-auto animate-fade-in font-sans">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto mb-3 shadow-xs">
              <Search className="w-6 h-6 stroke-[1.75]" />
            </div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              No Matching Messages Found
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
              No messages in this chat's ephemeral storage matched your active search query and filters.
            </p>
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                type="button"
                onClick={handleResetSearch}
                className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs transition-colors cursor-pointer"
              >
                Clear Search
              </button>
              <button
                type="button"
                onClick={() => setFilterOnly(false)}
                className="px-3 py-1.5 rounded-xl bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-750 text-zinc-800 dark:text-zinc-200 text-xs transition-colors cursor-pointer font-medium"
              >
                View Full Timeline
              </button>
            </div>
          </div>
        ) : (
          displayedMessages.map((item) => (
            <Message
              key={item.id}
              item={item}
              isOwn={item.isOwn}
              onReply={onSetReplyingTo}
              searchQuery={trimmedQuery}
              isCurrentMatch={matchingMessages[currentMatchIndex]?.id === item.id}
              onReact={onReact}
              onOpenFullEmojiPicker={(msgId) => {
                setReactingToMessageId(msgId);
                setIsEmojiPickerOpen(true);
              }}
              myUserId={myUserId}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Composer Area */}
      <footer className="p-3 sm:p-4 bg-transparent shrink-0">
        <div className="max-w-4xl mx-auto flex flex-col gap-1.5">
          {typingUsers && typingUsers.length > 0 && (
            <div className="flex items-center gap-1.5 px-4 text-xs font-sans text-emerald-600 animate-pulse">
              <span className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:0.3s]" />
              </span>
              <span>
                {typingUsers.map((u) => u.nickname).join(', ')}{' '}
                {typingUsers.length === 1 ? 'is typing...' : 'are typing...'}
              </span>
            </div>
          )}

          {replyingTo && (
            <div
              dir="auto"
              className="flex items-center justify-between px-4 py-2 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs text-xs font-sans animate-slide-left text-zinc-900 dark:text-zinc-100 min-w-0"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                <span className="text-emerald-600 dark:text-emerald-400 font-bold shrink-0">
                  <bdi>↩ Replying to @{replyingTo.nickname}:</bdi>
                </span>
                <span className="text-zinc-500 dark:text-zinc-400 truncate flex-1 min-w-0">
                  <bdi>
                    {replyingTo.text ||
                      (replyingTo.file ? (
                        replyingTo.file.isVoiceNote ? (
                          <span className="inline-flex items-center gap-1">
                            <Mic className="w-3 h-3 text-emerald-500 inline" />
                            <span>Voice note</span>
                          </span>
                        ) : replyingTo.file.type && replyingTo.file.type.startsWith('image/') ? (
                          <span className="inline-flex items-center gap-1">
                            <Camera className="w-3 h-3 text-emerald-500 inline" />
                            <span>Photo</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Paperclip className="w-3 h-3 text-emerald-500 inline" />
                            <span>{replyingTo.file.name || 'Attachment'}</span>
                          </span>
                        )
                      ) : (
                        'Message'
                      ))}
                  </bdi>
                </span>
              </div>
              <button
                type="button"
                onClick={onCancelReply}
                aria-label="Cancel reply"
                title="Cancel reply"
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 ms-2 p-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer shrink-0 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* File attachment error alert */}
          {fileError && (
            <div
              role="alert"
              className="flex items-center justify-between px-4 py-2 bg-rose-50 dark:bg-rose-950/60 rounded-2xl border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-sans animate-slide-left"
            >
              <span>{fileError}</span>
              <button
                type="button"
                onClick={() => setFileError('')}
                className="text-rose-400 hover:text-rose-600 dark:hover:text-rose-200 ms-2 p-0.5 cursor-pointer"
                aria-label="Dismiss file error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Attached file preview */}
          {attachedFile && (
            <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs text-xs font-sans animate-slide-left text-zinc-900 dark:text-zinc-100">
              <div className="flex items-center gap-2 min-w-0">
                <Paperclip className="w-4 h-4 text-emerald-500 shrink-0" />
                <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  {attachedFile.name}
                </span>
                <span className="text-zinc-400 dark:text-zinc-500 text-[10px]">
                  ({formatBytes(attachedFile.size)})
                </span>
              </div>
              <button
                onClick={() => setAttachedFile(null)}
                className="text-zinc-400 hover:text-rose-500 ml-2 cursor-pointer p-0.5 rounded-md hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                title="Remove attachment"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {isRecordingVoiceNote ? (
            <VoiceNoteRecorder
              isRecordingMode={isRecordingVoiceNote}
              autoStart={true}
              onStartRecording={() => setIsRecordingVoiceNote(true)}
              onCancelRecording={() => setIsRecordingVoiceNote(false)}
              onSendVoiceNote={handleSendVoiceNote}
              disabled={connectionState !== 'connected'}
            />
          ) : (
            <div className="relative flex items-center gap-1.5 sm:gap-2 bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-full px-2.5 sm:px-3.5 py-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.06)] dark:shadow-[0_4px_28px_rgba(0,0,0,0.5)] hover:border-zinc-300 dark:hover:border-zinc-700 focus-within:border-emerald-500 dark:focus-within:border-emerald-500 transition-all">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach file (max 750 KB)"
                disabled={connectionState !== 'connected'}
                className="p-1.5 sm:p-2 rounded-full text-zinc-400 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0 cursor-pointer disabled:opacity-40"
              >
                <svg className="w-5 h-5 -rotate-45" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>

              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setIsEmojiPickerOpen((prev) => !prev)}
                  title="Insert emoji (Offline & privacy-focused)"
                  disabled={connectionState !== 'connected'}
                  className={`p-1.5 sm:p-2 rounded-full transition-colors shrink-0 cursor-pointer disabled:opacity-40 ${
                    isEmojiPickerOpen
                      ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
                <EmojiPicker
                  isOpen={isEmojiPickerOpen}
                  onClose={() => setIsEmojiPickerOpen(false)}
                  onSelectEmoji={handleSelectEmoji}
                  position="top"
                />
              </div>

              {/* Multiline-capable Textarea (Enter sends, Shift+Enter inserts newline) */}
              <textarea
                ref={textareaRef}
                rows={1}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={connectionState !== 'connected'}
                placeholder={
                  connectionState === 'connected'
                    ? attachedFile
                      ? `Add caption for ${attachedFile.name}...`
                      : replyingTo
                      ? `Reply to @${replyingTo.nickname}...`
                      : 'Write a Message...'
                    : 'Reconnecting...'
                }
                className="w-full max-h-28 resize-none bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none font-sans px-1 sm:px-2 py-1 leading-snug overflow-y-auto"
              />

              {!inputText.trim() && (
                <button
                  type="button"
                  onClick={() => setIsRecordingVoiceNote(true)}
                  disabled={connectionState !== 'connected'}
                  title="Record encrypted voice note (Web Audio API)"
                  aria-label="Record voice note"
                  className="p-1.5 sm:p-2 rounded-full text-zinc-400 dark:text-zinc-500 hover:text-emerald-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0 cursor-pointer disabled:opacity-40"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                    />
                  </svg>
                </button>
              )}

              <button
                onClick={handleSend}
                disabled={!canSend}
                aria-label="Send message"
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 transition-all duration-200 ${
                  canSend
                    ? 'bg-zinc-950 dark:bg-emerald-500 text-white dark:text-zinc-950 shadow-md hover:scale-105 active:scale-95 cursor-pointer'
                    : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed'
                }`}
              >
                <svg className="w-4 h-4 fill-current rotate-45 -translate-y-0.5 translate-x-0.5" viewBox="0 0 24 24">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </footer>

      <SecurityVerificationModal
        isOpen={isVerificationOpen}
        onClose={() => setIsVerificationOpen(false)}
        chatKey={chatKey}
        room={room}
        chatType={chatType}
        peerName={peerName}
        peerId={peerId}
        myPublicKeySpki={myPublicKeySpki}
        peerPublicKeySpki={peerPublicKeySpki}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        room={room}
        chatType={chatType}
        peerName={peerName}
        peerId={peerId}
        messages={messages}
        onClearSession={onClearSession}
      />
    </div>
  );
}