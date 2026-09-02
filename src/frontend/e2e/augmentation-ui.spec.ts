import { expect, test } from "@playwright/test";

const PID = "augmentation-ui";

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
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(620);
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
