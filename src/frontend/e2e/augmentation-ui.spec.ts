import { expect, test } from "@playwright/test";

const PID = "augmentation-ui";

async function openActionPanel(
  page: import("@playwright/test").Page,
  status: "queued" | "running" | "failed",
) {
  let outputReady = false;
  const progress = {
    queued: status === "queued" ? 1 : 0,
    running: status === "running" ? 1 : 0,
    succeeded: status === "running" ? 1 : 0,
    failed: status === "failed" ? 1 : 0,
    cancelled: 0,
    submission_unknown: 0,
  };
  const job = (detailed = false) => ({
    id: "action-job",
    project_id: PID,
    mode: "transform",
    config: {},
    status,
    requested_count: status === "running" ? 2 : 1,
    progress,
    cancel_requested: false,
    created_at: "2026-09-02T12:00:00Z",
    started_at: null,
    finished_at: status === "failed" ? "2026-09-02T12:00:01Z" : null,
    ...(detailed
      ? {
          items: [
            {
              id: "failed-item",
              ordinal: 0,
              source_image_id: "source",
              status: status === "failed" ? "failed" : "succeeded",
              attempts: 1,
              error: status === "failed" ? "source image could not be decoded" : null,
              provider_prediction_id: null,
              output_image_id: "preallocated-output",
            },
          ],
          item_offset: 0,
          item_limit: 100,
        }
      : {}),
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (path === `/projects/${PID}`) {
      return route.fulfill({ json: { id: PID, name: "Actions", type: "boxes", classes: [] } });
    }
    if (path === `/projects/${PID}/images`) {
      return route.fulfill({
        json: [
          { id: "source", filename: "source.jpg", committed: false, empty: true },
          ...(outputReady
            ? [
                {
                  id: "preallocated-output",
                  filename: "augmentation.png",
                  committed: false,
                  empty: true,
                },
              ]
            : []),
        ],
      });
    }
    if (path === `/projects/${PID}/images/source`) {
      return route.fulfill({
        json: { id: "source", image: "source.jpg", url: "/default.jpg", objects: [] },
      });
    }
    if (path === `/projects/${PID}/augmentation-jobs`) {
      if (status === "running") outputReady = true;
      return route.fulfill({
        json: {
          items: [job()],
          total: 1,
          offset: 0,
          limit: 3,
          status_counts: { active: status === "failed" ? 0 : 1, succeeded: 0, partially_succeeded: 0, failed: status === "failed" ? 1 : 0 },
        },
      });
    }
    if (path === `/projects/${PID}/augmentation-jobs/action-job` && request.method() === "GET") {
      return route.fulfill({ json: job(true) });
    }
    if (path.endsWith("/cancel") || path.endsWith("/retry")) {
      return route.fulfill({ status: 500, json: { detail: "forced action failure" } });
    }
    return route.fulfill({ status: 404, body: `unmocked ${path}` });
  });
  await page.goto(`/studio/${PID}`);
  await expect(page.locator(".world img")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Generate data" }).click();
  return page.getByRole("dialog", { name: "Generate data" });
}

test("Generate data refreshes completed outputs without moving the canvas", async ({ page }) => {
  let jobCreated = false;
  let outputReady = false;
  let createdPipelineLength = 0;
  const progress = () => ({
    queued: outputReady ? 0 : 1,
    running: 0,
    succeeded: outputReady ? 1 : 0,
    failed: 0,
    cancelled: 0,
    submission_unknown: 0,
  });
  const job = (withItems = false) => ({
    id: "job-ui",
    project_id: PID,
    mode: "transform",
    config: {},
    status: outputReady ? "succeeded" : "queued",
    requested_count: 1,
    progress: progress(),
    cancel_requested: false,
    created_at: "2026-09-02T12:00:00Z",
    started_at: null,
    finished_at: outputReady ? "2026-09-02T12:00:01Z" : null,
    ...(withItems
      ? {
          items: [
            {
              id: "item-ui",
              ordinal: 0,
              source_image_id: "source",
              status: "succeeded",
              attempts: 1,
              error: null,
              provider_prediction_id: null,
              output_image_id: "output",
            },
          ],
          item_offset: 0,
          item_limit: 100,
        }
      : {}),
  });

  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const method = request.method();
    if (path === `/projects/${PID}` && method === "GET") {
      return route.fulfill({
        json: { id: PID, name: "Augmentation UI", type: "boxes", classes: [] },
      });
    }
    if (path === `/projects/${PID}/images` && method === "GET") {
      const items = [
        { id: "source", filename: "source.jpg", committed: false, empty: false },
        ...(outputReady
          ? [{ id: "output", filename: "generated.png", committed: false, empty: true }]
          : []),
      ];
      return route.fulfill({ json: items });
    }
    if (path === `/projects/${PID}/images/source` && method === "GET") {
      return route.fulfill({
        json: {
          id: "source",
          image: "source.jpg",
          url: "/default.jpg",
          committed: false,
          objects: [
            {
              id: "box-1",
              label: "source",
              edited: false,
              geom: { t: "box", x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
            },
          ],
        },
      });
    }
    if (path === `/projects/${PID}/images/output` && method === "GET") {
      return route.fulfill({
        json: {
          id: "output",
          image: "generated.png",
          url: "/default.jpg",
          generated: true,
          committed: false,
          objects: [],
        },
      });
    }
    if (path === `/projects/${PID}/augmentation-jobs` && method === "POST") {
      const body = request.postDataJSON() as { pipeline?: unknown[] };
      createdPipelineLength = body.pipeline?.length ?? 0;
      jobCreated = true;
      return route.fulfill({ status: 201, json: job() });
    }
    if (path === `/projects/${PID}/augmentation-jobs` && method === "GET") {
      if (jobCreated) outputReady = true;
      return route.fulfill({
        json: {
          items: jobCreated ? [job()] : [],
          total: jobCreated ? 1 : 0,
          offset: 0,
          limit: 20,
          status_counts: {
            active: outputReady ? 0 : 1,
            succeeded: outputReady ? 1 : 0,
            partially_succeeded: 0,
            failed: 0,
          },
        },
      });
    }
    if (path === `/projects/${PID}/augmentation-jobs/job-ui` && method === "GET") {
      return route.fulfill({ json: job(true) });
    }
    return route.fulfill({ status: 404, body: `unmocked ${method} ${path}` });
  });

  await page.goto(`/studio/${PID}`);
  await expect(page.locator(".world img")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/[?&]obj=box-1(?:&|$)/);
  const initialUrl = page.url();

  await page.getByRole("button", { name: "Generate data" }).click();
  const panel = page.getByRole("dialog", { name: "Generate data" });
  await expect(panel).toBeVisible();
  await expect(panel.locator(".synth-pipeline")).toBeHidden();
  await expect(panel.locator(".synth-sources")).toBeHidden();
  await panel.getByText("Fine-tune 3-step pipeline").click();
  await expect(panel.locator(".synth-pipeline > li")).toHaveCount(3);
  await panel.getByRole("button", { name: "Add operation" }).click();
  await expect(panel.locator(".synth-pipeline > li")).toHaveCount(4);
  await panel.getByRole("button", { name: "Create job" }).click();
  expect(createdPipelineLength).toBe(4);
  await expect(panel.getByText("Queued 1 output.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Open first output" })).toBeVisible({
    timeout: 5_000,
  });
  expect(page.url()).toBe(initialUrl);

  await panel.getByRole("button", { name: "Open first output" }).click();
  await expect(page).toHaveURL(/[?&]i=1(?:&|$)/);
  await expect(page.getByText("Augmentation UI/generated.png")).toBeVisible();
});

