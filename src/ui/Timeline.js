// Sequencer timeline: transport, ruler, section markers, camera track (shot clips),
// per-actor motion keyframes, FX clips and title clips. Drag to move / trim, snap,
// zoom (Ctrl + wheel), scrub on the ruler.
import { h, iconButton, iconEl, numberInput, select, toast } from './dom.js';
import { SHOT_TYPES } from '../anim/CameraShots.js';
import { FX_TYPES } from '../anim/Sequencer.js';
import { formatTime, clamp } from '../anim/math.js';

const ROW_H = 30;
const HEAD_W = 190;

export class Timeline {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.pxPerSec = 24;
    this.fitted = false;
    this.snap = true;

    // ---- transport bar
    this.playBtn = iconButton('play', { title: 'Play / Pause (Space)', onClick: () => app.togglePlay(), cls: 'play' });
    this.timeEl = h('span', { class: 'timecode' }, '00:00:00');
    this.durationInput = numberInput({ value: app.project.duration, step: 1, min: 1, max: 600, suffix: 's', onChange: (v) => app.edit('Duration', (p) => (p.duration = v)) });
    this.loopBtn = iconButton('loop', { title: 'Loop playback', onClick: () => ((app.loop = !app.loop), this.loopBtn.classList.toggle('active', app.loop)), active: app.loop });
    this.snapBtn = iconButton('magnet', { title: 'Snap to clips / playhead / frames', onClick: () => ((this.snap = !this.snap), this.snapBtn.classList.toggle('active', this.snap)), active: true });
    const shotMenu = select({
      value: '',
      options: [['', '+ Camera shot…'], ...Object.entries(SHOT_TYPES).map(([k, v]) => [k, v.label])],
      onChange: (v) => {
        if (v) app.addShot(v);
        shotMenu.value = '';
      },
    });
    const fxMenu = select({
      value: '',
      options: [['', '+ Effect / title…'], ...Object.entries(FX_TYPES).map(([k, v]) => [k, v.label])],
      onChange: (v) => {
        if (v) app.addFx(v);
        fxMenu.value = '';
      },
    });
    const bar = h(
      'div',
      { class: 'tl-bar' },
      h(
        'div',
        { class: 'transport' },
        iconButton('start', { title: 'Go to start (Home)', onClick: () => app.stop() }),
        iconButton('prev', { title: 'Previous frame (←)', onClick: () => app.step(-1) }),
        this.playBtn,
        iconButton('stop', { title: 'Stop (Enter)', onClick: () => app.stop() }),
        iconButton('next', { title: 'Next frame (→)', onClick: () => app.step(1) }),
        iconButton('end', { title: 'Go to end (End)', onClick: () => app.seek(app.project.duration) }),
        this.loopBtn
      ),
      h('div', { class: 'time-box' }, this.timeEl, h('span', { class: 'time-sep' }, '/'), this.durationInput),
      h('div', { class: 'tl-tools' }, shotMenu, fxMenu, iconButton('key', { title: 'Keyframe at playhead (K)', onClick: () => app.addKeyAtPlayhead() }), iconButton('scissors', { title: 'Split selected clip at playhead (S)', onClick: () => app.splitClipAtPlayhead() }), iconButton('trash', { title: 'Delete selection (Del)', onClick: () => app.deleteSelection() }), this.snapBtn),
      h('div', { class: 'tl-zoom' }, iconButton('zoomOut', { title: 'Zoom out (-)', onClick: () => this.zoom(1 / 1.3) }), iconButton('zoomIn', { title: 'Zoom in (+)', onClick: () => this.zoom(1.3) }), iconButton('fullscreen', { title: 'Fit timeline', onClick: () => this.fit() }))
    );

    // ---- body
    this.heads = h('div', { class: 'tl-heads' });
    this.content = h('div', { class: 'tl-content' });
    this.scroll = h('div', { class: 'tl-scroll' }, this.content);
    this.ruler = h('div', { class: 'tl-ruler' });
    this.lanes = h('div', { class: 'tl-lanes' });
    this.playhead = h('div', { class: 'tl-playhead' }, h('div', { class: 'tl-playhead-head' }));
    this.content.append(this.ruler, this.lanes, this.playhead);
    el.append(bar, h('div', { class: 'tl-body' }, h('div', { class: 'tl-heads-wrap' }, h('div', { class: 'tl-heads-ruler' }, 'TRACKS'), this.heads), this.scroll));

