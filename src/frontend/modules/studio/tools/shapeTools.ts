import {
  newId,
  type AnnObj,
  type BoxObj,
  type PolyObj,
  type Pt,
  type Project,
} from "../geometry/doc";
import { clamp01 } from "../geometry/geom";
import type { StudioSnapshot } from "./studioTools";
import type { WebMcpTool } from "@/shared/webmcp";

const UNIT = {
  type: "string",
  enum: ["norm", "px"],
  description: "Required. Prefer norm (0–1 image). px = natural image pixels, not CSS/screen.",
} as const;

const POLYGON_POINTS = {
  description: "Vertex list [{x,y},…] or flat [x0,y0,x1,y1,…] (≥3 points)",
  oneOf: [
    {
      type: "array",
      minItems: 3,
      items: {
        type: "object",
        properties: { x: { type: "number" }, y: { type: "number" } },
        required: ["x", "y"],
        additionalProperties: false,
      },
    },
    { type: "array", minItems: 6, items: { type: "number" } },
  ],
} as const;

/** Schema-only export for webmcp-evals (boxes pack). */
export const BOX_TOOL_SCHEMAS = {
  tools: [
    {
      name: "get_boxes",
      description:
        "List all box annotations on the current image with full geometry. Coords are image-normalized 0–1 (coord_space=norm), never pan-zoom screen px. Includes natural image_width/height when known.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "add_box",
      description:
        "Create one box. unit required: norm (0–1 image) or px (natural image pixels, top-left of bitmap — not CSS/screen). xywh only. Optional label (ensureClass); rename/clear later via set_label. Geometry only — not a label tool.",
      inputSchema: {
        type: "object",
        properties: {
          unit: UNIT,
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
          label: {
            type: ["string", "null"],
            description: "Optional; null/omit = unlabeled. Prefer set_label to rename later.",
          },
        },
        required: ["unit", "x", "y", "w", "h"],
        additionalProperties: false,
      },
    },
    {
      name: "set_box",
      description:
        "Update one box geometry (partial x/y/w/h). object_id required when more than one box. unit required (norm|px). Does not set label — use set_label. Echoes norm geom + clamped_keys.",
      inputSchema: {
        type: "object",
        properties: {
          object_id: { type: "string" },
          unit: UNIT,
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
        },
        required: ["unit"],
        additionalProperties: false,
      },
    },
  ],
} as const;

/** Schema-only export for webmcp-evals (polygons pack). */
export const POLY_TOOL_SCHEMAS = {
  tools: [
    {
      name: "get_polygons",
      description:
        "List all polygon annotations on the current image with full geometry. Coords are image-normalized 0–1 (coord_space=norm), never pan-zoom screen px. Includes natural image_width/height when known.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "add_polygon",
      description:
        "Create one simple, non-zero-area polygon. unit required: norm or px (natural image pixels only). pts: [{x,y},…] or flat [x0,y0,…] (≥3 verts). Optional label. Full contour only — no vertex micro-ops.",
      inputSchema: {
        type: "object",
        properties: {
          unit: UNIT,
          pts: POLYGON_POINTS,
          label: {
            type: ["string", "null"],
            description: "Optional; null/omit = unlabeled. Prefer set_label to rename later.",
          },
        },
        required: ["unit", "pts"],
        additionalProperties: false,
      },
    },
    {
      name: "set_polygon",
      description:
        "Replace full polygon pts with a simple, non-zero-area contour (≥3). object_id required when more than one polygon. unit required. Does not set label — use set_label. Echoes norm pts + clamped_keys.",
      inputSchema: {
        type: "object",
        properties: {
          object_id: { type: "string" },
          unit: UNIT,
          pts: { ...POLYGON_POINTS, description: "Full replacement polygon in either supported point format." },
        },
        required: ["unit", "pts"],
        additionalProperties: false,
      },
    },
  ],
} as const;

export type ShapeToolsDeps = {
  get: () => StudioSnapshot;
  saveObjects: (objects: AnnObj[]) => void | Promise<void>;
  ensureClass: (name: string) => Promise<boolean>;
  setSelected?: (id: string | null) => void;
  /** Natural image pixel size from decode; null until ready. */
  getImageSize: () => { w: number; h: number } | null;
};

