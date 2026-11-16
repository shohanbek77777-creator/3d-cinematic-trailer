import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm2, rng, smoothstep } from '../../anim/math.js';
import { noiseSurface, roadTexture, RoadField, buildRoadMesh, buildTerrain, instanced, roadCurve, alongRoad, canvasTexture, Batcher } from './common.js';

function corrugated() {
  return canvasTexture(
    256,
    256,
    (g, w, h) => {
      for (let x = 0; x < w; x++) {
        const v = 95 + Math.sin((x / w) * Math.PI * 32) * 22;
        g.fillStyle = `rgb(${v * 0.82},${v * 0.86},${v * 0.72})`;
        g.fillRect(x, 0, 1, h);
      }
      for (let i = 0; i < 120; i++) {
        g.fillStyle = `rgba(70,45,25,${Math.random() * 0.25})`;
        g.fillRect(Math.random() * w, Math.random() * h, 3 + Math.random() * 20, 10 + Math.random() * 60);
      }
    },
    { repeat: [6, 1] }
  );
}

function chainLink() {
  return canvasTexture(
    64,
    64,
    (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(190,195,200,1)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(w, h);
      g.moveTo(w, 0);
      g.lineTo(0, h);
      g.stroke();
    },
    { repeat: [1, 1] }
  );
}

