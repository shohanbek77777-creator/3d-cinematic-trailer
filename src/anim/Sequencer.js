// Effect clips on the timeline (dust / smoke / sparks bursts, fades, flashes, titles)
// evaluated as pure functions of time.
import { clamp, smoothstep } from './math.js';

export const FX_TYPES = {
  dust: { label: 'Dust Storm', color: '#c9a37a', hasIntensity: true },
  smoke: { label: 'Tyre Smoke', color: '#8f8f9a', hasIntensity: true },
  sparks: { label: 'Sparks', color: '#ffb04a', hasIntensity: true },
  fadeIn: { label: 'Fade In', color: '#555a66' },
  fadeOut: { label: 'Fade Out', color: '#555a66' },
  flash: { label: 'Flash', color: '#e6e6e6', hasIntensity: true },
  title: { label: 'Title', color: '#7d6cff', hasText: true },
};

export const TITLE_STYLES = ['cinematic', 'hero', 'lower'];

function envelope(clip, t, fadeIn = 0.4, fadeOut = 0.5) {
  const dur = Math.max(0.01, clip.end - clip.start);
  const fi = Math.min(fadeIn, dur / 3), fo = Math.min(fadeOut, dur / 3);
  return smoothstep(clip.start, clip.start + fi, t) * (1 - smoothstep(clip.end - fo, clip.end, t));
}

export function evaluateFX(clips, t) {
  const out = { dust: 0, smoke: 0, sparks: 0, fade: 0, flash: 0, titles: [], smokeTarget: null, sparksTarget: null };
  let fadeSet = false;
  for (const c of clips) {
    // fades hold their value outside the clip (fade-in: black before, fade-out: black after)
    if (c.type === 'fadeIn' && t < c.end) {
      const k = clamp((t - c.start) / Math.max(0.01, c.end - c.start), 0, 1);
      out.fade = Math.max(out.fade, 1 - k);
      fadeSet = true;
      continue;
    }
    if (c.type === 'fadeOut' && t >= c.start) {
      const k = clamp((t - c.start) / Math.max(0.01, c.end - c.start), 0, 1);
      out.fade = Math.max(out.fade, k);
      fadeSet = true;
      continue;
    }
    if (t < c.start || t > c.end) continue;
    const intensity = c.intensity ?? 1;
    switch (c.type) {
      case 'dust':
        out.dust = Math.max(out.dust, envelope(c, t) * intensity);
        break;
      case 'smoke':
        out.smoke = Math.max(out.smoke, envelope(c, t, 0.3, 0.8) * intensity);
        out.smokeTarget = c.target || null;
        break;
      case 'sparks':
        out.sparks = Math.max(out.sparks, envelope(c, t, 0.1, 0.2) * intensity);
        out.sparksTarget = c.target || null;
        break;
      case 'flash': {
        const k = (t - c.start) / Math.max(0.01, c.end - c.start);
        out.flash = Math.max(out.flash, Math.exp(-k * 6) * intensity * (k < 0.04 ? k / 0.04 : 1));
        break;
      }
      case 'title': {
        const dur = Math.max(0.01, c.end - c.start);
        out.titles.push({ clip: c, alpha: envelope(c, t, Math.min(0.8, dur * 0.25), Math.min(0.8, dur * 0.25)), progress: (t - c.start) / dur });
        break;
      }
    }
  }
  if (!fadeSet) out.fade = 0;
  return out;
}
