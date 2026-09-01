import type { KeypointTemplate, Project, ProjectType } from "./doc";

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
  const r = await fetch("/api/projects");
  if (r.status === 401) return { ok: false, error: "auth_required" };
  if (!r.ok) return { ok: false, error: "list_failed", status: r.status };
  const data = await r.json();
  return { ok: true, projects: Array.isArray(data) ? (data as Project[]) : [] };
}

export async function createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
  const r = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      type: input.type,
      ...(input.type === "keypoints" && input.template ? { template: input.template } : {}),
    }),
    signal: input.signal,
  });
  if (r.status === 401) return { ok: false, error: "auth_required" };
  const p = await r.json().catch(() => ({}));
  if (r.status === 409) return { ok: false, error: "name_taken" };
  if (!r.ok || !p?.id) {
    return { ok: false, error: "create_failed", status: r.status, detail: (p as { detail?: unknown }).detail };
  }
  return { ok: true, project: p as Project };
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
