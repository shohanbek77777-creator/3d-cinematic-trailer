// Real GLB / GLTF import: local files (incl. multi-file .gltf + .bin + textures),
// drag & drop (files and folders) and direct URLs (Google Drive / Dropbox / GitHub aware).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { uid } from '../anim/math.js';

let dracoLoader = null;
let ktx2Loader = null;

function mimeFor(name) {
  const ext = name.split('.').pop().toLowerCase();
  return (
    {
      glb: 'model/gltf-binary',
      gltf: 'model/gltf+json',
      bin: 'application/octet-stream',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      ktx2: 'image/ktx2',
      avif: 'image/avif',
    }[ext] || 'application/octet-stream'
  );
}

export function isModelFile(name) {
  return /\.(glb|gltf)$/i.test(name);
}

function baseName(p) {
  return decodeURIComponent(p.split(/[\\/]/).pop().split('?')[0].split('#')[0]);
}

export function createGLTFLoader(manager, renderer) {
  const loader = new GLTFLoader(manager);
  if (!dracoLoader) {
    // three r187 resolves its bundled Draco / Basis decoders via import.meta.url (works offline + in Vite builds)
    dracoLoader = new DRACOLoader();
  }
  loader.setDRACOLoader(dracoLoader);
  if (renderer) {
    if (!ktx2Loader) {
      ktx2Loader = new KTX2Loader();
      ktx2Loader.detectSupport(renderer);
    }
    loader.setKTX2Loader(ktx2Loader);
  }
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

/**
 * Parse an asset record into a glTF result.
 * record = { id, name, main, files: [{ name, type, buffer }] }
 */
export async function parseAssetRecord(record, renderer) {
  const urlMap = new Map();
  const blobUrls = [];
  for (const f of record.files) {
    const url = URL.createObjectURL(new Blob([f.buffer], { type: f.type || mimeFor(f.name) }));
    blobUrls.push(url);
    urlMap.set(f.name.toLowerCase(), url);
    urlMap.set(baseName(f.name).toLowerCase(), url);
  }
  const manager = new THREE.LoadingManager();
  const missing = [];
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    const key = baseName(url).toLowerCase();
    const full = decodeURIComponent(url.replace(/^\.\//, '')).toLowerCase();
    const hit = urlMap.get(full) || urlMap.get(key);
    if (hit) return hit;
    if (/^https?:/i.test(url)) return url;
    missing.push(baseName(url));
    return url;
  });
  const loader = createGLTFLoader(manager, renderer);
  const main = record.files.find((f) => f.name === record.main) || record.files.find((f) => isModelFile(f.name));
  if (!main) throw new Error('No .glb or .gltf file in this asset');
  try {
    const gltf = await loader.parseAsync(main.buffer, '');
    gltf.missingFiles = missing;
    return gltf;
  } catch (e) {
    const extra = missing.length ? ` Missing referenced files: ${missing.join(', ')} — drop them together with the .gltf.` : '';
    throw new Error(`Could not parse ${record.name}: ${e.message || e}.${extra}`);
  } finally {
    // keep blob urls alive briefly for textures that decode asynchronously
    setTimeout(() => blobUrls.forEach((u) => URL.revokeObjectURL(u)), 15000);
  }
}

/** Group dropped/selected files into model asset records. */
export async function recordsFromFiles(fileList) {
  const files = Array.from(fileList);
  const models = files.filter((f) => isModelFile(f.name));
  if (!models.length) throw new Error('No .glb or .gltf file found. Supported formats: GLB, GLTF (+ .bin and textures).');
  const others = files.filter((f) => !isModelFile(f.name));
  const otherBuffers = await Promise.all(others.map(async (f) => ({ name: f.relativePath || f.name, type: f.type || mimeFor(f.name), buffer: await f.arrayBuffer() })));
  const records = [];
  for (const m of models) {
    const buffer = await m.arrayBuffer();
    validateModelBuffer(buffer, m.name);
    const isGltf = /\.gltf$/i.test(m.name);
    const fileEntries = [{ name: m.name, type: mimeFor(m.name), buffer }];
    if (isGltf) fileEntries.push(...otherBuffers);
    records.push({ id: uid('asset'), name: m.name, main: m.name, files: fileEntries, size: fileEntries.reduce((s, f) => s + f.buffer.byteLength, 0), source: 'file' });
  }
  return records;
}

export function validateModelBuffer(buffer, name = 'file') {
  const head = new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength));
  const magic = String.fromCharCode(...head.slice(0, 4));
  if (magic === 'glTF') return 'glb';
  const text = new TextDecoder().decode(head).trim();
  if (text.startsWith('{')) return 'gltf';
  if (text.toLowerCase().startsWith('<!doc') || text.toLowerCase().startsWith('<htm'))
    throw new Error(`${name}: the server returned an HTML page instead of a 3D file (link is not a direct download, needs login, or is behind a virus-scan / confirmation page).`);
  throw new Error(`${name}: not a valid GLB/GLTF file.`);
}