    this.scroll.addEventListener('scroll', () => (this.heads.style.transform = `translateY(${-this.scroll.scrollTop}px)`));
    this.scroll.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const r = this.scroll.getBoundingClientRect();
          const x = e.clientX - r.left + this.scroll.scrollLeft;
          const t = x / this.pxPerSec;
          this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, false);
          this.scroll.scrollLeft = t * this.pxPerSec - (e.clientX - r.left);
        } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && this.content.scrollWidth > this.scroll.clientWidth && e.target.closest('.tl-ruler')) {
          e.preventDefault();
          this.scroll.scrollLeft += e.deltaY;
        }
      },
      { passive: false }
    );
    this._setupRuler();
    new ResizeObserver(() => {
      if (!this.fitted) this.fit();
    }).observe(this.scroll);

    app.on('project', () => this.render());
    app.on('selection', () => this.render());
    app.on('time', (t) => this.updatePlayhead(t));
    app.on('play', () => (this.playBtn.innerHTML = app.playing ? iconSvg('pause') : iconSvg('play')));
    app.on('frame', (info) => this._highlightShot(info.cam.clip));
    this.render();
  }

  fit() {
    const w = this.scroll.clientWidth - 30;
    if (w <= 0) return;
    this.pxPerSec = Math.max(4, w / Math.max(1, this.app.project.duration));
    this.fitted = true;
    this.render();
  }

  zoom(f, keepCenter = true) {
    const center = keepCenter ? (this.scroll.scrollLeft + this.scroll.clientWidth / 2) / this.pxPerSec : 0;
    this.pxPerSec = clamp(this.pxPerSec * f, 3, 600);
    this.render();
    if (keepCenter) this.scroll.scrollLeft = center * this.pxPerSec - this.scroll.clientWidth / 2;
  }

  x(t) {
    return t * this.pxPerSec;
  }
  tAt(clientX) {
    const r = this.scroll.getBoundingClientRect();
    return (clientX - r.left + this.scroll.scrollLeft) / this.pxPerSec;
  }

  _setupRuler() {
    let dragging = false;
    const seek = (e) => this.app.seek(clamp(this._snapTime(this.tAt(e.clientX), null, true), 0, this.app.project.duration));
    this.ruler.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.wasPlaying = this.app.playing;
      this.app.pause();
      this.ruler.setPointerCapture(e.pointerId);
      seek(e);
    });
    this.ruler.addEventListener('pointermove', (e) => dragging && seek(e));
    this.ruler.addEventListener('pointerup', (e) => {
      dragging = false;
      this.ruler.releasePointerCapture(e.pointerId);
    });
    // clicking empty lane space moves the playhead too
    this.lanes.addEventListener('pointerdown', (e) => {
      if (e.target === this.lanes || e.target.classList.contains('tl-row')) {
        this.app.seek(clamp(this.tAt(e.clientX), 0, this.app.project.duration));
        this.app.select(null);
      }
    });
  }

  _snapTime(t, ignoreId, framesOnly = false) {
    const fps = this.app.project.fps;
    if (!this.snap) return t;
    const thresh = 8 / this.pxPerSec;
    if (!framesOnly) {
      const cands = [0, this.app.project.duration, this.app.time];
      for (const c of this.app.project.camera.clips) if (c.id !== ignoreId) cands.push(c.start, c.end);
      for (const c of this.app.project.fx.clips) if (c.id !== ignoreId) cands.push(c.start, c.end);
      for (const m of this.app.project.markers) cands.push(m.t);
      let best = null, bd = thresh;
      for (const c of cands) {
        const d = Math.abs(c - t);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (best !== null) return best;
    }
    return Math.round(t * fps) / fps;
  }

  updatePlayhead(t) {
    this.playhead.style.transform = `translateX(${this.x(t)}px)`;
    this.timeEl.textContent = formatTime(t, this.app.project.fps);
    // auto-scroll while playing
    if (this.app.playing) {
      const x = this.x(t) - this.scroll.scrollLeft;
      if (x > this.scroll.clientWidth - 40 || x < 0) this.scroll.scrollLeft = this.x(t) - 60;
    }
  }

  _highlightShot(clip) {
    const id = clip?.id || '';
    if (id === this._activeShot) return;
    this._activeShot = id;
    this.lanes.querySelectorAll('.clip.cam').forEach((el) => el.classList.toggle('live', el.dataset.id === id));
  }

  render() {
    const app = this.app;
    const p = app.project;
    this.durationInput.setValue(p.duration);
    const W = this.x(p.duration) + 40;
    this.content.style.width = `${Math.max(W, this.scroll.clientWidth)}px`;
    this._renderRuler(p.duration);
    const heads = [];
    const rows = [];
    const sel = app.selection;

    // sections
    heads.push(head('Sections', 'film', 'sec'));
    rows.push(
      h(
        'div',
        { class: 'tl-row sections' },
        p.markers.map((m, i) => {
          const end = p.markers[i + 1]?.t ?? p.duration;
          return h('div', { class: 'section-band', style: { left: `${this.x(m.t)}px`, width: `${this.x(end - m.t)}px` }, title: m.label, onclick: () => app.seek(m.t) }, h('span', {}, m.label));
        })
      )
    );

    // camera
    heads.push(head('Camera', 'camera', 'cam'));
    rows.push(
      h(
        'div',
        { class: 'tl-row' },
        p.camera.clips.map((c) => {
          const el = h(
            'div',
            {
              class: `clip cam ${sel?.type === 'camera' && sel.id === c.id ? 'selected' : ''} ${c.transition === 'blend' ? 'blend' : ''}`,
              style: { left: `${this.x(c.start)}px`, width: `${Math.max(3, this.x(c.end - c.start))}px` },
              dataset: { id: c.id },
              title: `${SHOT_TYPES[c.shot]?.label || c.shot}  ${c.start.toFixed(2)}s – ${c.end.toFixed(2)}s`,
            },
            h('span', { class: 'clip-label' }, SHOT_TYPES[c.shot]?.label || c.shot),
            h('span', { class: 'handle l' }),
            h('span', { class: 'handle r' })
          );
          this._clipDrag(el, c, 'camera');
          return el;
        })
      )
    );

    // actors
    for (const a of p.actors) {
      heads.push(head(a.name, 'key', 'actor', () => app.select({ type: 'actor', id: a.id }), app.selectedActorId() === a.id));
      const rt = app.engine.actors.get(a.id);
      const rowEl = h('div', { class: 'tl-row keys' });
      // speed sparkline
      if (rt?.path.curve) {
        const canvas = h('canvas', { class: 'speed-graph', width: Math.min(8000, Math.ceil(this.x(p.duration))), height: ROW_H });
        this._drawSpeed(canvas, rt, p.duration);
        rowEl.append(canvas);
      }
      for (const k of a.path.keys) {
        const el = h('div', { class: `kf ${sel?.type === 'key' && sel.id === k.id ? 'selected' : ''}`, style: { left: `${this.x(k.t)}px` }, title: `Key ${k.t.toFixed(2)}s  (${k.p.map((v) => v.toFixed(1)).join(', ')})` });
        this._keyDrag(el, a, k);
        rowEl.append(el);
      }
      rowEl.addEventListener('dblclick', (e) => {
        if (e.target !== rowEl) return;
        app.seek(this._snapTime(this.tAt(e.clientX), null, true));
        app.addKeyAtPlayhead(a.id);
      });
      rows.push(rowEl);
    }

    // FX (lane-packed)
    const fxClips = p.fx.clips.filter((c) => c.type !== 'title');
    const lanes = packLanes(fxClips);
    const fxRow = h('div', { class: 'tl-row fx', style: { height: `${Math.max(1, lanes.count) * 22 + 8}px` } });
    for (const c of fxClips) fxRow.append(this._fxClip(c, lanes.of.get(c.id), sel));
    heads.push(head('Effects', 'sparkles', 'fx', null, false, Math.max(1, lanes.count) * 22 + 8));
    rows.push(fxRow);
    const titles = p.fx.clips.filter((c) => c.type === 'title');
    const tl = packLanes(titles);
    const titleRow = h('div', { class: 'tl-row fx', style: { height: `${Math.max(1, tl.count) * 22 + 8}px` } });
    for (const c of titles) titleRow.append(this._fxClip(c, tl.of.get(c.id), sel));
    heads.push(head('Titles', 'title', 'title', null, false, Math.max(1, tl.count) * 22 + 8));
    rows.push(titleRow);

    this.heads.replaceChildren(...heads);
    this.lanes.replaceChildren(...rows);
    this.updatePlayhead(app.time);
    this._activeShot = null;
  }

  _fxClip(c, lane, sel) {
    const def = FX_TYPES[c.type] || { label: c.type, color: '#888' };
    const label = c.type === 'title' ? `“${c.text || ''}”` : def.label;
    const el = h(
      'div',
      {
        class: `clip fxc ${sel?.type === 'fx' && sel.id === c.id ? 'selected' : ''}`,
        style: { left: `${this.x(c.start)}px`, width: `${Math.max(3, this.x(c.end - c.start))}px`, top: `${4 + lane * 22}px`, '--clip': def.color },
        title: `${def.label} ${c.start.toFixed(2)}s – ${c.end.toFixed(2)}s`,
      },
      h('span', { class: 'clip-label' }, label),
      h('span', { class: 'handle l' }),
      h('span', { class: 'handle r' })
    );
    this._clipDrag(el, c, 'fx');
    return el;
  }

  _renderRuler(dur) {
    const pps = this.pxPerSec;
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    const major = steps.find((s) => s * pps >= 60) || 60;
    const minor = steps.slice().reverse().find((s) => s * pps >= 8 && s < major) || major / 2;
    const ticks = [];
    for (let t = 0; t <= dur + 1e-6; t += minor) {
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-4;
      ticks.push(h('div', { class: `tick ${isMajor ? 'major' : ''}`, style: { left: `${this.x(t)}px` } }, isMajor ? h('span', {}, t >= 60 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}` : `${+t.toFixed(2)}s`) : null));
    }
    ticks.push(h('div', { class: 'tl-end', style: { left: `${this.x(dur)}px` } }));
    this.ruler.replaceChildren(...ticks);
  }

  _drawSpeed(canvas, rt, dur) {
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const n = Math.min(400, Math.ceil(W / 3));
    let max = 1;
    const vals = [];
    for (let i = 0; i <= n; i++) {
      const st = rt.path.evaluate((i / n) * dur, {});
      const v = Math.abs(st?.speed || 0);
      vals.push(v);
      max = Math.max(max, v);
    }
    g.clearRect(0, 0, W, H);
    g.beginPath();
    g.moveTo(0, H);
    vals.forEach((v, i) => g.lineTo((i / n) * W, H - 3 - (v / max) * (H - 8)));
    g.lineTo(W, H);
    g.closePath();
    g.fillStyle = 'rgba(232,176,74,0.10)';
    g.fill();
    g.beginPath();
    vals.forEach((v, i) => (i ? g.lineTo((i / n) * W, H - 3 - (v / max) * (H - 8)) : g.moveTo(0, H - 3 - (v / max) * (H - 8))));
    g.strokeStyle = 'rgba(232,176,74,0.45)';
    g.lineWidth = 1;
    g.stroke();
  }

  _clipDrag(el, clip, type) {
    const app = this.app;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'move';
      app.select({ type, id: clip.id });
      const startT = this.tAt(e.clientX);
      const orig = { start: clip.start, end: clip.end };
      let moved = false;
      const target = e.currentTarget;
      const onMove = (ev) => {
        const dt = this.tAt(ev.clientX) - startT;
        if (!moved && Math.abs(ev.clientX - e.clientX) < 3) return;
        moved = true;
        const dur = app.project.duration;
        if (mode === 'move') {
          const len = orig.end - orig.start;
          let s = this._snapTime(orig.start + dt, clip.id);
          const eSnap = this._snapTime(orig.end + dt, clip.id);
          if (Math.abs(eSnap - (orig.end + dt)) < Math.abs(s - (orig.start + dt))) s = eSnap - len;
          s = clamp(s, 0, dur - len);
          clip.start = +s.toFixed(4);
          clip.end = +(s + len).toFixed(4);
        } else if (mode === 'l') clip.start = +clamp(this._snapTime(orig.start + dt, clip.id), 0, clip.end - 0.05).toFixed(4);
        else clip.end = +clamp(this._snapTime(orig.end + dt, clip.id), clip.start + 0.05, dur).toFixed(4);
        target.style.left = `${this.x(clip.start)}px`;
        target.style.width = `${this.x(clip.end - clip.start)}px`;
        app.dirty = true;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (moved) app.commit(mode === 'move' ? 'Move clip' : 'Trim clip');
        else app.seek(clamp(this.tAt(e.clientX), clip.start, clip.end));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  _keyDrag(el, actor, key) {
    const app = this.app;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      app.select({ type: 'key', id: key.id, actorId: actor.id });
      const startX = e.clientX;
      const orig = key.t;
      let moved = false;
      const onMove = (ev) => {
        if (!moved && Math.abs(ev.clientX - startX) < 3) return;
        moved = true;
        const t = this._snapTime(orig + (ev.clientX - startX) / this.pxPerSec, null);
        key.t = +clamp(t, 0, app.project.duration).toFixed(4);
        el.style.left = `${this.x(key.t)}px`;
        actor.path.keys.sort((a, b) => a.t - b.t);
        app.engine.actors.get(actor.id)?.rebuildPath();
        app.dirty = true;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (moved) {
          app.syncAll().then(() => app.commit('Move keyframe'));
        } else app.seek(key.t);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }
}

function head(label, ic, cls, onClick, selected, height) {
  return h('div', { class: `tl-head ${cls} ${selected ? 'selected' : ''}`, onclick: onClick, style: height ? { height: `${height}px` } : null, title: label }, iconEl(ic), h('span', { class: 'tl-head-label' }, label));
}

function packLanes(clips) {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const ends = [];
  const of = new Map();
  for (const c of sorted) {
    let lane = ends.findIndex((e) => e <= c.start + 1e-4);
    if (lane === -1) {
      lane = ends.length;
      ends.push(c.end);
    } else ends[lane] = c.end;
    of.set(c.id, lane);
  }
  return { of, count: ends.length };
}

function iconSvg(name) {
  const s = iconEl(name);
  return s.innerHTML;
}

export { toast };
