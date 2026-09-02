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
