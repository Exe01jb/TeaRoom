import React, { useState } from 'react';
import {
  Globe,
  Lock,
  Mic,
  ShieldCheck,
  Lightbulb,
  Zap,
  Smile,
  Download,
  MessageSquare,
  Paperclip,
  Keyboard,
  X,
} from 'lucide-react';

/**
 * PlatformIntroModal: Comprehensive introduction to the Private Chatroom platform.
 * Supports Dark Mode and responsive mobile viewing.
 */
export function PlatformIntroModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'crypto' | 'features' | 'guarantee' | 'faq'

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="intro-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-xs animate-bubble"
    >
      <div
        className="w-full max-w-3xl bg-white dark:bg-zinc-900 rounded-3xl shadow-[0_25px_70px_rgba(0,0,0,0.5)] border border-zinc-200/80 dark:border-zinc-800 overflow-hidden flex flex-col max-h-[90vh] text-zinc-900 dark:text-zinc-100 transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-6 bg-gradient-to-r from-zinc-900 via-zinc-850 to-zinc-950 text-white flex items-center justify-between shrink-0 border-b border-zinc-800">
          <div className="flex items-center gap-3.5">
            <div className="w-10 sm:w-11 h-10 sm:h-11 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center shadow-inner shrink-0">
              <svg className="w-5 sm:w-6 h-5 sm:h-6 text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="8" cy="8" r="3.2" />
                <circle cx="16" cy="8" r="3.2" />
                <circle cx="8" cy="16" r="3.2" />
                <circle cx="16" cy="16" r="3.2" />
              </svg>
            </div>
            <div>
              <h2 id="intro-modal-title" className="text-sm sm:text-lg font-bold tracking-tight">
                Private Chatroom
              </h2>
              <p className="text-[11px] sm:text-xs text-zinc-400 font-normal">
                Client-Side Zero-Persistence Encrypted Relay Architecture
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close introduction modal"
            className="w-8 sm:w-9 h-8 sm:h-9 rounded-full bg-white/10 hover:bg-white/20 text-zinc-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Topics Navigation Header Area - Fully visible, responsive without clipping */}
        <div className="p-3 sm:px-6 sm:py-3.5 border-b border-zinc-200/80 dark:border-zinc-800 bg-[#f8f9fa] dark:bg-zinc-950 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {[
              { id: 'overview', label: 'Platform Overview', Icon: Globe },
              { id: 'crypto', label: 'Cryptographic Engine', Icon: Lock },
              { id: 'features', label: 'Key Capabilities', Icon: Mic },
              { id: 'guarantee', label: 'Zero-Persistence Oath', Icon: ShieldCheck },
              { id: 'faq', label: 'Security Best Practices', Icon: Lightbulb },
            ].map((tab) => {
              const TabIcon = tab.Icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                    activeTab === tab.id
                      ? 'bg-zinc-900 dark:bg-emerald-500 text-white dark:text-zinc-950 shadow-sm'
                      : 'bg-white dark:bg-zinc-900/90 text-zinc-600 dark:text-zinc-400 border border-zinc-200/70 dark:border-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <TabIcon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Content Area */}
        <div className="p-4 sm:p-7 overflow-y-auto space-y-6 text-xs sm:text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed scrollbar-thin">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-5 animate-slide-left">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-zinc-950 dark:text-zinc-100 mb-2">
                  What is Private Chatroom?
                </h3>
                <p>
                  <strong>Private Chatroom</strong> is a zero-knowledge, zero-persistence real-time communications relay designed from the ground up for extreme privacy, confidentiality, and anti-surveillance communications.
                </p>
                <p className="mt-2 text-zinc-600 dark:text-zinc-400">
                  Unlike traditional chat networks (Slack, Discord, Telegram, or WhatsApp) that store user directories, message records, metadata trails, and attachments on centralized cloud servers, Private Chatroom operates on an immutable principle: <em>the server is a blind packet reflector, and the client is a self-sovereign cryptographic vault.</em>
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 sm:p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-200/80 dark:border-zinc-800">
                  <Lock className="w-5 h-5 text-emerald-500 mb-2" />
                  <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 mb-1">Client-Side Only</div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Keys are derived locally in your browser RAM using Web Crypto API. No password or key ever traverses the network.
                  </p>
                </div>
                <div className="p-3.5 sm:p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-200/80 dark:border-zinc-800">
                  <Zap className="w-5 h-5 text-amber-500 mb-2" />
                  <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 mb-1">Zero Persistence</div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    No databases, no disk logs, no IP archiving, and no message retention. Sessions evaporate upon disconnect.
                  </p>
                </div>
                <div className="p-3.5 sm:p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-200/80 dark:border-zinc-800">
                  <Mic className="w-5 h-5 text-cyan-500 mb-2" />
                  <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 mb-1">Encrypted Voice & Media</div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Microphone voice notes, documents, and images are symmetrically encrypted chunk-by-chunk before relay.
                  </p>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-zinc-900 dark:text-zinc-100 text-xs uppercase tracking-wider mb-2">
                  How a Conversation Works
                </h4>
                <ol className="list-decimal pl-5 space-y-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <li>
                    <strong>Room Passphrase:</strong> You and your peers agree on a private Room Name and a shared Secret Password via an out-of-band channel (e.g. Signal, in-person, or secure note).
                  </li>
                  <li>
                    <strong>Local Key Derivation:</strong> Your browser invokes PBKDF2 with 600,000 iterations to derive a 256-bit AES master key.
                  </li>
                  <li>
                    <strong>Opaque Transmission:</strong> When you send text, emojis, files, or voice recordings, they are bundled and encrypted into an opaque ciphertext block with a unique initialization vector (IV).
                  </li>
                  <li>
                    <strong>Blind Relay:</strong> The relay server only observes raw encrypted bytes with no way to decrypt or identify content.
                  </li>
                  <li>
                    <strong>Peer Decryption:</strong> Peers possessing the matching passphrase decrypt and render the message seamlessly in real time.
                  </li>
                </ol>
              </div>
            </div>
          )}

          {/* TAB 2: CRYPTOGRAPHY */}
          {activeTab === 'crypto' && (
            <div className="space-y-5 animate-slide-left">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-zinc-950 dark:text-zinc-100 mb-2">
                  Cryptographic Engine Specifications
                </h3>
                <p className="text-zinc-600 dark:text-zinc-400 text-xs leading-relaxed">
                  Private Chatroom relies solely on the standardized, audited <code>window.crypto.subtle</code> browser primitives, strictly prohibiting unverified homegrown ciphers.
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-3.5 sm:p-4 rounded-2xl bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">PBKDF2-HMAC-SHA-256</span>
                    <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">600,000 Iterations</span>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Defends against brute-force and GPU/ASIC rainbow table dictionary attacks. The salt is deterministically combined with the room identifier to prevent cross-room key collision.
                  </p>
                </div>

                <div className="p-3.5 sm:p-4 rounded-2xl bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">AES-256-GCM (Galois/Counter Mode)</span>
                    <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">256-bit Key + 128-bit Auth Tag</span>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Provides both confidentiality and authenticated integrity. Any tampering or packet corruption immediately fails authentication during decryption and is safely rejected.
                  </p>
                </div>

                <div className="p-3.5 sm:p-4 rounded-2xl bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">12-Byte Cryptographic IVs</span>
                    <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">Unique per Transmission</span>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Generated via hardware entropy using <code>crypto.getRandomValues(new Uint8Array(12))</code>. No initialization vector is ever reused, guaranteeing forward safety against replay or chosen-plaintext analysis.
                  </p>
                </div>

                <div className="p-3.5 sm:p-4 rounded-2xl bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">LRU Bounded Deduplication</span>
                    <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">Anti-Replay Protection</span>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Client and server maintain high-speed in-memory LRU cache rings to reject replayed message IDs and spoofed packet duplicates.
                  </p>
                </div>

                <div className="p-3.5 sm:p-4 rounded-2xl bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">Cryptographic Safety Numbers</span>
                    <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">60-Digit Peer Fingerprint</span>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Deterministic cryptographic key fingerprints derived directly from non-extractable Web Crypto keys. Enables out-of-band peer verification to guarantee freedom from active man-in-the-middle attacks.
                  </p>
                </div>

                <div className="p-3.5 sm:p-4 rounded-2xl bg-[#f8f9fa] dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">Post-Quantum Cryptographic Posture</span>
                    <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">256-bit AES-GCM (128-bit Quantum Bound)</span>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    By strictly deploying 256-bit symmetric cipher keys, the protocol maintains a 128-bit security margin against hypothetical Grover's algorithm quantum attacks, avoiding quantum vulnerabilities inherent in classical public-key exchanges.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: FEATURES */}
          {activeTab === 'features' && (
            <div className="space-y-5 animate-slide-left">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-zinc-950 dark:text-zinc-100 mb-2">
                  Key Platform Capabilities
                </h3>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Enterprise-grade messaging comfort without sacrificing an ounce of privacy.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="p-3.5 sm:p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-200/80 dark:border-zinc-800 space-y-1">
                  <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <Mic className="w-4 h-4 text-emerald-500" />
                    <span>Encrypted Voice Notes</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Capture audio via the browser Web Audio API with real-time frequency visualizer. Voice notes are serialized, AES-256-GCM encrypted, and played back directly from memory via custom interactive waveforms.
                  </p>
                </div>

                <div className="p-3.5 sm:p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-200/80 dark:border-zinc-800 space-y-1">
                  <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <Smile className="w-4 h-4 text-emerald-500" />
                    <span>Offline Privacy Emoji Picker</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Zero external CDNs or analytics trackers. Built-in fast search over 300+ standard emojis across categories with local recents caching.
                  </p>
                </div>

                <div className="p-3.5 sm:p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-200/80 dark:border-zinc-800 space-y-1">
                  <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <Download className="w-4 h-4 text-emerald-500" />
                    <span>Encrypted Chat History Export</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Back up conversations locally before clearing your session. Choose between plaintext/JSON transcripts or re-encrypted offline vaults secured with a custom key.
                  </p>
                </div>

                <div className="p-3.5 sm:p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-200/80 dark:border-zinc-800 space-y-1">
                  <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-emerald-500" />
                    <span>Direct 1-on-1 & Multi-Room Chats</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Seamlessly switch between multiple encrypted rooms and initiate private 1-on-1 direct message channels with online room peers using dedicated secret passkeys.
                  </p>
                </div>

                <div className="p-3.5 sm:p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-200/80 dark:border-zinc-800 space-y-1">
                  <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <Paperclip className="w-4 h-4 text-emerald-500" />
                    <span>Secure File Attachments</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Send images, PDFs, spreadsheets, and archives up to 1 MB. Files are read as binary arrays, base64-encoded, and folded into the encrypted AES payload.
                  </p>
                </div>

                <div className="p-3.5 sm:p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-200/80 dark:border-zinc-800 space-y-1">
                  <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <Keyboard className="w-4 h-4 text-emerald-500" />
                    <span>Ephemeral Typing & Presence</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Animated typing indicators inform conversational flow in real time without storing keystrokes or recording cadence history.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: ZERO PERSISTENCE */}
          {activeTab === 'guarantee' && (
            <div className="space-y-5 animate-slide-left">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-zinc-950 dark:text-zinc-100 mb-2">
                  The Zero-Persistence Oath
                </h3>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Most messaging services claim end-to-end encryption while harvesting identity graphs, contact books, delivery timestamps, and IP addresses. Private Chatroom is fundamentally different:
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-950 dark:text-emerald-300">
                  <strong>Zero Database Storage:</strong> No PostgreSQL, SQLite, Redis, or document store exists. The relay server is completely stateless.
                </div>
                <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-950 dark:text-emerald-300">
                  <strong>Zero Account Registrations:</strong> No email, telephone number, SSO, or physical identifier is ever requested.
                </div>
                <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-950 dark:text-emerald-300">
                  <strong>Zero Cloud Disk Logging:</strong> Messages are reflected immediately through WebSockets in-memory buffers and discarded.
                </div>
                <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-950 dark:text-emerald-300">
                  <strong>Instant Evaporation:</strong> Closing the tab or clicking "Clear Session" destroys the in-memory CryptoKey object. No forensic trace remains in cookies or persistent databases.
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: BEST PRACTICES */}
          {activeTab === 'faq' && (
            <div className="space-y-5 animate-slide-left">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-zinc-950 dark:text-zinc-100 mb-2">
                  User Security Guidelines & Recommendations
                </h3>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  To maximize your operational security when using Private Chatroom:
                </p>
              </div>

              <div className="space-y-3 text-xs text-zinc-600 dark:text-zinc-400">
                <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800">
                  <strong className="text-zinc-900 dark:text-zinc-100 block mb-1">1. Choose Strong, High-Entropy Passphrases</strong>
                  Use passphrases with 16+ characters or multiple random dictionary words (e.g., <code>correct-horse-battery-staple-vault</code>). The 600,000 PBKDF2 iterations protect strong passwords from dictionary attacks.
                </div>
                <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800">
                  <strong className="text-zinc-900 dark:text-zinc-100 block mb-1">2. Exchange Secrets Out-of-Band</strong>
                  Never send your room password through insecure channels (SMS, unencrypted email). Exchange it in person, through an encrypted voice call, or via established E2EE messengers.
                </div>
                <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800">
                  <strong className="text-zinc-900 dark:text-zinc-100 block mb-1">3. Export Prior to Leaving if Records are Needed</strong>
                  Because sessions are strictly volatile, closing the tab erases all chat history. Use the <em>Export Session</em> feature if you need local offline archives.
                </div>
                <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800">
                  <strong className="text-zinc-900 dark:text-zinc-100 block mb-1">4. Secure Execution Environment</strong>
                  Always ensure you are connecting via HTTPS or secure localhost tunnel so browser Web Crypto APIs and audio devices operate in a verified Secure Context.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between shrink-0">
          <div className="text-[10px] sm:text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
            Crafted by{' '}
            <a
              href="https://github.com/Exe01jb"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-500 hover:underline font-semibold"
            >
              Exe01jb
            </a>{' '}
            • PBKDF2 • AES-256-GCM • Zero-Persistence
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 sm:px-5 py-2 rounded-xl bg-zinc-950 dark:bg-emerald-500 hover:bg-zinc-800 dark:hover:bg-emerald-400 text-white dark:text-zinc-950 font-semibold text-xs transition-colors cursor-pointer"
          >
            Got it, continue
          </button>
        </div>
      </div>
    </div>
  );
}
