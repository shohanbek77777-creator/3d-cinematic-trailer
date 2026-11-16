// Cinematic camera shot presets. Every shot is a pure function of time and the
// target actor's evaluated state, so preview and offline export match exactly.
import * as THREE from 'three';
import { clamp, lerp, ease, noise1, DEG } from './math.js';

export const SHOT_TYPES = {
  wide: { label: 'Wide Cinematic', icon: 'wide', defaults: { distance: 5, height: 0.9, side: 1, fovStart: 32, fovEnd: 28, dolly: 0.18, anchor: 1, shake: 0.05, roll: 0 } },
  lowAngle: { label: 'Low Angle', icon: 'low', defaults: { distance: 1.25, height: 0.12, side: 1, fovStart: 30, fovEnd: 26, orbit: 18, angle: 35, track: 1, shake: 0.1, roll: 0 } },
  frontTracking: { label: 'Front Tracking', icon: 'front', defaults: { distance: 1.35, height: 0.38, side: 0.25, fovStart: 34, fovEnd: 30, drift: 0.25, shake: 0.25, roll: 0 } },
  sideTracking: { label: 'Side Tracking', icon: 'side', defaults: { distance: 1.25, height: 0.3, side: 1, fovStart: 30, fovEnd: 30, slide: 0.6, shake: 0.25, roll: 0 } },
  rearTracking: { label: 'Rear Tracking', icon: 'rear', defaults: { distance: 1.35, height: 0.45, side: 0.35, fovStart: 36, fovEnd: 32, drift: 0.2, shake: 0.3, roll: 0 } },
  closeUp: { label: 'Close-up', icon: 'close', defaults: { distance: 0.45, height: 0.0, side: 1, fovStart: 26, fovEnd: 22, slide: 0.35, focus: 'front', shake: 0.08, roll: 0 } },
  orbit: { label: 'Orbit', icon: 'orbit', defaults: { distance: 1.5, height: 0.5, side: 1, fovStart: 32, fovEnd: 30, angle: 30, orbitSpeed: 22, shake: 0.05, roll: 0 } },
  hero: { label: 'Hero Shot', icon: 'hero', defaults: { distance: 1.9, height: 0.16, side: 1, fovStart: 34, fovEnd: 24, angle: 32, dolly: 0.3, rise: 0.25, orbit: 10, shake: 0.02, roll: 0 } },
  driveBy: { label: 'Drive-By', icon: 'driveby', defaults: { distance: 0.9, height: 0.12, side: 1, fovStart: 28, fovEnd: 28, anchor: 0.55, shake: 0.15, roll: 0 } },
  aerial: { label: 'Aerial / Drone', icon: 'aerial', defaults: { distance: 2.2, height: 1.6, side: 1, fovStart: 40, fovEnd: 36, orbitSpeed: 6, shake: 0.06, roll: 0 } },
  custom: { label: 'Custom Keyframes', icon: 'custom', defaults: { fovStart: 35, fovEnd: 35, shake: 0, roll: 0 } },
};

export const CLOSEUP_FOCUS = ['front', 'wheel', 'rear', 'side', 'top'];

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const lookM = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

function basis(st) {
  const fwd = new THREE.Vector3(Math.sin(st.yaw), 0, Math.cos(st.yaw));
  const right = new THREE.Vector3(Math.cos(st.yaw), 0, -Math.sin(st.yaw));
  return { fwd, right };
}

/**
 * @param clip camera clip from the project
 * @param t    global time
 * @param ctx  { actorState(id, time) -> state | null, groundHeight? }
 * @returns {{position, target, fov, roll, focusDistance}}
 */
