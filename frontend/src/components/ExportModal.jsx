import React, { useState } from 'react';
import {
  Download,
  X,
  Lock,
  Check,
  AlertTriangle,
  FileJson,
  FileText,
  KeyRound,
  Copy,
  ShieldCheck,
} from 'lucide-react';
import {
  downloadFile,
  generateDecryptedJsonExport,
  generateTextTranscriptExport,
  generateEncryptedBackupExport,
} from '../utils/exportChat.js';

function generateRandomPasskey() {
  const adjectives = ['vault', 'cipher', 'silent', 'arctic', 'stealth', 'stellar', 'quantum', 'secure'];
  const nouns = ['key', 'shield', 'haven', 'lock', 'beacon', 'citadel', 'core', 'relay'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${adj}-${noun}-${num}`;
}

export function ExportModal({
  isOpen,
  onClose,
  room,
  chatType,
  peerName,
  peerId,
  messages = [],
  onClearSession,
}) {
  const [format, setFormat] = useState('json'); // 'json' | 'encrypted' | 'txt'
  const [encryptPassword, setEncryptPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState('');
  const [errorNotice, setErrorNotice] = useState('');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  if (!isOpen) return null;

  const totalMessages = messages.length;
  const attachmentCount = messages.filter((m) => Boolean(m.file)).length;
  const safeRoomName = (chatType === 'direct' ? (peerName || peerId || 'direct') : room)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_');
  const dateStamp = new Date().toISOString().slice(0, 10);

  const handleGenerateKey = () => {
    const key = generateRandomPasskey();
    setEncryptPassword(key);
    setShowPassword(true);
  };

  const handleCopyKey = () => {
    if (!encryptPassword) return;
    navigator.clipboard?.writeText(encryptPassword);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const executeExport = async () => {
    setErrorNotice('');
    setIsExporting(true);
    try {
      if (format === 'json') {
        const data = generateDecryptedJsonExport({
          room,
          chatType,
          peerName,
          peerId,
          messages,
        });
        const filename = `${safeRoomName}-session-${dateStamp}.json`;
        downloadFile({
          content: JSON.stringify(data, null, 2),
          filename,
          mimeType: 'application/json;charset=utf-8',
        });
        setExportNotice(`Exported ${totalMessages} messages to ${filename}`);
        return true;
      } else if (format === 'txt') {
        const text = generateTextTranscriptExport({
          room,
          chatType,
          peerName,
          peerId,
          messages,
        });
        const filename = `${safeRoomName}-transcript-${dateStamp}.txt`;
        downloadFile({
          content: text,
          filename,
          mimeType: 'text/plain;charset=utf-8',
        });
        setExportNotice(`Saved transcript to ${filename}`);
        return true;
      } else if (format === 'encrypted') {
        if (!encryptPassword || encryptPassword.length < 8) {
          setErrorNotice('Encryption password must be at least 8 characters.');
          setIsExporting(false);
          return false;
        }
        const encData = await generateEncryptedBackupExport({
          room,
          chatType,
          peerName,
          peerId,
          messages,
          password: encryptPassword,
        });
        const filename = `${safeRoomName}-backup-encrypted-${dateStamp}.enc.json`;
        downloadFile({
          content: JSON.stringify(encData, null, 2),
          filename,
          mimeType: 'application/json;charset=utf-8',
        });
        setExportNotice(`Saved encrypted backup to ${filename}`);
        return true;
      }
    } catch (err) {
      setErrorNotice(err?.message || 'Failed to export chat.');
      return false;
    } finally {
      setIsExporting(false);
    }
    return false;
  };

  const handleExportOnly = async () => {
    const success = await executeExport();
    if (success) {
      setTimeout(() => {
        onClose();
      }, 1400);
    }
  };

  const handleExportAndClear = async () => {
    const success = await executeExport();
    if (success) {
      if (onClearSession) {
        onClearSession();
      }
      setExportNotice('Export complete and session history cleared from memory.');
      setTimeout(() => {
        onClose();
      }, 1600);
    }
  };

  const handleDirectClear = () => {
    if (onClearSession) {
      onClearSession();
    }
    setConfirmClearOpen(false);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs font-sans animate-bubble"
    >
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl relative text-zinc-900 dark:text-zinc-100 max-h-[90vh] overflow-y-auto transition-colors">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-200/80 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Download className="w-5 h-5 text-emerald-500 shrink-0" />
            <div>
              <h2 id="export-modal-title" className="text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-wider">
                Export Session History
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Save messages locally before clearing memory
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close export modal"
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-100 p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Session Stats */}
        <div className="my-4 p-3 rounded-xl bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between text-xs">
          <div>
            <span className="text-zinc-500 dark:text-zinc-400">Target:</span>{' '}
            <strong className="text-emerald-700 dark:text-emerald-400 font-semibold inline-flex items-center gap-1">
              {chatType === 'direct' ? (
                <>
                  <Lock className="w-3 h-3 text-emerald-500" />
                  <span>{peerName || peerId}</span>
                </>
              ) : (
                `#${room}`
              )}
            </strong>
          </div>
          <div className="flex items-center gap-3 text-zinc-500 dark:text-zinc-400">
            <span>
              <strong className="text-zinc-900 dark:text-zinc-200">{totalMessages}</strong> msgs
            </span>
            {attachmentCount > 0 && (
              <span>
                <strong className="text-zinc-900 dark:text-zinc-200">{attachmentCount}</strong> files
              </span>
            )}
          </div>
        </div>

        {/* Notices */}
        {exportNotice && (
          <div className="mb-4 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-500/60 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>{exportNotice}</span>
          </div>
        )}
        {errorNotice && (
          <div className="mb-4 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/80 border border-rose-300 dark:border-rose-500/60 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
            <span>{errorNotice}</span>
          </div>
        )}

        {/* Format Selection */}
        <div className="space-y-2.5 mb-5">
          <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            Select Export Format
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {/* Decrypted JSON */}
            <button
              type="button"
              onClick={() => setFormat('json')}
              className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-colors cursor-pointer ${
                format === 'json'
                  ? 'bg-emerald-50/70 dark:bg-zinc-800 border-emerald-500 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'bg-[#f8f9fa] dark:bg-zinc-950/70 border-zinc-200/80 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-850 text-zinc-600 dark:text-zinc-400'
              }`}
            >
              <div className="flex items-center gap-1.5 font-bold text-xs text-zinc-900 dark:text-zinc-200">
                <FileJson className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Plain JSON</span>
              </div>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 leading-tight">
                Decrypted structured JSON with timestamps & attachments.
              </p>
            </button>

            {/* Encrypted Backup */}
            <button
              type="button"
              onClick={() => setFormat('encrypted')}
              className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-colors cursor-pointer ${
                format === 'encrypted'
                  ? 'bg-cyan-50/70 dark:bg-zinc-800 border-cyan-500 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'bg-[#f8f9fa] dark:bg-zinc-950/70 border-zinc-200/80 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-850 text-zinc-600 dark:text-zinc-400'
              }`}
            >
              <div className="flex items-center gap-1.5 font-bold text-xs text-zinc-900 dark:text-zinc-200">
                <Lock className="w-4 h-4 text-cyan-500 shrink-0" />
                <span>Encrypted</span>
              </div>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 leading-tight">
                AES-256-GCM backup sealed with a custom passkey.
              </p>
            </button>

            {/* Formatted Text */}
            <button
              type="button"
              onClick={() => setFormat('txt')}
              className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-colors cursor-pointer ${
                format === 'txt'
                  ? 'bg-amber-50/70 dark:bg-zinc-800 border-amber-500 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'bg-[#f8f9fa] dark:bg-zinc-950/70 border-zinc-200/80 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-850 text-zinc-600 dark:text-zinc-400'
              }`}
            >
              <div className="flex items-center gap-1.5 font-bold text-xs text-zinc-900 dark:text-zinc-200">
                <FileText className="w-4 h-4 text-amber-500 shrink-0" />
                <span>Text Log</span>
              </div>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 leading-tight">
                Formatted transcript with headers and human-readable times.
              </p>
            </button>
          </div>
        </div>

        {/* Security Warning for Plaintext Export Formats */}
        {(format === 'json' || format === 'txt') && (
          <div className="mb-5 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 text-amber-900 dark:text-amber-200 text-xs space-y-1">
            <div className="flex items-center gap-1.5 font-bold">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <span>Local Storage Security Warning</span>
            </div>
            <p className="text-[11px] leading-relaxed opacity-90">
              Exporting as unencrypted {format === 'json' ? 'Plain JSON' : 'Text Log'} creates a persistent plaintext copy on your device disk, outside the relay's zero-persistence in-memory boundaries. For sensitive records, select <strong>Encrypted</strong> export.
            </p>
          </div>
        )}

        {/* Encrypted Password Input if Encrypted Format selected */}
        {format === 'encrypted' && (
          <div className="mb-5 p-3 rounded-xl bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label className="text-cyan-700 dark:text-cyan-400 font-bold flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                <span>Backup Passphrase</span>
              </label>
              <button
                type="button"
                onClick={handleGenerateKey}
                className="text-[10px] text-cyan-600 dark:text-cyan-400 hover:underline cursor-pointer font-medium"
              >
                Generate Passkey
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type={showPassword ? 'text' : 'password'}
                value={encryptPassword}
                onChange={(e) => setEncryptPassword(e.target.value)}
                placeholder="Enter min 8 characters to encrypt backup..."
                className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 focus:border-cyan-500 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="px-2.5 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs transition-colors cursor-pointer"
                title={showPassword ? 'Hide passkey' : 'Show passkey'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
              {encryptPassword && (
                <button
                  type="button"
                  onClick={handleCopyKey}
                  className="px-2.5 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-cyan-700 dark:text-cyan-300 text-xs transition-colors cursor-pointer font-medium inline-flex items-center gap-1"
                  title="Copy passkey to clipboard"
                >
                  {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
            <p className="text-[10px] text-zinc-500">
              This passkey is used with PBKDF2 (300,000 rounds) + AES-GCM to seal the file.
            </p>
          </div>
        )}

        {/* Danger Zone: Clear Confirmation Box */}
        {confirmClearOpen ? (
          <div className="mb-5 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 space-y-2 text-xs">
            <p className="text-rose-800 dark:text-rose-200 font-bold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>Are you sure you want to clear session history?</span>
            </p>
            <p className="text-zinc-600 dark:text-zinc-400 text-[11px]">
              This will wipe all {totalMessages} messages currently held in browser memory for this chat. They cannot be recovered unless you exported them first.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleDirectClear}
                className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors cursor-pointer"
              >
                Yes, Wipe Memory
              </button>
              <button
                type="button"
                onClick={() => setConfirmClearOpen(false)}
                className="px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {/* Action Buttons */}
        <div className="pt-2 flex flex-col sm:flex-row items-center gap-2">
          <button
            type="button"
            onClick={handleExportOnly}
            disabled={isExporting}
            className="w-full sm:flex-1 py-2.5 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100 font-semibold text-xs border border-zinc-200/80 dark:border-zinc-700 flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download {format === 'encrypted' ? 'Backup' : format.toUpperCase()}</span>
          </button>

          <button
            type="button"
            onClick={handleExportAndClear}
            disabled={isExporting || totalMessages === 0}
            className="w-full sm:flex-1 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white dark:text-zinc-950 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Export & Clear Session</span>
          </button>

          <button
            type="button"
            onClick={() => setConfirmClearOpen(true)}
            disabled={confirmClearOpen || totalMessages === 0}
            className="w-full sm:w-auto py-2.5 px-3 rounded-xl bg-[#f8f9fa] dark:bg-zinc-950 hover:bg-rose-50 dark:hover:bg-rose-950/60 text-zinc-600 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-300 border border-zinc-200 dark:border-zinc-800 hover:border-rose-300 dark:hover:border-rose-800 text-xs transition-colors cursor-pointer disabled:opacity-50"
            title="Clear in-memory chat messages without exporting"
          >
            Clear Only
          </button>
        </div>
      </div>
    </div>
  );
}
