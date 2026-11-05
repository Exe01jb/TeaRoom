/**
 * Browser-Storage-Based Identity Key Persistence Module
 * 
 * Provides robust, secure local persistence for asymmetric ECDSA P-256 identity key pairs.
 * Enables seamless reconnection across browser sessions without needing to re-exchange public keys,
 * preventing identity re-initialization, key-changed false alarms, and Safety Number invalidation.
 * 
 * Storage Backends:
 * 1. IndexedDB: Primary storage. Structured cloning natively stores Web Crypto CryptoKey objects.
 * 2. LocalStorage: Secondary fallback when IndexedDB is unavailable or restricted.
 * 3. MemoryStorage: In-memory fallback for headless or restricted sandboxes.
 */

import { generateIdentityKeyPair, getCrypto, bytesToBase64, base64ToBytes } from './crypto.js';

const DB_NAME = 'TeaRoom_IdentityKeyStore';
const DB_VERSION = 1;
const STORE_NAME = 'identity_keys';
const LOCAL_STORAGE_KEY = 'pcr_identity_key_v1';
const MEMORY_STORE = new Map();

/**
 * Open or upgrade IndexedDB instance safely
 */
function openIndexedDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not supported in this environment'));
    }

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error || new Error('Failed to open IndexedDB'));
      };
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Read item from IndexedDB
 */
async function idbGet(key) {
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = () => {
      reject(request.error || new Error(`Failed to read key ${key} from IndexedDB`));
    };
  });
}

/**
 * Save item into IndexedDB
 */
async function idbSet(item) {
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(item);

    request.onsuccess = () => {
      resolve(true);
    };

    request.onerror = () => {
      reject(request.error || new Error('Failed to write item to IndexedDB'));
    };
  });
}

/**
 * Delete item from IndexedDB
 */
async function idbDelete(key) {
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(key);

    request.onsuccess = () => {
      resolve(true);
    };

    request.onerror = () => {
      reject(request.error || new Error(`Failed to delete key ${key} from IndexedDB`));
    };
  });
}

/**
 * Checks if localStorage is available and usable
 */
