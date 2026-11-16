// Right panel: Object Properties, Transform, Model setup, Motion path, Lighting, Materials.
import { h, section, row, slider, toggle, colorInput, select, button, numberInput, vec3Input, textInput, iconEl, iconButton } from './dom.js';
import { SHOT_TYPES, CLOSEUP_FOCUS } from '../anim/CameraShots.js';
import { FX_TYPES, TITLE_STYLES } from '../anim/Sequencer.js';
import { formatTime } from '../anim/math.js';

const SHOT_PARAMS = {
  distance: ['Distance', 0.1, 10, 0.01, '× model size'],
  height: ['Height', -0.5, 4, 0.01, ''],
  side: ['Side', -1, 1, 0.05, 'left / right'],
  fovStart: ['FOV start', 8, 90, 0.5, '°'],
  fovEnd: ['FOV end', 8, 90, 0.5, '°'],
  dolly: ['Dolly', -1, 1, 0.01, ''],
  anchor: ['Anchor time', 0, 1, 0.01, ''],
  angle: ['Angle', -180, 180, 1, '°'],
  orbit: ['Orbit sweep', -180, 180, 1, '°'],
  orbitSpeed: ['Orbit speed', -120, 120, 1, '°/s'],
  rise: ['Rise', -1, 1, 0.01, ''],
  drift: ['Drift', -1, 1, 0.01, ''],
  slide: ['Slide', -3, 3, 0.01, ''],
  track: ['Track target', 0, 1, 1, ''],
  shake: ['Camera shake', 0, 2, 0.01, ''],
  roll: ['Dutch angle', -30, 30, 0.5, '°'],
};

