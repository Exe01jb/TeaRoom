import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  KeyRound,
  Users,
  Activity,
  Ban,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  LogOut,
  Plus,
  Lock,
  ArrowLeft,
  AlertTriangle,
} from 'lucide-react';
import {
  generateTenCharCredential,
  deriveAdminRoomMasterKey,
  createEncryptedInviteEnvelope,
} from '../utils/crypto.js';

export function AdminDashboard({ onBackToChat }) {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem('pcr_admin_token') || '');
  const [inputKey, setInputKey] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');
  const [activeTab, setActiveTab] = useState('invites'); // 'invites' | 'overview' | 'connections' | 'blocked'

  const [overview, setOverview] = useState(null);
  const [connections, setConnections] = useState([]);
  const [blockedIps, setBlockedIps] = useState([]);
  const [invites, setInvites] = useState([]);

  // Invite Generator Form State
  const [targetRoom, setTargetRoom] = useState('cyber-vault');
  const [customUsername, setCustomUsername] = useState('');
  const [customPassword, setCustomPassword] = useState('');
  const [isGeneratingInvite, setIsGeneratingInvite] = useState(false);
  const [generatedCredential, setGeneratedCredential] = useState(null); // { username, password, room }
  const [copiedField, setCopiedField] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  // IP Block Form State
  const [ipToBlock, setIpToBlock] = useState('');
  const [blockReason, setBlockReason] = useState('');

  const fetchAdminData = useCallback(
    async (tokenToUse = adminKey) => {
      if (!tokenToUse) return;
      const headers = {
        Authorization: `Bearer ${tokenToUse}`,
        'Content-Type': 'application/json',
      };

      try {
        const [ovRes, connRes, ipRes, invRes] = await Promise.all([
          fetch('/api/admin/overview', { headers }),
          fetch('/api/admin/connections', { headers }),
          fetch('/api/admin/blocked-ips', { headers }),
          fetch('/api/admin/invites', { headers }),
        ]);

        if (ovRes.status === 401) {
          setIsAuthenticated(false);
          sessionStorage.removeItem('pcr_admin_token');
          return;
        }

        const [ovJson, connJson, ipJson, invJson] = await Promise.all([
          ovRes.json(),
          connRes.json(),
          ipRes.json(),
          invRes.json(),
        ]);

        if (ovJson.ok) setOverview(ovJson.data);
        if (connJson.ok) setConnections(connJson.data || []);
        if (ipJson.ok) setBlockedIps(ipJson.data || []);
        if (invJson.ok) setInvites(invJson.data || []);
        setIsAuthenticated(true);
      } catch (err) {
        console.error('Admin fetch error:', err);
      }
    },
    [adminKey]
  );

  useEffect(() => {
    if (adminKey) {
      fetchAdminData(adminKey);
      const timer = setInterval(() => fetchAdminData(adminKey), 4000);
      return () => clearInterval(timer);
    }
  }, [adminKey, fetchAdminData]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: inputKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setAuthError(
          data.error === 'TOO_MANY_ATTEMPTS'
            ? 'Too many login attempts. Please wait 1 minute.'
            : 'Invalid Administrator Secret Key.'
        );
        return;
      }
      sessionStorage.setItem('pcr_admin_token', data.token);
      setAdminKey(data.token);
      setIsAuthenticated(true);
      setInputKey('');
      fetchAdminData(data.token);
    } catch {
      setAuthError('Failed to connect to server.');
    }
  };

  const handleGenerateInvite = async (e) => {
    e.preventDefault();
    const roomClean = targetRoom.trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(roomClean)) {
      setStatusMsg('Invalid room name (use 1-64 alphanumeric chars, dashes, or underscores).');
      return;
    }

    if (customUsername.trim().length > 0 && customUsername.trim().length < 2) {
      setStatusMsg('Custom username must be at least 2 alphanumeric characters (or leave blank to auto-generate).');
      return;
    }

    if (customPassword.trim().length > 0 && customPassword.trim().length !== 10) {
      setStatusMsg('Custom password must be exactly 10 alphanumeric characters (or leave blank to auto-generate).');
      return;
    }

    setIsGeneratingInvite(true);
    setStatusMsg('');

    try {
      const username =
        customUsername.trim().length >= 2
          ? customUsername.trim()
          : generateTenCharCredential(10);
      const password =
        customPassword.trim().length === 10
          ? customPassword.trim()
          : generateTenCharCredential(10);

      // Use a dedicated client-side Vault Master Secret (stored only in browser sessionStorage, never sent to server)
      let effectiveVaultSecret = sessionStorage.getItem('pcr_vault_client_seed') || '';
      if (!effectiveVaultSecret) {
        effectiveVaultSecret = `${generateTenCharCredential(10)}-${generateTenCharCredential(10)}`;
        sessionStorage.setItem('pcr_vault_client_seed', effectiveVaultSecret);
      }

      // Derive deterministic 256-bit AES-GCM Room Master Key in Admin's browser
      const masterKeyBase64 = await deriveAdminRoomMasterKey({
        vaultSecret: effectiveVaultSecret,
        room: roomClean,
        epoch: 1,
      });

      // Wrap the 256-bit Room Master Key in an AES-256-GCM envelope using the user's 10-char password
      const { authToken, envelope } = await createEncryptedInviteEnvelope({
        username,
        password,
        room: roomClean,
        masterKeyBase64,
        epoch: 1,
      });

      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          room: roomClean,
          authToken,
          envelope,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to register invite');
      }

      setGeneratedCredential({ username, password, room: roomClean });
      setCustomUsername('');
      setCustomPassword('');
      fetchAdminData(adminKey);
    } catch (err) {
      setStatusMsg(err.message || 'Failed to generate encrypted invite.');
    } finally {
      setIsGeneratingInvite(false);
    }
  };

  const handleRevokeInvite = async (username) => {
    try {
      await fetch(`/api/admin/invites/${encodeURIComponent(username)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminKey}` },
      });
      if (generatedCredential?.username === username) {
        setGeneratedCredential(null);
      }
      fetchAdminData(adminKey);
    } catch {}
  };

  const handleTerminateRoom = async (roomName) => {
    try {
      await fetch(`/api/admin/rooms/${encodeURIComponent(roomName)}/terminate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminKey}` },
      });
      fetchAdminData(adminKey);
    } catch {}
  };

  const handleDisconnectSocket = async (id) => {
    try {
      await fetch(`/api/admin/connections/${encodeURIComponent(id)}/disconnect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminKey}` },
      });
      fetchAdminData(adminKey);
    } catch {}
  };

  const handleBlockIp = async (e) => {
    e.preventDefault();
    if (!ipToBlock.trim()) return;
    try {
      await fetch('/api/admin/blocked-ips', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ip: ipToBlock.trim(),
          reason: blockReason.trim() || 'Administrative ban',
        }),
      });
      setIpToBlock('');
      setBlockReason('');
      fetchAdminData(adminKey);
    } catch {}
  };

  const handleUnblockIp = async (ip) => {
    try {
      await fetch(`/api/admin/blocked-ips/${encodeURIComponent(ip)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminKey}` },
      });
      fetchAdminData(adminKey);
    } catch {}
  };

  const copyText = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(''), 2000);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md p-6 sm:p-8 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-500 flex items-center justify-center">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                  Admin Moderation Console
                </h1>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Zero-Knowledge Invite & Relay Management
                </p>
              </div>
            </div>
            <button
              onClick={onBackToChat}
              className="px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-xs font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Chat</span>
            </button>
          </div>

          {authError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                Administrator Master Key
              </label>
              <input
                type="password"
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                placeholder="Enter administrator secret key..."
                className="w-full px-3.5 py-2.5 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-mono focus:outline-none focus:border-amber-500"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs cursor-pointer transition-colors"
            >
              Authenticate Admin Console
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Top Bar */}
      <header className="flex flex-wrap items-center justify-between gap-4 p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 flex items-center justify-center">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
              TeaRoom Administrator Console
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              10-Char AES-256-GCM Invite Envelopes • Zero Plaintext Persistence
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchAdminData(adminKey)}
            className="px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
          <button
            onClick={onBackToChat}
            className="px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Chat</span>
          </button>
          <button
            onClick={() => {
              sessionStorage.removeItem('pcr_admin_token');
              setAdminKey('');
              setIsAuthenticated(false);
            }}
            className="p-2 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 cursor-pointer"
            title="Logout Admin"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'invites', label: `10-Char Invites (${invites.length})`, icon: KeyRound },
          { id: 'overview', label: 'System & Rooms Overview', icon: Activity },
          { id: 'connections', label: `Active Sockets (${connections.length})`, icon: Users },
          { id: 'blocked', label: `Blocked IPs (${blockedIps.length})`, icon: Ban },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2.5 rounded-2xl text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all ${
                activeTab === t.id
                  ? 'bg-zinc-900 dark:bg-emerald-500 text-white dark:text-zinc-950 shadow-sm'
                  : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: 10-CHAR INVITE & VAULT GENERATOR */}
      {activeTab === 'invites' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Create New 10-Char Invite */}
          <div className="lg:col-span-5 p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl space-y-4 h-fit">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-emerald-500" />
              <h2 className="text-sm font-bold">Issue 10-Char User Invite</h2>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Wraps the room&apos;s 256-bit AES-GCM master key inside a client-side encrypted envelope locked by a unique username and 10-character password.
            </p>

            {statusMsg && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs">
                {statusMsg}
              </div>
            )}

            <form onSubmit={handleGenerateInvite} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold mb-1">Assigned Room Name</label>
                <input
                  type="text"
                  value={targetRoom}
                  onChange={(e) => setTargetRoom(e.target.value)}
                  placeholder="e.g. cyber-vault"
                  maxLength={64}
                  className="w-full px-3.5 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-500 mb-1">
                    Username (Optional)
                  </label>
                  <input
                    type="text"
                    value={customUsername}
                    onChange={(e) =>
                      setCustomUsername(e.target.value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24))
                    }
                    placeholder="Auto 10-char"
                    maxLength={24}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-500 mb-1">
                    10-Char Password (Optional)
                  </label>
                  <input
                    type="text"
                    value={customPassword}
                    onChange={(e) =>
                      setCustomPassword(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 10))
                    }
                    placeholder="Auto 10-char"
                    maxLength={10}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-mono"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isGeneratingInvite}
                className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>
                  {isGeneratingInvite
                    ? 'Encrypting 256-Bit Key Envelope...'
                    : 'Generate 10-Char Invite'}
                </span>
              </button>
            </form>

            {/* One-Time Generated Credential Display */}
            {generatedCredential && (
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-3 animate-bubble">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Invite Created for #{generatedCredential.room}</span>
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500">Shown Once</span>
                </div>

                <div className="space-y-1.5 text-xs font-mono bg-white/80 dark:bg-zinc-950/80 p-3 rounded-xl border border-emerald-500/20">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Username:</span>
                    <strong className="text-zinc-900 dark:text-white select-all">
                      {generatedCredential.username}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Password (10):</span>
                    <strong className="text-emerald-600 dark:text-emerald-400 select-all">
                      {generatedCredential.password}
                    </strong>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        `${generatedCredential.username}:${generatedCredential.password}`,
                        'combo'
                      )
                    }
                    className="flex-1 py-2 px-3 rounded-xl bg-zinc-900 dark:bg-emerald-500 text-white dark:text-zinc-950 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {copiedField === 'combo' ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied user:pass!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy user:pass</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right: Active Invites Table */}
          <div className="lg:col-span-7 p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">Issued 10-Char Invites ({invites.length})</h2>
              <span className="text-[11px] text-zinc-500">
                Revoking an invite immediately evicts the user
              </span>
            </div>

            {invites.length === 0 ? (
              <div className="py-12 text-center text-xs text-zinc-500">
                No invites issued yet. Generate a 10-character credential on the left to grant room access.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500">
                      <th className="py-2.5 px-2">Username</th>
                      <th className="py-2.5 px-2">Room</th>
                      <th className="py-2.5 px-2">Status</th>
                      <th className="py-2.5 px-2">Last Used</th>
                      <th className="py-2.5 px-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60 font-mono">
                    {invites.map((inv) => (
                      <tr key={inv.username}>
                        <td className="py-2.5 px-2 font-bold text-zinc-900 dark:text-zinc-100">
                          {inv.username}
                        </td>
                        <td className="py-2.5 px-2 text-emerald-600 dark:text-emerald-400">
                          #{inv.room}
                        </td>
                        <td className="py-2.5 px-2 font-sans">
                          {inv.isOnline ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 text-[10px] font-semibold">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              Online
                            </span>
                          ) : (
                            <span className="text-[11px] text-zinc-400">Offline</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-[11px] text-zinc-500 font-sans">
                          {inv.lastUsedAt
                            ? new Date(inv.lastUsedAt).toLocaleTimeString()
                            : 'Never'}
                        </td>
                        <td className="py-2.5 px-2 text-right font-sans">
                          <button
                            onClick={() => handleRevokeInvite(inv.username)}
                            className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-[11px] font-semibold cursor-pointer inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Revoke</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: OVERVIEW & ACTIVE ROOMS */}
      {activeTab === 'overview' && overview && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <div className="text-xs text-zinc-500">Active Connections</div>
              <div className="text-2xl font-bold mt-1">{overview.activeConnectionsCount}</div>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <div className="text-xs text-zinc-500">Active Rooms</div>
              <div className="text-2xl font-bold mt-1">{overview.activeRoomsCount}</div>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <div className="text-xs text-zinc-500">Relayed Ciphertexts</div>
              <div className="text-2xl font-bold mt-1">{overview.totalRelayedMessages}</div>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <div className="text-xs text-zinc-500">RAM Usage (RSS)</div>
              <div className="text-2xl font-bold mt-1">{overview.memoryRssMb} MB</div>
            </div>
          </div>

          <div className="p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-3">
            <h2 className="text-sm font-bold">Active Encrypted Rooms</h2>
            {overview.rooms?.length === 0 ? (
              <p className="text-xs text-zinc-500 py-6 text-center">No active rooms right now.</p>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
                {overview.rooms?.map((r) => (
                  <div key={r.name} className="py-3 flex items-center justify-between">
                    <div>
                      <span className="font-bold font-mono text-emerald-500">#{r.name}</span>
                      <span className="ml-3 text-zinc-500">
                        {r.memberCount} member(s) • {r.totalMessages} msgs
                      </span>
                    </div>
                    <button
                      onClick={() => handleTerminateRoom(r.name)}
                      className="px-3 py-1 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 font-semibold cursor-pointer"
                    >
                      Terminate Room
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: ACTIVE CONNECTIONS */}
      {activeTab === 'connections' && (
        <div className="p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-4">
          <h2 className="text-sm font-bold">Connected Sockets ({connections.length})</h2>
          {connections.length === 0 ? (
            <p className="text-xs text-zinc-500 py-6 text-center">No active socket sessions.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500">
                    <th className="py-2 px-2">Socket ID</th>
                    <th className="py-2 px-2">Invite User</th>
                    <th className="py-2 px-2">IP Address</th>
                    <th className="py-2 px-2">Room</th>
                    <th className="py-2 px-2">Messages</th>
                    <th className="py-2 px-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 font-mono">
                  {connections.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2.5 px-2">{c.id.slice(0, 10)}...</td>
                      <td className="py-2.5 px-2 font-bold">{c.username || '—'}</td>
                      <td className="py-2.5 px-2">{c.ip}</td>
                      <td className="py-2.5 px-2 text-emerald-500">
                        {c.room ? `#${c.room}` : 'Lobby'}
                      </td>
                      <td className="py-2.5 px-2">{c.messageCount}</td>
                      <td className="py-2.5 px-2 text-right font-sans">
                        <button
                          onClick={() => handleDisconnectSocket(c.id)}
                          className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 font-semibold cursor-pointer"
                        >
                          Disconnect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: BLOCKED IPS */}
      {activeTab === 'blocked' && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <form
            onSubmit={handleBlockIp}
            className="md:col-span-5 p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-3 h-fit"
          >
            <h2 className="text-sm font-bold">Block IP Address</h2>
            <input
              type="text"
              value={ipToBlock}
              onChange={(e) => setIpToBlock(e.target.value)}
              placeholder="e.g. 192.0.2.15"
              className="w-full px-3.5 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-mono"
            />
            <input
              type="text"
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              placeholder="Reason (optional)"
              className="w-full px-3.5 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs"
            />
            <button
              type="submit"
              className="w-full py-2.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-bold text-xs cursor-pointer"
            >
              Ban IP & Disconnect
            </button>
          </form>

          <div className="md:col-span-7 p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-3">
            <h2 className="text-sm font-bold">Blocked IPs ({blockedIps.length})</h2>
            {blockedIps.length === 0 ? (
              <p className="text-xs text-zinc-500 py-6 text-center">No blocked IPs.</p>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
                {blockedIps.map((b) => (
                  <div key={b.ip} className="py-2.5 flex items-center justify-between">
                    <div>
                      <strong className="font-mono">{b.ip}</strong>
                      <span className="ml-2 text-zinc-500">({b.reason})</span>
                    </div>
                    <button
                      onClick={() => handleUnblockIp(b.ip)}
                      className="px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 text-xs cursor-pointer"
                    >
                      Unblock
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}