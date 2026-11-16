// Offline, frame-accurate video export.
//  1) WebCodecs (via Mediabunny): every frame is rendered at the target resolution,
//     with sub-frame motion blur, and encoded to MP4 (H.264/HEVC/AV1/VP9) or WebM (VP9/VP8/AV1).
//  2) Fallback: MediaRecorder on canvas.captureStream (real-time paced WebM / MP4).
//  3) Optional: FFmpeg.wasm transcode WebM -> MP4 (downloads ~31 MB core from unpkg).

export function capabilities() {
  return {
    webcodecs: typeof window.VideoEncoder === 'function',
    mediaRecorder: typeof window.MediaRecorder === 'function' && typeof HTMLCanvasElement.prototype.captureStream === 'function',
  };
}

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

async function pickCodec(mb, format, width, height) {
  const opts = { width, height };
  if (format === 'mp4') {
    const c = await mb.getFirstEncodableVideoCodec(['avc', 'hevc', 'av1', 'vp9'], opts);
    if (c) return { codec: c, container: 'mp4' };
  }
  const w = await mb.getFirstEncodableVideoCodec(['vp9', 'vp8', 'av1'], opts);
  if (w) return { codec: w, container: 'webm' };
  if (format !== 'mp4') {
    const c = await mb.getFirstEncodableVideoCodec(['avc', 'hevc'], opts);
    if (c) return { codec: c, container: 'mp4' };
  }
  return null;
}

/**
 * @param {object} p { engine, project, width, height, fps, start, end, format, quality, mbSamples, onProgress, signal }
 * @returns {Promise<{blob, filename, mime, codec, container, method, note}>}
 */
export async function exportVideo(p) {
  const { engine, project, width, height, fps, start, end, onProgress, signal } = p;
  const frames = Math.max(1, Math.round((end - start) * fps));
  const caps = capabilities();
  let mb = null;
  if (caps.webcodecs) {
    try {
      mb = await import('mediabunny');
    } catch (e) {
      console.warn('mediabunny unavailable', e);
    }
  }
  const pick = mb ? await pickCodec(mb, p.format, width, height) : null;
  if (document.fonts?.ready) await document.fonts.ready;

  engine.beginExport(width, height);
  engine.particles.reset();
  const samples = project.effects.motionBlur.enabled ? Math.max(1, p.mbSamples | 0) : 1;
  const t0 = performance.now();
  const report = (i, phase = 'Rendering') => {
    const el = (performance.now() - t0) / 1000;
    const eta = i > 0 ? (el / i) * (frames - i) : 0;
    onProgress?.({ frame: i, frames, progress: i / frames, elapsed: el, eta, phase });
  };
  try {
    if (pick) {
      const quality = { medium: mb.QUALITY_MEDIUM, high: mb.QUALITY_HIGH, veryhigh: mb.QUALITY_VERY_HIGH }[p.quality] || mb.QUALITY_HIGH;
      const target = new mb.BufferTarget();
      const format = pick.container === 'mp4' ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat();
      const output = new mb.Output({ format, target });
      const source = new mb.CanvasSource(engine.canvas, { codec: pick.codec, quality, keyFrameInterval: 1 });
      output.addVideoTrack(source, { frameRate: fps });
      await output.start();
      for (let i = 0; i < frames; i++) {
        if (signal?.aborted) {
          await output.cancel();
          throw new DOMException('Export cancelled', 'AbortError');
        }
        const t = start + i / fps;
        engine.renderFrame(project, t, { samples, forceShot: true, fps, hideHelpers: true });
        await source.add(i / fps, 1 / fps);
        if (i % 2 === 0) {
          report(i + 1);
          await nextFrame();
        }
      }
      report(frames, 'Finalizing');
      await output.finalize();
      const mime = format.mimeType;
      const ext = pick.container;
      const blob = new Blob([target.buffer], { type: mime });
      const note = p.format === 'mp4' && ext !== 'mp4' ? 'This browser cannot encode MP4 with WebCodecs, so WebM was produced. Use "Convert to MP4" (FFmpeg.wasm) or open the file in a converter.' : '';
      return { blob, filename: `${safeName(project.name)}_${width}x${height}_${fps}fps.${ext}`, mime, codec: pick.codec, container: ext, method: 'WebCodecs', note };
    }
    if (!caps.mediaRecorder) throw new Error('This browser supports neither WebCodecs nor MediaRecorder; video export is not possible here. Use a recent Chrome, Edge, Firefox or Safari.');
    return await recordRealtime({ engine, project, frames, fps, start, samples, width, height, signal, report, format: p.format });
  } finally {
    engine.endExport();
  }
}

async function recordRealtime({ engine, project, frames, fps, start, samples, width, height, signal, report, format }) {
  const types = format === 'mp4' ? ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'] : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const stream = engine.canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: Math.round(width * height * fps * 0.18) });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start(500);
  const tStart = performance.now();
  for (let i = 0; i < frames; i++) {
    if (signal?.aborted) {
      rec.stop();
      throw new DOMException('Export cancelled', 'AbortError');
    }
    engine.renderFrame(project, start + i / fps, { samples, forceShot: true, fps, hideHelpers: true });
    track.requestFrame?.();
    report(i + 1, 'Recording (real-time)');
    const due = tStart + ((i + 1) * 1000) / fps;
    const wait = due - performance.now();
    await new Promise((r) => setTimeout(r, Math.max(0, wait)));
  }
  rec.stop();
  await stopped;
  const type = rec.mimeType || mime || 'video/webm';
  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  return {
    blob: new Blob(chunks, { type }),
    filename: `${safeName(project.name)}_${width}x${height}_${fps}fps.${ext}`,
    mime: type,
    codec: type,
    container: ext,
    method: 'MediaRecorder',
    note: 'WebCodecs is not available, so the video was recorded in real time with MediaRecorder. If your computer renders slower than real time, motion may look uneven — lower the resolution or motion-blur samples.',
  };
}

let ffmpegInstance = null;
/** Transcode any video blob to H.264 MP4 using FFmpeg.wasm (single-threaded core from CDN). */
export async function convertToMP4(blob, onProgress) {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const { fetchFile, toBlobURL } = await import('@ffmpeg/util');
  if (!ffmpegInstance) {
    const ff = new FFmpeg();
    const base = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm';
    onProgress?.({ phase: 'Downloading FFmpeg core (~31 MB)…', progress: 0 });
    await ff.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    ffmpegInstance = ff;
  }
  const ff = ffmpegInstance;
  const handler = ({ progress }) => onProgress?.({ phase: 'Transcoding to MP4 (H.264)…', progress: Math.max(0, Math.min(1, progress)) });
  ff.on('progress', handler);
  try {
    await ff.writeFile('input.webm', await fetchFile(blob));
    await ff.exec(['-i', 'input.webm', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'output.mp4']);
    const data = await ff.readFile('output.mp4');
    await ff.deleteFile('input.webm');
    await ff.deleteFile('output.mp4');
    return new Blob([data.buffer], { type: 'video/mp4' });
  } finally {
    ff.off('progress', handler);
  }
}

function safeName(s) {
  return (s || 'trailer').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').slice(0, 60) || 'trailer';
}
