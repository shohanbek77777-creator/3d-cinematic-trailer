// Modal dialogs: Generate Cinematic Trailer, Export Video, Keyboard shortcuts.
import { h, modal, button, row, select, textInput, numberInput, toast, iconEl, formatBytes, slider } from './dom.js';
import { ENVIRONMENTS } from '../scene/environments/index.js';
import { capabilities } from '../export/Exporter.js';
import { downloadBlob } from '../app/Storage.js';
import { SECTIONS } from '../anim/TrailerGenerator.js';

export function openGenerateDialog(app) {
  const p = app.project;
  if (!p.actors.length) return toast('Import or add a 3D model first.', 'error');
  const hero = p.actors[0];
  const opts = { actorId: hero.id, envId: p.environment.id, style: 'action', duration: 45, title: hero.name, tagline: 'Born to dominate', subtitle: 'Coming soon', projectName: p.name };
  const rt = app.engine.actors.get(hero.id);
  const envCards = h(
    'div',
    { class: 'env-grid compact' },
    ENVIRONMENTS.map((env) => {
      const b = h('button', { class: `env-card ${env.id === opts.envId ? 'active' : ''}`, onclick: () => {
        opts.envId = env.id;
        envCards.querySelectorAll('.env-card').forEach((x) => x.classList.toggle('active', x === b));
      } }, h('div', { class: 'env-thumb', style: { background: env.thumb } }), h('div', { class: 'env-name' }, env.name));
      return b;
    })
  );
  const timeline = h(
    'div',
    { class: 'gen-timeline' },
    SECTIONS.map((s, i) => {
      const end = SECTIONS[i + 1]?.t ?? 45;
      return h('div', { class: 'gen-sec', style: { flex: end - s.t } }, h('b', {}, s.label), h('span', {}, `${s.t}–${end}s`));
    })
  );
  const info = rt
    ? h('div', { class: 'hint' }, `Hero model: ${hero.name} — ${rt.dims.length.toFixed(2)} m long, ${rt.kind === 'vehicle' ? `${rt.wheels.length} wheels → driving trailer` : 'static object → showcase trailer'}. Speeds, camera distances, dust and road width adapt to its size.`)
    : null;
  const m = modal({
    title: 'Generate Cinematic Trailer',
    wide: true,
    content: h(
      'div',
      { class: 'gen' },
      timeline,
      info,
      row('Hero model', select({ value: opts.actorId, options: p.actors.map((a) => [a.id, a.name]), onChange: (v) => (opts.actorId = v) })),
      h('div', { class: 'sub-title' }, 'Environment'),
      envCards,
      row('Style', select({ value: opts.style, options: [['action', 'Action — fast cuts, shake, sparks'], ['elegant', 'Elegant — slower, smooth blends']], onChange: (v) => (opts.style = v) })),
      row('Duration', numberInput({ value: opts.duration, step: 5, min: 10, max: 180, suffix: 's', onChange: (v) => (opts.duration = v) }), 'Sections scale proportionally (45 s default)'),
      row('Title', textInput({ value: opts.title, onInput: (v) => (opts.title = v) })),
      row('Tagline', textInput({ value: opts.tagline, onInput: (v) => (opts.tagline = v) })),
      row('End subtitle', textInput({ value: opts.subtitle, onInput: (v) => (opts.subtitle = v) })),
      h('div', { class: 'hint' }, 'This replaces the current camera track, effect clips and the hero motion path. Everything stays fully editable on the timeline afterwards (Ctrl+Z to undo).')
    ),
    actions: [
      button('Cancel', { onClick: () => m.close() }),
      button('Generate', {
        icon: 'wand',
        primary: true,
        onClick: async () => {
          m.close();
          try {
            const r = await app.generate(opts);
            toast(r.isVehicle ? `Trailer generated: cruise ${(r.cruise * 3.6).toFixed(0)} km/h, ${app.project.camera.clips.length} shots. Press Space to play.` : 'Showcase trailer generated. Press Space to play.', 'success', 6000);
            app.play();
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      }),
    ],
  });
}

export function openExportDialog(app) {
  const p = app.project;
  const caps = capabilities();
  const s = { width: p.export.width, height: p.export.height, fps: p.export.fps, format: p.export.format, start: 0, end: p.duration, quality: p.export.quality, mbSamples: p.effects.motionBlur.exportSamples };
  const resOptions = [
    ['1920x1080', '1920 × 1080 (Full HD)'],
    ['1280x720', '1280 × 720 (HD)'],
    ['2560x1440', '2560 × 1440 (QHD)'],
    ['3840x2160', '3840 × 2160 (4K)'],
  ];
  const est = h('div', { class: 'hint' });
  const updateEst = () => {
    const frames = Math.round((s.end - s.start) * s.fps);
    est.textContent = `${frames} frames · ${(s.end - s.start).toFixed(1)} s · ${s.width}×${s.height} @ ${s.fps} fps (16:9) · motion blur ${p.effects.motionBlur.enabled ? `${s.mbSamples} sub-frames` : 'off'}`;
  };
  updateEst();
  const support = h(
    'div',
    { class: `support ${caps.webcodecs ? 'ok' : 'warn'}` },
    iconEl(caps.webcodecs ? 'check' : 'alert'),
    h(
      'span',
      {},
      caps.webcodecs
        ? 'WebCodecs available: frame-accurate offline rendering, encoded to MP4 (H.264) or WebM (VP9). Rendering speed does not affect smoothness.'
        : caps.mediaRecorder
          ? 'WebCodecs is not available in this browser: falling back to real-time MediaRecorder capture (WebM). Use Chrome / Edge for frame-accurate MP4.'
          : 'This browser cannot record video (no WebCodecs, no MediaRecorder).'
    )
  );
  const startIn = numberInput({ value: s.start, step: 0.5, min: 0, max: p.duration, suffix: 's', onChange: (v) => ((s.start = Math.min(v, s.end - 0.5)), updateEst()) });
  const endIn = numberInput({ value: s.end, step: 0.5, min: 0.5, max: p.duration, suffix: 's', onChange: (v) => ((s.end = Math.max(v, s.start + 0.5)), updateEst()) });
  const presets = h(
    'div',
    { class: 'chips' },
    [5, 15, 30, 45, 60]
      .filter((d) => d <= p.duration + 1e-6)
      .concat(['full'])
      .map((d) =>
        h('button', {
          class: 'chip',
          onclick: () => {
            s.start = 0;
            s.end = d === 'full' ? p.duration : d;
            startIn.setValue(s.start);
            endIn.setValue(s.end);
            updateEst();
          },
        }, d === 'full' ? `Full (${p.duration}s)` : `${d}s`)
      )
  );
  const progress = h('div', { class: 'export-progress' }, h('div', { class: 'bar' }), h('div', { class: 'label' }, ''));
  const result = h('div', { class: 'export-result' });
  let abort = null;
  const form = h(
    'div',
    { class: 'export-form' },
    support,
    row('Format', select({ value: s.format, options: [['mp4', 'MP4 (H.264)'], ['webm', 'WebM (VP9)']], onChange: (v) => (s.format = v) })),
    row('Resolution', select({ value: `${s.width}x${s.height}`, options: resOptions, onChange: (v) => (([s.width, s.height] = v.split('x').map(Number)), updateEst()) })),
    row('Frame rate', select({ value: s.fps, options: [[24, '24 fps'], [25, '25 fps'], [30, '30 fps'], [60, '60 fps']], onChange: (v) => ((s.fps = parseInt(v)), updateEst()) })),
    row('Quality', select({ value: s.quality, options: [['medium', 'Medium (smaller file)'], ['high', 'High'], ['veryhigh', 'Very high']], onChange: (v) => (s.quality = v) })),
    row('Motion blur', slider({ value: s.mbSamples, min: 1, max: 16, step: 1, format: (v) => `${v} samples`, onInput: (v) => ((s.mbSamples = v), updateEst()) })),
    row('Range', h('div', { class: 'inline' }, startIn, h('span', { class: 'muted' }, '→'), endIn)),
    presets,
    est
  );
  const startBtn = button('Render & Export', { icon: 'export', primary: true, onClick: () => run() });
  const cancelBtn = button('Close', { onClick: () => (abort ? abort.abort() : m.close()) });
  const m = modal({ title: 'Export Video', wide: true, content: h('div', {}, form, progress, result), actions: [cancelBtn, startBtn], onClose: () => abort?.abort() });

  async function run() {
    Object.assign(p.export, { width: s.width, height: s.height, fps: s.fps, format: s.format, quality: s.quality });
    startBtn.disabled = true;
    form.classList.add('disabled');
    cancelBtn.querySelector('.btn-label').textContent = 'Cancel';
    result.replaceChildren();
    progress.classList.add('active');
    abort = new AbortController();
    const bar = progress.querySelector('.bar'), label = progress.querySelector('.label');
    try {
      const res = await app.exportVideo(s, (pr) => {
        bar.style.width = `${(pr.progress * 100).toFixed(1)}%`;
        label.textContent = `${pr.phase} · frame ${pr.frame}/${pr.frames} · ${pr.elapsed.toFixed(0)}s elapsed${pr.eta > 0 ? ` · ~${pr.eta.toFixed(0)}s left` : ''}`;
      }, abort.signal);
      bar.style.width = '100%';
      label.textContent = `Done in ${res.method} · ${res.codec} · ${formatBytes(res.blob.size)}`;
      downloadBlob(res.blob, res.filename);
      showResult(res);
      toast(`Exported ${res.filename}`, 'success');
    } catch (e) {
      if (e.name === 'AbortError') label.textContent = 'Export cancelled.';
      else {
        console.error(e);
        label.textContent = 'Export failed.';
        toast(`Export failed: ${e.message || e}`, 'error');
      }
    } finally {
      abort = null;
      startBtn.disabled = false;
      form.classList.remove('disabled');
      cancelBtn.querySelector('.btn-label').textContent = 'Close';
    }
  }

  function showResult(res) {
    const url = URL.createObjectURL(res.blob);
    const video = h('video', { src: url, controls: true, class: 'export-video', playsinline: true });
    const items = [video, h('div', { class: 'btn-row' }, button(`Download ${res.container.toUpperCase()} again`, { icon: 'download', onClick: () => downloadBlob(res.blob, res.filename) }))];
    if (res.note) items.push(h('div', { class: 'hint warn' }, res.note));
    if (res.container !== 'mp4') {
      const conv = button('Convert to MP4 (FFmpeg.wasm)', {
        icon: 'film',
        onClick: async () => {
          conv.disabled = true;
          const lbl = progress.querySelector('.label'), bar = progress.querySelector('.bar');
          try {
            const mp4 = await app.convertToMP4(res.blob, (pr) => {
              lbl.textContent = pr.phase;
              bar.style.width = `${(pr.progress * 100).toFixed(1)}%`;
            });
            downloadBlob(mp4, res.filename.replace(/\.\w+$/, '.mp4'));
            lbl.textContent = `MP4 ready · ${formatBytes(mp4.size)}`;
            toast('MP4 conversion finished', 'success');
          } catch (e) {
            console.error(e);
            toast(`FFmpeg.wasm conversion failed (needs internet access to unpkg.com and enough memory): ${e.message || e}`, 'error');
          } finally {
            conv.disabled = false;
          }
        },
      });
      items.push(h('div', { class: 'btn-row' }, conv), h('div', { class: 'hint' }, 'FFmpeg.wasm downloads its ~31 MB core on first use and transcodes on your CPU (can take several minutes for 1080p).'));
    }
    result.replaceChildren(...items);
  }
}

export function openHelpDialog() {
  const keys = [
    ['Space', 'Play / pause'],
    ['Enter / Home', 'Stop · go to start'],
    ['End', 'Go to end'],
    ['← / →', 'Previous / next frame (Shift: 1 second)'],
    ['C', 'Toggle Shot camera / Editor camera'],
    ['W / E / R', 'Move / rotate / scale gizmo (editor camera)'],
    ['F', 'Focus selected model'],
    ['K', 'Add keyframe at playhead'],
    ['S', 'Split selected clip at playhead'],
    ['Delete / Backspace', 'Delete selection'],
    ['Ctrl + D', 'Duplicate selection'],
    ['Ctrl + Z / Ctrl + Shift + Z / Ctrl + Y', 'Undo / redo'],
    ['Ctrl + S', 'Save project file'],
    ['Ctrl + O', 'Open project file'],
    ['Ctrl + I', 'Import 3D model'],
    ['G', 'Generate cinematic trailer'],
    ['Ctrl + E', 'Export video'],
    ['Shift + F  /  F11', 'Fullscreen preview'],
    ['+ / −', 'Zoom timeline'],
    ['Esc', 'Deselect · close dialog'],
  ];
  modal({
    title: 'Keyboard Shortcuts',
    content: h('div', { class: 'keys' }, keys.map(([k, d]) => h('div', { class: 'key-row' }, h('kbd', {}, k), h('span', {}, d)))),
  });
}
