// Application controller: owns the project, history, assets, playback and
// coordinates the engine and the UI.
import * as THREE from 'three';
import { Engine } from '../engine/Engine.js';
import { History } from './History.js';
import { createProject, createActor, normalizeProject, DEMO_ASSET_ID } from './Project.js';
import * as Storage from './Storage.js';
import { applyEnvironmentPreset, ENV_BY_ID } from '../scene/environments/index.js';
import { ActorRuntime } from '../scene/Actor.js';
import { buildDemoVehicle } from '../assets/DemoVehicle.js';
import { parseAssetRecord, recordsFromFiles, recordFromURL } from '../assets/ModelLoader.js';
import { generateTrailer } from '../anim/TrailerGenerator.js';
import { SHOT_TYPES } from '../anim/CameraShots.js';
import { FX_TYPES } from '../anim/Sequencer.js';
import { exportVideo, convertToMP4 } from '../export/Exporter.js';
import { uid, clamp, DEG, RAD } from '../anim/math.js';
import { toast } from '../ui/dom.js';

export class App {
  constructor() {
    this.listeners = {};
    this.history = new History();
    this.history.onChange = () => this.emit('history');
    this.time = 0;
    this.playing = false;
    this.loop = true;
    this.selection = null;
    this.assetCache = new Map();
    this.assetPromises = new Map();
    this.prefs = Storage.loadPrefs();
    this.status = '';
    this.fps = 0;
  }

  on(evt, fn) {
    (this.listeners[evt] ||= []).push(fn);
    return () => (this.listeners[evt] = this.listeners[evt].filter((f) => f !== fn));
  }
  emit(evt, data) {
    for (const fn of this.listeners[evt] || []) fn(data);
  }
  setStatus(s) {
    this.status = s;
    this.emit('status', s);
  }

  // ------------------------------------------------------------------ boot
  async init(viewportEl) {
    this.engine = new Engine(viewportEl);
    this.engine.onPick = (id) => this.select(id ? { type: 'actor', id } : null);
    this.engine.onGizmoDrag = (dragging) => this._gizmoDrag(dragging);
    this.engine.onGizmoChange = () => {
      if (this.selection?.type === 'actor') this.engine.updateSelectionHelpers(this.selection.id, this.project);
      this.dirty = true;
    };
    this.engine.controls.addEventListener('change', () => (this.dirty = true));
    this.engine.setQuality(this.prefs.quality || 'high');
    this.engine.setCameraMode('shot');

    const saved = Storage.loadAutosave();
    let restored = false;
    if (saved) {
      try {
        this.project = normalizeProject(saved);
        await this.syncAll();
        restored = true;
        this.setStatus('Restored autosaved project');
      } catch (e) {
        console.warn('Autosave restore failed', e);
      }
    }
    if (!restored) await this.newProject(false);
    this.history.reset(JSON.stringify(this.project));
    this.seek(0);
    this._loop();
    this.emit('project');
    this.emit('selection');
  }

  async newProject(commit = true) {
    this.pause();
    this.project = createProject();
    applyEnvironmentPreset(this.project, 'desert');
    const demo = this.project.assets.find((a) => a.id === DEMO_ASSET_ID);
    this.project.actors.push(createActor(demo, { name: 'Demo Vehicle' }));
    await this.syncAll();
    generateTrailer(this.project, this.engine, {});
    this.project.name = 'Untitled Trailer';
    await this.syncAll();
    this.selection = null;
    this.seek(0);
    if (commit) {
      this.history.reset(JSON.stringify(this.project));
      this._autosave();
    }
    this.emit('project');
    this.emit('selection');
  }

