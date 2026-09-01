import type { Landmark } from "../hand";
import type { JointDef, RigRoot, TemplateCatalog } from "./types";
import { clampJoint } from "./types";

/** Expression-style controls (not full anatomical FK). Values 0..1. */
const JOINTS: JointDef[] = [
  { id: "jaw_open", min: 0, max: 1, default: 0, unit: "unit" },
  { id: "mouth_wide", min: 0, max: 1, default: 0.15, unit: "unit" },
  { id: "smile", min: 0, max: 1, default: 0, unit: "unit" },
  { id: "brow_raise", min: 0, max: 1, default: 0.1, unit: "unit" },
  { id: "eye_open", min: 0, max: 1, default: 0.85, unit: "unit" },
];

const FACE_N = 478;

function j(map: Record<string, number>, id: string): number {
  const def = JOINTS.find((d) => d.id === id)!;
  return clampJoint(def, map[id] ?? def.default);
}

function rot(x: number, y: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

/**
 * Procedural 478-pt face cloud (MediaPipe count).
 * Region tags via index bands — good enough for agent morphs, not medical mesh.
 */
function fkFace(root: RigRoot, joints: Record<string, number>): Landmark[] {
  const jaw = j(joints, "jaw_open");
  const wide = j(joints, "mouth_wide");
  const smile = j(joints, "smile");
  const brow = j(joints, "brow_raise");
  const eye = j(joints, "eye_open");

  const out: Landmark[] = [];
  for (let i = 0; i < FACE_N; i++) {
    // spiral/oval packing
    const t = i / FACE_N;
    const ring = Math.floor(Math.sqrt(i) * 1.7);
    const a = t * Math.PI * 2 * 11;
    let lx = Math.cos(a) * (0.15 + ring * 0.012);
    let ly = Math.sin(a) * (0.2 + ring * 0.014) - 0.02;

    // mouth band
    if (ly > 0.05 && ly < 0.14 && Math.abs(lx) < 0.12) {
      ly += jaw * 0.08;
      lx *= 1 + wide * 0.5;
      ly -= smile * 0.02 * (1 - Math.abs(lx) / 0.12);
      lx += smile * 0.03 * Math.sign(lx || 1);
    }
    // brow
    if (ly < -0.08 && ly > -0.16 && Math.abs(lx) < 0.14) {
      ly -= brow * 0.04;
    }
    // eyes
    if (ly < -0.02 && ly > -0.08 && Math.abs(lx) > 0.04 && Math.abs(lx) < 0.12) {
      ly *= 0.5 + eye * 0.5;
    }

    const s = root.scale * 1.1;
    const [rx, ry] = rot(lx * s, ly * s, root.roll);
    out.push({
      x: Math.min(1, Math.max(0, root.x + rx)),
      y: Math.min(1, Math.max(0, root.y + ry)),
      z: 0,
    });
  }
  return out;
}

export const faceCatalog: TemplateCatalog = {
  template: "face",
  landmarkCount: FACE_N,
  joints: JOINTS,
  landmarkName: (i) => String(i),
  fk: (root, joints) => fkFace(root, joints),
};
