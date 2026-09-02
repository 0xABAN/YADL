import { api, apiResult } from "@/shared/api/client";
import { readComments } from "./geometry/comment";
import { readObjects, writeObjects, type AnnObj, type Doc, type Project } from "./geometry/doc";
import type { ImagePage, ImgRow } from "./session/types";

export function parseDoc(d: Record<string, unknown>): Doc {
  const objects = readObjects(d.objects);
  return {
    id: String(d.id),
    image: String(d.image ?? ""),
    url: (d.url as string | null) ?? null,
    committed: Boolean(d.committed),
    generated: Boolean(d.generated),
    history: Array.isArray(d.history)
      ? (d.history as Doc["history"])?.map((h) => ({
          ...h,
          objects: readObjects(h.objects),
        }))
      : [],
    comments: readComments(d.comments),
    objects,
  };
}

export async function fetchProject(id: string): Promise<Project> {
  return api<Project>(`/projects/${id}`);
}

export async function fetchImages(id: string, offset = 0, limit = 100): Promise<ImagePage> {
  const value = await api<unknown>(`/projects/${id}/images?offset=${offset}&limit=${limit}`);
  // Transitional normalization keeps local mocks and older backends usable during deploys.
  if (Array.isArray(value)) {
    const items = value as ImgRow[];
    return {
      items,
      total: items.length,
      committed: items.filter((x) => x.committed).length,
      empty: items.filter((x) => x.empty).length,
      offset: 0,
      limit,
    };
  }
  if (!value || typeof value !== "object" || !("items" in value)) throw new Error("images");
  return value as ImagePage;
}

export async function locateImage(projectId: string, imageId: string) {
  return api<{ index: number; item: ImgRow }>(
    `/projects/${projectId}/images/locate?image_id=${encodeURIComponent(imageId)}`,
  );
}

export async function nextUncommittedImage(projectId: string, afterIndex: number) {
  return apiResult<{ index: number; item: ImgRow }>(
    `/projects/${projectId}/images/next-uncommitted?after_index=${afterIndex}`,
  );
}

export async function fetchImage(projectId: string, imageId: string): Promise<Doc> {
  const d = await api<Record<string, unknown>>(`/projects/${projectId}/images/${imageId}`);
  return parseDoc(d);
}

export async function putImage(projectId: string, doc: Doc, objects: AnnObj[]): Promise<void> {
  await api(`/projects/${projectId}/images/${doc.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...doc, objects: writeObjects(objects) }),
  });
}

export async function postAssist(
  projectId: string,
  imageId: string,
  force = false,
  signal?: AbortSignal,
): Promise<Doc> {
  const q = force ? "?force=true" : "";
  const d = await api<Record<string, unknown>>(
    `/projects/${projectId}/images/${imageId}/assist${q}`,
    { method: "POST", signal },
  );
  return parseDoc(d);
}

export async function postCommit(
  projectId: string,
  imageId: string,
): Promise<{ history?: Doc["history"] }> {
  const body = await api<Record<string, unknown>>(`/projects/${projectId}/images/${imageId}/commit`, {
    method: "POST",
  });
  const history = Array.isArray(body.history)
    ? body.history.map((h: { id: string; objects: unknown; at?: string }) => ({
        id: h.id,
        at: h.at,
        objects: readObjects(h.objects),
      }))
    : undefined;
  return { history };
}

export async function deleteImage(projectId: string, imageId: string): Promise<boolean> {
  const r = await apiResult(`/projects/${projectId}/images/${imageId}`, {
    method: "DELETE",
    raw: true,
    noAuthRedirect: true,
  });
  if (!r.ok) {
    if (r.status === 401) {
      location.assign(new URL("/auth", location.origin).href);
      return false;
    }
    return false;
  }
  return true;
}

export async function restoreImage(projectId: string, imageId: string): Promise<ImgRow | null> {
  try {
    return await api<ImgRow>(`/projects/${projectId}/images/${imageId}/restore`, { method: "POST" });
  } catch {
    return null;
  }
}

export async function postClass(projectId: string, name: string): Promise<Project | null> {
  try {
    return await api<Project>(`/projects/${projectId}/classes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  } catch {
    return null;
  }
}

