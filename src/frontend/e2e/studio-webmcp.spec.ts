import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RIG_TOOL_SCHEMAS } from "../modules/studio/tools/rigTools";
import { STUDIO_TOOL_SCHEMAS } from "../modules/studio/tools/studioTools";

type RegisteredTool = {
  name: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => unknown;
};

const PID = "p_webmcp";
const IID = "img_webmcp";
const landmarks = Array.from({ length: 21 }, (_, i) => ({
  x: 0.3 + (i % 5) * 0.05,
  y: 0.35 + Math.floor(i / 5) * 0.06,
  z: 0,
}));

function hand(rig: unknown, id = "hand-1") {
  return {
    id,
    kind: "hand",
    label: null,
    edited: false,
    geom: {
      t: "hand",
      handedness: "Right",
      landmarks,
      ...(rig === undefined ? {} : { rig }),
    },
  };
}

async function installWebMcpHost(page: Page) {
  await page.addInitScript(() => {
    const tools = new Map<string, RegisteredTool>();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: RegisteredTool, opts?: { signal?: AbortSignal }) {
          tools.set(tool.name, tool);
          opts?.signal?.addEventListener("abort", () => tools.delete(tool.name), { once: true });
        },
      },
    });
    Object.assign(window, {
      __webMcpCall: (name: string, args: Record<string, unknown> = {}) => tools.get(name)?.execute(args),
      __webMcpSchema: (name: string) => tools.get(name)?.inputSchema,
      __webMcpNames: () => [...tools.keys()],
    });
  });
}

async function mockStudio(
  page: Page,
  initialObjects: unknown[],
  options: { failNextSave?: boolean; failClasses?: boolean } = {},
) {
  let objects = initialObjects;
  let failNextSave = options.failNextSave ?? false;
  let comments: { id: string; body: string; at: string }[] = [];
  const imageDoc = () => ({
    id: IID,
    image: "hand.jpg",
    url: "/default.jpg",
    committed: false,
    objects,
    comments,
    history: [],
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const method = request.method();
    if (path === `/projects/${PID}` && method === "GET") {
      return route.fulfill({
        json: { id: PID, name: "WebMCP rig", type: "keypoints", template: "hand", classes: [] },
      });
    }
    if (path === `/projects/${PID}/images` && method === "GET") {
      return route.fulfill({ json: [{ id: IID, filename: "hand.jpg", committed: false, empty: false }] });
    }
    if (path === `/projects/${PID}/images/${IID}` && method === "GET") {
      return route.fulfill({ json: imageDoc() });
    }
    if (path === `/projects/${PID}/images/${IID}` && method === "PUT") {
      if (failNextSave) {
        failNextSave = false;
        return route.fulfill({ status: 500, json: { detail: "forced save failure" } });
      }
      objects = (request.postDataJSON() as { objects: unknown[] }).objects;
      return route.fulfill({ json: { ok: true } });
    }
    if (path === `/projects/${PID}/classes` && method === "POST") {
      if (options.failClasses) {
        return route.fulfill({ status: 500, json: { detail: "forced class failure" } });
      }
      return route.fulfill({
        json: { id: PID, name: "WebMCP rig", type: "keypoints", template: "hand", classes: [] },
      });
    }
    if (path === `/projects/${PID}/comments` && method === "GET") {
      return route.fulfill({
        json: {
          images: [{ id: IID, filename: "hand.jpg", index: 0, comments }],
        },
      });
    }
    if (path === `/projects/${PID}/images/${IID}/comments` && method === "POST") {
      const body = String((request.postDataJSON() as { body?: unknown }).body ?? "");
      comments = [{ id: "comment-1", body, at: "2026-09-02T12:00:00Z" }, ...comments];
      return route.fulfill({ json: imageDoc() });
    }
    if (path.startsWith(`/projects/${PID}/images/${IID}/comments/`) && method === "DELETE") {
      const id = path.split("/").at(-1);
      comments = comments.filter((comment) => comment.id !== id);
      return route.fulfill({ json: imageDoc() });
    }
    return route.fulfill({ status: 404, body: `unmocked ${method} ${path}` });
  });
}

