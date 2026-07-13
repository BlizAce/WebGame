import type { RaceId } from "@/lib/db/schema";

export type Vec3 = [number, number, number];
export type Edge = [number, number];

export interface WireMesh {
  verts: Vec3[];
  edges: Edge[];
  /** Optional face loops for translucent hull panels (vertex indices) */
  faces?: number[][];
}

/** Visual ship tiers: 0 mortal → 3+ apex ascended form. */
export const SHIP_ASCENSION_TIERS = 4;

export function shipAscensionTier(level?: number | null): number {
  return Math.max(0, Math.min(SHIP_ASCENSION_TIERS - 1, Math.floor(level ?? 0)));
}

export function v(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

function pushBox(
  verts: Vec3[],
  edges: Edge[],
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
) {
  const o = verts.length;
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const corners: Vec3[] = [
    v(cx - hx, cy - hy, cz - hz),
    v(cx + hx, cy - hy, cz - hz),
    v(cx + hx, cy + hy, cz - hz),
    v(cx - hx, cy + hy, cz - hz),
    v(cx - hx, cy - hy, cz + hz),
    v(cx + hx, cy - hy, cz + hz),
    v(cx + hx, cy + hy, cz + hz),
    v(cx - hx, cy + hy, cz + hz),
  ];
  verts.push(...corners);
  const e: Edge[] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  for (const [a, b] of e) edges.push([o + a, o + b]);
}

function pushOctahedron(
  verts: Vec3[],
  edges: Edge[],
  faces: number[][],
  cx: number,
  cy: number,
  cz: number,
  r: number,
) {
  const o = verts.length;
  verts.push(
    v(cx, cy + r, cz),
    v(cx, cy - r, cz),
    v(cx + r, cy, cz),
    v(cx - r, cy, cz),
    v(cx, cy, cz + r),
    v(cx, cy, cz - r),
  );
  const e: Edge[] = [
    [0, 2],
    [0, 3],
    [0, 4],
    [0, 5],
    [1, 2],
    [1, 3],
    [1, 4],
    [1, 5],
    [2, 4],
    [4, 3],
    [3, 5],
    [5, 2],
  ];
  for (const [a, b] of e) edges.push([o + a, o + b]);
  faces.push(
    [o, o + 2, o + 4],
    [o, o + 4, o + 3],
    [o, o + 3, o + 5],
    [o, o + 5, o + 2],
  );
}

function pushRing(
  verts: Vec3[],
  edges: Edge[],
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  segments: number,
  axis: "y" | "x" | "z" = "y",
) {
  const o = verts.length;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a) * radius;
    const s = Math.sin(a) * radius;
    if (axis === "y") verts.push(v(cx + c, cy, cz + s));
    else if (axis === "x") verts.push(v(cx, cy + c, cz + s));
    else verts.push(v(cx + c, cy + s, cz));
  }
  for (let i = 0; i < segments; i++) {
    edges.push([o + i, o + ((i + 1) % segments)]);
  }
}

function lathe(
  profile: Array<[number, number]>,
  segments: number,
): WireMesh {
  const verts: Vec3[] = [];
  const edges: Edge[] = [];
  const rings = profile.length;
  for (let i = 0; i < rings; i++) {
    const [r, y] = profile[i]!;
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      verts.push(v(Math.cos(a) * r, y, Math.sin(a) * r));
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let s = 0; s < segments; s++) {
      const a = i * segments + s;
      const b = i * segments + ((s + 1) % segments);
      edges.push([a, b]);
      if (i < rings - 1) edges.push([a, a + segments]);
    }
  }
  return { verts, edges };
}

/* ─── Asgard: Biliskner → Othala city-ship ─── */

