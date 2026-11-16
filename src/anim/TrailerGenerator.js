// Automatic 45-second trailer: drive path along the environment road, a cut list
// of cinematic shots and timed effects, all scaled to the actual model dimensions.
import * as THREE from 'three';
import { uid, clamp } from './math.js';

export const SECTIONS = [
  { t: 0, label: 'Intro' },
  { t: 5, label: 'Reveal' },
  { t: 12, label: 'Action' },
  { t: 22, label: 'Intense Action' },
  { t: 35, label: 'Final Hero Shot' },
];

/** Speed profile (fraction of cruise speed) keyed by time on the 45 s master timeline. */
function speedProfile() {
  return [
    [0, 0.55],
    [3.5, 0.45],
    [6.5, 0.12],
    [7.6, 0],
    [12.0, 0],
    [13.2, 0.45],
    [15.5, 0.9],
    [19, 1.0],
    [22, 1.05],
    [24.5, 1.45],
    [28.8, 1.5],
    [30.0, 0.85],
    [31.2, 0.9],
    [33.5, 1.4],
    [35.5, 1.15],
    [37.6, 0.35],
    [38.8, 0],
    [45, 0],
  ];
}

function sampleProfile(prof, t) {
  if (t <= prof[0][0]) return prof[0][1];
  for (let i = 0; i < prof.length - 1; i++) {
    const [t0, v0] = prof[i], [t1, v1] = prof[i + 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      const s = k * k * (3 - 2 * k); // smooth between control points
      return v0 + (v1 - v0) * s;
    }
  }
  return prof[prof.length - 1][1];
}

/**
 * @param project   project (mutated)
 * @param engine    Engine (environment road + actor runtimes must be ready)
 * @param opts      { actorId, style: 'action'|'elegant', duration, title, subtitle, tagline }
 */