export function evaluateShot(clip, t, ctx) {
  const def = SHOT_TYPES[clip.shot] || SHOT_TYPES.orbit;
  const p = { ...def.defaults, ...(clip.params || {}) };
  const dur = Math.max(0.01, clip.end - clip.start);
  const u = clamp((t - clip.start) / dur, 0, 1);
  const es = ease.sine(u);
  const cur = ctx.actorState(clip.target, t);
  const out = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: lerp(p.fovStart, p.fovEnd, es), roll: (p.roll || 0) * DEG };
  if (!cur) {
    out.position.set(12, 4, 12);
    out.target.set(0, 1, 0);
    out.focusDistance = out.position.distanceTo(out.target);
    return out;
  }
  const { length: L, width: W, height: H } = cur.dims;
  const S = cur.size;
  const { fwd, right } = basis(cur);
  const center = v1.copy(cur.position).addScaledVector(UP, H * 0.5);
  const side = p.side ?? 1;
  out.target.copy(center);

  switch (clip.shot) {
    case 'wide': {
      const a = ctx.actorState(clip.target, clip.start + dur * p.anchor);
      const b = basis(a);
      const dist = S * p.distance;
      const base = v2.copy(a.position).addScaledVector(b.fwd, dist * 0.75).addScaledVector(b.right, side * dist * 0.65).addScaledVector(UP, S * p.height);
      const toT = v3.copy(center).sub(base).normalize();
      out.position.copy(base).addScaledVector(toT, dist * p.dolly * es);
      break;
    }
    case 'lowAngle': {
      const ref = p.track ? cur : ctx.actorState(clip.target, clip.start);
      const rb = p.track ? { fwd, right } : basis(ref);
      const ang = (p.angle + p.orbit * (u - 0.5)) * DEG * side;
      const dist = S * p.distance;
      out.position
        .copy(ref.position)
        .addScaledVector(rb.fwd, Math.cos(ang) * dist)
        .addScaledVector(rb.right, Math.sin(ang) * dist)
        .addScaledVector(UP, Math.max(0.15, H * p.height));
      out.target.copy(ref.position).addScaledVector(UP, H * 0.62);
      break;
    }
    case 'frontTracking': {
      const dist = S * p.distance * (1 + p.drift * (0.5 - u));
      out.position.copy(cur.position).addScaledVector(fwd, dist).addScaledVector(right, side * W * 0.6).addScaledVector(UP, H * (0.3 + p.height));
      out.target.copy(cur.position).addScaledVector(UP, H * 0.45).addScaledVector(fwd, L * 0.1);
      break;
    }
    case 'sideTracking': {
      const dist = S * p.distance;
      out.position.copy(cur.position).addScaledVector(right, side * (dist + W * 0.5)).addScaledVector(fwd, L * p.slide * (u - 0.5)).addScaledVector(UP, H * (0.2 + p.height));
      out.target.copy(cur.position).addScaledVector(UP, H * 0.45);
      break;
    }
    case 'rearTracking': {
      const dist = S * p.distance * (1 + p.drift * (u - 0.5));
      out.position.copy(cur.position).addScaledVector(fwd, -dist).addScaledVector(right, side * W * 0.6).addScaledVector(UP, H * (0.4 + p.height));
      out.target.copy(cur.position).addScaledVector(fwd, L * 0.4).addScaledVector(UP, H * 0.5);
      break;
    }
    case 'closeUp': {
      const focus = p.focus || 'front';
      const fp = v2.copy(cur.position);
      const camOff = v3.set(0, 0, 0);
      const d = S * p.distance;
      if (focus === 'front') {
        fp.addScaledVector(fwd, L * 0.42).addScaledVector(UP, H * 0.42).addScaledVector(right, side * W * 0.25);
        camOff.addScaledVector(fwd, d * 0.75).addScaledVector(right, side * d * 0.65).addScaledVector(UP, H * 0.05);
      } else if (focus === 'wheel') {
        fp.addScaledVector(fwd, L * 0.3).addScaledVector(right, side * W * 0.5).addScaledVector(UP, H * 0.28);
        camOff.addScaledVector(right, side * d * 0.85).addScaledVector(fwd, d * 0.45).addScaledVector(UP, H * 0.02);
      } else if (focus === 'rear') {
        fp.addScaledVector(fwd, -L * 0.45).addScaledVector(UP, H * 0.55).addScaledVector(right, side * W * 0.2);
        camOff.addScaledVector(fwd, -d * 0.8).addScaledVector(right, side * d * 0.55).addScaledVector(UP, H * 0.08);
      } else if (focus === 'top') {
        fp.addScaledVector(UP, H * 0.95);
        camOff.addScaledVector(UP, d * 0.6).addScaledVector(right, side * d * 0.6).addScaledVector(fwd, d * 0.3);
      } else {
        fp.addScaledVector(UP, H * 0.55).addScaledVector(right, side * W * 0.5);
        camOff.addScaledVector(right, side * d).addScaledVector(fwd, d * 0.1);
      }
      const slide = (u - 0.5) * p.slide * L;
      out.position.copy(fp).add(camOff).addScaledVector(fwd, slide).addScaledVector(UP, H * p.height);
      out.target.copy(fp).addScaledVector(fwd, slide * 0.6);
      break;
    }
    case 'orbit': {
      const ang = (p.angle + p.orbitSpeed * (t - clip.start)) * DEG * side;
      const dist = S * p.distance;
      out.position.copy(cur.position).addScaledVector(fwd, Math.cos(ang) * dist).addScaledVector(right, Math.sin(ang) * dist).addScaledVector(UP, H * 0.2 + S * p.height * 0.5);
      break;
    }
    case 'hero': {
      const ang = (p.angle + p.orbit * (es - 0.5)) * DEG * side;
      const dist = S * p.distance * (1 - p.dolly * es);
      out.position.copy(cur.position).addScaledVector(fwd, Math.cos(ang) * dist).addScaledVector(right, Math.sin(ang) * dist).addScaledVector(UP, Math.max(0.2, H * (p.height + p.rise * es)));
      out.target.copy(cur.position).addScaledVector(UP, H * 0.55);
      break;
    }
    case 'driveBy': {
      const a = ctx.actorState(clip.target, clip.start + dur * p.anchor);
      const b = basis(a);
      out.position.copy(a.position).addScaledVector(b.fwd, L * 0.6).addScaledVector(b.right, side * (W * 0.5 + S * p.distance)).addScaledVector(UP, Math.max(0.2, H * p.height));
      out.target.copy(center);
      break;
    }
    case 'aerial': {
      const ang = (180 - 30 * side + p.orbitSpeed * (t - clip.start)) * DEG;
      const dist = S * p.distance;
      out.position.copy(cur.position).addScaledVector(fwd, Math.cos(ang) * dist).addScaledVector(right, Math.sin(ang) * dist).addScaledVector(UP, S * p.height);
      out.target.copy(cur.position).addScaledVector(fwd, L * 0.6);
      break;
    }
    case 'custom': {
      const keys = (clip.keys || []).slice().sort((a, b) => a.u - b.u);
      if (keys.length === 0) {
        out.position.copy(cur.position).addScaledVector(fwd, S * 1.5).addScaledVector(right, S).addScaledVector(UP, S * 0.4);
      } else if (keys.length === 1) {
        out.position.fromArray(keys[0].pos);
        out.target.fromArray(keys[0].target);
        out.fov = keys[0].fov ?? out.fov;
      } else {
        let i = 0;
        while (i < keys.length - 2 && keys[i + 1].u <= u) i++;
        const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(keys.length - 1, i + 2)];
        const span = Math.max(1e-6, k2.u - k1.u);
        const lt = ease.inOut(clamp((u - k1.u) / span, 0, 1));
        const cr = (a, b, c, d, f) => {
          const r = [];
          for (let j = 0; j < 3; j++) {
            const p0 = a[j], p1 = b[j], p2 = c[j], p3 = d[j];
            r.push(0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f));
          }
          return r;
        };
        out.position.fromArray(cr(k0.pos, k1.pos, k2.pos, k3.pos, lt));
        out.target.fromArray(cr(k0.target, k1.target, k2.target, k3.target, lt));
        out.fov = lerp(k1.fov ?? out.fov, k2.fov ?? out.fov, lt);
      }
      break;
    }
    default:
      out.position.copy(cur.position).addScaledVector(fwd, S * 1.5).addScaledVector(UP, S * 0.5);
  }

  // keep the camera above the ground
  const gy = ctx.groundHeight ? ctx.groundHeight(out.position.x, out.position.z) : 0;
  if (out.position.y < gy + 0.12) out.position.y = gy + 0.12;

  // handheld / vehicle-mounted shake
  const shake = (p.shake || 0) * (1 + Math.min(1.5, Math.abs(cur.speed) / 30));
  if (shake > 0) {
    const f = 1.3;
    const seed = clip.id ? clip.id.length * 7 : 3;
    const amp = S * 0.012 * shake;
    out.position.x += noise1(t * f, seed) * amp;
    out.position.y += noise1(t * f, seed + 1) * amp * 0.7;
    out.position.z += noise1(t * f, seed + 2) * amp;
    const buzz = Math.min(1, Math.abs(cur.speed) / 40) * shake * 0.004 * S;
    out.target.x += noise1(t * 9, seed + 3) * buzz;
    out.target.y += noise1(t * 11, seed + 4) * buzz;
    out.roll += noise1(t * 0.9, seed + 5) * 0.6 * DEG * shake;
  }
  out.focusDistance = out.position.distanceTo(out.target);
  return out;
}