  // ------------------------------------------------------------------ assets
  async ensureAsset(assetId) {
    if (this.assetCache.has(assetId)) return this.assetCache.get(assetId);
    if (this.assetPromises.has(assetId)) return this.assetPromises.get(assetId);
    const p = (async () => {
      if (assetId === DEMO_ASSET_ID) {
        const entry = { template: buildDemoVehicle(), animations: [] };
        this.assetCache.set(assetId, entry);
        return entry;
      }
      const rec = await Storage.getAsset(assetId);
      if (!rec) return null;
      const gltf = await parseAssetRecord(rec, this.engine.renderer);
      const entry = { template: gltf.scene, animations: gltf.animations || [], record: rec };
      this.assetCache.set(assetId, entry);
      return entry;
    })();
    this.assetPromises.set(assetId, p);
    try {
      return await p;
    } finally {
      this.assetPromises.delete(assetId);
    }
  }

  assetMeta(id) {
    return this.project.assets.find((a) => a.id === id);
  }

  async importFiles(files) {
    let records;
    try {
      records = await recordsFromFiles(files);
    } catch (e) {
      toast(e.message, 'error');
      return [];
    }
    const added = [];
    for (const rec of records) {
      this.setStatus(`Parsing ${rec.name}…`);
      try {
        added.push(await this._registerRecord(rec));
      } catch (e) {
        console.error(e);
        toast(e.message || String(e), 'error');
      }
    }
    this.setStatus('');
    return added;
  }

  async importURL(url, onProgress) {
    this.setStatus('Downloading model…');
    try {
      const rec = await recordFromURL(url, (loaded, total) => onProgress?.(loaded, total));
      return await this._registerRecord(rec);
    } finally {
      this.setStatus('');
    }
  }

  /** Validate (parse) a record, persist it and place it in the scene. */
  async _registerRecord(rec) {
    const gltf = await parseAssetRecord(rec, this.engine.renderer);
    let meshCount = 0;
    gltf.scene.traverse((o) => o.isMesh && meshCount++);
    if (!meshCount) throw new Error(`${rec.name} contains no meshes.`);
    const stored = await Storage.putAsset(rec);
    this.assetCache.set(rec.id, { template: gltf.scene, animations: gltf.animations || [], record: rec });
    const meta = { id: rec.id, name: rec.name, source: rec.source, size: rec.size, url: rec.url, stored };
    this.project.assets.push(meta);
    if (gltf.missingFiles?.length) toast(`Some textures were not found: ${gltf.missingFiles.join(', ')}. Drop them together with the .gltf file.`, 'error');
    if (!stored) toast('Model loaded, but the browser storage is full/unavailable — save the project file to keep it.', 'error');

    // The first real model replaces the demo vehicle as the hero and gets a fresh trailer.
    const onlyDemo = this.project.actors.length > 0 && this.project.actors.every((a) => a.assetId === DEMO_ASSET_ID);
    const actor = createActor(meta);
    if (onlyDemo) {
      this.project.actors = [actor];
      await this.syncAll();
      const rt = this.engine.actors.get(actor.id);
      this.project.name = 'Untitled Trailer';
      generateTrailer(this.project, this.engine, { actorId: actor.id });
      await this.syncAll();
      this.commit(`Import ${rec.name}`);
      this.seek(0);
      this.select({ type: 'actor', id: actor.id });
      toast(this._describeActor(rt, rec.name) + ' — 45 s trailer generated for this model.', 'success', 6000);
    } else {
      const hero = this.engine.actors.get(this.project.actors[0]?.id);
      if (hero) {
        const st = hero.evaluate(this.time, {});
        actor.transform.position = [st.position.x + hero.size * 1.5, 0, st.position.z + hero.size * 0.5];
      }
      this.project.actors.push(actor);
      await this.syncAll();
      this.commit(`Import ${rec.name}`);
      this.select({ type: 'actor', id: actor.id });
      toast(this._describeActor(this.engine.actors.get(actor.id), rec.name), 'success', 6000);
    }
    return actor;
  }

