import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../../anim/math.js';
import { noiseSurface, roadTexture, facadeTexture, RoadField, buildRoadMesh, instanced, roadCurve, alongRoad, canvasTexture, Batcher } from './common.js';
import { buildingGeometry, offsetSamples } from './city.js';

function neonTexture(text, color, seed) {
  return canvasTexture(
    512,
    128,
    (g, w, h) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      g.font = 'bold 78px "Arial Black", Impact, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = color;
      g.shadowBlur = 18;
      g.strokeStyle = color;
      g.lineWidth = 5;
      g.strokeText(text, w / 2, h / 2 + 4);
      g.fillStyle = '#ffffff';
      g.globalAlpha = 0.85;
      g.fillText(text, w / 2, h / 2 + 4);
    },
    { repeat: [1, 1] }
  );
}

const SIGNS = ['HOTEL', 'BAR', 'NOODLES', '24/7', 'GARAGE', 'CLUB', 'MOTEL', 'DRIVE', 'NEON', 'ARCADE'];
const SIGN_COLORS = ['#ff2d95', '#2de2ff', '#ffb02d', '#7d5cff', '#3dff8a', '#ff4040'];

export default {
  id: 'nightcity',
  name: 'Night City',
  description: 'Rain-soaked boulevard, neon signs, glowing towers and street lights.',
  thumb: 'linear-gradient(180deg,#05070f 0%,#141a3a 45%,#3a1440 60%,#0a0a12 100%)',
  preset: {
    lighting: { sunElevation: 32, sunAzimuth: 300, sunIntensity: 0.8, sunColor: '#9fb4ff', ambient: 0.6, envIntensity: 1.6, exposure: 0.95, headlights: true },
    fog: { density: 0.0042, color: '#141a2c' },
    sky: { type: 'night', top: '#02050f', horizon: '#2a3566', glow: '#7a3a80', stars: 0.6 },
    hemi: { sky: '#5a6ea8', ground: '#1c1626' },
    particles: { dust: '#3a3f4a', smoke: '#5a5f70', ambient: { color: '#9fc4ff', amount: 0.9, size: 0.04, wind: [0.4, -3.5, 0.2] } },
    grading: { temperature: -0.12, tint: 0.05, contrast: 1.14, saturation: 1.15, shadowsColor: '#0f2a4a', highlightsColor: '#ff7ad1', splitAmount: 0.16 },
    envDust: 0.2,
  },
  build({ seed = 31, roadWidth = 16 }) {
    const group = new THREE.Group();
    const R = rng(seed);
    const curve = roadCurve([[0, -950], [0, -500], [-8, -150], [-35, 200], [-40, 600], [-30, 950]]);
    const field = new RoadField(curve, roadWidth);
    const half = roadWidth / 2;

    const ground = noiseSurface({ size: 256, base: [40, 40, 44], variation: 14, freq: 6, seed, normalStrength: 2, repeat: [300, 300] });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ map: ground.map, normalMap: ground.normalMap, roughness: 0.6 }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.05;
    plane.receiveShadow = true;
    group.add(plane);

    // wet reflective asphalt
    const rt = roadTexture({ markings: 'lanes', wet: true, worn: 0.4, seed });
    group.add(
      buildRoadMesh(curve, roadWidth, new THREE.MeshStandardMaterial({ map: rt.map, roughnessMap: rt.roughnessMap, roughness: 0.38, metalness: 0.1, envMapIntensity: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), { y: 0.02 })
    );
    const swTex = noiseSurface({ size: 128, base: [70, 70, 76], variation: 12, freq: 10, seed: seed + 3, repeat: [1, 40] });
    const swMat = new THREE.MeshStandardMaterial({ map: swTex.map, normalMap: swTex.normalMap, roughness: 0.45, metalness: 0.05 });
    for (const s of [-1, 1]) {
      const pts = offsetSamples(curve, s * (half + 3), 10).map(({ p }) => p);
      group.add(buildRoadMesh(new THREE.CatmullRomCurve3(pts), 6, swMat, { y: 0.15 }));
    }

    // towers with lit windows
    const facades = [0, 1, 2, 3, 4].map((i) => facadeTexture({ seed: seed + i * 5, wall: ['#1c1e26', '#22222a', '#181a22', '#262430', '#1a1d24'][i], litChance: 0.3 + i * 0.05, broken: 0, cols: 8, rows: 14, warm: i % 2 === 0, neon: true }));
    const mats = facades.map((f) => new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.3 }));
    const batch = new Batcher();
    const signs = [];
    for (const side of [-1, 1]) {
      let d = 20;
      const len = curve.getLength();
      while (d < len - 20) {
        const w = 18 + R() * 22;
        const u = d / len;
        const p = curve.getPointAt(u);
        const tan = curve.getTangentAt(u);
        const right = new THREE.Vector3(tan.z, 0, -tan.x).normalize().multiplyScalar(side);
        const depth = 18 + R() * 20;
        const h = 25 + Math.pow(R(), 1.5) * 140;
        const off = half + 6.5 + depth / 2;
        const pos = p.clone().addScaledVector(right, off);
        const yaw = Math.atan2(tan.x, tan.z);
        batch.add(buildingGeometry(w, h, depth, [18, 24]), mats[Math.floor(R() * mats.length)], [pos.x, -0.05, pos.z], [0, yaw, 0]);
        if (R() < 0.55) {
          // neon sign facing the street
          const sp = p.clone().addScaledVector(right, half + 6.3);
          signs.push({ pos: sp, yaw: yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2), h: 4 + R() * 10, text: SIGNS[Math.floor(R() * SIGNS.length)], color: SIGN_COLORS[Math.floor(R() * SIGN_COLORS.length)] });
        }
        d += w + 3 + R() * 6;
      }
    }
    const farMat = new THREE.MeshStandardMaterial({ map: facades[2].map, emissiveMap: facades[2].emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.6 });
    for (let i = 0; i < 90; i++) {
      const ang = R() * Math.PI * 2, dist = 250 + R() * 700;
      const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist * 1.3;
      if (field.distance(x, z) < 80) continue;
      const h = 40 + R() * 220, w = 25 + R() * 35;
      batch.add(buildingGeometry(w, h, w, [18, 24]), farMat, [x, 0, z], [0, R() * 3, 0]);
    }
    batch.build(group);

    const signGeo = new THREE.PlaneGeometry(1, 0.25);
    for (const s of signs) {
      const tex = neonTexture(s.text, s.color, 1);
      const m = new THREE.Mesh(signGeo, new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(s.color).multiplyScalar(1.5), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.position.set(s.pos.x, s.h, s.pos.z);
      m.rotation.y = s.yaw;
      m.scale.setScalar(8 + R() * 4);
      group.add(m);
    }

    // street lamps (emissive heads) + a pool of real lights moved to the nearest lamps
    const lampPos = [];
    const poles = [], heads = [];
    for (const s of [-1, 1]) {
      alongRoad(curve, 28, s * (half + 1.0), (p, yaw) => {
        poles.push({ x: p.x, y: 0, z: p.z, ry: yaw + (s > 0 ? Math.PI : 0) });
        const tan = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const right = new THREE.Vector3(tan.z, 0, -tan.x).multiplyScalar(s);
        const head = p.clone().addScaledVector(right, -2.2).setY(8.6);
        heads.push({ x: head.x, y: head.y, z: head.z, ry: yaw });
        lampPos.push(head);
      });
    }
    const pole = new THREE.CylinderGeometry(0.1, 0.14, 9, 8);
    pole.translate(0, 4.5, 0);
    const arm = new THREE.BoxGeometry(0.12, 0.12, 2.4);
    arm.translate(0, 8.8, 0);
    arm.rotateY(Math.PI / 2);
    arm.translate(-1.1, 0, 0);
    group.add(instanced(mergeGeometries([pole, arm]), new THREE.MeshStandardMaterial({ color: 0x23252b, metalness: 0.7, roughness: 0.4 }), poles));
    group.add(instanced(new THREE.BoxGeometry(0.9, 0.15, 0.4), new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffd08a, emissiveIntensity: 9 }), heads, { cast: false }));

    const pool = [];
    for (let i = 0; i < 8; i++) {
      const l = new THREE.SpotLight(0xffd6a0, 0, 30, 0.9, 0.6, 1.4);
      l.castShadow = false;
      group.add(l, l.target);
      pool.push(l);
    }
    const tmp = new THREE.Vector3();
    const update = (t, focus) => {
      if (!focus) return;
      const sorted = lampPos.map((p) => [p, tmp.copy(p).sub(focus).lengthSq()]).sort((a, b) => a[1] - b[1]);
      pool.forEach((l, i) => {
        const e = sorted[i];
        if (!e) return (l.intensity = 0);
        l.position.copy(e[0]);
        l.target.position.set(e[0].x, 0, e[0].z);
        l.intensity = 550;
      });
    };

    // parked cars with tail lights
    const cars = [], tails = [];
    // parked cars sit on the far kerb only, clear of the hero's lane and its cameras
    for (let i = 0; i < 16; i++) {
      const u = R();
      const p = curve.getPointAt(u);
      const tan = curve.getTangentAt(u);
      const s = 1;
      const right = new THREE.Vector3(tan.z, 0, -tan.x).normalize().multiplyScalar(s);
      const q = p.clone().addScaledVector(right, half - 1.3);
      const yaw = Math.atan2(tan.x, tan.z);
      const col = ['#1a1a1e', '#3a0d12', '#d8d8dc', '#0d1f3a', '#2a2a2a'][Math.floor(R() * 5)];
      cars.push({ x: q.x, y: 0.6, z: q.z, s: [1.85, 0.75, 4.4], ry: yaw, color: col });
      cars.push({ x: q.x, y: 1.25, z: q.z - tan.z * 0.3, s: [1.6, 0.55, 2.2], ry: yaw, color: col });
      tails.push({ x: q.x - tan.x * 2.21, y: 0.75, z: q.z - tan.z * 2.21, s: [1.5, 0.08, 0.04], ry: yaw });
    }
    group.add(instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.25 }), cars));
    group.add(instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a1a, emissiveIntensity: 4 }), tails, { cast: false }));

    // steam vents
    const emitters = [];
    for (let i = 0; i < 6; i++) {
      const u = 0.15 + R() * 0.7;
      const p = curve.getPointAt(u);
      const tan = curve.getTangentAt(u);
      const right = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
      const q = p.clone().addScaledVector(right, (R() - 0.5) * half);
      emitters.push({ position: [q.x, 0.1, q.z], rate: 7, radius: 1.2, size: 5, opacity: 0.22, color: '#9aa4c0', wind: 0.4 });
    }
    return { group, curve, roadWidth, field, groundHeight: () => 0, emitters, update };
  },
};