function asgardMesh(tier: number): WireMesh {
  const verts: Vec3[] = [];
  const edges: Edge[] = [];
  const faces: number[][] = [];

  // Elongated science hull
  pushBox(verts, edges, 0, 0, 0, 2.4 + tier * 0.35, 0.28, 0.55 + tier * 0.06);
  pushBox(verts, edges, 0.15, 0.08, 0, 1.1 + tier * 0.15, 0.38, 0.42);
  pushBox(verts, edges, 1.35 + tier * 0.12, 0.05, 0, 0.45, 0.35, 0.4);
  pushBox(verts, edges, 1.65 + tier * 0.15, 0.02, 0, 0.22, 0.14, 0.14);
  pushBox(verts, edges, -1.2 - tier * 0.1, 0, 0.28, 0.35, 0.22, 0.22);
  pushBox(verts, edges, -1.2 - tier * 0.1, 0, -0.28, 0.35, 0.22, 0.22);
  pushBox(verts, edges, -1.45 - tier * 0.12, 0, 0, 0.28, 0.18, 0.18);
  pushBox(verts, edges, 0.2, 0.35, 0, 0.8, 0.35, 0.08);
  pushBox(verts, edges, 0.55, 0.55, 0, 0.12, 0.28, 0.06);
  pushBox(verts, edges, 0.1, -0.05, 0.55, 1.1, 0.12, 0.18);
  pushBox(verts, edges, 0.1, -0.05, -0.55, 1.1, 0.12, 0.18);

  if (tier >= 1) {
    // Crystal sensor fins + mid halo
    pushBox(verts, edges, 0.8, 0.55, 0.35, 0.08, 0.55, 0.08);
    pushBox(verts, edges, 0.8, 0.55, -0.35, 0.08, 0.55, 0.08);
    pushRing(verts, edges, 0, 0.05, 0, 0.95, 14, "y");
    pushOctahedron(verts, edges, faces, 0.4, 0.42, 0, 0.18);
  }
  if (tier >= 2) {
    // Dual dorsal spines + forward lattice
    pushBox(verts, edges, -0.2, 0.48, 0.22, 1.6, 0.1, 0.08);
    pushBox(verts, edges, -0.2, 0.48, -0.22, 1.6, 0.1, 0.08);
    pushRing(verts, edges, 0.2, 0, 0, 1.25, 16, "y");
    pushBox(verts, edges, 1.9, 0.15, 0.25, 0.35, 0.08, 0.08);
    pushBox(verts, edges, 1.9, 0.15, -0.25, 0.35, 0.08, 0.08);
    pushBox(verts, edges, -1.7, 0.25, 0, 0.4, 0.35, 0.5);
  }
  if (tier >= 3) {
    // Othala-class: city decks + nested rings + core
    pushBox(verts, edges, -0.3, -0.35, 0, 1.8, 0.2, 0.9);
    pushBox(verts, edges, 0.5, 0.7, 0, 0.9, 0.18, 0.55);
    pushRing(verts, edges, 0, 0.15, 0, 1.55, 18, "y");
    pushRing(verts, edges, -0.4, 0, 0, 1.1, 12, "z");
    pushOctahedron(verts, edges, faces, 0, 0.15, 0, 0.32);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      pushBox(
        verts,
        edges,
        Math.cos(a) * 1.35,
        0.1,
        Math.sin(a) * 1.35,
        0.22,
        0.22,
        0.22,
      );
    }
  }

  return faces.length ? { verts, edges, faces } : { verts, edges };
}

/* ─── Goa'uld: Ha'tak → System Lord mothership ─── */

