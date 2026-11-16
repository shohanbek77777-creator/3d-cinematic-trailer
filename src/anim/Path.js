// Actor motion path: keyframes {t, p:[x,y,z]} -> smooth spatial curve (Catmull-Rom)
// + distance-over-time profile (monotone cubic) giving natural acceleration and braking.
import * as THREE from 'three';
import { MonotoneCubic } from './math.js';

const _v = new THREE.Vector3();
const _tan = new THREE.Vector3();

export class ActorPath {
  constructor(keys = [], interpolation = 'smooth') {
    this.keys = [...keys].sort((a, b) => a.t - b.t);
    this.interpolation = interpolation;
    this.curve = null;
    this.total = 0;
    this._build();
  }

  get animated() {
    return this.curve !== null;
  }

  _build() {
    const keys = this.keys;
    if (keys.length < 2) return;
    const pts = [];
    const keyPointIndex = [];
    for (const k of keys) {
      const p = new THREE.Vector3(k.p[0], k.p[1], k.p[2]);
      if (!pts.length || pts[pts.length - 1].distanceTo(p) > 1e-3) pts.push(p);
      keyPointIndex.push(pts.length - 1);
    }
    if (pts.length < 2) {
      this.staticPoint = pts[0];
      return;
    }
    const div = 24;
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    this.curve.arcLengthDivisions = (pts.length - 1) * div;
    const lengths = this.curve.getLengths();
    this.total = lengths[lengths.length - 1];
    const times = keys.map((k) => k.t);
    const dists = keyPointIndex.map((i) => lengths[i * div]);
    this.times = times;
    this.dists = dists;
    this.spline = new MonotoneCubic(times, dists);
  }

  distanceAt(t) {
    if (!this.curve) return 0;
    if (this.interpolation === 'linear') {
      const { times, dists } = this;
      if (t <= times[0]) return dists[0];
      if (t >= times[times.length - 1]) return dists[dists.length - 1];
      let i = 0;
      while (i < times.length - 2 && times[i + 1] <= t) i++;
      const span = times[i + 1] - times[i];
      return span > 1e-9 ? dists[i] + ((t - times[i]) / span) * (dists[i + 1] - dists[i]) : dists[i + 1];
    }
    return this.spline.value(t);
  }

  /** Evaluate position / heading at time t. Returns null when not animated. */
  evaluate(t, out = {}) {
    if (!this.curve) {
      if (this.keys.length >= 1) {
        const p = this.keys[0].p;
        out.position = (out.position || new THREE.Vector3()).set(p[0], p[1], p[2]);
        out.yaw = null;
        out.speed = 0;
        out.accel = 0;
        out.yawRate = 0;
        out.distance = 0;
        return out;
      }
      return null;
    }
    const d = Math.min(Math.max(this.distanceAt(t), 0), this.total);
    const u = this.total > 0 ? d / this.total : 0;
    const param = this.curve.getUtoTmapping(u);
    out.position = this.curve.getPoint(param, out.position || new THREE.Vector3());
    this.curve.getTangent(param, _tan);
    out.yaw = Math.atan2(_tan.x, _tan.z);
    out.distance = d;
    // numeric derivatives for speed / acceleration / yaw rate (suspension + steering)
    const h = 1 / 60;
    const d0 = this.distanceAt(t - h), d1 = this.distanceAt(t + h);
    out.speed = (d1 - d0) / (2 * h);
    out.accel = (d1 - 2 * d + d0) / (h * h);
    const yawAt = (dd) => {
      const p = this.curve.getUtoTmapping(Math.min(Math.max(dd / this.total, 0), 1));
      this.curve.getTangent(p, _v);
      return Math.atan2(_v.x, _v.z);
    };
    const ds = Math.max(0.5, Math.abs(out.speed) * h * 2);
    let dy = yawAt(d + ds) - yawAt(d - ds);
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    out.curvature = dy / (2 * ds);
    out.yawRate = out.curvature * out.speed;
    return out;
  }
}
