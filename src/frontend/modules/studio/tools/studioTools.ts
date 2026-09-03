import type { Comment } from "../geometry/comment";
import type {
  AugmentationJob,
  AugmentationJobPage,
  AugmentationRequest,
} from "../api";
import { commitStatus, named, type AnnObj, type Doc, type Project } from "../geometry/doc";
import type { AutoLabelStatus } from "../session/types";
import { ApiError } from "@/shared/api/client";
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
  auto_label_status: AutoLabelStatus | null;
};

export type StudioSnapshot = {
  projectId: string;
  project: Project | null;
  list: StudioImgRow[];
  pageOffset: number;
  total: number;
  committedCount: number;
  emptyCount: number;
  index: number;
  doc: Doc | null;
  autoLabelStatus: AutoLabelStatus | null;
};

/** Type-agnostic studio orientation (same text for boxes | polygons | keypoints). */
export const STUDIO_GUIDE = [
  "Prefer registered WebMCP tools for navigation, geometry, labels, and commit. Canvas clicks are human UX; use tools when they exist.",
  "After writes, take screenshots often and verify annotations visually — do not assume success from a tool OK alone.",
  "Bad or ambiguous frames: delete_image soft-deletes the frame. Recovery is only available from the five-second human UI undo; WebMCP has no restore tool.",
  "Work one image at a time via open_image. get_studio shows progress, can_commit, invalid_reasons, and unlabeled ids — its objects list has no geometry.",
  "commit_image only when can_commit. Empty images are reviewed negative samples; non-empty images need a named label. First successful commit advances the filmstrip.",
  "Geometry is on type-specific tools listed in geometry_tools — read those tool schemas for args; this guide does not teach them.",
  "Computer use is for perception/verification (screenshots), not for dragging shapes when geometry tools exist. Media upload is outside WebMCP — humans add files in the UI.",
  "Use comment for notes to humans when unsure; do not silently invent quality.",
  "If verification fails: fix via set_* / delete_object, or delete_image, then commit only when it looks right.",
  "Use augmentation tools to create durable transform or AI-generation jobs. Poll get_augmentation_job, inspect item errors, and open an output explicitly when ready.",
] as const;

const sourceIds = {
  type: "array",
  minItems: 1,
  uniqueItems: true,
  items: { type: "string", minLength: 1 },
  description: "Project image ids used as sources",
} as const;

const waveProperties = {
  prompt: { type: "string", minLength: 1, maxLength: 32000, description: "Generation or edit instruction" },
  aspect_ratio: { type: "string", enum: ["1:1", "3:2", "2:3", "16:9", "9:16"] },
  resolution: { type: "string", enum: ["1k", "2k", "4k"] },
  quality: { type: "string", enum: ["low", "medium", "high"] },
  output_format: { type: "string", enum: ["png", "jpeg", "webp"] },
} as const;

