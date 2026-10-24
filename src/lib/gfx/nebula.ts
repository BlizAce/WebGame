/**
 * WebGL fragment/vertex sources and tiny GL plumbing for the site-wide nebula
 * backdrop. Kept free of React so it can be unit-reasoned about and reused.
 *
 * Single-pass design: one fullscreen triangle, procedural fBm nebula + star
 * layers + warp streaks, tinted by race colours. No framebuffer ping-pong —
 * the "bloom" is analytic (additive core glow) which keeps cost bounded to one
 * fragment pass and avoids FBO/extension edge cases across drivers.
 */

/** Fullscreen triangle: no vertex buffer needed, positions from gl_VertexID. */
export const VERT_SRC = /* glsl */ `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/**
 * Nebula field. WebGL1/ES 1.00 for maximum driver reach.
 *
 * uRes        canvas size in device px
 * uTime        seconds since animation start (frozen when uMotion == 0)
 * uColorA      race glow   (rgb, 0..1)
 * uColorB      race primary(rgb, 0..1)
 * uAccent      race accent (rgb, 0..1)
 * uOctaves     fBm octave count (quality knob)
 * uStarDensity star layer multiplier (quality knob)
 * uMotion      0 disables all time-varying terms (prefers-reduced-motion)
 * uIntensity   global exposure multiplier
 */
export const FRAG_SRC = /* glsl */ `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uColorA;
uniform vec3  uColorB;
uniform vec3  uAccent;
uniform float uOctaves;
uniform float uStarDensity;
uniform float uMotion;
uniform float uIntensity;

const float TAU = 6.28318530718;

// --- hashing ------------------------------------------------------------

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// --- value noise + rotating fBm (rotation kills axis-aligned shimmer) ----

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  // quintic smootherstep: C2 continuous, no visible cell edges
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(i + vec2(0.0, 0.0));
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p, float octaves) {
  const mat2 ROT = mat2(0.80, 0.60, -0.60, 0.80);
  float sum = 0.0;
  float amp = 0.5;
  float tot = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    if (fi >= octaves) break;
    sum += amp * vnoise(p);
    tot += amp;
    p = ROT * p * 2.04 + vec2(19.3, -7.7);
    amp *= 0.5;
  }
  return sum / max(tot, 1e-4);
}

/** Domain-warped fBm: gives the gas its folded, non-synthetic structure. */
float warpedFbm(vec2 p, float t, float octaves) {
  vec2 q = vec2(
    fbm(p + vec2(0.0, 0.0), octaves),
    fbm(p + vec2(5.2, 1.3), octaves)
  );
  vec2 r = vec2(
    fbm(p + 1.6 * q + vec2(1.7, 9.2) + 0.06 * t, octaves),
    fbm(p + 1.6 * q + vec2(8.3, 2.8) - 0.05 * t, octaves)
  );
  return fbm(p + 1.9 * r, octaves);
}

// --- star layers --------------------------------------------------------

// One parallax star layer. Cell-based so stars are stable in screen space and
// cost is constant regardless of density. sz controls core size in px.
// NOTE: never use backticks inside this GLSL string - it would close the literal.
float starLayer(vec2 uv, float scale, float density, float t, float sz) {
  vec2 p = uv * scale;
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float h = hash12(cell);
  if (h > density) return 0.0;

  // sub-cell jitter + very slow proper motion
  vec2 jit = vec2(hash12(cell + 17.1), hash12(cell + 43.7));
  jit = 0.15 + 0.7 * jit;
  jit += 0.012 * vec2(sin(t * 0.25 + h * TAU), cos(t * 0.2 + h * 3.1));

  float d = length(f - jit);
  float core = smoothstep(sz, 0.0, d);
  // soft diffraction halo so bright stars read as points of light, not blobs
  float halo = smoothstep(sz * 7.0, 0.0, d) * 0.28;
  float twinkle = 0.62 + 0.38 * sin(t * (1.4 + 3.2 * hash12(cell + 3.3)) + h * TAU);
  return (core + halo) * twinkle * smoothstep(0.0, 0.25, density - h + 0.25);
}

