// Builds the editor shell (top bar, panels, viewport, timeline) and wires shortcuts.
import { h, button, iconButton, iconEl, select, toast, confirmDialog } from './dom.js';
import { LeftPanel } from './LeftPanel.js';
import { Inspector } from './Inspector.js';
import { Timeline } from './Timeline.js';
import { openGenerateDialog, openExportDialog, openHelpDialog } from './Dialogs.js';
import { filesFromDataTransfer } from '../assets/ModelLoader.js';
import { SHOT_TYPES } from '../anim/CameraShots.js';
import { formatTime } from '../anim/math.js';

export class Layout {
  constructor(root) {
    this.root = root;
    this.viewportEl = h('div', { class: 'viewport' });
    this.left = h('aside', { class: 'panel left' });
    this.right = h('aside', { class: 'panel right' });
    this.timelineEl = h('footer', { class: 'timeline' });
    this.topbar = h('header', { class: 'topbar' });
    this.overlay = h('div', { class: 'vp-overlay' });
    this.dropOverlay = h('div', { class: 'drop-overlay' }, h('div', { class: 'drop-card' }, iconEl('upload', 'big'), h('div', {}, 'Drop GLB / GLTF files to import'), h('div', { class: 'muted' }, 'Folders and .gltf + .bin + textures are supported')));
    this.loading = h('div', { class: 'vp-loading show' }, h('div', { class: 'spinner' }), h('span', {}, 'Building scene…'));
    this.vpWrap = h('div', { class: 'viewport-wrap' }, this.viewportEl, this.overlay, this.loading, this.dropOverlay);
    root.append(this.topbar, h('main', { class: 'workspace' }, this.left, h('section', { class: 'center' }, this.vpWrap), this.right), this.timelineEl);
  }

  mount(app) {
    this.app = app;
    this.leftPanel = new LeftPanel(app, this.left);
    this.inspector = new Inspector(app, this.right);
    this.timeline = new Timeline(app, this.timelineEl);
    this._topbar();
    this._viewportOverlay();
    this._dragDrop();
    this._shortcuts();
    this._resizers();
    app.on('status', (s) => {
      this.loading.classList.toggle('show', !!s);
      this.loading.querySelector('span').textContent = s;
    });
    this.loading.classList.remove('show');
  }

