import { expect, test, type Page } from "@playwright/test";

const recentProject = {
  id: "p_recent",
  name: "test",
  type: "keypoints",
  template: "hand",
  classes: [],
};

async function mockProjects(page: Page) {
  await page.route("**/api/projects", async (route) => {
    await route.fulfill({ json: [recentProject] });
  });
}

async function layoutRects(page: Page, sideSelector: ".history" | ".qr-side") {
  return page.evaluate((selector) => {
    const rect = (query: string) => {
      const node = document.querySelector(query);
      if (!node) throw new Error(`Missing ${query}`);
      const value = node.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
      };
    };

    return {
      viewportWidth: window.innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      sheet: rect(".create .sheet"),
      side: rect(selector),
      guide: rect(".create-guide"),
    };
  }, sideSelector);
}

async function waitForGuideAnchors(page: Page, sideSelector: ".history" | ".qr-side") {
  await expect.poll(async () => {
    const layout = await layoutRects(page, sideSelector);
    return {
      left: Math.round(layout.guide.left - Math.max(0, layout.sheet.left - 100)),
      top: Math.round(layout.guide.top - (layout.side.bottom + 20)),
    };
  }).toEqual({ left: 0, top: 0 });
}

test("create stays usable and preserves guide anchors in a narrow app panel", async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 900 });
  await mockProjects(page);
  await page.goto("/create");

  await expect(page.locator(".history")).toBeVisible();
  await waitForGuideAnchors(page, ".history");
  const layout = await layoutRects(page, ".history");

  expect(layout.sheet.width).toBeLessThanOrEqual(400);
  expect(layout.side.width).toBeLessThanOrEqual(170);
  expect(layout.side.right).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.pageWidth).toBe(layout.viewportWidth);
  expect(layout.guide.left).toBeCloseTo(layout.sheet.left - 100, 0);
  expect(layout.guide.top).toBeCloseTo(layout.side.bottom + 20, 0);

  await page.getByRole("button", { name: "Keypoints" }).click();
  await page.getByRole("button", { name: "Face", exact: true }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("responsive project");
  await page.getByRole("button", { name: "Create Project" }).click();
  await expect(page).toHaveURL(/\/upload\?name=responsive\+project&type=keypoints&template=face$/);
});

test("upload keeps its QR panel and guide anchors in a narrow app panel", async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 900 });
  await page.goto("/upload?name=responsive&type=keypoints&template=hand");

  await expect(page.locator(".qr-side")).toBeVisible();
  await expect(page.locator(".qr-frame img")).toBeVisible();
  await waitForGuideAnchors(page, ".qr-side");
  const layout = await layoutRects(page, ".qr-side");

  expect(layout.sheet.width).toBeLessThanOrEqual(400);
  expect(layout.side.right).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.pageWidth).toBe(layout.viewportWidth);
  expect(layout.guide.left).toBeCloseTo(layout.sheet.left - 100, 0);
  expect(layout.guide.top).toBeCloseTo(layout.side.bottom + 20, 0);
});

test("create keeps the side-by-side composition at the smallest panel width that fits it", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await mockProjects(page);
  await page.goto("/create");

  await expect(page.locator(".history")).toBeVisible();
  await waitForGuideAnchors(page, ".history");
  const layout = await layoutRects(page, ".history");

  expect(layout.sheet.width).toBeLessThanOrEqual(340);
  expect(layout.side.right).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.pageWidth).toBe(layout.viewportWidth);
  expect(layout.guide.left).toBeCloseTo(layout.sheet.left - 100, 0);
  expect(layout.guide.top).toBeCloseTo(layout.side.bottom + 20, 0);
});

test("upload keeps the QR beside the sheet at the smallest panel width that fits it", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto("/upload?name=responsive&type=keypoints&template=hand");

  await expect(page.locator(".qr-side")).toBeVisible();
  await waitForGuideAnchors(page, ".qr-side");
  const layout = await layoutRects(page, ".qr-side");

  expect(layout.sheet.width).toBeLessThanOrEqual(340);
  expect(layout.side.right).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.pageWidth).toBe(layout.viewportWidth);
  expect(layout.guide.left).toBeCloseTo(layout.sheet.left - 100, 0);
  expect(layout.guide.top).toBeCloseTo(layout.side.bottom + 20, 0);
});

test("create stacks Recent above the sheet when the panel can no longer fit both", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 900 });
  await mockProjects(page);
  await page.goto("/create");

  await expect(page.locator(".create-guide")).toBeVisible();
  await waitForGuideAnchors(page, ".history");
  const layout = await layoutRects(page, ".history");

  expect(layout.side.bottom).toBeLessThanOrEqual(layout.sheet.top);
  expect(layout.side.right).toBeCloseTo(layout.sheet.right, 0);
  expect(layout.pageWidth).toBe(layout.viewportWidth);
  expect(layout.guide.left).toBeGreaterThanOrEqual(0);
  expect(layout.guide.left).toBeLessThan(layout.sheet.left);
  expect(layout.guide.top).toBeCloseTo(layout.side.bottom + 20, 0);
});

test("upload stacks its QR above the sheet when the panel can no longer fit both", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 900 });
  await page.goto("/upload?name=responsive&type=keypoints&template=hand");

  await expect(page.locator(".qr-frame img")).toBeVisible();
  await waitForGuideAnchors(page, ".qr-side");
  const layout = await layoutRects(page, ".qr-side");

  expect(layout.side.bottom).toBeLessThanOrEqual(layout.sheet.top);
  expect(layout.side.right).toBeCloseTo(layout.sheet.right, 0);
  expect(layout.pageWidth).toBe(layout.viewportWidth);
  expect(layout.guide.left).toBeGreaterThanOrEqual(0);
  expect(layout.guide.left).toBeLessThan(layout.sheet.left);
  expect(layout.guide.top).toBeCloseTo(layout.side.bottom + 20, 0);
});