  _describeActor(rt, name) {
    if (!rt) return `${name} imported`;
    const d = rt.dims;
    return `${name}: ${d.length.toFixed(2)} × ${d.width.toFixed(2)} × ${d.height.toFixed(2)} m, ${rt.info.triangles.toLocaleString()} tris, ${rt.info.materialCount} materials, ${rt.wheels.length} wheels detected${rt.autoScale !== 1 ? `, auto-scaled ×${rt.autoScale.toPrecision(3)}` : ''}`;
  }

  async addActorFromAsset(assetId) {
    const meta = this.assetMeta(assetId);
    if (!meta) return;
    const actor = createActor(meta);
    const hero = this.engine.actors.get(this.project.actors[0]?.id);
    if (hero) {
      const st = hero.evaluate(this.time, {});
      actor.transform.position = [st.position.x - hero.size * (1 + this.project.actors.length * 0.6), 0, st.position.z + hero.size * 0.6];
    }
    this.project.actors.push(actor);
    await this.syncAll();
    this.commit(`Add ${actor.name}`);
    this.select({ type: 'actor', id: actor.id });
  }

  async removeAsset(assetId) {
    if (assetId === DEMO_ASSET_ID) return;
    this.project.actors = this.project.actors.filter((a) => a.assetId !== assetId);
    this.project.assets = this.project.assets.filter((a) => a.id !== assetId);
    this.assetCache.delete(assetId);
    await Storage.deleteAsset(assetId);
    await this.syncAll();
    this.commit('Remove asset');
  }

  // ------------------------------------------------------------------ project sync
  /** Reconcile engine state with the project data. */
  async syncAll() {
    const p = this.project;
    const engine = this.engine;
    // actors
    const ids = new Set(p.actors.map((a) => a.id));
    for (const id of [...engine.actors.keys()]) if (!ids.has(id)) engine.removeActor(id);
    for (const a of p.actors) {
      const rt = engine.actors.get(a.id);
      if (rt) {
        rt.sync(a);
        continue;
      }
      let asset = null;
      try {
        asset = await this.ensureAsset(a.assetId);
      } catch (e) {
        console.error(e);
        toast(`Could not load ${a.name}: ${e.message}`, 'error');
      }
      if (!asset) {
        if (!this._missingWarned?.has(a.assetId)) {
          (this._missingWarned ||= new Set()).add(a.assetId);
          toast(`Model "${a.name}" is not stored in this browser. Re-import it or load a project file that contains it.`, 'error');
        }
        continue;
      }
      if (engine.actors.has(a.id) || !this.project.actors.includes(a)) continue; // raced
      const runtime = new ActorRuntime(a, asset);
      runtime.root.visible = a.setup.visible !== false;
      engine.addActor(runtime);
    }
    // environment (scaled to hero size)
    const hero = engine.actors.get(p.actors[0]?.id);
    await engine.setEnvironment(p, hero ? hero.dims.length : 4.6);
    engine.applyLighting(p);
    if (this.selection && !this._selectionValid(this.selection)) this.selection = null;
    this._refreshSelectionHelpers();
    this.dirty = true;
  }

  _selectionValid(sel) {
    const p = this.project;
    if (sel.type === 'actor') return p.actors.some((a) => a.id === sel.id);
    if (sel.type === 'key') return p.actors.find((a) => a.id === sel.actorId)?.path.keys.some((k) => k.id === sel.id);
    if (sel.type === 'camera') return p.camera.clips.some((c) => c.id === sel.id);
    if (sel.type === 'fx') return p.fx.clips.some((c) => c.id === sel.id);
    return true;
  }

  /** Record an undo step + autosave. Call after any committed edit. */
  commit(label = 'Edit') {
    this.history.push(JSON.stringify(this.project), label);
    this._autosave();
    this.emit('project');
  }

  /** Apply edits live (no undo step), e.g. while dragging a slider. */
  live() {
    this.syncAll();
    this.emit('live');
  }

  /** Edit helper: mutate, sync, commit. */
  async edit(label, fn, { commit = true } = {}) {
    fn(this.project);
    await this.syncAll();
    if (commit) this.commit(label);
    else this.emit('live');
  }

