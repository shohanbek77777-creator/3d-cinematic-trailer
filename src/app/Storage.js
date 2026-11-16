// Persistence: IndexedDB for model binaries, localStorage for project JSON + prefs.
const DB_NAME = 'cinematic-trailer-studio';
const DB_VERSION = 1;
const STORE = 'assets';
const AUTOSAVE_KEY = 'cts.autosave.v1';
const PREFS_KEY = 'cts.prefs.v1';

let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let result;
        Promise.resolve(fn(store)).then((r) => (result = r));
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

function reqP(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

/** record: { id, name, main, files: [{ name, type, buffer: ArrayBuffer }] } */
export async function putAsset(record) {
  try {
    await tx('readwrite', (s) => reqP(s.put(record)));
    return true;
  } catch (e) {
    console.warn('[storage] could not persist asset', e);
    return false;
  }
}

export async function getAsset(id) {
  try {
    return await tx('readonly', (s) => reqP(s.get(id)));
  } catch (e) {
    console.warn('[storage] read failed', e);
    return null;
  }
}

export async function deleteAsset(id) {
  try {
    await tx('readwrite', (s) => reqP(s.delete(id)));
  } catch (e) {
    console.warn(e);
  }
}

export function saveAutosave(project) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
    return true;
  } catch (e) {
    console.warn('[storage] autosave failed', e);
    return false;
  }
}

export function loadAutosave() {
  try {
    const s = localStorage.getItem(AUTOSAVE_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export function clearAutosave() {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {}
}

export function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch {
    return {};
  }
}
export function savePrefs(p) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {}
}

// ---- base64 helpers for embedding model binaries in project files ----
export function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(out);
}
export function base64ToBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
