import type { Comment } from "../geometry/comment";
import { commitStatus, named, type AnnObj, type Doc, type Project } from "../geometry/doc";
import type { WebMcpTool } from "@/shared/webmcp";

export type StudioImgRow = {
  id: string;
  filename: string;
  committed?: boolean;
  empty?: boolean;
};

export type StudioCurrent = {
  id: string;
  index: number;
  filename: string;
  committed: boolean;
  empty: boolean;
  can_commit: boolean;
  invalid_reasons: string[];
  unlabeled: string[];
  objects: { id: string; kind: string; label: string | null }[];
  comments: { id: string; body: string; at?: string | null }[];
  loading: boolean;
};

export type StudioSnapshot = {
  projectId: string;
  project: Project | null;
  list: StudioImgRow[];
  index: number;
  doc: Doc | null;
};

/** Type-agnostic studio orientation (same text for boxes | polygons | keypoints). */
export const STUDIO_GUIDE = [
  "Prefer registered WebMCP tools for navigation, geometry, labels, and commit. Canvas clicks are human UX; use tools when they exist.",
  "After writes, take screenshots often and verify annotations visually — do not assume success from a tool OK alone.",
  "Bad or ambiguous frames: delete_image soft-deletes the frame. Recovery is only available from the five-second human UI undo; WebMCP has no restore tool.",
  "Work one image at a time via open_image. get_studio shows progress, can_commit, invalid_reasons, and unlabeled ids — its objects list has no geometry.",
  "commit_image only when can_commit (≥1 named label). First successful commit advances the filmstrip.",
  "Geometry is on type-specific tools listed in geometry_tools — read those tool schemas for args; this guide does not teach them.",
  "Computer use is for perception/verification (screenshots), not for dragging shapes when geometry tools exist. Media upload is outside WebMCP — humans add files in the UI.",
  "Use comment for notes to humans when unsure; do not silently invent quality.",
  "If verification fails: fix via set_* / delete_object, or delete_image, then commit only when it looks right.",
] as const;

export function geometryToolNames(type?: string | null): string[] {
  if (type === "boxes") return ["get_boxes", "add_box", "set_box"];
  if (type === "polygons") return ["get_polygons", "add_polygon", "set_polygon"];
  if (type === "keypoints") return ["get_rig", "set_rig", "add_instance"];
  return [];
}

export function studioGuidePayload(snap: StudioSnapshot) {
  const p = snap.project;
  return {
    guide: [...STUDIO_GUIDE],
    project: p ? { type: p.type, template: p.template ?? null } : null,
    geometry_tools: geometryToolNames(p?.type),
  };
}

/** Schema-only export for webmcp-evals (keep in sync with tools below). */
export const STUDIO_TOOL_SCHEMAS = {
  tools: [
    {
      name: "studio_guide",
      description:
        "Optional orientation for labeling in Studio: lean workflow tips (type-agnostic) plus which geometry tools are registered for this project.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "get_studio",
      description:
        "Snapshot of the open Studio: project, progress, current image (objects without geometry), can_commit, invalid_reasons, unlabeled ids, export_url.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "open_image",
      description:
        "Open one filmstrip image. Pass exactly one of: index (0-based), id, or next_uncommitted=true.",
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "integer", minimum: 0, description: "0-based filmstrip index" },
          id: { type: "string", description: "Image id" },
          next_uncommitted: {
            type: "boolean",
            description: "Jump to next uncommitted image after current (wraps)",
          },
        },
        oneOf: [
          { required: ["index"] },
          { required: ["id"] },
          {
            properties: { next_uncommitted: { const: true } },
            required: ["next_uncommitted"],
          },
        ],
        additionalProperties: false,
      },
    },
    {
      name: "set_label",
      description:
        "Set or clear an object label on the current image. Non-empty labels create the class if missing (same as UI). Geometry unchanged.",
      inputSchema: {
        type: "object",
        properties: {
          object_id: { type: "string" },
          label: {
            type: ["string", "null"],
            description: "Label text, or null/\"\" to clear",
          },
        },
        required: ["object_id", "label"],
        additionalProperties: false,
      },
    },
    {
      name: "delete_object",
      description: "Remove one annotation object from the current image (geometry deleted).",
      inputSchema: {
        type: "object",
        properties: { object_id: { type: "string" } },
        required: ["object_id"],
        additionalProperties: false,
      },
    },
    {
      name: "commit_image",
      description:
        "Commit the current image (Footer rules: at least one named object). First commit advances to next image.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "delete_image",
      description: "Soft-delete the current filmstrip image.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "get_comments",
      description:
        "List comments for every image in the project (filmstrip order). Optional image_id filters to one image. Current-image comments also appear on get_studio.",
      inputSchema: {
        type: "object",
        properties: {
          image_id: { type: "string", description: "If set, only that image's comments" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "comment",
      description: "Add or delete a comment on the current image.",
      inputSchema: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["add", "delete"] },
          body: { type: "string", description: "Required for add" },
          id: { type: "string", description: "Comment id; required for delete" },
        },
        required: ["op"],
        oneOf: [
          { properties: { op: { const: "add" } }, required: ["op", "body"] },
          { properties: { op: { const: "delete" } }, required: ["op", "id"] },
        ],
        additionalProperties: false,
      },
    },
  ],
} as const;

