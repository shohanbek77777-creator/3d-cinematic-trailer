import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm2, ridged2, rng, clamp, smoothstep } from '../../anim/math.js';
import { noiseSurface, roadTexture, RoadField, buildRoadMesh, buildTerrain, instanced, rockGeometry, roadCurve, alongRoad } from './common.js';

export default {
  id: 'mountain',
  name: 'Mountain Road',
  description: 'Serpentine pass through pine forests under snow-capped peaks.',
  thumb: 'linear-gradient(180deg,#7fb2e5 0%,#c7dcef 40%,#7d8a8f 55%,#2f4a33 100%)',
  preset: {
    lighting: { sunElevation: 26, sunAzimuth: 145, sunIntensity: 3.6, sunColor: '#fff1dc', ambient: 0.7, envIntensity: 1.0, exposure: 0.85, headlights: false },
    fog: { density: 0.0009, color: '#a9c0d6' },
    sky: { type: 'physical', turbidity: 3.5, rayleigh: 1.2, mie: 0.004, mieG: 0.8, clouds: 0.35 },
    hemi: { sky: '#cfe3ff', ground: '#3d4a33' },
    particles: { dust: '#9b8c78', smoke: '#9a9a9a', ambient: { color: '#ffffff', amount: 0.35, size: 0.05, wind: [0.6, 0.0, 0.3] } },
    grading: { temperature: -0.02, tint: 0, contrast: 1.08, saturation: 1.1, shadowsColor: '#1b3a55', highlightsColor: '#ffd9a8', splitAmount: 0.18 },
    envDust: 0.7,
  },
  build({ seed = 21, roadWidth = 9.5 }) {
    const group = new THREE.Group();
    const R = rng(seed);
    const curve = roadCurve([
      [0, -950], [70, -700], [-20, -470], [45, -240], [140, -40], [90, 190], [-40, 360], [-10, 600], [90, 820], [60, 1050],
    ]);
    const field = new RoadField(curve, roadWidth);
    const half = roadWidth / 2;
    const heightFn = (x, z) => {
      const d = field.distance(x, z);
      const near = smoothstep(half + 8, half + 70, d);
      const far = smoothstep(60, 600, d);
      const mount = ridged2(x * 0.0022 + 5, z * 0.0022, 5, seed) * 360 * far;
      const hills = fbm2(x * 0.01, z * 0.01, 4, seed + 4) * 26 * near;
      return -0.12 + (mount + hills) * near;
    };
    const ground = noiseSurface({ size: 256, base: [120, 120, 112], variation: 30, freq: 8, seed, normalStrength: 3, repeat: [260, 260] });
    const terrainMat = new THREE.MeshStandardMaterial({ map: ground.map, normalMap: ground.normalMap, roughness: 0.95 });
    const grass = new THREE.Color(0x4a6236), dry = new THREE.Color(0x7a7550), rock = new THREE.Color(0x8a8784), snow = new THREE.Color(0xf4f7fb);
    const terrain = buildTerrain({
      size: 3000,
      segments: 300,
      heightFn,
      material: terrainMat,
      colorFn: (c, x, y, z, ny) => {
        c.copy(grass).lerp(dry, clamp(fbm2(x * 0.01, z * 0.01, 2, 3), 0, 1) * 0.6);
        c.lerp(rock, smoothstep(0.85, 0.6, ny));
        c.lerp(rock, smoothstep(120, 200, y) * 0.8);
        c.lerp(snow, smoothstep(190, 240, y + fbm2(x * 0.02, z * 0.02, 2, 9) * 40) * smoothstep(0.45, 0.75, ny));
      },
    });
    group.add(terrain);
    // horizon range
    const rangeMat = new THREE.MeshStandardMaterial({ color: 0x7d8a99, roughness: 1, flatShading: true });
    for (let i = 0; i < 28; i++) {
      const ang = (i / 28) * Math.PI * 2 + R() * 0.2;
      const dist = 1900 + R() * 900;
      const h = 300 + R() * 600;
      const g = new THREE.ConeGeometry(300 + R() * 300, h, 7, 3);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const n = 1 + (fbm2(p.getX(k) * 0.01 + i, p.getY(k) * 0.01, 2, i) - 0.5) * 0.6;
        p.setX(k, p.getX(k) * n);
        p.setZ(k, p.getZ(k) * n);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, rangeMat);
      m.position.set(Math.cos(ang) * dist, h / 2 - 20, Math.sin(ang) * dist);
      group.add(m);
    }

    const rt = roadTexture({ markings: 'yellow', worn: 0.25, seed });
    group.add(buildRoadMesh(curve, roadWidth, new THREE.MeshStandardMaterial({ map: rt.map, roughnessMap: rt.roughnessMap, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), { y: 0.02 }));
    group.add(buildRoadMesh(curve, roadWidth + 3, new THREE.MeshStandardMaterial({ color: 0x5a5448, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), { y: 0.0 }));

    // guard rails (posts + rail ribbons) on both sides
    const posts = [];
    const railMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const pts = [];
      alongRoad(curve, 4, s * (half + 0.9), (p) => {
        posts.push({ x: p.x, y: 0, z: p.z });
        pts.push(p);
      });
      const pos = [], idx = [];
      pts.forEach((p, i) => {
        pos.push(p.x, 0.55, p.z, p.x, 0.85, p.z);
        if (i < pts.length - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const rail = new THREE.Mesh(g, railMat);
      rail.castShadow = true;
      group.add(rail);
    }
    const postGeo = new THREE.BoxGeometry(0.12, 0.9, 0.12);
    postGeo.translate(0, 0.45, 0);
    group.add(instanced(postGeo, new THREE.MeshStandardMaterial({ color: 0x777b80, metalness: 0.6, roughness: 0.5 }), posts));

    // pine forest
    const cone1 = new THREE.ConeGeometry(1.6, 3.4, 8);
    cone1.translate(0, 3.2, 0);
    const cone2 = new THREE.ConeGeometry(1.25, 2.8, 8);
    cone2.translate(0, 5.0, 0);
    const cone3 = new THREE.ConeGeometry(0.8, 2.2, 8);
    cone3.translate(0, 6.6, 0);
    const trunk = new THREE.CylinderGeometry(0.16, 0.22, 2, 6);
    trunk.translate(0, 1, 0);
    const leaves = mergeGeometries([cone1, cone2, cone3]);
    const trees = [], trunks = [], rocks = [];
    let tries = 0;
    while (trees.length < 2600 && tries++ < 20000) {
      const x = (R() - 0.5) * 1600, z = (R() - 0.5) * 2200;
      const d = field.distance(x, z);
      if (d < half + 7) continue;
      const y = heightFn(x, z);
      if (y > 170) continue;
      const slope = Math.abs(heightFn(x + 2, z) - y) + Math.abs(heightFn(x, z + 2) - y);
      if (slope > 3.2) {
        if (R() < 0.3) rocks.push({ x, y, z, s: 1 + R() * 4, ry: R() * 6 });
        continue;
      }
      const s = 0.7 + R() * 1.1;
      trees.push({ x, y: y - 0.2, z, s, ry: R() * 6, color: R() < 0.5 ? '#2f4a2a' : '#26402a' });
      trunks.push({ x, y: y - 0.2, z, s });
    }
    group.add(instanced(leaves, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), trees));
    group.add(instanced(trunk, new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1 }), trunks, { cast: false }));
    group.add(instanced(rockGeometry(seed, 1), new THREE.MeshStandardMaterial({ color: 0x8a8682, roughness: 0.9, flatShading: true }), rocks));

    return { group, curve, roadWidth, field, groundHeight: heightFn, emitters: [] };
  },
};