const probability = { type: "number", minimum: 0, maximum: 1 } as const;
const transformOperations = [
  {
    type: "object",
    properties: {
      op: { type: "string", const: "flip" },
      axis: { type: "string", enum: ["horizontal", "vertical"] },
      probability,
    },
    required: ["op"],
    additionalProperties: false,
  },
  {
    type: "object",
    properties: {
      op: { type: "string", const: "affine" },
      rotate_degrees: { type: "number", minimum: -360, maximum: 360 },
      translate_x: { type: "number", minimum: -1, maximum: 1 },
      translate_y: { type: "number", minimum: -1, maximum: 1 },
      scale: { type: "number", exclusiveMinimum: 0, maximum: 10 },
      shear_degrees: { type: "number", minimum: -89, maximum: 89 },
      probability,
    },
    required: ["op"],
    additionalProperties: false,
  },
  {
    type: "object",
    properties: {
      op: { type: "string", const: "crop_resize" },
      x: { type: "number", minimum: 0, maximum: 1 },
      y: { type: "number", minimum: 0, maximum: 1 },
      width: { type: "number", exclusiveMinimum: 0, maximum: 1 },
      height: { type: "number", exclusiveMinimum: 0, maximum: 1 },
      probability,
    },
    required: ["op"],
    additionalProperties: false,
  },
  {
    type: "object",
    properties: {
      op: { type: "string", const: "brightness_contrast" },
      brightness: { type: "number", minimum: 0, maximum: 4 },
      contrast: { type: "number", minimum: 0, maximum: 4 },
      probability,
    },
    required: ["op"],
    additionalProperties: false,
  },
  {
    type: "object",
    properties: {
      op: { type: "string", const: "hue_saturation" },
      hue_degrees: { type: "number", minimum: -180, maximum: 180 },
      saturation: { type: "number", minimum: 0, maximum: 4 },
      probability,
    },
    required: ["op"],
    additionalProperties: false,
  },
  {
    type: "object",
    properties: {
      op: { type: "string", const: "blur" },
      radius: { type: "number", minimum: 0, maximum: 100 },
      probability,
    },
    required: ["op"],
    additionalProperties: false,
  },
  {
    type: "object",
    properties: {
      op: { type: "string", const: "noise" },
      sigma: { type: "number", minimum: 0, maximum: 255 },
      probability,
    },
    required: ["op"],
    additionalProperties: false,
  },
  {
    type: "object",
    properties: {
      op: { type: "string", const: "compression" },
      quality: { type: "integer", minimum: 1, maximum: 100 },
      probability,
    },
    required: ["op"],
    additionalProperties: false,
  },
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
        "Snapshot of the open Studio: project, progress, current image, and the loaded image_page with source ids for augmentation. Objects omit geometry.",
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
        "Commit the current image as a reviewed negative sample when empty, or with at least one named object. First commit advances to next image.",
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
    {
      name: "create_augmentation_job",
      description:
        "Create a durable transform, text-to-image, or image-edit job. Returns a compact job summary; inspect items with get_augmentation_job. Outputs never inherit annotations.",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["transform", "text_to_image", "image_edit"] },
          source_image_ids: sourceIds,
          variants_per_source: { type: "integer", minimum: 1 },
          seed: { type: "integer" },
          pipeline: {
            type: "array",
            minItems: 1,
            description:
              "Ordered transform operations: flip, affine, crop_resize, brightness_contrast, hue_saturation, blur, noise, or compression",
            items: { oneOf: transformOperations },
          },
          count: { type: "integer", minimum: 1 },
          ...waveProperties,
        },
        required: ["mode"],
        oneOf: [
          {
            properties: { mode: { const: "transform" } },
            required: ["mode", "source_image_ids", "variants_per_source", "seed", "pipeline"],
            not: {
              anyOf: ["count", "prompt", "aspect_ratio", "resolution", "quality", "output_format"].map(
                (key) => ({ required: [key] }),
              ),
            },
          },
          {
            properties: { mode: { const: "text_to_image" } },
            required: ["mode", "prompt", "count"],
            not: {
              anyOf: ["source_image_ids", "variants_per_source", "seed", "pipeline"].map((key) => ({
                required: [key],
              })),
            },
          },
          {
            properties: { mode: { const: "image_edit" } },
            required: ["mode", "prompt", "source_image_ids", "variants_per_source"],
            not: {
              anyOf: ["count", "seed", "pipeline"].map((key) => ({ required: [key] })),
            },
          },
        ],
        additionalProperties: false,
      },
    },
    {
      name: "list_augmentation_jobs",
      description:
        "List augmentation jobs newest first, with aggregate status counts and per-job progress.",
      inputSchema: {
        type: "object",
        properties: {
          offset: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "get_augmentation_job",
      description:
        "Inspect one augmentation job and a page of its items, including output image ids and actionable errors.",
      inputSchema: {
        type: "object",
        properties: {
          job_id: { type: "string" },
          item_offset: { type: "integer", minimum: 0 },
          item_limit: { type: "integer", minimum: 1, maximum: 200 },
        },
        required: ["job_id"],
        additionalProperties: false,
      },
    },
    {
      name: "cancel_augmentation_job",
      description: "Cancel queued work and request provider cancellation for a job.",
      inputSchema: {
        type: "object",
        properties: { job_id: { type: "string" } },
        required: ["job_id"],
        additionalProperties: false,
      },
    },
    {
      name: "retry_augmentation_job",
      description:
        "Explicitly retry failed, cancelled, or ambiguous items in an augmentation job.",
      inputSchema: {
        type: "object",
        properties: { job_id: { type: "string" } },
        required: ["job_id"],
        additionalProperties: false,
      },
    },
  ],
} as const;