export default {
  id: 'military',
  name: 'Military Base',
  description: 'Dusty forward base at dusk: hangars, barriers, floodlights and tank traps.',
  thumb: 'linear-gradient(180deg,#d9875a 0%,#a8705a 35%,#6b6248 55%,#2f2c22 100%)',
  preset: {
    lighting: { sunElevation: 6, sunAzimuth: 255, sunIntensity: 2.8, sunColor: '#ffb27a', ambient: 0.6, envIntensity: 0.85, exposure: 0.7, headlights: true },
    fog: { density: 0.0019, color: '#b58a6a' },
    sky: { type: 'physical', turbidity: 11, rayleigh: 2.2, mie: 0.009, mieG: 0.88, clouds: 0.45 },
    hemi: { sky: '#e0b494', ground: '#4a3f2e' },
    particles: { dust: '#a08a68', smoke: '#6e6a62', ambient: { color: '#ffd2a8', amount: 0.9, size: 0.06, wind: [1.4, 0.0, 0.5] } },
    grading: { temperature: 0.1, tint: 0.03, contrast: 1.18, saturation: 0.82, shadowsColor: '#26383a', highlightsColor: '#ffb070', splitAmount: 0.25 },
    envDust: 1.2,
  },
  build({ seed = 41, roadWidth = 10 }) {
    const group = new THREE.Group();
    const R = rng(seed);
    const curve = roadCurve([[0, -950], [0, -500], [10, -200], [30, 60], [28, 300], [-25, 540], [-40, 800], [-35, 1000]]);
    const field = new RoadField(curve, roadWidth);
    const half = roadWidth / 2;
    const heightFn = (x, z) => {
      const d = field.distance(x, z);
      const m = smoothstep(half + 10, half + 60, d) * smoothstep(120, 260, Math.hypot(x - 80, z));
      return -0.12 + m * (fbm2(x * 0.006, z * 0.006, 4, seed) * 40 + fbm2(x * 0.03, z * 0.03, 2, seed + 2) * 3);
    };
    const dirt = noiseSurface({ size: 256, base: [124, 104, 78], variation: 26, freq: 7, seed, normalStrength: 3, repeat: [240, 240] });
    group.add(
      buildTerrain({
        size: 2600,
        segments: 260,
        heightFn,
        material: new THREE.MeshStandardMaterial({ map: dirt.map, normalMap: dirt.normalMap, roughness: 0.97 }),
        colorFn: (c, x, y) => c.setRGB(1, 1 - Math.min(0.15, y / 200), 0.95 - Math.min(0.2, y / 150)),
      })
    );
    // concrete apron
    const conc = noiseSurface({
      size: 256, base: [150, 148, 140], variation: 14, freq: 5, seed: seed + 1, normalStrength: 1.5, repeat: [24, 30],
      extra: (col, u, v) => {
        const seam = (u * 4) % 1 < 0.012 || (v * 4) % 1 < 0.012;
        return seam ? col.map((q) => q * 0.55) : col;
      },
    });
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(200, 260), new THREE.MeshStandardMaterial({ map: conc.map, normalMap: conc.normalMap, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(100, 0.0, 0);
    apron.receiveShadow = true;
    group.add(apron);
    // helipad
    const pad = canvasTexture(512, 512, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(240,220,90,0.9)';
      g.lineWidth = 18;
      g.beginPath();
      g.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = 'rgba(245,245,240,0.9)';
      g.fillRect(w * 0.33, h * 0.28, w * 0.08, h * 0.44);
      g.fillRect(w * 0.59, h * 0.28, w * 0.08, h * 0.44);
      g.fillRect(w * 0.33, h * 0.46, w * 0.34, h * 0.08);
    });
    const padMesh = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), new THREE.MeshStandardMaterial({ map: pad, transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    padMesh.rotation.x = -Math.PI / 2;
    padMesh.position.set(130, 0.03, -70);
    group.add(padMesh);

    const rt = roadTexture({ markings: 'white', worn: 0.8, seed });
    group.add(buildRoadMesh(curve, roadWidth, new THREE.MeshStandardMaterial({ map: rt.map, roughnessMap: rt.roughnessMap, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), { y: 0.02 }));

    // hangars (quonset huts)
    const batch = new Batcher();
    const corr = corrugated();
    const hangarMat = new THREE.MeshStandardMaterial({ map: corr, roughness: 0.6, metalness: 0.55, side: THREE.DoubleSide });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x3e4334, roughness: 0.8, metalness: 0.3 });
    const hangarGeo = new THREE.CylinderGeometry(14, 14, 40, 24, 1, true, -Math.PI / 2, Math.PI);
    hangarGeo.rotateX(Math.PI / 2);
    hangarGeo.rotateY(Math.PI / 2);
    const endGeo = new THREE.CircleGeometry(14, 24, 0, Math.PI);
    for (let i = 0; i < 4; i++) {
      const x = 75 + (i % 2) * 70, z = -90 + Math.floor(i / 2) * 120 + 40;
      batch.add(hangarGeo, hangarMat, [x, 0, z], [0, 0, 0]);
      batch.add(endGeo, doorMat, [x - 20, 0, z], [0, -Math.PI / 2, 0]);
      batch.add(endGeo, doorMat, [x + 20, 0, z], [0, Math.PI / 2, 0]);
    }
    // control tower
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x8c8676, roughness: 0.85 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x223040, metalness: 0.8, roughness: 0.15, emissive: 0x334455, emissiveIntensity: 0.6 });
    batch.add(new THREE.BoxGeometry(8, 18, 8).translate(0, 9, 0), towerMat, [170, 0, 80]);
    batch.add(new THREE.BoxGeometry(11, 4, 11).translate(0, 20, 0), glassMat, [170, 0, 80]);
    batch.add(new THREE.BoxGeometry(12, 0.6, 12).translate(0, 22.3, 0), towerMat, [170, 0, 80]);
    // fuel tanks
    const tankMat = new THREE.MeshStandardMaterial({ color: 0x5e6248, roughness: 0.6, metalness: 0.4 });
    for (let i = 0; i < 4; i++) batch.add(new THREE.CylinderGeometry(5, 5, 9, 24).translate(0, 4.5, 0), tankMat, [180 + i * 13, 0, -120]);
    batch.build(group);

    // containers
    const containers = [];
    const cCols = ['#5b6340', '#7a6a4a', '#4a5240', '#6b4a32', '#3f4a3a'];
    for (let i = 0; i < 40; i++) {
      const stack = Math.floor(i / 10), k = i % 10;
      containers.push({ x: 40 + stack * 3.0, y: 1.3 + (R() < 0.35 ? 2.6 : 0), z: -130 + k * 6.6 + R() * 0.3, s: [2.45, 2.6, 6.06], ry: (R() - 0.5) * 0.05, color: cCols[Math.floor(R() * cCols.length)] });
    }
    group.add(instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.4 }), containers));

    // jersey barriers + sandbags along the base section of the road
    const barriers = [], bags = [];
    alongRoad(curve, 3.4, half + 0.8, (p, yaw, d) => {
      if (d > 700 && d < 1300) barriers.push({ x: p.x, y: 0, z: p.z, ry: yaw });
    });
    alongRoad(curve, 3.4, -half - 0.8, (p, yaw, d) => {
      if (d > 750 && d < 1250) barriers.push({ x: p.x, y: 0, z: p.z, ry: yaw });
    });
    const jersey = new THREE.CylinderGeometry(0.22, 0.42, 0.85, 4, 1);
    jersey.rotateY(Math.PI / 4);
    jersey.scale(1, 1, 4.6);
    jersey.translate(0, 0.42, 0);
    group.add(instanced(jersey, new THREE.MeshStandardMaterial({ color: 0xa8a294, roughness: 0.9 }), barriers));
    for (let w = 0; w < 10; w++) {
      const cx = 20 + R() * 160, cz = -150 + R() * 300;
      const yaw = R() * Math.PI;
      for (let row = 0; row < 3; row++)
        for (let k = 0; k < 8; k++) {
          const off = (k - 3.5) * 0.62 + (row % 2) * 0.31;
          bags.push({ x: cx + Math.cos(yaw) * off, y: 0.18 + row * 0.3, z: cz - Math.sin(yaw) * off, s: [0.32, 0.17, 0.22], ry: yaw + (R() - 0.5) * 0.2, color: R() < 0.5 ? '#8a7a58' : '#7a6c4c' });
        }
    }
    group.add(instanced(new THREE.SphereGeometry(1, 10, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), bags));

    // czech hedgehog tank traps
    const beam = new THREE.BoxGeometry(0.2, 0.2, 2.2);
    const hedgehog = mergeGeometries([
      beam.clone().rotateX(Math.PI / 4),
      beam.clone().rotateY(Math.PI / 2).rotateZ(Math.PI / 4),
      beam.clone().rotateX(Math.PI / 2),
    ]);
    hedgehog.translate(0, 0.75, 0);
    const traps = [];
    for (let i = 0; i < 70; i++) {
      const x = (R() - 0.5) * 600, z = (R() - 0.5) * 1400;
      const d = field.distance(x, z);
      if (d < half + 5 || d > 90) continue;
      traps.push({ x, y: heightFn(x, z), z, ry: R() * 6, s: 0.9 + R() * 0.3 });
    }
    group.add(instanced(hedgehog, new THREE.MeshStandardMaterial({ color: 0x3a3632, metalness: 0.7, roughness: 0.55 }), traps));

    // perimeter fence
    const fenceMat = new THREE.MeshStandardMaterial({ map: chainLink(), alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 });
    fenceMat.map.repeat.set(1, 1);
    const fencePts = [[-12, -180], [212, -180], [212, 180], [-12, 180]];
    const fencePosts = [];
    const fenceBatch = new Batcher();
    for (let i = 0; i < 4; i++) {
      const [ax, az] = fencePts[i], [bx, bz] = fencePts[(i + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.floor(len / 4);
      for (let k = 0; k < n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
        if (field.distance(x, z) < half + 3) continue;
        fencePosts.push({ x, y: 0, z });
        const segGeo = new THREE.PlaneGeometry(len / n, 3);
        const uv = segGeo.attributes.uv;
        for (let q = 0; q < uv.count; q++) uv.setXY(q, uv.getX(q) * (len / n / 0.5), uv.getY(q) * 6);
        fenceBatch.add(segGeo, fenceMat, [x + (bx - ax) / n / 2, 1.5, z + (bz - az) / n / 2], [0, -Math.atan2(bz - az, bx - ax), 0]);
      }
    }
    fenceBatch.build(group, { cast: false, receive: false });
    const fp = new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6);
    fp.translate(0, 1.6, 0);
    group.add(instanced(fp, new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 0.7, roughness: 0.4 }), fencePosts));

    // watchtowers + floodlights
    const towers = [], lightHeads = [];
    const towerSpots = [[-12, -180], [212, -180], [212, 180], [-12, 180], [20, 0]];
    for (const [x, z] of towerSpots) {
      towers.push({ x, y: 0, z });
      lightHeads.push({ x, y: 11.4, z });
      const spot = new THREE.SpotLight(0xfff0d0, 2500, 90, 0.5, 0.5, 1.6);
      spot.position.set(x, 11.4, z);
      spot.target.position.set(x + (100 - x) * 0.3, 0, z * 0.6);
      group.add(spot, spot.target);
    }
    const legs = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const l = new THREE.BoxGeometry(0.25, 9, 0.25);
      l.translate(sx * 1.5, 4.5, sz * 1.5);
      legs.push(l);
    }
    const cabin = new THREE.BoxGeometry(4.2, 2.4, 4.2);
    cabin.translate(0, 10.2, 0);
    const roof = new THREE.ConeGeometry(3.4, 1.2, 4);
    roof.rotateY(Math.PI / 4);
    roof.translate(0, 12, 0);
    group.add(instanced(mergeGeometries([...legs, cabin, roof]), new THREE.MeshStandardMaterial({ color: 0x5a5444, roughness: 0.85 }), towers));
    group.add(instanced(new THREE.BoxGeometry(1.4, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d0, emissiveIntensity: 10 }), lightHeads, { cast: false }));

    // burning barrels / smoke
    const emitters = [
      { position: [60, 0.5, 120], rate: 8, radius: 1.5, size: 7, opacity: 0.35, color: '#3a3632', wind: 1.4 },
      { position: [-60, 0.5, -260], rate: 6, radius: 2, size: 9, opacity: 0.3, color: '#4a4540', wind: 1.4 },
    ];
    return { group, curve, roadWidth, field, groundHeight: heightFn, emitters };
  },
};