async function callTool(page: Page, name: string, args: Record<string, unknown> = {}) {
  return page.evaluate(
    ({ toolName, input }) => {
      const host = window as typeof window & {
        __webMcpCall?: (name: string, args: Record<string, unknown>) => unknown;
      };
      return host.__webMcpCall?.(toolName, input);
    },
    { toolName: name, input: args },
  );
}

async function openStudio(
  page: Page,
  initialObjects: unknown[],
  options: { failNextSave?: boolean; failClasses?: boolean } = {},
) {
  await installWebMcpHost(page);
  await mockStudio(page, initialObjects, options);
  await page.goto(`/studio/${PID}`);
  await expect(page.locator(".world img")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => {
    const host = window as typeof window & { __webMcpNames?: () => string[] };
    return host.__webMcpNames?.().includes("add_instance") ?? false;
  })).toBe(true);
  if (initialObjects.length) {
    await expect(page).toHaveURL(/[?&]obj=/);
  }
}

async function openTwoImageStudio(page: Page, secondDelayMs: number) {
  await installWebMcpHost(page);
  const rig = { root: { x: 0.5, y: 0.5, scale: 0.22, roll: 0 }, joints: {} };
  const docs = {
    "image-1": { ...hand(rig, "hand-1"), label: "first" },
    "image-2": { ...hand(rig, "hand-2"), label: "second" },
  };
  let deletedFirst = false;
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const method = request.method();
    if (path === `/projects/${PID}` && method === "GET") {
      return route.fulfill({
        json: { id: PID, name: "WebMCP navigation", type: "keypoints", template: "hand", classes: ["first", "second"] },
      });
    }
    if (path === `/projects/${PID}/images` && method === "GET") {
      const images = [
        { id: "image-1", filename: "first.jpg", committed: false, empty: false },
        { id: "image-2", filename: "second.jpg", committed: false, empty: false },
      ];
      return route.fulfill({ json: deletedFirst ? images.slice(1) : images });
    }
    const match = path.match(new RegExp(`^/projects/${PID}/images/(image-[12])$`));
    if (match && method === "GET") {
      if (match[1] === "image-2" && secondDelayMs) await new Promise((resolve) => setTimeout(resolve, secondDelayMs));
      return route.fulfill({
        json: {
          id: match[1],
          image: `${match[1]}.jpg`,
          url: "/default.jpg",
          committed: false,
          objects: [docs[match[1] as keyof typeof docs]],
          comments: [],
          history: [],
        },
      });
    }
    if (path === `/projects/${PID}/images/image-1/commit` && method === "POST") {
      return route.fulfill({ json: { history: [] } });
    }
    if (path === `/projects/${PID}/images/image-1` && method === "DELETE") {
      deletedFirst = true;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, body: `unmocked ${method} ${path}` });
  });
  await page.goto(`/studio/${PID}`);
  await expect(page.locator(".world img")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => {
    const host = window as typeof window & { __webMcpNames?: () => string[] };
    return host.__webMcpNames?.().includes("open_image") ?? false;
  })).toBe(true);
}

test("add_instance clamps an invalid root and reports every correction", async ({ page }) => {
  await openStudio(page, [hand({ root: { x: 0.5, y: 0.5, scale: 0.22, roll: 0 }, joints: {} })]);
  const urlBefore = page.url();

  const result = await callTool(page, "add_instance", {
    root: { x: -4, y: 7, scale: 0, roll: 12 },
  });

  expect(result).toMatchObject({
    root: { x: 0, y: 1, scale: 0.02, roll: 12 },
    clamped_keys: ["root.x", "root.y", "root.scale"],
  });
  await page.waitForTimeout(250);
  await expect(page).toHaveURL(urlBefore);
});

