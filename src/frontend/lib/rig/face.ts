import type { Landmark } from "../hand";
import type { JointDef, RigRoot, TemplateCatalog } from "./types";
import { clamp01 } from "../geom";
import { jointVal, rot } from "./types";

/** Expression controls 0..1 — not anatomical FK. */
const JOINTS: JointDef[] = [
  { id: "jaw_open", min: 0, max: 1, default: 0, unit: "unit" },
  { id: "mouth_wide", min: 0, max: 1, default: 0.15, unit: "unit" },
  { id: "smile", min: 0, max: 1, default: 0, unit: "unit" },
  { id: "brow_raise", min: 0, max: 1, default: 0.1, unit: "unit" },
  { id: "eye_open", min: 0, max: 1, default: 0.85, unit: "unit" },
];

const FACE_N = 478;

const j = (map: Record<string, number>, id: string) => jointVal(JOINTS, map, id);

/** Procedural 478-pt cloud (MediaPipe count); morph bands, not medical mesh. */
function fkFace(root: RigRoot, joints: Record<string, number>): Landmark[] {
  const jaw = j(joints, "jaw_open");
  const wide = j(joints, "mouth_wide");
  const smile = j(joints, "smile");
  const brow = j(joints, "brow_raise");
  const eye = j(joints, "eye_open");

  const s = root.scale * 1.1;
  const out: Landmark[] = [];
  for (let i = 0; i < FACE_N; i++) {
    const t = i / FACE_N;
    const ring = Math.floor(Math.sqrt(i) * 1.7);
    const a = t * Math.PI * 2 * 11;
    let lx = Math.cos(a) * (0.15 + ring * 0.012);
    let ly = Math.sin(a) * (0.2 + ring * 0.014) - 0.02;
    if (ly > 0.05 && ly < 0.14 && Math.abs(lx) < 0.12) {
      ly += jaw * 0.08;
      lx *= 1 + wide * 0.5;
      ly -= smile * 0.02 * (1 - Math.abs(lx) / 0.12);
      lx += smile * 0.03 * Math.sign(lx || 1);
    }
    if (ly < -0.08 && ly > -0.16 && Math.abs(lx) < 0.14) ly -= brow * 0.04;
    if (ly < -0.02 && ly > -0.08 && Math.abs(lx) > 0.04 && Math.abs(lx) < 0.12) {
      ly *= 0.5 + eye * 0.5;
    }
    const [rx, ry] = rot(lx * s, ly * s, root.roll);
    out.push({ x: clamp01(root.x + rx), y: clamp01(root.y + ry), z: 0 });
  }
  return out;
}

export const faceCatalog: TemplateCatalog = {
  template: "face",
  landmarkCount: FACE_N,
  joints: JOINTS,
  landmarkName: (i) => String(i),
  fk: fkFace,
};
