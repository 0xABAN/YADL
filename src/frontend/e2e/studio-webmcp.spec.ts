import { expect, test, type Page } from "@playwright/test";
import { callTool, getToolSchema, installWebMcpHost, waitForTool } from "./support/webmcp";

const PID = "p_webmcp";
const IID = "img_webmcp";
const REST_RIG = { root: { x: 0.5, y: 0.5, scale: 0.22, roll: 0 }, joints: {} };
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

async function mockStudio(
  page: Page,
  initialObjects: unknown[],
  options: {
    failNextSave?: boolean;
    failClasses?: boolean;
    succeedAugmentationOnGet?: boolean;
  } = {},
) {
  let objects = initialObjects;
  let failNextSave = options.failNextSave ?? false;
  let comments: { id: string; body: string; at: string }[] = [];
  let augmentationBody: Record<string, unknown> | null = null;
  let augmentationStatus = "queued";
  let augmentationOutputReady = false;
  const augmentationJob = () => ({
    id: "job-1",
    project_id: PID,
    mode: augmentationBody?.mode ?? "transform",
    config: augmentationBody ?? {},
    status: augmentationStatus,
    requested_count: 1,
    progress: {
      queued: augmentationStatus === "queued" ? 1 : 0,
      running: 0,
      succeeded: augmentationStatus === "succeeded" ? 1 : 0,
      failed: 0,
      cancelled: augmentationStatus === "cancelled" ? 1 : 0,
      submission_unknown: 0,
    },
    cancel_requested: augmentationStatus === "cancelled",
    created_at: "2026-09-02T12:00:00Z",
    started_at: null,
    finished_at: augmentationStatus === "succeeded" ? "2026-09-02T12:00:01Z" : null,
    items: augmentationOutputReady
      ? [
          {
            id: "augmentation-item",
            ordinal: 0,
            source_image_id: IID,
            status: "succeeded",
            attempts: 1,
            error: null,
            provider_prediction_id: null,
            output_image_id: "augmentation-output",
          },
        ]
      : [],
    item_offset: 0,
    item_limit: 100,
  });
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
      return route.fulfill({
        json: [
          { id: IID, filename: "hand.jpg", committed: false, empty: false },
          ...(augmentationOutputReady
            ? [
                {
                  id: "augmentation-output",
                  filename: "augmentation.png",
                  committed: false,
                  empty: true,
                },
              ]
            : []),
        ],
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
    if (path === `/projects/${PID}/augmentation-jobs` && method === "POST") {
      augmentationBody = request.postDataJSON() as Record<string, unknown>;
      augmentationStatus = "queued";
      return route.fulfill({ status: 201, json: augmentationJob() });
    }
    if (path === `/projects/${PID}/augmentation-jobs` && method === "GET") {
      return route.fulfill({
        json: {
          items: augmentationBody ? [augmentationJob()] : [],
          total: augmentationBody ? 1 : 0,
          offset: 0,
          limit: 50,
          status_counts: {
            active: augmentationStatus === "queued" ? 1 : 0,
            succeeded: 0,
            partially_succeeded: 0,
            failed: 0,
          },
        },
      });
    }
    if (path === `/projects/${PID}/augmentation-jobs/job-1` && method === "GET") {
      if (options.succeedAugmentationOnGet) {
        augmentationStatus = "succeeded";
        augmentationOutputReady = true;
      }
      return route.fulfill({ json: augmentationJob() });
    }
    if (path === `/projects/${PID}/augmentation-jobs/job-1/cancel` && method === "POST") {
      augmentationStatus = "cancelled";
      return route.fulfill({ json: augmentationJob() });
    }
    if (path === `/projects/${PID}/augmentation-jobs/job-1/retry` && method === "POST") {
      augmentationStatus = "queued";
      return route.fulfill({ json: augmentationJob() });
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

async function openStudio(
  page: Page,
  initialObjects: unknown[],
  options: {
    failNextSave?: boolean;
    failClasses?: boolean;
    succeedAugmentationOnGet?: boolean;
  } = {},
) {
  await installWebMcpHost(page);
  await mockStudio(page, initialObjects, options);
  await page.goto(`/studio/${PID}`);
  await expect(page.locator(".world img")).toBeVisible({ timeout: 15_000 });
  await waitForTool(page, "add_instance");
  if (initialObjects.length) {
    await expect(page).toHaveURL(/[?&]obj=/);
  }
}

async function openTwoImageStudio(page: Page, secondDelayMs: number) {
  await installWebMcpHost(page);
  const docs = {
    "image-1": { ...hand(REST_RIG, "hand-1"), label: "first" },
    "image-2": { ...hand(REST_RIG, "hand-2"), label: "second" },
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
  await waitForTool(page, "open_image");
}

async function openGeneratedStudio(
  page: Page,
  outcome: "completed" | "no_detection" | "failed",
) {
  await installWebMcpHost(page);
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const method = request.method();
    if (path === `/projects/${PID}` && method === "GET") {
      return route.fulfill({
        json: {
          id: PID,
          name: "Generated keypoints",
          type: "keypoints",
          template: "hand",
          classes: [],
        },
      });
    }
    if (path === `/projects/${PID}/images` && method === "GET") {
      return route.fulfill({
        json: [
          { id: "original", filename: "original.jpg", committed: false, empty: false },
          { id: "generated", filename: "generated.png", committed: false, empty: true },
        ],
      });
    }
    if (path === `/projects/${PID}/images/original` && method === "GET") {
      return route.fulfill({
        json: {
          id: "original",
          image: "original.jpg",
          url: "/default.jpg",
          committed: false,
          objects: [hand(REST_RIG)],
        },
      });
    }
    if (path === `/projects/${PID}/images/generated` && method === "GET") {
      return route.fulfill({
        json: {
          id: "generated",
          image: "generated.png",
          url: "/default.jpg",
          generated: true,
          committed: false,
          objects: [],
        },
      });
    }
    if (path === `/projects/${PID}/images/generated/assist` && method === "POST") {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (outcome === "failed") {
        return route.fulfill({ status: 500, json: { detail: "detector failed" } });
      }
      return route.fulfill({
        json: {
          id: "generated",
          image: "generated.png",
          url: "/default.jpg",
          generated: true,
          committed: false,
          objects: outcome === "completed" ? [hand(REST_RIG, "generated-hand")] : [],
        },
      });
    }
    if (path === `/projects/${PID}/images/generated/commit` && method === "POST") {
      return route.fulfill({ json: { history: [{ id: "negative-review", objects: [] }] } });
    }
    if (path === `/projects/${PID}/augmentation-jobs` && method === "GET") {
      return route.fulfill({
        json: {
          items: [],
          total: 0,
          offset: 0,
          limit: 1,
          status_counts: { active: 0, succeeded: 0, partially_succeeded: 0, failed: 0 },
        },
      });
    }
    return route.fulfill({ status: 404, body: `unmocked ${method} ${path}` });
  });
  await page.goto(`/studio/${PID}`);
  await expect(page.locator(".world img")).toBeVisible({ timeout: 15_000 });
  await waitForTool(page, "open_image");
  await page.getByRole("button", { name: "Auto Label" }).click();
}

test("add_instance clamps an invalid root and reports every correction", async ({ page }) => {
  await openStudio(page, [hand(REST_RIG)]);
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
  await openStudio(page, [hand(REST_RIG)]);
  const schema = await getToolSchema(page, "open_image");

  expect(schema).toMatchObject({
    oneOf: [
      { required: ["index"] },
      { required: ["id"] },
      { required: ["next_uncommitted"] },
    ],
  });
});

test("Studio and rig schemas reject coercible wrong types at the app boundary", async ({ page }) => {
  await openStudio(page, [hand(REST_RIG)]);

  expect(await callTool(page, "open_image", { index: "0" })).toEqual({
    error: "invalid_arguments",
    details: ["$.index: expected integer"],
  });
  expect(await callTool(page, "set_rig", { root: { x: "0.8" } })).toEqual({
    error: "invalid_arguments",
    details: ["$.root.x: expected number"],
  });
});

test("set_label and delete_object round-trip without changing the WebMCP page URL", async ({ page }) => {
  await openStudio(page, [hand(REST_RIG), hand(REST_RIG, "hand-2")]);
  const urlBefore = page.url();

  expect(await callTool(page, "delete_object", { object_id: "   " })).toEqual({
    error: "bad_object_id",
  });

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
  await openStudio(page, [hand(REST_RIG)], { failNextSave: true });

  expect(await callTool(page, "set_label", { object_id: "hand-1", label: null })).toEqual({
    error: "save_failed",
  });
  expect(await callTool(page, "get_studio")).toMatchObject({
    current: { objects: [{ id: "hand-1", label: null }] },
  });
});

test("set_rig reports a save failure and retains the previous rig", async ({ page }) => {
  await openStudio(page, [hand(REST_RIG)], { failNextSave: true });

  expect(await callTool(page, "set_rig", { root: { x: 0.8 } })).toEqual({ error: "save_failed" });
  expect(await callTool(page, "get_rig")).toMatchObject({ root: { x: 0.5 } });
});

test("set_label reports class creation failure without leaving a phantom class", async ({ page }) => {
  await openStudio(page, [hand(REST_RIG)], { failClasses: true });

  expect(await callTool(page, "set_label", { object_id: "hand-1", label: "phantom" })).toEqual({
    error: "class_create_failed",
  });
  expect(await callTool(page, "get_studio")).toMatchObject({
    project: { classes: [] },
    current: { objects: [{ id: "hand-1", label: null }] },
  });
});

test("set_rig reports root clamps alongside joint clamps", async ({ page }) => {
  await openStudio(page, [hand(REST_RIG), hand(REST_RIG, "hand-2")]);
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

  const schema = await getToolSchema(page, "comment");

  expect(schema).toMatchObject({
    oneOf: [
      { properties: { op: { const: "add" } }, required: ["op", "body"] },
      { properties: { op: { const: "delete" } }, required: ["op", "id"] },
    ],
  });
});

test("studio_guide states the real recovery boundary for deleted images", async ({ page }) => {
  await openStudio(page, [hand(undefined)]);

  const result = (await callTool(page, "studio_guide")) as { guide: string[] };

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

  const studio = (await callTool(page, "get_studio")) as {
    current: { id: string; committed: boolean; loading: boolean; objects: unknown[] };
  };
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

test("all augmentation WebMCP tools share the durable job contract", async ({ page }) => {
  await openStudio(page, [hand(REST_RIG)]);

  const created = await callTool(page, "create_augmentation_job", {
    mode: "transform",
    source_image_ids: [IID],
    variants_per_source: 1,
    seed: 42,
    pipeline: [{ op: "flip", axis: "horizontal" }],
  });
  expect(created).toMatchObject({ id: "job-1", mode: "transform", status: "queued" });

  expect(await callTool(page, "list_augmentation_jobs", { limit: 20 })).toMatchObject({
    total: 1,
    status_counts: { active: 1 },
    items: [{ id: "job-1" }],
  });
  expect(await callTool(page, "get_augmentation_job", { job_id: "job-1" })).toMatchObject({
    id: "job-1",
    items: [],
  });
  expect(await callTool(page, "cancel_augmentation_job", { job_id: "job-1" })).toMatchObject({
    id: "job-1",
    status: "cancelled",
  });
  expect(await callTool(page, "retry_augmentation_job", { job_id: "job-1" })).toMatchObject({
    id: "job-1",
    status: "queued",
  });
  expect(await callTool(page, "get_studio")).toMatchObject({
    augmentation_jobs: { active: 1 },
  });
});

test("get_augmentation_job refreshes completed outputs without moving the canvas", async ({
  page,
}) => {
  await openStudio(page, [hand(REST_RIG)], { succeedAugmentationOnGet: true });
  await callTool(page, "create_augmentation_job", {
    mode: "transform",
    source_image_ids: [IID],
    variants_per_source: 1,
    seed: 42,
    pipeline: [{ op: "flip", axis: "horizontal" }],
  });

  expect(await callTool(page, "get_augmentation_job", { job_id: "job-1" })).toMatchObject({
    status: "succeeded",
    progress: { succeeded: 1 },
  });
  expect(await callTool(page, "get_studio")).toMatchObject({
    progress: { n: 2, empty: 1 },
    current: { id: IID },
  });
});

test("augmentation tools return explicit errors for missing ids and API failures", async ({ page }) => {
  await openStudio(page, [hand(REST_RIG)]);

  expect(await callTool(page, "get_augmentation_job", { job_id: "   " })).toEqual({
    error: "bad_job_id",
  });
  expect(await callTool(page, "list_augmentation_jobs", { limit: 0 })).toEqual({
    error: "bad_pagination",
  });
  expect(
    await callTool(page, "get_augmentation_job", { job_id: "job-1", item_limit: 201 }),
  ).toEqual({ error: "bad_pagination" });
  expect(await callTool(page, "cancel_augmentation_job", { job_id: "missing" })).toEqual({
    error: "augmentation_cancel_failed",
  });
  expect(await callTool(page, "retry_augmentation_job", { job_id: "missing" })).toEqual({
    error: "augmentation_retry_failed",
  });
});

for (const outcome of ["completed", "no_detection", "failed"] as const) {
  test(`open_image waits for generated-image Auto Label: ${outcome}`, async ({ page }) => {
    await openGeneratedStudio(page, outcome);

    const result = await callTool(page, "open_image", { index: 1 });

    expect(result).toMatchObject({
      current: {
        id: "generated",
        loading: false,
        auto_label_status: outcome,
      },
    });
  });
}

test("a no-detection frame can be committed as a reviewed negative sample", async ({ page }) => {
  await openGeneratedStudio(page, "no_detection");

  const opened = await callTool(page, "open_image", { index: 1 });
  expect(opened).toMatchObject({
    current: {
      id: "generated",
      objects: [],
      auto_label_status: "no_detection",
      can_commit: true,
      invalid_reasons: [],
    },
  });
  expect(await callTool(page, "commit_image")).toMatchObject({ ok: true });
});
