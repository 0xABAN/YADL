import type { Comment } from "./comment";
import type { Landmark } from "./hand";
import { DEFAULT_ROOT, type RigState } from "./rig/types";

export type Pt = { x: number; y: number };

/** Landmark cloud kind — matches project.template (legacy rows may still be "hand"). */
export type KeypointKind = "hand" | "pose" | "face";

export type HandObj = {
  id: string;
  kind: KeypointKind;
  label: string | null;
  edited: boolean;
  geom: {
    t: KeypointKind;
    landmarks: Landmark[];
    handedness: "Left" | "Right" | null;
    /** Agent FK state; null after human free-edit or assist. */
    rig?: RigState | null;
  };
};

/** Normalize wire t/kind; remap legacy face/pose stored as hand via landmark count. */
export function keypointKindOf(t: unknown, landmarkCount: number): KeypointKind {
  if (t === "pose" || t === "face") return t;
  if (t === "hand") {
    if (landmarkCount >= 100) return "face";
    if (landmarkCount >= 30 && landmarkCount <= 40) return "pose";
    return "hand";
  }
  if (landmarkCount >= 100) return "face";
  if (landmarkCount >= 30 && landmarkCount <= 40) return "pose";
  return "hand";
}

export type BoxObj = {
  id: string;
  kind: "box";
  label: string | null;
  edited: boolean;
  geom: { t: "box"; x: number; y: number; w: number; h: number };
};

export type PolyObj = {
  id: string;
  kind: "polygon";
  label: string | null;
  edited: boolean;
  geom: { t: "polygon"; pts: Pt[] };
};

export type AnnObj = HandObj | BoxObj | PolyObj;

export function isKeypoint(o: AnnObj): o is HandObj {
  return o.kind === "hand" || o.kind === "pose" || o.kind === "face";
}

export type Doc = {
  id: string;
  image: string;
  objects: AnnObj[];
  url?: string | null;
  committed?: boolean;
  history?: { id: string; objects: AnnObj[]; at?: string | null }[];
  comments?: Comment[];
};

export type ProjectType = "boxes" | "polygons" | "keypoints";
export type KeypointTemplate = "hand" | "pose" | "face";

export type Project = {
  id: string;
  name: string;
  type: ProjectType;
  template?: KeypointTemplate | null;
  classes: string[];
};

export type ToolId = "move" | "box" | "polygon" | "landmarks" | "assist" | "seed" | "synthetic";

export const SHOWN: Record<ProjectType, ToolId[]> = {
  keypoints: ["move", "seed", "assist", "synthetic"],
  boxes: ["move", "box", "synthetic"],
  polygons: ["move", "polygon", "synthetic"],
};

export const DEFAULT_TOOL: Record<ProjectType, ToolId> = {
  keypoints: "move",
  boxes: "move",
  polygons: "move",
};

export const CLASS_COLOR = ["#99edff", "#bfff00", "#ff9ffc", "#ffd43b", "#ffa8a8", "#c5f6fa"];

export function named(label: string | null | undefined) {
  return label && label !== "untitled" ? label : null;
}

export function classColor(label: string | null | undefined, classes: string[]) {
  const name = named(label);
  if (!name) return "#737373";
  const i = classes.indexOf(name);
  return CLASS_COLOR[(i < 0 ? 0 : i) % CLASS_COLOR.length];
}

/** `<label>#i` — i is the 1-based index among objects with the same label (in list order). */
export function objTitle(o: AnnObj, objects: AnnObj[]) {
  const lab = named(o.label) ?? "untitled";
  let n = 0;
  for (const x of objects) {
    if ((named(x.label) ?? "untitled") !== lab) continue;
    n++;
    if (x.id === o.id) return `${lab}#${n}`;
  }
  return `${lab}#${n || 1}`;
}

/** Normalize API objects (poly pts may be [x,y] tuples). */
export function readObjects(raw: unknown): AnnObj[] {
  if (!Array.isArray(raw)) return [];
  const out: AnnObj[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const row = o as Record<string, unknown>;
    const geom = row.geom as Record<string, unknown> | undefined;
    if (!geom || typeof geom !== "object") continue;
    const id = String(row.id ?? "");
    const label = (row.label as string | null) ?? null;
    const edited = Boolean(row.edited);
    if (
      (geom.t === "hand" || geom.t === "pose" || geom.t === "face") &&
      Array.isArray(geom.landmarks)
    ) {
      const landmarks = geom.landmarks as Landmark[];
      const kt = keypointKindOf(geom.t, landmarks.length);
      const rig = parseRig(geom.rig);
      out.push({
        id,
        kind: kt,
        label,
        edited,
        geom: {
          t: kt,
          landmarks,
          handedness: (geom.handedness as HandObj["geom"]["handedness"]) ?? null,
          rig,
        },
      });
    } else if (geom.t === "box") {
      out.push({
        id,
        kind: "box",
        label,
        edited,
        geom: {
          t: "box",
          x: Number(geom.x) || 0,
          y: Number(geom.y) || 0,
          w: Number(geom.w) || 0,
          h: Number(geom.h) || 0,
        },
      });
    } else if (geom.t === "polygon" && Array.isArray(geom.pts)) {
      out.push({
        id,
        kind: "polygon",
        label,
        edited,
        geom: {
          t: "polygon",
          pts: (geom.pts as unknown[]).map((p) => {
            if (Array.isArray(p)) return { x: Number(p[0]) || 0, y: Number(p[1]) || 0 };
            const q = p as Pt;
            return { x: Number(q.x) || 0, y: Number(q.y) || 0 };
          }),
        },
      });
    }
  }
  return out;
}

function parseRig(raw: unknown): RigState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rootIn = r.root as Record<string, unknown> | undefined;
  if (!rootIn || typeof rootIn !== "object") return null;
  const jointsIn = r.joints;
  const joints: Record<string, number> = {};
  if (jointsIn && typeof jointsIn === "object" && !Array.isArray(jointsIn)) {
    for (const [k, v] of Object.entries(jointsIn as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n)) joints[k] = n;
    }
  }
  return {
    root: {
      x: Number(rootIn.x) || DEFAULT_ROOT.x,
      y: Number(rootIn.y) || DEFAULT_ROOT.y,
      scale: Number(rootIn.scale) || DEFAULT_ROOT.scale,
      roll: Number(rootIn.roll) || DEFAULT_ROOT.roll,
    },
    joints,
  };
}

/** Wire format for PUT — poly pts as [x,y] for backend tuples; drop null rig. */
export function writeObjects(objects: AnnObj[]) {
  return objects.map((o) => {
    if (o.kind === "polygon") {
      return {
        ...o,
        geom: { t: "polygon" as const, pts: o.geom.pts.map((p) => [p.x, p.y] as [number, number]) },
      };
    }
    if (isKeypoint(o)) {
      const { rig, ...rest } = o.geom;
      return {
        ...o,
        kind: o.geom.t,
        geom: {
          ...rest,
          t: o.geom.t,
          ...(rig ? { rig } : {}),
        },
      };
    }
    return o;
  });
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}
