import type { Landmark } from "../hand";
import type { KeypointTemplate } from "../doc";

export type RigRoot = {
  x: number;
  y: number;
  scale: number;
  /** radians, in-plane */
  roll: number;
};

export type RigState = {
  root: RigRoot;
  /** sparse on wire; tools resolve against catalog defaults */
  joints: Record<string, number>;
};

export type JointDef = {
  id: string;
  min: number;
  max: number;
  default: number;
  /** unit hint for agents */
  unit: "unit" | "rad";
};

export type TemplateCatalog = {
  template: KeypointTemplate;
  landmarkCount: number;
  joints: JointDef[];
  landmarkName: (i: number) => string;
  fk: (root: RigRoot, joints: Record<string, number>, handedness?: "Left" | "Right" | null) => Landmark[];
};

export const DEFAULT_ROOT: RigRoot = { x: 0.5, y: 0.5, scale: 0.22, roll: 0 };

export function clampJoint(def: JointDef, v: number): number {
  return Math.min(def.max, Math.max(def.min, v));
}

export function rot(x: number, y: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

/** Look up joint value with catalog default + clamp. */
export function jointVal(defs: JointDef[], map: Record<string, number>, id: string): number {
  const def = defs.find((d) => d.id === id);
  if (!def) return 0;
  return clampJoint(def, map[id] ?? def.default);
}

export function jointIndex(catalog: TemplateCatalog): Map<string, JointDef> {
  return new Map(catalog.joints.map((d) => [d.id, d]));
}

export function resolveJoints(catalog: TemplateCatalog, sparse: Record<string, number> | null | undefined) {
  const out: Record<string, number> = {};
  for (const d of catalog.joints) out[d.id] = d.default;
  if (sparse) {
    const idx = jointIndex(catalog);
    for (const [k, v] of Object.entries(sparse)) {
      const def = idx.get(k);
      if (def) out[k] = clampJoint(def, Number(v));
    }
  }
  return out;
}

export function restRig(catalog: TemplateCatalog, root: Partial<RigRoot> = {}): RigState {
  return {
    root: {
      x: root.x ?? DEFAULT_ROOT.x,
      y: root.y ?? DEFAULT_ROOT.y,
      scale: root.scale ?? DEFAULT_ROOT.scale,
      roll: root.roll ?? DEFAULT_ROOT.roll,
    },
    joints: resolveJoints(catalog, null),
  };
}
