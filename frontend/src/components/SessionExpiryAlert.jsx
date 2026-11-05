import React, { useState, useEffect } from 'react';
import { Clock, ShieldCheck, Plus, X, Hourglass, Download } from 'lucide-react';

/**
 * Format seconds into MM:SS
 */
export function formatTimeRemaining(seconds) {
  if (seconds <= 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Header Visual Countdown Badge
 * Discreet yet informative timer placed in the header
 */
export function SessionCountdownBadge({
  secondsRemaining,
  onExtendSession,
  onOpenExpiryModal,
}) {
  const [showDropdown, setShowDropdown] = useState(false);

  const isCritical = secondsRemaining <= 120; // Under 2 mins
  const isWarning = secondsRemaining <= 300 && !isCritical; // Under 5 mins

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          if (isCritical && onOpenExpiryModal) {
            onOpenExpiryModal();
          } else {
            setShowDropdown((prev) => !prev);
          }
        }}
        title="Encrypted RAM Session Countdown (Click for options)"
        className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-xl border text-[11px] font-mono font-semibold transition-all cursor-pointer ${
          isCritical
            ? 'bg-rose-50 dark:bg-rose-950/80 border-rose-400 dark:border-rose-700 text-rose-700 dark:text-rose-300 animate-pulse shadow-xs'
            : isWarning
            ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300'
            : 'bg-zinc-100/90 dark:bg-zinc-800/80 border-zinc-200/80 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white'
        }`}
      >
        <Clock className={`w-3.5 h-3.5 shrink-0 ${isCritical ? 'animate-pulse text-rose-500' : ''}`} />
        <span className="tabular-nums">{formatTimeRemaining(secondsRemaining)}</span>
        {isCritical && (
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping hidden xs:inline" />
        )}
      </button>

      {/* Dropdown Popover */}
      {showDropdown && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setShowDropdown(false)}
          />
          <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl shadow-2xl p-3 z-40 text-xs font-sans animate-bubble">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
              <span className="font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span>Session TTL Timer</span>
              </span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                {formatTimeRemaining(secondsRemaining)}
              </span>
            </div>

            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed">
              For anti-surveillance security, volatile session keys evaporate from memory when the timer reaches zero.
            </p>

            <div className="mt-3 flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => {
                  onExtendSession(900); // +15 mins
                  setShowDropdown(false);
                }}
                className="w-full py-1.5 px-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 font-semibold text-xs border border-emerald-300 dark:border-emerald-800 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Extend Session (+15 min)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onExtendSession(1800); // +30 mins
                  setShowDropdown(false);
                }}
                className="w-full py-1.5 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Extend (+30 min)</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * High-Urgency Visual Alert Modal
 * Displays when session is <= 120 seconds from evaporating.
 */
export function SessionExpiryModal({
  isOpen,
  onClose,
  secondsRemaining,
  onExtendSession,
  onOpenExport,
  onEndSessionNow,
}) {
  if (!isOpen) return null;

  const totalWarningWindow = 120; // 2 minutes window
  const percentLeft = Math.max(0, Math.min(100, (secondsRemaining / totalWarningWindow) * 100));

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-expiry-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-xs font-sans animate-bubble"
    >
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border-2 border-rose-500/80 dark:border-rose-500/60 rounded-3xl p-5 sm:p-7 shadow-[0_25px_60px_rgba(244,63,94,0.25)] space-y-4 text-zinc-900 dark:text-zinc-100 relative">
        {/* Urgent Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/80 border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 flex items-center justify-center text-2xl shrink-0 shadow-inner">
              <Hourglass className="w-6 h-6 text-rose-600 dark:text-rose-400" />
            </div>
            <div>
              <h2 id="session-expiry-title" className="text-base sm:text-lg font-bold text-rose-600 dark:text-rose-400 tracking-tight">
                Encrypted Session Expiring
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Automatic memory purge is imminent
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 text-xs p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Minimize alert"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Big Visual Countdown Dial */}
        <div className="p-4 bg-rose-50/80 dark:bg-zinc-950/90 border border-rose-200 dark:border-rose-900/60 rounded-2xl flex flex-col items-center justify-center gap-2">
          <div className="text-4xl sm:text-5xl font-mono font-extrabold tracking-wider text-rose-600 dark:text-rose-400 tabular-nums drop-shadow-xs">
            {formatTimeRemaining(secondsRemaining)}
          </div>
          <div className="text-[11px] font-semibold text-rose-700 dark:text-rose-300 uppercase tracking-widest">
            Time remaining until zero-persistence wipe
          </div>

          {/* Depleting progress bar */}
          <div className="w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden mt-1">
            <div
              className="h-full bg-linear-to-r from-rose-500 to-amber-500 transition-all duration-1000 ease-linear rounded-full"
              style={{ width: `${percentLeft}%` }}
            />
          </div>
        </div>

        <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
          In accordance with our zero-persistence protocol, all local encryption keys, active sockets, and volatile chat histories will evaporate when the clock hits zero.
        </p>

        {/* Action Buttons */}
        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={() => {
              onExtendSession(900); // +15 mins
              onClose();
            }}
            className="w-full py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white font-bold text-sm shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Extend Session (+15 Minutes)</span>
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                onExtendSession(1800); // +30 mins
                onClose();
              }}
              className="py-2.5 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-semibold text-xs transition-colors cursor-pointer text-center"
            >
              Extend (+30 min)
            </button>

            {onOpenExport && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenExport();
                }}
                className="py-2.5 px-3 rounded-xl bg-cyan-50 dark:bg-cyan-950/60 hover:bg-cyan-100 dark:hover:bg-cyan-900/60 text-cyan-800 dark:text-cyan-300 font-semibold text-xs border border-cyan-200 dark:border-cyan-800 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export First</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onEndSessionNow}
            className="w-full py-2 text-center text-xs text-rose-600 dark:text-rose-400 hover:underline cursor-pointer font-medium"
          >
            End session & wipe memory right now
          </button>
        </div>
      </div>
    </div>
  );
}
