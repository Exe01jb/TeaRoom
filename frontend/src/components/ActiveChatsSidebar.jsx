import React, { useState, useMemo } from 'react';
import { Settings, ShieldCheck, X, Lock, CheckCheck, MessageSquare, BookOpen } from 'lucide-react';

// Generates consistent pleasing avatar gradients based on room/peer name
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

function isSafeAvatarUrl(url) {
  return typeof url === 'string' && (url.startsWith('data:image/') || url.startsWith('blob:'));
}

/**
 * Messages & Conversations Sidebar matching Column 2 of the inspiration UI
 * Supports responsive full-width mobile view and desktop sidebar,
 * dark and light mode themes, and instant tab filtering.
 */
export function ActiveChatsSidebar({
  userId,
  nickname,
  userProfile,
  activeChatId,
  chats,
  onSelectChat,
  onOpenNewRoomModal,
  onOpenDirectChatModal,
  onLeaveChat,
  onOpenAdmin,
  onOpenProfile,
  roomMembers = [],
  onStartDirectWithMember,
  isOpen,
  onCloseMobile,
  typingUsersByRoom = {},
  theme = 'dark',
  onToggleTheme,
  onOpenIntro,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('chats'); // 'chats' | 'members'
  const [copied, setCopied] = useState(false);

  const copyUserId = () => {
    if (!userId) return;
    navigator.clipboard.writeText(userId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Filter conversations based on search query
  const filteredChats = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.peerName && c.peerName.toLowerCase().includes(q)) ||
        (c.lastMessage && c.lastMessage.toLowerCase().includes(q))
    );
  }, [chats, searchQuery]);

  // Filter members based on search query
  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return roomMembers;
    return roomMembers.filter(
      (m) =>
        m.nickname.toLowerCase().includes(q) ||
        (m.userId && m.userId.toLowerCase().includes(q))
    );
  }, [roomMembers, searchQuery]);

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-30 md:hidden animate-fade-in"
        />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-full sm:w-80 md:w-80 lg:w-[340px] bg-[#f8f9fa] dark:bg-zinc-950 border-r border-zinc-200/80 dark:border-zinc-800 flex flex-col transition-all duration-300 ease-out shrink-0 select-none ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Top: Mobile Navigation Strip & Search */}
        <div className="p-3 sm:p-4 pb-2 space-y-2">
          {/* Mobile Header Toolbar (visible on mobile only) */}
          <div className="flex md:hidden items-center justify-between pb-2 border-b border-zinc-200/80 dark:border-zinc-800/80">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onCloseMobile?.();
                  onOpenProfile?.();
                }}
                title="Open Profile Settings"
                className="w-9 h-9 rounded-xl overflow-hidden bg-gradient-to-tr from-zinc-800 to-zinc-700 text-white flex items-center justify-center font-bold text-xs hover:scale-105 transition-transform cursor-pointer border border-zinc-700 shadow-xs"
              >
                {userProfile?.avatarImage && isSafeAvatarUrl(userProfile.avatarImage) ? (
                  <img src={userProfile.avatarImage} alt={nickname || 'Profile'} className="w-full h-full object-cover" />
                ) : (
                  userProfile?.avatarEmoji || (nickname ? nickname.slice(0, 2).toUpperCase() : 'ME')
                )}
              </button>
              <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">Private Chat</span>
            </div>

            <div className="flex items-center gap-1.5">
              {onOpenProfile && (
                <button
                  type="button"
                  onClick={() => {
                    onCloseMobile?.();
                    onOpenProfile();
                  }}
                  title="Profile & Group Settings"
                  aria-label="Profile settings"
                  className="p-2 rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <Settings className="w-4 h-4" />
                </button>
              )}
              {onOpenAdmin && (
                <button
                  type="button"
                  onClick={onOpenAdmin}
                  aria-label="Admin console"
                  className="p-2 rounded-xl text-amber-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4 text-amber-500" />
                </button>
              )}
              {onCloseMobile && (
                <button
                  type="button"
                  onClick={onCloseMobile}
                  aria-label="Close sidebar"
                  className="p-2 rounded-xl text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Search bar matching screenshot */}
          <div className="relative flex items-center">
            <span className="absolute left-3.5 text-zinc-400 dark:text-zinc-500 text-sm">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations…"
              className="w-full pl-10 pr-8 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 shadow-xs transition-all font-sans"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xs cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Section Header: "Messages" Title & Action Buttons */}
        <div className="px-4 sm:px-5 pt-2 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 font-sans">
              Messages
            </h2>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-zinc-200/80 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-semibold">
              {chats.length}
            </span>
          </div>

          {/* Quick Tab Toggle: Chats / Members */}
          <div className="flex items-center p-0.5 bg-zinc-200/60 dark:bg-zinc-900 rounded-xl text-[11px] font-medium font-sans">
            <button
              type="button"
              onClick={() => setActiveTab('chats')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                activeTab === 'chats'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs font-semibold'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              Chats
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('members')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                activeTab === 'members'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs font-semibold'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              Online ({roomMembers.length})
            </button>
          </div>
        </div>

        {/* Action Pills: Join Room & New Direct Chat */}
        <div className="px-4 py-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenNewRoomModal}
            className="btn-3d flex-1 py-1.5 px-3 rounded-xl bg-white dark:bg-zinc-900 hover:bg-zinc-100/80 dark:hover:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-800 text-[11px] font-sans font-medium text-zinc-700 dark:text-zinc-200 flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700"
          >
            <span className="text-emerald-500 font-bold">+</span>
            <span>Join Room</span>
          </button>
          <button
            type="button"
            onClick={onOpenDirectChatModal}
            className="btn-3d flex-1 py-1.5 px-3 rounded-xl bg-white dark:bg-zinc-900 hover:bg-zinc-100/80 dark:hover:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-800 text-[11px] font-sans font-medium text-zinc-700 dark:text-zinc-200 flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700"
          >
            <Lock className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
            <span>Direct Chat</span>
          </button>
        </div>

        {/* Tab 1: Active Conversations List */}
        {activeTab === 'chats' && (
          <div className="flex-1 overflow-y-auto px-3 py-1 space-y-1 scrollbar-thin">
            {filteredChats.length > 0 ? (
              filteredChats.map((c) => {
                const isActive = c.id === activeChatId;
                const isDirect = c.type === 'direct';
                const displayName = isDirect ? c.peerName || c.peerId : c.name;
                const typingUsers = typingUsersByRoom[c.id] || [];
                const isTyping = typingUsers.length > 0;
                const unreadCount = c.unreadCount || 0;

                // Format friendly time
                const lastMsgObj = c.messages?.[c.messages.length - 1];
                const timeString = lastMsgObj?.timestamp
                  ? new Date(lastMsgObj.timestamp).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })
                  : '';

                return (
                  <div
                    key={c.id}
                    onClick={() => onSelectChat(c.id)}
                    className={`group relative p-3 rounded-2xl flex items-center justify-between transition-all duration-200 cursor-pointer ${
                      isActive
                        ? 'bg-white dark:bg-zinc-900 shadow-[0_4px_16px_rgba(0,0,0,0.06)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.5)] border border-zinc-200/80 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 translate-x-0.5 ring-1 ring-zinc-200 dark:ring-zinc-800'
                        : 'hover:bg-white/60 dark:hover:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {/* Avatar with Online Dot */}
                      <div className="relative shrink-0">
                        <div
                          className={`w-11 h-11 rounded-full overflow-hidden shadow-xs border border-black/10 dark:border-white/10 flex items-center justify-center ${
                            c.groupProfile?.avatarImage && isSafeAvatarUrl(c.groupProfile.avatarImage)
                              ? 'bg-zinc-800'
                              : `bg-gradient-to-tr ${c.groupProfile?.avatarGradient || getAvatarGradient(displayName)} text-white font-semibold text-xs`
                          }`}
                        >
                          {c.groupProfile?.avatarImage && isSafeAvatarUrl(c.groupProfile.avatarImage) ? (
                            <img src={c.groupProfile.avatarImage} alt={displayName} className="w-full h-full object-cover" />
                          ) : (
                            c.groupProfile?.emoji || (isDirect ? displayName.slice(0, 2).toUpperCase() : '#')
                          )}
                        </div>
                        {/* Green online badge dot matching screenshot */}
                        <span
                          className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-900 shadow-xs ${
                            c.presenceCount > 0 ? 'bg-emerald-500' : 'bg-zinc-400'
                          }`}
                        />
                      </div>

                      {/* Name & Snippet */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 truncate font-sans">
                              {displayName}
                            </span>
                            {isDirect && (
                              <span className="text-[10px] text-cyan-600 dark:text-cyan-400 shrink-0 inline-flex items-center" title="Direct Encrypted Chat">
                                <Lock className="w-3 h-3" />
                              </span>
                            )}
                          </div>
                          {timeString && (
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-sans tabular-nums shrink-0">
                              {timeString}
                            </span>
                          )}
                        </div>

                        {/* Last Message Snippet or Typing Animation */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate font-sans">
                            {isTyping ? (
                              <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                                <span className="flex gap-0.5">
                                  <span className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce" />
                                  <span className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce [animation-delay:0.15s]" />
                                  <span className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce [animation-delay:0.3s]" />
                                </span>
                                <span>is typing…</span>
                              </span>
                            ) : (
                              c.lastMessage || 'Encrypted session active'
                            )}
                          </div>

                          {/* Unread badge or checkmark */}
                          {unreadCount > 0 ? (
                            <span className="w-4 h-4 rounded-full bg-amber-500 text-white font-bold text-[9px] flex items-center justify-center shrink-0">
                              {unreadCount}
                            </span>
                          ) : (
                            <span className="text-emerald-600 dark:text-emerald-400 select-none shrink-0">
                              <CheckCheck className="w-3.5 h-3.5" />
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Quick Leave Button (shown on hover) */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onLeaveChat(c.id);
                      }}
                      title="Leave this conversation"
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-400 hover:text-rose-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all ml-1 shrink-0 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="py-12 text-center text-zinc-400 dark:text-zinc-500 text-xs font-sans">
                <MessageSquare className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto mb-2" />
                <div>No conversations found</div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Online Members in Current Room */}
        {activeTab === 'members' && (
          <div className="flex-1 overflow-y-auto px-3 py-1 space-y-1 scrollbar-thin">
            <div className="px-2 py-1 text-[11px] font-sans text-zinc-400 dark:text-zinc-500 flex items-center justify-between">
              <span>Verified Peers</span>
              <span>{filteredMembers.length} active</span>
            </div>

            {filteredMembers.map((m) => {
              const isMe = m.userId === userId;
              return (
                <div
                  key={m.userId}
                  className="p-2.5 rounded-2xl bg-white/70 dark:bg-zinc-900/80 hover:bg-white dark:hover:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800 flex items-center justify-between transition-all"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-full bg-gradient-to-tr ${getAvatarGradient(
                        m.nickname
                      )} text-white font-bold text-xs flex items-center justify-center shrink-0`}
                    >
                      {m.nickname ? m.nickname.slice(0, 2).toUpperCase() : 'U'}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate font-sans">
                        {m.nickname} {isMe && '(You)'}
                      </div>
                      <div className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 truncate">
                        {m.userId}
                      </div>
                    </div>
                  </div>

                  {!isMe && (
                    <button
                      type="button"
                      onClick={() => onStartDirectWithMember(m)}
                      title="Start direct encrypted chat"
                      className="px-2.5 py-1 rounded-xl bg-cyan-50 dark:bg-cyan-950/60 hover:bg-cyan-100 dark:hover:bg-cyan-900 text-cyan-700 dark:text-cyan-300 text-[10px] font-sans font-medium transition-colors cursor-pointer"
                    >
                      Direct Chat
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom Utility Bar: Settings & Specs Guide */}
        <div className="p-3 border-t border-zinc-200/80 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/90 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {onOpenProfile && (
              <button
                type="button"
                onClick={onOpenProfile}
                title="Profile & Settings"
                className="p-1.5 rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer text-xs flex items-center gap-1.5"
              >
                <Settings className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium hidden xs:inline">Settings</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onOpenIntro && (
              <button
                type="button"
                onClick={onOpenIntro}
                title="Platform Architecture & Security Guide"
                className="p-1.5 rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer text-xs flex items-center justify-center"
              >
                <BookOpen className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