  _autosave() {
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(() => {
      const ok = Storage.saveAutosave(this.project);
      this.emit('autosave', ok);
    }, 600);
  }

  async undo() {
    const r = this.history.undo();
    if (!r) return;
    await this._restore(r.json);
    toast(`Undo: ${r.label}`, 'info', 1500);
  }
  async redo() {
    const r = this.history.redo();
    if (!r) return;
    await this._restore(r.json);
    toast(`Redo: ${r.label}`, 'info', 1500);
  }
  async _restore(json) {
    this.project = normalizeProject(JSON.parse(json));
    await this.syncAll();
    this._autosave();
    this.emit('project');
    this.emit('selection');
  }

  // ------------------------------------------------------------------ selection
  select(sel) {
    this.selection = sel;
    this._refreshSelectionHelpers();
    this.emit('selection');
    this.dirty = true;
  }
  selectedActorId() {
    const s = this.selection;
    if (!s) return null;
    if (s.type === 'actor') return s.id;
    if (s.type === 'key') return s.actorId;
    return null;
  }
  _refreshSelectionHelpers() {
    const id = this.selectedActorId();
    this.engine.updateSelectionHelpers(id, this.project);
    this.engine.attachGizmo(this.engine.cameraMode === 'editor' ? id : null, this.gizmoMode);
  }
  setGizmoMode(mode) {
    this.gizmoMode = mode;
    this.engine.gizmo.setMode(mode);
    this.emit('gizmo');
  }
  setCameraMode(mode) {
    if (mode === 'editor' && this.engine.cameraMode !== 'editor' && !this._editorPlaced) {
      this._editorPlaced = true;
      this.engine.focusOn(this.selectedActorId() || this.project.actors[0]?.id);
    }
    this.engine.setCameraMode(mode);
    this._refreshSelectionHelpers();
    this.emit('camera-mode');
    this.dirty = true;
  }

  _gizmoDrag(dragging) {
    const id = this.selectedActorId();
    const rt = id && this.engine.actors.get(id);
    if (!rt) return;
    if (dragging) {
      this.engine.draggingId = id;
      this._dragStart = { scale: rt.root.scale.x };
      return;
    }
    this.engine.draggingId = null;
    const data = this.project.actors.find((a) => a.id === id);
    const root = rt.root;
    const e = new THREE.Euler().setFromQuaternion(root.quaternion, 'YXZ');
    if (Math.abs(root.scale.x - 1) > 1e-4) {
      data.transform.scale = +(data.transform.scale * root.scale.x).toFixed(4);
      root.scale.set(1, 1, 1);
    }
    if (rt.path.keys.length) {
      // auto-key: moving an animated actor writes a keyframe at the playhead
      const st = rt.path.evaluate(this.time, {});
      const pathYaw = st?.yaw ?? 0;
      const keys = data.path.keys;
      const eps = 0.5 / this.project.fps;
      let k = keys.find((k) => Math.abs(k.t - this.time) <= eps);
      if (!k) {
        k = { id: uid('key'), t: +this.time.toFixed(3), p: [0, 0, 0] };
        keys.push(k);
        keys.sort((a, b) => a.t - b.t);
      }
      k.p = [+root.position.x.toFixed(3), +root.position.y.toFixed(3), +root.position.z.toFixed(3)];
      data.transform.rotation = [e.x * RAD, (e.y - pathYaw) * RAD, e.z * RAD].map((v) => +v.toFixed(2));
      this.selection = { type: 'key', id: k.id, actorId: id };
    } else {
      data.transform.position = [root.position.x, root.position.y, root.position.z].map((v) => +v.toFixed(3));
      data.transform.rotation = [e.x * RAD, e.y * RAD, e.z * RAD].map((v) => +v.toFixed(2));
    }
    this.syncAll().then(() => {
      this.commit('Transform');
      this.emit('selection');
    });
  }

