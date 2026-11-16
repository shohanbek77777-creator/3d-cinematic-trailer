// Left panel: Project Assets / Outliner, Import, Scenes, Environment, Effects.
import { h, section, row, slider, toggle, colorInput, select, button, iconButton, iconEl, formatBytes, toast, numberInput } from './dom.js';
import { ENVIRONMENTS } from '../scene/environments/index.js';
import { DEMO_ASSET_ID } from '../app/Project.js';

export class LeftPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.assetsBody = h('div', { class: 'asset-list' });
    this.outlinerBody = h('div', { class: 'outliner' });
    this.scenesBody = h('div', { class: 'env-grid' });
    this.envBody = h('div');
    this.fxBody = h('div');
    this.fileInput = h('input', { type: 'file', multiple: true, accept: '.glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2', style: { display: 'none' } });
    this.fileInput.addEventListener('change', async () => {
      const files = [...this.fileInput.files];
      this.fileInput.value = '';
      if (files.length) await this.app.importFiles(files);
    });
    el.append(
      h('div', { class: 'panel-title' }, iconEl('layers'), 'Project'),
      h(
        'div',
        { class: 'panel-scroll' },
        section('Project Assets', { icon: 'cube' }, this.assetsBody, h('div', { class: 'sub-title' }, 'Scene Outliner'), this.outlinerBody),
        section('Import 3D Model', { icon: 'upload' }, this._importUI()),
        section('Scenes', { icon: 'mountain' }, this.scenesBody),
        section('Environment', { icon: 'sun', open: false }, this.envBody),
        section('Effects', { icon: 'sparkles' }, this.fxBody)
      ),
      this.fileInput
    );
    app.on('project', () => this.render());
    app.on('selection', () => this.renderOutliner());
    this.render();
  }

  openFilePicker() {
    this.fileInput.click();
  }

  _importUI() {
    const drop = h(
      'div',
      { class: 'dropzone', tabindex: 0, onclick: () => this.openFilePicker() },
      iconEl('upload', 'big'),
      h('div', { class: 'drop-title' }, 'Drop GLB / GLTF here'),
      h('div', { class: 'drop-sub' }, 'or click to browse · .gltf with .bin + textures (select all files or drop the folder)')
    );
    drop.addEventListener('keydown', (e) => e.key === 'Enter' && this.openFilePicker());
    const url = h('input', { type: 'url', class: 'text', placeholder: 'https://…/model.glb  (Google Drive, Dropbox, GitHub links OK)' });
    url.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') go();
    });
    const progress = h('div', { class: 'mini-progress' }, h('div', { class: 'bar' }));
    const status = h('div', { class: 'hint' });
    const go = async () => {
      const v = url.value.trim();
      if (!v) return url.focus();
      loadBtn.disabled = true;
      progress.classList.add('active');
      status.textContent = 'Downloading…';
      try {
        await this.app.importURL(v, (loaded, total) => {
          progress.firstChild.style.width = total ? `${(loaded / total) * 100}%` : '50%';
          status.textContent = `Downloading… ${formatBytes(loaded)}${total ? ' / ' + formatBytes(total) : ''}`;
        });
        status.textContent = 'Model loaded.';
        url.value = '';
      } catch (e) {
        status.textContent = '';
        toast(e.message, 'error', 12000);
      } finally {
        loadBtn.disabled = false;
        progress.classList.remove('active');
        progress.firstChild.style.width = '0';
      }
    };
    const loadBtn = button('Load URL', { icon: 'link', onClick: go });
    return h(
      'div',
      { class: 'import' },
      drop,
      h('div', { class: 'url-row' }, url, loadBtn),
      progress,
      status,
      h('div', { class: 'hint' }, 'Supports Draco, Meshopt and KTX2 compressed models. Models are stored in this browser (IndexedDB) and embedded when you Save Project.')
    );
  }

  render() {
    this.renderAssets();
    this.renderOutliner();
    this.renderScenes();
    this.renderEnv();
    this.renderFx();
  }

  renderAssets() {
    const p = this.app.project;
    this.assetsBody.replaceChildren(
      ...p.assets.map((a) =>
        h(
          'div',
          { class: 'asset' },
          h('div', { class: 'asset-icon' }, iconEl(a.source === 'builtin' ? 'car' : 'cube')),
          h('div', { class: 'asset-info' }, h('div', { class: 'asset-name', title: a.name }, a.name), h('div', { class: 'asset-meta' }, a.source === 'builtin' ? 'Built-in demo' : `${(a.source || 'file').toUpperCase()} · ${formatBytes(a.size)}`)),
          iconButton('plus', { title: 'Add to scene', onClick: () => this.app.addActorFromAsset(a.id) }),
          a.id !== DEMO_ASSET_ID ? iconButton('trash', { title: 'Remove asset (and its actors)', onClick: () => this.app.removeAsset(a.id) }) : null
        )
      )
    );
  }

  renderOutliner() {
    const p = this.app.project;
    const sel = this.app.selectedActorId();
    if (!p.actors.length) {
      this.outlinerBody.replaceChildren(h('div', { class: 'empty' }, 'No objects in the scene — import a model.'));
      return;
    }
    this.outlinerBody.replaceChildren(
      ...p.actors.map((a, i) => {
        const rt = this.app.engine.actors.get(a.id);
        return h(
          'div',
          { class: `outliner-item ${sel === a.id ? 'selected' : ''}`, onclick: () => this.app.select({ type: 'actor', id: a.id }) },
          iconEl(rt?.kind === 'vehicle' ? 'car' : 'cube'),
          h('span', { class: 'outliner-name' }, a.name),
          i === 0 ? h('span', { class: 'badge' }, 'HERO') : null,
          a.path.keys.length ? h('span', { class: 'badge dim' }, `${a.path.keys.length} keys`) : null,
          iconButton(a.setup.visible === false ? 'eyeOff' : 'eye', {
            title: 'Toggle visibility',
            onClick: (e) => {
              e.stopPropagation();
              this.app.edit('Visibility', () => (a.setup.visible = a.setup.visible === false));
            },
          })
        );
      })
    );
  }

  renderScenes() {
    const cur = this.app.project.environment.id;
    this.scenesBody.replaceChildren(
      ...ENVIRONMENTS.map((env) =>
        h(
          'button',
          { class: `env-card ${env.id === cur ? 'active' : ''}`, title: env.description, onclick: () => env.id !== cur && this.app.setEnvironment(env.id) },
          h('div', { class: 'env-thumb', style: { background: env.thumb } }, h('div', { class: 'env-horizon' })),
          h('div', { class: 'env-name' }, env.name)
        )
      )
    );
  }

  renderEnv() {
    const app = this.app;
    const p = app.project;
    const live = (fn) => (v) => {
      fn(v);
      app.live();
    };
    const commit = (label) => () => app.commit(label);
    const amb = p.effects.particles.ambient;
    this.envBody.replaceChildren(
      row(
        'Variation',
        h(
          'div',
          { class: 'inline' },
          numberInput({ value: p.environment.seed, step: 1, min: 1, max: 9999, onChange: (v) => app.edit('Environment variation', () => (p.environment.seed = Math.round(v))) }),
          iconButton('reset', { title: 'Randomize', onClick: () => app.edit('Environment variation', () => (p.environment.seed = 1 + Math.floor(Math.random() * 9999))) })
        ),
        'Seed of the procedural layout'
      ),
      row('Ambient FX', toggle({ value: amb.enabled, onChange: (v) => app.edit('Ambient particles', () => (amb.enabled = v)) }), 'Floating dust / ash / rain motes'),
      row('Amount', slider({ value: amb.amount, min: 0, max: 3, step: 0.05, onInput: live((v) => (amb.amount = v)), onChange: commit('Ambient amount') })),
      row('Shadows', toggle({ value: p.lighting.shadows, onChange: (v) => app.edit('Shadows', () => (p.lighting.shadows = v)) })),
      row('Headlights', toggle({ value: p.lighting.headlights, onChange: (v) => app.edit('Headlights', () => (p.lighting.headlights = v)) }), 'Vehicle headlights for actors set to "auto"'),
      h('div', { class: 'hint' }, 'Sun, sky light and exposure live in the right panel → Lighting.')
    );
  }

  renderFx() {
    const app = this.app;
    const fx = app.project.effects;
    const live = (fn) => (v) => {
      fn(v);
      app.live();
    };
    const commit = (label) => () => app.commit(label);
    const tog = (obj, label) => toggle({ value: obj.enabled, onChange: (v) => app.edit(label, () => (obj.enabled = v)) });
    const sl = (obj, key, min, max, step, label, format) => row(label, slider({ value: obj[key], min, max, step, format, onInput: live((v) => (obj[key] = v)), onChange: commit(label) }));
    const col = (obj, key, label) => row(label, colorInput({ value: obj[key], onInput: live((v) => (obj[key] = v)), onChange: commit(label) }));
    const group = (title, obj, label, ...rows) => {
      const g = h('div', { class: `fx-group ${obj.enabled ? '' : 'off'}` }, h('div', { class: 'fx-head' }, h('span', {}, title), tog(obj, label)), h('div', { class: 'fx-rows' }, ...rows));
      return g;
    };
    const P = fx.particles;
    this.fxBody.replaceChildren(
      group('Bloom', fx.bloom, 'Bloom', sl(fx.bloom, 'strength', 0, 3, 0.01, 'Strength'), sl(fx.bloom, 'radius', 0, 1, 0.01, 'Radius'), sl(fx.bloom, 'threshold', 0, 8, 0.01, 'Threshold')),
      group('Fog', fx.fog, 'Fog', sl(fx.fog, 'density', 0, 0.02, 0.0001, 'Density', (v) => v.toFixed(4)), col(fx.fog, 'color', 'Color')),
      group('Depth of Field', fx.dof, 'Depth of field', sl(fx.dof, 'aperture', 0, 4, 0.01, 'Aperture'), sl(fx.dof, 'maxBlur', 1, 24, 0.5, 'Max blur'), sl(fx.dof, 'focusOffset', -20, 20, 0.1, 'Focus offset')),
      group(
        'Color Grading',
        fx.grading,
        'Color grading',
        sl(fx.grading, 'exposure', -2, 2, 0.01, 'Exposure (EV)'),
        sl(fx.grading, 'contrast', 0.5, 1.8, 0.01, 'Contrast'),
        sl(fx.grading, 'saturation', 0, 2, 0.01, 'Saturation'),
        sl(fx.grading, 'temperature', -1, 1, 0.01, 'Temperature'),
        sl(fx.grading, 'tint', -1, 1, 0.01, 'Tint'),
        col(fx.grading, 'shadowsColor', 'Shadows'),
        col(fx.grading, 'highlightsColor', 'Highlights'),
        sl(fx.grading, 'splitAmount', 0, 1, 0.01, 'Split tone'),
        sl(fx.grading, 'vignette', 0, 1, 0.01, 'Vignette'),
        sl(fx.grading, 'grain', 0, 0.2, 0.001, 'Film grain'),
        sl(fx.grading, 'chromatic', 0, 3, 0.01, 'Chromatic ab.')
      ),
      group(
        'Motion Blur',
        fx.motionBlur,
        'Motion blur',
        sl(fx.motionBlur, 'shutter', 0, 360, 1, 'Shutter angle', (v) => `${v}°`),
        sl(fx.motionBlur, 'exportSamples', 1, 16, 1, 'Export samples'),
        sl(fx.motionBlur, 'previewSamples', 1, 8, 1, 'Preview samples'),
        h('div', { class: 'hint' }, 'True temporal motion blur: each frame averages sub-frame renders across the shutter. Preview samples cost real-time FPS.')
      ),
      group('Lens Flare', fx.lensFlare, 'Lens flare', sl(fx.lensFlare, 'intensity', 0, 3, 0.01, 'Intensity'), sl(fx.lensFlare, 'streak', 0, 3, 0.01, 'Anamorphic'), sl(fx.lensFlare, 'ghosts', 0, 3, 0.01, 'Ghosts')),
      group('Dust', P.dust, 'Dust', sl(P.dust, 'amount', 0, 4, 0.05, 'Amount'), sl(P.dust, 'size', 0.2, 3, 0.05, 'Size'), col(P.dust, 'color', 'Color')),
      group('Smoke', P.smoke, 'Smoke', sl(P.smoke, 'amount', 0, 4, 0.05, 'Amount'), sl(P.smoke, 'opacity', 0, 1, 0.01, 'Opacity'), col(P.smoke, 'color', 'Color')),
      group('Sparks', P.sparks, 'Sparks', sl(P.sparks, 'amount', 0, 4, 0.05, 'Amount'), col(P.sparks, 'color', 'Color')),
      group(
        'Letterbox',
        fx.letterbox,
        'Letterbox',
        row('Aspect', select({ value: fx.letterbox.aspect, options: [[2.39, '2.39 : 1 Scope'], [2.0, '2.00 : 1 Univisium'], [1.85, '1.85 : 1 Flat']], onChange: (v) => app.edit('Letterbox', () => (fx.letterbox.aspect = parseFloat(v))) }))
      )
    );
  }
}
