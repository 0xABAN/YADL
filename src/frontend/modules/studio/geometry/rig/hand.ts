import { NAMES, type Landmark } from "../hand";
import type { JointDef, RigRoot, TemplateCatalog } from "./types";
import { clamp01 } from "../geom";
import { jointVal, rot } from "./types";

const JOINTS: JointDef[] = [
  { id: "thumb_oppose", min: 0, max: 1, default: 0.25, unit: "unit" },
  { id: "thumb_mcp", min: 0, max: 1, default: 0.1, unit: "unit" },
  { id: "thumb_ip", min: 0, max: 1, default: 0.05, unit: "unit" },
  { id: "index_mcp", min: 0, max: 1, default: 0.05, unit: "unit" },
  { id: "index_pip", min: 0, max: 1, default: 0.05, unit: "unit" },
  { id: "index_spread", min: -1, max: 1, default: 0.15, unit: "unit" },
  { id: "middle_mcp", min: 0, max: 1, default: 0.05, unit: "unit" },
  { id: "middle_pip", min: 0, max: 1, default: 0.05, unit: "unit" },
  { id: "middle_spread", min: -1, max: 1, default: 0, unit: "unit" },
  { id: "ring_mcp", min: 0, max: 1, default: 0.05, unit: "unit" },
  { id: "ring_pip", min: 0, max: 1, default: 0.05, unit: "unit" },
  { id: "ring_spread", min: -1, max: 1, default: -0.1, unit: "unit" },
  { id: "pinky_mcp", min: 0, max: 1, default: 0.05, unit: "unit" },
  { id: "pinky_pip", min: 0, max: 1, default: 0.05, unit: "unit" },
  { id: "pinky_spread", min: -1, max: 1, default: -0.2, unit: "unit" },
];

const j = (map: Record<string, number>, id: string) => jointVal(JOINTS, map, id);

function finger(
  base: [number, number],
  baseAngle: number,
  lengths: number[],
  bends: number[],
): [number, number][] {
  const pts: [number, number][] = [base];
  let ang = baseAngle;
  let x = base[0];
  let y = base[1];
  for (let i = 0; i < lengths.length; i++) {
    ang += -bends[i] * (Math.PI / 2);
    const [dx, dy] = rot(0, -lengths[i], ang);
    x += dx;
    y += dy;
    pts.push([x, y]);
  }
  return pts;
}

function fkHand(root: RigRoot, joints: Record<string, number>, handedness?: "Left" | "Right" | null): Landmark[] {
  const mirror = handedness === "Left" ? -1 : 1;
  const local: [number, number][] = Array.from({ length: 21 }, () => [0, 0]);
  local[0] = [0, 0];

  const thumb = finger(
    [mirror * 0.12, -0.05],
    mirror * (0.9 + j(joints, "thumb_oppose") * 0.8),
    [0.28, 0.22, 0.18],
    [j(joints, "thumb_mcp") * 0.6, j(joints, "thumb_ip"), j(joints, "thumb_ip") * 0.7],
  );
  local[1] = thumb[0];
  local[2] = thumb[1];
  local[3] = thumb[2];
  local[4] = thumb[3];

  const fingers: { mcp: number; name: string; spread: string; baseX: number }[] = [
    { mcp: 5, name: "index", spread: "index_spread", baseX: mirror * 0.18 },
    { mcp: 9, name: "middle", spread: "middle_spread", baseX: mirror * 0.05 },
    { mcp: 13, name: "ring", spread: "ring_spread", baseX: mirror * -0.08 },
    { mcp: 17, name: "pinky", spread: "pinky_spread", baseX: mirror * -0.2 },
  ];

  for (const f of fingers) {
    const spread = j(joints, f.spread);
    const mcp = j(joints, `${f.name}_mcp`);
    const pip = j(joints, `${f.name}_pip`);
    const dip = pip * 0.7;
    const chain = finger(
      [f.baseX, -0.12],
      spread * 0.45,
      [0.38, 0.24, 0.18, 0.14],
      [mcp * 0.35, mcp, pip, dip],
    );
    local[f.mcp] = chain[1];
    local[f.mcp + 1] = chain[2];
    local[f.mcp + 2] = chain[3];
    local[f.mcp + 3] = chain[4];
  }

  const s = root.scale;
  // bases already mirrored for Left; scale only here
  return local.map(([lx, ly]) => {
    const [rx, ry] = rot(lx * s, ly * s, root.roll);
    return {
      x: Math.min(1, Math.max(0, root.x + rx)),
      y: Math.min(1, Math.max(0, root.y + ry)),
      z: 0,
    };
  });
}

export const handCatalog: TemplateCatalog = {
  template: "hand",
  landmarkCount: 21,
  joints: JOINTS,
  landmarkName: (i) => NAMES[i] ?? String(i),
  fk: fkHand,
};