  // ------------------------------------------------------------------ playback
  play() {
    if (this.time >= this.project.duration - 1e-3) this.time = 0;
    this.playing = true;
    this._last = performance.now();
    this.emit('play');
  }
  pause() {
    this.playing = false;
    this.emit('play');
  }
  togglePlay() {
    this.playing ? this.pause() : this.play();
  }
  stop() {
    this.pause();
    this.seek(0);
  }
  seek(t) {
    this.time = clamp(t, 0, this.project.duration);
    this.dirty = true;
    this.emit('time', this.time);
  }
  step(frames) {
    this.pause();
    this.seek(Math.round(this.time * this.project.fps + frames) / this.project.fps);
  }

  _loop() {
    let frames = 0, acc = 0;
    const tick = (now) => {
      requestAnimationFrame(tick);
      if (this.engine.exporting) return;
      const dt = Math.min(0.1, (now - (this._last || now)) / 1000);
      this._last = now;
      if (this.playing) {
        this.time += dt;
        if (this.time >= this.project.duration) {
          if (this.loop) this.time = 0;
          else {
            this.time = this.project.duration;
            this.pause();
          }
        }
        this.emit('time', this.time);
        this.dirty = true;
      }
      if (this.engine.cameraMode === 'editor' && this.engine.controls.update()) this.dirty = true;
      if (!this.dirty && !this.playing) return;
      this.dirty = false;
      const info = this.engine.renderFrame(this.project, this.time);
      this.currentShot = info.cam.clip;
      frames++;
      acc += dt;
      if (acc > 0.5) {
        this.fps = frames / acc;
        frames = 0;
        acc = 0;
        this.emit('fps', this.fps);
      }
      this.emit('frame', info);
    };
    requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------------ environment / generator
  async setEnvironment(envId) {
    if (!ENV_BY_ID[envId]) return;
    this.setStatus(`Building ${ENV_BY_ID[envId].name}…`);
    await new Promise((r) => setTimeout(r, 20));
    applyEnvironmentPreset(this.project, envId);
    await this.syncAll();
    // keep animated vehicles on the new road (timing, cameras and FX stay untouched)
    this._remapPathsToRoad();
    await this.syncAll();
    this.setStatus('');
    this.commit(`Environment: ${ENV_BY_ID[envId].name}`);
  }

  _remapPathsToRoad() {
    const env = this.engine.env;
    if (!env?.curve) return;
    const curve = env.curve;
    const len = curve.getLength();
    for (const a of this.project.actors) {
      const keys = a.path.keys;
      if (keys.length < 2) continue;
      const cum = [0];
      for (let i = 1; i < keys.length; i++) {
        const [x0, , z0] = keys[i - 1].p, [x1, , z1] = keys[i].p;
        cum.push(cum[i - 1] + Math.hypot(x1 - x0, z1 - z0));
      }
      const total = Math.min(cum[cum.length - 1], len - 40);
      const k = cum[cum.length - 1] > 0 ? total / cum[cum.length - 1] : 1;
      const d0 = Math.max(20, (len - total) / 2);
      const lane = -env.roadWidth * 0.2;
      keys.forEach((key, i) => {
        const u = clamp((d0 + cum[i] * k) / len, 0, 1);
        const p = curve.getPointAt(u);
        const tan = curve.getTangentAt(u);
        p.addScaledVector(new THREE.Vector3(tan.z, 0, -tan.x).normalize(), lane);
        key.p = [+p.x.toFixed(3), 0, +p.z.toFixed(3)];
      });
    }
    // static actors: move next to the hero's final position
    const hero = this.project.actors[0];
    if (hero && !hero.path.keys.length) {
      const p = curve.getPointAt(0.5);
      hero.transform.position = [p.x, 0, p.z];
    }
  }

  async generate(opts) {
    this.pause();
    this.setStatus('Generating trailer…');
    await new Promise((r) => setTimeout(r, 20));
    if (opts.envId && opts.envId !== this.project.environment.id) applyEnvironmentPreset(this.project, opts.envId);
    // hero first so the environment scales to it
    const idx = this.project.actors.findIndex((a) => a.id === opts.actorId);
    if (idx > 0) this.project.actors.unshift(this.project.actors.splice(idx, 1)[0]);
    await this.syncAll();
    if (opts.projectName) this.project.name = opts.projectName;
    const info = generateTrailer(this.project, this.engine, opts);
    this._lastGen = opts;
    await this.syncAll();
    this.commit('Generate cinematic trailer');
    this.setCameraMode('shot');
    this.select(null);
    this.seek(0);
    this.setStatus('');
    return info;
  }

  /** Quick drive path for any actor along the environment road from its nearest point. */
  async autoDrivePath(actorId) {
    const data = this.project.actors.find((a) => a.id === actorId);
    const rt = this.engine.actors.get(actorId);
    const curve = this.engine.env?.curve;
    if (!data || !rt || !curve) return;
    const len = curve.getLength();
    const pos = rt.root.position;
    let best = 0, bd = Infinity;
    for (let i = 0; i <= 400; i++) {
      const p = curve.getPointAt(i / 400);
      const d = p.distanceToSquared(pos);
      if (d < bd) {
        bd = d;
        best = i / 400;
      }
    }
    const speed = rt.dims.length > 6.5 ? 12 : 22;
    const D = this.project.duration;
    const total = Math.min(len * (1 - best) - 20, speed * D);
    const keys = [];
    const n = Math.max(2, Math.ceil(D / 3));
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * D;
      const u = clamp(best + (total * (i / n)) / len, 0, 1);
      const p = curve.getPointAt(u);
      const tan = curve.getTangentAt(u);
      const right = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
      p.addScaledVector(right, -this.engine.env.roadWidth * 0.2);
      keys.push({ id: uid('key'), t: +t.toFixed(3), p: [+p.x.toFixed(3), 0, +p.z.toFixed(3)] });
    }
    data.path.keys = keys;
    await this.syncAll();
    this.commit('Auto drive path');
  }

