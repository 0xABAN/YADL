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

test("create stays usable and preserves guide anchors in a narrow app panel", async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 900 });
  await mockProjects(page);
  await page.goto("/create");

  await expect(page.locator(".history")).toBeVisible();
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
  const layout = await layoutRects(page, ".qr-side");

  expect(layout.sheet.width).toBeLessThanOrEqual(340);
  expect(layout.side.right).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.pageWidth).toBe(layout.viewportWidth);
  expect(layout.guide.left).toBeCloseTo(layout.sheet.left - 100, 0);
  expect(layout.guide.top).toBeCloseTo(layout.side.bottom + 20, 0);
});