function isLocalStorageAvailable() {
  try {
    if (typeof localStorage === 'undefined') return false;
    const testKey = '__pcr_storage_probe__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Synchronous peek into localStorage for initial React state hydration
 */
export function getPersistedIdentitySync() {
  if (!isLocalStorageAvailable()) {
    const mem = MEMORY_STORE.get('current_identity');
    if (mem) {
      return {
        userId: mem.userId || null,
        publicKeySpki: mem.publicKeySpki || null,
        fingerprintHex: mem.fingerprintHex || null,
        createdAt: mem.createdAt || null,
      };
    }
    return null;
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && data.userId && data.publicKeySpki) {
      return {
        userId: data.userId,
        publicKeySpki: data.publicKeySpki,
        fingerprintHex: data.fingerprintHex,
        createdAt: data.createdAt,
      };
    }
  } catch {
    // Corrupted record, ignore
  }
  return null;
}

/**
 * Synchronous check whether an identity is currently persisted
 */
export function hasPersistedIdentity() {
  return Boolean(getPersistedIdentitySync());
}

/**
 * Reconstructs CryptoKey instances from JWK or SPKI representations
 */
async function reconstructKeys({ privateKeyJwk, publicKeyJwk, publicKeySpki, rawPrivateKey, rawPublicKey }) {
  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;

  let privateKey = rawPrivateKey || null;
  let publicKey = rawPublicKey || null;

  // Import private key from JWK if needed
  if (!privateKey && privateKeyJwk) {
    try {
      privateKey = await subtle.importKey(
        'jwk',
        privateKeyJwk,
        {
          name: 'ECDSA',
          namedCurve: 'P-256',
        },
        true, // Keep extractable for backup and re-export
        ['sign']
      );
    } catch (err) {
      console.warn('Failed to import privateKey from JWK:', err);
    }
  }

  // Import public key from JWK or SPKI if needed
  if (!publicKey) {
    if (publicKeyJwk) {
      try {
        publicKey = await subtle.importKey(
          'jwk',
          publicKeyJwk,
          {
            name: 'ECDSA',
            namedCurve: 'P-256',
          },
          true,
          ['verify']
        );
      } catch (err) {
        console.warn('Failed to import publicKey from JWK:', err);
      }
    } else if (publicKeySpki) {
      try {
        const spkiBytes = base64ToBytes(publicKeySpki);
        publicKey = await subtle.importKey(
          'spki',
          spkiBytes,
          {
            name: 'ECDSA',
            namedCurve: 'P-256',
          },
          true,
          ['verify']
        );
      } catch (err) {
        console.warn('Failed to import publicKey from SPKI:', err);
      }
    }
  }

  return { privateKey, publicKey };
}

/**
 * Saves an ECDSA P-256 identity keypair to persistent browser storage.
 * Synchronizes across IndexedDB and LocalStorage.
 * 
 * @param {Object} params
 * @param {string} params.userId Persistent user identifier (e.g. 'USR-A1B2')
 * @param {Object} params.keyPair Generated key pair object
 * @param {CryptoKey} params.keyPair.privateKey
 * @param {CryptoKey} params.keyPair.publicKey
 * @param {string} params.keyPair.publicKeySpki Base64-encoded SPKI
 * @param {string} params.keyPair.fingerprintHex SHA-256 fingerprint
 * @param {Object} [params.customMetadata] Additional client-side metadata
 */
export async function saveIdentityKeyPair({ userId, keyPair, customMetadata = {} }) {
  if (!userId || typeof userId !== 'string') {
    throw new Error('saveIdentityKeyPair requires a valid string userId');
  }
  if (!keyPair || !keyPair.publicKey || !keyPair.privateKey) {
    throw new Error('saveIdentityKeyPair requires valid privateKey and publicKey CryptoKey objects');
  }

  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;

  // Export JWK representations if extractable
  let privateKeyJwk = null;
  let publicKeyJwk = null;

  if (keyPair.privateKey.extractable) {
    try {
      privateKeyJwk = await subtle.exportKey('jwk', keyPair.privateKey);
    } catch (err) {
      console.warn('Could not export privateKey to JWK:', err);
    }
  }

  try {
    publicKeyJwk = await subtle.exportKey('jwk', keyPair.publicKey);
  } catch (err) {
    console.warn('Could not export publicKey to JWK:', err);
  }

  // Derive publicKeySpki if missing
  let publicKeySpki = keyPair.publicKeySpki;
  if (!publicKeySpki) {
    const spkiBuffer = await subtle.exportKey('spki', keyPair.publicKey);
    publicKeySpki = bytesToBase64(new Uint8Array(spkiBuffer));
  }

  // Derive fingerprintHex if missing
  let fingerprintHex = keyPair.fingerprintHex;
  if (!fingerprintHex) {
    const spkiBytes = base64ToBytes(publicKeySpki);
    const fpBuffer = await subtle.digest('SHA-256', spkiBytes);
    fingerprintHex = Array.from(new Uint8Array(fpBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const now = Date.now();
  const record = {
    id: 'current_identity',
    version: 1,
    userId: userId.trim(),
    publicKeySpki,
    fingerprintHex,
    privateKeyJwk,
    publicKeyJwk,
    createdAt: customMetadata.createdAt || now,
    updatedAt: now,
    metadata: customMetadata,
  };

  // 1. Try persisting to IndexedDB (stores native CryptoKey objects directly alongside metadata)
  let savedInIdb = false;
  try {
    await idbSet({
      ...record,
      rawPrivateKey: keyPair.privateKey,
      rawPublicKey: keyPair.publicKey,
    });
    savedInIdb = true;
  } catch (err) {
    // Fall back if IndexedDB is blocked (e.g. private mode)
  }

  // 2. Persist to LocalStorage (as serialized JSON)
  let savedInLocalStorage = false;
  if (isLocalStorageAvailable() && privateKeyJwk) {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(record));
      savedInLocalStorage = true;
    } catch (err) {
      console.warn('Failed to persist identity in localStorage:', err);
    }
  }

  // 3. Keep in memory store
  MEMORY_STORE.set('current_identity', {
    ...record,
    rawPrivateKey: keyPair.privateKey,
    rawPublicKey: keyPair.publicKey,
  });

  return {
    ok: true,
    userId: record.userId,
    publicKeySpki,
    fingerprintHex,
    savedInIdb,
    savedInLocalStorage,
  };
}

/**
 * Loads the persisted identity key pair from browser storage.
 * Prioritizes IndexedDB, falling back to LocalStorage or Memory.
 * 
 * @returns {Promise<Object|null>} { userId, publicKey, privateKey, publicKeySpki, fingerprintHex, createdAt, storageBackend }
 */
export async function loadIdentityKeyPair() {
  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;

  // 1. Check IndexedDB
  try {
    const idbRecord = await idbGet('current_identity');
    if (idbRecord && idbRecord.userId) {
      const { privateKey, publicKey } = await reconstructKeys({
        privateKeyJwk: idbRecord.privateKeyJwk,
        publicKeyJwk: idbRecord.publicKeyJwk,
        publicKeySpki: idbRecord.publicKeySpki,
        rawPrivateKey: idbRecord.rawPrivateKey,
        rawPublicKey: idbRecord.rawPublicKey,
      });

      if (privateKey && publicKey) {
        // Quick self-check to ensure keypair is functional
        const testData = new TextEncoder().encode('pcr_identity_self_test');
        const testSig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, testData);
        const isValid = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, testSig, testData);

        if (isValid) {
          return {
            userId: idbRecord.userId,
            publicKey,
            privateKey,
            publicKeySpki: idbRecord.publicKeySpki,
            fingerprintHex: idbRecord.fingerprintHex,
            createdAt: idbRecord.createdAt,
            storageBackend: 'indexeddb',
          };
        }
      }
    }
  } catch {
    // Continue to LocalStorage fallback
  }

  // 2. Check LocalStorage fallback
  if (isLocalStorageAvailable()) {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        const lsRecord = JSON.parse(raw);
        if (lsRecord && lsRecord.userId && (lsRecord.privateKeyJwk || lsRecord.privateKey)) {
          const { privateKey, publicKey } = await reconstructKeys({
            privateKeyJwk: lsRecord.privateKeyJwk,
            publicKeyJwk: lsRecord.publicKeyJwk,
            publicKeySpki: lsRecord.publicKeySpki,
          });

          if (privateKey && publicKey) {
            const testData = new TextEncoder().encode('pcr_identity_self_test');
            const testSig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, testData);
            const isValid = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, testSig, testData);

            if (isValid) {
              return {
                userId: lsRecord.userId,
                publicKey,
                privateKey,
                publicKeySpki: lsRecord.publicKeySpki,
                fingerprintHex: lsRecord.fingerprintHex,
                createdAt: lsRecord.createdAt,
                storageBackend: 'localstorage',
              };
            }
          }
        }
      }
    } catch (err) {
      console.warn('Error loading identity from localStorage:', err);
    }
  }

  // 3. Check Memory fallback
  const memRecord = MEMORY_STORE.get('current_identity');
  if (memRecord && memRecord.userId) {
    const { privateKey, publicKey } = await reconstructKeys({
      privateKeyJwk: memRecord.privateKeyJwk,
      publicKeyJwk: memRecord.publicKeyJwk,
      publicKeySpki: memRecord.publicKeySpki,
      rawPrivateKey: memRecord.rawPrivateKey,
      rawPublicKey: memRecord.rawPublicKey,
    });
    if (privateKey && publicKey) {
      return {
        userId: memRecord.userId,
        publicKey,
        privateKey,
        publicKeySpki: memRecord.publicKeySpki,
        fingerprintHex: memRecord.fingerprintHex,
        createdAt: memRecord.createdAt,
        storageBackend: 'memory',
      };
    }
  }

  return null;
}