  // ------------------------------------------------------------------ keyframes
  async addKeyAtPlayhead(actorId = this.selectedActorId() || this.project.actors[0]?.id) {
    const data = this.project.actors.find((a) => a.id === actorId);
    const rt = this.engine.actors.get(actorId);
    if (!data || !rt) return;
    const st = rt.evaluate(this.time, {});
    const keys = data.path.keys;
    const eps = 0.5 / this.project.fps;
    let k = keys.find((k) => Math.abs(k.t - this.time) <= eps);
    if (!k) {
      k = { id: uid('key'), t: +this.time.toFixed(3), p: [st.position.x, st.position.y, st.position.z].map((v) => +v.toFixed(3)) };
      keys.push(k);
      keys.sort((a, b) => a.t - b.t);
    }
    await this.syncAll();
    this.commit('Add keyframe');
    this.select({ type: 'key', id: k.id, actorId });
  }

  async deleteSelection() {
    const s = this.selection;
    if (!s) return;
    const p = this.project;
    if (s.type === 'actor') p.actors = p.actors.filter((a) => a.id !== s.id);
    else if (s.type === 'key') {
      const a = p.actors.find((a) => a.id === s.actorId);
      if (a) a.path.keys = a.path.keys.filter((k) => k.id !== s.id);
    } else if (s.type === 'camera') p.camera.clips = p.camera.clips.filter((c) => c.id !== s.id);
    else if (s.type === 'fx') p.fx.clips = p.fx.clips.filter((c) => c.id !== s.id);
    this.selection = null;
    await this.syncAll();
    this.commit('Delete');
    this.emit('selection');
  }

