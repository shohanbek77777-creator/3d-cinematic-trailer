// Project data model. Everything that defines a trailer lives in this plain JSON
// object so it can be saved, loaded, autosaved and snapshotted for undo/redo.
import { uid } from '../anim/math.js';

export const PROJECT_VERSION = 1;
export const DEMO_ASSET_ID = 'builtin_demo_car';

export function defaultEffects() {
  return {
    bloom: { enabled: true, strength: 0.6, radius: 0.5, threshold: 1.6 },
    dof: { enabled: true, aperture: 1.0, maxBlur: 12, focusOffset: 0 },
    grading: {
      enabled: true,
      exposure: 0,
      contrast: 1.08,
      saturation: 1.05,
      temperature: 0.05,
      tint: 0,
      shadowsColor: '#1f4a5c',
      highlightsColor: '#ffb27a',
      splitAmount: 0.22,
      vignette: 0.4,
      grain: 0.035,
      chromatic: 0.6,
    },
    motionBlur: { enabled: true, shutter: 180, previewSamples: 1, exportSamples: 6 },
    lensFlare: { enabled: true, intensity: 0.8, streak: 0.7, ghosts: 0.6 },
    fog: { enabled: true, density: 0.0012, color: '#d9b38c' },
    particles: {
      dust: { enabled: true, amount: 1, size: 1, color: '#c9a37a' },
      smoke: { enabled: true, amount: 1, opacity: 0.55, color: '#8c8782' },
      sparks: { enabled: true, amount: 1, color: '#ffb04a' },
      ambient: { enabled: true, amount: 1 },
    },
    letterbox: { enabled: true, aspect: 2.39 },
  };
}

export function defaultLighting() {
  return {
    sunElevation: 14,
    sunAzimuth: 210,
    sunIntensity: 3.2,
    sunColor: '#ffd8a8',
    ambient: 0.6,
    envIntensity: 1.0,
    exposure: 0.85,
    shadows: true,
    headlights: false,
  };
}

export function defaultSetup() {
  return {
    kind: 'auto', // auto | vehicle | prop
    forwardAxis: 'auto', // auto | +Z | -Z | +X | -X
    upAxis: '+Y', // +Y | +Z | -Z
    targetLength: 0, // 0 = keep detected size (auto-corrects implausible units)
    wheelSpin: true,
    steering: true,
    suspension: true,
    headlights: 'auto', // auto | on | off
    dust: true,
    animationClip: '', // glTF embedded animation to play
    visible: true,
  };
}

export function createActor(asset, overrides = {}) {
  return {
    id: uid('actor'),
    name: asset.name.replace(/\.(glb|gltf)$/i, ''),
    assetId: asset.id,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    setup: defaultSetup(),
    materials: {},
    path: { interpolation: 'smooth', keys: [] },
    ...overrides,
  };
}

export function createProject() {
  return {
    version: PROJECT_VERSION,
    id: uid('proj'),
    name: 'Untitled Trailer',
    duration: 45,
    fps: 30,
    environment: { id: 'desert', seed: 7 },
    lighting: defaultLighting(),
    effects: defaultEffects(),
    assets: [{ id: DEMO_ASSET_ID, name: 'Demo Vehicle', source: 'builtin', size: 0 }],
    actors: [],
    camera: { clips: [] },
    fx: { clips: [] },
    markers: [],
    export: { width: 1920, height: 1080, fps: 30, format: 'mp4', start: 0, end: 45, quality: 'high' },
  };
}

/** Fill in any fields missing from older / hand-edited project files. */
export function normalizeProject(p) {
  const d = createProject();
  const out = { ...d, ...p };
  out.environment = { ...d.environment, ...(p.environment || {}) };
  out.lighting = { ...d.lighting, ...(p.lighting || {}) };
  const fx = defaultEffects();
  out.effects = {};
  for (const k of Object.keys(fx)) out.effects[k] = { ...fx[k], ...((p.effects || {})[k] || {}) };
  out.effects.particles = {};
  for (const k of Object.keys(fx.particles)) out.effects.particles[k] = { ...fx.particles[k], ...(((p.effects || {}).particles || {})[k] || {}) };
  out.assets = Array.isArray(p.assets) ? p.assets : d.assets;
  if (!out.assets.find((a) => a.id === DEMO_ASSET_ID)) out.assets.unshift(d.assets[0]);
  out.actors = (p.actors || []).map((a) => ({
    ...a,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, ...(a.transform || {}) },
    setup: { ...defaultSetup(), ...(a.setup || {}) },
    materials: a.materials || {},
    path: { interpolation: 'smooth', keys: [], ...(a.path || {}) },
  }));
  out.camera = { clips: ((p.camera || {}).clips || []).map((c) => ({ params: {}, transition: 'cut', blend: 0.6, ...c })) };
  out.fx = { clips: (p.fx || {}).clips || [] };
  out.markers = p.markers || [];
  out.export = { ...d.export, ...(p.export || {}) };
  out.version = PROJECT_VERSION;
  return out;
}

export function cloneProject(p) {
  return JSON.parse(JSON.stringify(p));
}
