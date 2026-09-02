import { expect, test, type Page } from "@playwright/test";
import { callTool, getToolSchema, installWebMcpHost, toolNames } from "./support/webmcp";

const project = {
  id: "project-1",
  name: "Known project",
  type: "keypoints",
  template: "hand",
  classes: [],
};

async function waitForCreateTools(page: Page) {
  await expect.poll(() => toolNames(page)).toEqual(["list_projects", "create_project", "open_project"]);
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

test("rejects unexpected arguments even when the WebMCP host skips schema validation", async ({ page }) => {
  expect(await callTool(page, "list_projects", { ignored: true })).toEqual({
    error: "unexpected_arguments",
    keys: ["ignored"],
  });
  expect(await callTool(page, "create_project", { name: { nested: true }, type: "boxes" })).toEqual({
    error: "invalid_arguments",
    details: ["$.name: expected string"],
  });
});

test("shows a physical UI warning when the host rejects a tool registration", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __rejectWebMcpName?: string }).__rejectWebMcpName = "create_project";
  });
  await page.reload();

  await expect(page.getByText("Could not register `create_project`", { exact: true })).toBeVisible();
});

test("valid create and open calls return actionable destinations", async ({ page }) => {
  const created = { ...project, id: "created-1", name: "Created by agent" };
  await page.route("**/api/projects/created-1**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith("/images") ? [] : created });
  });
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "POST") return route.fulfill({ json: created });
    return route.fallback();
  });

  expect(await callTool(page, "create_project", { name: created.name, type: "keypoints", template: "hand" })).toMatchObject({
    project: created,
    studio_url: "/studio/created-1",
  });
  await expect(page.getByRole("link", { name: "Created by agent Keypoints" })).toBeVisible();

  expect(await callTool(page, "open_project", { id: created.id })).toEqual({
    opened: created.id,
    studio_url: "/studio/created-1",
  });
  await expect(page).toHaveURL(/\/studio\/created-1$/);
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

  const schema = await getToolSchema(page, "open_project");
  expect(schema).toMatchObject({ oneOf: [{ required: ["id"] }, { required: ["name"] }] });
});

test("create_project rejects unexpected and type-inapplicable arguments", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "POST") posts += 1;
    await route.fulfill({ json: [project] });
  });

  expect(
    await callTool(page, "create_project", { name: "Bad", type: "boxes", surprise: true }),
  ).toEqual({ error: "unexpected_arguments", keys: ["surprise"] });
  expect(
    await callTool(page, "create_project", { name: "Bad", type: "boxes", template: "hand" }),
  ).toEqual({ error: "template_not_applicable" });
  expect(
    await callTool(page, "create_project", { name: "Bad", type: "keypoints", template: "unknown" }),
  ).toEqual({ error: "bad_template" });
  expect(posts).toBe(0);

  const schema = await getToolSchema(page, "create_project");
  expect(schema).toMatchObject({ oneOf: [{ not: { required: ["template"] } }, { properties: { type: { const: "keypoints" } } }] });
});
