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

    // same live-chrome free rect as Canvas.freeRect (viewport coords)
    const mr = main.getBoundingClientRect();
    const pad =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rail-pad")) || 12;
    const aside = document.querySelector(".shell aside")?.getBoundingClientRect();
    const stack = document.querySelector(".shell .stack")?.getBoundingClientRect();
    const footer = document.querySelector(".shell footer")?.getBoundingClientRect();
    const leftEdge = Math.max(aside?.right ?? mr.left, stack?.right ?? mr.left);
    const free = {
      left: leftEdge + pad,
      top: mr.top + pad,
      width: Math.max(1, mr.right - leftEdge - pad * 2),
      height: Math.max(1, (footer?.top ?? mr.bottom) - mr.top - pad * 2),
    };
    const freeCx = free.left + free.width / 2;
    const freeCy = free.top + free.height / 2;
    const ir = img.getBoundingClientRect();
    const imgCx = ir.left + ir.width / 2;
    const imgCy = ir.top + ir.height / 2;
    return {
      ok: true,
      dx: imgCx - freeCx,
      dy: imgCy - freeCy,
      free,
      img: { w: ir.width, h: ir.height, left: ir.left, top: ir.top },
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
    expect(m.fits, `image should fit free rect @ ${vp.w}x${vp.h}: ${JSON.stringify(m)}`).toBe(true);
    expect(Math.abs(m.dx!), `dx ${m.dx} @ ${vp.w}x${vp.h}`).toBeLessThan(24);
    expect(Math.abs(m.dy!), `dy ${m.dy} @ ${vp.w}x${vp.h}`).toBeLessThan(24);
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