export async function patchClass(
  projectId: string,
  oldName: string,
  newName: string,
): Promise<Project | null> {
  try {
    return await api<Project>(`/projects/${projectId}/classes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old: oldName, new: newName }),
    });
  } catch {
    return null;
  }
}

export async function deleteClass(projectId: string, name: string): Promise<Project | null> {
  try {
    return await api<Project>(`/projects/${projectId}/classes`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  } catch {
    return null;
  }
}

export type ProjectCommentRow = {
  id: string;
  filename: string;
  index: number;
  comments: { id: string; body: string; at?: string | null; mentions?: string[] }[];
};

/** All comments across the project filmstrip (one request). */
export async function fetchProjectComments(projectId: string): Promise<ProjectCommentRow[]> {
  const body = await api<{ images?: ProjectCommentRow[] }>(`/projects/${projectId}/comments`);
  return Array.isArray(body.images) ? body.images : [];
}

export async function postComment(projectId: string, imageId: string, body: string): Promise<Doc> {
  const d = await api<Record<string, unknown>>(`/projects/${projectId}/images/${imageId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  return parseDoc(d);
}

export async function deleteComment(
  projectId: string,
  imageId: string,
  commentId: string,
): Promise<Doc> {
  const d = await api<Record<string, unknown>>(
    `/projects/${projectId}/images/${imageId}/comments/${commentId}`,
    { method: "DELETE" },
  );
  return parseDoc(d);
}

export function exportUrl(projectId: string) {
  return `/api/projects/${projectId}/export`;
}

export function imagesUploadUrl(projectId: string) {
  return `/api/projects/${projectId}/images`;
}

export type AugmentationMode = "transform" | "text_to_image" | "image_edit";
export type AugmentationStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "partially_succeeded"
  | "failed"
  | "cancelled";

export type TransformOperation =
  | { op: "flip"; axis: "horizontal" | "vertical"; probability?: number }
  | {
      op: "affine";
      rotate_degrees?: number;
      translate_x?: number;
      translate_y?: number;
      scale?: number;
      shear_degrees?: number;
      probability?: number;
    }
  | { op: "crop_resize"; x?: number; y?: number; width?: number; height?: number; probability?: number }
  | { op: "brightness_contrast"; brightness?: number; contrast?: number; probability?: number }
  | { op: "hue_saturation"; hue_degrees?: number; saturation?: number; probability?: number }
  | { op: "blur"; radius?: number; probability?: number }
  | { op: "noise"; sigma?: number; probability?: number }
  | { op: "compression"; quality?: number; probability?: number };

export type WaveOptions = {
  prompt: string;
  aspect_ratio?: "1:1" | "3:2" | "2:3" | "16:9" | "9:16";
  resolution?: "1k" | "2k" | "4k";
  quality?: "low" | "medium" | "high";
  output_format?: "png" | "jpeg" | "webp";
};

export type AugmentationRequest =
  | {
      mode: "transform";
      source_image_ids: string[];
      variants_per_source: number;
      seed: number;
      pipeline: TransformOperation[];
    }
  | ({ mode: "text_to_image"; count: number } & WaveOptions)
  | ({ mode: "image_edit"; source_image_ids: string[]; variants_per_source: number } & WaveOptions);

export type AugmentationProgress = {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  submission_unknown: number;
};

export type AugmentationItem = {
  id: string;
  ordinal: number;
  source_image_id: string | null;
  status: string;
  attempts: number;
  error: string | null;
  provider_prediction_id: string | null;
  output_image_id: string | null;
};

export type AugmentationJob = {
  id: string;
  project_id: string;
  mode: AugmentationMode;
  config: Record<string, unknown>;
  status: AugmentationStatus;
  requested_count: number;
  progress: AugmentationProgress;
  cancel_requested: boolean;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  items?: AugmentationItem[];
  item_offset?: number;
  item_limit?: number;
  warning?: string;
};

export type AugmentationJobCounts = {
  active: number;
  succeeded: number;
  partially_succeeded: number;
  failed: number;
};

export type AugmentationJobPage = {
  items: AugmentationJob[];
  total: number;
  offset: number;
  limit: number;
  status_counts: AugmentationJobCounts;
};

export async function createAugmentationJob(projectId: string, body: AugmentationRequest) {
  return api<AugmentationJob>(`/projects/${projectId}/augmentation-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchAugmentationJobs(projectId: string, offset = 0, limit = 50) {
  return api<AugmentationJobPage>(
    `/projects/${projectId}/augmentation-jobs?offset=${offset}&limit=${limit}`,
  );
}

export async function fetchAugmentationJob(
  projectId: string,
  jobId: string,
  itemOffset = 0,
  itemLimit = 100,
) {
  return api<AugmentationJob>(
    `/projects/${projectId}/augmentation-jobs/${jobId}?item_offset=${itemOffset}&item_limit=${itemLimit}`,
  );
}

export async function cancelAugmentationJob(projectId: string, jobId: string) {
  return api<AugmentationJob>(`/projects/${projectId}/augmentation-jobs/${jobId}/cancel`, {
    method: "POST",
  });
}

export async function retryAugmentationJob(projectId: string, jobId: string) {
  return api<AugmentationJob>(`/projects/${projectId}/augmentation-jobs/${jobId}/retry`, {
    method: "POST",
  });
}