  async duplicateSelection() {
    const s = this.selection;
    if (!s) return;
    const p = this.project;
    if (s.type === 'camera' || s.type === 'fx') {
      const list = s.type === 'camera' ? p.camera.clips : p.fx.clips;
      const c = list.find((c) => c.id === s.id);
      if (!c) return;
      const d = JSON.parse(JSON.stringify(c));
      d.id = uid(s.type === 'camera' ? 'cam' : 'fx');
      const len = c.end - c.start;
      d.start = c.end;
      d.end = Math.min(p.duration, c.end + len);
      list.push(d);
      this.commit('Duplicate clip');
      this.select({ type: s.type, id: d.id });
    } else if (s.type === 'actor') {
      const a = p.actors.find((a) => a.id === s.id);
      const d = JSON.parse(JSON.stringify(a));
      d.id = uid('actor');
      d.name = a.name + ' copy';
      const rt = this.engine.actors.get(a.id);
      const off = rt ? rt.dims.width * 2.5 : 3;
      d.transform.position[0] += off;
      d.path.keys.forEach((k) => {
        k.id = uid('key');
        k.p[0] += off;
      });
      p.actors.push(d);
      await this.syncAll();
      this.commit('Duplicate actor');
      this.select({ type: 'actor', id: d.id });
    }
  }

  // ------------------------------------------------------------------ camera / fx clips
  addShot(type) {
    const p = this.project;
    const start = +this.time.toFixed(3);
    const next = p.camera.clips.filter((c) => c.start > start + 0.01).sort((a, b) => a.start - b.start)[0];
    let end = Math.min(p.duration, start + 3);
    if (next) end = Math.max(Math.min(end, next.start), Math.min(p.duration, start + 0.5));
    if (end - start < 0.1) end = Math.min(p.duration, start + 1);
    const clip = { id: uid('cam'), start, end, shot: type, target: this.selectedActorId() || p.actors[0]?.id || null, transition: 'cut', blend: 0.6, params: { ...SHOT_TYPES[type].defaults } };
    if (type === 'custom') {
      const cam = this.engine.cameraMode === 'editor' ? this.engine.editorCamera : this.engine.shotCamera;
      const target = this.engine.cameraMode === 'editor' ? this.engine.controls.target.clone() : cam.position.clone().add(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(10));
      clip.keys = [{ u: 0, pos: cam.position.toArray(), target: target.toArray(), fov: cam.fov }];
    }
    p.camera.clips.push(clip);
    this.commit(`Add ${SHOT_TYPES[type].label}`);
    this.select({ type: 'camera', id: clip.id });
  }

  /** Store the editor camera as a key of a custom camera clip at the playhead. */
  captureCustomKey(clipId) {
    const clip = this.project.camera.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const e = this.engine;
    const u = clamp((this.time - clip.start) / Math.max(0.01, clip.end - clip.start), 0, 1);
    clip.keys = (clip.keys || []).filter((k) => Math.abs(k.u - u) > 0.01);
    clip.keys.push({ u: +u.toFixed(4), pos: e.editorCamera.position.toArray().map((v) => +v.toFixed(3)), target: e.controls.target.toArray().map((v) => +v.toFixed(3)), fov: e.editorCamera.fov });
    clip.keys.sort((a, b) => a.u - b.u);
    clip.shot = 'custom';
    this.commit('Camera keyframe');
    this.emit('selection');
    toast(`Camera keyframe stored at ${(u * 100).toFixed(0)}% of the shot`, 'success', 1800);
  }

  splitClipAtPlayhead() {
    const s = this.selection;
    if (!s || (s.type !== 'camera' && s.type !== 'fx')) return toast('Select a camera or FX clip to split', 'info');
    const list = s.type === 'camera' ? this.project.camera.clips : this.project.fx.clips;
    const c = list.find((c) => c.id === s.id);
    if (!c || this.time <= c.start + 0.05 || this.time >= c.end - 0.05) return toast('Move the playhead inside the selected clip', 'info');
    const d = JSON.parse(JSON.stringify(c));
    d.id = uid(s.type === 'camera' ? 'cam' : 'fx');
    d.start = +this.time.toFixed(3);
    c.end = d.start;
    list.push(d);
    this.commit('Split clip');
  }