type Unit = "norm" | "px";
type NormBox = { x: number; y: number; w: number; h: number };

function parseUnit(v: unknown): Unit | null {
  return v === "norm" || v === "px" ? v : null;
}

function sizeOf(deps: ShapeToolsDeps): { w: number; h: number } | null {
  const s = deps.getImageSize();
  if (!s || !(s.w > 0) || !(s.h > 0)) return null;
  return s;
}

function toNorm(v: number, unit: Unit, span: number): number {
  if (!Number.isFinite(v)) return NaN;
  return unit === "px" ? v / span : v;
}

function clampBox(b: NormBox): { box: NormBox; clamped_keys: string[] } {
  const clamped_keys: string[] = [];
  let { x, y, w, h } = b;
  const cx = clamp01(x);
  const cy = clamp01(y);
  if (cx !== x) clamped_keys.push("x");
  if (cy !== y) clamped_keys.push("y");
  x = cx;
  y = cy;
  if (!(w > 0)) w = 0;
  if (!(h > 0)) h = 0;
  let cw = Math.min(Math.max(0, w), 1);
  let ch = Math.min(Math.max(0, h), 1);
  if (cw !== b.w) clamped_keys.push("w");
  if (ch !== b.h) clamped_keys.push("h");
  if (x + cw > 1) {
    cw = Math.max(0, 1 - x);
    if (!clamped_keys.includes("w")) clamped_keys.push("w");
  }
  if (y + ch > 1) {
    ch = Math.max(0, 1 - y);
    if (!clamped_keys.includes("h")) clamped_keys.push("h");
  }
  return { box: { x, y, w: cw, h: ch }, clamped_keys };
}

function tooSmallBox(b: NormBox, size: { w: number; h: number } | null): boolean {
  if (!(b.w > 0) || !(b.h > 0)) return true;
  if (!size) return false;
  return b.w * size.w < 4 || b.h * size.h < 4;
}

function clampPts(pts: Pt[]): { pts: Pt[]; clamped_keys: string[] } {
  const clamped_keys: string[] = [];
  const out = pts.map((p, i) => {
    const x = clamp01(p.x);
    const y = clamp01(p.y);
    if (x !== p.x) clamped_keys.push(`pts.${i}.x`);
    if (y !== p.y) clamped_keys.push(`pts.${i}.y`);
    return { x, y };
  });
  return { pts: out, clamped_keys };
}

function tooSmallPoly(pts: Pt[], size: { w: number; h: number } | null): boolean {
  if (pts.length < 3) return true;
  let x0 = 1,
    y0 = 1,
    x1 = 0,
    y1 = 0;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return tooSmallBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, size);
}

function polygonArea(pts: Pt[]): number {
  let twiceArea = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const current = pts[i];
    const next = pts[(i + 1) % pts.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2;
}

function cross(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Pt, b: Pt, p: Pt): boolean {
  const epsilon = 1e-9;
  return (
    Math.abs(cross(a, b, p)) <= epsilon &&
    p.x >= Math.min(a.x, b.x) - epsilon &&
    p.x <= Math.max(a.x, b.x) + epsilon &&
    p.y >= Math.min(a.y, b.y) - epsilon &&
    p.y <= Math.max(a.y, b.y) + epsilon
  );
}

function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if ((abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0)) return true;
  return (
    onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)
  );
}

