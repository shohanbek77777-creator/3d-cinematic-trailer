// Three.js engine: renderer, scene, lights, sky, environment, actors, cameras,
// editor tools (orbit + gizmo + helpers) and frame evaluation at a given time.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Pipeline } from './Pipeline.js';
import { Overlay } from './Overlay.js';
import { ParticleManager } from '../scene/Particles.js';
import { ENV_BY_ID } from '../scene/environments/index.js';
import { physicalSky, nightSky, sunDirection } from '../scene/environments/common.js';
import { evaluateCameraTrack, applyShotToCamera } from '../anim/CameraShots.js';
import { evaluateFX } from '../anim/Sequencer.js';
import { clamp } from '../anim/math.js';

export class Engine {
  constructor(container) {
    this.container = container;
    const canvas = document.createElement('canvas');
    canvas.className = 'viewport-canvas';
    container.appendChild(canvas);
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setPixelRatio(1);
    this.renderer = renderer;
    this.pipeline = new Pipeline(renderer);
    this.overlay = new Overlay();
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101014);
    this.envGroup = new THREE.Group();
    this.envGroup.name = 'environment';
    this.actorsGroup = new THREE.Group();
    this.actorsGroup.name = 'actors';
    this.helpers = new THREE.Group();
    this.helpers.name = 'editor-helpers';
    this.scene.add(this.envGroup, this.actorsGroup, this.helpers);

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 600;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    this.scene.add(this.hemi);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.sunColor = new THREE.Color();

