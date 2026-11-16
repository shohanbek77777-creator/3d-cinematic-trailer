// Runtime representation of a project actor (an imported model placed in the scene).
// Hierarchy: root (path / transform) -> body (suspension) -> orient (axis fix, scale, centering) -> container -> model
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { analyzeModel, guessForwardAxis, axisQuaternion, detectWheels, collectMaterials } from '../assets/ModelAnalyzer.js';
import { ActorPath } from '../anim/Path.js';
import { DEG, clamp } from '../anim/math.js';

const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Y = new THREE.Vector3(0, 1, 0);

let glowTexture = null;
function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.15, 'rgba(255,250,235,0.85)');
  grd.addColorStop(0.45, 'rgba(200,220,255,0.18)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

export class ActorRuntime {
  /**
   * @param {object} data project actor
   * @param {{template: THREE.Object3D, animations: THREE.AnimationClip[]}} asset
   */
  constructor(data, asset) {
    this.id = data.id;
    this.data = data;
    this.asset = asset;
    this.root = new THREE.Group();
    this.root.userData.actorId = data.id;
    this.body = new THREE.Group();
    this.orient = new THREE.Group();
    this.root.add(this.body);
    this.body.add(this.orient);
    this.path = new ActorPath([], 'smooth');
    this._state = { position: new THREE.Vector3() };
    this._setupKey = '';
    this.headlights = null;
    this.build();
  }

  build() {
    // dispose previous instance
    if (this.container) {
      this.orient.remove(this.container);
      this.container = null;
    }
    this.mixer?.stopAllAction();
    const setup = this.data.setup;
    const container = new THREE.Group();
    const model = SkeletonUtils.clone(this.asset.template);
    container.add(model);
    container.updateMatrixWorld(true);

    // per-instance materials so overrides don't leak between actors
    const matMap = new Map();
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const swap = (m) => {
        if (!m) return m;
        if (!matMap.has(m)) matMap.set(m, m.clone());
        return matMap.get(m);
      };
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
    this.materialList = collectMaterials(model);
    this.originals = {};
    for (const { key, material: m } of this.materialList) {
      this.originals[key] = {
        color: m.color ? '#' + m.color.getHexString() : null,
        metalness: m.metalness ?? null,
        roughness: m.roughness ?? null,
        emissive: m.emissive ? '#' + m.emissive.getHexString() : null,
        emissiveIntensity: m.emissiveIntensity ?? null,
        envMapIntensity: m.envMapIntensity ?? 1,
        opacity: m.opacity ?? 1,
      };
    }

    // orientation
    const raw = analyzeModel(container);
    const forwardAxis = setup.forwardAxis === 'auto' ? guessForwardAxis(raw.size) : setup.forwardAxis;
    const q = axisQuaternion(forwardAxis, setup.upAxis);
    const orientM = new THREE.Matrix4().makeRotationFromQuaternion(q);
    const box = raw.box.clone().applyMatrix4(orientM);
    const size = box.getSize(new THREE.Vector3());

    // scale: explicit target length, or fix implausible units (mm / cm / tiny exports)
    let auto = 1;
    const len = Math.max(size.z, 1e-6);
    if (setup.targetLength > 0) auto = setup.targetLength / len;
    else if (len > 80 || len < 0.3) auto = 4.6 / len;
    this.autoScale = auto;
    const s = auto * (this.data.transform.scale || 1);

    // wheels (pivots inserted so each wheel spins about its own hub)
    const wheels = setup.wheelSpin || setup.steering ? detectWheels(container, q) : [];
    this.wheels = [];
    const invQ = q.clone().invert();
    for (const w of wheels) {
      const obj = w.object;
      const parent = obj.parent;
      if (!parent) continue;
      parent.updateMatrixWorld(true);
      const cContainer = w.center.clone().applyQuaternion(invQ);
      const pivot = new THREE.Group();
      pivot.name = (obj.name || 'wheel') + '_pivot';
      pivot.position.copy(parent.worldToLocal(cContainer.clone()));
      parent.add(pivot);
      pivot.updateMatrixWorld(true);
      pivot.attach(obj);
      const parentQ = parent.getWorldQuaternion(new THREE.Quaternion());
      const full = q.clone().multiply(parentQ).invert();
      this.wheels.push({
        pivot,
        radius: w.radius * s,
        front: w.front,
        spinAxis: AX_X.clone().applyQuaternion(full).normalize(),
        steerAxis: AX_Y.clone().applyQuaternion(full).normalize(),
        z: w.center.z,
      });
    }
    const fronts = this.wheels.filter((w) => w.front), rears = this.wheels.filter((w) => !w.front);
    const avgZ = (a) => a.reduce((m, w) => m + w.z, 0) / Math.max(a.length, 1);
    this.wheelBase = fronts.length && rears.length ? Math.abs(avgZ(fronts) - avgZ(rears)) * s : size.z * s * 0.6;

    const center = box.getCenter(new THREE.Vector3());
    this.orient.quaternion.copy(q);
    this.orient.scale.setScalar(s);
    this.orient.position.set(-center.x * s, -box.min.y * s, -center.z * s);
    this.orient.add(container);
    this.container = container;
    this.model = model;

    this.dims = { length: size.z * s, width: size.x * s, height: size.y * s };
    this.size = Math.max(this.dims.length, this.dims.width * 1.6, this.dims.height * 2.2);
    const kind = setup.kind === 'auto' ? (this.wheels.length >= 2 || (size.z > size.y * 1.3 && size.z > size.x * 1.2) ? 'vehicle' : 'prop') : setup.kind;
    this.kind = kind;
    this.forwardAxis = forwardAxis;
    this.info = {
      ...raw,
      size: raw.size.clone(),
      forwardAxis,
      autoScale: auto,
      wheels: this.wheels.length,
      animations: (this.asset.animations || []).map((a) => a.name || 'clip'),
      kind,
    };

    // embedded glTF animation
    this.mixer = null;
    this.action = null;
    const clips = this.asset.animations || [];
    if (clips.length && setup.animationClip) {
      const clip = clips.find((c) => c.name === setup.animationClip) || clips[0];
      this.mixer = new THREE.AnimationMixer(model);
      this.action = this.mixer.clipAction(clip);
      this.action.play();
    }

    this._buildHeadlights();
    this.applyMaterials();
    this.rebuildPath();
    this._setupKey = this._key();
  }

  _key() {
    const s = this.data.setup;
    return [s.forwardAxis, s.upAxis, s.targetLength, s.wheelSpin, s.steering, s.animationClip, s.kind, this.data.transform.scale].join('|');
  }

  /** Re-apply project data; rebuilds geometry only when needed. */
  sync(data) {
    this.data = data;
    if (this._key() !== this._setupKey) this.build();
    else {
      this.applyMaterials();
      this.rebuildPath();
    }
    this.root.visible = data.setup.visible !== false;
  }

  rebuildPath() {
    const p = this.data.path || { keys: [] };
    this.path = new ActorPath(p.keys || [], p.interpolation);
  }

  _buildHeadlights() {
    if (this.headlights) {
      this.body.remove(this.headlights.group);
      this.headlights.lights.forEach((l) => l.dispose?.());
    }
    const g = new THREE.Group();
    g.name = 'headlights';
    const { length: L, width: W, height: H } = this.dims;
    const lights = [];
    for (const sx of [-1, 1]) {
      const spot = new THREE.SpotLight(0xfff1dd, 0, L * 14, 0.42, 0.55, 1.6);
      spot.position.set(sx * W * 0.32, H * 0.42, L * 0.48);
      spot.target.position.set(sx * W * 0.2, 0, L * 3.5);
      spot.castShadow = false;
      g.add(spot, spot.target);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xfff6e8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sprite.position.set(sx * W * 0.33, H * 0.42, L * 0.5 + 0.02);
      sprite.scale.setScalar(W * 0.5);
      g.add(sprite);
      lights.push({ spot, sprite });
    }
    this.body.add(g);
    this.headlights = { group: g, lights };
    this.setHeadlights(false);
  }

  setHeadlights(on, strength = 1) {
    if (!this.headlights) return;
    const L = this.dims.length;
    for (const { spot, sprite } of this.headlights.lights) {
      spot.intensity = on ? 220 * strength * Math.max(1, L / 4.6) : 0;
      spot.visible = on;
      sprite.visible = on;
      sprite.material.opacity = 0.9 * strength;
    }
  }

  applyMaterials() {
    const ov = this.data.materials || {};
    for (const { key, material: m } of this.materialList) {
      const o = { ...this.originals[key], ...(ov[key] || {}) };
      if (m.color && o.color) m.color.set(o.color);
      if (o.metalness !== null && 'metalness' in m) m.metalness = o.metalness;
      if (o.roughness !== null && 'roughness' in m) m.roughness = o.roughness;
      if (m.emissive && o.emissive) m.emissive.set(o.emissive);
      if (o.emissiveIntensity !== null && 'emissiveIntensity' in m) m.emissiveIntensity = o.emissiveIntensity;
      if ('envMapIntensity' in m) m.envMapIntensity = o.envMapIntensity;
      m.needsUpdate = false;
    }
  }

  /** Pure evaluation of world state at time t. */
  evaluate(t, out = {}) {
    const tr = this.data.transform;
    const ps = this.path.evaluate(t, this._state);
    out.position = out.position || new THREE.Vector3();
    if (ps) {
      out.position.copy(ps.position);
      out.yaw = (ps.yaw ?? 0) + tr.rotation[1] * DEG;
      if (ps.yaw === null) out.yaw = tr.rotation[1] * DEG;
      out.speed = ps.speed;
      out.accel = ps.accel;
      out.yawRate = ps.yawRate;
      out.curvature = ps.curvature || 0;
      out.distance = ps.distance;
      out.animated = this.path.animated;
    } else {
      out.position.set(tr.position[0], tr.position[1], tr.position[2]);
      out.yaw = tr.rotation[1] * DEG;
      out.speed = 0;
      out.accel = 0;
      out.yawRate = 0;
      out.curvature = 0;
      out.distance = 0;
      out.animated = false;
    }
    out.pitch = tr.rotation[0] * DEG;
    out.roll = tr.rotation[2] * DEG;
    out.dims = this.dims;
    out.size = this.size;
    return out;
  }

  /** Apply the state at time t to the scene graph. */
  update(t) {
    const st = this.evaluate(t, this._evalOut || (this._evalOut = {}));
    this.root.position.copy(st.position);
    this.root.rotation.set(st.pitch, st.yaw, st.roll, 'YXZ');
    const setup = this.data.setup;
    // suspension: nose dive on braking, squat on acceleration, roll in corners
    if (setup.suspension && this.kind === 'vehicle') {
      const k = 0.0045 * Math.min(1.6, 4.6 / Math.max(this.dims.length, 1));
      const pitch = clamp(-st.accel * k, -0.045, 0.045);
      const roll = clamp(st.speed * st.yawRate * 0.0035, -0.05, 0.05);
      this.body.rotation.set(pitch, 0, roll);
    } else this.body.rotation.set(0, 0, 0);
    // wheels
    const steer = setup.steering ? clamp(Math.atan(st.curvature * this.wheelBase), -0.5, 0.5) : 0;
    const qs = new THREE.Quaternion(), qt = new THREE.Quaternion();
    for (const w of this.wheels) {
      const spin = setup.wheelSpin ? st.distance / Math.max(w.radius, 0.01) : 0;
      qs.setFromAxisAngle(w.spinAxis, spin);
      if (w.front && steer !== 0) {
        qt.setFromAxisAngle(w.steerAxis, steer);
        w.pivot.quaternion.copy(qt).multiply(qs);
      } else w.pivot.quaternion.copy(qs);
    }
    if (this.mixer) this.mixer.setTime(t);
    return st;
  }

  /** World-space rear wheel contact points (used by dust emitters). */
  contactPoints(st, out = []) {
    const { length: L, width: W } = this.dims;
    const s = Math.sin(st.yaw), c = Math.cos(st.yaw);
    out.length = 0;
    for (const [lx, lz] of [
      [-W * 0.38, -L * 0.3],
      [W * 0.38, -L * 0.3],
    ]) {
      out.push(new THREE.Vector3(st.position.x + lx * c + lz * s, st.position.y + 0.05, st.position.z - lx * s + lz * c));
    }
    return out;
  }

  dispose() {
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
    this.root.traverse((o) => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m?.dispose());
      }
    });
  }
}