test("Generate data remains usable at a narrow in-app-browser width", async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 720 });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === `/projects/${PID}`) {
      return route.fulfill({ json: { id: PID, name: "Narrow", type: "boxes", classes: [] } });
    }
    if (path === `/projects/${PID}/images`) {
      return route.fulfill({
        json: [{ id: "source", filename: "source.jpg", committed: false, empty: false }],
      });
    }
    if (path === `/projects/${PID}/images/source`) {
      return route.fulfill({
        json: {
          id: "source",
          image: "source.jpg",
          url: "/default.jpg",
          objects: [{ id: "b", label: "x", geom: { t: "box", x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }],
        },
      });
    }
    if (path === `/projects/${PID}/augmentation-jobs`) {
      return route.fulfill({
        json: {
          items: [],
          total: 0,
          offset: 0,
          limit: 20,
          status_counts: { active: 0, succeeded: 0, partially_succeeded: 0, failed: 0 },
        },
      });
    }
    return route.fulfill({ status: 404 });
  });

  await page.goto(`/studio/${PID}`);
  await expect(page.locator(".world img")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Generate data" }).click();
  const panel = page.getByRole("dialog", { name: "Generate data" });
  await expect(panel).toBeVisible();
  const bounds = await panel.boundingBox();
  const rail = await page.locator("aside").boundingBox();
  const tools = await page.locator(".panel.tools").boundingBox();
  const railToggle = await page.locator(".panel.rail-tog").boundingBox();
  const footer = await page.locator("footer").boundingBox();
  expect(bounds).not.toBeNull();
  expect(rail).not.toBeNull();
  expect(tools).not.toBeNull();
  expect(railToggle).not.toBeNull();
  expect(footer).not.toBeNull();
  const gutter = tools!.x - (rail!.x + rail!.width);
  expect(bounds!.y).toBeCloseTo(railToggle!.y, 0);
  expect(bounds!.x).toBeCloseTo(tools!.x + tools!.width + gutter, 0);
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(620);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(footer!.y);
  await expect(panel.getByRole("button", { name: "Create job" })).toBeEnabled();
});

