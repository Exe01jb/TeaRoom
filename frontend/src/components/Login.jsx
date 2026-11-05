import React, { useState } from 'react';
import {
  Sun,
  Moon,
  Lock,
  AlertTriangle,
  KeyRound,
  UserCheck,
  Shield,
  Terminal,
  Cpu,
  Eye,
  EyeOff,
  Sparkles,
} from 'lucide-react';
import { TEN_CHAR_CREDENTIAL_REGEX } from '../utils/crypto.js';

export function Login({
  onJoin,
  isDerivingKey,
  connectionState,
  errorMessage,
  userId,
  onOpenIntro,
  theme = 'dark',
  onToggleTheme,
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState('');

  const cleanUser = username.trim();
  const userValid = /^[A-Za-z0-9_-]{2,24}$/.test(cleanUser);
  const passValid = TEN_CHAR_CREDENTIAL_REGEX.test(password);
  const canSubmit = userValid && passValid && !isDerivingKey && connectionState === 'connected';

  // Smart paste: pasting "username:password" auto-fills both fields
  const handleUsernameChange = (e) => {
    const val = e.target.value;
    if (val.includes(':')) {
      const [uPart, pPart] = val.split(':');
      if (uPart && pPart) {
        setUsername(uPart.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24));
        setPassword(pPart.trim().replace(/[^A-Za-z0-9]/g, '').slice(0, 10));
        setLocalError('');
        return;
      }
    }
    setUsername(val.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24));
  };

  const handlePasswordChange = (e) => {
    setPassword(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 10));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setLocalError('');

    if (!userValid) {
      setLocalError('Invite username must be 2 to 24 alphanumeric characters.');
      return;
    }
    if (!passValid) {
      setLocalError('Envelope key must be an exact 10-character alphanumeric code.');
      return;
    }

    onJoin({
      username: cleanUser,
      password,
    });
  };

  return (
    <div className="w-full max-w-[460px] mx-auto select-none animate-bubble">
      {/* Top Hardware Telemetry Strip */}
      <div className="flex items-center justify-between px-3.5 py-2 mb-2.5 rounded-xl bg-zinc-900/5 dark:bg-zinc-900/80 border border-zinc-300/70 dark:border-zinc-800/90 text-[10px] font-mono tracking-wider uppercase text-zinc-600 dark:text-zinc-400">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>PCR-V2 // ZERO-PERSISTENCE RELAY</span>
        </div>
        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
          {userId ? `ID:${userId.slice(-6)}` : 'VOLATILE-RAM'}
        </span>
      </div>

      {/* Main Vault Terminal Card */}
      <div className="relative p-6 sm:p-8 bg-white/95 dark:bg-[#0B0D13]/95 border border-zinc-300/90 dark:border-zinc-800/90 rounded-[24px] card-3d hud-corner text-zinc-900 dark:text-zinc-100 overflow-hidden">
        {/* Top Laser Specular Line */}
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-400/80 to-purple-500/60" />

        {/* Header Row */}
        <div className="flex items-start justify-between gap-3 mt-1 mb-6 pb-5 border-b border-zinc-200/80 dark:border-zinc-800/80">
          <div className="flex items-center gap-3.5">
            <div className="relative w-11 h-11 rounded-xl bg-zinc-950 dark:bg-zinc-900 border border-zinc-800 dark:border-emerald-500/30 flex items-center justify-center shadow-inner shrink-0">
              <Terminal className="w-5 h-5 text-emerald-400" />
              <span className="absolute -bottom-1 -right-1 px-1 py-0.2 bg-emerald-500 text-zinc-950 text-[8px] font-mono font-black rounded">
                256
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-extrabold tracking-tight text-zinc-950 dark:text-white">
                  TEAROOM
                </h1>
                <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-widest rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
                  VAULT
                </span>
              </div>
              <p className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 mt-0.5">
                Admin-Invite-Only Cryptographic Relay
              </p>
            </div>
          </div>

          {/* Controls: Theme & Socket State */}
          <div className="flex items-center gap-1.5 shrink-0">
            {onToggleTheme && (
              <button
                type="button"
                onClick={onToggleTheme}
                title={theme === 'dark' ? 'Switch to Archival Light' : 'Switch to Obsidian Dark'}
                aria-label="Toggle theme"
                className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/80 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:border-emerald-500/50 transition-all cursor-pointer"
              >
                {theme === 'dark' ? (
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                ) : (
                  <Moon className="w-3.5 h-3.5 text-indigo-600" />
                )}
              </button>
            )}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <span
                className={`w-2 h-2 rounded-full ${
                  connectionState === 'connected'
                    ? 'bg-emerald-400 shadow-[0_0_8px_#00f59b]'
                    : connectionState === 'connecting'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-rose-500'
                }`}
              />
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                {connectionState}
              </span>
            </div>
          </div>
        </div>

        {/* Cryptographic Envelope Specification Banner */}
        <div className="mb-6 p-3.5 rounded-2xl bg-zinc-100/80 dark:bg-[#11141E] border border-zinc-200/90 dark:border-zinc-800/90 relative">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5" />
              <span>AES-256-GCM Key Envelope</span>
            </span>
            {onOpenIntro && (
              <button
                type="button"
                onClick={onOpenIntro}
                className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-200/80 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-emerald-500 dark:hover:text-emerald-400 cursor-pointer transition-colors"
              >
                [Specs]
              </button>
            )}
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Unwraps your room&apos;s non-extractable 256-bit key locally via{' '}
            <code className="font-mono text-[11px] text-zinc-800 dark:text-zinc-200">
              PBKDF2-SHA256 (600k)
            </code>
            . Paste <code className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">user:pass</code> to auto-fill.
          </p>
        </div>

        {/* Error Alert Banner */}
        {(errorMessage || localError) && (
          <div className="mb-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs font-mono flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <span>{errorMessage || localError}</span>
          </div>
        )}

        {/* 2-Field Envelope Redemption Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Field 1: Invite Username */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>01 // Invite Identifier</span>
              </label>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  userValid
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold'
                    : 'text-zinc-400 dark:text-zinc-500'
                }`}
              >
                {userValid ? 'READY' : `${cleanUser.length} CHARS`}
              </span>
            </div>
            <input
              type="text"
              value={username}
              onChange={handleUsernameChange}
              disabled={isDerivingKey}
              placeholder="Invite username or paste user:pass"
              maxLength={36}
              autoComplete="off"
              spellCheck={false}
              className="w-full px-4 py-3 bg-zinc-50 dark:bg-[#07080C] border border-zinc-300 dark:border-zinc-800 rounded-xl text-xs font-mono tracking-wider text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-emerald-500 dark:focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/15 transition-all"
            />
          </div>

          {/* Field 2: 10-Char Envelope Key + Live 10-Cell Hardware Matrix */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-emerald-500" />
                <span>02 // 10-Char Envelope Key</span>
              </label>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  passValid
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold'
                    : 'text-zinc-400 dark:text-zinc-500'
                }`}
              >
                [{password.length}/10]
              </span>
            </div>

            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={handlePasswordChange}
                disabled={isDerivingKey}
                placeholder="••••••••••"
                maxLength={10}
                autoComplete="off"
                spellCheck={false}
                className="w-full pl-4 pr-11 py-3 bg-zinc-50 dark:bg-[#07080C] border border-zinc-300 dark:border-zinc-800 rounded-xl text-xs font-mono tracking-[0.25em] text-zinc-900 dark:text-emerald-300 placeholder-zinc-400 dark:placeholder-zinc-700 focus:outline-none focus:border-emerald-500 dark:focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/15 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide key' : 'Show key'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-1 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* 10-Cell Hardware Entropy Matrix Bar */}
            <div className="grid grid-cols-10 gap-1.5 mt-2.5" aria-hidden="true">
              {Array.from({ length: 10 }).map((_, idx) => {
                const filled = idx < password.length;
                return (
                  <div
                    key={idx}
                    className={`h-1.5 rounded-sm transition-all duration-150 ${
                      passValid
                        ? 'bg-emerald-400 shadow-[0_0_8px_rgba(0,245,155,0.6)]'
                        : filled
                        ? 'bg-purple-400 dark:bg-purple-400/80'
                        : 'bg-zinc-200 dark:bg-zinc-800/90'
                    }`}
                  />
                );
              })}
            </div>
          </div>

          {/* Unlock Submit CTA */}
          <button
            type="submit"
            disabled={!canSubmit}
            className={`w-full py-3.5 px-4 rounded-xl font-mono font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2.5 ${
              canSubmit
                ? 'btn-3d bg-zinc-950 dark:bg-[#00F59B] text-white dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-[#22ffaa] cursor-pointer'
                : 'bg-zinc-200 dark:bg-zinc-900 border border-zinc-300/60 dark:border-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed'
            }`}
          >
            {isDerivingKey ? (
              <>
                <Sparkles className="w-4 h-4 animate-spin" />
                <span>UNWRAPPING 256-BIT ENVELOPE...</span>
              </>
            ) : (
              <>
                <Shield className="w-4 h-4" />
                <span>UNLOCK ENVELOPE &amp; ENTER VAULT</span>
              </>
            )}
          </button>
        </form>

        {/* Bottom Cryptographic Footnote */}
        <div className="mt-6 pt-4 border-t border-zinc-200/70 dark:border-zinc-800/80 flex items-center justify-between text-[10px] font-mono text-zinc-400 dark:text-zinc-500">
          <span className="flex items-center gap-1">
            <Lock className="w-3 h-3 text-emerald-500" />
            ECDSA P-256 TOFU IDENTITY
          </span>
          <a
            href="https://github.com/Exe01jb"
            target="_blank"
            rel="noopener noreferrer"
            title="Developed by Exe01jb on GitHub"
            className="hover:text-emerald-500 transition-colors"
          >
            BY EXE01JB
          </a>
        </div>
      </div>
    </div>
  );
}