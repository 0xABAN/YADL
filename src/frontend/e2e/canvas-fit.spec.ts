import { test, expect, type Page } from "@playwright/test";

const PID = "p_fit";
const IID = "img_fit";

async function mockStudio(page: Page) {
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const u = new URL(route.request().url());
    const path = u.pathname.replace(/^\/api/, "");
    const method = route.request().method();

    if (path === `/projects/${PID}` && method === "GET") {
      return route.fulfill({
        json: { id: PID, name: "fit", type: "boxes", template: null, classes: [] },
      });
    }
    if (path === `/projects/${PID}/images` && method === "GET") {
      return route.fulfill({
        json: [{ id: IID, filename: "default.jpg", committed: false, empty: true }],
      });
    }
    const img = path.match(new RegExp(`^/projects/${PID}/images/([^/]+)$`));
    if (img && method === "GET") {
      return route.fulfill({
        json: {
          id: IID,
          image: "default.jpg",
          url: "/default.jpg",
          committed: false,
          objects: [],
          history: [],
          comments: [],
        },
      });
    }
    if (img && method === "PUT") return route.fulfill({ json: { ok: true } });
    if (path.includes("/assist")) {
      return route.fulfill({
        json: {
          id: IID,
          image: "default.jpg",
          url: "/default.jpg",
          committed: false,
          objects: [],
          history: [],
          comments: [],
        },
      });
    }
    return route.fulfill({ status: 404, json: { detail: "nope" } });
  });
}

async function imageCenterError(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    const img = document.querySelector(".world img") as HTMLImageElement | null;
    if (!main || !img || !img.naturalWidth) return { ok: false, reason: "missing" };

    const mr = main.getBoundingClientRect();
    const pad =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rail-pad")) || 12;
    const stack = document.querySelector(".shell .stack")?.getBoundingClientRect();
    const footer = document.querySelector(".shell footer")?.getBoundingClientRect();
    const left = (stack ? stack.right - mr.left : 0) + pad;
    const right = mr.width - pad;
    const top = pad;
    const bottom = (footer ? footer.top - mr.top : mr.height) - pad;
    const free = {
      left: mr.left + left,
      top: mr.top + top,
      width: right - left,
      height: bottom - top,
    };
    const ir = img.getBoundingClientRect();
    const dx = ir.left + ir.width / 2 - (free.left + free.width / 2);
    const dy = ir.top + ir.height / 2 - (free.top + free.height / 2);
    return {
      ok: true,
      dx,
      dy,
      centered: Math.abs(dx) < 16 && Math.abs(dy) < 16,
      fits:
        ir.left >= free.left - 4 &&
        ir.top >= free.top - 4 &&
        ir.right <= free.left + free.width + 4 &&
        ir.bottom <= free.top + free.height + 4,
    };
  });
}

for (const vp of [
  { w: 1440, h: 900 },
  { w: 1100, h: 800 },
  { w: 900, h: 700 },
]) {
  test(`canvas centers image at ${vp.w}x${vp.h}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await mockStudio(page);
    await page.goto(`/studio/${PID}`);
    await expect(page.locator(".world img.ready")).toBeVisible({ timeout: 15_000 });
    // let fit rAF settle
    await page.waitForTimeout(200);
    await page.locator("button", { hasText: "RESET" }).click();
    await page.waitForTimeout(100);

    const m = await imageCenterError(page);
    expect(m.ok).toBe(true);
    expect(m.fits, `fits free space @ ${vp.w}x${vp.h}: ${JSON.stringify(m)}`).toBe(true);
    expect(m.centered, `centered @ ${vp.w}x${vp.h}: ${JSON.stringify(m)}`).toBe(true);
  });
}

test("dots cover full main (no edge gap)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockStudio(page);
  await page.goto(`/studio/${PID}`);
  await expect(page.locator(".world img.ready")).toBeVisible({ timeout: 15_000 });

  const cover = await page.evaluate(() => {
    const main = document.querySelector("main");
    const dots = document.querySelector("main > .dots") as HTMLElement | null;
    if (!main || !dots) return null;
    const mr = main.getBoundingClientRect();
    const dr = dots.getBoundingClientRect();
    return {
      main: { w: mr.width, h: mr.height },
      dots: { w: dr.width, h: dr.height, left: dr.left - mr.left, top: dr.top - mr.top },
    };
  });
  expect(cover).not.toBeNull();
  expect(cover!.dots.left).toBeLessThanOrEqual(1);
  expect(cover!.dots.top).toBeLessThanOrEqual(1);
  expect(cover!.dots.w).toBeGreaterThanOrEqual(cover!.main.w - 2);
  expect(cover!.dots.h).toBeGreaterThanOrEqual(cover!.main.h - 2);
});
