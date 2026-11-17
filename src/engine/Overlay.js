// Title cards rendered to a 2D canvas and composited inside the final shader pass,
// so they are part of exported video frames.
import * as THREE from 'three';
import { clamp, ease } from '../anim/math.js';

export class Overlay {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this._key = '';
  }

  setSize(w, h) {
    // half resolution is enough for crisp text after linear filtering at 1080p, full at <= 1080
    const scale = h > 1100 ? 0.5 : 1;
    const cw = Math.round(w * scale), ch = Math.round(h * scale);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.texture.dispose();
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.colorSpace = THREE.NoColorSpace;
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.generateMipmaps = false;
      this._key = '';
    }
  }

  /** titles: [{ clip, progress (0..1), alpha }]. Returns texture or null. */
  draw(titles, letterboxAspect = 0) {
    if (!titles.length) return null;
    const key = titles.map((t) => `${t.clip.id}:${t.clip.text}:${t.clip.subtitle}:${t.clip.style}:${t.alpha.toFixed(3)}:${t.progress.toFixed(3)}`).join('|') + ':' + this.canvas.width;
    if (key === this._key) return this.texture;
    this._key = key;
    const g = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const U = Math.min(H, (W * 9) / 16); // type scale that also fits portrait frames
    g.clearRect(0, 0, W, H);
    const bar = letterboxAspect > 0 ? Math.max(0, (1 - W / H / letterboxAspect) * 0.5) * H : 0;
    for (const t of titles) {
      const c = t.clip;
      const style = c.style || 'cinematic';
      const a = t.alpha;
      const p = t.progress;
      g.save();
      g.globalAlpha = a;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (style === 'lower') {
        const x = W * 0.08, y = H - bar - H * 0.12;
        g.textAlign = 'left';
        g.fillStyle = '#ffffff';
        g.font = `600 ${Math.round(U * 0.038)}px Oswald, "Bebas Neue", Impact, sans-serif`;
        g.shadowColor = 'rgba(0,0,0,0.6)';
        g.shadowBlur = U * 0.01;
        const tx = x + (1 - ease.out(clamp(p * 4, 0, 1))) * -W * 0.02;
        g.fillText((c.text || '').toUpperCase(), tx, y);
        g.fillStyle = '#e8b04a';
        g.fillRect(x, y + U * 0.032, U * 0.21 * ease.out(clamp(p * 3, 0, 1)), Math.max(2, U * 0.004));
        if (c.subtitle) {
          g.fillStyle = 'rgba(255,255,255,0.8)';
          g.font = `400 ${Math.round(U * 0.022)}px Inter, Arial, sans-serif`;
          g.fillText(c.subtitle.toUpperCase(), tx, y + U * 0.065);
        }
      } else if (style === 'hero') {
        const cy = H * 0.5;
        const spacing = 0.06 + 0.12 * ease.out(p);
        const size = Math.round(U * 0.12);
        g.font = `700 ${size}px Oswald, "Bebas Neue", Impact, sans-serif`;
        g.fillStyle = '#ffffff';
        g.shadowColor = 'rgba(255,190,120,0.55)';
        g.shadowBlur = U * 0.03;
        drawSpaced(g, (c.text || '').toUpperCase(), W / 2, cy, size * spacing);
        g.shadowBlur = 0;
        const lw = Math.min(W * 0.6, U * 0.5) * ease.out(clamp(p * 2, 0, 1));
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.fillRect(W / 2 - lw / 2, cy + size * 0.62, lw, Math.max(1, U * 0.002));
        if (c.subtitle) {
          g.font = `500 ${Math.round(U * 0.03)}px Inter, Arial, sans-serif`;
          g.fillStyle = 'rgba(255,255,255,0.9)';
          drawSpaced(g, c.subtitle.toUpperCase(), W / 2, cy + size * 0.95, U * 0.012);
        }
      } else {
        // cinematic centred card with slow push
        const size = Math.round(U * 0.07 * (1 + 0.06 * p));
        g.font = `600 ${size}px Oswald, "Bebas Neue", Impact, sans-serif`;
        g.fillStyle = '#f4efe8';
        drawSpaced(g, (c.text || '').toUpperCase(), W / 2, H * 0.5, size * (0.25 + 0.15 * p));
        if (c.subtitle) {
          g.font = `400 ${Math.round(U * 0.024)}px Inter, Arial, sans-serif`;
          g.fillStyle = 'rgba(244,239,232,0.75)';
          drawSpaced(g, c.subtitle.toUpperCase(), W / 2, H * 0.5 + size * 0.9, U * 0.01);
        }
      }
      g.restore();
    }
    this.texture.needsUpdate = true;
    return this.texture;
  }
}

function drawSpaced(g, text, cx, cy, spacing) {
  const chars = [...text];
  const widths = chars.map((ch) => g.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1);
  let x = cx - total / 2;
  const align = g.textAlign;
  g.textAlign = 'left';
  chars.forEach((ch, i) => {
    g.fillText(ch, x, cy);
    x += widths[i] + spacing;
  });
  g.textAlign = align;
}