/**
 * Seamless loader: Retrieves existing identity from storage, or creates and saves a fresh one.
 * 
 * @param {Object} [options]
 * @param {string} [options.userId] User ID to assign if a new keypair is generated
 * @param {boolean} [options.forceRotate] If true, generates a fresh keypair and overwrites storage
 * @returns {Promise<Object>} { userId, publicKey, privateKey, publicKeySpki, fingerprintHex, isNew }
 */
export async function loadOrCreateIdentityKeyPair({ userId, forceRotate = false } = {}) {
  if (!forceRotate) {
    const existing = await loadIdentityKeyPair();
    if (existing) {
      return {
        ...existing,
        isNew: false,
      };
    }
  }

  // Generate new extractable keypair so it can be safely stored and backed up
  const newKeyPair = await generateIdentityKeyPair({ extractable: true });
  const targetUserId = (userId && typeof userId === 'string' && userId.trim())
    ? userId.trim()
    : generateUniqueUserId();

  await saveIdentityKeyPair({
    userId: targetUserId,
    keyPair: newKeyPair,
  });

  return {
    userId: targetUserId,
    publicKey: newKeyPair.publicKey,
    privateKey: newKeyPair.privateKey,
    publicKeySpki: newKeyPair.publicKeySpki,
    fingerprintHex: newKeyPair.fingerprintHex,
    createdAt: Date.now(),
    isNew: true,
  };
}

