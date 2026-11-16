// CPU-simulated particle systems (dust, smoke, sparks) + GPU ambient motes.
// Simulation runs at a fixed step with seeded randomness so playback, scrubbing
// and offline export produce the same result.
import * as THREE from 'three';
import { rng, clamp } from '../anim/math.js';

const SIM_DT = 1 / 30;

function spriteTexture(kind) {
  const c = document.createElement('canvas');
  const N = 128;
  c.width = c.height = N;
  const g = c.getContext('2d');
  if (kind === 'smoke') {
    const r = rng(42);
    for (let i = 0; i < 28; i++) {
      const x = N / 2 + (r() - 0.5) * N * 0.4, y = N / 2 + (r() - 0.5) * N * 0.4;
      const rad = N * (0.18 + r() * 0.22);
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, 'rgba(255,255,255,0.22)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, N, N);
    }
    // fade edges
    const mask = g.createRadialGradient(N / 2, N / 2, N * 0.2, N / 2, N / 2, N / 2);
    mask.addColorStop(0, 'rgba(0,0,0,1)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = mask;
    g.fillRect(0, 0, N, N);
  } else {
    const grd = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    if (kind === 'spark') {
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.25, 'rgba(255,255,255,0.8)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
    } else {
      grd.addColorStop(0, 'rgba(255,255,255,0.9)');
      grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
    }
    g.fillStyle = grd;
    g.fillRect(0, 0, N, N);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.LinearSRGBColorSpace;
  return t;
}

const vert = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute float aRot;
attribute vec3 aColor;
varying float vAlpha;
varying float vRot;
varying vec3 vColor;
uniform float uScale;
uniform float uMaxSize;
#include <fog_pars_vertex>
void main(){
  vec4 mvPosition = modelViewMatrix * vec4(position,1.0);
  gl_Position = projectionMatrix * mvPosition;
  float s = aSize * uScale / max(0.05, -mvPosition.z);
  gl_PointSize = clamp(s, 0.0, uMaxSize);
  // fade particles that would be clamped / too close to camera
  // fade sprites that get close to the lens (they would cover the frame)
  vAlpha = aAlpha * smoothstep(aSize * 0.35, aSize * 1.6, -mvPosition.z) * (s > uMaxSize ? uMaxSize / s : 1.0);
  vRot = aRot;
  vColor = aColor;
  #include <fog_vertex>
}`;
const frag = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uLight;
varying float vAlpha;
varying float vRot;
varying vec3 vColor;
#include <fog_pars_fragment>
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  p = mat2(c,-s,s,c) * p + 0.5;
  vec4 tex = texture2D(uMap, p);
  float a = tex.a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * uLight * tex.rgb, a);
  #include <fog_fragment>
}`;

class ParticleSystem {
  constructor({ max, texture, blending = THREE.NormalBlending, gravity = 0, drag = 0.5, grow = 0, light = true }) {
    this.max = max;
    this.gravity = gravity;
    this.drag = drag;
    this.grow = grow;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.rotV = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aAlpha', this.aAlpha);
    geo.setAttribute('aRot', this.aRot);
    geo.setAttribute('aColor', this.aColor);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uMap: { value: texture }, uScale: { value: 500 }, uMaxSize: { value: 512 }, uLight: { value: new THREE.Color(1, 1, 1) } },
      ]),
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending,
      fog: true,
    });
    this.useLight = light;
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }
  reset() {
    this.count = 0;
    this.sync();
  }
  emit(x, y, z, vx, vy, vz, life, size, alpha, r, g, b, rot = 0, rotV = 0) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([r, g, b], i * 3);
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = size;
    this.alpha0[i] = alpha;
    this.rot[i] = rot;
    this.rotV[i] = rotV;
  }
  step(dt) {
    const { pos, vel, age, life } = this;
    const damp = Math.exp(-this.drag * dt);
    let i = 0;
    while (i < this.count) {
      age[i] += dt;
      if (age[i] >= life[i]) {
        // swap-remove
        const j = --this.count;
        if (i !== j) {
          for (let k = 0; k < 3; k++) {
            pos[i * 3 + k] = pos[j * 3 + k];
            vel[i * 3 + k] = vel[j * 3 + k];
            this.col[i * 3 + k] = this.col[j * 3 + k];
          }
          age[i] = age[j];
          life[i] = life[j];
          this.size0[i] = this.size0[j];
          this.alpha0[i] = this.alpha0[j];
          this.rot[i] = this.rot[j];
          this.rotV[i] = this.rotV[j];
        }
        continue;
      }
      vel[i * 3] *= damp;
      vel[i * 3 + 1] = vel[i * 3 + 1] * damp - this.gravity * dt;
      vel[i * 3 + 2] *= damp;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (this.gravity > 0 && pos[i * 3 + 1] < 0.02) {
        pos[i * 3 + 1] = 0.02;
        vel[i * 3 + 1] *= -0.35;
        vel[i * 3] *= 0.6;
        vel[i * 3 + 2] *= 0.6;
      }
      this.rot[i] += this.rotV[i] * dt;
      i++;
    }
  }
  sync() {
    const n = this.count;
    const P = this.aPos.array, S = this.aSize.array, A = this.aAlpha.array, R = this.aRot.array, C = this.aColor.array;
    for (let i = 0; i < n; i++) {
      const k = this.age[i] / this.life[i];
      P[i * 3] = this.pos[i * 3];
      P[i * 3 + 1] = this.pos[i * 3 + 1];
      P[i * 3 + 2] = this.pos[i * 3 + 2];
      S[i] = this.size0[i] * (1 + this.grow * this.age[i]);
      const fadeIn = clamp(k / 0.12, 0, 1), fadeOut = clamp((1 - k) / 0.5, 0, 1);
      A[i] = this.alpha0[i] * fadeIn * fadeOut;
      R[i] = this.rot[i];
      C[i * 3] = this.col[i * 3];
      C[i * 3 + 1] = this.col[i * 3 + 1];
      C[i * 3 + 2] = this.col[i * 3 + 2];
    }
    this.points.geometry.setDrawRange(0, n);
    for (const a of [this.aPos, this.aSize, this.aAlpha, this.aRot, this.aColor]) a.needsUpdate = true;
  }
}

