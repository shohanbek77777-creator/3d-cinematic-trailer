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

  // Group parts of the same wheel (rim + tyre + hub cap ...) so they share one pivot.
  wheels.sort((a, b) => b.size.y - a.size.y);
  const groups = [];
  for (const w of wheels) {
    const g = groups.find((g) => g.center.distanceTo(w.center) < g.size.y * 0.3);
    if (g) g.parts.push(w.obj);
    else groups.push({ parts: [w.obj], box: w.box.clone(), size: w.size, center: w.center });
  }
  // Small loose meshes sitting inside a wheel (valve, centre cap, nuts) rotate with it.
  const taken = new Set();
  for (const g of groups) for (const p of g.parts) p.traverse((c) => taken.add(c));
  root.traverse((o) => {
    if (!o.isMesh || taken.has(o)) return;
    const v = valid(o);
    if (!v) return;
    for (const g of groups) {
      const lim = g.box.clone().expandByScalar(g.size.y * 0.03);
      if (lim.containsBox(v.box) && Math.max(v.size.x, v.size.y, v.size.z) < g.size.y * 0.25) {
        g.parts.push(o);
        taken.add(o);
        break;
      }
    }
  });

  const midZ = (full.min.z + full.max.z) / 2;
  return groups.map((g) => {
    const fit = fitAxle(g.parts[0], invRootWorld, orientM, g.center);
    const center = fit ? fit.center : g.center;
    return {
      object: g.parts[0],
      objects: g.parts,
      center,
      // unit axle direction in the oriented frame (x > 0). Differs from +X when the
      // model was exported with turned or cambered wheels.
      axis: fit ? fit.axis : new THREE.Vector3(1, 0, 0),
      radius: Math.max(0.05, g.size.y / 2),
      front: center.z > midZ + fullSize.z * 0.1,
      rear: center.z < midZ - fullSize.z * 0.1,
      side: Math.sign(center.x - (full.min.x + full.max.x) / 2) || 1,
    };
  });
}

/**
 * Real rotation axis and hub centre of a wheel, from its vertices: a wheel is a body of
 * revolution, so its thinnest principal direction is the axle. Spinning about the car's
 * lateral axis instead makes a wheel that was modelled turned (steered) wobble.
 */
function fitAxle(obj, invRootWorld, orientM, fallbackCenter) {
  const pts = [];
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  let total = 0;
  obj.traverse((c) => c.isMesh && c.geometry?.attributes.position && (total += c.geometry.attributes.position.count));
  if (total < 24) return null;
  const stride = Math.max(1, Math.floor(total / 20000));
  obj.traverse((c) => {
    if (!c.isMesh || !c.geometry?.attributes.position) return;
    m.multiplyMatrices(invRootWorld, c.matrixWorld).premultiply(orientM);
    const pos = c.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += stride) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(m).clone());
  });
  const mean = new THREE.Vector3();
  for (const p of pts) mean.add(p);
  mean.divideScalar(pts.length);
  // covariance matrix
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) {
    const d = [p.x - mean.x, p.y - mean.y, p.z - mean.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j];
  }
  // Jacobi eigen-decomposition of the symmetric 3x3
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 24; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(C[p][q]) < 1e-14) continue;
      const th = 0.5 * Math.atan2(2 * C[p][q], C[q][q] - C[p][p]);
      const c = Math.cos(th), s = Math.sin(th);
      for (let k = 0; k < 3; k++) {
        const a = C[k][p], b = C[k][q];
        C[k][p] = c * a - s * b;
        C[k][q] = s * a + c * b;
      }
      for (let k = 0; k < 3; k++) {
        const a = C[p][k], b = C[q][k];
        C[p][k] = c * a - s * b;
        C[q][k] = s * a + c * b;
      }
      for (let k = 0; k < 3; k++) {
        const a = V[k][p], b = V[k][q];
        V[k][p] = c * a - s * b;
        V[k][q] = s * a + c * b;
      }
    }
  }
  const ev = [0, 1, 2].map((i) => ({ l: C[i][i], v: new THREE.Vector3(V[0][i], V[1][i], V[2][i]) })).sort((a, b) => a.l - b.l);
  // expect one thin direction and two equal ones; otherwise it is not a clean wheel
  if (ev[1].l / Math.max(ev[2].l, 1e-12) < 0.8 || ev[0].l / Math.max(ev[1].l, 1e-12) > 0.7) return null;
  const axis = ev[0].v.normalize();
  if (axis.x < 0) axis.negate();
  if (axis.x < Math.cos(40 * Math.PI / 180)) return null; // not a road wheel orientation
  if (axis.x > Math.cos(1 * Math.PI / 180)) axis.set(1, 0, 0); // numerically straight
  // hub centre: middle of the extents measured along the axle and across it
  const e1 = new THREE.Vector3(0, 1, 0).addScaledVector(axis, -axis.y).normalize();
  const e2 = new THREE.Vector3().crossVectors(axis, e1);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    const d = [p.dot(axis), p.dot(e1), p.dot(e2)];
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], d[i]);
      hi[i] = Math.max(hi[i], d[i]);
    }
  }
  const center = new THREE.Vector3()
    .addScaledVector(axis, (lo[0] + hi[0]) / 2)
    .addScaledVector(e1, (lo[1] + hi[1]) / 2)
    .addScaledVector(e2, (lo[2] + hi[2]) / 2);
  if (center.distanceTo(fallbackCenter) > (hi[1] - lo[1]) * 0.25) return null;
  return { axis, center };
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