test("open_image schema requires exactly one selector", async ({ page }) => {
  await openStudio(page, [hand({ root: { x: 0.5, y: 0.5, scale: 0.22, roll: 0 }, joints: {} })]);
  const schema = await page.evaluate(() => {
    const host = window as typeof window & {
      __webMcpSchema?: (name: string) => Record<string, unknown> | undefined;
    };
    return host.__webMcpSchema?.("open_image");
  });

  expect(schema).toMatchObject({
    oneOf: [
      { required: ["index"] },
      { required: ["id"] },
      { required: ["next_uncommitted"] },
    ],
  });
});

test("checked-in Studio and rig schemas exactly match their sources of truth", async () => {
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), "webmcp-evals", name), "utf8"));
  expect(read("studio-schema.json")).toEqual(STUDIO_TOOL_SCHEMAS);
  expect(read("rig-schema.json")).toEqual(RIG_TOOL_SCHEMAS);
});

test("set_label and delete_object round-trip without changing the WebMCP page URL", async ({ page }) => {
  const rig = { root: { x: 0.5, y: 0.5, scale: 0.22, roll: 0 }, joints: {} };
  await openStudio(page, [hand(rig), hand(rig, "hand-2")]);
  const urlBefore = page.url();

  expect(await callTool(page, "set_label", { object_id: "hand-2", label: "thumbs_down" })).toMatchObject({
    current: { objects: [{ id: "hand-1", label: null }, { id: "hand-2", label: "thumbs_down" }] },
  });
  expect(await callTool(page, "get_studio")).toMatchObject({
    current: { objects: [{ id: "hand-1", label: null }, { id: "hand-2", label: "thumbs_down" }] },
  });
  expect(await callTool(page, "delete_object", { object_id: "hand-1" })).toMatchObject({
    current: { objects: [{ id: "hand-2", label: "thumbs_down" }] },
  });
  await page.waitForTimeout(250);
  await expect(page).toHaveURL(urlBefore);
  expect(await callTool(page, "get_studio")).toMatchObject({
    current: { objects: [{ id: "hand-2", label: "thumbs_down" }] },
  });
});

test("general and rig writes report save failures and roll back their optimistic state", async ({ page }) => {
  const rig = { root: { x: 0.5, y: 0.5, scale: 0.22, roll: 0 }, joints: {} };
  await openStudio(page, [hand(rig)], { failNextSave: true });

  expect(await callTool(page, "set_label", { object_id: "hand-1", label: null })).toEqual({
    error: "save_failed",
  });
  expect(await callTool(page, "get_studio")).toMatchObject({
    current: { objects: [{ id: "hand-1", label: null }] },
  });
});

test("set_rig reports a save failure and retains the previous rig", async ({ page }) => {
  const rig = { root: { x: 0.5, y: 0.5, scale: 0.22, roll: 0 }, joints: {} };
  await openStudio(page, [hand(rig)], { failNextSave: true });

  expect(await callTool(page, "set_rig", { root: { x: 0.8 } })).toEqual({ error: "save_failed" });
  expect(await callTool(page, "get_rig")).toMatchObject({ root: { x: 0.5 } });
});

test("set_label reports class creation failure without leaving a phantom class", async ({ page }) => {
  const rig = { root: { x: 0.5, y: 0.5, scale: 0.22, roll: 0 }, joints: {} };
  await openStudio(page, [hand(rig)], { failClasses: true });

  expect(await callTool(page, "set_label", { object_id: "hand-1", label: "phantom" })).toEqual({
    error: "class_create_failed",
  });
  expect(await callTool(page, "get_studio")).toMatchObject({
    project: { classes: [] },
    current: { objects: [{ id: "hand-1", label: null }] },
  });
});

test("set_rig reports root clamps alongside joint clamps", async ({ page }) => {
  const rig = { root: { x: 0.5, y: 0.5, scale: 0.22, roll: 0 }, joints: {} };
  await openStudio(page, [hand(rig), hand(rig, "hand-2")]);
  const urlBefore = page.url();

  const result = await callTool(page, "set_rig", {
    object_id: "hand-2",
    root: { x: -4, y: 7, scale: 99 },
    joints: { index_pip: 4 },
  });

  expect(result).toMatchObject({
    root: { x: 0, y: 1, scale: 1.5 },
    clamped_keys: ["root.x", "root.y", "root.scale", "index_pip"],
  });
  await page.waitForTimeout(250);
  await expect(page).toHaveURL(urlBefore);
});

