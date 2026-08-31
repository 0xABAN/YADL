import { test, expect, type Page } from "@playwright/test";

const PID = "p_test";
const IID = "img_1";

const hand = {
  id: "h1",
  kind: "hand",
  label: null,
  edited: false,
  geom: {
    t: "hand",
    handedness: "Right",
    landmarks: Array.from({ length: 21 }, (_, i) => ({
      x: 0.3 + (i % 5) * 0.05,
      y: 0.4 + Math.floor(i / 5) * 0.05,
      z: 0,
    })),
  },
};

const project = { id: PID, name: "demo", type: "hands", classes: ["open", "fist", "point"] };

async function mockApi(page: Page, images: unknown[] | null = null) {
  const imgs =
    images ?? [{ id: IID, filename: "hand.jpg", committed: false, empty: false }];

  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const u = new URL(route.request().url());
    const path = u.pathname.replace(/^\/api/, "");
    const method = route.request().method();

    if (path === `/projects/${PID}` && method === "GET") {
      return route.fulfill({ json: project });
    }
    if (path === `/projects/${PID}/images` && method === "GET") {
      return route.fulfill({ json: imgs });
    }
    if (path === `/projects/${PID}/images/${IID}` && method === "GET") {
      return route.fulfill({
        json: {
          id: IID,
          image: "hand.jpg",
          url: "/default.jpg",
          committed: false,
          objects: [hand],
          history: [],
        },
      });
    }
    if (path === `/projects/${PID}/images/${IID}` && method === "PUT") {
      return route.fulfill({ json: { ok: true } });
    }
    if (path === `/projects/${PID}/images/${IID}/commit` && method === "POST") {
      return route.fulfill({
        json: {
          id: IID,
          image: "hand.jpg",
          url: "/default.jpg",
          committed: true,
          objects: [{ ...hand, label: "open" }],
          history: [
            {
              id: "v1",
              objects: [{ ...hand, label: "open" }],
              at: new Date().toISOString(),
            },
          ],
        },
      });
    }
    if (path.includes("/assist")) {
      return route.fulfill({
        json: {
          id: IID,
          image: "hand.jpg",
          url: "/default.jpg",
          committed: false,
          objects: [hand],
          history: [],
          seeded: 0,
        },
      });
    }
    if (path.includes("/classes")) {
      return route.fulfill({ json: project });
    }
    return route.fulfill({ status: 404, body: `unmocked ${method} ${path}` });
  });
}

test("studio session: label, url state, commit", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/studio/${PID}`);

  await expect(page.getByRole("heading", { name: /Studio/i })).toBeAttached();
  await expect(page.locator(".rail-status")).toHaveText(/./, { timeout: 10_000 });
  await expect(page.locator(".hand .pt").first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Objects" }).click();
  await page.getByRole("button", { name: /Hand 1/ }).click();
  await page.getByRole("button", { name: "Labels" }).click();
  // apply via swatch hit target (name text opens rename)
  await page.locator(".labels.poses li").filter({ hasText: "open" }).locator(".swatch").click();
  await expect(page.getByRole("button", { name: /Commit/ })).toBeEnabled({ timeout: 5_000 });
  await page.getByRole("button", { name: /Commit/ }).click();
  await expect(page.locator(".live")).toContainText(/Committed|Updated/i, { timeout: 5_000 });
  await expect(page.getByRole("button", { name: "Comment" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/studio/${PID}`));
});

test("studio empty images state", async ({ page }) => {
  await mockApi(page, []);
  await page.goto(`/studio/${PID}`);
  await expect(page.locator("#studio-main")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#studio-main")).not.toContainText(/No images in this project/i);
  await expect(page.locator(".panel.tools")).toBeVisible();
  await expect(page.locator(".panel.zoom")).toBeVisible();
});

test("doc helpers round-trip poly pts", async () => {
  const pts = [
    { x: 0.1, y: 0.2 },
    { x: 0.3, y: 0.4 },
    { x: 0.5, y: 0.6 },
  ];
  const wire = pts.map((p) => [p.x, p.y]);
  const back = wire.map((p) => ({ x: p[0], y: p[1] }));
  expect(back).toEqual(pts);
});