/**
 * Removes the persisted identity from all storage backends (logout / identity purge)
 */
export async function clearIdentityKeyPair() {
  let clearedIdb = false;
  try {
    await idbDelete('current_identity');
    clearedIdb = true;
  } catch {}

  let clearedLs = false;
  if (isLocalStorageAvailable()) {
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      clearedLs = true;
    } catch {}
  }

  MEMORY_STORE.delete('current_identity');

  return {
    ok: true,
    clearedIdb,
    clearedLs,
  };
}

/**
 * Rotates the cryptographic identity key: generates a brand new keypair and overwrites storage.
 */
export async function rotateIdentityKeyPair({ userId } = {}) {
  return await loadOrCreateIdentityKeyPair({ userId, forceRotate: true });
}

/**
 * Exports portable identity backup payload (JSON string or object)
 */
export async function exportIdentityBackup() {
  const current = await loadIdentityKeyPair();
  if (!current) {
    throw new Error('No identity keypair found to export');
  }

  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;

  let privateKeyJwk = null;
  if (current.privateKey.extractable) {
    privateKeyJwk = await subtle.exportKey('jwk', current.privateKey);
  }

  const publicKeyJwk = await subtle.exportKey('jwk', current.publicKey);

  return {
    version: 1,
    app: 'TeaRoom',
    type: 'identity_backup',
    userId: current.userId,
    publicKeySpki: current.publicKeySpki,
    fingerprintHex: current.fingerprintHex,
    privateKeyJwk,
    publicKeyJwk,
    exportedAt: Date.now(),
  };
}

/**
 * Imports identity backup and saves to persistent browser storage
 */
export async function importIdentityBackup(backup) {
  if (!backup || typeof backup !== 'object') {
    throw new Error('Invalid identity backup payload');
  }
  if (!backup.userId || (!backup.privateKeyJwk && !backup.privateKey)) {
    throw new Error('Identity backup missing required userId or privateKey');
  }

  const cryptoObj = getCrypto();
  const subtle = cryptoObj.subtle;

  const privateKey = await subtle.importKey(
    'jwk',
    backup.privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign']
  );

  let publicKey = null;
  if (backup.publicKeyJwk) {
    publicKey = await subtle.importKey(
      'jwk',
      backup.publicKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify']
    );
  } else if (backup.publicKeySpki) {
    publicKey = await subtle.importKey(
      'spki',
      base64ToBytes(backup.publicKeySpki),
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify']
    );
  }

  if (!publicKey) {
    throw new Error('Could not reconstruct public key from backup');
  }

  // Derive publicKeySpki and fingerprint
  const spkiBuffer = await subtle.exportKey('spki', publicKey);
  const spkiBytes = new Uint8Array(spkiBuffer);
  const publicKeySpki = bytesToBase64(spkiBytes);

  const fpBuffer = await subtle.digest('SHA-256', spkiBytes);
  const fingerprintHex = Array.from(new Uint8Array(fpBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

  const keyPair = {
    privateKey,
    publicKey,
    publicKeySpki,
    fingerprintHex,
  };

  await saveIdentityKeyPair({
    userId: backup.userId,
    keyPair,
    customMetadata: { importedAt: Date.now() },
  });

  return {
    userId: backup.userId,
    publicKey,
    privateKey,
    publicKeySpki,
    fingerprintHex,
    isImported: true,
  };
}

/**
 * Generates random user identifier fallback
 */
function generateUniqueUserId() {
  const cryptoObj = getCrypto();
  if (cryptoObj && cryptoObj.getRandomValues) {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(2));
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    return `USR-${hex}`;
  }
  return `USR-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}
