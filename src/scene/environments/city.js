import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, fbm2 } from '../../anim/math.js';
import { noiseSurface, roadTexture, facadeTexture, RoadField, buildRoadMesh, instanced, rockGeometry, roadCurve, alongRoad, Batcher } from './common.js';

/** Box geometry whose UVs repeat in world units so facades don't stretch. */
export function buildingGeometry(w, h, d, tile = [12, 20]) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const nrm = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    const sx = ny > 0.5 ? w : nx > 0.5 ? d : w;
    const sy = ny > 0.5 ? d : h;
    uv.setXY(i, (uv.getX(i) * sx) / tile[0], (uv.getY(i) * sy) / tile[1]);
  }
  g.translate(0, h / 2, 0);
  return g;
}

export function offsetSamples(curve, offset, spacing = 3) {
  const out = [];
  alongRoad(curve, spacing, offset, (p, yaw) => out.push({ p, yaw }));
  return out;
}

export default {
  id: 'city',
  name: 'Abandoned City',
  description: 'Ruined streets, burning wrecks, ash in the air and heavy haze.',
  thumb: 'linear-gradient(180deg,#5d5a55 0%,#8a8174 40%,#4a4540 60%,#1d1b19 100%)',
  preset: {
    lighting: { sunElevation: 9, sunAzimuth: 120, sunIntensity: 1.6, sunColor: '#ffc7a0', ambient: 0.75, envIntensity: 0.8, exposure: 0.95, headlights: true },
    fog: { density: 0.0065, color: '#7d7468' },
    sky: { type: 'physical', turbidity: 20, rayleigh: 3.2, mie: 0.02, mieG: 0.9, clouds: 0.75 },
    hemi: { sky: '#a8a094', ground: '#3a332c' },
    particles: { dust: '#8c8378', smoke: '#4f4a46', ambient: { color: '#d8cfc4', amount: 1.0, size: 0.07, wind: [0.8, -0.6, 0.3] } },
    grading: { temperature: 0.04, tint: -0.02, contrast: 1.16, saturation: 0.72, shadowsColor: '#22343a', highlightsColor: '#e8b48a', splitAmount: 0.2 },
    envDust: 0.8,
  },
  build({ seed = 11, roadWidth = 14 }) {
    const group = new THREE.Group();
    const R = rng(seed);
    const curve = roadCurve([[0, -900], [0, -400], [12, -100], [40, 200], [48, 520], [40, 900]]);
    const field = new RoadField(curve, roadWidth);
    const half = roadWidth / 2;

    // ground
    const ground = noiseSurface({ size: 256, base: [92, 88, 82], variation: 24, freq: 5, seed, normalStrength: 2.5, repeat: [300, 300] });
    const groundMat = new THREE.MeshStandardMaterial({ map: ground.map, normalMap: ground.normalMap, roughness: 0.95 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), groundMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.05;
    plane.receiveShadow = true;
    group.add(plane);

    const rt = roadTexture({ markings: 'lanes', worn: 1.0, seed });
    group.add(buildRoadMesh(curve, roadWidth, new THREE.MeshStandardMaterial({ map: rt.map, roughnessMap: rt.roughnessMap, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), { y: 0.02 }));
    // sidewalks (raised curb)
    const swTex = noiseSurface({ size: 128, base: [120, 116, 110], variation: 18, freq: 10, seed: seed + 2, repeat: [1, 40] });
    const swMat = new THREE.MeshStandardMaterial({ map: swTex.map, normalMap: swTex.normalMap, roughness: 0.9 });
    for (const s of [-1, 1]) {
      const pts = offsetSamples(curve, s * (half + 2.5), 10).map(({ p }) => p);
      const c = new THREE.CatmullRomCurve3(pts);
      group.add(buildRoadMesh(c, 5, swMat, { y: 0.16 }));
    }

    // buildings
    const facades = [0, 1, 2, 3].map((i) =>
      facadeTexture({ seed: seed + i * 7, wall: ['#6e655c', '#5a5550', '#7a6d60', '#4e4a47'][i], litChance: 0.0, broken: 0.45, cols: 4, rows: 6 })
    );
    const mats = facades.map((f) => new THREE.MeshStandardMaterial({ map: f.map, roughness: 0.92 }));
    const scorch = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 1 });
    const batch = new Batcher();
    const placeBuildings = (side) => {
      let d = 30;
      const len = curve.getLength();
      while (d < len - 30) {
        const w = 14 + R() * 18;
        const u = d / len;
        const p = curve.getPointAt(u);
        const tan = curve.getTangentAt(u);
        const right = new THREE.Vector3(tan.z, 0, -tan.x).normalize().multiplyScalar(side);
        const depth = 14 + R() * 20;
        const h = 8 + Math.pow(R(), 1.6) * 55;
        const off = half + 5.5 + depth / 2 + R() * 2;
        const pos = p.clone().addScaledVector(right, off);
        const yaw = Math.atan2(tan.x, tan.z);
        batch.add(buildingGeometry(w, h, depth), mats[Math.floor(R() * mats.length)], [pos.x, -0.05, pos.z], [0, yaw, 0]);
        // destroyed top: tilted slab + broken chunk
        if (R() < 0.6) {
          batch.add(buildingGeometry(w * (0.4 + R() * 0.4), 0.6, depth * 0.8), scorch, [pos.x + (R() - 0.5) * 3, h + 0.2, pos.z + (R() - 0.5) * 3], [(R() - 0.5) * 0.6, yaw, (R() - 0.5) * 0.6]);
        }
        if (R() < 0.5) {
          batch.add(buildingGeometry(w * 0.35, h * (0.2 + R() * 0.3), depth * 0.5), mats[Math.floor(R() * mats.length)], [pos.x, h - 0.1, pos.z], [0, yaw + (R() - 0.5) * 0.3, 0]);
        }
        d += w + 2 + (R() < 0.15 ? 18 : R() * 4);
      }
    };
    placeBuildings(1);
    placeBuildings(-1);
    // distant skyline silhouettes
    const farMat = new THREE.MeshStandardMaterial({ color: 0x48443f, roughness: 1 });
    for (let i = 0; i < 70; i++) {
      const ang = R() * Math.PI * 2, dist = 250 + R() * 600;
      const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist * 1.4;
      if (field.distance(x, z) < 70) continue;
      const h = 20 + R() * 90, w = 20 + R() * 30;
      batch.add(buildingGeometry(w, h, w), farMat, [x, 0, z], [0, R() * 3, 0]);
    }
    batch.build(group);

    // rubble, wrecks, barriers, broken lamps
    const rubble = [], wrecks = [], cabins = [], barriers = [], lamps = [];
    for (let i = 0; i < 900; i++) {
      const s = R() < 0.5 ? -1 : 1;
      const u = R();
      const p = curve.getPointAt(u);
      const tan = curve.getTangentAt(u);
      const right = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
      const off = s * (half - 1 + R() * 9);
      const q = p.clone().addScaledVector(right, off);
      if (Math.abs(off) < half - 1.5 && R() < 0.85) continue; // keep the driving line mostly clear
      rubble.push({ x: q.x, y: 0.05, z: q.z, s: [0.15 + R() * 0.8, 0.1 + R() * 0.5, 0.15 + R() * 0.8], ry: R() * 6, color: R() < 0.5 ? '#6a645e' : '#55504b' });
    }
    const wreckCols = ['#4a3328', '#5b3a26', '#3a3632', '#5e4a3a'];
    for (let i = 0; i < 26; i++) {
      const u = 0.05 + R() * 0.9;
      const p = curve.getPointAt(u);
      const tan = curve.getTangentAt(u);
      const right = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
      const s = R() < 0.5 ? -1 : 1;
      const q = p.clone().addScaledVector(right, s * (half - 1.6));
      const yaw = Math.atan2(tan.x, tan.z) + (R() - 0.5) * 0.9;
      const flipped = R() < 0.2;
      const col = wreckCols[Math.floor(R() * wreckCols.length)];
      wrecks.push({ x: q.x, y: flipped ? 1.3 : 0.55, z: q.z, s: [1.8, 0.8, 4.3], ry: yaw, rz: flipped ? Math.PI : (R() - 0.5) * 0.15, color: col });
      cabins.push({ x: q.x, y: flipped ? 0.55 : 1.25, z: q.z, s: [1.6, 0.6, 2.2], ry: yaw, rz: flipped ? Math.PI : 0, color: col });
    }
    alongRoad(curve, 34, half + 1.2, (p, yaw) => lamps.push({ x: p.x, y: 0, z: p.z, ry: yaw, rz: (R() - 0.5) * 0.35 }));
    alongRoad(curve, 34, -half - 1.2, (p, yaw) => lamps.push({ x: p.x, y: 0, z: p.z, ry: yaw + Math.PI, rz: (R() - 0.5) * 0.35 }));
    for (let i = 0; i < 40; i++) {
      const u = R();
      const p = curve.getPointAt(u);
      const tan = curve.getTangentAt(u);
      const right = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
      const q = p.clone().addScaledVector(right, (R() < 0.5 ? -1 : 1) * (half + 0.5));
      barriers.push({ x: q.x, y: 0, z: q.z, ry: Math.atan2(tan.x, tan.z) + (R() - 0.5) * 0.5, color: R() < 0.3 ? '#9a3a2a' : '#a9a49c' });
    }
    group.add(instanced(rockGeometry(seed, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), rubble));
    const rusty = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.35 });
    group.add(instanced(new THREE.BoxGeometry(1, 1, 1), rusty, wrecks));
    group.add(instanced(new THREE.BoxGeometry(1, 1, 1), rusty, cabins));
    const jersey = new THREE.CylinderGeometry(0.25, 0.4, 0.85, 4, 1);
    jersey.rotateY(Math.PI / 4);
    jersey.scale(1, 1, 5);
    jersey.translate(0, 0.42, 0);
    group.add(instanced(jersey, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), barriers));
    const lampPole = new THREE.CylinderGeometry(0.08, 0.12, 8, 8);
    lampPole.translate(0, 4, 0);
    const lampArm = new THREE.BoxGeometry(0.1, 0.1, 2);
    lampArm.translate(0, 7.9, -1);
    group.add(instanced(mergeGeometries([lampPole, lampArm]), new THREE.MeshStandardMaterial({ color: 0x2b2a28, metalness: 0.6, roughness: 0.6 }), lamps));

    // fires: flickering lights + smoke columns
    const emitters = [];
    const fireLights = [];
    for (let i = 0; i < 7; i++) {
      const u = 0.1 + (i / 7) * 0.8 + R() * 0.05;
      const p = curve.getPointAt(Math.min(0.97, u));
      const tan = curve.getTangentAt(Math.min(0.97, u));
      const right = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
      const q = p.clone().addScaledVector(right, (R() < 0.5 ? -1 : 1) * (half + 3 + R() * 6));
      emitters.push({ position: [q.x, 0.5, q.z], rate: 10, radius: 2, size: 9, opacity: 0.4, color: '#2f2b28', wind: 1.2 });
      const light = new THREE.PointLight(0xff7a2a, 120, 40, 1.8);
      light.position.set(q.x, 1.5, q.z);
      group.add(light);
      const ember = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff5a10, emissiveIntensity: 4 }));
      ember.position.set(q.x, 0.3, q.z);
      ember.scale.y = 0.4;
      group.add(ember);
      fireLights.push({ light, base: 120, seed: i * 3.3 });
    }

    const update = (t) => {
      for (const f of fireLights) f.light.intensity = f.base * (0.75 + 0.25 * fbm2(t * 6 + f.seed, f.seed, 2, 1) * 2 - 0.1);
    };
    return { group, curve, roadWidth, field, groundHeight: () => 0, emitters, update };
  },
};