export type StudioToolsDeps = {
  get: () => StudioSnapshot;
  openImageAt: (i: number) => Promise<string | null>;
  openImageById: (id: string) => Promise<string | null>;
  openNextUncommitted: () => Promise<string | null>;
  /** Persist objects on current doc (optimistic local, awaited network). */
  saveObjects: (objects: AnnObj[]) => Promise<boolean>;
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
  createAugmentationJob: (body: AugmentationRequest) => Promise<AugmentationJob>;
  listAugmentationJobs: (offset?: number, limit?: number) => Promise<AugmentationJobPage>;
  getAugmentationJob: (
    jobId: string,
    itemOffset?: number,
    itemLimit?: number,
  ) => Promise<AugmentationJob>;
  refreshCatalog: () => Promise<void>;
  cancelAugmentationJob: (jobId: string) => Promise<AugmentationJob>;
  retryAugmentationJob: (jobId: string) => Promise<AugmentationJob>;
};

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
  const { list, pageOffset, total, index, doc } = snap;
  if (!total) return null;
  const i = Math.min(Math.max(0, index), total - 1);
  const row = list[i - pageOffset];
  if (!row) return null;
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
    auto_label_status: docReady ? snap.autoLabelStatus : null,
  };
}

function studioPayload(snap: StudioSnapshot, augmentationJobs: AugmentationJobPage["status_counts"] | null) {
  const p = snap.project;
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
      n: snap.total,
      committed: snap.committedCount,
      empty: snap.emptyCount,
    },
    image_page: {
      offset: snap.pageOffset,
      total: snap.total,
      has_more: snap.pageOffset + snap.list.length < snap.total,
      items: snap.list.map((row, localIndex) => ({
        id: row.id,
        filename: row.filename,
        index: snap.pageOffset + localIndex,
        committed: Boolean(row.committed),
        empty: Boolean(row.empty),
      })),
    },
    current: currentSummary(snap),
    augmentation_jobs: augmentationJobs,
    export_url: `/api/projects/${snap.projectId}/export`,
  };
}

function boundedInt(value: unknown, fallback: number, minimum: number, maximum: number) {
  if (value === undefined || value === null) return fallback;
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function jobId(args: Record<string, unknown>) {
  return String(args.job_id ?? "").trim();
}

async function safeJobCall<T>(action: () => Promise<T>, error: string) {
  try {
    return await action();
  } catch (cause) {
    if (cause instanceof ApiError) {
      const reason =
        cause.status === 401
          ? "auth_required"
          : cause.status === 404
            ? "not_found_or_not_owned"
            : cause.status === 409
              ? "job_state_conflict"
              : cause.status === 422
                ? "invalid_request"
                : cause.status === 429
                  ? "rate_limited"
                  : cause.status >= 500
                    ? "service_unavailable"
                    : "request_failed";
      return { error, status: cause.status, reason };
    }
    return { error, reason: "network_or_service_error" };
  }
}

function inapplicable(args: Record<string, unknown>, keys: readonly string[]) {
  const present = keys.filter((key) => args[key] !== undefined).sort();
  return present.length ? { error: "inapplicable_arguments", keys: present } : null;
}

function validSources(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((id) => typeof id === "string" && id.trim().length > 0) &&
    new Set(value).size === value.length
  );
}

const NUMBER_RANGES: Record<string, [number, number, boolean?]> = {
  probability: [0, 1],
  rotate_degrees: [-360, 360],
  translate_x: [-1, 1],
  translate_y: [-1, 1],
  scale: [0, 10, true],
  shear_degrees: [-89, 89],
  x: [0, 1],
  y: [0, 1],
  width: [0, 1, true],
  height: [0, 1, true],
  brightness: [0, 4],
  contrast: [0, 4],
  hue_degrees: [-180, 180],
  saturation: [0, 4],
  radius: [0, 100],
  sigma: [0, 255],
  quality: [1, 100],
};

const OP_FIELDS: Record<string, readonly string[]> = {
  flip: ["axis", "probability"],
  affine: ["rotate_degrees", "translate_x", "translate_y", "scale", "shear_degrees", "probability"],
  crop_resize: ["x", "y", "width", "height", "probability"],
  brightness_contrast: ["brightness", "contrast", "probability"],
  hue_saturation: ["hue_degrees", "saturation", "probability"],
  blur: ["radius", "probability"],
  noise: ["sigma", "probability"],
  compression: ["quality", "probability"],
};