/** Radial warp streaks — the "travelling through space" cue. */
float warpStreaks(vec2 uv, vec2 origin, float t) {
  vec2 d = uv - origin;
  float r = length(d);
  if (r < 1e-4) return 0.0;
  vec2 dir = d / r;
  float ang = atan(dir.y, dir.x);
  // angular cells stretched into filaments
  float bands = 34.0;
  float a = ang * bands;
  float cell = floor(a);
  float fa = fract(a);
  float h = hash12(vec2(cell, floor(r * 6.0) - floor(t * 2.2)));
  float streak = smoothstep(0.62, 1.0, fa) * step(0.86, h);
  // fade near the vanishing point and at frame edges
  streak *= smoothstep(0.02, 0.22, r) * smoothstep(1.15, 0.45, r);
  return streak;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  // aspect-correct so nebula cells stay round on wide screens
  vec2 asp = vec2(uRes.x / max(uRes.y, 1.0), 1.0);
  vec2 p = (uv - 0.5) * asp;

  float t = uTime * uMotion;

  // --- deep space base: subtle vertical lift, never pure black -------------
  vec3 col = mix(vec3(0.012, 0.019, 0.035), vec3(0.028, 0.043, 0.072), uv.y);

  // --- volumetric gas: two counter-drifting warped layers -----------------
  float oct = uOctaves;
  vec2 driftA = vec2(0.017, 0.009) * t;
  vec2 driftB = vec2(-0.013, 0.011) * t;

  float g1 = warpedFbm(p * 1.45 + driftA, t * 0.55, oct);
  float g2 = warpedFbm(p * 2.85 - driftB, t * 0.38, max(2.0, oct - 1.0));

  // ridged term: brightens filament edges like illuminated gas walls
  float ridge = 1.0 - abs(g1 * 2.0 - 1.0);
  ridge = pow(clamp(ridge, 0.0, 1.0), 3.0);

  float density = clamp(g1 * 0.75 + g2 * 0.35, 0.0, 1.0);
  float glowMask = pow(density, 1.9);

  col += uColorB * (glowMask * 0.62);
  col += uColorA * (ridge * 0.40);
  col += uAccent * (pow(clamp(g2, 0.0, 1.0), 3.4) * 0.20);

  // --- central core bloom: analytic, gives the frame a focal point --------
  float core = exp(-dot(p * vec2(1.0, 1.25), p * vec2(1.0, 1.25)) * 2.1);
  col += mix(uColorA, uColorB, 0.35) * (core * 0.30);

  // --- parallax star layers (near layers move faster with drift) ----------
  float sd = uStarDensity;
  float stars = 0.0;
  stars += starLayer(p + vec2(0.014, 0.006) * t, 34.0, 0.30 * sd, t, 0.030);
  stars += starLayer(p - vec2(0.026, 0.011) * t, 58.0, 0.22 * sd, t, 0.024);
  stars += starLayer(p + vec2(0.045, 0.019) * t, 96.0, 0.16 * sd, t, 0.019);
  col += vec3(0.86, 0.92, 1.0) * stars;

  // a few race-tinted bright stars for colour variety
  float tinted = starLayer(p * 1.0 + vec2(-0.02, 0.015) * t, 44.0, 0.10 * sd, t * 0.7, 0.036);
  col += mix(uColorA, uAccent, 0.5) * tinted * 0.9;

  // --- warp filaments ----------------------------------------------------
  float w = warpStreaks(p, vec2(0.0), t);
  col += mix(vec3(0.75, 0.86, 1.0), uColorA, 0.45) * (w * 0.16);

  // --- grade: exposure, vignette, grain ----------------------------------
  col = vec3(1.0) - exp(-col * uIntensity);   // soft filmic shoulder, no clipping

  float vig = smoothstep(1.42, 0.30, length(p));
  col *= mix(0.62, 1.0, vig);

  float grain = hash12(frag + vec2(mod(t * 91.0, 1024.0), 0.0));
  col += (grain - 0.5) * 0.017;

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

export type UniformLocation = WebGLUniformLocation | null;
export type Uniforms = {
  uRes: UniformLocation;
  uTime: UniformLocation;
  uColorA: UniformLocation;
  uColorB: UniformLocation;
  uAccent: UniformLocation;
  uOctaves: UniformLocation;
  uStarDensity: UniformLocation;
  uMotion: UniformLocation;
  uIntensity: UniformLocation;
};

/**
 * Compile+link the backdrop program and resolve uniform locations.
 * Returns null on any failure (no WebGL, shader compile error) so callers can
 * fall back to the CSS gradient instead of crashing the page.
 */
export function createProgram(
  gl: WebGLRenderingContext,
): { program: WebGLProgram; uniforms: Uniforms } | null {
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn("[nebula] shader compile failed:", gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };

  const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, "aPos");
  gl.linkProgram(program);
  // Shaders are safe to detach/delete right after linking.
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("[nebula] program link failed:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  const u = (name: string) => gl.getUniformLocation(program, name);
  return {
    program,
    uniforms: {
      uRes: u("uRes"),
      uTime: u("uTime"),
      uColorA: u("uColorA"),
      uColorB: u("uColorB"),
      uAccent: u("uAccent"),
      uOctaves: u("uOctaves"),
      uStarDensity: u("uStarDensity"),
      uMotion: u("uMotion"),
      uIntensity: u("uIntensity"),
    },
  };
}

/** Parse "#rrggbb" (or "#rgb") to linear-ish 0..1 rgb. Falls back to slate blue. */
export function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n) || full.length !== 6) return [0.36, 0.55, 1];
  return [
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255,
  ];
}
