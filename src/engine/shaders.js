// Post-processing shaders (GLSL ES 3.0 via three's ShaderMaterial / glslVersion).

export const fullscreenVert = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/**
 * Depth of field (scatter-as-gather golden-angle bokeh) + screen-space lens flare.
 * Works in linear HDR before bloom.
 */
export const dofFlareFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uResolution;
uniform float uNear, uFar;
uniform float uFocus;      // focus distance (m)
uniform float uAperture;   // blur strength
uniform float uMaxBlur;    // px at 1080p
uniform float uDofEnabled;
uniform float uFlareEnabled;
uniform vec2 uSunUv;
uniform float uSunVisible; // sun in front of camera
uniform vec3 uSunColor;
uniform float uFlareIntensity, uStreak, uGhosts;

float linDepth(float d){
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}
float coc(float z){
  // circle of confusion in pixels
  float c = abs(z - uFocus) / max(z, 0.001) * uAperture * 18.0;
  return clamp(c, 0.0, uMaxBlur) * (uResolution.y / 1080.0);
}

// Clamp extreme HDR values (the physical sun disc is ~1e4) so bokeh and bloom
// stay well-behaved; the sun glow is re-added by the lens flare.
// Also scrubs NaN / Inf (half-float overflow from razor-sharp sun speculars), which a
// blur would otherwise smear over the whole frame.
vec3 fetch(vec2 uv){
  vec3 c = texture2D(tColor, uv).rgb;
  if (!all(lessThanEqual(c, vec3(24.0)))) {
    c = vec3(c.r <= 24.0 ? c.r : 24.0, c.g <= 24.0 ? c.g : 24.0, c.b <= 24.0 ? c.b : 24.0);
  }
  if (!all(greaterThanEqual(c, vec3(0.0)))) c = max(vec3(c.r >= 0.0 ? c.r : 0.0, c.g >= 0.0 ? c.g : 0.0, c.b >= 0.0 ? c.b : 0.0), vec3(0.0));
  return c;
}

vec3 bokeh(vec2 uv){
  float cd = linDepth(texture2D(tDepth, uv).r);
  float cs = coc(cd);
  vec3 col = fetch(uv);
  if (cs < 0.6) return col;
  vec2 px = 1.0 / uResolution;
  float tot = 1.0;
  float radius = 0.5;
  float ang = 0.0;
  float maxR = uMaxBlur * (uResolution.y / 1080.0);
  for (int i = 0; i < 72; i++) {
    if (radius >= maxR) break;
    ang += 2.39996323;
    vec2 tc = uv + vec2(cos(ang), sin(ang)) * px * radius;
    vec3 sc = fetch(tc);
    float sd = linDepth(texture2D(tDepth, tc).r);
    float ss = coc(sd);
    if (sd > cd) ss = clamp(ss, 0.0, cs * 2.0);
    float m = smoothstep(radius - 0.5, radius + 0.5, ss);
    col += mix(col / tot, sc, m);
    tot += 1.0;
    radius += 2.2 / max(radius, 0.5) + 0.12;
  }
  return col / tot;
}

vec3 flare(vec2 uv){
  if (uSunVisible <= 0.0) return vec3(0.0);
  // occlusion: how much of the sun area shows sky (depth ~ far)
  float vis = 0.0;
  vec2 px = 1.0 / uResolution;
  for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) {
    vec2 s = uSunUv + vec2(float(x), float(y)) * px * 6.0;
    if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) continue;
    vis += step(0.99997, texture2D(tDepth, s).r);
  }
  vis /= 25.0;
  // fade when sun is off-screen
  vec2 off = max(vec2(0.0), abs(uSunUv - 0.5) - 0.5);
  vis *= 1.0 - smoothstep(0.0, 0.25, length(off));
  if (vis <= 0.0) return vec3(0.0);
  float aspect = uResolution.x / uResolution.y;
  vec2 d = (uv - uSunUv) * vec2(aspect, 1.0);
  float dist = length(d);
  vec3 c = vec3(0.0);
  // glow + anamorphic streak
  c += uSunColor * exp(-dist * 9.0) * 0.6;
  c += uSunColor * vec3(0.55, 0.75, 1.3) * exp(-abs(d.y) * 260.0) * exp(-abs(d.x) * 2.2) * uStreak * 0.9;
  // ghosts along the axis through screen centre
  vec2 axis = vec2(0.5) - uSunUv;
  for (int i = 0; i < 6; i++) {
    float k = float(i);
    float pos = -0.35 + k * 0.42;
    vec2 gp = uSunUv + axis * (1.0 + pos);
    float r = 0.025 + 0.03 * fract(k * 0.618);
    float g = smoothstep(r, r * 0.65, length((uv - gp) * vec2(aspect, 1.0)));
    vec3 tint = mix(vec3(1.0, 0.55, 0.25), vec3(0.3, 0.6, 1.0), fract(k * 0.37));
    c += tint * g * 0.06 * uGhosts;
  }
  // halo ring
  vec2 hv = (uv - vec2(0.5)) * vec2(aspect, 1.0);
  vec2 sv = (uSunUv - vec2(0.5)) * vec2(aspect, 1.0);
  float hr = abs(length(hv + sv * 0.5) - 0.32);
  c += vec3(0.6, 0.8, 1.0) * smoothstep(0.02, 0.0, hr) * 0.03 * uGhosts;
  return c * vis * uFlareIntensity;
}

