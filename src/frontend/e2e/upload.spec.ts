import { expect, test } from "@playwright/test";

test("video processing no longer offers a cancel action", async ({ page }) => {
  const pid = "upload-cancel-test";

  await page.route((url) => url.pathname.startsWith("/api/") || url.pathname === "/mock-s3", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (path === `/projects/${pid}`) {
      return route.fulfill({
        json: { id: pid, name: "Upload cancellation", type: "keypoints", template: "hand", classes: [] },
      });
    }
    if (path === `/projects/${pid}/images/presign`) {
      return route.fulfill({
        json: {
          items: [{ name: "demo.mov", key: `test/${pid}/demo.mov`, content_type: "video/quicktime", url: "/mock-s3" }],
        },
      });
    }
    if (path === "/mock-s3") return route.fulfill({ status: 200 });
    if (path === `/projects/${pid}/images/complete`) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      return route.fulfill({ json: [{ id: "frame-1" }] });
    }
    return route.fulfill({ status: 404 });
  });

  await page.goto(`/upload?id=${pid}`);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "demo.mov",
    mimeType: "video/quicktime",
    buffer: Buffer.from("video"),
  });
  await page.getByRole("button", { name: "Upload", exact: true }).click();

  await expect(page.getByText("Extracting frames…", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel upload", exact: true })).toBeHidden({ timeout: 1_000 });
  await expect(page.getByRole("button", { name: "Processing…", exact: true })).toBeDisabled();
});

test("mid-project upload opens the first new image beyond the stale catalog", async ({ page }) => {
  const pid = "mid-project-upload";
  const oldRows = Array.from({ length: 100 }, (_, i) => ({
    id: `old-${i}`,
    filename: `old-${i}.png`,
    committed: false,
    empty: true,
  }));
  const fresh = { id: "fresh-100", filename: "fresh.png", committed: false, empty: true };
  let uploaded = false;

  await page.route((url) => url.pathname.startsWith("/api/") || url.pathname === "/mock-s3", async (route) => {
    const request = route.request();
    const u = new URL(request.url());
    const path = u.pathname.replace(/^\/api/, "");
    if (path === `/projects/${pid}`) {
      return route.fulfill({ json: { id: pid, name: "Existing", type: "boxes", template: null, classes: [] } });
    }
    if (path === `/projects/${pid}/images` && request.method() === "GET") {
      const offset = Number(u.searchParams.get("offset") || 0);
      const all = uploaded ? [...oldRows, fresh] : oldRows;
      return route.fulfill({
        json: {
          items: all.slice(offset, offset + 100),
          total: all.length,
          committed: 0,
          empty: all.length,
          offset,
          limit: 100,
        },
      });
    }
    if (path === `/projects/${pid}/images/locate`) {
      return route.fulfill({ json: { index: 100, item: fresh } });
    }
    if (path === `/projects/${pid}/images/presign`) {
      return route.fulfill({
        json: {
          items: [{ name: "fresh.png", key: `test/${pid}/fresh.png`, content_type: "image/png", url: "/mock-s3" }],
        },
      });
    }
    if (path === "/mock-s3") return route.fulfill({ status: 200 });
    if (path === `/projects/${pid}/images/complete`) {
      uploaded = true;
      return route.fulfill({ json: [fresh] });
    }
    const image = path.match(new RegExp(`^/projects/${pid}/images/(.+)$`));
    if (image && request.method() === "GET") {
      const id = image[1];
      return route.fulfill({
        json: {
          id,
          image: id === fresh.id ? fresh.filename : `${id}.png`,
          url: "/default.jpg",
          committed: false,
          objects: [],
          history: [],
          comments: [],
        },
      });
    }
    return route.fulfill({ status: 404, body: `unmocked ${request.method()} ${path}` });
  });

  await page.goto(`/studio/${pid}`);
  await expect(page.locator("footer .nums")).toHaveText("1/100");
  await page.getByRole("button", { name: "Add media" }).click();
  await page.locator('.studio-upload input[type="file"]').first().setInputFiles({
    name: "fresh.png",
    mimeType: "image/png",
    buffer: Buffer.from("image"),
  });
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByRole("dialog", { name: "Add media" })).toBeHidden();
  await expect(page.locator("footer .nums")).toHaveText("101/101");
  await expect(page.locator("footer .file")).toContainText("fresh.png");
});

