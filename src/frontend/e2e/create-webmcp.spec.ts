import { expect, test, type Page } from "@playwright/test";

type RegisteredTool = {
  name: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => unknown;
};

const project = {
  id: "project-1",
  name: "Known project",
  type: "keypoints",
  template: "hand",
  classes: [],
};

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

async function waitForCreateTools(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const host = window as typeof window & { __webMcpNames?: () => string[] };
    return host.__webMcpNames?.() ?? [];
  })).toEqual(["list_projects", "create_project", "open_project"]);
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

test.beforeEach(async ({ page }) => {
  await installWebMcpHost(page);
  await page.route("**/api/projects", async (route) => {
    await route.fulfill({ json: [project] });
  });
  await page.goto("/create");
  await expect(page.getByRole("link", { name: "Known project Keypoints" })).toBeVisible();
  await waitForCreateTools(page);
});

test("shows visible feedback when a create-page WebMCP tool runs", async ({ page }) => {
  await callTool(page, "list_projects");

  await expect(page.getByText("Agent used `list_projects`", { exact: true })).toBeVisible();
});

test("open_project requires exactly one identifier and verifies ids before navigation", async ({ page }) => {
  const conflicting = await callTool(page, "open_project", {
    id: "not-a-real-id",
    name: "Known project",
  });
  expect(conflicting).toEqual({ error: "choose_one_identifier" });
  await expect(page).toHaveURL(/\/create$/);

  const unknown = await callTool(page, "open_project", { id: "not-a-real-id" });
  expect(unknown).toEqual({ error: "not_found" });
  await expect(page).toHaveURL(/\/create$/);

  const schema = await page.evaluate(() => {
    const host = window as typeof window & {
      __webMcpSchema?: (name: string) => Record<string, unknown> | undefined;
    };
    return host.__webMcpSchema?.("open_project");
  });
  expect(schema).toMatchObject({ oneOf: [{ required: ["id"] }, { required: ["name"] }] });
});
