import React, { useState } from 'react';
import { Lock, X, Lightbulb, KeyRound, Copy, Check, Dices } from 'lucide-react';

/**
 * Modal to start a direct 1-on-1 encrypted chat with a specific User ID
 */
/**
 * Generate a friendly, secure, 16-character passphrase for direct chat encryption
 */
function generateSecurePasskey() {
  const adjectives = ['cyber', 'quantum', 'shield', 'amber', 'emerald', 'silent', 'cosmic', 'phoenix', 'shadow', 'stellar'];
  const nouns = ['vault', 'falcon', 'aurora', 'matrix', 'beacon', 'citadel', 'nebula', 'vector', 'haven', 'prism'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${adj}-${noun}-${num}`;
}

/**
 * Modal to start a direct 1-on-1 encrypted chat with a specific User ID
 */
export function DirectChatModal({
  myUserId,
  targetMember,
  onlineMembers = [],
  onClose,
  onStartDirect,
  onStartDirectChat = onStartDirect,
}) {
  const [peerId, setPeerId] = useState(targetMember?.userId || '');
  const [peerNickname, setPeerNickname] = useState(targetMember?.nickname || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(true);
  const [error, setError] = useState('');

  // Sync state if targetMember prop changes
  React.useEffect(() => {
    if (targetMember) {
      setPeerId(targetMember.userId || '');
      setPeerNickname(targetMember.nickname || '');
    }
  }, [targetMember]);

  const availableMembers = onlineMembers.filter((m) => m.userId && m.userId !== myUserId);

  const isValid = peerId.trim().length >= 3 && password.length >= 12;

  const handleSelectMember = (m) => {
    setPeerId(m.userId);
    setPeerNickname(m.nickname || m.userId);
  };

  const handleGeneratePasskey = () => {
    const generated = generateSecurePasskey();
    setPassword(generated);
    setShowPassword(true);
  };

  const handleCopyPasskey = () => {
    if (!password) return;
    navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (peerId.trim() === myUserId) {
      setError('You cannot start a direct 1-on-1 chat with yourself.');
      return;
    }

    if (password.length < 12) {
      setError('Passkey must be at least 12 characters.');
      return;
    }

    const startFn = onStartDirectChat || onStartDirect;
    if (typeof startFn === 'function') {
      startFn({
        peerId: peerId.trim(),
        peerName: peerNickname || targetMember?.nickname || peerId.trim(),
        password,
        isAcceptingInvite: Boolean(targetMember?.isAcceptingInvite),
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 font-sans max-h-[90vh] overflow-y-auto text-zinc-900 dark:text-zinc-100 transition-colors animate-bubble">
        <div className="flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-cyan-500" />
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">
              {targetMember?.isAcceptingInvite ? 'Join 1-on-1 Private Chat' : 'Start 1-on-1 Private Chat'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-white p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Secret Passkey Guidance Card */}
        <div className="p-3.5 rounded-xl bg-cyan-50/80 dark:bg-cyan-950/40 border border-cyan-200 dark:border-cyan-800/40 text-cyan-900 dark:text-cyan-200 text-xs space-y-1.5 leading-relaxed">
          <div className="flex items-center justify-between font-bold text-cyan-800 dark:text-cyan-300">
            <span className="flex items-center gap-1.5">
              <Lightbulb className="w-4 h-4 text-cyan-500 shrink-0" />
              <span>How does Secret Passkey work?</span>
            </span>
            <button
              type="button"
              onClick={() => setShowHelp(!showHelp)}
              className="text-[10px] text-cyan-600 dark:text-cyan-400 hover:underline cursor-pointer"
            >
              {showHelp ? 'Hide' : 'Explain'}
            </button>
          </div>
          {showHelp && (
            <div className="text-[11px] text-zinc-700 dark:text-zinc-300 space-y-1.5 pt-1.5 border-t border-cyan-200/80 dark:border-cyan-900/40 font-sans">
              <p>
                Private Chatroom stores <strong className="text-cyan-700 dark:text-cyan-300 font-mono">zero passwords and zero accounts</strong> on the server. To establish end-to-end encryption with AES-256-GCM, <strong>both you and your peer must type the exact same passkey</strong> (minimum 12 characters).
              </p>
              <div className="bg-white/80 dark:bg-zinc-950/60 border border-cyan-200/60 dark:border-transparent p-2.5 rounded-lg text-[11px] font-sans text-zinc-700 dark:text-zinc-300 space-y-1">
                <p className="text-emerald-700 dark:text-emerald-400 font-semibold">Easy Options to Connect:</p>
                <p>1. <strong>Generate & Share</strong>: Click &quot;Generate Passkey&quot;, copy it, and paste it to your peer in your group room or chat.</p>
                <p>2. <strong>Common Room Password</strong>: If you both joined the same room, you can both enter that room&apos;s password as your direct chat passkey!</p>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/40 text-rose-700 dark:text-rose-300 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Peer Selection */}
          <div>
            <label className="block text-zinc-700 dark:text-zinc-300 font-semibold mb-1">
              Peer&apos;s Unique User ID
            </label>
            <input
              type="text"
              value={peerId}
              onChange={(e) => setPeerId(e.target.value)}
              placeholder="e.g. USR-7F2A"
              className="w-full bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/90 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-cyan-500 font-mono tracking-wider text-xs"
            />

            {/* Quick-Select from Online Members */}
            {availableMembers.length > 0 && (
              <div className="mt-2.5 space-y-1">
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 block font-medium">
                  Click to select an online member:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {availableMembers.map((m) => (
                    <button
                      key={m.userId}
                      type="button"
                      onClick={() => handleSelectMember(m)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-mono transition-colors flex items-center gap-1 cursor-pointer border ${
                        peerId === m.userId
                          ? 'bg-cyan-100 dark:bg-cyan-950 border-cyan-500 text-cyan-800 dark:text-cyan-300 shadow-xs'
                          : 'bg-zinc-100 dark:bg-zinc-800/80 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-750'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span className="font-semibold">{m.nickname || 'Member'}</span>
                      <span className="text-zinc-400">({m.userId})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Secret Passkey Input & Generator */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-zinc-700 dark:text-zinc-300 font-semibold">
                Shared Secret Passkey (Min 12 chars)
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleGeneratePasskey}
                  className="inline-flex items-center gap-1 text-[10px] text-cyan-600 dark:text-cyan-400 hover:underline cursor-pointer font-medium"
                >
                  <Dices className="w-3 h-3" />
                  <span>Generate Passkey</span>
                </button>
                <span className="text-zinc-300 dark:text-zinc-600">•</span>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[10px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="e.g. quantum-beacon-8421"
                className="w-full bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/90 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-cyan-500 font-mono pr-20 text-xs"
              />
              {password && (
                <button
                  type="button"
                  onClick={handleCopyPasskey}
                  className="absolute right-1.5 top-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-cyan-800 dark:text-cyan-300 text-[10px] font-mono transition-colors cursor-pointer inline-flex items-center gap-1"
                >
                  {copied ? (
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
              )}
            </div>

            <div className="flex items-center justify-between text-[10px] text-zinc-500 mt-1">
              <span>{password.length}/12+ characters (PBKDF2 600k iter)</span>
              {copied && <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Copied! Share with peer.</span>}
            </div>
          </div>

          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isValid}
              className="flex-1 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-zinc-950 font-bold uppercase transition-all disabled:opacity-50 cursor-pointer shadow-[0_0_12px_rgba(6,182,212,0.3)]"
            >
              {targetMember?.isAcceptingInvite ? 'Join Direct Chat' : 'Open Direct Chat'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Modal to join or create an additional room
 */
export function JoinRoomModal({ onClose, onJoinRoom }) {
  const [room, setRoom] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const roomValid = /^[a-zA-Z0-9_-]{1,64}$/.test(room.trim());
  const passValid = password.length >= 12;

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!roomValid) {
      setError('Room name must be 1-64 alphanumeric characters, dashes, or underscores.');
      return;
    }
    if (!passValid) {
      setError('Password must be at least 12 characters.');
      return;
    }

    onJoinRoom({
      room: room.trim(),
      password,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 font-sans text-zinc-900 dark:text-zinc-100 transition-colors animate-bubble">
        <div className="flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-emerald-500 text-base font-bold">#</span>
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">
              Join or Create Room
            </h2>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-white p-1 rounded-lg transition-colors cursor-pointer" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/40 text-rose-700 dark:text-rose-300 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-zinc-700 dark:text-zinc-300 font-semibold mb-1">
              Room Identifier
            </label>
            <input
              type="text"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="e.g. quantum-hangout"
              className="w-full bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/90 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-emerald-500 font-mono text-xs"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-zinc-700 dark:text-zinc-300 font-semibold">
                Room Password
              </label>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-[10px] text-zinc-500 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 cursor-pointer"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 12 characters"
              className="w-full bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/90 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-emerald-500 font-mono text-xs"
            />
            <span className="text-[10px] text-zinc-500 mt-1 block">
              {password.length}/12+ characters (PBKDF2 600k iter)
            </span>
          </div>

          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!roomValid || !passValid}
              className="flex-1 py-2.5 rounded-xl bg-zinc-950 dark:bg-emerald-500 hover:bg-zinc-800 dark:hover:bg-emerald-400 text-white dark:text-zinc-950 font-bold uppercase transition-all disabled:opacity-50 cursor-pointer shadow-md"
            >
              Join Room
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
