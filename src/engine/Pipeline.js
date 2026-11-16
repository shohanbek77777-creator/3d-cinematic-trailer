// Cinematic render pipeline:
//  scene (HDR, MSAA, depth) -> DoF + lens flare -> [motion blur accumulation]
//  -> bloom -> exposure / ACES / grading / vignette / grain / letterbox / titles.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { fullscreenVert, dofFlareFrag, scaleFrag, finalFrag } from './shaders.js';

const _v = new THREE.Vector3();

export class Pipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.width = 2;
    this.height = 2;
    this.msaa = 4;
    const hdr = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false };
    this.rtScene = this._makeSceneTarget(2, 2);
    this.rtDof = new THREE.WebGLRenderTarget(2, 2, hdr);
    this.rtHDR = new THREE.WebGLRenderTarget(2, 2, hdr);

    this.dofMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: dofFlareFrag,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uResolution: { value: new THREE.Vector2(2, 2) },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uFocus: { value: 10 },
        uAperture: { value: 1 },
        uMaxBlur: { value: 12 },
        uDofEnabled: { value: 1 },
        uFlareEnabled: { value: 1 },
        uSunUv: { value: new THREE.Vector2() },
        uSunVisible: { value: 0 },
        uSunColor: { value: new THREE.Color(1, 0.9, 0.7) },
        uFlareIntensity: { value: 1 },
        uStreak: { value: 1 },
        uGhosts: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.scaleMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: scaleFrag,
      uniforms: { tColor: { value: null }, uWeight: { value: 1 } },
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.finalMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: finalFrag,
      uniforms: {
        tColor: { value: null },
        tOverlay: { value: null },
        uHasOverlay: { value: 0 },
        uResolution: { value: new THREE.Vector2(2, 2) },
        uExposure: { value: 1 },
        uGradeEnabled: { value: 1 },
        uContrast: { value: 1 },
        uSaturation: { value: 1 },
        uTemperature: { value: 0 },
        uTint: { value: 0 },
        uShadows: { value: new THREE.Color(0.5, 0.5, 0.5) },
        uHighlights: { value: new THREE.Color(0.5, 0.5, 0.5) },
        uSplit: { value: 0 },
        uVignette: { value: 0.3 },
        uGrain: { value: 0.03 },
        uChromatic: { value: 0.5 },
        uLetterbox: { value: 0 },
        uFade: { value: 0 },
        uFlash: { value: 0 },
        uTime: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.dofMat);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 0.9);
  }

  _makeSceneTarget(w, h) {
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.FloatType;
    return new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      samples: this.msaa,
      depthTexture,
      depthBuffer: true,
    });
  }

  setMSAA(samples) {
    if (samples === this.msaa) return;
    this.msaa = samples;
    this.rtScene.dispose();
    this.rtScene = this._makeSceneTarget(this.width, this.height);
  }

  setSize(w, h) {
    w = Math.max(2, Math.floor(w));
    h = Math.max(2, Math.floor(h));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.rtScene.setSize(w, h);
    this.rtDof.setSize(w, h);
    this.rtHDR.setSize(w, h);
    // bloom at half resolution is plenty and much cheaper
    this.bloom.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.dofMat.uniforms.uResolution.value.set(w, h);
    this.finalMat.uniforms.uResolution.value.set(w, h);
  }

  /**
   * frame = {
   *   scene, camera, samples, prepare(i) -> { focus }, effects, lighting, sunDir, sunColor,
   *   overlay (texture|null), fade, flash, time, target (RenderTarget|null)
   * }
   */
  render(frame) {
    const r = this.renderer;
    const { scene, camera, effects: fx } = frame;
    const n = Math.max(1, frame.samples | 0);
    const du = this.dofMat.uniforms;
    du.uDofEnabled.value = fx.dof.enabled ? 1 : 0;
    du.uAperture.value = fx.dof.aperture;
    du.uMaxBlur.value = fx.dof.maxBlur;
    du.uFlareEnabled.value = fx.lensFlare.enabled ? 1 : 0;
    du.uFlareIntensity.value = fx.lensFlare.intensity;
    du.uStreak.value = fx.lensFlare.streak;
    du.uGhosts.value = fx.lensFlare.ghosts;
    du.uSunColor.value.copy(frame.sunColor || new THREE.Color(1, 0.9, 0.8));

    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    for (let i = 0; i < n; i++) {
      const info = frame.prepare ? frame.prepare(i, n) || {} : {};
      r.setRenderTarget(this.rtScene);
      r.setClearColor(0x000000, 1);
      r.clear(true, true, true);
      r.render(scene, camera);

      du.tColor.value = this.rtScene.texture;
      du.tDepth.value = this.rtScene.depthTexture;
      du.uNear.value = camera.near;
      du.uFar.value = camera.far;
      du.uFocus.value = Math.max(0.1, (info.focus ?? 10) + (fx.dof.focusOffset || 0));
      // sun screen position for the flare
      if (frame.sunDir && fx.lensFlare.enabled) {
        _v.copy(camera.position).addScaledVector(frame.sunDir, 1000).project(camera);
        const camDir = camera.getWorldDirection(new THREE.Vector3());
        du.uSunVisible.value = camDir.dot(frame.sunDir) > 0 && frame.sunDir.y > -0.02 ? 1 : 0;
        du.uSunUv.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
      } else du.uSunVisible.value = 0;

      this.quad.material = this.dofMat;
      if (n === 1) {
        r.setRenderTarget(this.rtHDR);
        this.quad.render(r);
      } else {
        r.setRenderTarget(this.rtDof);
        this.quad.render(r);
        r.setRenderTarget(this.rtHDR);
        if (i === 0) {
          r.setClearColor(0x000000, 0);
          r.clear(true, false, false);
        }
        this.scaleMat.uniforms.tColor.value = this.rtDof.texture;
        this.scaleMat.uniforms.uWeight.value = 1 / n;
        this.quad.material = this.scaleMat;
        this.quad.render(r);
      }
    }

    const g = fx.grading;
    const exposure = (frame.lighting.exposure ?? 1) * Math.pow(2, g.enabled ? g.exposure || 0 : 0);
    if (fx.bloom.enabled && fx.bloom.strength > 0) {
      // threshold is expressed in exposed (display-referred) units: 1.0 = white
      this.bloom.strength = fx.bloom.strength;
      this.bloom.radius = fx.bloom.radius;
      this.bloom.threshold = fx.bloom.threshold / Math.max(0.02, exposure);
      this.bloom.render(r, null, this.rtHDR, 0, false);
    }

    const fu = this.finalMat.uniforms;
    fu.tColor.value = this.rtHDR.texture;
    fu.uExposure.value = exposure;
    fu.uGradeEnabled.value = g.enabled ? 1 : 0;
    fu.uContrast.value = g.contrast;
    fu.uSaturation.value = g.saturation;
    fu.uTemperature.value = g.temperature;
    fu.uTint.value = g.tint;
    fu.uShadows.value.set(g.shadowsColor);
    fu.uHighlights.value.set(g.highlightsColor);
    fu.uSplit.value = g.splitAmount;
    fu.uVignette.value = g.enabled ? g.vignette : 0;
    fu.uGrain.value = g.enabled ? g.grain : 0;
    fu.uChromatic.value = g.enabled ? g.chromatic : 0;
    fu.uLetterbox.value = fx.letterbox.enabled ? fx.letterbox.aspect : 0;
    fu.uFade.value = frame.fade || 0;
    fu.uFlash.value = frame.flash || 0;
    fu.uTime.value = frame.time || 0;
    fu.tOverlay.value = frame.overlay || null;
    fu.uHasOverlay.value = frame.overlay ? 1 : 0;
    this.quad.material = this.finalMat;
    r.setRenderTarget(frame.target || null);
    this.quad.render(r);
    r.autoClear = prevAutoClear;
  }

  dispose() {
    this.rtScene.dispose();
    this.rtDof.dispose();
    this.rtHDR.dispose();
    this.bloom.dispose();
    this.quad.dispose();
  }
}