/** Ambient floating motes, fully computed in the vertex shader from time → stateless. */
class AmbientMotes {
  constructor(count = 1800) {
    const geo = new THREE.BufferGeometry();
    const r = rng(9);
    const p = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      p[i * 3] = r();
      p[i * 3 + 1] = r();
      p[i * 3 + 2] = r();
      seed[i] = r();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uCenter: { value: new THREE.Vector3() },
          uBox: { value: 40 },
          uColor: { value: new THREE.Color(1, 0.9, 0.75) },
          uOpacity: { value: 0.5 },
          uScale: { value: 500 },
          uWind: { value: new THREE.Vector3(1.2, -0.15, 0.4) },
          uSize: { value: 0.05 },
          uMap: { value: spriteTexture('dust') },
        },
      ]),
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime; uniform vec3 uCenter; uniform float uBox; uniform float uScale; uniform vec3 uWind; uniform float uSize;
        varying float vA;
        #include <fog_pars_vertex>
        void main(){
          vec3 p = position * uBox + uWind * uTime * (0.6 + aSeed) + vec3(sin(uTime*0.7+aSeed*40.0), cos(uTime*0.5+aSeed*17.0), sin(uTime*0.3+aSeed*9.0)) * 0.6;
          p = mod(p - uCenter + uBox * 0.5, uBox) + uCenter - uBox * 0.5;
          vec4 mvPosition = modelViewMatrix * vec4(p,1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(uSize * (0.5 + aSeed) * uScale / max(0.1,-mvPosition.z), 0.0, 24.0);
          vA = smoothstep(0.5, 3.0, -mvPosition.z) * (0.4 + 0.6 * fract(aSeed * 13.7));
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity; uniform sampler2D uMap;
        varying float vA;
        #include <fog_pars_fragment>
        void main(){
          float a = texture2D(uMap, gl_PointCoord).a * vA * uOpacity;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor, a);
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 11;
  }
}

/**
 * Manages all particle effects and their emission from actors / fx clips.
 */