/** Walk dropped DataTransfer items, including folders. */
export async function filesFromDataTransfer(dt) {
  const items = dt.items ? Array.from(dt.items) : [];
  const entries = items.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length) return Array.from(dt.files || []);
  const out = [];
  const readEntry = (entry, path = '') =>
    new Promise((resolve) => {
      if (entry.isFile) {
        entry.file(
          (f) => {
            f.relativePath = path + f.name;
            out.push(f);
            resolve();
          },
          () => resolve()
        );
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const all = [];
        const readBatch = () =>
          reader.readEntries(async (batch) => {
            if (!batch.length) {
              for (const e of all) await readEntry(e, path + entry.name + '/');
              resolve();
            } else {
              all.push(...batch);
              readBatch();
            }
          }, () => resolve());
        readBatch();
      } else resolve();
    });
  for (const e of entries) await readEntry(e);
  return out;
}

// ------------------------------------------------------------------ URL import
export function normalizeModelURL(raw) {
  const url = raw.trim();
  const candidates = [];
  let note = '';
  const drive = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([\w-]{10,})/) || url.match(/[?&]id=([\w-]{20,})/);
  if (/drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com/.test(url) && drive) {
    const id = drive[1];
    candidates.push(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`);
    candidates.push(`https://drive.google.com/uc?export=download&id=${id}`);
    note = 'google-drive';
  } else if (/dropbox\.com/.test(url)) {
    candidates.push(url.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace(/[?&]dl=0/, '').replace(/[?&]raw=1/, ''));
    candidates.push(url.replace(/dl=0/, 'dl=1'));
    note = 'dropbox';
  } else if (/github\.com\/[^/]+\/[^/]+\/blob\//.test(url)) {
    candidates.push(url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/'));
    note = 'github';
  } else {
    candidates.push(url);
  }
  return { candidates, note };
}

async function fetchBuffer(url, onProgress) {
  const res = await fetch(url, { mode: 'cors', redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !onProgress) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out.buffer;
}

export async function recordFromURL(rawUrl, onProgress) {
  const { candidates, note } = normalizeModelURL(rawUrl);
  let lastErr = null;
  for (const url of candidates) {
    try {
      const buffer = await fetchBuffer(url, onProgress);
      const kind = validateModelBuffer(buffer, 'URL');
      let name = baseName(rawUrl.split('?')[0]) || 'model';
      if (!isModelFile(name)) name = (note === 'google-drive' ? 'drive_model' : name || 'model') + (kind === 'glb' ? '.glb' : '.gltf');
      const files = [{ name, type: mimeFor(name), buffer }];
      if (kind === 'gltf') {
        // fetch external resources referenced by relative URIs
        const json = JSON.parse(new TextDecoder().decode(buffer));
        const uris = [...(json.buffers || []), ...(json.images || [])].map((b) => b.uri).filter((u) => u && !u.startsWith('data:'));
        for (const u of uris) {
          const abs = new URL(u, url).href;
          try {
            files.push({ name: decodeURIComponent(u), type: mimeFor(u), buffer: await fetchBuffer(abs) });
          } catch (e) {
            throw new Error(`Referenced file "${u}" could not be downloaded (${e.message}).`);
          }
        }
      }
      return { id: uid('asset'), name, main: name, files, size: files.reduce((s, f) => s + f.buffer.byteLength, 0), source: 'url', url: rawUrl };
    } catch (e) {
      lastErr = e;
    }
  }
  let hint = '';
  if (note === 'google-drive')
    hint =
      ' Google Drive usually blocks direct downloads from other websites (CORS) or shows a confirmation page for large files. Make sure the file is shared as "Anyone with the link", or download it and import it with "Import 3D Model" / drag & drop.';
  else if (lastErr && /Failed to fetch|NetworkError|CORS/i.test(lastErr.message))
    hint = ' The server does not allow cross-origin downloads (CORS). Download the file and import it from your computer instead.';
  throw new Error(`Could not load model from URL: ${lastErr ? lastErr.message : 'unknown error'}.${hint}`);
}