function invalidPipeline(value: unknown) {
  if (!Array.isArray(value) || !value.length) return { error: "bad_pipeline" };
  for (const [operation_index, valueAtIndex] of value.entries()) {
    if (!valueAtIndex || typeof valueAtIndex !== "object" || Array.isArray(valueAtIndex)) {
      return { error: "bad_pipeline", operation_index, field: "op" };
    }
    const operation = valueAtIndex as Record<string, unknown>;
    const op = typeof operation.op === "string" ? operation.op : "";
    const fields = OP_FIELDS[op];
    if (!fields) return { error: "bad_pipeline", operation_index, field: "op" };
    const unexpected = Object.keys(operation)
      .filter((field) => field !== "op" && !fields.includes(field))
      .sort()[0];
    if (unexpected) return { error: "bad_pipeline", operation_index, field: unexpected };
    if (op === "flip" && operation.axis !== undefined && !["horizontal", "vertical"].includes(String(operation.axis))) {
      return { error: "bad_pipeline", operation_index, field: "axis" };
    }
    for (const field of fields) {
      if (field === "axis" || operation[field] === undefined) continue;
      const number = operation[field];
      const range = NUMBER_RANGES[field];
      if (
        typeof number !== "number" ||
        !Number.isFinite(number) ||
        number < range[0] ||
        number > range[1] ||
        (range[2] && number === range[0]) ||
        (op === "compression" && field === "quality" && !Number.isInteger(number))
      ) {
        return { error: "bad_pipeline", operation_index, field };
      }
    }
    if (op === "crop_resize") {
      const x = typeof operation.x === "number" ? operation.x : 0;
      const y = typeof operation.y === "number" ? operation.y : 0;
      const width = typeof operation.width === "number" ? operation.width : 1;
      const height = typeof operation.height === "number" ? operation.height : 1;
      if (x + width > 1) return { error: "bad_pipeline", operation_index, field: "width" };
      if (y + height > 1) return { error: "bad_pipeline", operation_index, field: "height" };
    }
  }
  return null;
}

function validateAugmentationArgs(args: Record<string, unknown>) {
  const mode = args.mode;
  if (!["transform", "text_to_image", "image_edit"].includes(String(mode))) {
    return { error: "bad_mode" };
  }
  if (mode === "transform") {
    const extra = inapplicable(args, ["count", "prompt", "aspect_ratio", "resolution", "quality", "output_format"]);
    if (extra) return extra;
    if (!validSources(args.source_image_ids)) return { error: "bad_source_image_ids" };
    if (!Number.isInteger(args.variants_per_source) || Number(args.variants_per_source) < 1) {
      return { error: "bad_variants_per_source" };
    }
    if (!Number.isInteger(args.seed)) return { error: "bad_seed" };
    return invalidPipeline(args.pipeline);
  }

  const extra = inapplicable(
    args,
    mode === "text_to_image"
      ? ["source_image_ids", "variants_per_source", "seed", "pipeline"]
      : ["count", "seed", "pipeline"],
  );
  if (extra) return extra;
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (!prompt || prompt.length > 32000) return { error: "bad_prompt" };
  if (mode === "text_to_image") {
    if (!Number.isInteger(args.count) || Number(args.count) < 1) return { error: "bad_count" };
  } else {
    if (!validSources(args.source_image_ids)) return { error: "bad_source_image_ids" };
    if (!Number.isInteger(args.variants_per_source) || Number(args.variants_per_source) < 1) {
      return { error: "bad_variants_per_source" };
    }
  }
  const options = {
    aspect_ratio: ["1:1", "3:2", "2:3", "16:9", "9:16"],
    resolution: ["1k", "2k", "4k"],
    quality: ["low", "medium", "high"],
    output_format: ["png", "jpeg", "webp"],
  } as const;
  for (const [field, allowed] of Object.entries(options)) {
    if (args[field] !== undefined && !(allowed as readonly unknown[]).includes(args[field])) {
      return { error: "bad_image_option", field };
    }
  }
  return null;
}

