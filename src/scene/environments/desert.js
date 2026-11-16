import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm2, rng, clamp } from '../../anim/math.js';
import { noiseSurface, roadTexture, RoadField, buildRoadMesh, buildTerrain, roadMask, instanced, rockGeometry, roadCurve, alongRoad } from './common.js';

export default {
  id: 'desert',
  name: 'Desert Highway',
  description: 'Endless sun-baked highway, dunes, mesas and golden-hour haze.',
  thumb: 'linear-gradient(180deg,#f2a65a 0%,#f6c88a 45%,#c98d55 55%,#7a4a2a 100%)',
  preset: {
    lighting: { sunElevation: 11, sunAzimuth: 235, sunIntensity: 3.4, sunColor: '#ffcf9a', ambient: 0.55, envIntensity: 0.9, exposure: 0.9, headlights: false },
    fog: { density: 0.0011, color: '#e0b88e' },
    sky: { type: 'physical', turbidity: 9, rayleigh: 1.6, mie: 0.007, mieG: 0.86, clouds: 0.15 },
    hemi: { sky: '#ffe2bd', ground: '#8a5a35' },
    particles: { dust: '#cfa676', smoke: '#9a8a7a', ambient: { color: '#ffd9a8', amount: 0.8, size: 0.06, wind: [1.6, 0.05, 0.6] } },
    grading: { temperature: 0.18, tint: 0.02, contrast: 1.12, saturation: 1.08, shadowsColor: '#1d4c5c', highlightsColor: '#ffae66', splitAmount: 0.28 },
    envDust: 1.4,
  },
  build({ seed = 7, roadWidth = 11 }) {
    const group = new THREE.Group();
    const R = rng(seed);
    const curve = roadCurve([
      [0, -1000], [25, -700], [-15, -420], [0, -150], [25, 120], [90, 380], [170, 620], [210, 860], [215, 1100],
    ]);
    const field = new RoadField(curve, roadWidth);
    const half = roadWidth / 2;
    const heightFn = (x, z) => {
      const d = field.distance(x, z);
      const m = roadMask(d, half + 8, 45);
      const dunes = Math.pow(fbm2(x * 0.0045 + 3, z * 0.0045, 4, seed), 2.2) * 38 + fbm2(x * 0.02, z * 0.02, 3, seed + 3) * 3;
      return -0.12 + m * dunes;
    };

    // terrain
    const sand = noiseSurface({ size: 256, base: [196, 152, 104], variation: 22, freq: 6, seed, normalStrength: 3, repeat: [220, 220] });
    const terrainMat = new THREE.MeshStandardMaterial({ map: sand.map, normalMap: sand.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.95, metalness: 0 });
    const terrain = buildTerrain({
      size: 2600,
      segments: 280,
      heightFn,
      material: terrainMat,
      colorFn: (c, x, y) => c.setRGB(1, 0.97 - clamp(y / 80, 0, 0.1), 0.94 - clamp(y / 60, 0, 0.12)),
    });
    group.add(terrain);
    const outer = new THREE.Mesh(new THREE.RingGeometry(1250, 9000, 64, 1), new THREE.MeshStandardMaterial({ color: 0xc2955f, roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = 2;
    group.add(outer);

    // road
    const rt = roadTexture({ markings: 'yellow', worn: 0.5, seed });
    const roadMat = new THREE.MeshStandardMaterial({ map: rt.map, roughnessMap: rt.roughnessMap, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    group.add(buildRoadMesh(curve, roadWidth, roadMat, { y: 0.02 }));
    // sandy shoulders
    const shoulderMat = new THREE.MeshStandardMaterial({ color: 0xa88760, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    group.add(buildRoadMesh(curve, roadWidth + 5, shoulderMat, { y: 0.0 }));

    // mesas on the horizon
    const mesaMat = new THREE.MeshStandardMaterial({ color: 0xa4573a, roughness: 0.95, flatShading: true });
    for (let i = 0; i < 14; i++) {
      const ang = R() * Math.PI * 2;
      const dist = 700 + R() * 600;
      const h = 60 + R() * 140, rTop = 60 + R() * 140;
      const g = new THREE.CylinderGeometry(rTop, rTop * (1.25 + R() * 0.4), h, 11, 6);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const y = p.getY(k);
        const n = 1 + (fbm2(p.getX(k) * 0.02 + i, p.getZ(k) * 0.02 + y * 0.03, 3, i) - 0.5) * 0.5;
        p.setX(k, p.getX(k) * n);
        p.setZ(k, p.getZ(k) * n);
        // stratified layers
        p.setY(k, y + Math.sin(y * 0.3) * 1.5);
      }
      g.computeVertexNormals();
      const mesa = new THREE.Mesh(g, mesaMat);
      mesa.position.set(Math.cos(ang) * dist, h / 2 - 4, Math.sin(ang) * dist);
      if (field.distance(mesa.position.x, mesa.position.z) < rTop * 1.6 + 60) continue;
      mesa.castShadow = false;
      group.add(mesa);
    }

    // rocks + shrubs
    const rocks = [], shrubs = [], cacti = [];
    for (let i = 0; i < 700; i++) {
      const x = (R() - 0.5) * 1200, z = (R() - 0.5) * 2000;
      const d = field.distance(x, z);
      if (d < half + 6) continue;
      const y = heightFn(x, z);
      const r = R();
      if (r < 0.35) rocks.push({ x, y: y + 0.1, z, s: [0.4 + R() * 2.5, 0.3 + R() * 1.6, 0.4 + R() * 2.5], ry: R() * 6 });
      else if (r < 0.85) shrubs.push({ x, y: y + 0.15, z, s: [0.4 + R() * 0.7, 0.25 + R() * 0.35, 0.4 + R() * 0.7], ry: R() * 6, color: R() < 0.5 ? '#6b6a3c' : '#7c6a44' });
      else if (d > half + 10) cacti.push({ x, y, z, s: 0.7 + R() * 0.7, ry: R() * 6 });
    }
    group.add(instanced(rockGeometry(seed, 1), new THREE.MeshStandardMaterial({ color: 0x9a6a48, roughness: 0.9, flatShading: true }), rocks));
    group.add(instanced(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), shrubs, { cast: true }));
    const trunk = new THREE.CylinderGeometry(0.28, 0.32, 5, 10);
    trunk.translate(0, 2.5, 0);
    const armA = new THREE.CylinderGeometry(0.2, 0.22, 1.8, 8);
    armA.translate(0.7, 3.2, 0);
    const armA2 = new THREE.CylinderGeometry(0.2, 0.2, 0.8, 8);
    armA2.rotateZ(Math.PI / 2);
    armA2.translate(0.35, 2.4, 0);
    const armB = new THREE.CylinderGeometry(0.18, 0.2, 1.4, 8);
    armB.translate(-0.6, 3.6, 0);
    const armB2 = new THREE.CylinderGeometry(0.18, 0.18, 0.6, 8);
    armB2.rotateZ(Math.PI / 2);
    armB2.translate(-0.3, 3.0, 0);
    const cactusGeo = mergeGeometries([trunk, armA, armA2, armB, armB2]);
    group.add(instanced(cactusGeo, new THREE.MeshStandardMaterial({ color: 0x4f6b3a, roughness: 0.8 }), cacti));

    // telephone poles + sagging wires
    const pole = new THREE.CylinderGeometry(0.12, 0.16, 9, 8);
    pole.translate(0, 4.5, 0);
    const bar = new THREE.BoxGeometry(2.2, 0.14, 0.14);
    bar.translate(0, 8.3, 0);
    const poleGeo = mergeGeometries([pole, bar]);
    const poles = [], tops = [];
    alongRoad(curve, 48, half + 7, (p, yaw) => {
      poles.push({ x: p.x, y: -0.1, z: p.z, ry: yaw + Math.PI / 2 });
      tops.push(p.clone().setY(8.3));
    });
    group.add(instanced(poleGeo, new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9 }), poles));
    const wirePts = [];
    for (let i = 0; i < tops.length - 1; i++) {
      for (const off of [-0.9, 0, 0.9]) {
        const a = tops[i], b = tops[i + 1];
        const dir = new THREE.Vector3().subVectors(b, a);
        const side = new THREE.Vector3(dir.z, 0, -dir.x).normalize().multiplyScalar(off);
        for (let k = 0; k < 8; k++) {
          const t0 = k / 8, t1 = (k + 1) / 8;
          const p0 = a.clone().lerp(b, t0).add(side);
          const p1 = a.clone().lerp(b, t1).add(side);
          p0.y -= Math.sin(t0 * Math.PI) * 1.2;
          p1.y -= Math.sin(t1 * Math.PI) * 1.2;
          wirePts.push(p0, p1);
        }
      }
    }
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wirePts), new THREE.LineBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.7 })));

    // reflective road posts
    const posts = [];
    alongRoad(curve, 25, half + 1.2, (p) => posts.push({ x: p.x, y: 0, z: p.z }));
    alongRoad(curve, 25, -half - 1.2, (p) => posts.push({ x: p.x, y: 0, z: p.z }));
    const postGeo = new THREE.BoxGeometry(0.12, 1.1, 0.12);
    postGeo.translate(0, 0.55, 0);
    group.add(instanced(postGeo, new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 }), posts));

    return { group, curve, roadWidth, field, groundHeight: heightFn, emitters: [] };
  },
};