void main(){
  vec3 col = uDofEnabled > 0.5 ? bokeh(vUv) : fetch(vUv);
  if (uFlareEnabled > 0.5) col += flare(vUv);
  if (!all(lessThanEqual(col, vec3(64.0))) || !all(greaterThanEqual(col, vec3(0.0)))) col = vec3(0.0);
  // cap extreme highlights (headlight glare on wet asphalt) so bloom cannot wash out the frame
  col *= min(1.0, 7.0 / max(max(col.r, col.g), max(col.b, 1e-4)));
  gl_FragColor = vec4(col, 1.0);
}`;

export const scaleFrag = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tColor;
uniform float uWeight;
void main(){ gl_FragColor = vec4(texture2D(tColor, vUv).rgb * uWeight, uWeight); }`;

/** Final pass: exposure, ACES, sRGB, colour grading, vignette, grain, CA, letterbox, overlay, fades. */
export const finalFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tOverlay;
uniform float uHasOverlay;
uniform vec2 uResolution;
uniform float uExposure;
uniform float uGradeEnabled;
uniform float uContrast, uSaturation, uTemperature, uTint;
uniform vec3 uShadows, uHighlights;
uniform float uSplit;
uniform float uVignette, uGrain, uChromatic;
uniform float uLetterbox; // target aspect, 0 = off
uniform float uFade;      // 0..1 to black
uniform float uFlash;     // 0..1 to white
uniform float uTime;

vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 61.7) * 43758.5453); }

void main(){
  vec2 uv = vUv;
  vec3 hdr;
  if (uChromatic > 0.0) {
    vec2 dir = (uv - 0.5);
    float amt = uChromatic * 0.0025 * dot(dir, dir) * 4.0;
    hdr.r = texture2D(tColor, uv - dir * amt).r;
    hdr.g = texture2D(tColor, uv).g;
    hdr.b = texture2D(tColor, uv + dir * amt).b;
  } else hdr = texture2D(tColor, uv).rgb;

  if (!all(lessThanEqual(hdr, vec3(1e4))) || !all(greaterThanEqual(hdr, vec3(0.0)))) hdr = vec3(0.0);
  hdr *= uExposure;
  if (uGradeEnabled > 0.5) {
    // white balance in linear space
    hdr *= vec3(1.0 + uTemperature * 0.35 + uTint * 0.05, 1.0 - uTint * 0.2, 1.0 - uTemperature * 0.35 + uTint * 0.05);
  }
  vec3 col = toSRGB(aces(hdr));
  if (uGradeEnabled > 0.5) {
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, uSaturation);
    col = (col - 0.5) * uContrast + 0.5;
    // split toning
    float lum = clamp(dot(col, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    col = mix(col, col * (uShadows * 2.0), (1.0 - smoothstep(0.0, 0.55, lum)) * uSplit);
    col = mix(col, col * (uHighlights * 1.6), smoothstep(0.45, 1.0, lum) * uSplit);
    col = clamp(col, 0.0, 1.0);
  }
  // vignette
  vec2 vc = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  col *= mix(1.0, smoothstep(1.15, 0.25, length(vc)), uVignette);
  // grain
  if (uGrain > 0.0) col += (hash(uv * uResolution) - 0.5) * uGrain;
  // overlay (titles)
  if (uHasOverlay > 0.5) {
    vec4 o = texture2D(tOverlay, uv);
    col = mix(col, o.rgb, o.a);
  }
  col = mix(col, vec3(1.0), uFlash);
  col *= 1.0 - uFade;
  // letterbox
  if (uLetterbox > 0.0) {
    float aspect = uResolution.x / uResolution.y;
    float bar = max(0.0, (1.0 - aspect / uLetterbox) * 0.5);
    if (uv.y < bar || uv.y > 1.0 - bar) col = vec3(0.0);
  }
  gl_FragColor = vec4(col, 1.0);
}`;
