import { expect, test, type Page } from "@playwright/test";
import { callTool, getToolSchema, installWebMcpHost, waitForTool } from "./support/webmcp";

type ShapeType = "boxes" | "polygons";

const PID = "p_shape_webmcp";
const IID = "shape-image-1";

async function mockShapeStudio(
  page: Page,
  type: ShapeType,
  options: { failNextSave?: boolean; classDelayMs?: number; failClasses?: boolean } = {},
) {
  let objects: unknown[] = [];
  let classes: string[] = [];
  let failNextSave = options.failNextSave ?? false;
  const project = () => ({ id: PID, name: `WebMCP ${type}`, type, classes });
  const imageDoc = () => ({
    id: IID,
    image: "shape.jpg",
    url: "/default.jpg",
    committed: false,
    objects,
    comments: [],
    history: [],
  });

  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const method = request.method();
    if (path === `/projects/${PID}` && method === "GET") {
      return route.fulfill({ json: project() });
    }
    if (path === `/projects/${PID}/images` && method === "GET") {
      return route.fulfill({
        json: [{ id: IID, filename: "shape.jpg", committed: false, empty: objects.length === 0 }],
      });
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
      if (options.classDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.classDelayMs));
      }
      const name = String((request.postDataJSON() as { name?: unknown }).name ?? "");
      if (name && !classes.includes(name)) classes = [...classes, name];
      return route.fulfill({ json: project() });
    }
    return route.fulfill({ status: 404, body: `unmocked ${method} ${path}` });
  });
}

async function openShapeStudio(page: Page, type: ShapeType, options = {}) {
  await installWebMcpHost(page);
  await mockShapeStudio(page, type, options);
  await page.goto(`/studio/${PID}`);
  await expect(page.locator(".world img")).toBeVisible({ timeout: 15_000 });
  await waitForTool(page, type === "boxes" ? "add_box" : "add_polygon");
}

async function openTwoImageBoxStudio(page: Page) {
  await installWebMcpHost(page);
  const ids = ["shape-image-1", "shape-image-2"];
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (path === `/projects/${PID}`) {
      return route.fulfill({ json: { id: PID, name: "Pixel race", type: "boxes", classes: [] } });
    }
    if (path === `/projects/${PID}/images`) {
      return route.fulfill({
        json: ids.map((id, index) => ({ id, filename: `${index + 1}.svg`, committed: false, empty: true })),
      });
    }
    const match = path.match(new RegExp(`^/projects/${PID}/images/(shape-image-[12])$`));
    if (match) {
      const second = match[1] === ids[1];
      return route.fulfill({
        json: {
          id: match[1],
          image: second ? "2.svg" : "1.svg",
          url: second ? "/shape-2.svg" : "/shape-1.svg",
          committed: false,
          objects: [],
          comments: [],
          history: [],
        },
      });
    }
    return route.fulfill({ status: 404, body: `unmocked ${request.method()} ${path}` });
  });
  await page.route("**/shape-1.svg", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" />' }),
  );
  await page.route("**/shape-2.svg", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" />' });
  });
  await page.goto(`/studio/${PID}`);
  await expect
    .poll(async () => (await callTool(page, "get_boxes") as { image_width?: number })?.image_width)
    .toBe(100);
}

