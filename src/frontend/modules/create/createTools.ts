import type { Project } from "@/modules/studio/geometry/doc";
import type { WebMcpTool } from "@/shared/webmcp";
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
        "Create a labeling project. type is boxes, polygons, or keypoints. For keypoints, pass template hand|pose|face (default hand). Returns upload_url for the required next step; media upload is human UI, not WebMCP.",
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
        oneOf: [
          {
            properties: { type: { enum: ["boxes", "polygons"] } },
            not: { required: ["template"] },
          },
          { properties: { type: { const: "keypoints" } } },
        ],
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
        oneOf: [
          { required: ["id"] },
          { required: ["name"] },
        ],
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
        if (t !== "keypoints" && args.template !== undefined) {
          return { error: "template_not_applicable" };
        }
        const parsedTemplate = parseTemplate(args.template);
        if (t === "keypoints" && args.template !== undefined && !parsedTemplate) {
          return { error: "bad_template" };
        }
        const tmpl = t === "keypoints" ? parsedTemplate ?? "hand" : undefined;
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
        const id = typeof args.id === "string" ? args.id.trim() : "";
        const name = typeof args.name === "string" ? args.name.trim() : "";
        if (Boolean(id) === Boolean(name)) return { error: "choose_one_identifier" };

        const match = (projects: Project[]) =>
          id ? projects.find((p) => p.id === id) : projects.find((p) => p.name === name);
        let hit = match(deps.getRows());
        if (!hit) {
          const list = await fetchProjects();
          if (!list.ok) return { error: list.error, status: list.status };
          hit = match(list.projects);
        }
        if (!hit) return { error: "not_found" };

        const path = studioPath(hit.id);
        deps.router.push(path);
        return { opened: hit.id, studio_url: path };
      },
    },
  ];
}
