// Procedural demo car so the editor is usable before the user imports a model.
// Built facing +Z with named wheel nodes, exactly like a typical glTF vehicle.
import * as THREE from 'three';

function profileGeometry(points, width, bevel = 0.06) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 8,
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function wheel(name, radius, width, mats) {
  const g = new THREE.Group();
  g.name = name;
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 40, 1), mats.tire);
  tire.rotation.z = Math.PI / 2;
  tire.name = name + '_tire';
  const sidewall = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.86, radius * 0.14, 12, 40), mats.tire);
  sidewall.rotation.y = Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.68, radius * 0.68, width * 1.02, 32), mats.rim);
  rim.rotation.z = Math.PI / 2;
  rim.name = name + '_rim';
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.16, radius * 0.16, width * 1.08, 16), mats.chrome);
  hub.rotation.z = Math.PI / 2;
  g.add(tire, sidewall, rim, hub);
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(width * 1.06, radius * 0.11, radius * 0.6), mats.chrome);
    spoke.position.set(0, 0, 0);
    spoke.rotation.x = (i / 5) * Math.PI * 2;
    spoke.translateZ(radius * 0.32);
    g.add(spoke);
  }
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(width * 0.5, radius * 0.35, radius * 0.25), mats.caliper);
  caliper.position.set(0, radius * 0.35, -radius * 0.25);
  caliper.name = name + '_caliper';
  g.add(caliper);
  return g;
}

export function buildDemoVehicle() {
  const root = new THREE.Group();
  root.name = 'DemoVehicle';
  const mats = {
    paint: new THREE.MeshPhysicalMaterial({ name: 'Car Paint', color: 0x9e0f16, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 }),
    glass: new THREE.MeshPhysicalMaterial({ name: 'Glass', color: 0x0b0f14, metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 }),
    trim: new THREE.MeshStandardMaterial({ name: 'Black Trim', color: 0x0c0c0d, metalness: 0.3, roughness: 0.55 }),
    tire: new THREE.MeshStandardMaterial({ name: 'Tire Rubber', color: 0x111111, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ name: 'Rim', color: 0x1c1d20, metalness: 0.85, roughness: 0.38 }),
    chrome: new THREE.MeshStandardMaterial({ name: 'Chrome', color: 0xd0d4da, metalness: 1, roughness: 0.12 }),
    caliper: new THREE.MeshStandardMaterial({ name: 'Brake Caliper', color: 0xffc400, metalness: 0.3, roughness: 0.4 }),
    head: new THREE.MeshStandardMaterial({ name: 'Headlight', color: 0xffffff, emissive: 0xeaf4ff, emissiveIntensity: 6 }),
    tail: new THREE.MeshStandardMaterial({ name: 'Taillight', color: 0x400000, emissive: 0xff1010, emissiveIntensity: 5 }),
  };

  const body = new THREE.Mesh(
    profileGeometry(
      [
        [2.32, 0.24],
        [2.36, 0.5],
        [2.2, 0.66],
        [1.2, 0.84],
        [0.62, 0.9],
        [-1.6, 0.94],
        [-2.2, 0.92],
        [-2.34, 0.78],
        [-2.32, 0.26],
        [-1.9, 0.2],
        [1.9, 0.2],
      ],
      1.96
    ),
    mats.paint
  );
  body.name = 'body';
  const cabin = new THREE.Mesh(
    profileGeometry(
      [
        [0.72, 0.86],
        [0.0, 1.24],
        [-0.85, 1.25],
        [-1.75, 0.9],
      ],
      1.58,
      0.08
    ),
    mats.glass
  );
  cabin.name = 'glass';
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.04, 0.9), mats.paint);
  roof.position.set(0, 1.27, -0.42);
  roof.name = 'roof';

  const under = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 4.3), mats.trim);
  under.position.set(0, 0.22, 0);
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.06), mats.trim);
  grille.position.set(0, 0.38, 2.36);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.04, 0.3), mats.trim);
  splitter.position.set(0, 0.22, 2.25);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 0.2), mats.trim);
  diffuser.position.set(0, 0.3, -2.3);
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.32), mats.trim);
  spoiler.position.set(0, 1.12, -2.05);
  const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.12), mats.trim);
  s1.position.set(0.6, 1.0, -2.02);
  const s2 = s1.clone();
  s2.position.x = -0.6;

  root.add(body, cabin, roof, under, grille, splitter, diffuser, spoiler, s1, s2);

  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.1), mats.head);
    hl.position.set(sx * 0.68, 0.62, 2.27);
    hl.rotation.x = -0.25;
    hl.name = 'headlight';
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.06), mats.tail);
    tl.position.set(sx * 0.58, 0.8, -2.33);
    tl.name = 'taillight';
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.14), mats.paint);
    mirror.position.set(sx * 0.98, 0.95, 0.55);
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 16), mats.chrome);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(sx * 0.4, 0.3, -2.36);
    root.add(hl, tl, mirror, exhaust);
  }
  const r = 0.37, w = 0.3;
  const wheels = [
    ['wheel_FL', 0.86, 1.45],
    ['wheel_FR', -0.86, 1.45],
    ['wheel_RL', 0.86, -1.42],
    ['wheel_RR', -0.86, -1.42],
  ];
  for (const [n, x, z] of wheels) {
    const wh = wheel(n, r, w, mats);
    wh.position.set(x, r, z);
    if (x < 0) wh.rotation.y = Math.PI;
    root.add(wh);
  }
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return root;
}
