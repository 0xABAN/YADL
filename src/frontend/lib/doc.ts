import type { Comment } from "./comment";
import type { Landmark } from "./hand";

export type Pt = { x: number; y: number };

export type HandObj = {
  id: string;
  kind: "hand";
  label: string | null;
  edited: boolean;
  geom: { t: "hand"; landmarks: Landmark[]; handedness: "Left" | "Right" | null };
};

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

export type Doc = {
  id: string;
  image: string;
  objects: AnnObj[];
  url?: string | null;
  committed?: boolean;
  history?: { id: string; objects: AnnObj[]; at?: string | null }[];
  comments?: Comment[];
};

export type Project = {
  id: string;
  name: string;
  type: "boxes" | "polygons" | "hands";
  classes: string[];
};

export type ToolId = "move" | "box" | "polygon" | "landmarks" | "assist" | "synthetic";

export const SHOWN: Record<Project["type"], ToolId[]> = {
  hands: ["move", "assist", "synthetic"],
  boxes: ["move", "box", "synthetic"],
  polygons: ["move", "polygon", "synthetic"],
};

export const DEFAULT_TOOL: Record<Project["type"], ToolId> = {
  hands: "landmarks",
  boxes: "box",
  polygons: "polygon",
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
    if (geom.t === "hand" && Array.isArray(geom.landmarks)) {
      out.push({
        id,
        kind: "hand",
        label,
        edited,
        geom: {
          t: "hand",
          landmarks: geom.landmarks as Landmark[],
          handedness: (geom.handedness as HandObj["geom"]["handedness"]) ?? null,
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

/** Wire format for PUT — poly pts as [x,y] for backend tuples. */
export function writeObjects(objects: AnnObj[]) {
  return objects.map((o) => {
    if (o.kind !== "polygon") return o;
    return {
      ...o,
      geom: { t: "polygon" as const, pts: o.geom.pts.map((p) => [p.x, p.y] as [number, number]) },
    };
  });
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}