  _topbar() {
    const app = this.app;
    this.nameEl = h('input', { class: 'project-name', value: app.project.name, spellcheck: 'false' });
    this.nameEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.nameEl.blur();
    });
    this.nameEl.addEventListener('change', () => app.edit('Rename project', (p) => (p.name = this.nameEl.value || 'Untitled Trailer')));
    const openInput = h('input', { type: 'file', accept: '.json,.ctrailer,.ctrailer.json,application/json', style: { display: 'none' } });
    openInput.addEventListener('change', () => {
      const f = openInput.files[0];
      openInput.value = '';
      if (f) app.loadProjectFile(f);
    });
    this.openProject = () => openInput.click();
    this.undoBtn = iconButton('undo', { title: 'Undo (Ctrl+Z)', onClick: () => app.undo() });
    this.redoBtn = iconButton('redo', { title: 'Redo (Ctrl+Shift+Z)', onClick: () => app.redo() });
    this.saveState = h('span', { class: 'save-state' }, iconEl('check'), 'Saved');
    const reset = async () => {
      if (await confirmDialog('Reset scene?', 'This clears the current project (imported models stay available in Project Assets after re-import). Save the project first if you want to keep it.', 'Reset')) app.resetScene();
    };
    this.topbar.append(
      h('div', { class: 'brand' }, h('div', { class: 'logo' }, iconEl('film')), h('div', { class: 'brand-text' }, h('b', {}, 'CINEFORGE'), h('span', {}, 'Trailer Studio'))),
      h('div', { class: 'menu' }, button('New', { icon: 'file', onClick: reset, title: 'Reset scene' }), button('Open', { icon: 'open', onClick: () => this.openProject(), title: 'Load project (Ctrl+O)' }), button('Save', { icon: 'save', onClick: () => app.saveProjectFile(), title: 'Save project with embedded models (Ctrl+S)' }), h('span', { class: 'sep' }), this.undoBtn, this.redoBtn),
      h('div', { class: 'title-wrap' }, this.nameEl, this.saveState),
      h(
        'div',
        { class: 'actions' },
        button('Import Model', { icon: 'upload', onClick: () => this.leftPanel.openFilePicker(), title: 'Import GLB / GLTF (Ctrl+I)' }),
        button('Generate Cinematic Trailer', { icon: 'wand', cls: 'btn-accent', onClick: () => openGenerateDialog(app), title: 'G' }),
        button('Export Video', { icon: 'export', primary: true, onClick: () => openExportDialog(app), title: 'Ctrl+E' }),
        iconButton('fullscreen', { title: 'Fullscreen preview (Shift+F)', onClick: () => this.toggleFullscreen() }),
        iconButton('keyboard', { title: 'Keyboard shortcuts (?)', onClick: () => openHelpDialog() })
      ),
      openInput
    );
    const updHist = () => {
      this.undoBtn.disabled = !app.history.canUndo;
      this.redoBtn.disabled = !app.history.canRedo;
    };
    app.on('history', updHist);
    updHist();
    app.on('project', () => {
      if (document.activeElement !== this.nameEl) this.nameEl.value = app.project.name;
      this.saveState.classList.add('pending');
      this.saveState.lastChild.textContent = 'Saving…';
    });
    app.on('autosave', (ok) => {
      this.saveState.classList.remove('pending');
      this.saveState.lastChild.textContent = ok ? 'Autosaved' : 'Autosave failed';
    });
  }

  _viewportOverlay() {
    const app = this.app;
    const camShot = h('button', { class: 'seg-btn', onclick: () => app.setCameraMode('shot') }, iconEl('camera'), 'Shot Camera');
    const camEdit = h('button', { class: 'seg-btn', onclick: () => app.setCameraMode('editor') }, iconEl('move'), 'Editor');
    const gizmo = ['translate', 'rotate', 'scale'].map((m, i) => iconButton(['move', 'rotate', 'scale'][i], { title: `${m} (${'WER'[i]})`, onClick: () => app.setGizmoMode(m) }));
    const gizmoBox = h('div', { class: 'seg gizmo' }, gizmo);
    const pilot = iconButton('target', { title: 'Copy shot camera view into the editor camera', onClick: () => (app.engine.syncEditorToShot(), app.setCameraMode('editor')) });
    const quality = select({ value: app.prefs.quality || 'high', options: [['low', 'Draft'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], onChange: (v) => app.setQuality(v) });
    const fps = h('span', { class: 'fps' }, '— fps');
    const shotLabel = h('div', { class: 'shot-label' });
    const tc = h('div', { class: 'vp-timecode' });
    const safe = h('div', { class: 'safe-frame' });
    this.overlay.append(
      h('div', { class: 'vp-top-left' }, h('div', { class: 'seg' }, camShot, camEdit), gizmoBox, pilot),
      h('div', { class: 'vp-top-right' }, h('span', { class: 'muted' }, 'Preview'), quality, fps),
      h('div', { class: 'vp-bottom-left' }, shotLabel),
      h('div', { class: 'vp-bottom-right' }, tc),
      safe
    );
    const updMode = () => {
      const ed = app.engine.cameraMode === 'editor';
      camShot.classList.toggle('active', !ed);
      camEdit.classList.toggle('active', ed);
      gizmoBox.style.display = ed ? '' : 'none';
      this.vpWrap.classList.toggle('editor-mode', ed);
    };
    const updGizmo = () => gizmo.forEach((b, i) => b.classList.toggle('active', (app.gizmoMode || 'translate') === ['translate', 'rotate', 'scale'][i]));
    app.on('camera-mode', updMode);
    app.on('gizmo', updGizmo);
    updMode();
    updGizmo();
    app.on('fps', (v) => (fps.textContent = `${v.toFixed(0)} fps`));
    app.on('frame', (info) => {
      const clip = info.cam.clip;
      const marker = [...app.project.markers].reverse().find((m) => m.t <= app.time + 1e-4);
      shotLabel.textContent = `${marker ? marker.label + '  ·  ' : ''}${clip ? SHOT_TYPES[clip.shot]?.label || clip.shot : 'Auto orbit'}${app.engine.cameraMode === 'editor' ? '  (editor view)' : ''}`;
      tc.textContent = formatTime(app.time, app.project.fps);
    });
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else this.vpWrap.requestFullscreen?.().catch(() => toast('Fullscreen not allowed here', 'error'));
  }

  _dragDrop() {
    let depth = 0;
    const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      depth++;
      this.dropOverlay.classList.add('show');
    });
    window.addEventListener('dragleave', (e) => {
      if (!isFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) this.dropOverlay.classList.remove('show');
    });
    window.addEventListener('dragover', (e) => isFiles(e) && e.preventDefault());
    window.addEventListener('drop', async (e) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      depth = 0;
      this.dropOverlay.classList.remove('show');
      const files = await filesFromDataTransfer(e.dataTransfer);
      const proj = files.find((f) => /\.(ctrailer|json)$/i.test(f.name) && !files.some((g) => /\.(glb|gltf)$/i.test(g.name)));
      if (proj) return this.app.loadProjectFile(proj);
      await this.app.importFiles(files);
    });
  }

  _shortcuts() {
    const app = this.app;
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if (document.querySelector('.modal-backdrop')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key;
      const handled = () => e.preventDefault();
      if (ctrl && (k === 'z' || k === 'Z')) return handled(), e.shiftKey ? app.redo() : app.undo();
      if (ctrl && (k === 'y' || k === 'Y')) return handled(), app.redo();
      if (ctrl && (k === 's' || k === 'S')) return handled(), app.saveProjectFile();
      if (ctrl && (k === 'o' || k === 'O')) return handled(), this.openProject();
      if (ctrl && (k === 'i' || k === 'I')) return handled(), this.leftPanel.openFilePicker();
      if (ctrl && (k === 'e' || k === 'E')) return handled(), openExportDialog(app);
      if (ctrl && (k === 'd' || k === 'D')) return handled(), app.duplicateSelection();
      if (ctrl) return;
      switch (k) {
        case ' ':
          handled();
          app.togglePlay();
          break;
        case 'Enter':
        case 'Home':
          handled();
          app.stop();
          break;
        case 'End':
          app.seek(app.project.duration);
          break;
        case 'ArrowLeft':
          handled();
          e.shiftKey ? app.seek(app.time - 1) : app.step(-1);
          break;
        case 'ArrowRight':
          handled();
          e.shiftKey ? app.seek(app.time + 1) : app.step(1);
          break;
        case 'c':
        case 'C':
          app.setCameraMode(app.engine.cameraMode === 'editor' ? 'shot' : 'editor');
          break;
        case 'w':
        case 'W':
          app.setGizmoMode('translate');
          break;
        case 'e':
        case 'E':
          app.setGizmoMode('rotate');
          break;
        case 'r':
        case 'R':
          app.setGizmoMode('scale');
          break;
        case 'f':
        case 'F':
          if (e.shiftKey) this.toggleFullscreen();
          else {
            app.setCameraMode('editor');
            app.engine.focusOn(app.selectedActorId() || app.project.actors[0]?.id);
          }
          break;
        case 'F11':
          handled();
          this.toggleFullscreen();
          break;
        case 'k':
        case 'K':
          app.addKeyAtPlayhead();
          break;
        case 's':
        case 'S':
          app.splitClipAtPlayhead();
          break;
        case 'g':
        case 'G':
          openGenerateDialog(app);
          break;
        case 'Delete':
        case 'Backspace':
          handled();
          app.deleteSelection();
          break;
        case 'Escape':
          app.select(null);
          break;
        case '+':
        case '=':
          this.timeline.zoom(1.3);
          break;
        case '-':
        case '_':
          this.timeline.zoom(1 / 1.3);
          break;
        case '?':
          openHelpDialog();
          break;
      }
    });
  }

  _resizers() {
    // vertical splitter between workspace and timeline
    const grip = h('div', { class: 'tl-grip', title: 'Drag to resize timeline' });
    this.timelineEl.prepend(grip);
    grip.addEventListener('pointerdown', (e) => {
      const startY = e.clientY;
      const startH = this.timelineEl.getBoundingClientRect().height;
      const move = (ev) => {
        const nh = Math.min(window.innerHeight * 0.65, Math.max(150, startH - (ev.clientY - startY)));
        document.documentElement.style.setProperty('--timeline-h', `${nh}px`);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }
}