function goauldMesh(tier: number): WireMesh {
  const scale = 1 + tier * 0.12;
  const verts: Vec3[] = [
    v(0, 0.95 * scale, 0),
    v(0.9 * scale, -0.55 * scale, 0.9 * scale),
    v(-0.9 * scale, -0.55 * scale, 0.9 * scale),
    v(-0.9 * scale, -0.55 * scale, -0.9 * scale),
    v(0.9 * scale, -0.55 * scale, -0.9 * scale),
    v(0.35 * scale, -0.15 * scale, 0.35 * scale),
    v(-0.35 * scale, -0.15 * scale, 0.35 * scale),
    v(-0.35 * scale, -0.15 * scale, -0.35 * scale),
    v(0.35 * scale, -0.15 * scale, -0.35 * scale),
    v(1.05 * scale, -0.7 * scale, 0),
    v(0, -0.7 * scale, 1.05 * scale),
    v(-1.05 * scale, -0.7 * scale, 0),
    v(0, -0.7 * scale, -1.05 * scale),
  ];
  const edges: Edge[] = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 1],
    [5, 6],
    [6, 7],
    [7, 8],
    [8, 5],
    [1, 5],
    [2, 6],
    [3, 7],
    [4, 8],
    [9, 10],
    [10, 11],
    [11, 12],
    [12, 9],
    [1, 9],
    [1, 10],
    [2, 10],
    [2, 11],
    [3, 11],
    [3, 12],
    [4, 12],
    [4, 9],
  ];
  const faces: number[][] = [
    [0, 1, 2],
    [0, 2, 3],
    [0, 3, 4],
    [0, 4, 1],
    [5, 6, 7, 8],
  ];

  if (tier >= 1) {
    pushRing(verts, edges, 0, -0.35 * scale, 0, 1.15 * scale, 16, "y");
    pushBox(verts, edges, 1.15 * scale, -0.4, 0, 0.35, 0.2, 0.2);
    pushBox(verts, edges, -1.15 * scale, -0.4, 0, 0.35, 0.2, 0.2);
    pushBox(verts, edges, 0, -0.4, 1.15 * scale, 0.2, 0.2, 0.35);
    pushBox(verts, edges, 0, -0.4, -1.15 * scale, 0.2, 0.2, 0.35);
  }
  if (tier >= 2) {
    // Inverted secondary pyramid (Anubis silhouette)
    const o = verts.length;
    verts.push(
      v(0, -1.15 * scale, 0),
      v(0.55 * scale, -0.75 * scale, 0.55 * scale),
      v(-0.55 * scale, -0.75 * scale, 0.55 * scale),
      v(-0.55 * scale, -0.75 * scale, -0.55 * scale),
      v(0.55 * scale, -0.75 * scale, -0.55 * scale),
    );
    edges.push(
      [o, o + 1],
      [o, o + 2],
      [o, o + 3],
      [o, o + 4],
      [o + 1, o + 2],
      [o + 2, o + 3],
      [o + 3, o + 4],
      [o + 4, o + 1],
    );
    faces.push([o, o + 1, o + 2], [o, o + 3, o + 4]);
    pushBox(verts, edges, 0, 0.2, 0, 0.15, 1.4 * scale, 0.15);
    pushRing(verts, edges, 0, 0.1, 0, 1.4 * scale, 18, "y");
  }
  if (tier >= 3) {
    // System Lord capital: outer pylons + golden corona
    pushRing(verts, edges, 0, -0.1, 0, 1.75 * scale, 20, "y");
    pushRing(verts, edges, 0, 0.35, 0, 1.35 * scale, 14, "x");
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      pushBox(
        verts,
        edges,
        Math.cos(a) * 1.55 * scale,
        -0.15,
        Math.sin(a) * 1.55 * scale,
        0.18,
        0.55,
        0.18,
      );
    }
    pushOctahedron(verts, edges, faces, 0, 0.55 * scale, 0, 0.22);
  }

  return { verts, edges, faces };
}

/* ─── Replicator: block swarm → nano-construct ─── */

