import React, { useState, useEffect } from 'react';
import { ShieldCheck, X, Copy, Check } from 'lucide-react';
import {
  computeSafetyNumber,
  computeIdentitySafetyNumber,
  computePairwiseSafetyNumber,
  CRYPTO_SPEC,
  PROTOCOL_GUARANTEES,
} from '../utils/crypto.js';

/**
 * SecurityVerificationModal
 * Provides out-of-band cryptographic peer identity verification (Safety Number / Fingerprint),
 * individual participant device authentication, algorithm specifications, and zero-persistence
 * relay boundaries in English and Persian (فارسی).
 */
export function SecurityVerificationModal({
  isOpen,
  onClose,
  chatKey,
  room,
  chatType = 'room',
  peerName,
  peerId,
  myPublicKeySpki,
  peerPublicKeySpki,
}) {
  const [roomSafetyNumber, setRoomSafetyNumber] = useState(null);
  const [identitySafetyNumber, setIdentitySafetyNumber] = useState(null);
  const [pairwiseSafetyNumber, setPairwiseSafetyNumber] = useState(null);
  const [isDeriving, setIsDeriving] = useState(true);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState('identity'); // 'identity' | 'room-key' | 'specs'

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    setIsDeriving(true);

    const derivations = [];

    // 1. Room symmetric key fingerprint
    if (chatKey) {
      derivations.push(
        computeSafetyNumber({ key: chatKey, room })
          .then((res) => {
            if (isMounted) setRoomSafetyNumber(res);
          })
          .catch((err) => console.error('Room key fingerprint error:', err))
      );
    }

    // 2. Individual participant device identity fingerprint (ECDSA P-256)
    if (myPublicKeySpki) {
      derivations.push(
        computeIdentitySafetyNumber({ publicKeySpki: myPublicKeySpki })
          .then((res) => {
            if (isMounted) setIdentitySafetyNumber(res);
          })
          .catch((err) => console.error('Identity fingerprint error:', err))
      );
    }

    // 3. Pairwise safety number for 1-on-1 direct messaging
    if (chatType === 'direct' && myPublicKeySpki && peerPublicKeySpki) {
      derivations.push(
        computePairwiseSafetyNumber({
          myPublicKeySpki,
          peerPublicKeySpki,
          room: room || 'direct',
        })
          .then((res) => {
            if (isMounted) setPairwiseSafetyNumber(res);
          })
          .catch((err) => console.error('Pairwise safety number error:', err))
      );
    }

    Promise.all(derivations).finally(() => {
      if (isMounted) setIsDeriving(false);
    });

    return () => {
      isMounted = false;
    };
  }, [isOpen, chatKey, room, chatType, myPublicKeySpki, peerPublicKeySpki]);

  if (!isOpen) return null;

  const currentDisplayFingerprint =
    activeTab === 'identity'
      ? (pairwiseSafetyNumber || identitySafetyNumber)
      : roomSafetyNumber;

  const handleCopy = () => {
    if (!currentDisplayFingerprint) return;
    const label = activeTab === 'identity' ? 'Participant Identity Safety Number' : 'Shared Room Key Fingerprint';
    const textToCopy = `TeaRoom ${label} (${room}):\n${currentDisplayFingerprint.numeric}\nHex: ${currentDisplayFingerprint.hex}`;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayName = chatType === 'direct' ? peerName || peerId || room : `#${room}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-fade-in select-none">
      <div
        className="card-3d relative w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-950/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-lg shadow-xs">
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100 font-sans">
                Security & Identity Verification
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-sans flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>End-to-End Encrypted • {displayName}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Close verification modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="px-5 sm:px-6 pt-3 flex gap-2 border-b border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('identity')}
            className={`pb-2.5 font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === 'identity'
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold'
                : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            Sender Identity (کد هویت)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('room-key')}
            className={`pb-2.5 font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === 'room-key'
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold'
                : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            Room Passkey (کلید اتاق)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('specs')}
            className={`pb-2.5 font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === 'specs'
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold'
                : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            Protocol Guarantees
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-4 scrollbar-thin">
          {activeTab === 'identity' && (
            <>
              {/* Guidance Banners in EN & FA */}
              <div className="p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/60 text-xs font-sans text-emerald-900 dark:text-emerald-200 space-y-2">
                <p className="leading-relaxed">
                  <strong>Individual Sender Authentication:</strong> This 60-digit number is derived directly from the participant's asymmetric ECDSA P-256 cryptographic identity key. It proves sender authenticity and prevents impersonation within shared rooms.
                </p>
                <p className="leading-relaxed text-[11px] text-emerald-850 dark:text-emerald-300 font-sans border-t border-emerald-200/60 dark:border-emerald-800/50 pt-2 text-right" dir="rtl">
                  <strong>احراز هویت فرستنده:</strong> این کد ۶۰ رقمی مستقیماً از کلید عمومی نامتقارن (ECDSA P-256) دستگاه استخراج شده و از جعل هویت کاربران در اتاق‌های مشترک جلوگیری می‌کند.
                </p>
              </div>

              {/* Safety Number Display */}
              <div className="p-4 rounded-2xl bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800 text-center space-y-3">
                <span className="text-[11px] uppercase tracking-wider font-mono text-zinc-400 font-semibold block">
                  {pairwiseSafetyNumber ? 'Pairwise Identity Safety Number' : 'Individual Device Identity Fingerprint'}
                </span>

                {isDeriving ? (
                  <div className="py-6 flex flex-col items-center justify-center gap-2 text-zinc-500">
                    <svg className="w-5 h-5 animate-spin text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                    </svg>
                    <span className="text-xs font-mono">Deriving Identity Fingerprint…</span>
                  </div>
                ) : (pairwiseSafetyNumber || identitySafetyNumber) ? (
                  <>
                    <div className="font-mono text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-wider leading-relaxed select-all grid grid-cols-3 sm:grid-cols-4 gap-2 p-3 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200/60 dark:border-zinc-800 shadow-inner">
                      {(pairwiseSafetyNumber || identitySafetyNumber).numeric.split(' ').map((chunk, i) => (
                        <span key={i} className="bg-zinc-50 dark:bg-zinc-950 py-1 px-1.5 rounded-lg border border-zinc-200/50 dark:border-zinc-850">
                          {chunk}
                        </span>
                      ))}
                    </div>

                    <div className="pt-1">
                      <span className="text-[10px] font-mono text-zinc-400">Hexadecimal Identity Fingerprint:</span>
                      <p className="font-mono text-xs text-zinc-600 dark:text-zinc-300 break-all select-all mt-0.5">
                        {(pairwiseSafetyNumber || identitySafetyNumber).hex}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleCopy}
                      className="btn-3d w-full py-2.5 px-4 rounded-xl bg-zinc-950 dark:bg-zinc-800 hover:bg-zinc-800 dark:hover:bg-zinc-700 text-white font-sans text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4 text-emerald-400" />
                          <span>Copied to Clipboard</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          <span>Copy Identity Safety Number</span>
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-rose-500">Device identity key is generating or unavailable.</p>
                )}
              </div>
            </>
          )}

          {activeTab === 'room-key' && (
            <>
              {/* Guidance for Room Passkey */}
              <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/60 text-xs font-sans text-amber-900 dark:text-amber-200 space-y-2">
                <p className="leading-relaxed">
                  <strong>Room Passkey Verification:</strong> This fingerprint verifies that both participants derived the identical symmetric AES-GCM room key from the room password.
                </p>
                <p className="leading-relaxed text-[11px] text-amber-800 dark:text-amber-300 font-sans border-t border-amber-200/60 dark:border-amber-800/50 pt-2">
                  <em>Security Boundary Notice:</em> Because all participants in a room share the same room passkey, this fingerprint does not independently prove which participant sent a message.
                </p>
              </div>

              {/* Room Key Fingerprint Display */}
              <div className="p-4 rounded-2xl bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800 text-center space-y-3">
                <span className="text-[11px] uppercase tracking-wider font-mono text-zinc-400 font-semibold block">
                  Shared Symmetric Room Key Fingerprint
                </span>

                {isDeriving ? (
                  <div className="py-6 flex flex-col items-center justify-center gap-2 text-zinc-500">
                    <span className="text-xs font-mono">Deriving Room Key Fingerprint…</span>
                  </div>
                ) : roomSafetyNumber ? (
                  <>
                    <div className="font-mono text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-wider leading-relaxed select-all grid grid-cols-3 sm:grid-cols-4 gap-2 p-3 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200/60 dark:border-zinc-800 shadow-inner">
                      {roomSafetyNumber.numeric.split(' ').map((chunk, i) => (
                        <span key={i} className="bg-zinc-50 dark:bg-zinc-950 py-1 px-1.5 rounded-lg border border-zinc-200/50 dark:border-zinc-850">
                          {chunk}
                        </span>
                      ))}
                    </div>

                    <div className="pt-1">
                      <span className="text-[10px] font-mono text-zinc-400">Hexadecimal Key Fingerprint:</span>
                      <p className="font-mono text-xs text-zinc-600 dark:text-zinc-300 break-all select-all mt-0.5">
                        {roomSafetyNumber.hex}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleCopy}
                      className="btn-3d w-full py-2.5 px-4 rounded-xl bg-zinc-950 dark:bg-zinc-800 hover:bg-zinc-800 dark:hover:bg-zinc-700 text-white font-sans text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4 text-emerald-400" />
                          <span>Copied to Clipboard</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          <span>Copy Room Key Fingerprint</span>
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-rose-500">Room encryption key is unavailable.</p>
                )}
              </div>
            </>
          )}

          {activeTab === 'specs' && (
            <div className="space-y-3 text-xs font-sans">
              <div className="p-3.5 rounded-2xl bg-zinc-100 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800 space-y-2">
                <h3 className="font-bold text-zinc-900 dark:text-zinc-100 text-xs">
                  Zero-Persistence Protocol Invariants
                </h3>
                <ul className="space-y-1.5 text-zinc-600 dark:text-zinc-400 text-[11px] leading-relaxed">
                  <li>• <strong>No Server Plaintext:</strong> The relay receives and routes opaque authenticated ciphertexts only.</li>
                  <li>• <strong>No Disk Storage:</strong> Message plaintexts and encryption keys exist only in volatile client RAM.</li>
                  <li>• <strong>Non-Extractable Keys:</strong> Web Crypto CryptoKey objects are flagged <code className="font-mono text-emerald-600 dark:text-emerald-400">extractable: false</code> to prevent key extraction by scripts.</li>
                  <li>• <strong>AAD Authentication:</strong> Room ID and message UUID are cryptographically bound to the AES-GCM tag to prevent replay across rooms.</li>
                  <li>• <strong>File Encryption:</strong> Attachments are client-side encrypted before network transmission.</li>
                </ul>
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                <div className="p-3 rounded-xl bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/70 dark:border-zinc-800">
                  <span className="text-zinc-400 block text-[10px]">CIPHER SUITE</span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-200">{CRYPTO_SPEC.ALGORITHM}</span>
                </div>
                <div className="p-3 rounded-xl bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/70 dark:border-zinc-800">
                  <span className="text-zinc-400 block text-[10px]">IDENTITY KEYPAIR</span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-200">{CRYPTO_SPEC.IDENTITY_ALGORITHM} {CRYPTO_SPEC.IDENTITY_CURVE}</span>
                </div>
                <div className="p-3 rounded-xl bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/70 dark:border-zinc-800">
                  <span className="text-zinc-400 block text-[10px]">KEY DERIVATION (KDF)</span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-200">PBKDF2-HMAC-SHA256</span>
                </div>
                <div className="p-3 rounded-xl bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/70 dark:border-zinc-800">
                  <span className="text-zinc-400 block text-[10px]">KDF ITERATIONS</span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-200">600,000 Rounds (OWASP)</span>
                </div>
                <div className="p-3 rounded-xl bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/70 dark:border-zinc-800">
                  <span className="text-zinc-400 block text-[10px]">AUTH TAG</span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-200">{CRYPTO_SPEC.TAG_LENGTH_BITS}-bit GCM</span>
                </div>
                <div className="p-3 rounded-xl bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200/70 dark:border-zinc-800">
                  <span className="text-zinc-400 block text-[10px]">SENDER AUTHENTICATION</span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-200">TOFU Key Pinning</span>
                </div>
              </div>

              {/* Protocol Boundaries & Remaining Risks Callout */}
              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-600 dark:text-zinc-400 space-y-1">
                <span className="font-bold text-zinc-800 dark:text-zinc-200 block">Protocol Boundary Notice:</span>
                <p>• <strong>Forward Secrecy (FS):</strong> Static shared room keys do not provide automatic FS. If a room passkey is compromised, past session traffic can be decrypted.</p>
                <p>• <strong>Post-Compromise Security (PCS):</strong> Requires manual room passkey rotation to recover from compromise.</p>
                <p>• <strong>Independent Security Audit:</strong> Automated developer tests have passed. No third-party external cryptographic audit has been conducted.</p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 sm:px-6 py-3 border-t border-zinc-200/80 dark:border-zinc-800 flex justify-end bg-zinc-50/50 dark:bg-zinc-950/50">
          <button
            type="button"
            onClick={onClose}
            className="btn-3d px-5 py-2 rounded-xl bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-sans text-xs font-semibold cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
