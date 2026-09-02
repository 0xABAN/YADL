import { api, apiResult } from "@/shared/api/client";
import { readComments } from "./geometry/comment";
import { readObjects, writeObjects, type AnnObj, type Doc, type Project } from "./geometry/doc";
import type { ImgRow } from "./session/types";

export function parseDoc(d: Record<string, unknown>): Doc {
  const objects = readObjects(d.objects);
  return {
    id: String(d.id),
    image: String(d.image ?? ""),
    url: (d.url as string | null) ?? null,
    committed: Boolean(d.committed),
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

export async function fetchImages(id: string): Promise<ImgRow[]> {
  const imgs = await api<unknown>(`/projects/${id}/images`);
  if (!Array.isArray(imgs)) throw new Error("images");
  return imgs as ImgRow[];
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
