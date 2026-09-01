import type { Project } from "./doc";
import type { WebMcpTool } from "./webmcp";
import { createProject, fetchProjects, parseProjectType, parseTemplate } from "./projectsApi";
import { studioPath, uploadPath } from "./projectRoutes";

/** Schema-only export for webmcp-evals (keep in sync with tools below). */
export const CREATE_TOOL_SCHEMAS = {
  tools: [
    {
      name: "list_projects",
      description: "List the user's recent YADL projects (id, name, type, template).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "create_project",
      description:
        "Create a labeling project. type is boxes, polygons, or keypoints. For keypoints, pass template hand|pose|face (default hand). Does not upload — returns upload_url for computer use (Select files → Upload).",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Project name" },
          type: {
            type: "string",
            enum: ["boxes", "polygons", "keypoints"],
            description: "Annotation type",
          },
          template: {
            type: "string",
            enum: ["hand", "pose", "face"],
            description: "Keypoint skeleton when type=keypoints",
          },
        },
        required: ["name", "type"],
        additionalProperties: false,
      },
    },
    {
      name: "open_project",
      description: "Open a project studio by id or exact name.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  ],
} as const;

export type CreateToolsDeps = {
  router: { push: (href: string) => void };
  /** Cached Recent list (optional fast path). */
  getRows: () => Project[];
  onCreated?: (p: Project) => void;
};

export function createPageTools(deps: CreateToolsDeps): WebMcpTool[] {
  const schemas = CREATE_TOOL_SCHEMAS.tools;
  return [
    {
      ...schemas[0],
      execute: async () => {
        const cached = deps.getRows();
        if (cached.length) return { projects: cached };
        const list = await fetchProjects();
        if (!list.ok) return { error: list.error, status: list.status };
        return { projects: list.projects };
      },
    },
    {
      ...schemas[1],
      execute: async (args) => {
        const n = String(args.name ?? "").trim();
        const t = parseProjectType(args.type);
        if (!n) return { error: "empty_name" };
        if (!t) return { error: "bad_type" };
        const tmpl = t === "keypoints" ? parseTemplate(args.template) ?? "hand" : undefined;
        if (deps.getRows().some((p) => p.name === n)) return { error: "name_taken" };
        const res = await createProject({ name: n, type: t, template: tmpl });
        if (!res.ok) return { error: res.error, status: res.status, detail: res.detail };
        deps.onCreated?.(res.project);
        const id = res.project.id;
        return {
          project: res.project,
          upload_url: uploadPath({ id }),
          studio_url: studioPath(id),
        };
      },
    },
    {
      ...schemas[2],
      execute: async (args) => {
        let id = typeof args.id === "string" ? args.id.trim() : "";
        if (!id && typeof args.name === "string") {
          const want = args.name.trim();
          const hit = deps.getRows().find((p) => p.name === want);
          if (hit) id = hit.id;
          else {
            const list = await fetchProjects();
            if (list.ok) id = list.projects.find((p) => p.name === want)?.id ?? "";
          }
        }
        if (!id) return { error: "not_found" };
        deps.router.push(studioPath(id));
        return { opened: id, studio_url: studioPath(id) };
      },
    },
  ];
}
