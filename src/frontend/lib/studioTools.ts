import type { Comment } from "./comment";
import { named, type AnnObj, type Doc, type Project } from "./doc";
import type { WebMcpTool } from "./webmcp";

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
  unlabeled: string[];
  objects: { id: string; kind: string; label: string | null }[];
  comments: { id: string; body: string; at?: string | null }[];
};

export type StudioSnapshot = {
  projectId: string;
  project: Project | null;
  list: StudioImgRow[];
  index: number;
  doc: Doc | null;
};

/** Schema-only export for webmcp-evals (keep in sync with tools below). */
export const STUDIO_TOOL_SCHEMAS = {
  tools: [
    {
      name: "get_studio",
      description:
        "Snapshot of the open Studio: project, progress, current image (objects without geometry), can_commit, unlabeled ids, export_url.",
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
        additionalProperties: false,
      },
    },
    {
      name: "open_upload",
      description:
        "Open the Studio add-media modal. Does not upload files — use computer use on [data-webmcp=select-files] then Upload.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
  ],
} as const;

export type StudioToolsDeps = {
  get: () => StudioSnapshot;
  setIndex: (i: number) => void;
  /** Persist objects on current doc (optimistic local, awaited network). */
  saveObjects: (objects: AnnObj[]) => void | Promise<void>;
  ensureClass: (name: string) => Promise<void>;
  commitCurrent: () => Promise<
    | { ok: true; advanced: boolean }
    | { ok: false; error: "cannot_commit" | "no_image"; reason?: string }
  >;
  deleteCurrent: () => Promise<
    { ok: true; deleted_id: string } | { ok: false; error: "no_image" | "delete_failed" }
  >;
  addComment: (body: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  deleteComment: (cid: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  openUpload: () => void;
  /** Wait until doc matches target image id (post open_image). */
  waitForImage?: (imageId: string, ms?: number) => Promise<boolean>;
};

function slimObjects(objects: AnnObj[]) {
  return objects.map((o) => ({ id: o.id, kind: o.kind, label: o.label }));
}

function slimComments(comments: Comment[] | undefined) {
  return (comments ?? []).map((c) => ({ id: c.id, body: c.body, at: c.at ?? null }));
}

export function currentSummary(snap: StudioSnapshot): StudioCurrent | null {
  const { list, index, doc } = snap;
  if (!list.length) return null;
  const i = Math.min(Math.max(0, index), list.length - 1);
  const row = list[i];
  const objects = doc?.id === row.id ? doc.objects : [];
  const unlabeled = objects.filter((o) => !named(o.label)).map((o) => o.id);
  return {
    id: row.id,
    index: i,
    filename: row.filename,
    committed: Boolean(row.committed || doc?.committed),
    empty: row.empty ?? objects.length === 0,
    can_commit: objects.some((o) => named(o.label)),
    unlabeled,
    objects: slimObjects(objects),
    comments: doc?.id === row.id ? slimComments(doc.comments) : [],
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
      execute: async () => studioPayload(deps.get()),
    },
    {
      ...schemas[1],
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
        if (deps.waitForImage) await deps.waitForImage(row.id, 2500);
        return { current: currentSummary(deps.get()) };
      },
    },
    {
      ...schemas[2],
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
        if (label) await deps.ensureClass(label);
        await deps.saveObjects(snap.doc.objects.map((o) => (o.id === oid ? { ...o, label } : o)));
        return { current: currentSummary(deps.get()) };
      },
    },
    {
      ...schemas[3],
      execute: async (args) => {
        const snap = deps.get();
        if (!snap.doc) return { error: "no_image" };
        const oid = String(args.object_id ?? "").trim();
        if (!snap.doc.objects.some((o) => o.id === oid)) return { error: "not_found" };
        await deps.saveObjects(snap.doc.objects.filter((o) => o.id !== oid));
        return { current: currentSummary(deps.get()) };
      },
    },
    {
      ...schemas[4],
      execute: async () => {
        const res = await deps.commitCurrent();
        if (!res.ok) return { error: res.error, reason: res.reason };
        return { ok: true, advanced: res.advanced, current: currentSummary(deps.get()) };
      },
    },
    {
      ...schemas[5],
      execute: async () => {
        const res = await deps.deleteCurrent();
        if (!res.ok) return { error: res.error };
        return { deleted_id: res.deleted_id, current: currentSummary(deps.get()) };
      },
    },
    {
      ...schemas[6],
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
          const res = await deps.deleteComment(cid);
          if (!res.ok) return { error: res.error };
          return { comments: currentSummary(deps.get())?.comments ?? [] };
        }
        return { error: "bad_op" };
      },
    },
    {
      ...schemas[7],
      execute: async () => {
        deps.openUpload();
        return { opened: true, cu: "[data-webmcp=select-files]" };
      },
    },
  ];
}
