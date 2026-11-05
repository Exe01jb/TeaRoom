# TeaRoom (Private Chatroom)

[![Author](https://img.shields.io/badge/Author-Exe01jb-10b981?style=flat-square&logo=github)](https://github.com/Exe01jb)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Security: WebCrypto](https://img.shields.io/badge/Security-AES--GCM--256%20%7C%20PBKDF2-emerald?style=flat-square)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-green?style=flat-square&logo=node.js)](https://nodejs.org/)

A lightweight, zero-persistence, client-side encrypted chat relay developed and maintained by **[Exe01jb](https://github.com/Exe01jb)**.

Plaintext exists exclusively in the browser memory of room participants. The server acts as an honest-but-curious relay for opaque ciphertext envelopes. Messages are never written to disk, databases, or browser storage.

---

## Threat Model

### Protects Against
- An honest-but-curious relay server operator who serves the intended frontend bundle and relays traffic as designed.
- Passive eavesdroppers reading data stored or relayed over network channels or logs.

### Does NOT Protect Against
- **A malicious server operator** who modifies the served JavaScript bundle (it could capture the password before encryption).
- **Offline password guessing** against captured ciphertext. Password strength is critical; passwords must be at least 12 characters.
- **Loss of forward secrecy**. Compromise of the room password exposes all past captured traffic.
- **Impersonation**. Everyone who knows the room password shares one symmetric AES-GCM key and can send messages under any nickname. Nicknames are unauthenticated.
- **Metadata leakage**. The server observes room names, IP addresses, packet timings, message byte sizes, and connected socket counts. Room names are public.
- **Room access control**. Anyone who knows a room name can join the room, appear in the online presence count, and transmit undecryptable garbage. Server-side mitigations are rate limits and room capacity limits only.

> **Security Guarantee Boundary**: This system is NOT secure against a fully malicious server operator who tampers with the application code.

---

## How the Cryptography Works (Protocol v1)

All cryptographic operations strictly employ the browser's native **Web Crypto API** (`crypto.subtle`). No third-party crypto libraries (`crypto-js`, custom AES) are used.

### 1. Key Derivation & Access Control Modes

The platform supports two distinct cryptographically isolated access models:

- **Admin Invite Envelopes (10-character credentials)**:
  - When `INVITE_ONLY=true` (production default), the room master key is a fresh 256-bit random key generated client-side by an administrator.
  - The key is wrapped inside an AES-256-GCM envelope locked with the recipient's username and a 10-character alphanumeric password.
  - The recipient redeems the envelope using a domain-separated one-way hash token `SHA-256("pcr/v2/invite-auth/" + user + ":" + pass)`. The relay verifies the token without ever seeing the password or room key.
  - The client unwraps the 256-bit key locally using PBKDF2 (600,000 iterations) with `extractable: false`.

- **Ad-Hoc Rooms & 1-on-1 Direct Chats (12+ character passkeys)**:
  - Participants establish a shared secret passkey with a strict client-enforced floor of **at least 12 characters**.
  - Derives the AES-GCM 256-bit key using PBKDF2 with SHA-256 and `VITE_PBKDF2_ITERATIONS` (default: **600,000** iterations, minimum floor: 300,000).
  - In v2, salts are unique 16-byte random values domain-separated per room and epoch:
    $$\text{Salt} = \text{SHA-256}(\text{"pcr/v2/salt/"} + \text{roomName} + \text{"/"} + \text{epoch} + \text{"/"} + \text{randomSalt})$$
    *(Legacy v1 fallback uses public deterministic salt: $\text{SHA-256}(\text{"private-chatroom/v1/salt/"} + \text{roomName})$).*
  - Derived key is marked `extractable: false`, with usages `["encrypt", "decrypt"]`.

### 2. Encryption (AES-GCM 256)
- **Initialization Vector (IV)**: Fresh, cryptographically random 12-byte IV per message generated via `crypto.getRandomValues(new Uint8Array(12))`.
- **Message ID**: UUID v4 generated via `crypto.randomUUID()`.
- **Authenticated Additional Data (AAD)**:
  $$\text{AAD} = \text{UTF-8}(\text{"pcr|1|" } + \text{roomName} + \text{"|" } + \text{id})$$
  Modifying the protocol version, the claimed room name, or the message UUID causes authentication to fail and decryption to abort.
- **Inner Payload (Plaintext)**:
  ```json
  {
    "n": "<nickname (1-24 chars)>",
    "t": "<message text (max MAX_MESSAGE_BYTES)>",
    "ts": 1700000000000
  }
  ```
- **Wire Envelope**:
  ```json
  {
    "v": 1,
    "id": "<UUID>",
    "room": "<roomName>",
    "iv": "<standard-base64-12-bytes>",
    "ct": "<standard-base64-ciphertext-and-tag>"
  }
  ```

### 3. Decryption & Integrity
- Inbound payloads are verified for schema, room match, and deduplicated using an in-memory bounded LRU cache (1,000 items).
- Decryption is attempted with the active room key and authenticated against the AAD.
- Corrupted messages or incorrect passwords fail decryption gracefully. Repeated decryption failures are collapsed into a single notification row to prevent screen-flooding attacks.

---

## Project Structure

```text
private-chatroom/
├── backend/
│   ├── server.js              # exports createServer(config); listens only when run directly
│   ├── sockets/chatHandler.js # Relay, presence, token-bucket rate limiter
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Login.jsx      # Password requirement checks & deriving key state
│   │   │   ├── ChatBox.jsx    # Auto-scroll, message stream, byte meter
│   │   │   └── Message.jsx    # Text-only bidi rendering & collapsed error banner
│   │   ├── utils/
│   │   │   ├── crypto.js      # Pure WebCrypto implementation
│   │   │   └── lru.js         # Bounded LRU message deduplicator
│   │   ├── App.jsx            # Secure context preflight & session lifecycle
│   │   ├── index.css          # System fonts & dark cyber styling
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── vite.config.js
├── deploy/
│   ├── setup.sh               # One-command idempotent installer for Ubuntu/Debian
│   ├── update.sh              # Zero-downtime atomic updater with rollback
│   └── uninstall.sh           # Clean service & proxy uninstaller
├── tests/
│   ├── crypto.test.js         # WebCrypto roundtrips, AAD tampering, NFKC tests
│   └── integration.test.js    # Multi-client relay, server spy, abuse controls
├── package.json               # Root scripts & dev dependencies
├── LICENSE                    # MIT License (Copyright Exe01jb)
├── .nvmrc                     # Node.js 22 LTS
├── .env.example               # Reference environment variables
└── README.md
```

---

## Configuration (`.env`)

All configurable options with safe production defaults:

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Run environment (`production` enforces explicit `CLIENT_ORIGIN`) |
| `HOST` | `127.0.0.1` | Network interface for backend server |
| `PORT` | `3000` | Port for backend server |
| `CLIENT_ORIGIN` | `https://chat.example.com` | Allowed Origin for Socket.IO (`*` forbidden in production) |
| `TRUST_PROXY` | `true` | When true, reads client IP from `X-Real-IP` set by Nginx |
| `MAX_CONNECTIONS` | `200` | Global connection ceiling across all clients |
| `MAX_CONNECTIONS_PER_IP`| `10` | Concurrent connection cap per client IP address |
| `MAX_ROOM_SIZE` | `20` | Maximum simultaneous members allowed in a room |
| `MAX_MESSAGE_BYTES` | `4096` | Maximum UTF-8 message length in bytes |
| `RATE_LIMIT_WINDOW_MS`| `10000` | Sliding rate limit window (milliseconds) |
| `RATE_LIMIT_MESSAGES` | `15` | Maximum messages per client per window |
| `RATE_LIMIT_JOINS` | `5` | Maximum room join attempts per client per window |
| `VITE_PBKDF2_ITERATIONS`| `600000` | Client build-time PBKDF2 iteration count (minimum 300,000) |

---

## Local Development

### Requirements
- Node.js 22+ (Active LTS)
- npm 10+

### Setup & Run
```bash
# 1. Install dependencies
npm ci

# 2. Run test suites
npm test

# 3. Start development server
npm run dev
```

Visit `http://localhost:3000`.

---

## Automated Deployment (Ubuntu 22.04+ / Debian 11+)

The deployment scripts in `deploy/` are idempotent, non-interactive, and run with zero plaintext leakage.

### 1. Deployment With Domain Name (Automatic HTTPS)

```bash
sudo ./deploy/setup.sh \
  --domain chat.example.com \
  --email admin@example.com
```

This automates:
- System package installation (`nginx`, `certbot`, `ufw`, `curl`, `git`, `rsync`)
- Node.js LTS 22 installation via official NodeSource repository
- Creation of unprivileged `privatechat` system user
- Building frontend production bundle (`frontend/dist`)
- Hardened systemd service (`/etc/systemd/system/private-chatroom.service`)
- Nginx reverse proxy configuration with WebSocket upgrade headers
- Let's Encrypt SSL certificate provisioning and HTTP $\rightarrow$ HTTPS redirect
- Safe UFW firewall configuration (guarantees current SSH port is allowed first)

### 2. Deployment Without a Domain (Localhost Binding & SSH Tunnel)

Web Crypto requires a **Secure Context** (`https://` or `localhost`). Browsers disable `crypto.subtle` when accessing bare public IP addresses over `http://`.

Run setup without `--domain`:
```bash
sudo ./deploy/setup.sh --port 3000
```

The script binds the service to `127.0.0.1:3000` only and displays SSH tunnel instructions:
```bash
# From your local machine:
ssh -L 3000:localhost:3000 user@server-ip

# Open your browser:
http://localhost:3000
```

*Note: Passing `--allow-insecure-http` allows public HTTP on the server IP, but client browsers will block Web Crypto unless accessed over localhost or an HTTPS reverse proxy.*

### 3. Dry-Run Mode
Test what actions will take place without modifying the system:
```bash
./deploy/setup.sh --dry-run
```

---

## Update & Rollback

`deploy/update.sh` updates the application atomically:

```bash
sudo ./deploy/update.sh
```

- Pulls latest Git changes or syncs from `--source PATH`
- Reinstalls dependencies and builds the new frontend into a temporary directory
- Atomically swaps `frontend/dist`
- Restarts `private-chatroom.service` and polls `/health`
- **Automatic Rollback**: If the health check fails, the previous build is restored immediately and the script exits non-zero.

---

## Uninstallation

```bash
# Standard uninstall (stops service, removes nginx config, keeps app data):
sudo ./deploy/uninstall.sh --yes

# Complete purge (removes service, nginx vhost, app directory, and privatechat user):
sudo ./deploy/uninstall.sh --yes --purge
```

---

## Restricted-Network Options

For isolated or air-gapped environments without internet access:
- `--node-tarball /path/to/node-v22-linux-x64.tar.gz`: Installs Node from local archive instead of NodeSource.
- `NPM_REGISTRY=http://local-nexus:8081/repository/npm-group/`: Directs `npm ci` to a local mirror.

---

## Troubleshooting

1. **"Secure Context Required" Error in Browser**:
   Browser Web Crypto is unavailable. Ensure you are either on `https://<domain>` or accessing via `http://localhost:<port>` over an SSH tunnel.
2. **"Unable to decrypt message" Banner**:
   A participant in the room provided a different room password, or an in-transit payload was corrupted.
3. **Check Service Logs**:
   ```bash
   sudo journalctl -u private-chatroom -f
   ```
4. **Inspect Service Security**:
   ```bash
   systemd-analyze security private-chatroom.service
   ```

---

## Author & Maintainer

**TeaRoom (Private Chatroom)** was designed, architected, and developed end-to-end by:

- **Author**: [Exe01jb](https://github.com/Exe01jb)
- **GitHub**: [https://github.com/Exe01jb](https://github.com/Exe01jb)
- **Repository**: [https://github.com/Exe01jb/TeaRoom](https://github.com/Exe01jb/TeaRoom)

---

## License

This project is open-source software licensed under the [MIT License](LICENSE).

Copyright (c) 2026 [Exe01jb](https://github.com/Exe01jb).