    // cameras
    this.shotCamera = new THREE.PerspectiveCamera(32, 16 / 9, 0.15, 25000);
    this.editorCamera = new THREE.PerspectiveCamera(40, 16 / 9, 0.15, 25000);
    this.editorCamera.position.set(9, 4, 11);
    this.controls = new OrbitControls(this.editorCamera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.set(0, 0.8, 0);
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.cameraMode = 'shot';

    this.gizmo = new TransformControls(this.editorCamera, canvas);
    this.gizmo.setSize(0.8);
    this.gizmoHelper = this.gizmo.getHelper();
    this.helpers.add(this.gizmoHelper);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      this.onGizmoDrag?.(e.value);
    });
    this.gizmo.addEventListener('objectChange', () => this.onGizmoChange?.());

    this.selectionBox = new THREE.Box3Helper(new THREE.Box3(), 0xe8b04a);
    this.selectionBox.visible = false;
    this.helpers.add(this.selectionBox);
    this.pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xe8b04a, dashSize: 1, gapSize: 0.6, depthTest: false, transparent: true, opacity: 0.85 }));
    this.pathLine.renderOrder = 999;
    this.pathLine.frustumCulled = false;
    this.helpers.add(this.pathLine);
    this.keyMarkers = new THREE.Group();
    this.helpers.add(this.keyMarkers);
    this.camHelper = new THREE.CameraHelper(this.shotCamera);
    this.helpers.add(this.camHelper);

    this.particles = new ParticleManager(this.scene);
    this.actors = new Map();
    this.env = null;
    this.envDef = null;
    this.sky = null;
    this.quality = { scale: 1, msaa: 4, shadows: 2048 };
    this.exporting = false;
    this._clock = performance.now();

    this._setupPicking();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  // ------------------------------------------------------------------ sizing
  setQuality(q) {
    const presets = {
      low: { scale: 0.6, msaa: 0, shadows: 1024 },
      medium: { scale: 0.8, msaa: 2, shadows: 2048 },
      high: { scale: 1, msaa: 4, shadows: 2048 },
      ultra: { scale: Math.min(2, window.devicePixelRatio || 1), msaa: 4, shadows: 4096 },
    };
    this.quality = presets[q] || presets.high;
    this.pipeline.setMSAA(this.quality.msaa);
    if (this.sun.shadow.mapSize.x !== this.quality.shadows) {
      this.sun.shadow.mapSize.set(this.quality.shadows, this.quality.shadows);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.resize();
  }

  resize() {
    if (this.exporting) return;
    const rect = this.container.getBoundingClientRect();
    let w = rect.width, h = rect.height;
    if (w < 10 || h < 10) return;
    // fit a 16:9 frame inside the viewport
    if (w / h > 16 / 9) w = h * (16 / 9);
    else h = w / (16 / 9);
    this.canvas.style.width = `${Math.floor(w)}px`;
    this.canvas.style.height = `${Math.floor(h)}px`;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(dpr, 1.5) * this.quality.scale;
    const bw = Math.max(2, Math.floor(w * scale)), bh = Math.max(2, Math.floor(h * scale));
    this.setRenderSize(bw, bh);
    this.displayRect = { w, h };
  }

  setRenderSize(w, h) {
    this.renderer.setSize(w, h, false);
    this.pipeline.setSize(w, h);
    this.overlay.setSize(w, h);
    for (const cam of [this.shotCamera, this.editorCamera]) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    this.renderWidth = w;
    this.renderHeight = h;
  }

  // ------------------------------------------------------------------ picking
  _setupPicking() {
    const ray = new THREE.Raycaster();
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      if (this.gizmo.dragging) return;
      const r = this.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.activeCamera());
      const hits = ray.intersectObjects(this.actorsGroup.children, true);
      for (const h of hits) {
        let o = h.object;
        while (o && !o.userData.actorId) o = o.parent;
        if (o) return this.onPick?.(o.userData.actorId);
      }
      this.onPick?.(null);
    });
  }

  activeCamera() {
    return this.cameraMode === 'editor' ? this.editorCamera : this.shotCamera;
  }

  setCameraMode(mode) {
    this.cameraMode = mode;
    this.controls.enabled = mode === 'editor';
    this.gizmo.enabled = mode === 'editor';
  }

  // ------------------------------------------------------------------ environment
  async setEnvironment(project, actorSize = 4.6) {
    const envId = project.environment.id;
    const def = ENV_BY_ID[envId] || ENV_BY_ID.desert;
    const scale = clamp(actorSize / 4.6, 1, 2.6);
    const key = `${def.id}|${project.environment.seed}|${scale.toFixed(2)}`;
    if (this._envKey === key) return;
    this._envKey = key;
    // dispose old
    if (this.env) {
      this.envGroup.remove(this.env.group);
      this.env.group.traverse((o) => {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) m[k]?.dispose?.();
          m.dispose();
        }
        if (o.isLight) o.dispose?.();
      });
    }
    if (this.sky) {
      this.scene.remove(this.sky);
      this.sky.geometry.dispose();
      this.sky.material.dispose();
      this.sky = null;
    }
    const baseWidth = { desert: 11, city: 14, mountain: 9.5, nightcity: 16, military: 10 }[def.id] || 10;
    this.env = def.build({ seed: project.environment.seed || 7, roadWidth: baseWidth * scale });
    this.envDef = def;
    this.envGroup.add(this.env.group);
    const sk = def.preset.sky;
    this.sky = sk.type === 'night' ? nightSky(sk) : physicalSky(sk);
    if (sk.type !== 'night' && this.sky.material.uniforms.cloudCoverage) {
      this.sky.material.uniforms.cloudCoverage.value = sk.clouds ?? 0.3;
      this.sky.material.uniforms.cloudDensity.value = 0.5;
    }
    this.scene.add(this.sky);
    this.hemi.color.set(def.preset.hemi.sky);
    this.hemi.groundColor.set(def.preset.hemi.ground);
    this.particles.reset();
    this._envMapKey = '';
    this.applyLighting(project);
  }

  applyLighting(project) {
    const L = project.lighting;
    const fx = project.effects;
    this.sunDir.copy(sunDirection(L.sunElevation, L.sunAzimuth));
    this.sunColor.set(L.sunColor);
    const horizonFade = clamp((L.sunElevation + 3) / 8, 0, 1);
    this.sun.color.copy(this.sunColor);
    this.sun.intensity = L.sunIntensity * horizonFade;
    this.hemi.intensity = L.ambient;
    // The Preetham sky is authored in very large radiance units; normalise its IBL contribution
    // so 'Reflections = 1' means a physically balanced amount of sky light.
    const skyNorm = this.envDef?.preset.sky.type === 'night' ? 1 : 0.6;
    this.scene.environmentIntensity = L.envIntensity * skyNorm;
    this.renderer.shadowMap.enabled = !!L.shadows;
    this.sun.castShadow = !!L.shadows;
    if (this.sky?.setSun) this.sky.setSun(this.sunDir);
    if (fx.fog.enabled) {
      if (!this.scene.fog) this.scene.fog = new THREE.FogExp2(fx.fog.color, fx.fog.density);
      this.scene.fog.color.set(fx.fog.color);
      this.scene.fog.density = fx.fog.density;
    } else this.scene.fog = null;
    this.scene.background = this.sky ? null : new THREE.Color(0x101014);
    // particle lighting
    const pl = new THREE.Color().copy(this.sunColor).multiplyScalar(clamp(this.sun.intensity / 3, 0, 1) * 0.75).add(new THREE.Color(this.hemi.color).multiplyScalar(L.ambient * 0.45));
    pl.r = Math.min(pl.r, 1.3);
    pl.g = Math.min(pl.g, 1.3);
    pl.b = Math.min(pl.b, 1.3);
    this.particles.setLight(pl);
    this._scheduleEnvMap();
  }

  _scheduleEnvMap() {
    if (!this.envDef) return;
    const key = `${this.envDef.id}|${this.sunDir.x.toFixed(2)},${this.sunDir.y.toFixed(2)},${this.sunDir.z.toFixed(2)}`;
    if (key === this._envMapKey) return;
    clearTimeout(this._envTimer);
    const run = () => {
      this._envMapKey = key;
      this._buildEnvMap();
    };
    if (!this.scene.environment) run();
    else this._envTimer = setTimeout(run, 120);
  }

  _buildEnvMap() {
    const envScene = new THREE.Scene();
    const sk = this.envDef.preset.sky;
    let sky;
    if (sk.type === 'night') {
      sky = nightSky(sk);
      sky.scale.setScalar(0.005);
      // city glow cards so car paint has something to reflect
      const cols = [0xffb070, 0x6ab0ff, 0xff4fa8, 0xffe0b0];
      for (let i = 0; i < 14; i++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.6 + Math.random() * 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(cols[i % 4]).multiplyScalar(2.5), side: THREE.DoubleSide }));
        const a = (i / 14) * Math.PI * 2;
        m.position.set(Math.cos(a) * 40, 4 + Math.random() * 10, Math.sin(a) * 40);
        m.lookAt(0, 4, 0);
        envScene.add(m);
      }
    } else {
      sky = physicalSky(sk);
      sky.scale.setScalar(80);
      sky.setSun(this.sunDir);
      if (sky.material.uniforms.cloudCoverage) sky.material.uniforms.cloudCoverage.value = sk.clouds ?? 0.3;
    }
    envScene.add(sky);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(100, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.envDef.preset.hemi.ground).multiplyScalar(0.6) }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    envScene.add(ground);
    const rt = this.pmrem.fromScene(envScene, 0, 0.1, 500);
    if (this.scene.environment) this.scene.environment.dispose?.();
    this.scene.environment = rt.texture;
    envScene.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose?.();
    });
  }

  groundHeight(x, z) {
    return this.env?.groundHeight ? this.env.groundHeight(x, z) : 0;
  }

  // ------------------------------------------------------------------ actors
  addActor(runtime) {
    this.actors.set(runtime.id, runtime);
    this.actorsGroup.add(runtime.root);
  }
  removeActor(id) {
    const a = this.actors.get(id);
    if (!a) return;
    if (this.gizmo.object === a.root) this.gizmo.detach();
    a.dispose();
    this.actors.delete(id);
  }

  heroId(project) {
    return project.actors[0]?.id || null;
  }

  /** Fresh state object per call (camera shots evaluate several times per frame). */
  actorState(id, t) {
    const a = this.actors.get(id) || this.actors.values().next().value;
    if (!a) return null;
    const st = a.evaluate(t, {});
    st.position = st.position.clone();
    return st;
  }

  // ------------------------------------------------------------------ frame evaluation
  /** Pose everything for time t (actors, shot camera). Returns frame info. */
  pose(project, t) {
    const heroId = this.heroId(project);
    let hero = null;
    for (const a of this.actors.values()) {
      const st = a.id === this.draggingId ? a.evaluate(t, {}) : a.update(t);
      if (a.id === heroId) hero = st;
    }
    const ctx = { actorState: (id, tt) => this.actorState(id, tt), heroId, groundHeight: (x, z) => this.groundHeight(x, z) };
    const cam = evaluateCameraTrack(project.camera.clips, t, ctx);
    applyShotToCamera(cam, this.shotCamera);
    return { cam, hero };
  }

  /**
   * Render a complete frame at time t.
   * opts: { samples, target, shutter (deg), fps, showHelpers }
   */
  renderFrame(project, t, opts = {}) {
    const fx = project.effects;
    const fxState = evaluateFX(project.fx.clips, t);
    const heroId = this.heroId(project);
    const L = project.lighting;

    // headlights
    for (const a of this.actors.values()) {
      const mode = a.data.setup.headlights;
      const on = mode === 'on' || (mode === 'auto' && (L.headlights || L.sunElevation < 3));
      a.setHeadlights(on && a.kind === 'vehicle');
    }

    const base = this.pose(project, t);
    const editor = this.cameraMode === 'editor' && !opts.forceShot;
    const camera = editor ? this.editorCamera : this.shotCamera;
    if (editor) this.controls.update();

    // shadows follow the hero / camera target
    const focusPos = base.hero ? base.hero.position : this.controls.target;
    const span = clamp((base.hero?.size || 5) * 7, 18, 120);
    const sc = this.sun.shadow.camera;
    if (sc.right !== span) {
      sc.left = -span;
      sc.right = span;
      sc.top = span;
      sc.bottom = -span;
      sc.updateProjectionMatrix();
    }
    this.sun.target.position.copy(focusPos);
    this.sun.position.copy(focusPos).addScaledVector(this.sunDir, 300);
    this.sun.target.updateMatrixWorld();

    this.env?.update?.(t, focusPos);

    // particles (simulated once per frame)
    this.particles.simulateTo(t, {
      actors: [...this.actors.values()],
      fx: (tt) => evaluateFX(project.fx.clips, tt),
      effects: fx,
      envEmitters: this.env?.emitters,
      envDust: this.envDef?.preset.envDust ?? 1,
      heroId,
    });
    this.particles.setViewport(this.renderHeight, camera);
    const amb = this.envDef?.preset.particles.ambient || {};
    this.particles.updateAmbient(t, camera, { ...amb, enabled: fx.particles.ambient.enabled, amount: (amb.amount ?? 1) * fx.particles.ambient.amount });

    // helpers only in editor view
    this.helpers.visible = editor && !opts.hideHelpers;
    this.camHelper.visible = editor;
    if (editor) this.camHelper.update();

    const samples = Math.max(1, opts.samples ?? (fx.motionBlur.enabled ? fx.motionBlur.previewSamples : 1));
    const fps = opts.fps || project.fps || 30;
    const shutter = ((fx.motionBlur.shutter || 180) / 360) / fps;
    const focusOf = () => {
      if (editor) return this.editorCamera.position.distanceTo(this.controls.target);
      return this.shotCamera.userData.focus ?? 10;
    };
    this.shotCamera.userData.focus = base.cam.focusDistance;

    const prepare = (i, n) => {
      if (n > 1 && fx.motionBlur.enabled) {
        const st = t + ((i + 0.5) / n - 0.5) * shutter;
        const p = this.pose(project, st);
        this.shotCamera.userData.focus = p.cam.focusDistance;
      }
      return { focus: focusOf() };
    };

    const titles = fxState.titles;
    const overlayTex = this.overlay.draw(titles, fx.letterbox.enabled ? fx.letterbox.aspect : 0);
    this.pipeline.render({
      scene: this.scene,
      camera,
      samples: fx.motionBlur.enabled ? samples : 1,
      prepare,
      effects: fx,
      lighting: L,
      sunDir: this.sunDir,
      sunColor: new THREE.Color().copy(this.sunColor).multiplyScalar(clamp(this.sun.intensity / 3, 0, 1.5)),
      overlay: overlayTex,
      fade: fxState.fade,
      flash: fxState.flash,
      time: t,
      target: opts.target || null,
    });
    // restore exact pose at t after motion blur sub-frames
    if (samples > 1 && fx.motionBlur.enabled) this.pose(project, t);
    return { cam: base.cam, fx: fxState };
  }

  // ------------------------------------------------------------------ editor helpers
  updateSelectionHelpers(actorId, project) {
    const a = actorId ? this.actors.get(actorId) : null;
    if (a) {
      this.selectionBox.box.setFromObject(a.root);
      this.selectionBox.visible = true;
    } else this.selectionBox.visible = false;
    // path preview
    this.keyMarkers.clear();
    if (a && a.path.curve) {
      const pts = a.path.curve.getSpacedPoints(Math.min(600, Math.ceil(a.path.total / 2)));
      pts.forEach((p) => (p.y += 0.15));
      this.pathLine.geometry.dispose();
      this.pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      this.pathLine.computeLineDistances();
      this.pathLine.visible = true;
      const geo = new THREE.OctahedronGeometry(0.25 * Math.max(1, a.size / 5));
      const mat = new THREE.MeshBasicMaterial({ color: 0xe8b04a, depthTest: false });
      for (const k of a.data.path.keys) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(k.p[0], k.p[1] + 0.4, k.p[2]);
        m.renderOrder = 1000;
        this.keyMarkers.add(m);
      }
    } else this.pathLine.visible = false;
  }

  attachGizmo(actorId, mode) {
    const a = actorId ? this.actors.get(actorId) : null;
    if (!a) {
      this.gizmo.detach();
      return;
    }
    this.gizmo.attach(a.root);
    if (mode) this.gizmo.setMode(mode);
  }

  focusOn(actorId) {
    const a = this.actors.get(actorId) || this.actors.values().next().value;
    if (!a) return;
    const p = a.root.position.clone();
    const d = a.size * 1.6;
    this.controls.target.copy(p).add(new THREE.Vector3(0, a.dims.height * 0.5, 0));
    this.editorCamera.position.copy(p).add(new THREE.Vector3(d, d * 0.45, d));
    this.controls.update();
  }

  /** Copy the current shot camera into the editor camera (pilot). */
  syncEditorToShot() {
    this.editorCamera.position.copy(this.shotCamera.position);
    const dir = this.shotCamera.getWorldDirection(new THREE.Vector3());
    this.controls.target.copy(this.shotCamera.position).addScaledVector(dir, this.shotCamera.userData.focus || 10);
    this.editorCamera.fov = this.shotCamera.fov;
    this.editorCamera.updateProjectionMatrix();
    this.controls.update();
  }

  // ------------------------------------------------------------------ export sizing
  beginExport(w, h) {
    this.exporting = true;
    this._prevSize = [this.renderWidth, this.renderHeight];
    this.setRenderSize(w, h);
  }
  endExport() {
    this.exporting = false;
    this.resize();
  }
}
