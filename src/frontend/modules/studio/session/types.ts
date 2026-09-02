import type { Comment } from "../geometry/comment";
import type { AnnObj, Doc, Project, ToolId } from "../geometry/doc";

export type ImgRow = { id: string; filename: string; committed?: boolean; empty?: boolean };

export type ImagePage = {
  items: ImgRow[];
  total: number;
  committed: number;
  empty: number;
  offset: number;
  limit: number;
};

export type LoadState = "loading" | "ready" | "error";
export type AutoLabelStatus = "completed" | "no_detection" | "failed";

export type ToastUndo =
  | { kind: "objects"; objects: AnnObj[] }
  | { kind: "image"; id: string; index: number };

export type StudioState = {
  projectId: string;
  project: Project | null;
  list: ImgRow[];
  pageOffset: number;
  pageLimit: number;
  total: number;
  committedCount: number;
  emptyCount: number;
  index: number;
  doc: Doc | null;
  selected: string | null;
  /** Selection mirrored into the URL; agent-only writes leave this stable. */
  urlSelected: string | null;
  tab: "labels" | "objects";
  tool: ToolId | undefined;
  loadState: LoadState;
  assistOn: boolean;
  assistBusy: boolean;
  autoLabelStatus: AutoLabelStatus | null;
  autoLabelResults: ReadonlyMap<string, AutoLabelStatus>;
  /** image ids already auto-assisted this session */
  assistedIds: ReadonlySet<string>;
  uploadOpen: boolean;
  uploadBusy: boolean;
  uploadErr: string | null;
  toast: string | null;
  toastOut: boolean;
  toastUndo: ToastUndo | null;
  agentToast: string | null;
  agentToastOut: boolean;
  edit: string | null;
  draft: string;
  histOpen: boolean;
  histPos: { x: number; y: number } | null;
  commentsOpen: boolean;
  commentsPos: { x: number; y: number } | null;
  commentsSide: boolean;
  synthOpen: boolean;
  synthPos: { x: number; y: number } | null;
  tip: { x: number; y: number; text: string } | null;
};

/** Snapshot shape shared with WebMCP tool packs. */
export type StudioSnapshot = {
  projectId: string;
  project: Project | null;
  list: ImgRow[];
  pageOffset: number;
  total: number;
  committedCount: number;
  emptyCount: number;
  index: number;
  doc: Doc | null;
  autoLabelStatus: AutoLabelStatus | null;
};

export type CommitResult =
  | { ok: true; advanced: boolean }
  | { ok: false; error: "cannot_commit" | "no_image"; reason?: string };

export type DeleteImageResult =
  | { ok: true; deleted_id: string }
  | { ok: false; error: "no_image" | "delete_failed" };

export type OkErr = { ok: true } | { ok: false; error: string };

export type { AnnObj, Doc, Project, ToolId, Comment };