export class Inspector {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.body = h('div', { class: 'panel-scroll' });
    el.append(h('div', { class: 'panel-title' }, iconEl('sliders'), 'Properties'), this.body);
    const re = () => this.render();
    app.on('selection', re);
    app.on('project', re);
    app.on('time', () => this._updateLiveFields());
    this.render();
  }

  _live(fn) {
    return (v) => {
      fn(v);
      this.app.live();
    };
  }

  render() {
    const app = this.app;
    const sel = app.selection;
    const p = app.project;
    const parts = [];
    this._live_fields = [];
    if (sel?.type === 'actor') {
      const a = p.actors.find((x) => x.id === sel.id);
      if (a) parts.push(...this.actorSections(a));
    } else if (sel?.type === 'key') {
      const a = p.actors.find((x) => x.id === sel.actorId);
      const k = a?.path.keys.find((x) => x.id === sel.id);
      if (k) parts.push(this.keySection(a, k), ...this.actorSections(a));
    } else if (sel?.type === 'camera') {
      const c = p.camera.clips.find((x) => x.id === sel.id);
      if (c) parts.push(this.cameraSection(c));
    } else if (sel?.type === 'fx') {
      const c = p.fx.clips.find((x) => x.id === sel.id);
      if (c) parts.push(this.fxSection(c));
    }
    if (!parts.length) parts.push(this.projectSection());
    parts.push(this.lightingSection());
    const scroll = this.body.scrollTop;
    this.body.replaceChildren(...parts);
    this.body.scrollTop = scroll;
  }

  _updateLiveFields() {}

  projectSection() {
    const app = this.app;
    const p = app.project;
    return section(
      'Object Properties',
      { icon: 'film' },
      h('div', { class: 'hint' }, 'Nothing selected. Click a model in the viewport / outliner, or a clip / keyframe on the timeline.'),
      row('Project', textInput({ value: p.name, onChange: (v) => app.edit('Rename project', () => (p.name = v || 'Untitled Trailer')) })),
      row('Duration', numberInput({ value: p.duration, step: 0.5, min: 1, max: 600, suffix: 's', onChange: (v) => app.edit('Duration', () => (p.duration = v)) })),
      row('Frame rate', select({ value: p.fps, options: [[24, '24 fps'], [25, '25 fps'], [30, '30 fps'], [60, '60 fps']], onChange: (v) => app.edit('Frame rate', () => (p.fps = parseInt(v))) })),
      row('Objects', h('span', { class: 'value' }, `${p.actors.length} actors · ${p.camera.clips.length} shots · ${p.fx.clips.length} FX clips`))
    );
  }

  actorSections(a) {
    const app = this.app;
    const rt = app.engine.actors.get(a.id);
    const t = a.transform;
    const out = [];
    const info = rt?.info;
    out.push(
      section(
        'Object Properties',
        { icon: 'cube' },
        row('Name', textInput({ value: a.name, onChange: (v) => app.edit('Rename', () => (a.name = v || a.name)) })),
        rt
          ? h(
              'div',
              { class: 'stats' },
              stat('Size (L×W×H)', `${rt.dims.length.toFixed(2)} × ${rt.dims.width.toFixed(2)} × ${rt.dims.height.toFixed(2)} m`),
              stat('Triangles', info.triangles.toLocaleString()),
              stat('Meshes / Materials', `${info.meshes} / ${info.materialCount}`),
              stat('Textures', info.textureCount),
              stat('Wheels detected', rt.wheels.length),
              stat('Type', rt.kind === 'vehicle' ? 'Vehicle' : 'Static object'),
              stat('Forward axis', info.forwardAxis + (a.setup.forwardAxis === 'auto' ? ' (auto)' : '')),
              rt.autoScale !== 1 ? stat('Auto scale', `×${rt.autoScale.toPrecision(3)}`) : null,
              info.animations.length ? stat('Animations', info.animations.join(', ')) : null
            )
          : h('div', { class: 'hint' }, 'Model not loaded.'),
        h(
          'div',
          { class: 'btn-row' },
          button('Focus', { icon: 'target', onClick: () => (app.setCameraMode('editor'), app.engine.focusOn(a.id)) }),
          button('Duplicate', { icon: 'copy', onClick: () => app.duplicateSelection() }),
          button('Delete', { icon: 'trash', cls: 'danger', onClick: () => app.deleteSelection() })
        )
      )
    );
    const animated = a.path.keys.length >= 2;
    out.push(
      section(
        'Transform',
        { icon: 'move' },
        animated ? h('div', { class: 'hint warn' }, 'Position and heading come from the motion path. Moving the model with the gizmo writes a keyframe at the playhead. Rotation below is added as an offset.') : null,
        row('Position', vec3Input({ value: t.position, step: 0.05, onInput: this._live((v) => (t.position = v)), onChange: () => app.commit('Position') })),
        row('Rotation', vec3Input({ value: t.rotation, step: 1, onInput: this._live((v) => (t.rotation = v)), onChange: () => app.commit('Rotation') })),
        row('Scale', numberInput({ value: t.scale, step: 0.01, min: 0.001, max: 1000, onChange: (v) => app.edit('Scale', () => (t.scale = v)) })),
        h(
          'div',
          { class: 'btn-row' },
          button('Reset', { icon: 'reset', onClick: () => app.edit('Reset transform', () => Object.assign(t, { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 })) }),
          button('Drop to ground', { icon: 'download', onClick: () => app.edit('Drop to ground', () => (t.position[1] = app.engine.groundHeight(t.position[0], t.position[2]))) })
        )
      )
    );
    const s = a.setup;
    const anims = rt?.info.animations || [];
    out.push(
      section(
        'Model Setup',
        { icon: 'car', open: false },
        row('Type', select({ value: s.kind, options: [['auto', 'Auto detect'], ['vehicle', 'Vehicle'], ['prop', 'Static object']], onChange: (v) => app.edit('Type', () => (s.kind = v)) })),
        row('Forward axis', select({ value: s.forwardAxis, options: ['auto', '+Z', '-Z', '+X', '-X'], onChange: (v) => app.edit('Forward axis', () => (s.forwardAxis = v)) }), 'Which model axis is the front of the vehicle'),
        row('Up axis', select({ value: s.upAxis, options: ['+Y', '+Z', '-Z'], onChange: (v) => app.edit('Up axis', () => (s.upAxis = v)) })),
        row('Real length', numberInput({ value: s.targetLength, step: 0.1, min: 0, max: 500, suffix: 'm', onChange: (v) => app.edit('Real length', () => (s.targetLength = v)) }), '0 = keep imported size (implausible units are auto-fixed)'),
        row('Wheel spin', toggle({ value: s.wheelSpin, onChange: (v) => app.edit('Wheel spin', () => (s.wheelSpin = v)) })),
        row('Steering', toggle({ value: s.steering, onChange: (v) => app.edit('Steering', () => (s.steering = v)) })),
        row('Suspension', toggle({ value: s.suspension, onChange: (v) => app.edit('Suspension', () => (s.suspension = v)) }), 'Body pitch when braking / accelerating and roll in turns'),
        row('Headlights', select({ value: s.headlights, options: [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']], onChange: (v) => app.edit('Headlights', () => (s.headlights = v)) })),
        row('Wheel dust', toggle({ value: s.dust, onChange: (v) => app.edit('Wheel dust', () => (s.dust = v)) })),
        anims.length ? row('glTF animation', select({ value: s.animationClip, options: [['', 'None'], ...anims.map((n) => [n, n])], onChange: (v) => app.edit('Animation', () => (s.animationClip = v)) })) : null
      )
    );
    out.push(
      section(
        'Motion Path',
        { icon: 'key' },
        row('Keyframes', h('span', { class: 'value' }, `${a.path.keys.length}`)),
        row('Interpolation', select({ value: a.path.interpolation, options: [['smooth', 'Smooth (accel / brake)'], ['linear', 'Linear speed']], onChange: (v) => app.edit('Interpolation', () => (a.path.interpolation = v)) })),
        rt?.path.curve ? row('Path length', h('span', { class: 'value' }, `${rt.path.total.toFixed(0)} m · top speed ${this._topSpeed(rt)} km/h`)) : null,
        h(
          'div',
          { class: 'btn-row' },
          button('Key at playhead', { icon: 'key', onClick: () => app.addKeyAtPlayhead(a.id), title: 'K' }),
          button('Drive along road', { icon: 'car', onClick: () => app.autoDrivePath(a.id) }),
          button('Clear', { icon: 'trash', onClick: () => app.edit('Clear path', () => (a.path.keys = [])) })
        ),
        h('div', { class: 'hint' }, 'Switch to Editor camera, move the playhead, then drag the model with the Move gizmo to create keyframes. Duplicate a position at two times to make the vehicle stop.')
      )
    );
    if (rt) out.push(this.materialsSection(a, rt));
    return out;
  }

  _topSpeed(rt) {
    let max = 0;
    const D = this.app.project.duration;
    for (let t = 0; t <= D; t += 0.25) {
      const st = rt.path.evaluate(t, {});
      if (st) max = Math.max(max, Math.abs(st.speed));
    }
    return (max * 3.6).toFixed(0);
  }

  keySection(a, k) {
    const app = this.app;
    return section(
      'Keyframe',
      { icon: 'key' },
      row('Actor', h('span', { class: 'value' }, a.name)),
      row('Time', numberInput({ value: k.t, step: 1 / app.project.fps, min: 0, max: app.project.duration, suffix: 's', onChange: (v) => app.edit('Key time', () => ((k.t = v), a.path.keys.sort((x, y) => x.t - y.t))) })),
      row('Position', vec3Input({ value: k.p, step: 0.1, onInput: this._live((v) => (k.p = v)), onChange: () => app.commit('Key position') })),
      h(
        'div',
        { class: 'btn-row' },
        button('Go to key', { icon: 'target', onClick: () => app.seek(k.t) }),
        button('Hold (stop here)', {
          icon: 'pause',
          title: 'Duplicate this key 2 s later so the vehicle waits',
          onClick: () =>
            app.edit('Hold key', () => {
              const later = a.path.keys.filter((x) => x.t > k.t);
              const shift = 2;
              later.forEach((x) => (x.t += shift));
              a.path.keys.push({ id: 'key_' + Math.random().toString(36).slice(2, 9), t: k.t + shift, p: [...k.p] });
              a.path.keys.sort((x, y) => x.t - y.t);
            }),
        }),
        button('Delete', { icon: 'trash', cls: 'danger', onClick: () => app.deleteSelection() })
      )
    );
  }

  cameraSection(c) {
    const app = this.app;
    const p = app.project;
    const def = SHOT_TYPES[c.shot] || SHOT_TYPES.orbit;
    const params = { ...def.defaults, ...(c.params || {}) };
    c.params = params;
    const rows = Object.keys(def.defaults)
      .filter((k) => SHOT_PARAMS[k])
      .map((k) => {
        const [label, min, max, step, unit] = SHOT_PARAMS[k];
        return row(label, slider({ value: params[k], min, max, step, format: (v) => `${step >= 1 ? v.toFixed(0) : v.toFixed(2)}${unit && unit.length <= 4 ? unit : ''}`, onInput: this._live((v) => (params[k] = v)), onChange: () => app.commit('Shot parameter') }), unit);
      });
    return section(
      'Camera Shot',
      { icon: 'camera' },
      row('Shot type', select({ value: c.shot, options: Object.entries(SHOT_TYPES).map(([k, v]) => [k, v.label]), onChange: (v) => app.edit('Shot type', () => ((c.shot = v), (c.params = { ...SHOT_TYPES[v].defaults }))) })),
      row('Target', select({ value: c.target || '', options: [['', 'Hero (first actor)'], ...p.actors.map((a) => [a.id, a.name])], onChange: (v) => app.edit('Shot target', () => (c.target = v || null)) })),
      row('Start', numberInput({ value: c.start, step: 0.1, min: 0, max: p.duration, suffix: 's', onChange: (v) => app.edit('Shot start', () => (c.start = Math.min(v, c.end - 0.1))) })),
      row('Duration', numberInput({ value: c.end - c.start, step: 0.1, min: 0.1, max: p.duration, suffix: 's', onChange: (v) => app.edit('Shot duration', () => (c.end = c.start + v)) })),
      row('Transition', select({ value: c.transition, options: [['cut', 'Cut'], ['blend', 'Smooth blend']], onChange: (v) => app.edit('Transition', () => (c.transition = v)) })),
      c.transition === 'blend' ? row('Blend time', slider({ value: c.blend, min: 0.1, max: 3, step: 0.05, format: (v) => v.toFixed(2) + 's', onInput: this._live((v) => (c.blend = v)), onChange: () => app.commit('Blend time') })) : null,
      c.shot === 'closeUp' ? row('Focus on', select({ value: params.focus, options: CLOSEUP_FOCUS, onChange: (v) => app.edit('Close-up focus', () => (params.focus = v)) })) : null,
      ...rows,
      c.shot === 'custom'
        ? h(
            'div',
            { class: 'custom-keys' },
            h('div', { class: 'hint' }, `${(c.keys || []).length} camera keys. Frame the view with the Editor camera, move the playhead inside this shot and press "Capture".`),
            h('div', { class: 'btn-row' }, button('Capture view as key', { icon: 'camera', primary: true, onClick: () => app.captureCustomKey(c.id) }), button('Clear keys', { icon: 'trash', onClick: () => app.edit('Clear camera keys', () => (c.keys = [])) }))
          )
        : null,
      h(
        'div',
        { class: 'btn-row' },
        button('Preview shot', { icon: 'play', onClick: () => (app.setCameraMode('shot'), app.seek(c.start), app.play()) }),
        button('Split', { icon: 'scissors', onClick: () => app.splitClipAtPlayhead() }),
        button('Duplicate', { icon: 'copy', onClick: () => app.duplicateSelection() }),
        button('Delete', { icon: 'trash', cls: 'danger', onClick: () => app.deleteSelection() })
      )
    );
  }

  fxSection(c) {
    const app = this.app;
    const p = app.project;
    const def = FX_TYPES[c.type];
    return section(
      'Effect Clip',
      { icon: 'sparkles' },
      row('Type', h('span', { class: 'value' }, def?.label || c.type)),
      row('Start', numberInput({ value: c.start, step: 0.1, min: 0, max: p.duration, suffix: 's', onChange: (v) => app.edit('FX start', () => (c.start = Math.min(v, c.end - 0.05))) })),
      row('Duration', numberInput({ value: c.end - c.start, step: 0.1, min: 0.05, max: p.duration, suffix: 's', onChange: (v) => app.edit('FX duration', () => (c.end = c.start + v)) })),
      def?.hasIntensity ? row('Intensity', slider({ value: c.intensity ?? 1, min: 0, max: 3, step: 0.01, onInput: this._live((v) => (c.intensity = v)), onChange: () => app.commit('FX intensity') })) : null,
      ['smoke', 'sparks'].includes(c.type) ? row('Emitter', select({ value: c.target || '', options: [['', 'All vehicles'], ...p.actors.map((a) => [a.id, a.name])], onChange: (v) => app.edit('FX target', () => (c.target = v || null)) })) : null,
      def?.hasText ? row('Text', textInput({ value: c.text, onInput: this._live((v) => (c.text = v)), onChange: () => app.commit('Title text') })) : null,
      def?.hasText ? row('Subtitle', textInput({ value: c.subtitle, onInput: this._live((v) => (c.subtitle = v)), onChange: () => app.commit('Subtitle') })) : null,
      def?.hasText ? row('Style', select({ value: c.style || 'cinematic', options: TITLE_STYLES.map((s) => [s, s[0].toUpperCase() + s.slice(1)]), onChange: (v) => app.edit('Title style', () => (c.style = v)) })) : null,
      h(
        'div',
        { class: 'btn-row' },
        button('Go to', { icon: 'target', onClick: () => app.seek(c.start) }),
        button('Split', { icon: 'scissors', onClick: () => app.splitClipAtPlayhead() }),
        button('Duplicate', { icon: 'copy', onClick: () => app.duplicateSelection() }),
        button('Delete', { icon: 'trash', cls: 'danger', onClick: () => app.deleteSelection() })
      )
    );
  }

  lightingSection() {
    const app = this.app;
    const L = app.project.lighting;
    const live = this._live.bind(this);
    const commit = (label) => () => app.commit(label);
    return section(
      'Lighting',
      { icon: 'bulb' },
      row('Sun elevation', slider({ value: L.sunElevation, min: -5, max: 90, step: 0.5, format: (v) => `${v.toFixed(1)}°`, onInput: live((v) => (L.sunElevation = v)), onChange: commit('Sun elevation') })),
      row('Sun azimuth', slider({ value: L.sunAzimuth, min: 0, max: 360, step: 1, format: (v) => `${v.toFixed(0)}°`, onInput: live((v) => (L.sunAzimuth = v)), onChange: commit('Sun azimuth') })),
      row('Sun intensity', slider({ value: L.sunIntensity, min: 0, max: 10, step: 0.05, onInput: live((v) => (L.sunIntensity = v)), onChange: commit('Sun intensity') })),
      row('Sun color', colorInput({ value: L.sunColor, onInput: live((v) => (L.sunColor = v)), onChange: commit('Sun color') })),
      row('Sky light', slider({ value: L.ambient, min: 0, max: 3, step: 0.01, onInput: live((v) => (L.ambient = v)), onChange: commit('Ambient') })),
      row('Reflections', slider({ value: L.envIntensity, min: 0, max: 3, step: 0.01, onInput: live((v) => (L.envIntensity = v)), onChange: commit('Reflections') })),
      row('Exposure', slider({ value: L.exposure, min: 0.1, max: 3, step: 0.01, onInput: live((v) => (L.exposure = v)), onChange: commit('Exposure') }))
    );
  }

  materialsSection(a, rt) {
    const app = this.app;
    const list = rt.materialList.slice(0, 60);
    const items = list.map(({ key, material: m }) => {
      const ov = (a.materials[key] ||= {});
      const o = { ...rt.originals[key], ...ov };
      const set = (prop) => (v) => {
        ov[prop] = v;
        rt.applyMaterials();
        app.dirty = true;
      };
      const commit = () => app.commit('Material');
      const body = h(
        'div',
        { class: 'mat-body' },
        o.color ? row('Base color', colorInput({ value: o.color, onInput: set('color'), onChange: commit })) : null,
        o.metalness !== null ? row('Metalness', slider({ value: o.metalness, min: 0, max: 1, step: 0.01, onInput: set('metalness'), onChange: commit })) : null,
        o.roughness !== null ? row('Roughness', slider({ value: o.roughness, min: 0, max: 1, step: 0.01, onInput: set('roughness'), onChange: commit })) : null,
        o.emissive ? row('Emissive', colorInput({ value: o.emissive, onInput: set('emissive'), onChange: commit })) : null,
        o.emissiveIntensity !== null ? row('Emission', slider({ value: o.emissiveIntensity, min: 0, max: 20, step: 0.05, onInput: set('emissiveIntensity'), onChange: commit })) : null,
        row('Reflection', slider({ value: o.envMapIntensity, min: 0, max: 4, step: 0.01, onInput: set('envMapIntensity'), onChange: commit })),
        h('div', { class: 'btn-row' }, button('Reset to original', { icon: 'reset', onClick: () => app.edit('Reset material', () => delete a.materials[key]) }))
      );
      const hasMap = !!m.map;
      const el = h(
        'div',
        { class: 'mat' },
        h(
          'div',
          { class: 'mat-head', onclick: () => el.classList.toggle('open') },
          h('span', { class: 'swatch', style: { background: o.color || '#888' } }),
          h('span', { class: 'mat-name', title: key }, m.name || key.split('#')[0] || 'Material'),
          hasMap ? h('span', { class: 'badge dim' }, 'TEX') : null,
          Object.keys(ov).length ? h('span', { class: 'badge' }, 'EDITED') : null
        ),
        body
      );
      return el;
    });
    return section(
      'Materials',
      { icon: 'palette', open: false },
      h('div', { class: 'hint' }, `${rt.materialList.length} materials. Original textures are preserved; edits are stored as overrides in the project.`),
      ...items
    );
  }
}

function stat(label, value) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, String(value)));
}

export { formatTime, iconButton };