function replicatorMesh(tier: number): WireMesh {
  const verts: Vec3[] = [];
  const edges: Edge[] = [];
  const faces: number[][] = [];

  const blocks: Array<[number, number, number, number]> = [
    [0, 0, 0, 0.7],
    [0.55, 0.2, 0.35, 0.4],
    [-0.5, -0.15, 0.4, 0.38],
    [0.35, -0.25, -0.45, 0.42],
    [-0.4, 0.3, -0.35, 0.36],
    [0.15, 0.45, 0.05, 0.28],
    [-0.1, -0.4, 0.1, 0.3],
    [0.7, -0.05, -0.15, 0.26],
    [-0.65, 0.1, 0.2, 0.24],
  ];
  if (tier >= 1) {
    blocks.push(
      [0.9, 0.35, 0.4, 0.22],
      [-0.85, -0.3, -0.35, 0.24],
      [0.2, 0.65, -0.4, 0.2],
      [-0.25, -0.65, 0.35, 0.2],
    );
  }
  if (tier >= 2) {
    blocks.push(
      [1.1, -0.2, 0.15, 0.18],
      [-1.05, 0.25, -0.1, 0.18],
      [0.45, 0.15, 0.85, 0.2],
      [-0.4, -0.1, -0.9, 0.2],
      [0.6, -0.55, 0.55, 0.16],
      [-0.55, 0.55, -0.5, 0.16],
    );
  }
  for (const [x, y, z, s] of blocks) {
    pushBox(verts, edges, x, y, z, s, s * 0.85, s);
  }

  const o = verts.length;
  verts.push(v(-0.7, 0, 0), v(0.7, 0, 0), v(0, 0.6, 0), v(0, -0.55, 0));
  edges.push([o, o + 1], [o + 2, o + 3]);

  if (tier >= 1) {
    pushOctahedron(verts, edges, faces, 0, 0.05, 0, 0.28);
    pushRing(verts, edges, 0, 0, 0, 0.85, 12, "y");
  }
  if (tier >= 2) {
    pushRing(verts, edges, 0, 0.2, 0, 1.15, 14, "z");
    pushRing(verts, edges, 0, -0.15, 0, 1.05, 14, "x");
    // Lattice spars
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * 0.95;
      const z = Math.sin(a) * 0.95;
      const p = verts.length;
      verts.push(v(0, 0, 0), v(x, 0.15, z));
      edges.push([p, p + 1]);
    }
  }
  if (tier >= 3) {
    // Apex nano-shell
    pushRing(verts, edges, 0, 0, 0, 1.45, 18, "y");
    pushRing(verts, edges, 0, 0.35, 0, 1.25, 16, "y");
    pushRing(verts, edges, 0, -0.35, 0, 1.25, 16, "y");
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pushBox(
        verts,
        edges,
        Math.cos(a) * 1.35,
        Math.sin(a * 2) * 0.2,
        Math.sin(a) * 1.35,
        0.2,
        0.2,
        0.2,
      );
    }
    pushOctahedron(verts, edges, faces, 0, 0, 0, 0.45);
  }

  return faces.length ? { verts, edges, faces } : { verts, edges };
}

/* ─── Tau'ri: BC-304 → Tollan crystalline cruiser ─── */