function jobMutationSummary(job: AugmentationJob) {
  const { items, ...summary } = job;
  return {
    ...summary,
    items_omitted: items?.length ?? 0,
    inspect_with: { tool: "get_augmentation_job", arguments: { job_id: job.id } },
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
  const refreshedOutputCounts = new Map<string, number>();
  const schemas = STUDIO_TOOL_SCHEMAS.tools;
  return [
    {
      ...schemas[0],
      execute: async () => studioGuidePayload(deps.get()),
    },
    {
      ...schemas[1],
      execute: async () => {
        let counts: AugmentationJobPage["status_counts"] | null = null;
        try {
          counts = (await deps.listAugmentationJobs(0, 1)).status_counts;
        } catch {
          // The labeling snapshot remains useful during a transient jobs API failure.
        }
        return studioPayload(deps.get(), counts);
      },
    },
    {
      ...schemas[2],
      execute: async (args) => {
        const sel = pickOneSelector(args);
        if (!sel.ok) return { error: sel.error };
        const snap = deps.get();
        if (!snap.total) return { error: "no_images" };

        let imageId: string | null;
        if (sel.kind === "index") {
          if (sel.index! >= snap.total) return { error: "index_out_of_range" };
          imageId = await deps.openImageAt(sel.index!);
        } else if (sel.kind === "id") {
          imageId = await deps.openImageById(sel.id!);
          if (!imageId) return { error: "not_found" };
        } else {
          imageId = await deps.openNextUncommitted();
          if (!imageId) return { error: "no_uncommitted" };
        }
        if (!imageId) return { error: "image_load_failed" };
        if (deps.waitForImage && !(await deps.waitForImage(imageId, 2500))) {
          return { error: "image_load_timeout", image_id: imageId };
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
          !(await deps.saveObjects(
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
        if (!oid) return { error: "bad_object_id" };
        if (!snap.doc.objects.some((o) => o.id === oid)) return { error: "not_found" };
        if (!(await deps.saveObjects(snap.doc.objects.filter((o) => o.id !== oid)))) {
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
        const hasImageId = args.image_id !== undefined && args.image_id !== null;
        const iid = typeof args.image_id === "string" ? args.image_id.trim() : "";
        if (hasImageId && !iid) return { error: "bad_image_id" };
        const res = await deps.listComments();
        if (!res.ok) return { error: res.error };
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
          const doc = deps.get().doc;
          if (!doc) return { error: "no_image" };
          if (!(doc.comments ?? []).some((comment) => comment.id === cid)) {
            return { error: "not_found" };
          }
          const res = await deps.deleteComment(cid);
          if (!res.ok) return { error: res.error };
          return { comments: currentSummary(deps.get())?.comments ?? [] };
        }
        return { error: "bad_op" };
      },
    },
    {
      ...schemas[9],
      execute: async (args) => {
        const invalid = validateAugmentationArgs(args);
        if (invalid) return invalid;
        return safeJobCall(
          async () => jobMutationSummary(await deps.createAugmentationJob(args as unknown as AugmentationRequest)),
          "augmentation_create_failed",
        );
      },
    },
    {
      ...schemas[10],
      execute: async (args) => {
        const offset = boundedInt(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);
        const limit = boundedInt(args.limit, 50, 1, 100);
        if (offset === null || limit === null) return { error: "bad_pagination" };
        return safeJobCall(
          () => deps.listAugmentationJobs(offset, limit),
          "augmentation_list_failed",
        );
      },
    },
    {
      ...schemas[11],
      execute: async (args) => {
        const id = jobId(args);
        if (!id) return { error: "bad_job_id" };
        const offset = boundedInt(args.item_offset, 0, 0, Number.MAX_SAFE_INTEGER);
        const limit = boundedInt(args.item_limit, 100, 1, 200);
        if (offset === null || limit === null) return { error: "bad_pagination" };
        return safeJobCall(async () => {
          const job = await deps.getAugmentationJob(id, offset, limit);
          const refreshed = refreshedOutputCounts.get(job.id) ?? 0;
          if (job.progress.succeeded > refreshed) {
            await deps.refreshCatalog();
            refreshedOutputCounts.set(job.id, job.progress.succeeded);
          }
          return job;
        }, "augmentation_get_failed");
      },
    },
    {
      ...schemas[12],
      execute: async (args) => {
        const id = jobId(args);
        if (!id) return { error: "bad_job_id" };
        return safeJobCall(
          async () => jobMutationSummary(await deps.cancelAugmentationJob(id)),
          "augmentation_cancel_failed",
        );
      },
    },
    {
      ...schemas[13],
      execute: async (args) => {
        const id = jobId(args);
        if (!id) return { error: "bad_job_id" };
        return safeJobCall(
          async () => jobMutationSummary(await deps.retryAugmentationJob(id)),
          "augmentation_retry_failed",
        );
      },
    },
  ];
}