  addFx(type) {
    const p = this.project;
    const len = { title: 3.5, fadeIn: 1.5, fadeOut: 1.5, flash: 0.4, sparks: 1.5, smoke: 3, dust: 6 }[type] || 2;
    const start = +Math.min(this.time, Math.max(0, p.duration - len)).toFixed(3);
    const clip = { id: uid('fx'), type, start, end: Math.min(p.duration, start + len), intensity: 1 };
    if (type === 'title') Object.assign(clip, { text: p.actors[0]?.name || 'Title', subtitle: '', style: 'cinematic' });
    if (['smoke', 'sparks'].includes(type)) clip.target = this.selectedActorId() || p.actors[0]?.id || null;
    p.fx.clips.push(clip);
    this.commit(`Add ${FX_TYPES[type].label}`);
    this.select({ type: 'fx', id: clip.id });
  }

  // ------------------------------------------------------------------ files
  async saveProjectFile() {
    const p = JSON.parse(JSON.stringify(this.project));
    const embedded = [];
    for (const a of p.assets) {
      if (a.source === 'builtin') continue;
      const entry = this.assetCache.get(a.id);
      const rec = entry?.record || (await Storage.getAsset(a.id));
      if (rec) {
        a.data = { main: rec.main, files: rec.files.map((f) => ({ name: f.name, type: f.type, b64: Storage.bufferToBase64(f.buffer) })) };
        embedded.push(a.name);
      }
    }
    p.savedAt = new Date().toISOString();
    p.app = 'Cinematic Trailer Studio';
    const blob = new Blob([JSON.stringify(p)], { type: 'application/json' });
    Storage.downloadBlob(blob, `${(this.project.name || 'trailer').replace(/[^\w\-]+/g, '_')}.ctrailer.json`);
    toast(`Project saved${embedded.length ? ` with ${embedded.length} embedded model(s)` : ''}.`, 'success');
  }

  async loadProjectFile(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return toast('Not a valid project file', 'error');
    }
    if (!data || !Array.isArray(data.actors)) return toast('Not a Cinematic Trailer Studio project', 'error');
    this.pause();
    this.setStatus('Loading project…');
    for (const a of data.assets || []) {
      if (!a.data) continue;
      const rec = { id: a.id, name: a.name, main: a.data.main, files: a.data.files.map((f) => ({ name: f.name, type: f.type, buffer: Storage.base64ToBuffer(f.b64) })), size: a.size, source: a.source };
      await Storage.putAsset(rec);
      this.assetCache.delete(a.id);
      delete a.data;
    }
    for (const id of [...this.engine.actors.keys()]) this.engine.removeActor(id);
    this.project = normalizeProject(data);
    this.selection = null;
    await this.syncAll();
    this.history.reset(JSON.stringify(this.project));
    this._autosave();
    this.seek(0);
    this.setStatus('');
    this.emit('project');
    this.emit('selection');
    toast(`Loaded "${this.project.name}"`, 'success');
  }

  async resetScene() {
    for (const id of [...this.engine.actors.keys()]) this.engine.removeActor(id);
    Storage.clearAutosave();
    await this.newProject(true);
    toast('Scene reset', 'info');
  }

  // ------------------------------------------------------------------ export
  async exportVideo(settings, onProgress, signal) {
    this.pause();
    const prevMode = this.engine.cameraMode;
    try {
      const res = await exportVideo({ engine: this.engine, project: this.project, ...settings, onProgress, signal });
      return res;
    } finally {
      this.engine.setCameraMode(prevMode);
      this.dirty = true;
      this.seek(this.time);
    }
  }

  convertToMP4(blob, onProgress) {
    return convertToMP4(blob, onProgress);
  }

  setQuality(q) {
    this.prefs.quality = q;
    Storage.savePrefs(this.prefs);
    this.engine.setQuality(q);
    this.dirty = true;
  }
}

export { DEG };