function tauriMesh(tier: number): WireMesh {
  const nose = 1.15 + tier * 0.08;
  const hull = lathe(
    [
      [0.05, nose],
      [0.18, nose - 0.2],
      [0.32 + tier * 0.04, 0.55],
      [0.38 + tier * 0.05, 0.1],
      [0.42 + tier * 0.06, -0.35],
      [0.28 + tier * 0.04, -0.75],
      [0.12, -1.05 - tier * 0.08],
    ],
    tier >= 2 ? 12 : 10,
  );
  const verts = [...hull.verts];
  const edges = [...hull.edges];
  const faces: number[][] = [];

  pushBox(verts, edges, 0, -0.05, 0.7 + tier * 0.08, 0.55, 0.08, 0.55 + tier * 0.1);
  pushBox(verts, edges, 0, -0.05, -(0.7 + tier * 0.08), 0.55, 0.08, 0.55 + tier * 0.1);
  pushBox(verts, edges, 0.05, -0.02, 1.05 + tier * 0.1, 0.22, 0.1, 0.22);
  pushBox(verts, edges, 0.05, -0.02, -(1.05 + tier * 0.1), 0.22, 0.1, 0.22);
  pushBox(verts, edges, 0, nose - 0.1, 0, 0.12, 0.35, 0.12);
  pushBox(verts, edges, 0, 0.35, 0, 0.28, 0.22, 0.22);
  pushBox(verts, edges, 0.18, -1.15 - tier * 0.05, 0.18, 0.16, 0.2, 0.16);
  pushBox(verts, edges, -0.18, -1.15 - tier * 0.05, 0.18, 0.16, 0.2, 0.16);
  pushBox(verts, edges, 0.18, -1.15 - tier * 0.05, -0.18, 0.16, 0.2, 0.16);
  pushBox(verts, edges, -0.18, -1.15 - tier * 0.05, -0.18, 0.16, 0.2, 0.16);

  if (tier >= 1) {
    // Rail arrays + shield emitters
    pushBox(verts, edges, 0.35, 0.15, 0.45, 0.7, 0.06, 0.08);
    pushBox(verts, edges, 0.35, 0.15, -0.45, 0.7, 0.06, 0.08);
    pushBox(verts, edges, -0.2, 0.55, 0, 0.15, 0.35, 0.15);
    pushOctahedron(verts, edges, faces, 0, 0.55, 0, 0.14);
    pushRing(verts, edges, 0, -0.2, 0, 0.65, 12, "y");
  }
  if (tier >= 2) {
    // Odyssey mid-ring + hangar
    pushRing(verts, edges, 0, -0.05, 0, 1.05, 16, "y");
    pushBox(verts, edges, 0, -0.25, 0, 0.7, 0.25, 0.85);
    pushBox(verts, edges, 0.55, 0.05, 0.9, 0.35, 0.12, 0.2);
    pushBox(verts, edges, 0.55, 0.05, -0.9, 0.35, 0.12, 0.2);
    pushBox(verts, edges, -0.6, -0.9, 0, 0.35, 0.25, 0.45);
  }
  if (tier >= 3) {
    // Tollan crystalline wings + energy corona
    pushBox(verts, edges, 0.1, 0.2, 1.35, 0.15, 0.08, 0.9);
    pushBox(verts, edges, 0.1, 0.2, -1.35, 0.15, 0.08, 0.9);
    pushRing(verts, edges, 0, 0.15, 0, 1.4, 18, "y");
    pushRing(verts, edges, 0, 0, 0, 1.15, 14, "z");
    pushOctahedron(verts, edges, faces, 0, 0.25, 0, 0.28);
    for (let i = 0; i < 5; i++) {
      const y = 0.7 - i * 0.35;
      pushBox(verts, edges, 0.55, y, 0, 0.12, 0.08, 0.55);
      pushBox(verts, edges, -0.55, y, 0, 0.12, 0.08, 0.55);
    }
  }

  return faces.length ? { verts, edges, faces } : { verts, edges };
}

const CACHE: Partial<Record<string, WireMesh>> = {};

export function raceWireMesh(
  race: RaceId,
  ascensionLevel: number = 0,
): WireMesh {
  const tier = shipAscensionTier(ascensionLevel);
  const key = `${race}:${tier}`;
  if (!CACHE[key]) {
    CACHE[key] =
      race === "asgard"
        ? asgardMesh(tier)
        : race === "goauld"
          ? goauldMesh(tier)
          : race === "replicator"
            ? replicatorMesh(tier)
            : tauriMesh(tier);
  }
  return CACHE[key]!;
}

/** Soft glow / scale boost for ascended hulls in the stage. */
export function shipAscensionFx(level?: number | null): {
  tier: number;
  scaleBoost: number;
  glowBoost: number;
  corona: boolean;
} {
  const tier = shipAscensionTier(level);
  return {
    tier,
    scaleBoost: 1 + tier * 0.08,
    glowBoost: 1 + tier * 0.22,
    corona: tier >= 1,
  };
}

export function rotateX(p: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
}

export function rotateY(p: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

export function rotateZ(p: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
}

export function transformPoint(
  p: Vec3,
  yaw: number,
  pitch: number,
  roll: number,
  scale: number,
  ox: number,
  oy: number,
  oz: number,
): Vec3 {
  let q: Vec3 = [p[0] * scale + ox, p[1] * scale + oy, p[2] * scale + oz];
  q = rotateY(q, yaw);
  q = rotateX(q, pitch);
  q = rotateZ(q, roll);
  return q;
}

/** Perspective project into canvas space. */
export function project(
  p: Vec3,
  cx: number,
  cy: number,
  fov: number,
): { x: number; y: number; z: number; visible: boolean } {
  const z = p[2] + 3.2;
  if (z <= 0.15) return { x: cx, y: cy, z, visible: false };
  const f = fov / z;
  return { x: cx + p[0] * f, y: cy - p[1] * f, z, visible: true };
}