export class ParticleManager {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'particles';
    scene.add(this.group);
    this.dust = new ParticleSystem({ max: 4000, texture: spriteTexture('dust'), drag: 1.3, grow: 0.85, gravity: -0.05 });
    this.smoke = new ParticleSystem({ max: 900, texture: spriteTexture('smoke'), drag: 0.7, grow: 0.5, gravity: -0.3 });
    this.sparks = new ParticleSystem({ max: 1500, texture: spriteTexture('spark'), blending: THREE.AdditiveBlending, drag: 0.4, gravity: 9.8, light: false });
    this.motes = new AmbientMotes();
    this.group.add(this.dust.points, this.smoke.points, this.sparks.points, this.motes.points);
    this.simTime = -1;
    this.step = 0;
    this._tmp = [];
  }

  setViewport(heightPx, camera) {
    const scale = (heightPx * 0.5) / Math.tan((camera.fov * Math.PI) / 360);
    for (const s of [this.dust, this.smoke, this.sparks]) s.material.uniforms.uScale.value = scale;
    this.motes.material.uniforms.uScale.value = scale;
  }

  setLight(color) {
    this.dust.material.uniforms.uLight.value.copy(color);
    this.smoke.material.uniforms.uLight.value.copy(color);
  }

  reset() {
    this.dust.reset();
    this.smoke.reset();
    this.sparks.reset();
    this.simTime = -1;
  }

  /**
   * Advance the simulation to time t.
   * ctx: { actors: ActorRuntime[], fx(time) -> fx levels, effects, envEmitters, heroId }
   */
  simulateTo(t, ctx) {
    if (this.simTime < 0 || t < this.simTime - 1e-4 || t - this.simTime > 6) {
      this.dust.reset();
      this.smoke.reset();
      this.sparks.reset();
      this.simTime = Math.max(0, t - 5);
      this.step = Math.round(this.simTime / SIM_DT);
    }
    let n = 0;
    while (this.simTime + SIM_DT <= t + 1e-6 && n < 400) {
      this._emit(this.simTime, ctx);
      this.dust.step(SIM_DT);
      this.smoke.step(SIM_DT);
      this.sparks.step(SIM_DT);
      this.simTime += SIM_DT;
      this.step++;
      n++;
    }
    this.dust.sync();
    this.smoke.sync();
    this.sparks.sync();
  }

  _emit(time, ctx) {
    const R = rng(this.step * 7919 + 17);
    const fx = ctx.fx(time);
    const eff = ctx.effects.particles;
    const dustC = new THREE.Color(eff.dust.color);
    const smokeC = new THREE.Color(eff.smoke.color);
    const sparkC = new THREE.Color(eff.sparks.color);
    for (const actor of ctx.actors) {
      if (!actor.root.visible || actor.kind !== 'vehicle') continue;
      const st = actor.evaluate(time, {});
      const S = actor.size;
      const speed = Math.abs(st.speed);
      const fwd = [Math.sin(st.yaw), Math.cos(st.yaw)];
      const right = [Math.cos(st.yaw), -Math.sin(st.yaw)];
      const pts = actor.contactPoints(st, this._tmp);
      const isTarget = (clipTarget) => !clipTarget || clipTarget === actor.id || (clipTarget === undefined && actor.id === ctx.heroId);
      // ---- wheel dust: proportional to speed, boosted by dust clips
      if (eff.dust.enabled && actor.data.setup.dust && speed > 0.8) {
        const boost = 1 + fx.dust * 3;
        const rate = clamp(speed * 1.2, 0, 50) * eff.dust.amount * ctx.envDust * boost * SIM_DT;
        let count = Math.floor(rate) + (R() < rate % 1 ? 1 : 0);
        while (count-- > 0) {
          const p = pts[R() < 0.5 ? 0 : 1];
          const back = -speed * (0.15 + R() * 0.25);
          const sz = S * (0.07 + R() * 0.09) * eff.dust.size;
          const shade = 0.85 + R() * 0.3;
          this.dust.emit(
            p.x + (R() - 0.5) * 0.4, p.y + R() * 0.2, p.z + (R() - 0.5) * 0.4,
            fwd[0] * back + right[0] * (R() - 0.5) * 3, 0.6 + R() * 1.8 * boost, fwd[1] * back + right[1] * (R() - 0.5) * 3,
            1.2 + R() * 1.6 * Math.min(2, boost), sz, 0.2 + 0.08 * Math.min(1, fx.dust), dustC.r * shade, dustC.g * shade, dustC.b * shade, R() * 6.28, (R() - 0.5)
          );
        }
      }
      // ---- smoke clips: tyre smoke / burnout around the target vehicle
      if (eff.smoke.enabled && fx.smoke > 0 && isTarget(fx.smokeTarget)) {
        const rate = 26 * fx.smoke * eff.smoke.amount * SIM_DT * (0.6 + Math.min(1, speed / 15));
        let count = Math.floor(rate) + (R() < rate % 1 ? 1 : 0);
        while (count-- > 0) {
          const p = pts[R() < 0.5 ? 0 : 1];
          const sz = S * (0.14 + R() * 0.16);
          const shade = 0.75 + R() * 0.35;
          this.smoke.emit(
            p.x + (R() - 0.5) * 0.6, p.y + 0.1, p.z + (R() - 0.5) * 0.6,
            -fwd[0] * speed * 0.15 + (R() - 0.5) * 1.5, 0.4 + R() * 0.9, -fwd[1] * speed * 0.15 + (R() - 0.5) * 1.5,
            2.5 + R() * 2.5, sz, eff.smoke.opacity * 0.42, smokeC.r * shade, smokeC.g * shade, smokeC.b * shade, R() * 6.28, (R() - 0.5) * 0.4
          );
        }
      }
      // ---- sparks: scraping underbody / impact bursts
      if (eff.sparks.enabled && fx.sparks > 0 && isTarget(fx.sparksTarget)) {
        const rate = 140 * fx.sparks * eff.sparks.amount * SIM_DT;
        let count = Math.floor(rate) + (R() < rate % 1 ? 1 : 0);
        const L = actor.dims.length, W = actor.dims.width;
        while (count-- > 0) {
          const lz = (R() - 0.7) * L * 0.6, lx = (R() - 0.5) * W * 0.8;
          const x = st.position.x + lx * right[0] + lz * fwd[0];
          const z = st.position.z + lx * right[1] + lz * fwd[1];
          const v = 3 + R() * 7;
          const spread = (R() - 0.5) * 2;
          const heat = 6 + R() * 10; // HDR so bloom catches them
          this.sparks.emit(
            x, st.position.y + 0.08, z,
            -fwd[0] * (speed * 0.55 + v) + right[0] * spread * v * 0.6, 1 + R() * 4, -fwd[1] * (speed * 0.55 + v) + right[1] * spread * v * 0.6,
            0.25 + R() * 0.55, 0.035 * S * (0.6 + R()), 1, sparkC.r * heat, sparkC.g * heat * 0.8, sparkC.b * heat * 0.5
          );
        }
      }
    }
    // ---- environment emitters (fires, chimneys)
    if (eff.smoke.enabled && ctx.envEmitters) {
      for (const em of ctx.envEmitters) {
        const rate = em.rate * SIM_DT * eff.smoke.amount;
        let count = Math.floor(rate) + (R() < rate % 1 ? 1 : 0);
        const c = new THREE.Color(em.color || eff.smoke.color);
        while (count-- > 0) {
          const shade = 0.7 + R() * 0.4;
          this.smoke.emit(
            em.position[0] + (R() - 0.5) * em.radius, em.position[1], em.position[2] + (R() - 0.5) * em.radius,
            (R() - 0.5) * 0.6 + (em.wind || 0.8), 1.5 + R() * 1.8, (R() - 0.5) * 0.6,
            6 + R() * 5, em.size * (0.6 + R() * 0.6), em.opacity ?? 0.35, c.r * shade, c.g * shade, c.b * shade, R() * 6.28, (R() - 0.5) * 0.2
          );
        }
      }
    }
  }

  updateAmbient(time, camera, settings) {
    const u = this.motes.material.uniforms;
    u.uTime.value = time;
    u.uCenter.value.copy(camera.position);
    const enabled = settings.enabled && settings.amount > 0;
    this.motes.points.visible = enabled;
    u.uOpacity.value = 0.45 * settings.amount * (settings.opacity ?? 1);
    if (settings.color) u.uColor.value.set(settings.color);
    if (settings.size) u.uSize.value = settings.size;
    if (settings.wind) u.uWind.value.fromArray(settings.wind);
    if (settings.box) u.uBox.value = settings.box;
  }
}