export type StudioToolsDeps = {
  get: () => StudioSnapshot;
  setIndex: (i: number) => void;
  /** Persist objects on current doc (optimistic local, awaited network). */
  saveObjects: (objects: AnnObj[]) => void | Promise<void>;
  ensureClass: (name: string) => Promise<boolean>;
  commitCurrent: () => Promise<
    | { ok: true; advanced: boolean }
    | { ok: false; error: "cannot_commit" | "no_image"; reason?: string }
  >;
  deleteCurrent: () => Promise<
    { ok: true; deleted_id: string } | { ok: false; error: "no_image" | "delete_failed" }
  >;
  addComment: (body: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  deleteComment: (cid: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Project-wide comments (all images). */
  listComments: () => Promise<
    | {
        ok: true;
        images: {
          id: string;
          filename: string;
          index: number;
          comments: { id: string; body: string; at?: string | null }[];
        }[];
      }
    | { ok: false; error: string }
  >;
  /** Wait until doc matches target image id (post open_image). */
  waitForImage?: (imageId: string, ms?: number) => Promise<boolean>;
};

async function persistObjects(deps: StudioToolsDeps, objects: AnnObj[]): Promise<boolean> {
  try {
    await deps.saveObjects(objects);
    return true;
  } catch {
    return false;
  }
}

function slimObjects(objects: AnnObj[]) {
  return objects.map((o) => ({
    id: o.id,
    kind: o.kind,
    label: o.label,
  }));
}

function slimComments(comments: Comment[] | undefined) {
  return (comments ?? []).map((c) => ({ id: c.id, body: c.body, at: c.at ?? null }));
}

export function currentSummary(snap: StudioSnapshot): StudioCurrent | null {
  const { list, index, doc } = snap;
  if (!list.length) return null;
  const i = Math.min(Math.max(0, index), list.length - 1);
  const row = list[i];
  const docReady = doc?.id === row.id;
  const objects = docReady ? doc.objects : [];
  const unlabeled = objects.filter((o) => !named(o.label)).map((o) => o.id);
  const status = docReady ? commitStatus(objects) : { can_commit: false, reasons: ["image_loading"] };
  return {
    id: row.id,
    index: i,
    filename: row.filename,
    committed: Boolean(row.committed || (docReady && doc.committed)),
    empty: docReady ? objects.length === 0 : Boolean(row.empty),
    can_commit: status.can_commit,
    invalid_reasons: status.reasons,
    unlabeled,
    objects: slimObjects(objects),
    comments: docReady ? slimComments(doc.comments) : [],
    loading: !docReady,
  };
}

function studioPayload(snap: StudioSnapshot) {
  const p = snap.project;
  const list = snap.list;
  return {
    project: p
      ? {
          id: p.id,
          name: p.name,
          type: p.type,
          template: p.template ?? null,
          classes: p.classes ?? [],
        }
      : null,
    progress: {
      n: list.length,
      committed: list.filter((x) => x.committed).length,
      empty: list.filter((x) => x.empty).length,
    },
    current: currentSummary(snap),
    export_url: `/api/projects/${snap.projectId}/export`,
  };
}

function pickOneSelector(args: Record<string, unknown>): {
  ok: true;
  kind: "index" | "id" | "next";
  index?: number;
  id?: string;
} | { ok: false; error: string } {
  const hasIndex = args.index !== undefined && args.index !== null;
  const hasId = typeof args.id === "string" && args.id.trim() !== "";
  const next = args.next_uncommitted === true;
  const n = (hasIndex ? 1 : 0) + (hasId ? 1 : 0) + (next ? 1 : 0);
  if (n !== 1) return { ok: false, error: "need_exactly_one_of_index_id_next_uncommitted" };
  if (next) return { ok: true, kind: "next" };
  if (hasId) return { ok: true, kind: "id", id: String(args.id).trim() };
  const index = Number(args.index);
  if (!Number.isInteger(index) || index < 0) return { ok: false, error: "bad_index" };
  return { ok: true, kind: "index", index };
}

export function studioPageTools(deps: StudioToolsDeps): WebMcpTool[] {
  const schemas = STUDIO_TOOL_SCHEMAS.tools;
  return [
    {
      ...schemas[0],
      execute: async () => studioGuidePayload(deps.get()),
    },
    {
      ...schemas[1],
      execute: async () => studioPayload(deps.get()),
    },
    {
      ...schemas[2],
      execute: async (args) => {
        const sel = pickOneSelector(args);
        if (!sel.ok) return { error: sel.error };
        const snap = deps.get();
        const { list, index } = snap;
        if (!list.length) return { error: "no_images" };

        let target = -1;
        if (sel.kind === "index") {
          if (sel.index! >= list.length) return { error: "index_out_of_range" };
          target = sel.index!;
        } else if (sel.kind === "id") {
          target = list.findIndex((x) => x.id === sel.id);
          if (target < 0) return { error: "not_found" };
        } else {
          const i = Math.min(index, list.length - 1);
          for (let k = 1; k < list.length; k++) {
            const j = (i + k) % list.length;
            if (!list[j].committed) {
              target = j;
              break;
            }
          }
          if (target < 0) return { error: "no_uncommitted" };
        }

        const row = list[target];
        deps.setIndex(target);
        if (deps.waitForImage && !(await deps.waitForImage(row.id, 2500))) {
          return { error: "image_load_timeout", image_id: row.id };
        }
        return { current: currentSummary(deps.get()) };
      },
    },
    {
      ...schemas[3],
      execute: async (args) => {
        const snap = deps.get();
        if (!snap.doc) return { error: "no_image" };
        const oid = String(args.object_id ?? "").trim();
        if (!oid) return { error: "bad_object_id" };
        if (!snap.doc.objects.some((o) => o.id === oid)) return { error: "not_found" };

        let label: string | null;
        if (args.label === null || args.label === undefined) label = null;
        else {
          const t = String(args.label).trim();
          label = t === "" ? null : t;
        }
        if (label && !(await deps.ensureClass(label))) return { error: "class_create_failed" };
        if (
          !(await persistObjects(
            deps,
            snap.doc.objects.map((o) => (o.id === oid ? { ...o, label } : o)),
          ))
        ) {
          return { error: "save_failed" };
        }
        return { current: currentSummary(deps.get()) };
      },
    },
    {
      ...schemas[4],
      execute: async (args) => {
        const snap = deps.get();
        if (!snap.doc) return { error: "no_image" };
        const oid = String(args.object_id ?? "").trim();
        if (!snap.doc.objects.some((o) => o.id === oid)) return { error: "not_found" };
        if (!(await persistObjects(deps, snap.doc.objects.filter((o) => o.id !== oid)))) {
          return { error: "save_failed" };
        }
        return { current: currentSummary(deps.get()) };
      },
    },
    {
      ...schemas[5],
      execute: async () => {
        const res = await deps.commitCurrent();
        if (!res.ok) return { error: res.error, reason: res.reason };
        if (res.advanced && deps.waitForImage) {
          const target = currentSummary(deps.get());
          if (target && !(await deps.waitForImage(target.id, 2500))) {
            return {
              ok: true,
              advanced: true,
              current: currentSummary(deps.get()),
              warning: "next_image_load_timeout",
            };
          }
        }
        return { ok: true, advanced: res.advanced, current: currentSummary(deps.get()) };
      },
    },
    {
      ...schemas[6],
      execute: async () => {
        const res = await deps.deleteCurrent();
        if (!res.ok) return { error: res.error };
        const target = currentSummary(deps.get());
        if (target && deps.waitForImage && !(await deps.waitForImage(target.id, 2500))) {
          return {
            deleted_id: res.deleted_id,
            current: currentSummary(deps.get()),
            warning: "next_image_load_timeout",
          };
        }
        return { deleted_id: res.deleted_id, current: currentSummary(deps.get()) };
      },
    },
    {
      ...schemas[7],
      execute: async (args) => {
        const res = await deps.listComments();
        if (!res.ok) return { error: res.error };
        const hasImageId = args.image_id !== undefined && args.image_id !== null;
        const iid = typeof args.image_id === "string" ? args.image_id.trim() : "";
        if (hasImageId && !iid) return { error: "bad_image_id" };
        const images = iid ? res.images.filter((x) => x.id === iid) : res.images;
        if (iid && !images.length) return { error: "not_found" };
        const n_comments = images.reduce((n, x) => n + x.comments.length, 0);
        return {
          n_images: images.length,
          n_comments,
          images: images.map((x) => ({
            id: x.id,
            filename: x.filename,
            index: x.index,
            comments: x.comments.map((c) => ({
              id: c.id,
              body: c.body,
              at: c.at ?? null,
            })),
          })),
        };
      },
    },
    {
      ...schemas[8],
      execute: async (args) => {
        const op = args.op;
        if (op === "add") {
          const body = String(args.body ?? "").trim();
          if (!body) return { error: "empty_body" };
          const res = await deps.addComment(body);
          if (!res.ok) return { error: res.error };
          return { comments: currentSummary(deps.get())?.comments ?? [] };
        }
        if (op === "delete") {
          const cid = String(args.id ?? "").trim();
          if (!cid) return { error: "need_id" };
          const current = currentSummary(deps.get());
          if (!current) return { error: "no_image" };
          if (!current.comments.some((comment) => comment.id === cid)) {
            return { error: "not_found" };
          }
          const res = await deps.deleteComment(cid);
          if (!res.ok) return { error: res.error };
          return { comments: currentSummary(deps.get())?.comments ?? [] };
        }
        return { error: "bad_op" };
      },
    },
  ];
}