test("an empty project can open Generate data and start AI generation", async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (path === `/projects/${PID}`) {
      return route.fulfill({ json: { id: PID, name: "Empty", type: "boxes", classes: [] } });
    }
    if (path === `/projects/${PID}/images`) {
      return route.fulfill({ json: [] });
    }
    if (path === `/projects/${PID}/augmentation-jobs` && request.method() === "GET") {
      return route.fulfill({
        json: {
          items: [],
          total: 0,
          offset: 0,
          limit: 20,
          status_counts: { active: 0, succeeded: 0, partially_succeeded: 0, failed: 0 },
        },
      });
    }
    if (path === `/projects/${PID}/augmentation-jobs` && request.method() === "POST") {
      submitted = request.postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 201,
        json: {
          id: "empty-project-job",
          project_id: PID,
          mode: "text_to_image",
          config: submitted,
          status: "queued",
          requested_count: 1,
          progress: {
            queued: 1,
            running: 0,
            succeeded: 0,
            failed: 0,
            cancelled: 0,
            submission_unknown: 0,
          },
          cancel_requested: false,
          created_at: "2026-09-02T12:00:00Z",
          started_at: null,
          finished_at: null,
          items: [],
        },
      });
    }
    return route.fulfill({ status: 404 });
  });

  await page.goto(`/studio/${PID}`);
  await expect(page.getByRole("button", { name: "Generate data" })).toBeVisible();
  await page.getByRole("button", { name: "Generate data" }).click();
  const panel = page.getByRole("dialog", { name: "Generate data" });
  await expect(panel).toBeVisible();
  await panel.getByRole("tab", { name: "Generate" }).click();
  await panel.getByLabel("Prompt").fill("A neutral test image");
  await panel.getByRole("button", { name: "Create job" }).click();
  await expect(panel.getByText("Queued 1 output.")).toBeVisible();
  expect(submitted).toMatchObject({
    mode: "text_to_image",
    prompt: "A neutral test image",
    count: 1,
  });
});

