import { expect, test, type Page } from "@playwright/test";

type RegisteredTool = {
  name: string;
  execute: (args: Record<string, unknown>) => unknown;
};

const PID = "p_webmcp";
const IID = "img_webmcp";
const landmarks = Array.from({ length: 21 }, (_, i) => ({
  x: 0.3 + (i % 5) * 0.05,
  y: 0.35 + Math.floor(i / 5) * 0.06,
  z: 0,
}));

function hand(rig: unknown) {
  return {
    id: "hand-1",
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
      __webMcpNames: () => [...tools.keys()],
    });
  });
}

async function mockStudio(page: Page, initialObjects: unknown[]) {
  let objects = initialObjects;
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
      return route.fulfill({
        json: {
          id: IID,
          image: "hand.jpg",
          url: "/default.jpg",
          committed: false,
          objects,
          history: [],
        },
      });
    }
    if (path === `/projects/${PID}/images/${IID}` && method === "PUT") {
      objects = (request.postDataJSON() as { objects: unknown[] }).objects;
      return route.fulfill({ json: { ok: true } });
    }
    if (path === `/projects/${PID}/classes` && method === "POST") {
      return route.fulfill({
        json: { id: PID, name: "WebMCP rig", type: "keypoints", template: "hand", classes: [] },
      });
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

async function openStudio(page: Page, initialObjects: unknown[]) {
  await installWebMcpHost(page);
  await mockStudio(page, initialObjects);
  await page.goto(`/studio/${PID}`);
  await expect(page.locator(".world img")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => {
    const host = window as typeof window & { __webMcpNames?: () => string[] };
    return host.__webMcpNames?.().includes("add_instance") ?? false;
  })).toBe(true);
}

test("add_instance clamps an invalid root and reports every correction", async ({ page }) => {
  await openStudio(page, [hand({ root: { x: 0.5, y: 0.5, scale: 0.22, roll: 0 }, joints: {} })]);

  const result = await callTool(page, "add_instance", {
    root: { x: -4, y: 7, scale: 0, roll: 12 },
  });

  expect(result).toMatchObject({
    root: { x: 0, y: 1, scale: 0.02, roll: 12 },
    clamped_keys: ["root.x", "root.y", "root.scale"],
  });
});

test("set_rig reports root clamps alongside joint clamps", async ({ page }) => {
  await openStudio(page, [hand({ root: { x: 0.5, y: 0.5, scale: 0.22, roll: 0 }, joints: {} })]);

  const result = await callTool(page, "set_rig", {
    object_id: "hand-1",
    root: { x: -4, y: 7, scale: 99 },
    joints: { index_pip: 4 },
  });

  expect(result).toMatchObject({
    root: { x: 0, y: 1, scale: 1.5 },
    clamped_keys: ["root.x", "root.y", "root.scale", "index_pip"],
  });
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
