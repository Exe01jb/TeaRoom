import React from 'react';
import { VoiceNotePlayer } from './VoiceNotePlayer.jsx';
import {
  Check,
  CheckCheck,
  AlertTriangle,
  Mic,
  Camera,
  Paperclip,
  FileText,
  Download,
  Lock,
  Smile,
  Plus,
} from 'lucide-react';

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function isSafeAvatarUrl(url) {
  return typeof url === 'string' && (url.startsWith('data:image/') || url.startsWith('blob:'));
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

/**
 * Visual indicators for message status matching the inspiration screenshot
 * - pending: subtle spinning circle
 * - sent: single checkmark (✓)
 * - delivered / read: double checkmark (✓✓) in green
 */
export function MessageStatusIndicator({ status = 'sent', readCount = 0 }) {
  if (status === 'pending') {
    return (
      <span
        title="Encrypting & relaying…"
        className="inline-flex items-center text-zinc-400 select-none ml-1 shrink-0"
        aria-label="Sending message"
      >
        <svg
          className="w-3 h-3 animate-spin text-zinc-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  if (status === 'failed') {
    return (
      <span
        title="Failed to transmit"
        className="inline-flex items-center text-rose-500 select-none ml-1 shrink-0"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </span>
    );
  }

  if (status === 'read' || status === 'decrypted') {
    return (
      <span
        title={
          readCount > 1
            ? `Decrypted by ${readCount} peers`
            : 'Decrypted & verified with Web Crypto (AES-256-GCM)'
        }
        className="inline-flex items-center text-emerald-600 select-none ml-1 shrink-0"
        aria-label="Decrypted by recipient"
      >
        <CheckCheck className="w-3.5 h-3.5" />
      </span>
    );
  }

  if (status === 'delivered') {
    return (
      <span
        title="Delivered to device"
        className="inline-flex items-center text-emerald-600/80 select-none ml-1 shrink-0"
        aria-label="Delivered"
      >
        <CheckCheck className="w-3.5 h-3.5" />
      </span>
    );
  }

  // Default: 'sent'
  return (
    <span
      title="Relayed to server"
      className="inline-flex items-center text-zinc-400 select-none ml-1 shrink-0"
      aria-label="Sent"
    >
      <Check className="w-3 h-3" />
    </span>
  );
}

export const ReadReceipt = MessageStatusIndicator;

/**
 * Text highlighter for search query matches
 */
export function HighlightText({ text, query }) {
  if (!query || !query.trim() || !text) {
    return <span className="whitespace-pre-wrap select-text">{text}</span>;
  }
  const q = query.trim();
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <span className="whitespace-pre-wrap select-text">
      {parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark
            key={i}
            className="bg-amber-300 text-amber-950 px-1 rounded font-semibold"
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  );
}

/**
 * Message component matching the inspiration UI:
 * - Left received bubbles: deep dark charcoal bubbles with avatar beside it
 * - Right sent bubbles: clean white / light bubbles with status checkmarks
 * - Audio Voice Notes: styled pill with black circle play button and sound wave bars
 * - Fluid entrance animation (animate-bubble)
 */
export function Message({
  item,
  isOwn,
  onReply,
  searchQuery = '',
  isCurrentMatch = false,
  onReact,
  onOpenFullEmojiPicker,
  myUserId,
}) {
  const [showQuickReactions, setShowQuickReactions] = React.useState(false);

  if (item.type === 'system') {
    return (
      <div className="flex justify-center my-3 animate-fade-in">
        <span className="text-[11px] px-3 py-1 rounded-full bg-zinc-200/70 dark:bg-zinc-800/80 border border-zinc-300/50 dark:border-zinc-700/60 text-zinc-600 dark:text-zinc-300 font-sans font-medium">
          {item.text}
        </span>
      </div>
    );
  }

  let effectiveTime = item.timestamp;
  if (item.serverTime && Math.abs(item.timestamp - item.serverTime) > 300000) {
    effectiveTime = item.serverTime;
  }

  const timeStr = new Date(effectiveTime).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  const isRead = Boolean(item.isRead || (item.readBy && item.readBy.length > 0));
  const readCount = item.readBy ? item.readBy.length : isRead ? 1 : 0;

  let effectiveStatus = item.status || 'sent';
  if (isRead) {
    effectiveStatus = 'read';
  } else if (item.delivered && effectiveStatus !== 'read') {
    effectiveStatus = 'delivered';
  }

  return (
    <div
      id={`msg-${item.id}`}
      className={`group relative flex mb-4 animate-bubble ${
        isOwn ? 'justify-end' : 'justify-start'
      }`}
    >
      <div
        className={`flex items-end gap-2.5 max-w-[88%] sm:max-w-[75%] ${
          isOwn ? 'flex-row-reverse' : 'flex-row'
        }`}
      >
        {/* Contact Avatar (for both received and own messages) */}
        <div
          title={isOwn ? `You (${item.nickname || 'You'})` : `${item.nickname} (${item.userId || ''})`}
          className={`w-8 h-8 rounded-full shadow-xs mb-5 shrink-0 overflow-hidden select-none border border-black/10 dark:border-white/10 ${
            item.avatarImage && isSafeAvatarUrl(item.avatarImage)
              ? 'bg-zinc-800'
              : `bg-gradient-to-tr ${item.avatarGradient || getAvatarGradient(item.nickname || 'You')} text-white font-bold text-xs flex items-center justify-center`
          }`}
        >
          {item.avatarImage && isSafeAvatarUrl(item.avatarImage) ? (
            <img
              src={item.avatarImage}
              alt={item.nickname || 'Avatar'}
              className="w-full h-full object-cover"
            />
          ) : (
            item.avatarEmoji || (item.nickname ? item.nickname.slice(0, 2).toUpperCase() : isOwn ? 'ME' : 'U')
          )}
        </div>

        {/* Bubble + Metadata Column */}
        <div className={`flex flex-col min-w-0 max-w-full ${isOwn ? 'items-end' : 'items-start'}`}>
          {/* Sender nickname label for group rooms (only for incoming) */}
          {!isOwn && item.nickname && (
            <div className="flex items-center gap-1.5 mb-1 px-1 text-[11px] font-sans font-medium text-zinc-500">
              <span>
                <HighlightText text={item.nickname} query={searchQuery} />
              </span>
              {item.userId && (
                <span className="text-[9px] font-mono text-zinc-400">
                  [<HighlightText text={item.userId.slice(0, 6)} query={searchQuery} />]
                </span>
              )}
            </div>
          )}

          {/* Main Bubble Card with 3D Depth */}
          <div
            dir="auto"
            style={{ unicodeBidi: 'plaintext' }}
            className={`relative rounded-[22px] px-4 py-3 text-sm break-words transition-all duration-200 min-w-0 max-w-full ${
              item.replyTo ? 'min-w-[200px] sm:min-w-[240px] w-fit' : ''
            } ${
              isCurrentMatch
                ? 'ring-2 ring-amber-400 shadow-[0_0_16px_rgba(251,191,36,0.4)]'
                : ''
            } ${
              isOwn
                ? 'bubble-3d-sent bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border border-zinc-200/80 dark:border-zinc-700 rounded-br-sm'
                : 'bubble-3d-received bg-[#121316] dark:bg-zinc-900 text-white border border-transparent dark:border-zinc-800/80 rounded-bl-sm'
            }`}
          >
            {/* Cryptographic Identity Change Warning */}
            {item.identityWarning && (
              <div className="mb-2 p-2 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-600 dark:text-rose-400 text-[10px] flex items-center gap-1.5 font-sans font-semibold">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                <span>SECURITY WARNING: Sender identity key changed mid-session! Potential impersonation.</span>
              </div>
            )}

            {/* Quoted Reply Preview */}
            {item.replyTo && (
              <div
                dir="auto"
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.replyTo.id) {
                    const targetEl = document.getElementById(`msg-${item.replyTo.id}`);
                    if (targetEl) {
                      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      targetEl.classList.add('ring-2', 'ring-emerald-400');
                      setTimeout(() => targetEl.classList.remove('ring-2', 'ring-emerald-400'), 1500);
                    }
                  }
                }}
                title="Click to jump to original message"
                className={`mb-2.5 w-full min-w-0 max-w-full box-border overflow-hidden ps-2.5 pe-3 py-1.5 border-s-[3px] rounded-e-xl rounded-s-xs text-xs cursor-pointer transition-all hover:opacity-95 select-none ${
                  isOwn
                    ? 'border-emerald-600 dark:border-emerald-400 bg-zinc-100/90 dark:bg-zinc-700/60 text-zinc-800 dark:text-zinc-200'
                    : 'border-emerald-400 bg-white/10 dark:bg-white/10 text-zinc-100 dark:text-zinc-100'
                }`}
              >
                <div className="font-semibold text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 min-w-0 w-full overflow-hidden">
                  <span className="text-[12px] opacity-80 shrink-0 select-none">↳</span>
                  <span className="truncate min-w-0 flex-1 block">
                    <bdi>@{item.replyTo.nickname || 'Unknown'}</bdi>
                  </span>
                </div>
                <div className="text-[11px] truncate mt-0.5 opacity-85 min-w-0 w-full font-normal overflow-hidden block">
                  <span className="truncate block w-full max-w-full">
                    <bdi>
                      {item.replyTo.text ||
                        (item.replyTo.file ? (
                          item.replyTo.file.isVoiceNote ? (
                            <span className="inline-flex items-center gap-1">
                              <Mic className="w-3 h-3 text-emerald-500 inline" />
                              <span>Voice note</span>
                            </span>
                          ) : item.replyTo.file.type && item.replyTo.file.type.startsWith('image/') ? (
                            <span className="inline-flex items-center gap-1">
                              <Camera className="w-3 h-3 text-emerald-500 inline" />
                              <span>Photo</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <Paperclip className="w-3 h-3 text-emerald-500 inline" />
                              <span>{item.replyTo.file.name || 'Attachment'}</span>
                            </span>
                          )
                        ) : (
                          'Quoted message'
                        ))}
                    </bdi>
                  </span>
                </div>
              </div>
            )}

            {/* Encrypted Voice Note Player or Attached File */}
            {item.file && (
              <div className="mb-2">
                {item.file.isVoiceNote || (item.file.type && item.file.type.startsWith('audio/')) ? (
                  <VoiceNotePlayer file={item.file} isOwn={isOwn} />
                ) : item.file.type && ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(item.file.type.toLowerCase()) ? (
                  <div className="space-y-1.5">
                    <div className="relative group/img rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-200/40 max-w-sm shadow-xs">
                      <img
                        src={`data:${item.file.type};base64,${item.file.data}`}
                        alt={item.file.name || 'Encrypted image'}
                        className="max-h-64 w-auto rounded-xl object-contain max-w-full"
                      />
                      <a
                        href={`data:${item.file.type};base64,${item.file.data}`}
                        download={item.file.name || 'image.png'}
                        title="Download image"
                        className="absolute bottom-2 right-2 p-1.5 px-2.5 rounded-xl bg-black/80 hover:bg-black text-white text-[11px] opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center gap-1.5 font-sans font-medium"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </a>
                    </div>
                    <div
                      className={`flex items-center justify-between text-[10px] font-sans px-1 ${
                        isOwn ? 'text-zinc-500' : 'text-zinc-400'
                      }`}
                    >
                      <span className="truncate max-w-[180px] inline-flex items-center gap-1">
                        <Lock className="w-3 h-3 text-zinc-400 shrink-0 inline" />
                        <HighlightText text={item.file.name} query={searchQuery} />
                      </span>
                      <span>{formatBytes(item.file.size)}</span>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`p-3 rounded-2xl border flex items-center justify-between gap-3 text-xs font-sans ${
                      isOwn
                        ? 'bg-zinc-50 dark:bg-zinc-800/80 border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-100'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-100'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-xl bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex flex-col">
                        <span className="font-semibold truncate max-w-[180px]">
                          <HighlightText text={item.file.name} query={searchQuery} />
                        </span>
                        <span className="text-[10px] opacity-70">
                          {formatBytes(item.file.size)}
                        </span>
                      </div>
                    </div>
                    <a
                      href={`data:application/octet-stream;base64,${item.file.data}`}
                      download={item.file.name || 'attachment'}
                      className="p-1.5 px-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs transition-colors shrink-0 flex items-center gap-1.5 font-medium"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Save</span>
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Message Text Content */}
            {item.text ? (
              <div className="font-sans leading-relaxed">
                <HighlightText text={item.text} query={searchQuery} />
              </div>
            ) : null}

            {/* Reaction Badges on Bubble */}
            {item.reactions && Object.keys(item.reactions).length > 0 && (
              <div
                className={`flex flex-wrap gap-1.5 mt-2 pt-1 border-t ${
                  isOwn
                    ? 'border-zinc-200/60 dark:border-zinc-700/60'
                    : 'border-white/10 dark:border-zinc-800'
                }`}
              >
                {Object.entries(item.reactions).map(([emojiChar, data]) => {
                  const count = typeof data === 'number' ? data : (data.count || (data.users ? data.users.length : 1));
                  const hasMyReaction = data.users && myUserId ? data.users.includes(myUserId) : false;
                  return (
                    <button
                      key={emojiChar}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onReact) {
                          onReact(item.id, emojiChar);
                        }
                      }}
                      title={`${data.names ? data.names.join(', ') : 'Reactions'} (Click to toggle)`}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-all cursor-pointer select-none active:scale-95 ${
                        hasMyReaction
                          ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 font-semibold shadow-xs'
                          : isOwn
                          ? 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-600'
                          : 'bg-white/10 hover:bg-white/20 text-zinc-200 border border-white/15'
                      }`}
                    >
                      <span className="text-sm">{emojiChar}</span>
                      <span className="text-[11px] font-mono">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Timestamp & Status below bubble matching screenshot */}
          <div
            className={`flex items-center gap-1 mt-1 px-1.5 text-[10px] font-sans text-zinc-400 tabular-nums ${
              isOwn ? 'justify-end' : 'justify-start'
            }`}
          >
            <span>{timeStr}</span>
            {isOwn && (
              <MessageStatusIndicator status={effectiveStatus} readCount={readCount} />
            )}
          </div>
        </div>

        {/* Action Buttons: React & Reply */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity mb-5">
          {/* Quick Reaction Button */}
          {onReact && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowQuickReactions((prev) => !prev)}
                title="React with emoji"
                aria-label="React with emoji"
                className="p-1.5 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-all cursor-pointer"
              >
                <Smile className="w-4 h-4" />
              </button>

              {/* Quick Reactions Bar Popup */}
              {showQuickReactions && (
                <div
                  className={`absolute z-30 bottom-full mb-1 flex items-center gap-1 p-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-full shadow-lg animate-bubble ${
                    isOwn ? 'right-0' : 'left-0'
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {['👍', '❤️', '😂', '🔥', '🎉', '🔒'].map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => {
                        onReact(item.id, em);
                        setShowQuickReactions(false);
                      }}
                      className="w-7 h-7 flex items-center justify-center hover:scale-125 transition-transform text-sm cursor-pointer rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      {em}
                    </button>
                  ))}
                  {onOpenFullEmojiPicker && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenFullEmojiPicker(item.id);
                        setShowQuickReactions(false);
                      }}
                      title="More emojis"
                      className="w-7 h-7 flex items-center justify-center text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Reply Action Button */}
          {onReply && (
            <button
              onClick={() => onReply(item)}
              title="Reply"
              aria-label="Reply"
              className="p-1.5 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-all cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Collapsed Decrypt Failure Banner
 */
export function DecryptFailureBanner({ count }) {
  if (count <= 0) return null;

  return (
    <div className="my-3 p-3 rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between font-sans shadow-xs animate-slide-left">
      <div className="flex items-center gap-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
        <span>
          Unable to decrypt {count === 1 ? '1 incoming message' : `${count} incoming messages`}. The room password may not match.
        </span>
      </div>
      <span className="bg-amber-200/80 dark:bg-amber-900/80 px-2 py-0.5 rounded-full text-[11px] font-bold text-amber-950 dark:text-amber-200 shrink-0">
        x{count}
      </span>
    </div>
  );
}
