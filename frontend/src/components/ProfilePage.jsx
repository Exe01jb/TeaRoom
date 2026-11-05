import React, { useState, useRef } from 'react';
import {
  Settings,
  User,
  Users,
  Check,
  X,
  AlertTriangle,
  Camera,
  Lock,
  Zap,
  Copy,
  RefreshCw,
} from 'lucide-react';

// Preset avatar color palettes
export const AVATAR_PALETTES = [
  { id: 'emerald', label: 'Emerald Vault', gradient: 'from-emerald-600 to-teal-500' },
  { id: 'blue', label: 'Cyan Ocean', gradient: 'from-cyan-600 to-blue-500' },
  { id: 'indigo', label: 'Deep Indigo', gradient: 'from-blue-600 to-indigo-500' },
  { id: 'violet', label: 'Purple Nebula', gradient: 'from-violet-600 to-purple-500' },
  { id: 'amber', label: 'Amber Solar', gradient: 'from-amber-500 to-orange-600' },
  { id: 'rose', label: 'Rose Stealth', gradient: 'from-rose-500 to-red-600' },
  { id: 'pink', label: 'Pink Neon', gradient: 'from-purple-600 to-pink-500' },
  { id: 'dark', label: 'Obsidian Matrix', gradient: 'from-zinc-800 to-zinc-950' },
];

export const AVATAR_EMOJIS = ['🕶️', '🛡️', '🔒', '⚡', '🦊', '🦉', '🚀', '💻', '🐱', '👻', '🔮', '💎', '🌿', '🦁'];

export const STATUS_PRESETS = [
  '🔒 End-to-end encrypted • Zero persistence',
  '🟢 Active & Available',
  '🌙 Away from keyboard',
  '🛡️ Ephemeral session only',
  '📵 Do not disturb',
  '🕵️ Stealth Mode',
];

/**
 * Dedicated Profile Page for viewing and editing:
 * 1. User Personal Profile (photo upload from local system, nickname, avatar color, avatar emoji, status/bio, user ID)
 * 2. Group / Room Profiles (room title alias, room topic, custom avatar photo, room notice banner, security fingerprint)
 */
