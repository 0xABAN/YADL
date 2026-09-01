import { newId, type AnnObj, type HandObj, type KeypointTemplate, type Project } from "../geometry/doc";
import {
  catalogFor,
  clampJoint,
  DEFAULT_ROOT,
  jointIndex,
  resolveJoints,
  restRig,
  type RigRoot,
  type RigState,
  type TemplateCatalog,
} from "../geometry/rig";
import type { StudioSnapshot } from "./studioTools";
import type { WebMcpTool } from "@/shared/webmcp";

const ROOT_PROPS = {
  type: "object",
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    scale: { type: "number" },
    roll: { type: "number" },
  },
  additionalProperties: false,
} as const;

/** Schema-only export for webmcp-evals. */
export const RIG_TOOL_SCHEMAS = {
  tools: [
    {
      name: "get_rig",
      description:
        "Read FK rig for one keypoint instance. object_id required when more than one instance. Optional include_landmarks / include_defs.",
      inputSchema: {
        type: "object",
        properties: {
          object_id: { type: "string" },
          include_landmarks: { type: "boolean" },
          include_defs: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "set_rig",
      description:
        "Batch update root and/or joints (and optional handedness). FK overwrites landmarks. If rig was cleared by human/assist, send full root+joints or get rig_invalidated.",
      inputSchema: {
        type: "object",
        properties: {
          object_id: { type: "string" },
          root: ROOT_PROPS,
          joints: {
            type: "object",
            additionalProperties: { type: "number" },
            description: "Sparse joint id → value (catalog units)",
          },
          handedness: { type: ["string", "null"], enum: ["Left", "Right", null] },
        },
        additionalProperties: false,
      },
    },
    {
      name: "add_instance",
      description:
        "Add a rest-pose keypoint instance for the project template (FK landmarks + live rig). Optional root and handedness (hand only).",
      inputSchema: {
        type: "object",
        properties: {
          root: ROOT_PROPS,
          handedness: { type: ["string", "null"], enum: ["Left", "Right", null] },
        },
        additionalProperties: false,
      },
    },
  ],
} as const;

export type RigToolsDeps = {
  get: () => StudioSnapshot;
  saveObjects: (objects: AnnObj[]) => void | Promise<void>;
  setSelected?: (id: string | null) => void;
};

function templateOf(p: Project | null): KeypointTemplate {
  return p?.template === "pose" || p?.template === "face" ? p.template : "hand";
}

function handObjs(snap: StudioSnapshot): HandObj[] {
  return (snap.doc?.objects ?? []).filter((o): o is HandObj => o.kind === "hand");
}

function pickObject(
  snap: StudioSnapshot,
  objectId: unknown,
): { ok: true; obj: HandObj; others: AnnObj[] } | { ok: false; error: string } {
  if (!snap.doc) return { ok: false, error: "no_image" };
  if (snap.project?.type !== "keypoints") return { ok: false, error: "not_keypoints" };
  const hands = handObjs(snap);
  const id = typeof objectId === "string" ? objectId.trim() : "";
  if (hands.length === 0) return { ok: false, error: "no_instances" };
  if (hands.length !== 1 && !id) return { ok: false, error: "need_object_id" };
  const obj = id ? hands.find((h) => h.id === id) : hands[0];
  if (!obj) return { ok: false, error: "not_found" };
  return { ok: true, obj, others: snap.doc.objects };
}

function clampRoot(partial: Partial<RigRoot>, base: RigRoot): RigRoot {
  const n = (v: unknown, d: number, lo?: number, hi?: number) => {
    if (v === undefined || v === null) return d;
    const x = Number(v);
    if (!Number.isFinite(x)) return d;
    if (lo !== undefined && hi !== undefined) return Math.min(hi, Math.max(lo, x));
    return x;
  };
  return {
    x: n(partial.x, base.x, 0, 1),
    y: n(partial.y, base.y, 0, 1),
    scale: n(partial.scale, base.scale, 0.02, 1.5),
    roll: n(partial.roll, base.roll),
  };
}

function applySparseJoints(
  catalog: TemplateCatalog,
  base: Record<string, number>,
  sparse: Record<string, number> | undefined,
): { joints: Record<string, number>; clamped_keys: string[]; unknown_keys: string[] } {
  const joints = { ...base };
  const clamped_keys: string[] = [];
  const unknown_keys: string[] = [];
  if (!sparse) return { joints, clamped_keys, unknown_keys };
  const idx = jointIndex(catalog);
  for (const [k, raw] of Object.entries(sparse)) {
    const def = idx.get(k);
    if (!def) {
      unknown_keys.push(k);
      continue;
    }
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    const c = clampJoint(def, v);
    if (c !== v) clamped_keys.push(k);
    joints[k] = c;
  }
  return { joints, clamped_keys, unknown_keys };
}

function rigPayload(
  snap: StudioSnapshot,
  obj: HandObj,
  opts: { include_landmarks?: boolean; include_defs?: boolean } = {},
) {
  const template = templateOf(snap.project);
  const cat = catalogFor(template);
  const live = Boolean(obj.geom.rig);
  const root = obj.geom.rig?.root ?? DEFAULT_ROOT;
  const joints = resolveJoints(cat, obj.geom.rig?.joints ?? null);
  const out: Record<string, unknown> = {
    object_id: obj.id,
    template,
    rig_live: live,
    root,
    joints,
    handedness: obj.geom.handedness ?? null,
    landmark_count: obj.geom.landmarks.length || cat.landmarkCount,
    label: obj.label,
  };
  if (opts.include_defs) out.joint_defs = cat.joints;
  if (opts.include_landmarks) {
    out.landmarks = obj.geom.landmarks.map((p, i) => ({
      i,
      name: cat.landmarkName(i),
      x: p.x,
      y: p.y,
      z: p.z,
    }));
  }
  return out;
}

function parseHandedness(v: unknown): "Left" | "Right" | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const s = String(v);
  if (s === "Left" || s === "Right") return s;
  return undefined;
}

export function rigPageTools(deps: RigToolsDeps): WebMcpTool[] {
  const schemas = RIG_TOOL_SCHEMAS.tools;
  return [
    {
      ...schemas[0],
      execute: async (args) => {
        const snap = deps.get();
        const pick = pickObject(snap, args.object_id);
        if (!pick.ok) return { error: pick.error };
        return rigPayload(snap, pick.obj, {
          include_landmarks: args.include_landmarks === true,
          include_defs: args.include_defs === true,
        });
      },
    },
    {
      ...schemas[1],
      execute: async (args) => {
        const snap = deps.get();
        const pick = pickObject(snap, args.object_id);
        if (!pick.ok) return { error: pick.error };
        const template = templateOf(snap.project);
        const cat = catalogFor(template);
        const obj = pick.obj;
        const hasRoot = args.root && typeof args.root === "object";
        const hasJoints = args.joints && typeof args.joints === "object" && !Array.isArray(args.joints);
        const handIn = parseHandedness(args.handedness);
        const hasHand = handIn !== undefined;

        if (!hasRoot && !hasJoints && !hasHand) return { error: "empty_patch" };

        const live = obj.geom.rig;
        if (!live && (!hasRoot || !hasJoints)) return { error: "rig_invalidated" };

        if (template !== "hand" && handIn !== undefined && handIn !== null) {
          return { error: "not_applicable" };
        }

        const baseRoot = live?.root ?? DEFAULT_ROOT;
        const baseJoints = resolveJoints(cat, live?.joints ?? null);
        const root = hasRoot ? clampRoot(args.root as Partial<RigRoot>, baseRoot) : baseRoot;
        const sparse = hasJoints ? (args.joints as Record<string, number>) : undefined;
        const { joints, clamped_keys, unknown_keys } = applySparseJoints(cat, baseJoints, sparse);
        if (hasJoints && unknown_keys.length) {
          return { error: "unknown_joint", unknown_keys };
        }
        const handedness = handIn !== undefined ? handIn : (obj.geom.handedness ?? null);
        const rig: RigState = { root, joints };
        const nextObj: HandObj = {
          ...obj,
          edited: true,
          geom: {
            ...obj.geom,
            landmarks: cat.fk(root, joints, handedness),
            handedness: template === "hand" ? handedness : null,
            rig,
          },
        };
        await deps.saveObjects(pick.others.map((o) => (o.id === obj.id ? nextObj : o)));
        deps.setSelected?.(nextObj.id);
        return { ...rigPayload(snap, nextObj), clamped_keys, unknown_keys };
      },
    },
    {
      ...schemas[2],
      execute: async (args) => {
        const snap = deps.get();
        if (!snap.doc) return { error: "no_image" };
        if (snap.project?.type !== "keypoints") return { error: "not_keypoints" };
        const template = templateOf(snap.project);
        const cat = catalogFor(template);
        const rootPartial =
          args.root && typeof args.root === "object" ? (args.root as Partial<RigRoot>) : {};
        const rig = restRig(cat, rootPartial);
        let handedness: "Left" | "Right" | null = null;
        const handIn = parseHandedness(args.handedness);
        if (handIn !== undefined) {
          if (template !== "hand" && handIn !== null) return { error: "not_applicable" };
          handedness = handIn;
        } else if (template === "hand") {
          handedness = "Right";
        }
        const obj: HandObj = {
          id: newId("kp"),
          kind: "hand",
          label: null,
          edited: false,
          geom: {
            t: "hand",
            landmarks: cat.fk(rig.root, rig.joints, handedness),
            handedness,
            rig,
          },
        };
        await deps.saveObjects([...snap.doc.objects, obj]);
        deps.setSelected?.(obj.id);
        return rigPayload(snap, obj);
      },
    },
  ];
}
