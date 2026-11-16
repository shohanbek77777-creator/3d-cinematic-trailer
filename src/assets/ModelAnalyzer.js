// Inspect a loaded model: dimensions, geometry stats, materials, wheel candidates.
import * as THREE from 'three';

const WHEEL_RE = /(wheel|tire|tyre|rim\b|rim_|_rim|колес|колёс|шина|reifen|rueda|roue|ruota|wiel)/i;
const WHEEL_EXCLUDE = /(steer|spare|well|arch|cover|cap_?logo|housing|fender|руль)/i;

export function analyzeModel(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  let triangles = 0, meshes = 0;
  const materials = [];
  const matSet = new Set();
  const textures = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    if (g) triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || matSet.has(m.uuid)) continue;
      matSet.add(m.uuid);
      materials.push(m);
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'])
        if (m[k]) textures.add(m[k].uuid);
    }
  });
  return { box, size, center, triangles: Math.round(triangles), meshes, materialCount: materials.length, textureCount: textures.size };
}

/**
 * Outlier-robust bounds: percentile box over (sub-sampled) vertices, so stray helper
 * meshes, baked ground-shadow planes or lone vertices don't inflate the model size.
 * `transform` (Matrix4) is applied after each mesh's world matrix.
 */
export function robustBox(root, transform = null, lo = 0.002, hi = 0.998) {
  root.updateMatrixWorld(true);
  let total = 0;
  root.traverse((o) => o.isMesh && o.geometry?.attributes.position && (total += o.geometry.attributes.position.count));
  const stride = Math.max(1, Math.floor(total / 150000));
  const xs = [], ys = [], zs = [];
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes.position || o.visible === false) return;
    m.copy(o.matrixWorld);
    if (transform) m.premultiply(transform);
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      xs.push(v.x);
      ys.push(v.y);
      zs.push(v.z);
    }
  });
  if (!xs.length) return new THREE.Box3().setFromObject(root);
  const range = (arr) => {
    arr.sort((a, b) => a - b);
    const n = arr.length - 1;
    return [arr[Math.floor(n * lo)], arr[Math.ceil(n * hi)]];
  };
  const [x0, x1] = range(xs), [y0, y1] = range(ys), [z0, z1] = range(zs);
  return new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
}

/** Default forward axis guess: glTF convention is +Z forward; use X if the model is clearly longer along X. */
export function guessForwardAxis(size) {
  return size.x > size.z * 1.12 ? '+X' : '+Z';
}

export function axisQuaternion(forwardAxis, upAxis) {
  const qUp = new THREE.Quaternion();
  if (upAxis === '+Z') qUp.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  else if (upAxis === '-Z') qUp.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const yaw = { '+Z': 0, '-Z': Math.PI, '+X': -Math.PI / 2, '-X': Math.PI / 2 }[forwardAxis] ?? 0;
  const qF = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return qF.multiply(qUp);
}

/**
 * Find wheel nodes. `root` must be in its "oriented" frame given by orientQ,
 * where +Z is forward, +Y up and +X lateral. Returns top-most wheel objects.
 */
export function detectWheels(root, orientQ, refBox = null) {
  root.updateMatrixWorld(true);
  const invRootWorld = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const orientM = new THREE.Matrix4().makeRotationFromQuaternion(orientQ);
  const boxOf = (o) => {
    const b = new THREE.Box3();
    o.traverse((c) => {
      if (c.isMesh && c.geometry) {
        if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
        const m = new THREE.Matrix4().multiplyMatrices(invRootWorld, c.matrixWorld).premultiply(orientM);
        b.union(c.geometry.boundingBox.clone().applyMatrix4(m));
      }
    });
    return b;
  };
  const full = refBox ? refBox.clone() : boxOf(root);
  const fullSize = full.getSize(new THREE.Vector3());
  const maxDim = Math.max(fullSize.x, fullSize.y, fullSize.z) || 1;

  const valid = (o) => {
    const b = boxOf(o);
    if (b.isEmpty()) return null;
    const s = b.getSize(new THREE.Vector3());
    const c = b.getCenter(new THREE.Vector3());
    if (Math.max(s.x, s.y, s.z) > maxDim * 0.6) return null; // too big to be a wheel
    if (c.y > full.min.y + fullSize.y * 0.6) return null; // wheels sit low
    return { obj: o, box: b, size: s, center: c };
  };

  // 1) name based
  const named = [];
  root.traverse((o) => {
    if (o === root) return;
    if (WHEEL_RE.test(o.name) && !WHEEL_EXCLUDE.test(o.name)) named.push(o);
  });
  const isDesc = (o, set) => {
    let p = o.parent;
    while (p) {
      if (set.has(p)) return true;
      p = p.parent;
    }
    return false;
  };
  const namedSet = new Set(named);
  let wheels = named.filter((o) => !isDesc(o, namedSet)).map(valid).filter(Boolean);

  // A single node covering all wheels (e.g. "Wheels") – descend one level.
  if (wheels.length === 1 && wheels[0].obj.children.length >= 2) {
    const kids = wheels[0].obj.children.map(valid).filter(Boolean);
    if (kids.length >= 2) wheels = kids;
  }

  // 2) geometric fallback: round-ish meshes in the lower part of the model
  if (wheels.length < 2) {
    const cands = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const v = valid(o);
      if (!v) return;
      const { size: s } = v;
      const diam = (s.y + s.z) / 2;
      const round = s.y / Math.max(s.z, 1e-6);
      if (round < 0.75 || round > 1.33) return;
      if (s.x > diam * 0.85) return; // too wide for a wheel
      if (diam < fullSize.z * 0.08 || diam > fullSize.z * 0.5) return;
      if (v.center.y - v.size.y / 2 > full.min.y + fullSize.y * 0.15) return; // must touch the ground
      cands.push(v);
    });
    // keep the outermost candidates (largest |x|), max ~ 12
    if (cands.length >= 2) wheels = cands.slice(0, 16);
  }

  return wheels.map((w) => ({
    object: w.obj,
    center: w.center,
    radius: Math.max(0.05, w.size.y / 2),
    front: w.center.z > (full.min.z + full.max.z) / 2 + fullSize.z * 0.1,
    rear: w.center.z < (full.min.z + full.max.z) / 2 - fullSize.z * 0.1,
    side: Math.sign(w.center.x - (full.min.x + full.max.x) / 2) || 1,
  }));
}

/** Stable material key list used by the material editor and project overrides. */
export function collectMaterials(root) {
  const list = [];
  const seen = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || seen.has(m)) continue;
      const key = `${m.name || 'material'}#${list.length}`;
      seen.set(m, key);
      list.push({ key, material: m });
    }
  });
  return list;
}