test("get_rig identifies replacement defaults when a human edit invalidated FK", async ({ page }) => {
  await openStudio(page, [hand(undefined)]);

  const result = await callTool(page, "get_rig", { object_id: "hand-1" });

  expect(result).toMatchObject({
    rig_live: false,
    rig_source: "replacement_defaults",
    rig_note: "Root and joints are replacement defaults; they do not describe the current landmarks.",
  });
});

test("get_rig preserves valid zero root coordinates from persisted data", async ({ page }) => {
  await openStudio(page, [hand({ root: { x: 0, y: 0, scale: 0.3, roll: 0 }, joints: {} })]);

  const result = await callTool(page, "get_rig", { object_id: "hand-1" });

  expect(result).toMatchObject({ root: { x: 0, y: 0, scale: 0.3, roll: 0 } });
});

test("get_comments rejects a supplied blank image id instead of dropping the filter", async ({ page }) => {
  await openStudio(page, [hand(undefined)]);

  const result = await callTool(page, "get_comments", { image_id: "   " });

  expect(result).toEqual({ error: "bad_image_id" });
});

test("comment schema encodes the operation-specific required field", async ({ page }) => {
  await openStudio(page, [hand(undefined)]);

  const schema = await page.evaluate(() => {
    const host = window as typeof window & {
      __webMcpSchema?: (name: string) => Record<string, unknown> | undefined;
    };
    return host.__webMcpSchema?.("comment");
  });

  expect(schema).toMatchObject({
    oneOf: [
      { properties: { op: { const: "add" } }, required: ["op", "body"] },
      { properties: { op: { const: "delete" } }, required: ["op", "id"] },
    ],
  });
});

test("studio_guide states the real recovery boundary for deleted images", async ({ page }) => {
  await openStudio(page, [hand(undefined)]);

  const result = await callTool(page, "studio_guide");

  expect(result.guide).toContain(
    "Bad or ambiguous frames: delete_image soft-deletes the frame. Recovery is only available from the five-second human UI undo; WebMCP has no restore tool.",
  );
});

test("comment add/delete round-trips and rejects an unknown comment id", async ({ page }) => {
  await openStudio(page, [hand(undefined)]);

  const added = await callTool(page, "comment", { op: "add", body: "Needs human review" });
  expect(added).toMatchObject({ comments: [{ id: "comment-1", body: "Needs human review" }] });

  const missing = await callTool(page, "comment", { op: "delete", id: "missing-comment" });
  expect(missing).toEqual({ error: "not_found" });

  const deleted = await callTool(page, "comment", { op: "delete", id: "comment-1" });
  expect(deleted).toEqual({ comments: [] });
});

test("open_image reports a timeout without exposing the previous image document", async ({ page }) => {
  await openTwoImageStudio(page, 3_000);

  const result = await callTool(page, "open_image", { index: 1 });
  expect(result).toEqual({ error: "image_load_timeout", image_id: "image-2" });

  const studio = await callTool(page, "get_studio");
  expect(studio.current).toMatchObject({
    id: "image-2",
    committed: false,
    loading: true,
    objects: [],
  });
});

test("commit_image waits for and returns the advanced image", async ({ page }) => {
  await openTwoImageStudio(page, 500);

  const result = await callTool(page, "commit_image");

  expect(result).toMatchObject({
    ok: true,
    advanced: true,
    current: {
      id: "image-2",
      committed: false,
      loading: false,
      objects: [{ id: "hand-2", label: "second" }],
    },
  });
});

test("delete_image waits for and returns the successor image", async ({ page }) => {
  await openTwoImageStudio(page, 500);

  const result = await callTool(page, "delete_image");

  expect(result).toMatchObject({
    deleted_id: "image-1",
    current: {
      id: "image-2",
      committed: false,
      loading: false,
      objects: [{ id: "hand-2", label: "second" }],
    },
  });
});
