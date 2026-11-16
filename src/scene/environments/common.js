// Shared building blocks for procedural cinematic environments:
// canvas textures, road ribbons, terrain, instancing, skies.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm2, rng, clamp, smoothstep, noise2 } from '../../anim/math.js';

// ------------------------------------------------------------ textures
export function canvasTexture(w, h, draw, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Fill a canvas from a per-pixel function returning [r,g,b] (0-255), tiling noise. */
function pixelCanvas(size, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const [r, gg, b] = fn(x / size, y / size, x, y);
      d[i] = r;
      d[i + 1] = gg;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

/** Tileable fbm (sampled on a torus-like domain by blending). */
function tileFbm(u, v, freq, oct, seed) {
  const a = fbm2(u * freq, v * freq, oct, seed);
  const b = fbm2((u - 1) * freq, v * freq, oct, seed);
  const c = fbm2(u * freq, (v - 1) * freq, oct, seed);
  const d = fbm2((u - 1) * freq, (v - 1) * freq, oct, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export function noiseSurface({ size = 256, base = [128, 128, 128], variation = 30, freq = 8, seed = 1, normalStrength = 2, repeat = [1, 1], extra = null }) {
  const hs = new Float32Array(size * size);
  const colorC = pixelCanvas(size, (u, v, x, y) => {
    const n = tileFbm(u, v, freq, 5, seed);
    const fine = noise2(x * 0.9, y * 0.9, seed + 5) * 0.25;
    const h = n + fine * 0.3;
    hs[y * size + x] = h;
    const k = (n - 0.5) * 2 * variation + (fine - 0.12) * variation * 0.6;
    let col = [base[0] + k, base[1] + k, base[2] + k * 0.9];
    if (extra) col = extra(col, u, v, n, x, y);
    return col.map((q) => clamp(q, 0, 255));
  });
  const normalC = pixelCanvas(size, (u, v, x, y) => {
    const hl = hs[y * size + ((x - 1 + size) % size)], hr = hs[y * size + ((x + 1) % size)];
    const hd = hs[((y - 1 + size) % size) * size + x], hu = hs[((y + 1) % size) * size + x];
    const nx = (hl - hr) * normalStrength, ny = (hd - hu) * normalStrength;
    const l = Math.hypot(nx, ny, 1);
    return [(nx / l) * 127 + 128, (ny / l) * 127 + 128, (1 / l) * 127 + 128];
  });
  const map = new THREE.CanvasTexture(colorC);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(normalC);
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = 8;
  }
  return { map, normalMap };
}

/** Road surface texture: U across the road (0..1), V along (one tile = `tileLength` meters). */
export function roadTexture({ markings = 'yellow', wet = false, worn = 0.3, seed = 3, edge = true } = {}) {
  const W = 512, H = 1024;
  const r = rng(seed);
  const base = pixelCanvas(256, (u, v, x, y) => {
    const n = tileFbm(u, v, 6, 4, seed) * 0.6 + noise2(x * 1.7, y * 1.7, seed) * 0.4;
    const g = 52 + (n - 0.5) * 34 + (r() - 0.5) * 18;
    return [g, g, g + 2];
  });
  const color = canvasTexture(W, H, (g) => {
    g.drawImage(base, 0, 0, W, H / 2);
    g.drawImage(base, 0, H / 2, W, H / 2);
    // tyre tracks (darker, polished)
    g.globalAlpha = 0.18;
    g.fillStyle = '#0a0a0a';
    for (const x of [0.22, 0.34, 0.66, 0.78]) g.fillRect(W * x - 14, 0, 28, H);
    g.globalAlpha = 1;
    // cracks / patches
    g.strokeStyle = 'rgba(15,15,15,0.55)';
    for (let i = 0; i < 26 * worn; i++) {
      g.lineWidth = 1 + r() * 2;
      g.beginPath();
      let x = r() * W, y = r() * H;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (r() - 0.5) * 60;
        y += (r() - 0.5) * 60;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 6 * worn; i++) {
      g.fillStyle = `rgba(${25 + r() * 20},${25 + r() * 20},${25 + r() * 20},0.5)`;
      g.fillRect(r() * W, r() * H, 40 + r() * 120, 30 + r() * 100);
    }
    const paint = (x, w, col, dash) => {
      g.fillStyle = col;
      if (!dash) g.fillRect(x - w / 2, 0, w, H);
      else for (let y = 0; y < H; y += H / 2) g.fillRect(x - w / 2, y + H * 0.05, w, H * 0.22);
    };
    if (edge) {
      paint(W * 0.04, 10, 'rgba(230,230,225,0.85)', false);
      paint(W * 0.96, 10, 'rgba(230,230,225,0.85)', false);
    }
    if (markings === 'yellow') {
      paint(W * 0.49, 8, 'rgba(235,180,40,0.9)', false);
      paint(W * 0.51, 8, 'rgba(235,180,40,0.9)', false);
    } else if (markings === 'white') paint(W * 0.5, 9, 'rgba(235,235,230,0.85)', true);
    else if (markings === 'lanes') {
      paint(W * 0.5, 8, 'rgba(240,240,235,0.85)', true);
      paint(W * 0.27, 7, 'rgba(240,240,235,0.6)', true);
      paint(W * 0.73, 7, 'rgba(240,240,235,0.6)', true);
    }
    // worn paint
    g.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 200 * worn; i++) {
      g.fillStyle = `rgba(80,80,80,${0.3 * r()})`;
      g.fillRect(r() * W, r() * H, 6 + r() * 20, 6 + r() * 20);
    }
    g.globalCompositeOperation = 'source-over';
  });
  const rough = canvasTexture(
    256,
    512,
    (g, w, h) => {
      g.fillStyle = wet ? '#3a3a3a' : '#e0e0e0';
      g.fillRect(0, 0, w, h);
      if (wet) {
        // puddles: very smooth patches
        for (let i = 0; i < 26; i++) {
          const x = r() * w, y = r() * h, rad = 10 + r() * 50;
          const grd = g.createRadialGradient(x, y, 0, x, y, rad);
          grd.addColorStop(0, 'rgba(5,5,5,1)');
          grd.addColorStop(1, 'rgba(5,5,5,0)');
          g.fillStyle = grd;
          g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        }
      }
    },
    { srgb: false }
  );
  return { map: color, roughnessMap: rough };
}

/** Building facade with windows; returns {map, emissiveMap}. */
export function facadeTexture({ seed = 1, wall = '#5b5652', litChance = 0.0, broken = 0.3, cols = 6, rows = 10, warm = true, neon = false }) {
  const r = rng(seed);
  const W = 256, H = 512;
  let windows = [];
  const map = canvasTexture(W, H, (g) => {
    g.fillStyle = wall;
    g.fillRect(0, 0, W, H);
    // grime
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(0,0,0,${r() * 0.08})`;
      g.fillRect(r() * W, r() * H, 2 + r() * 30, 2 + r() * 60);
    }
    const cw = W / cols, rh = H / rows;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const lit = r() < litChance;
        const br = !lit && r() < broken;
        windows.push({ x, y, lit, tone: r() });
        g.fillStyle = lit ? '#2a2a2a' : br ? '#050505' : `rgb(${20 + r() * 25},${24 + r() * 25},${30 + r() * 25})`;
        g.fillRect(x * cw + cw * 0.18, y * rh + rh * 0.2, cw * 0.64, rh * 0.58);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x * cw + cw * 0.14, y * rh + rh * 0.78, cw * 0.72, rh * 0.06);
      }
  });
  const emissiveMap = canvasTexture(W, H, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const cw = W / cols, rh = H / rows;
    for (const w of windows) {
      if (!w.lit) continue;
      let col;
      if (neon && w.tone > 0.85) col = w.tone > 0.93 ? '#ff2d95' : '#2de2ff';
      else col = warm ? (w.tone > 0.5 ? '#ffd9a0' : '#ffc070') : w.tone > 0.5 ? '#bfe0ff' : '#e8f1ff';
      g.fillStyle = col;
      g.globalAlpha = 0.5 + w.tone * 0.5;
      g.fillRect(w.x * cw + cw * 0.18, w.y * rh + rh * 0.2, cw * 0.64, rh * 0.58);
    }
    g.globalAlpha = 1;
  });
  return { map, emissiveMap };
}

// ------------------------------------------------------------ road
export class RoadField {
  constructor(curve, width, sampleStep = 4) {
    this.curve = curve;
    this.width = width;
    const len = curve.getLength();
    const n = Math.max(2, Math.ceil(len / sampleStep));
    this.pts = curve.getSpacedPoints(n);
    this.cell = 40;
    this.grid = new Map();
    this.pts.forEach((p, i) => {
      const k = `${Math.floor(p.x / this.cell)},${Math.floor(p.z / this.cell)}`;
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(i);
    });
    this.length = len;
  }
  /** Distance from (x,z) to the road centre line (approx, max ~120m). */
  distance(x, z) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = Infinity;
    for (let r = 0; r <= 3; r++) {
      for (let i = -r; i <= r; i++)
        for (let j = -r; j <= r; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          const list = this.grid.get(`${cx + i},${cz + j}`);
          if (!list) continue;
          for (const k of list) {
            const p = this.pts[k];
            const d = (p.x - x) ** 2 + (p.z - z) ** 2;
            if (d < best) best = d;
          }
        }
      if (best < (r * this.cell) ** 2) break;
    }
    return best === Infinity ? 160 : Math.sqrt(best);
  }
}

export function buildRoadMesh(curve, width, material, { step = 2, y = 0.03, heightFn = null } = {}) {
  const len = curve.getLength();
  const n = Math.ceil(len / step);
  const pos = [], uv = [], idx = [];
  const tan = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = curve.getPointAt(u);
    curve.getTangentAt(u, tan);
    const rx = tan.z, rz = -tan.x;
    const l = Math.hypot(rx, rz) || 1;
    for (const s of [-1, 1]) {
      const x = p.x + (rx / l) * s * width * 0.5, z = p.z + (rz / l) * s * width * 0.5;
      pos.push(x, (heightFn ? heightFn(x, z) : p.y) + y, z);
      uv.push(s < 0 ? 0 : 1, (u * len) / 24);
    }
    if (i < n) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.name = 'road';
  return mesh;
}

/** Points along a road offset sideways, every `spacing` meters. */
export function alongRoad(curve, spacing, offset, cb) {
  const len = curve.getLength();
  const tan = new THREE.Vector3();
  for (let d = spacing * 0.5; d < len; d += spacing) {
    const u = d / len;
    const p = curve.getPointAt(u);
    curve.getTangentAt(u, tan);
    const right = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
    cb(p.clone().addScaledVector(right, offset), Math.atan2(tan.x, tan.z), d, right);
  }
}

// ------------------------------------------------------------ terrain
export function buildTerrain({ size = 3000, segments = 220, heightFn, colorFn, material }) {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightFn(x, z);
    pos.setY(i, h);
  }
  geo.computeVertexNormals();
  if (colorFn) {
    const nrm = geo.attributes.normal;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      colorFn(c, pos.getX(i), pos.getY(i), pos.getZ(i), nrm.getY(i));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    material.vertexColors = true;
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/** Height falloff helper: 0 on/near the road, 1 far away. */
export function roadMask(dist, roadHalf, blend = 30) {
  return smoothstep(roadHalf + 2, roadHalf + 2 + blend, dist);
}

// ------------------------------------------------------------ instancing
export function instanced(geometry, material, transforms, { cast = true, receive = true } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, transforms.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  transforms.forEach((t, i) => {
    p.set(t.x, t.y, t.z);
    e.set(t.rx || 0, t.ry || 0, t.rz || 0);
    q.setFromEuler(e);
    if (Array.isArray(t.s)) s.set(t.s[0], t.s[1], t.s[2]);
    else s.setScalar(t.s ?? 1);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (t.color && mesh.setColorAt) mesh.setColorAt(i, new THREE.Color(t.color));
  });
  mesh.count = transforms.length;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Slightly randomized rock geometry. */
export function rockGeometry(seed = 1, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const r = rng(seed);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 0.75 + noise2(v.x * 2 + seed, v.z * 2 + v.y, seed) * 0.5 + r() * 0.06;
    v.multiplyScalar(n);
    v.y *= 0.7;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------ skies
export function physicalSky(params) {
  const sky = new Sky();
  sky.scale.setScalar(20000);
  sky.name = 'sky';
  const u = sky.material.uniforms;
  u.turbidity.value = params.turbidity ?? 8;
  u.rayleigh.value = params.rayleigh ?? 1.5;
  u.mieCoefficient.value = params.mie ?? 0.006;
  u.mieDirectionalG.value = params.mieG ?? 0.85;
  sky.material.depthWrite = false;
  // scale the (very bright) Preetham radiance into the same range as the lit scene
  u.skyIntensity = { value: params.intensity ?? 0.16 };
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace('void main() {', 'uniform float skyIntensity;\nvoid main() {')
    .replace('gl_FragColor = vec4( texColor, 1.0 );', 'vec3 skyC = texColor * skyIntensity; skyC = skyC / (1.0 + max(max(skyC.r, skyC.g), skyC.b) / 6.0); gl_FragColor = vec4( skyC, 1.0 );');
  sky.material.needsUpdate = true;
  sky.setSun = (dir) => u.sunPosition.value.copy(dir);
  return sky;
}

export function nightSky({ top = '#02040a', horizon = '#1a2238', glow = '#3a2a4a', stars = 1, moon = true } = {}) {
  const geo = new THREE.SphereGeometry(15000, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(top) },
      uHorizon: { value: new THREE.Color(horizon) },
      uGlow: { value: new THREE.Color(glow) },
      uStars: { value: stars },
      uMoonDir: { value: new THREE.Vector3(-0.4, 0.45, -0.8).normalize() },
      uMoon: { value: moon ? 1 : 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `
      uniform vec3 uTop, uHorizon, uGlow, uMoonDir; uniform float uStars, uMoon; varying vec3 vDir;
      float h(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        vec3 d = normalize(vDir);
        float y = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uTop, pow(y, 0.45));
        col += uGlow * pow(1.0 - y, 8.0) * 0.8;
        if (d.y > 0.02) {
          vec3 g = floor(d * 380.0);
          float s = h(g);
          float star = step(0.9975, s) * (0.4 + 0.6*h(g+1.7)) * smoothstep(0.02, 0.3, d.y);
          col += vec3(star) * uStars * 3.0;
        }
        float m = dot(d, uMoonDir);
        col += uMoon * (smoothstep(0.9993, 0.9996, m) * vec3(2.6,2.5,2.3) + pow(max(m,0.0), 400.0) * vec3(0.25,0.28,0.35));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

export function sunDirection(elevationDeg, azimuthDeg) {
  const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
  const theta = THREE.MathUtils.degToRad(azimuthDeg);
  return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
}

/** Smooth road path from 2D control points [x,z]. */
export function roadCurve(points2d, y = 0) {
  return new THREE.CatmullRomCurve3(
    points2d.map(([x, z]) => new THREE.Vector3(x, y, z)),
    false,
    'centripetal'
  );
}

export function standardMat(opts) {
  return new THREE.MeshStandardMaterial(opts);
}

/** Collects static meshes and merges them per material to cut draw calls. */
export class Batcher {
  constructor() {
    this.items = new Map();
  }
  add(geometry, material, position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(position[0] ?? position.x, position[1] ?? position.y, position[2] ?? position.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2])),
      new THREE.Vector3(scale[0], scale[1], scale[2])
    );
    const g = geometry.clone().applyMatrix4(m);
    if (!this.items.has(material)) this.items.set(material, []);
    this.items.get(material).push(g);
  }
  build(group, { cast = true, receive = true } = {}) {
    for (const [mat, geos] of this.items) {
      const norm = geos.map((g) => (g.index ? g : g));
      const merged = mergeGeometries(norm, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      group.add(mesh);
    }
    this.items.clear();
  }
}