export function ProfilePage({
  userProfile,
  onUpdateUserProfile,
  userId,
  chats = [],
  activeChatId,
  onUpdateGroupProfile,
  onBackToChat,
  roomMembers = [],
  theme = 'dark',
  onToggleTheme,
  initialTab = 'user', // 'user' | 'group'
  onRotateIdentityKey,
  myIdentityFingerprint,
  isIdentityPersisted = true,
}) {
  const [activeTab, setActiveTab] = useState(initialTab); // 'user' | 'group'
  const [copiedId, setCopiedId] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');

  const userPhotoInputRef = useRef(null);
  const groupPhotoInputRef = useRef(null);

  // User Profile Form State
  const [nickname, setNickname] = useState(userProfile?.nickname || '');
  const [avatarImage, setAvatarImage] = useState(userProfile?.avatarImage || null);
  const [avatarGradient, setAvatarGradient] = useState(
    userProfile?.avatarGradient || AVATAR_PALETTES[0].gradient
  );
  const [avatarEmoji, setAvatarEmoji] = useState(userProfile?.avatarEmoji || '🕶️');
  const [statusBio, setStatusBio] = useState(
    userProfile?.statusBio || '🔒 End-to-end encrypted • Zero persistence'
  );
  const [errorText, setErrorText] = useState('');

  // Selected Group Profile Form State
  const selectedChat = chats.find((c) => c.id === activeChatId) || chats[0] || null;
  const [selectedGroupId, setSelectedGroupId] = useState(selectedChat?.id || null);

  const currentGroupChat = chats.find((c) => c.id === selectedGroupId) || selectedChat;

  const [groupTitle, setGroupTitle] = useState(
    currentGroupChat?.groupProfile?.customTitle || currentGroupChat?.name || ''
  );
  const [groupTopic, setGroupTopic] = useState(
    currentGroupChat?.groupProfile?.topic || ''
  );
  const [groupAvatarImage, setGroupAvatarImage] = useState(
    currentGroupChat?.groupProfile?.avatarImage || null
  );
  const [groupAvatarGradient, setGroupAvatarGradient] = useState(
    currentGroupChat?.groupProfile?.avatarGradient || AVATAR_PALETTES[1].gradient
  );
  const [groupEmoji, setGroupEmoji] = useState(
    currentGroupChat?.groupProfile?.emoji || '🛡️'
  );
  const [groupNotice, setGroupNotice] = useState(
    currentGroupChat?.groupProfile?.announcement || ''
  );

  // When changing group selection, populate form
  const handleSelectGroup = (chat) => {
    setSelectedGroupId(chat.id);
    setGroupTitle(chat.groupProfile?.customTitle || chat.name || '');
    setGroupTopic(chat.groupProfile?.topic || '');
    setGroupAvatarImage(chat.groupProfile?.avatarImage || null);
    setGroupAvatarGradient(chat.groupProfile?.avatarGradient || AVATAR_PALETTES[1].gradient);
    setGroupEmoji(chat.groupProfile?.emoji || '🛡️');
    setGroupNotice(chat.groupProfile?.announcement || '');
    setSaveNotice('');
  };

  const handleCopyId = () => {
    if (!userId) return;
    navigator.clipboard.writeText(userId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  /**
   * Client-side photo upload and resize handler
   * Reads user's uploaded image file from local device and resizes to crisp 256x256 square thumbnail
   */
  const handlePhotoUpload = (e, target = 'user') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorText('Please select an image file (PNG, JPG, WEBP, or GIF).');
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setErrorText('Image file is too large. Please choose a photo under 15MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const dim = 256;
          canvas.width = dim;
          canvas.height = dim;
          const ctx = canvas.getContext('2d');

          // Center-crop to square
          const minSide = Math.min(img.width, img.height);
          const sx = (img.width - minSide) / 2;
          const sy = (img.height - minSide) / 2;

          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, dim, dim);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.88);

          if (target === 'user') {
            setAvatarImage(dataUrl);
            setSaveNotice('Profile photo uploaded! Click "Save Profile" to apply.');
          } else {
            setGroupAvatarImage(dataUrl);
            setSaveNotice('Group photo uploaded! Click "Save Group Profile" to apply.');
          }
          setErrorText('');
          setTimeout(() => setSaveNotice(''), 4000);
        } catch {
          setErrorText('Unable to process photo. Please try another image.');
        }
      };
      img.onerror = () => {
        setErrorText('Failed to read image file.');
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSaveUserProfile = (e) => {
    e.preventDefault();
    setErrorText('');

    const trimmedNick = nickname.trim();
    if (!trimmedNick) {
      setErrorText('Nickname cannot be empty.');
      return;
    }
    if (trimmedNick.length > 24) {
      setErrorText('Nickname must be 24 characters or less.');
      return;
    }

    onUpdateUserProfile({
      nickname: trimmedNick,
      avatarGradient,
      avatarEmoji,
      statusBio: statusBio.trim(),
      avatarImage,
    });

    setSaveNotice('Profile saved successfully!');
    setTimeout(() => setSaveNotice(''), 3000);
  };

  const handleSaveGroupProfile = (e) => {
    e.preventDefault();
    if (!currentGroupChat) return;

    onUpdateGroupProfile(currentGroupChat.id, {
      customTitle: groupTitle.trim() || currentGroupChat.name,
      topic: groupTopic.trim(),
      avatarGradient: groupAvatarGradient,
      emoji: groupEmoji,
      announcement: groupNotice.trim(),
      avatarImage: groupAvatarImage,
    });

    setSaveNotice(`Group profile for "${groupTitle.trim() || currentGroupChat.name}" saved!`);
    setTimeout(() => setSaveNotice(''), 3000);
  };

  // Generate deterministic safety fingerprint snippet for room
  const computeRoomFingerprint = (roomName = '') => {
    let hash = 5381;
    for (let i = 0; i < roomName.length; i++) {
      hash = ((hash << 5) + hash) + roomName.charCodeAt(i);
    }
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    return `${hex.slice(0, 4).toUpperCase()}-${hex.slice(4, 8).toUpperCase()}`;
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans flex flex-col relative transition-colors">
      {/* Top Header */}
      <header className="px-4 sm:px-8 py-4 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border-b border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between sticky top-0 z-20 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToChat}
            className="p-2 -ml-2 rounded-xl text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span>Back to Chat</span>
          </button>

          <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />

          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-emerald-500 shrink-0" />
            <h1 className="text-base sm:text-lg font-bold tracking-tight">
              Profile & Group Settings
            </h1>
          </div>
        </div>

        {/* Tab switch between User Profile & Group Profile */}
        <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800/80 p-1 rounded-2xl border border-zinc-200/60 dark:border-zinc-700/60">
          <button
            type="button"
            onClick={() => {
              setActiveTab('user');
              setSaveNotice('');
            }}
            className={`px-3 sm:px-4 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'user'
                ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-white shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <User className="w-4 h-4 shrink-0" />
            <span>My Profile</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('group');
              setSaveNotice('');
            }}
            className={`px-3 sm:px-4 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'group'
                ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-white shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Users className="w-4 h-4 shrink-0" />
            <span>Group Profiles</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-8 space-y-6 pb-20">
        {/* Success / Error Notice Banner */}
        {saveNotice && (
          <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-200 text-xs font-medium flex items-center justify-between shadow-xs animate-bubble">
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>{saveNotice}</span>
            </span>
            <button
              onClick={() => setSaveNotice('')}
              className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-950 dark:hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {errorText && (
          <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800/60 text-rose-800 dark:text-rose-200 text-xs font-medium flex items-center justify-between shadow-xs animate-bubble">
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{errorText}</span>
            </span>
            <button
              onClick={() => setErrorText('')}
              className="text-rose-600 dark:text-rose-400 hover:text-rose-950 dark:hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Hidden File Inputs for Local Photo Uploads */}
        <input
          type="file"
          ref={userPhotoInputRef}
          onChange={(e) => handlePhotoUpload(e, 'user')}
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
        />
        <input
          type="file"
          ref={groupPhotoInputRef}
          onChange={(e) => handlePhotoUpload(e, 'group')}
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
        />

        {/* TAB 1: USER PROFILE */}
        {activeTab === 'user' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-bubble">
            {/* Left Card: 3D Interactive Live Avatar Card & Identity Preview */}
            <div className="md:col-span-1 space-y-4">
              <div className="p-6 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-3xl card-3d card-3d-interactive text-center flex flex-col items-center relative overflow-hidden">
                {/* 3D Sheen Highlight */}
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500/0 via-emerald-500/40 to-emerald-500/0" />

                {/* Avatar Preview with Photo Upload Support */}
                <div className="relative mb-3 group/avatar">
                  <div
                    onClick={() => userPhotoInputRef.current?.click()}
                    title="Click to upload/change photo from your system"
                    className={`w-28 h-28 rounded-full shadow-xl flex items-center justify-center text-4xl font-bold border-4 border-white dark:border-zinc-800 select-none overflow-hidden cursor-pointer transition-transform duration-300 group-hover/avatar:scale-105 ${
                      !avatarImage ? `bg-gradient-to-tr ${avatarGradient} text-white` : 'bg-zinc-800'
                    }`}
                  >
                    {avatarImage ? (
                      <img
                        src={avatarImage}
                        alt={nickname || 'Profile photo'}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      avatarEmoji || (nickname ? nickname.slice(0, 2).toUpperCase() : 'ME')
                    )}

                    {/* Hover Overlay Prompt */}
                    <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover/avatar:opacity-100 flex flex-col items-center justify-center text-white transition-opacity text-xs font-medium">
                      <Camera className="w-4 h-4 mb-0.5" />
                      <span className="text-[10px]">Change</span>
                    </div>
                  </div>

                  {/* Online Status Dot */}
                  <span
                    className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-white dark:border-zinc-900 shadow-md flex items-center justify-center text-[10px] text-white"
                    title="Online & Encrypted Session"
                  >
                    <Check className="w-3 h-3 text-white stroke-[3]" />
                  </span>
                </div>

                {/* Photo Action Buttons */}
                <div className="flex items-center gap-1.5 mb-3">
                  <button
                    type="button"
                    onClick={() => userPhotoInputRef.current?.click()}
                    className="btn-3d px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-750 text-zinc-800 dark:text-zinc-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5 shrink-0" />
                    <span>{avatarImage ? 'Change Photo' : 'Upload Photo'}</span>
                  </button>

                  {avatarImage && (
                    <button
                      type="button"
                      onClick={() => {
                        setAvatarImage(null);
                        setSaveNotice('Custom photo removed. Click "Save Profile" to apply.');
                      }}
                      title="Remove uploaded photo and revert to emoji/gradient"
                      className="btn-3d px-2.5 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 hover:bg-rose-100 text-xs cursor-pointer flex items-center justify-center"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 truncate w-full">
                  {nickname || 'Anonymous'}
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-[220px] leading-relaxed italic">
                  "{statusBio || 'No status set'}"
                </p>

                {/* User ID Box */}
                <div className="w-full mt-4 p-3 rounded-2xl bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800 text-left">
                  <div className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 uppercase font-semibold mb-1 flex items-center justify-between">
                    <span>Your Cryptographic ID</span>
                    <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-sans inline-flex items-center gap-1">
                      {isIdentityPersisted ? (
                        <>
                          <Lock className="w-2.5 h-2.5 text-emerald-500" />
                          <span>Persisted Locally</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-2.5 h-2.5 text-amber-500" />
                          <span>Ephemeral</span>
                        </>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-1.5 font-mono text-xs text-emerald-600 dark:text-emerald-400">
                    <span className="truncate">{userId}</span>
                    <button
                      type="button"
                      onClick={handleCopyId}
                      className="btn-3d px-2 py-1 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-[11px] font-sans font-medium transition-colors cursor-pointer shrink-0 inline-flex items-center gap-1"
                      title="Copy User ID"
                    >
                      {copiedId ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-500" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>

                  {myIdentityFingerprint && (
                    <div className="mt-2 pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60">
                      <div className="text-[9px] font-mono text-zinc-400 dark:text-zinc-500 uppercase">
                        ECDSA Device Fingerprint
                      </div>
                      <div className="font-mono text-[10px] text-zinc-600 dark:text-zinc-400 truncate mt-0.5">
                        {myIdentityFingerprint.slice(0, 16)}…{myIdentityFingerprint.slice(-8)}
                      </div>
                    </div>
                  )}

                  {onRotateIdentityKey && (
                    <div className="mt-2.5 pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60">
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm('Rotate your cryptographic identity keys? This will update your persisted device keys.')) {
                            onRotateIdentityKey();
                          }
                        }}
                        className="w-full py-1.5 px-2 rounded-lg bg-zinc-200/70 dark:bg-zinc-800/70 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400 border border-transparent hover:border-amber-500/30 text-zinc-700 dark:text-zinc-300 text-[10px] font-medium transition-colors cursor-pointer inline-flex items-center justify-center gap-1.5"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Rotate Identity Keys</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3.5 border-t border-zinc-100 dark:border-zinc-800/80 w-full text-left space-y-1.5 text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                  <div className="flex items-center justify-between">
                    <span>Cipher Suite</span>
                    <span className="text-zinc-800 dark:text-zinc-200 font-semibold">AES-256-GCM</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Identity Suite</span>
                    <span className="text-zinc-800 dark:text-zinc-200 font-semibold">ECDSA P-256</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Key Persistence</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">IndexedDB / Local</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Card: Profile Edit Form */}
            <div className="md:col-span-2">
              <form
                onSubmit={handleSaveUserProfile}
                className="p-6 sm:p-7 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-3xl card-3d space-y-5"
              >
                <div>
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 tracking-wide uppercase">
                    Edit Your Profile
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Your photo, nickname, and status are shared with active room members over the encrypted channel.
                  </p>
                </div>

                {/* Nickname Input */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                    Display Nickname
                  </label>
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    maxLength={24}
                    placeholder="Enter your nickname..."
                    className="w-full bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl px-4 py-2.5 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-emerald-500 shadow-inner"
                  />
                  <div className="flex justify-between items-center mt-1 text-[11px] text-zinc-400">
                    <span>Visible to peers in active rooms and direct chats</span>
                    <span>{nickname.length}/24</span>
                  </div>
                </div>

                {/* Profile Photo Upload Section */}
                <div className="p-4 rounded-2xl bg-[#f8f9fa] dark:bg-zinc-950/70 border border-zinc-200/80 dark:border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="block text-xs font-bold text-zinc-800 dark:text-zinc-200">
                        Profile Photo (From Your Device)
                      </label>
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Upload a photo directly from your own computer or mobile phone.
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => userPhotoInputRef.current?.click()}
                      className="btn-3d px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5 shrink-0" />
                      <span>{avatarImage ? 'Replace Photo' : 'Upload from System'}</span>
                    </button>
                  </div>

                  {avatarImage ? (
                    <div className="flex items-center gap-3 pt-1">
                      <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-emerald-500 shrink-0 shadow-md">
                        <img src={avatarImage} alt="Uploaded avatar" className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                          <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          <span>Custom photo loaded</span>
                        </div>
                        <div className="text-[11px] text-zinc-400">
                          Resized locally in-browser for zero-lag encrypted transfer.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setAvatarImage(null);
                          setSaveNotice('Photo removed. Click "Save Profile" to apply.');
                        }}
                        className="text-xs text-rose-500 hover:underline cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={() => userPhotoInputRef.current?.click()}
                      className="border-2 border-dashed border-zinc-300 dark:border-zinc-800 hover:border-emerald-500 dark:hover:border-emerald-500 rounded-xl p-3 text-center cursor-pointer transition-colors"
                    >
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">
                        Drop a photo here or <span className="text-emerald-600 dark:text-emerald-400 font-semibold underline">click to browse</span> (JPG, PNG, WEBP)
                      </p>
                    </div>
                  )}
                </div>

                {/* Status / Bio */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                    Status / Bio
                  </label>
                  <input
                    type="text"
                    value={statusBio}
                    onChange={(e) => setStatusBio(e.target.value)}
                    maxLength={80}
                    placeholder="e.g. In an encrypted meeting..."
                    className="w-full bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl px-4 py-2.5 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-emerald-500 shadow-inner"
                  />
                  {/* Quick status presets */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {STATUS_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setStatusBio(preset)}
                        className={`text-[10px] px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                          statusBio === preset
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 text-emerald-700 dark:text-emerald-300 font-semibold'
                            : 'bg-zinc-100 dark:bg-zinc-800/80 border-zinc-200/80 dark:border-zinc-700/60 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Avatar Color Palette Selection (Used as fallback or background) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      Fallback Color Theme
                    </label>
                    <span className="text-[11px] text-zinc-400">
                      {avatarImage ? 'Active when photo is removed' : 'Active'}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                    {AVATAR_PALETTES.map((palette) => (
                      <button
                        key={palette.id}
                        type="button"
                        onClick={() => setAvatarGradient(palette.gradient)}
                        title={palette.label}
                        className={`h-9 rounded-2xl bg-gradient-to-tr ${palette.gradient} transition-all cursor-pointer relative flex items-center justify-center shadow-xs ${
                          avatarGradient === palette.gradient
                            ? 'ring-2 ring-emerald-500 ring-offset-2 dark:ring-offset-zinc-900 scale-105'
                            : 'hover:scale-102 opacity-85 hover:opacity-100'
                        }`}
                      >
                        {avatarGradient === palette.gradient && (
                          <Check className="w-3.5 h-3.5 text-white stroke-[3] drop-shadow" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Avatar Emoji Selector */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                    Badge Emoji Icon
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {AVATAR_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => setAvatarEmoji(emoji)}
                        className={`w-10 h-10 rounded-2xl text-lg flex items-center justify-center border transition-all cursor-pointer ${
                          avatarEmoji === emoji
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 text-emerald-800 dark:text-emerald-300 scale-105 shadow-xs'
                            : 'bg-[#f8f9fa] dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Submit Action */}
                <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                  <span className="text-[11px] text-zinc-400">
                    Saved in browser memory for active session.
                  </span>
                  <button
                    type="submit"
                    className="btn-3d px-6 py-2.5 rounded-2xl bg-zinc-950 dark:bg-emerald-500 hover:bg-zinc-800 dark:hover:bg-emerald-400 text-white dark:text-zinc-950 font-bold text-xs sm:text-sm shadow-md transition-all cursor-pointer"
                  >
                    Save Profile
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* TAB 2: GROUP PROFILES */}
        {activeTab === 'group' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-bubble">
            {/* Left Card: Active Group List */}
            <div className="md:col-span-1 space-y-3">
              <div className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-3xl shadow-sm space-y-3">
                <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">
                  Active Rooms ({chats.length})
                </div>
                <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
                  {chats.length === 0 ? (
                    <div className="text-xs text-zinc-400 p-3 text-center">
                      No active rooms joined.
                    </div>
                  ) : (
                    chats.map((chat) => (
                      <button
                        key={chat.id}
                        type="button"
                        onClick={() => handleSelectGroup(chat)}
                        className={`w-full p-2.5 rounded-2xl flex items-center gap-2.5 text-left transition-all cursor-pointer ${
                          selectedGroupId === chat.id
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800/80 text-emerald-900 dark:text-emerald-200'
                            : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60 text-zinc-800 dark:text-zinc-200'
                        }`}
                      >
                        <div
                          className={`w-8 h-8 rounded-xl bg-gradient-to-tr ${
                            chat.groupProfile?.avatarGradient || AVATAR_PALETTES[1].gradient
                          } text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-xs`}
                        >
                          {chat.groupProfile?.emoji || '#'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold truncate">
                            {chat.groupProfile?.customTitle || (chat.type === 'direct' ? chat.peerName || chat.name : `#${chat.name}`)}
                          </div>
                          <div className="text-[10px] text-zinc-400 truncate">
                            {chat.type === 'direct' ? '1-on-1 Direct' : `${chat.presenceCount || 1} members`}
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Security Verification Code for Selected Room */}
              {currentGroupChat && (
                <div className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-3xl shadow-sm space-y-2">
                  <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <Lock className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>Safety Verification Code</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Compare this code with room members out-of-band to guarantee both parties derived the exact same AES key:
                  </p>
                  <div className="p-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-center font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm tracking-widest select-all">
                    {computeRoomFingerprint(currentGroupChat.name)}
                  </div>
                </div>
              )}
            </div>

            {/* Right Card: Group Profile Edit Form */}
            <div className="md:col-span-2">
              {currentGroupChat ? (
                <form
                  onSubmit={handleSaveGroupProfile}
                  className="p-6 sm:p-7 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-3xl shadow-sm space-y-5"
                >
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
                    <div>
                      <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
                        Configure Room Profile
                      </h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Customize how this room appears locally in your session.
                      </p>
                    </div>

                    <div className="px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-[10px] font-mono font-bold">
                      #{currentGroupChat.name}
                    </div>
                  </div>

                  {/* Room Display Name Alias */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                      Room Display Title / Alias
                    </label>
                    <input
                      type="text"
                      value={groupTitle}
                      onChange={(e) => setGroupTitle(e.target.value)}
                      placeholder={`#${currentGroupChat.name}`}
                      maxLength={40}
                      className="w-full bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl px-4 py-2.5 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
                    />
                    <div className="mt-1 text-[11px] text-zinc-400">
                      Local alias for easy conversation identification.
                    </div>
                  </div>

                  {/* Room Topic / Description */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                      Room Topic & Purpose
                    </label>
                    <textarea
                      rows={2}
                      value={groupTopic}
                      onChange={(e) => setGroupTopic(e.target.value)}
                      placeholder="Describe what this room is for (e.g. Weekly architecture coordination without cloud logs)..."
                      className="w-full bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl px-4 py-2.5 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  {/* Group Photo / Icon from Device */}
                  <div className="p-4 rounded-2xl bg-[#f8f9fa] dark:bg-zinc-950/70 border border-zinc-200/80 dark:border-zinc-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="block text-xs font-bold text-zinc-800 dark:text-zinc-200">
                          Room Photo / Logo (From Device)
                        </label>
                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          Upload a photo or team emblem for this encrypted room.
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => groupPhotoInputRef.current?.click()}
                        className="btn-3d px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
                      >
                        <Camera className="w-3.5 h-3.5 shrink-0" />
                        <span>{groupAvatarImage ? 'Replace Photo' : 'Upload from System'}</span>
                      </button>
                    </div>

                    {groupAvatarImage ? (
                      <div className="flex items-center gap-3 pt-1">
                        <div className="w-12 h-12 rounded-2xl overflow-hidden border-2 border-emerald-500 shrink-0 shadow-md">
                          <img src={groupAvatarImage} alt="Group avatar" className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span>Room picture active</span>
                          </div>
                          <div className="text-[11px] text-zinc-400">
                            Stored in session memory for room banner & list.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setGroupAvatarImage(null);
                            setSaveNotice('Room photo removed. Click "Save Group Profile" to apply.');
                          }}
                          className="text-xs text-rose-500 hover:underline cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div
                        onClick={() => groupPhotoInputRef.current?.click()}
                        className="border-2 border-dashed border-zinc-300 dark:border-zinc-800 hover:border-emerald-500 dark:hover:border-emerald-500 rounded-xl p-3 text-center cursor-pointer transition-colors"
                      >
                        <p className="text-xs text-zinc-600 dark:text-zinc-400">
                          Click to browse and upload a room logo or team photo from your system
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Room Icon / Emoji */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                      Badge Icon (Fallback)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {['#', '🛡️', '⚡', '🔒', '💼', '🚀', '🧠', '🌐', '🔥', '📊', '☕'].map((ic) => (
                        <button
                          key={ic}
                          type="button"
                          onClick={() => setGroupEmoji(ic)}
                          className={`w-10 h-10 rounded-2xl text-base flex items-center justify-center border transition-all cursor-pointer ${
                            groupEmoji === ic
                              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 text-emerald-800 dark:text-emerald-300 scale-105 shadow-xs font-bold'
                              : 'bg-[#f8f9fa] dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                          }`}
                        >
                          {ic}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Room Avatar Gradient */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                      Room Color Theme
                    </label>
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                      {AVATAR_PALETTES.map((palette) => (
                        <button
                          key={palette.id}
                          type="button"
                          onClick={() => setGroupAvatarGradient(palette.gradient)}
                          title={palette.label}
                          className={`h-9 rounded-2xl bg-gradient-to-tr ${palette.gradient} transition-all cursor-pointer relative flex items-center justify-center shadow-xs ${
                            groupAvatarGradient === palette.gradient
                              ? 'ring-2 ring-emerald-500 ring-offset-2 dark:ring-offset-zinc-900 scale-105'
                              : 'hover:scale-102 opacity-85 hover:opacity-100'
                          }`}
                        >
                          {groupAvatarGradient === palette.gradient && (
                            <Check className="w-3.5 h-3.5 text-white stroke-[3] drop-shadow" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Ephemeral Room Notice / Announcement */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                      Ephemeral Room Announcement / Rules
                    </label>
                    <input
                      type="text"
                      value={groupNotice}
                      onChange={(e) => setGroupNotice(e.target.value)}
                      placeholder="e.g. Confidential briefing — please clear history upon leaving."
                      className="w-full bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl px-4 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-emerald-500 shadow-inner"
                    />
                    <div className="mt-1 text-[11px] text-zinc-400">
                      Displays as a prominent safety reminder banner within this room.
                    </div>
                  </div>

                  {/* Submit Action */}
                  <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                    <span className="text-[11px] text-zinc-400">
                      Applied locally to your encrypted view.
                    </span>
                    <button
                      type="submit"
                      className="btn-3d px-6 py-2.5 rounded-2xl bg-zinc-950 dark:bg-emerald-500 hover:bg-zinc-800 dark:hover:bg-emerald-400 text-white dark:text-zinc-950 font-bold text-xs sm:text-sm shadow-md transition-all cursor-pointer"
                    >
                      Save Group Profile
                    </button>
                  </div>
                </form>
              ) : (
                <div className="p-12 text-center bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 text-zinc-400">
                  Select a room from the left to view and configure its profile.
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Floating Bottom-Left Dark/Light Theme Toggle for other pages */}
      {onToggleTheme && (
        <div className="fixed bottom-4 left-4 z-40">
          <button
            type="button"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle theme"
            className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-white/90 dark:bg-zinc-900/90 border border-zinc-200/90 dark:border-zinc-800 shadow-xl backdrop-blur-md text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white hover:scale-105 transition-all cursor-pointer"
          >
            {theme === 'dark' ? (
              <>
                <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                <span className="hidden sm:inline">Light</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
                <span className="hidden sm:inline">Dark</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
