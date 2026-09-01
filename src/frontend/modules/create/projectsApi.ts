import { apiResult } from "@/shared/api/client";
import type { KeypointTemplate, Project, ProjectType } from "@/modules/studio/geometry/doc";

export type CreateProjectInput = {
  name: string;
  type: ProjectType;
  template?: KeypointTemplate;
  signal?: AbortSignal;
};

export type CreateProjectResult =
  | { ok: true; project: Project }
  | { ok: false; error: "name_taken" | "create_failed" | "auth_required"; status?: number; detail?: unknown };

export async function fetchProjects(): Promise<
  { ok: true; projects: Project[] } | { ok: false; error: "auth_required" | "list_failed"; status?: number }
> {
  const r = await apiResult<Project[]>("/projects", { noAuthRedirect: true });
  if (!r.ok) {
    if (r.status === 401) return { ok: false, error: "auth_required", status: 401 };
    return { ok: false, error: "list_failed", status: r.status };
  }
  return { ok: true, projects: Array.isArray(r.data) ? r.data : [] };
}

export async function createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
  const r = await apiResult<Project>("/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      type: input.type,
      ...(input.type === "keypoints" && input.template ? { template: input.template } : {}),
    }),
    signal: input.signal,
    noAuthRedirect: true,
  });
  if (!r.ok) {
    if (r.status === 401) return { ok: false, error: "auth_required" };
    if (r.status === 409) return { ok: false, error: "name_taken" };
    return {
      ok: false,
      error: "create_failed",
      status: r.status,
      detail: (r.data as { detail?: unknown } | undefined)?.detail,
    };
  }
  if (!r.data?.id) return { ok: false, error: "create_failed" };
  return { ok: true, project: r.data };
}

export function parseProjectType(v: unknown): ProjectType | null {
  if (v === "hands") return "keypoints"; // legacy
  if (v === "boxes" || v === "polygons" || v === "keypoints") return v;
  return null;
}

export function parseTemplate(v: unknown): KeypointTemplate | null {
  if (v === "hand" || v === "pose" || v === "face") return v;
  return null;
}