test("source selection pages through a large project without moving the canvas", async ({ page }) => {
  const rows = Array.from({ length: 205 }, (_, index) => ({
    id: `source-${index}`,
    filename: `frame-${String(index).padStart(3, "0")}.jpg`,
    committed: false,
    empty: false,
  }));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname.replace(/^\/api/, "");
    if (path === `/projects/${PID}`) {
      return route.fulfill({ json: { id: PID, name: "Large", type: "boxes", classes: [] } });
    }
    if (path === `/projects/${PID}/images`) {
      const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
      const limit = Number(requestUrl.searchParams.get("limit") ?? 100);
      return route.fulfill({
        json: {
          items: rows.slice(offset, offset + limit),
          total: rows.length,
          committed: 0,
          empty: 0,
          offset,
          limit,
        },
      });
    }
    if (/^\/projects\/augmentation-ui\/images\/source-\d+$/.test(path)) {
      const id = path.split("/").at(-1)!;
      return route.fulfill({
        json: {
          id,
          image: `${id}.jpg`,
          url: "/default.jpg",
          committed: false,
          objects: [],
        },
      });
    }
    if (path === `/projects/${PID}/augmentation-jobs`) {
      return route.fulfill({
        json: {
          items: [],
          total: 0,
          offset: 0,
          limit: 3,
          status_counts: { active: 0, succeeded: 0, partially_succeeded: 0, failed: 0 },
        },
      });
    }
    return route.fulfill({ status: 404, body: `unmocked ${path}` });
  });

  await page.goto(`/studio/${PID}?i=200`);
  await expect(page.locator(".world img")).toBeVisible({ timeout: 15_000 });
  const initialUrl = page.url();
  await page.getByRole("button", { name: "Generate data" }).click();
  const panel = page.getByRole("dialog", { name: "Generate data" });
  await panel.getByRole("button", { name: "Choose" }).click();

  await expect(panel.getByText("201–205 of 205", { exact: true })).toBeVisible();
  await expect(panel.locator(".synth-sources input[type=checkbox]")).toHaveCount(5);
  await expect(panel.getByText("frame-204.jpg", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Previous sources" }).click();
  await expect(panel.getByText("101–200 of 205", { exact: true })).toBeVisible();
  await expect(panel.locator(".synth-sources input[type=checkbox]")).toHaveCount(100);
  await panel.getByText("frame-150.jpg", { exact: true }).click();
  await panel.getByRole("button", { name: "Done" }).click();
  await panel.getByRole("button", { name: "Choose" }).click();
  await expect(panel.getByText("201–205 of 205", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Previous sources" }).click();
  await panel.getByRole("button", { name: "Previous sources" }).click();
  await expect(panel.getByText("1–100 of 205", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(panel.getByText(/2 selected/)).toBeVisible();
  expect(page.url()).toBe(initialUrl);
});

test("a failed item never exposes its preallocated output id as an openable image", async ({
  page,
}) => {
  const panel = await openActionPanel(page, "failed");

  await expect(panel.getByText("Item 1: source image could not be decoded")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Open first output" })).toBeHidden();
});

test("running jobs refresh newly succeeded outputs without moving the canvas", async ({ page }) => {
  const initialUrl = `/studio/${PID}`;
  const panel = await openActionPanel(page, "running");

  await expect(panel.getByRole("button", { name: "Open first output" })).toBeVisible();
  await expect(page.locator(".pager .nums")).toHaveText("1/2");
  await expect(page).toHaveURL(new RegExp(`${initialUrl}$`));
});

test("failed retry and cancellation actions show recoverable feedback", async ({ page }) => {
  let panel = await openActionPanel(page, "failed");
  await panel.getByRole("button", { name: "Retry" }).click();
  await expect(panel.getByText("Couldn’t retry the job. Try again.")).toBeVisible();

  await page.unrouteAll({ behavior: "wait" });
  panel = await openActionPanel(page, "queued");
  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect(panel.getByText("Couldn’t cancel the job. Try again.")).toBeVisible();
});