test("corrupt uploads identify the rejected file", async ({ page }) => {
  const pid = "corrupt-upload";
  await page.route((url) => url.pathname.startsWith("/api/") || url.pathname === "/mock-s3", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (path === `/projects/${pid}`) {
      return route.fulfill({ json: { id: pid, name: "Corrupt", type: "boxes", template: null, classes: [] } });
    }
    if (path === `/projects/${pid}/images/presign`) {
      return route.fulfill({
        json: {
          items: [{ name: "broken.jpg", key: `test/${pid}/broken.jpg`, content_type: "image/jpeg", url: "/mock-s3" }],
        },
      });
    }
    if (path === "/mock-s3") return route.fulfill({ status: 200 });
    if (path === `/projects/${pid}/images/complete`) {
      return route.fulfill({ status: 400, json: { detail: "corrupt:broken.jpg" } });
    }
    return route.fulfill({ status: 404 });
  });

  await page.goto(`/upload?id=${pid}`);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "broken.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("not an image"),
  });
  await page.getByRole("button", { name: "Upload", exact: true }).click();

  await expect(page.getByText("Could not read image: broken.jpg.", { exact: true })).toBeVisible();
});

test("empty uploads identify the rejected file", async ({ page }) => {
  const pid = "empty-upload";
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === `/projects/${pid}`) {
      return route.fulfill({ json: { id: pid, name: "Empty", type: "boxes", template: null, classes: [] } });
    }
    if (path === `/projects/${pid}/images/presign`) {
      return route.fulfill({ status: 400, json: { detail: "empty:blank.png" } });
    }
    return route.fulfill({ status: 404 });
  });

  await page.goto(`/upload?id=${pid}`);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "blank.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(0),
  });
  await page.getByRole("button", { name: "Upload", exact: true }).click();

  await expect(page.getByText("Empty file: blank.png.", { exact: true })).toBeVisible();
});

test("large batches use bounded concurrent S3 uploads", async ({ page }) => {
  const pid = "concurrent-upload";
  let active = 0;
  let peak = 0;
  await page.route((url) => url.pathname.startsWith("/api/") || url.pathname.startsWith("/mock-s3/"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (path === `/projects/${pid}`) {
      return route.fulfill({ json: { id: pid, name: "Batch", type: "boxes", template: null, classes: [] } });
    }
    if (path === `/projects/${pid}/images/presign`) {
      const body = request.postDataJSON() as { files: { name: string }[] };
      return route.fulfill({
        json: {
          items: body.files.map((file, i) => ({
            name: file.name,
            key: `test/${pid}/${i}/${file.name}`,
            content_type: "image/png",
            url: `/mock-s3/${i}`,
          })),
        },
      });
    }
    if (path.startsWith("/mock-s3/")) {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 100));
      active -= 1;
      return route.fulfill({ status: 200 });
    }
    if (path === `/projects/${pid}/images/complete`) {
      return route.fulfill({ json: [{ id: "new", filename: "frame-0.png" }] });
    }
    return route.fulfill({ status: 404 });
  });

  await page.goto(`/upload?id=${pid}`);
  await page.locator('input[type="file"]').first().setInputFiles(
    Array.from({ length: 8 }, (_, i) => ({
      name: `frame-${i}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(`image-${i}`),
    })),
  );
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/studio/${pid}`));

  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(4);
});

test("cancelling a batch discards presigned objects and skips completion", async ({ page }) => {
  const pid = "cancel-batch";
  let discarded: string[] = [];
  let completed = false;
  await page.route((url) => url.pathname.startsWith("/api/") || url.pathname.startsWith("/mock-s3/"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (path === `/projects/${pid}`) {
      return route.fulfill({ json: { id: pid, name: "Cancel", type: "boxes", template: null, classes: [] } });
    }
    if (path === `/projects/${pid}/images/presign`) {
      const body = request.postDataJSON() as { files: { name: string }[] };
      return route.fulfill({
        json: {
          items: body.files.map((file, i) => ({
            name: file.name,
            key: `test/${pid}/${i}/${file.name}`,
            content_type: "image/png",
            url: `/mock-s3/${i}`,
          })),
        },
      });
    }
    if (path.startsWith("/mock-s3/")) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return route.fulfill({ status: 200 });
    }
    if (path === `/projects/${pid}/images/uploads` && request.method() === "DELETE") {
      discarded = (request.postDataJSON() as { keys: string[] }).keys;
      return route.fulfill({ json: { deleted: discarded.length } });
    }
    if (path === `/projects/${pid}/images/complete`) {
      completed = true;
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ status: 404 });
  });

  await page.goto(`/upload?id=${pid}`);
  await page.locator('input[type="file"]').first().setInputFiles(
    Array.from({ length: 5 }, (_, i) => ({
      name: `frame-${i}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(`image-${i}`),
    })),
  );
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.getByRole("button", { name: "Cancel upload", exact: true }).click();

  await expect(page.getByText("Upload cancelled.", { exact: true })).toBeVisible();
  await expect.poll(() => discarded.length).toBe(5);
  expect(completed).toBe(false);
});