export function generateTrailer(project, engine, opts = {}) {
  const actorData = project.actors.find((a) => a.id === opts.actorId) || project.actors[0];
  if (!actorData) throw new Error('Add or import a 3D model first.');
  const runtime = engine.actors.get(actorData.id);
  if (!runtime) throw new Error('Model is still loading.');
  const env = engine.env;
  if (!env?.curve) throw new Error('Environment not ready.');

  const D = clamp(opts.duration || 45, 10, 180);
  const f = D / 45;
  const T = (t) => +(t * f).toFixed(3);
  const style = opts.style || 'action';
  const elegant = style === 'elegant';
  const isVehicle = runtime.kind === 'vehicle';
  const { length: L, height: H } = runtime.dims;
  const heavy = L > 6.5 || H > 2.6;
  // cruise speed adapted to the model: sports car ~ 26 m/s, heavy vehicles ~ 12 m/s
  let cruise = heavy ? clamp(14 - (L - 6.5) * 0.4, 8, 14) : clamp(26 * Math.sqrt(clamp(L / 4.6, 0.4, 1.4)), 12, 32);
  if (elegant) cruise *= 0.75;

  // ---------------------------------------------------------------- path
  const curve = env.curve;
  const roadLen = curve.getLength();
  const keys = [];
  // put the hero first in the actor list (it drives the camera)
  const idx = project.actors.indexOf(actorData);
  if (idx > 0) {
    project.actors.splice(idx, 1);
    project.actors.unshift(actorData);
  }
  if (isVehicle) {
    const prof = speedProfile();
    // integrate distance on the master timeline, then stretch by f
    const dt = 0.02;
    const distAt = [];
    let d = 0;
    for (let t = 0; t <= 45 + 1e-6; t += dt) {
      distAt.push([t, d]);
      d += sampleProfile(prof, t) * cruise * f * dt;
    }
    let total = d;
    const usable = roadLen - 80;
    let scale = 1;
    if (total > usable) {
      scale = usable / total;
      total = usable;
    }
    const d0 = clamp((roadLen - total) * 0.5, 30, roadLen);
    const lane = env.roadWidth * 0.2;
    const keyTimes = new Set([0, 3.5, 7.6, 12.0, 13.6, 15.5, 17.5, 19.5, 22, 24, 26, 28, 29.4, 30.6, 32, 33.5, 35.5, 37, 38.8, 45]);
    const tan = new THREE.Vector3();
    for (const tm of [...keyTimes].sort((a, b) => a - b)) {
      const row = distAt[Math.min(distAt.length - 1, Math.round(tm / dt))];
      const dist = d0 + row[1] * scale;
      const u = clamp(dist / roadLen, 0, 1);
      const p = curve.getPointAt(u);
      curve.getTangentAt(u, tan);
      const right = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
      // in "Intense" weave across the lanes a little
      const weave = tm > 24 && tm < 34 ? Math.sin(tm * 0.9) * env.roadWidth * 0.12 : 0;
      p.addScaledVector(right, -lane + weave);
      keys.push({ id: uid('key'), t: T(tm), p: [+p.x.toFixed(3), 0, +p.z.toFixed(3)] });
    }
    actorData.path = { interpolation: 'smooth', keys };
    actorData.transform.position = [...keys[0].p];
    actorData.transform.rotation = [0, 0, 0];
  } else {
    // showcase object: park it at the middle of the road
    const p = curve.getPointAt(0.5);
    const tan = curve.getTangentAt(0.5);
    actorData.path = { interpolation: 'smooth', keys: [] };
    actorData.transform.position = [p.x, 0, p.z];
    actorData.transform.rotation = [0, (Math.atan2(tan.x, tan.z) * 180) / Math.PI + 30, 0];
  }
  // park other actors near the final hero position
  const finalPos = isVehicle ? keys[keys.length - 1].p : actorData.transform.position;
  project.actors.slice(1).forEach((a, i) => {
    if (a.path.keys.length) return;
    const ang = (i % 2 ? -1 : 1) * (0.9 + i * 0.25);
    const r = runtime.size * (2.2 + i * 0.6);
    a.transform.position = [finalPos[0] + Math.sin(ang) * r, 0, finalPos[2] + Math.cos(ang) * r];
  });

  // ---------------------------------------------------------------- camera cut list
  const shot = (start, end, type, params = {}, transition = 'cut', blend = 0.6) => ({
    id: uid('cam'),
    start: T(start),
    end: T(end),
    shot: type,
    target: actorData.id,
    transition,
    blend: +(blend * f).toFixed(3),
    params: elegant && params.shake ? { ...params, shake: params.shake * 0.4 } : params,
  });
  let clips;
  if (isVehicle) {
    clips = [
      shot(0, 5, 'wide', { distance: 6.5, height: 1.0, side: 1, dolly: 0.25, anchor: 1, fovStart: 34, fovEnd: 28, shake: 0.03 }),
      shot(5, 7.4, 'closeUp', { focus: 'front', side: 1, distance: 0.5, slide: 0.45, fovStart: 26, fovEnd: 22 }),
      shot(7.4, 9.4, 'closeUp', { focus: 'wheel', side: -1, distance: 0.42, slide: 0.3, fovStart: 24, fovEnd: 22 }),
      shot(9.4, 12, 'lowAngle', { side: 1, distance: 1.3, angle: 28, orbit: 26, track: 0, fovStart: 30, fovEnd: 26 }),
      shot(12, 14.6, 'rearTracking', { distance: 1.25, height: 0.2, side: 0.4, drift: 0.5, shake: 0.35 }),
      shot(14.6, 17.6, 'sideTracking', { side: -1, distance: 1.2, height: 0.25, slide: 0.8, shake: 0.25 }),
      shot(17.6, 20, 'frontTracking', { side: 0.4, distance: 1.4, height: 0.35, drift: 0.4, shake: 0.3 }),
      shot(20, 22, 'orbit', { distance: 1.5, height: 0.35, angle: 110, orbitSpeed: 55, side: 1, shake: 0.15 }),
      shot(22, 24, 'driveBy', { side: 1, distance: 0.75, height: 0.1, anchor: 0.6, fovStart: 30, fovEnd: 30, shake: 0.2 }),
      shot(24, 26, 'rearTracking', { distance: 1.05, height: 0.05, side: -0.5, drift: 0.6, shake: 0.7, fovStart: 40, fovEnd: 34 }),
      shot(26, 27.6, 'closeUp', { focus: 'wheel', side: 1, distance: 0.48, slide: 0.15, shake: 0.5, fovStart: 30, fovEnd: 26 }),
      shot(27.6, 29.4, 'aerial', { distance: 2.0, height: 1.5, side: 1, orbitSpeed: 14, fovStart: 42, fovEnd: 36 }),
      shot(29.4, 31.2, 'frontTracking', { side: -0.6, distance: 1.1, height: 0.1, drift: 0.2, shake: 0.65, fovStart: 30, fovEnd: 26 }),
      shot(31.2, 33.5, 'sideTracking', { side: 1, distance: 0.95, height: 0.18, slide: 1.2, shake: 0.55 }),
      shot(33.5, 35.4, 'driveBy', { side: -1, distance: 0.7, height: 0.08, anchor: 0.5, shake: 0.25 }),
      shot(35.4, 38.8, 'rearTracking', { distance: 1.5, height: 0.35, side: 0.8, drift: -0.4, shake: 0.25 }),
      shot(38.8, 45, 'hero', { distance: 2.1, height: 0.1, angle: 34, dolly: 0.32, rise: 0.22, orbit: 14, fovStart: 32, fovEnd: 24 }, 'blend', 1.0),
    ];
  } else {
    clips = [
      shot(0, 5, 'wide', { distance: 4.5, height: 1.0, dolly: 0.3, anchor: 0, shake: 0.02 }),
      shot(5, 8, 'closeUp', { focus: 'front', distance: 0.5, slide: 0.5 }),
      shot(8, 12, 'lowAngle', { distance: 1.2, angle: 20, orbit: 40, track: 0 }),
      shot(12, 17, 'orbit', { distance: 1.4, height: 0.4, orbitSpeed: 30 }),
      shot(17, 22, 'closeUp', { focus: 'side', distance: 0.55, slide: 0.6, side: -1 }),
      shot(22, 26, 'orbit', { distance: 1.2, height: 0.15, orbitSpeed: -45, angle: 200 }),
      shot(26, 30, 'aerial', { distance: 1.4, height: 1.3, orbitSpeed: 20 }),
      shot(30, 35, 'closeUp', { focus: 'top', distance: 0.6, slide: 0.5 }),
      shot(35, 45, 'hero', { distance: 1.9, height: 0.1, angle: 30, dolly: 0.3, rise: 0.25, orbit: 20 }, 'blend', 1.2),
    ];
  }
  if (elegant) {
    // fewer hard cuts: blend selected transitions
    clips.forEach((c, i) => {
      if (i > 0 && i % 3 === 0) {
        c.transition = 'blend';
        c.blend = +(0.8 * f).toFixed(3);
      }
    });
  }
  project.camera.clips = clips;

  // ---------------------------------------------------------------- effects + titles
  const name = (opts.title || actorData.name || 'Untitled').trim();
  const fx = (start, end, type, extra = {}) => ({ id: uid('fx'), type, start: T(start), end: T(end), intensity: 1, ...extra });
  const fxClips = [
    fx(0, 1.6, 'fadeIn'),
    fx(1.0, 4.6, 'title', { text: opts.tagline || 'Born to dominate', subtitle: '', style: 'cinematic' }),
  ];
  if (isVehicle) {
    fxClips.push(
      fx(6.4, 9.0, 'smoke', { intensity: 0.45, target: actorData.id }),
      fx(12, 14.2, 'smoke', { intensity: 1, target: actorData.id }),
      fx(12, 22, 'dust', { intensity: 0.45 }),
      fx(22, 22.35, 'flash', { intensity: 0.35 }),
      fx(22, 35, 'dust', { intensity: 1 }),
      fx(29.2, 31.0, 'smoke', { intensity: 0.9, target: actorData.id }),
      fx(29.4, 30.8, 'sparks', { intensity: 1, target: actorData.id }),
      fx(36.6, 40.5, 'smoke', { intensity: 0.7, target: actorData.id }),
      fx(37.0, 38.6, 'sparks', { intensity: 0.5, target: actorData.id })
    );
  } else {
    fxClips.push(fx(5, 12, 'smoke', { intensity: 0.5, target: actorData.id }), fx(22, 22.35, 'flash', { intensity: 0.3 }), fx(22, 35, 'dust', { intensity: 0.6 }));
  }
  fxClips.push(
    fx(14.5, 18.5, 'title', { text: name, subtitle: opts.subtitle ? '' : 'Engineered for power', style: 'lower' }),
    fx(39.4, 44.6, 'title', { text: name, subtitle: opts.subtitle || 'Coming soon', style: 'hero' }),
    fx(43.6, 45, 'fadeOut')
  );
  project.fx.clips = fxClips;
  project.markers = SECTIONS.map((s) => ({ t: T(s.t), label: s.label }));
  project.duration = D;
  project.export.start = 0;
  project.export.end = D;
  if (!project.name || project.name === 'Untitled Trailer') project.name = `${name} — Trailer`;
  return { cruise, heavy, isVehicle };
}
