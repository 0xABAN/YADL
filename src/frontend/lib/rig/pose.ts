import type { Landmark } from "../hand";
import type { JointDef, RigRoot, TemplateCatalog } from "./types";
import { clampJoint } from "./types";

/** Unit flex/lean: 0 neutral; signed where noted. */
const JOINTS: JointDef[] = [
  { id: "torso_lean", min: -1, max: 1, default: 0, unit: "unit" },
  { id: "neck", min: -1, max: 1, default: 0, unit: "unit" },
  { id: "l_shoulder", min: -1, max: 1, default: 0.15, unit: "unit" },
  { id: "r_shoulder", min: -1, max: 1, default: 0.15, unit: "unit" },
  { id: "l_elbow", min: 0, max: 1, default: 0.2, unit: "unit" },
  { id: "r_elbow", min: 0, max: 1, default: 0.2, unit: "unit" },
  { id: "l_wrist", min: -1, max: 1, default: 0, unit: "unit" },
  { id: "r_wrist", min: -1, max: 1, default: 0, unit: "unit" },
  { id: "l_hip", min: -1, max: 1, default: 0, unit: "unit" },
  { id: "r_hip", min: -1, max: 1, default: 0, unit: "unit" },
  { id: "l_knee", min: 0, max: 1, default: 0.05, unit: "unit" },
  { id: "r_knee", min: 0, max: 1, default: 0.05, unit: "unit" },
];

function j(map: Record<string, number>, id: string): number {
  const def = JOINTS.find((d) => d.id === id)!;
  return clampJoint(def, map[id] ?? def.default);
}

function rot(x: number, y: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

/** BlazePose-ish 33 layout in local units (pelvis origin, −y up). */
function fkPose(root: RigRoot, joints: Record<string, number>): Landmark[] {
  const lean = j(joints, "torso_lean") * 0.25;
  const neckA = j(joints, "neck") * 0.35;
  const pts: [number, number][] = Array.from({ length: 33 }, () => [0, 0]);

  // pelvis / hips
  pts[23] = [-0.12 + j(joints, "l_hip") * 0.05, 0]; // left hip
  pts[24] = [0.12 + j(joints, "r_hip") * 0.05, 0]; // right hip
  const midHip: [number, number] = [(pts[23][0] + pts[24][0]) / 2, 0];

  // shoulders
  const shY = -0.55;
  pts[11] = [-0.22 + lean, shY + j(joints, "l_shoulder") * 0.08];
  pts[12] = [0.22 + lean, shY + j(joints, "r_shoulder") * 0.08];
  const midSh: [number, number] = [(pts[11][0] + pts[12][0]) / 2, (pts[11][1] + pts[12][1]) / 2];

  // nose / face cluster from mid shoulder + neck
  const head: [number, number] = [midSh[0] + neckA * 0.1, midSh[1] - 0.22];
  pts[0] = head;
  pts[1] = [head[0] - 0.04, head[1] + 0.02];
  pts[2] = [head[0] - 0.06, head[1] + 0.01];
  pts[3] = [head[0] - 0.08, head[1]];
  pts[4] = [head[0] + 0.04, head[1] + 0.02];
  pts[5] = [head[0] + 0.06, head[1] + 0.01];
  pts[6] = [head[0] + 0.08, head[1]];
  pts[7] = [head[0] - 0.1, head[1] - 0.02];
  pts[8] = [head[0] + 0.1, head[1] - 0.02];
  pts[9] = [head[0] - 0.03, head[1] + 0.06];
  pts[10] = [head[0] + 0.03, head[1] + 0.06];

  // arms: shoulder → elbow → wrist → hand tips
  const arm = (sh: [number, number], side: 1 | -1, elbowJ: number, wristJ: number): [[number, number], [number, number], [number, number], [number, number], [number, number]] => {
    const down = Math.PI / 2 + side * 0.15 + elbowJ * 0.9;
    const [ex, ey] = rot(0, 0.32, down);
    const elbow: [number, number] = [sh[0] + ex, sh[1] + ey];
    const wAng = down + wristJ * 0.5 + elbowJ * 0.4;
    const [wx, wy] = rot(0, 0.28, wAng);
    const wrist: [number, number] = [elbow[0] + wx, elbow[1] + wy];
    const pinky: [number, number] = [wrist[0] + side * 0.04, wrist[1] + 0.04];
    const index: [number, number] = [wrist[0] - side * 0.02, wrist[1] + 0.05];
    const thumb: [number, number] = [wrist[0] + side * 0.05, wrist[1] + 0.01];
    return [elbow, wrist, pinky, index, thumb];
  };

  const lArm = arm(pts[11], -1, j(joints, "l_elbow"), j(joints, "l_wrist"));
  pts[13] = lArm[0];
  pts[15] = lArm[1];
  pts[17] = lArm[2];
  pts[19] = lArm[3];
  pts[21] = lArm[4];

  const rArm = arm(pts[12], 1, j(joints, "r_elbow"), j(joints, "r_wrist"));
  pts[14] = rArm[0];
  pts[16] = rArm[1];
  pts[18] = rArm[2];
  pts[20] = rArm[3];
  pts[22] = rArm[4];

  // legs
  const leg = (hip: [number, number], kneeJ: number, side: 1 | -1): [[number, number], [number, number], [number, number], [number, number]] => {
    const kAng = Math.PI / 2 + side * 0.05 + kneeJ * 0.7;
    const [kx, ky] = rot(0, 0.4, kAng);
    const knee: [number, number] = [hip[0] + kx, hip[1] + ky];
    const [ax, ay] = rot(0, 0.4, kAng + kneeJ * 0.2);
    const ankle: [number, number] = [knee[0] + ax, knee[1] + ay];
    const heel: [number, number] = [ankle[0], ankle[1] + 0.04];
    const foot: [number, number] = [ankle[0] + side * 0.02, ankle[1] + 0.06];
    return [knee, ankle, heel, foot];
  };

  const lLeg = leg(pts[23], j(joints, "l_knee"), -1);
  pts[25] = lLeg[0];
  pts[27] = lLeg[1];
  pts[29] = lLeg[2];
  pts[31] = lLeg[3];
  const rLeg = leg(pts[24], j(joints, "r_knee"), 1);
  pts[26] = rLeg[0];
  pts[28] = rLeg[1];
  pts[30] = rLeg[2];
  pts[32] = rLeg[3];

  void midHip;
  const s = root.scale * 1.4;
  return pts.map(([lx, ly]) => {
    const [rx, ry] = rot(lx * s, ly * s, root.roll);
    return {
      x: Math.min(1, Math.max(0, root.x + rx)),
      y: Math.min(1, Math.max(0, root.y + ry)),
      z: 0,
    };
  });
}

export const poseCatalog: TemplateCatalog = {
  template: "pose",
  landmarkCount: 33,
  joints: JOINTS,
  landmarkName: (i) => String(i),
  fk: (root, joints) => fkPose(root, joints),
};