test("box tools preserve geometry, ambiguity rules, and the page URL", async ({ page }) => {
  await openShapeStudio(page, "boxes");
  const urlBefore = page.url();

  expect(await callTool(page, "get_boxes")).toMatchObject({ n: 0, coord_space: "norm" });
  expect(await callTool(page, "add_box", { unit: "px", x: 0, y: 0, w: 100, h: 1 })).toMatchObject({
    error: "too_small",
  });
  const first = (await callTool(page, "add_box", {
    unit: "norm",
    x: 0.1,
    y: 0.2,
    w: 0.3,
    h: 0.4,
    label: "person",
  })) as { object_id: string };
  expect(first).toMatchObject({
    label: "person",
    geom: { t: "box", x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    clamped_keys: [],
  });

  expect(await callTool(page, "set_box", { unit: "norm", x: -1, w: 4 })).toMatchObject({
    object_id: first.object_id,
    geom: { x: 0, y: 0.2, w: 1, h: 0.4 },
    clamped_keys: ["x", "w"],
  });
  await callTool(page, "add_box", { unit: "norm", x: 0.6, y: 0.6, w: 0.2, h: 0.2 });
  expect(await callTool(page, "set_box", { unit: "norm", x: 0.2 })).toEqual({
    error: "need_object_id",
  });
  expect(await callTool(page, "get_boxes")).toMatchObject({ n: 2 });
  await page.waitForTimeout(250);
  await expect(page).toHaveURL(urlBefore);
});

test("shape schemas are enforced when the WebMCP host passes coercible wrong types", async ({ page }) => {
  await openShapeStudio(page, "boxes");

  expect(await callTool(page, "add_box", { unit: "norm", x: "0.1", y: 0.1, w: 0.2, h: 0.2 })).toEqual({
    error: "invalid_arguments",
    details: ["$.x: expected number"],
  });
});

test("polygon schemas describe both point formats and reject zero-area geometry", async ({ page }) => {
  await openShapeStudio(page, "polygons");
  const urlBefore = page.url();
  const schema = await getToolSchema(page, "add_polygon");
  expect(schema).toMatchObject({
    properties: { pts: { oneOf: [{ minItems: 3 }, { minItems: 6 }] } },
  });

  expect(
    await callTool(page, "add_polygon", {
      unit: "norm",
      pts: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
        { x: 0.3, y: 0.3 },
      ],
    }),
  ).toMatchObject({ error: "degenerate_polygon" });
  expect(
    await callTool(page, "add_polygon", {
      unit: "norm",
      pts: [0.1, 0.1, 0.8, 0.1, 0.2, 0.8, 0.7, 0.8],
    }),
  ).toMatchObject({ error: "self_intersection" });
  expect(await callTool(page, "add_polygon", { unit: "norm", pts: [0.1, 0.1, 0.2] })).toEqual({
    error: "bad_geom",
  });
  const added = (await callTool(page, "add_polygon", {
    unit: "norm",
    pts: [0.1, 0.1, 0.7, 0.1, 0.4, 0.7],
    label: "hand",
  })) as { object_id: string };
  expect(added).toMatchObject({ kind: "polygon", label: "hand" });
  expect(
    await callTool(page, "set_polygon", {
      object_id: added.object_id,
      unit: "norm",
      pts: [
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.2 },
        { x: 0.5, y: 0.8 },
      ],
    }),
  ).toMatchObject({ object_id: added.object_id, clamped_keys: [] });
  expect(await callTool(page, "get_polygons")).toMatchObject({ n: 1 });
  await page.waitForTimeout(250);
  await expect(page).toHaveURL(urlBefore);
});

test("concurrent labeled box adds do not overwrite each other", async ({ page }) => {
  await openShapeStudio(page, "boxes", { classDelayMs: 100 });

  await page.evaluate(async () => {
    const host = window as typeof window & {
      __webMcpCall?: (name: string, args: Record<string, unknown>) => unknown;
    };
    await Promise.all([
      host.__webMcpCall?.("add_box", { unit: "norm", x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: "a" }),
      host.__webMcpCall?.("add_box", { unit: "norm", x: 0.6, y: 0.6, w: 0.2, h: 0.2, label: "b" }),
    ]);
  });

  expect(await callTool(page, "get_boxes")).toMatchObject({ n: 2 });
});

test("a failed shape save rolls back the optimistic object", async ({ page }) => {
  await openShapeStudio(page, "boxes", { failNextSave: true });

  expect(await callTool(page, "add_box", { unit: "norm", x: 0.1, y: 0.1, w: 0.3, h: 0.3 })).toEqual({
    error: "save_failed",
  });
  expect(await callTool(page, "get_boxes")).toMatchObject({ n: 0 });
});

test("a failed class creation cannot leave a labeled shape or phantom class", async ({ page }) => {
  await openShapeStudio(page, "boxes", { failClasses: true });

  expect(
    await callTool(page, "add_box", {
      unit: "norm",
      x: 0.1,
      y: 0.1,
      w: 0.3,
      h: 0.3,
      label: "phantom",
    }),
  ).toEqual({ error: "class_create_failed" });
  expect(await callTool(page, "get_boxes")).toMatchObject({ n: 0 });
  expect(await callTool(page, "get_studio")).toMatchObject({ project: { classes: [] } });
});

test("pixel geometry never reuses dimensions from the previous image", async ({ page }) => {
  await openTwoImageBoxStudio(page);

  expect(await callTool(page, "open_image", { index: 1 })).toMatchObject({
    current: { id: "shape-image-2" },
  });
  const beforeDecode = (await callTool(page, "get_boxes")) as { image_width: number | null };
  expect(beforeDecode.image_width).not.toBe(100);
  expect([null, 300]).toContain(beforeDecode.image_width);

  await expect
    .poll(async () => (await callTool(page, "get_boxes") as { image_width?: number })?.image_width)
    .toBe(300);
});