function selfIntersects(pts: Pt[]): boolean {
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    for (let j = i + 1; j < pts.length; j += 1) {
      if (j === i + 1 || (i === 0 && j === pts.length - 1)) continue;
      const c = pts[j];
      const d = pts[(j + 1) % pts.length];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function currentDoc(
  deps: ShapeToolsDeps,
  imageId: string,
): { ok: true; snap: StudioSnapshot & { doc: NonNullable<StudioSnapshot["doc"]> } } | { ok: false; error: string } {
  const snap = deps.get();
  if (!snap.doc || snap.doc.id !== imageId) return { ok: false, error: "image_changed" };
  return { ok: true, snap: snap as StudioSnapshot & { doc: NonNullable<StudioSnapshot["doc"]> } };
}

/** Parse pts from [{x,y}] or flat [x0,y0,...]. */
export function parsePts(raw: unknown): { ok: true; pts: Pt[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "bad_geom" };
  if (typeof raw[0] === "number") {
    if (raw.length < 6 || raw.length % 2 !== 0) return { ok: false, error: "bad_geom" };
    const pts: Pt[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      const x = Number(raw[i]);
      const y = Number(raw[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: "bad_geom" };
      pts.push({ x, y });
    }
    if (pts.length < 3) return { ok: false, error: "need_min_3_pts" };
    return { ok: true, pts };
  }
  const pts: Pt[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") return { ok: false, error: "bad_geom" };
    const r = p as Record<string, unknown>;
    const x = Number(r.x);
    const y = Number(r.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: "bad_geom" };
    pts.push({ x, y });
  }
  if (pts.length < 3) return { ok: false, error: "need_min_3_pts" };
  return { ok: true, pts };
}

function convertPts(
  pts: Pt[],
  unit: Unit,
  size: { w: number; h: number } | null,
): { ok: true; pts: Pt[] } | { ok: false; error: string } {
  if (unit === "px") {
    if (!size) return { ok: false, error: "no_image_size" };
    return { ok: true, pts: pts.map((p) => ({ x: p.x / size.w, y: p.y / size.h })) };
  }
  return { ok: true, pts };
}

function convertBox(
  x: unknown,
  y: unknown,
  w: unknown,
  h: unknown,
  unit: Unit,
  size: { w: number; h: number } | null,
): { ok: true; box: NormBox } | { ok: false; error: string } {
  if (unit === "px" && !size) return { ok: false, error: "no_image_size" };
  const spanX = size?.w ?? 1;
  const spanY = size?.h ?? 1;
  const bx = toNorm(Number(x), unit, spanX);
  const by = toNorm(Number(y), unit, spanY);
  const bw = toNorm(Number(w), unit, spanX);
  const bh = toNorm(Number(h), unit, spanY);
  if (![bx, by, bw, bh].every(Number.isFinite)) return { ok: false, error: "bad_geom" };
  return { ok: true, box: { x: bx, y: by, w: bw, h: bh } };
}

function dims(deps: ShapeToolsDeps) {
  const s = sizeOf(deps);
  return {
    image_width: s?.w ?? null,
    image_height: s?.h ?? null,
    coord_space: "norm" as const,
  };
}

function boxPayload(o: BoxObj) {
  return {
    object_id: o.id,
    label: o.label,
    kind: "box" as const,
    geom: { t: "box" as const, x: o.geom.x, y: o.geom.y, w: o.geom.w, h: o.geom.h },
  };
}

function polyPayload(o: PolyObj) {
  return {
    object_id: o.id,
    label: o.label,
    kind: "polygon" as const,
    geom: { t: "polygon" as const, pts: o.geom.pts.map((p) => ({ x: p.x, y: p.y })) },
  };
}

function boxObjs(snap: StudioSnapshot): BoxObj[] {
  return (snap.doc?.objects ?? []).filter((o): o is BoxObj => o.kind === "box");
}

function polyObjs(snap: StudioSnapshot): PolyObj[] {
  return (snap.doc?.objects ?? []).filter((o): o is PolyObj => o.kind === "polygon");
}

function pickBox(
  snap: StudioSnapshot,
  objectId: unknown,
): { ok: true; obj: BoxObj } | { ok: false; error: string } {
  if (!snap.doc) return { ok: false, error: "no_image" };
  if (snap.project?.type !== "boxes") return { ok: false, error: "not_boxes" };
  const boxes = boxObjs(snap);
  const id = typeof objectId === "string" ? objectId.trim() : "";
  if (boxes.length === 0) return { ok: false, error: "not_found" };
  if (boxes.length !== 1 && !id) return { ok: false, error: "need_object_id" };
  const obj = id ? boxes.find((b) => b.id === id) : boxes[0];
  if (!obj) return { ok: false, error: "not_found" };
  return { ok: true, obj };
}

function pickPoly(
  snap: StudioSnapshot,
  objectId: unknown,
): { ok: true; obj: PolyObj } | { ok: false; error: string } {
  if (!snap.doc) return { ok: false, error: "no_image" };
  if (snap.project?.type !== "polygons") return { ok: false, error: "not_polygons" };
  const polys = polyObjs(snap);
  const id = typeof objectId === "string" ? objectId.trim() : "";
  if (polys.length === 0) return { ok: false, error: "not_found" };
  if (polys.length !== 1 && !id) return { ok: false, error: "need_object_id" };
  const obj = id ? polys.find((p) => p.id === id) : polys[0];
  if (!obj) return { ok: false, error: "not_found" };
  return { ok: true, obj };
}

function parseLabel(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

function gateType(p: Project | null, want: "boxes" | "polygons"): string | null {
  if (!p || p.type !== want) return want === "boxes" ? "not_boxes" : "not_polygons";
  return null;
}

async function persistObjects(deps: ShapeToolsDeps, objects: AnnObj[]): Promise<boolean> {
  try {
    await deps.saveObjects(objects);
    return true;
  } catch {
    return false;
  }
}

export function boxPageTools(deps: ShapeToolsDeps): WebMcpTool[] {
  const schemas = BOX_TOOL_SCHEMAS.tools;
  return [
    {
      ...schemas[0],
      execute: async () => {
        const snap = deps.get();
        const err = gateType(snap.project, "boxes");
        if (err) return { error: err };
        if (!snap.doc) return { error: "no_image" };
        const objects = boxObjs(snap).map(boxPayload);
        return { ...dims(deps), n: objects.length, objects };
      },
    },
    {
      ...schemas[1],
      execute: async (args) => {
        const snap = deps.get();
        const err = gateType(snap.project, "boxes");
        if (err) return { error: err };
        if (!snap.doc) return { error: "no_image" };
        const unit = parseUnit(args.unit);
        if (!unit) return { error: "need_unit" };
        const size = sizeOf(deps);
        const conv = convertBox(args.x, args.y, args.w, args.h, unit, size);
        if (!conv.ok) return { error: conv.error };
        const { box, clamped_keys } = clampBox(conv.box);
        if (tooSmallBox(box, size)) return { error: "too_small", ...dims(deps), got: box };
        const label = parseLabel(args.label) ?? null;
        if (label && !(await deps.ensureClass(label))) return { error: "class_create_failed" };
        const obj: BoxObj = {
          id: newId("box"),
          kind: "box",
          label,
          edited: true,
          geom: { t: "box", ...box },
        };
        const latest = currentDoc(deps, snap.doc.id);
        if (!latest.ok) return { error: latest.error };
        if (!(await persistObjects(deps, [...latest.snap.doc.objects, obj]))) {
          return { error: "save_failed" };
        }
        return { ...boxPayload(obj), ...dims(deps), clamped_keys };
      },
    },
    {
      ...schemas[2],
      execute: async (args) => {
        const snap = deps.get();
        const pick = pickBox(snap, args.object_id);
        if (!pick.ok) return { error: pick.error };
        const unit = parseUnit(args.unit);
        if (!unit) return { error: "need_unit" };
        const has =
          args.x !== undefined || args.y !== undefined || args.w !== undefined || args.h !== undefined;
        if (!has) return { error: "empty_patch" };
        const size = sizeOf(deps);
        if (unit === "px" && !size) return { error: "no_image_size" };
        const g = pick.obj.geom;
        const spanX = size?.w ?? 1;
        const spanY = size?.h ?? 1;
        const next: NormBox = {
          x: args.x !== undefined ? toNorm(Number(args.x), unit, spanX) : g.x,
          y: args.y !== undefined ? toNorm(Number(args.y), unit, spanY) : g.y,
          w: args.w !== undefined ? toNorm(Number(args.w), unit, spanX) : g.w,
          h: args.h !== undefined ? toNorm(Number(args.h), unit, spanY) : g.h,
        };
        if (![next.x, next.y, next.w, next.h].every(Number.isFinite)) return { error: "bad_geom" };
        const { box, clamped_keys } = clampBox(next);
        if (tooSmallBox(box, size)) return { error: "too_small", ...dims(deps), got: box };
        const updated: BoxObj = { ...pick.obj, edited: true, geom: { t: "box", ...box } };
        if (
          !(await persistObjects(
            deps,
            snap.doc!.objects.map((o) => (o.id === updated.id ? updated : o)),
          ))
        ) {
          return { error: "save_failed" };
        }
        return { ...boxPayload(updated), ...dims(deps), clamped_keys };
      },
    },
  ];
}

export function polyPageTools(deps: ShapeToolsDeps): WebMcpTool[] {
  const schemas = POLY_TOOL_SCHEMAS.tools;
  return [
    {
      ...schemas[0],
      execute: async () => {
        const snap = deps.get();
        const err = gateType(snap.project, "polygons");
        if (err) return { error: err };
        if (!snap.doc) return { error: "no_image" };
        const objects = polyObjs(snap).map(polyPayload);
        return { ...dims(deps), n: objects.length, objects };
      },
    },
    {
      ...schemas[1],
      execute: async (args) => {
        const snap = deps.get();
        const err = gateType(snap.project, "polygons");
        if (err) return { error: err };
        if (!snap.doc) return { error: "no_image" };
        const unit = parseUnit(args.unit);
        if (!unit) return { error: "need_unit" };
        const parsed = parsePts(args.pts);
        if (!parsed.ok) return { error: parsed.error };
        const size = sizeOf(deps);
        const conv = convertPts(parsed.pts, unit, size);
        if (!conv.ok) return { error: conv.error };
        const { pts, clamped_keys } = clampPts(conv.pts);
        if (tooSmallPoly(pts, size)) return { error: "too_small", ...dims(deps) };
        if (polygonArea(pts) <= 1e-8) return { error: "degenerate_polygon", ...dims(deps) };
        if (selfIntersects(pts)) return { error: "self_intersection", ...dims(deps) };
        const label = parseLabel(args.label) ?? null;
        if (label && !(await deps.ensureClass(label))) return { error: "class_create_failed" };
        const obj: PolyObj = {
          id: newId("poly"),
          kind: "polygon",
          label,
          edited: true,
          geom: { t: "polygon", pts },
        };
        const latest = currentDoc(deps, snap.doc.id);
        if (!latest.ok) return { error: latest.error };
        if (!(await persistObjects(deps, [...latest.snap.doc.objects, obj]))) {
          return { error: "save_failed" };
        }
        return { ...polyPayload(obj), ...dims(deps), clamped_keys };
      },
    },
    {
      ...schemas[2],
      execute: async (args) => {
        const snap = deps.get();
        const pick = pickPoly(snap, args.object_id);
        if (!pick.ok) return { error: pick.error };
        const unit = parseUnit(args.unit);
        if (!unit) return { error: "need_unit" };
        const parsed = parsePts(args.pts);
        if (!parsed.ok) return { error: parsed.error };
        const size = sizeOf(deps);
        const conv = convertPts(parsed.pts, unit, size);
        if (!conv.ok) return { error: conv.error };
        const { pts, clamped_keys } = clampPts(conv.pts);
        if (tooSmallPoly(pts, size)) return { error: "too_small", ...dims(deps) };
        if (polygonArea(pts) <= 1e-8) return { error: "degenerate_polygon", ...dims(deps) };
        if (selfIntersects(pts)) return { error: "self_intersection", ...dims(deps) };
        const updated: PolyObj = { ...pick.obj, edited: true, geom: { t: "polygon", pts } };
        if (
          !(await persistObjects(
            deps,
            snap.doc!.objects.map((o) => (o.id === updated.id ? updated : o)),
          ))
        ) {
          return { error: "save_failed" };
        }
        return { ...polyPayload(updated), ...dims(deps), clamped_keys };
      },
    },
  ];
}