/** Evaluate the camera track at time t, including blend transitions between clips. */
export function evaluateCameraTrack(clips, t, ctx) {
  const sorted = clips.filter((c) => c.end > c.start).sort((a, b) => a.start - b.start);
  if (!sorted.length) {
    const fake = { id: 'default', shot: 'orbit', start: 0, end: 1e6, target: ctx.heroId, params: { orbitSpeed: 12 } };
    return { ...evaluateShot(fake, t, ctx), clip: null };
  }
  let idx = -1;
  for (let i = 0; i < sorted.length; i++) if (t >= sorted[i].start && t < sorted[i].end) idx = i;
  if (idx === -1) {
    // before first clip -> first clip start; after last -> hold the last active clip
    let prev = -1;
    for (let i = 0; i < sorted.length; i++) if (sorted[i].start <= t) prev = i;
    idx = prev === -1 ? 0 : prev;
  }
  const clip = sorted[idx];
  const tt = clamp(t, clip.start, clip.end);
  const res = evaluateShot({ ...clip, target: clip.target || ctx.heroId }, tt, ctx);
  res.clip = clip;
  if (clip.transition === 'blend' && idx > 0 && t < clip.start + clip.blend) {
    const prev = sorted[idx - 1];
    const a = evaluateShot({ ...prev, target: prev.target || ctx.heroId }, Math.min(t, prev.end + clip.blend), ctx);
    const k = ease.inOut(clamp((t - clip.start) / Math.max(0.01, clip.blend), 0, 1));
    res.position.lerpVectors(a.position, res.position, k);
    res.target.lerpVectors(a.target, res.target, k);
    res.fov = lerp(a.fov, res.fov, k);
    res.roll = lerp(a.roll, res.roll, k);
    res.focusDistance = lerp(a.focusDistance, res.focusDistance, k);
  }
  return res;
}

/** Apply shot result to a PerspectiveCamera. */
export function applyShotToCamera(res, camera) {
  camera.position.copy(res.position);
  lookM.lookAt(res.position, res.target, UP);
  camera.quaternion.setFromRotationMatrix(lookM);
  if (res.roll) camera.rotateZ(res.roll);
  if (Math.abs(camera.fov - res.fov) > 1e-4) {
    camera.fov = res.fov;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();
}
