/**
 * Live box + polygon WebMCP smoke via Playwright.
 * Polyfills document.modelContext; real browser; tools on /studio/:id.
 *
 * Usage: node scripts/shape-webmcp-smoke.mjs
 * Env: BASE EMAIL PASSWORD
 */
import { chromium } from "playwright";
import { join } from "path";
import { tmpdir } from "os";

const BASE = process.env.BASE || "http://localhost:3000";
const EMAIL = process.env.EMAIL || "shape-smoke@test.local";
const PASSWORD = process.env.PASSWORD || "shape-smoke-pass";
const API = `${BASE.replace(/\/$/, "")}/api`;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function pickSid(setCookies) {
  const parts = Array.isArray(setCookies) ? setCookies : setCookies ? [setCookies] : [];
  for (const c of parts) {
    const m = String(c).match(/^sid=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}

async function api(path, { method = "GET", body, cookie, formData } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: formData ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text}`);
  return json;
}

async function ensureAuthCookie(context) {
  let r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!r.ok) {
    r = await fetch(`${API}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
  }
  const sid = pickSid(typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : []);
  assert(sid, "no sid from auth");
  await context.addCookies([
    { name: "sid", value: sid, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  return `sid=${sid}`;
}

function tinyPng() {
  // 64x64 so natural-px too_small threshold is meaningful
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAiklEQVR4nO3RMQ0AIAwAsVGdkf8fQwQY2J1s8u5d7wUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOA1AAP+Af8OAADgB0gAAAD//wMAF0oB/1sG0c0AAAAASUVORK5CYII=",
    "base64",
  );
}

async function ensureProject(cookie, type) {
  const name = `shape-smoke-${type}-${Date.now()}`;
  const p = await api("/projects", {
    method: "POST",
    cookie,
    body: { name, type },
  });
  const fd = new FormData();
  fd.append("files", new Blob([tinyPng()], { type: "image/png" }), `${type}.png`);
  await api(`/projects/${p.id}/images`, { method: "POST", cookie, formData: fd });
  const imgs = await api(`/projects/${p.id}/images`, { cookie });
  const iid = imgs[0].id;
  await api(`/projects/${p.id}/images/${iid}`, {
    method: "PUT",
    cookie,
    body: { id: iid, image: imgs[0].filename || `${type}.png`, objects: [] },
  });
  return p.id;
}

const WEBMCP_POLYFILL = `
(() => {
  if (document.modelContext?.registerTool) return;
  const tools = new Map();
  document.modelContext = {
    registerTool(tool, opts) {
      if (opts?.signal?.aborted) return;
      tools.set(tool.name, tool);
      opts?.signal?.addEventListener("abort", () => tools.delete(tool.name));
    },
  };
  window.__webmcpTools = tools;
  window.__webmcpCall = async (name, args = {}) => {
    const t = tools.get(name);
    if (!t) throw new Error("missing tool " + name);
    return await t.execute(args);
  };
  window.__webmcpNames = () => [...tools.keys()];
})();
`;

async function openStudio(context, projectId) {
  const url = `${BASE}/studio/${projectId}`;
  console.log("studio", url);
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("console.error:", m.text());
  });
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForSelector("main, .studio, #studio-main", { timeout: 15_000 }).catch(() => {});
  return page;
}

async function waitTools(page, required) {
  await page.waitForFunction(
    (need) => need.every((n) => (window.__webmcpNames?.() || []).includes(n)),
    required,
    { timeout: 25_000 },
  );
  const names = await page.evaluate(() => window.__webmcpNames());
  console.log("tools:", names.join(", "));
  for (const n of required) assert(names.includes(n), `missing ${n}`);
  return names;
}

const call =
  (page) =>
  (name, args = {}) =>
    page.evaluate(({ name, args }) => window.__webmcpCall(name, args), { name, args });

async function smokeBoxes(page) {
  console.log("\n--- boxes ---");
  await waitTools(page, ["get_studio", "get_boxes", "add_box", "set_box", "set_label", "commit_image"]);
  const c = call(page);

  // wait for image decode so dims available for px path
  await page.waitForTimeout(800);

  let g = await c("get_boxes");
  console.log("get_boxes empty", g.n, "dims", g.image_width, g.image_height);
  assert(g.n === 0, "start empty");
  assert(g.coord_space === "norm", "coord_space");
  // dims may be null briefly; retry once
  if (g.image_width == null) {
    await page.waitForTimeout(1500);
    g = await c("get_boxes");
  }
  assert(g.image_width > 0 && g.image_height > 0, "image size known");

  // need_unit
  const nu = await c("add_box", { x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
  assert(nu.error === "need_unit", `need_unit got ${JSON.stringify(nu)}`);

  // add labeled box
  let b = await c("add_box", {
    unit: "norm",
    x: 0.2,
    y: 0.2,
    w: 0.4,
    h: 0.4,
    label: "car",
  });
  console.log("add_box", b.object_id, b.geom, "clamped", b.clamped_keys);
  assert(b.kind === "box", "kind");
  assert(b.label === "car", "label on add");
  assert(Math.abs(b.geom.x - 0.2) < 1e-6, "x");
  assert(b.coord_space === "norm", "echo coord");
  const oid = b.object_id;

  // clamp overflow
  b = await c("set_box", { object_id: oid, unit: "norm", x: 0.9, w: 0.5 });
  console.log("set_box clamp", b.geom, b.clamped_keys);
  assert(b.geom.x + b.geom.w <= 1.0001, "contained");
  assert(b.clamped_keys?.includes("w") || b.geom.w <= 0.1001, "clamped w");

  // second box → need_object_id
  const b2 = await c("add_box", { unit: "norm", x: 0.05, y: 0.05, w: 0.15, h: 0.15, label: "bike" });
  assert(b2.object_id !== oid, "second id");
  const bad = await c("set_box", { unit: "norm", w: 0.2 });
  assert(bad.error === "need_object_id", "need_object_id");

  // px path
  const px = await c("add_box", {
    unit: "px",
    x: 8,
    y: 8,
    w: 24,
    h: 24,
    label: "pxbox",
  });
  console.log("add_box px", px.geom);
  assert(px.geom.x > 0 && px.geom.x < 1, "px→norm");
  assert(px.coord_space === "norm", "stored norm");

  // too_small
  const tiny = await c("add_box", { unit: "norm", x: 0.5, y: 0.5, w: 0.001, h: 0.001 });
  assert(tiny.error === "too_small", `too_small got ${JSON.stringify(tiny)}`);

  // UI: click commit
  const commitBtn = page.getByRole("button", { name: /commit/i }).first();
  if (await commitBtn.count()) {
    console.log("click commit (UI)");
    await commitBtn.click({ force: true }).catch(() => {});
  }

  const commit = await c("commit_image");
  console.log("commit", commit);
  assert(commit.ok === true || commit.error === undefined || commit.advanced !== undefined, "commit");

  // get_studio still geometry-free
  const st = await c("get_studio");
  const slim = st.current?.objects?.[0];
  if (slim) assert(slim.geom === undefined, "get_studio no geom");

  const shot = join(tmpdir(), `box-smoke-${Date.now()}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  console.log("screenshot", shot);
  console.log("PASS boxes");
}

async function smokePolys(page) {
  console.log("\n--- polygons ---");
  await waitTools(page, [
    "get_studio",
    "get_polygons",
    "add_polygon",
    "set_polygon",
    "set_label",
    "commit_image",
  ]);
  const c = call(page);
  await page.waitForTimeout(800);

  let g = await c("get_polygons");
  if (g.image_width == null) {
    await page.waitForTimeout(1500);
    g = await c("get_polygons");
  }
  assert(g.n === 0, "start empty");
  assert(g.image_width > 0, "dims");

  // object pts + label
  let p = await c("add_polygon", {
    unit: "norm",
    pts: [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.5, y: 0.8 },
    ],
    label: "region",
  });
  console.log("add_polygon", p.object_id, p.geom.pts.length);
  assert(p.kind === "polygon", "kind");
  assert(p.label === "region", "label");
  assert(p.geom.pts.length === 3, "3 pts");
  const oid = p.object_id;

  // flat pts
  const flat = await c("add_polygon", {
    unit: "norm",
    pts: [0.1, 0.1, 0.3, 0.1, 0.2, 0.3],
    label: "flat",
  });
  assert(flat.geom.pts.length === 3, "flat→3");

  // multi need_object_id
  const bad = await c("set_polygon", {
    unit: "norm",
    pts: [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.1 },
      { x: 0.15, y: 0.2 },
    ],
  });
  assert(bad.error === "need_object_id", "need_object_id");

  // full replace
  p = await c("set_polygon", {
    object_id: oid,
    unit: "norm",
    pts: [
      { x: 0.3, y: 0.3 },
      { x: 0.7, y: 0.3 },
      { x: 0.5, y: 0.7 },
    ],
  });
  assert(Math.abs(p.geom.pts[0].x - 0.3) < 1e-6, "replaced");

  // min pts
  const few = await c("set_polygon", {
    object_id: oid,
    unit: "norm",
    pts: [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
    ],
  });
  assert(few.error === "need_min_3_pts" || few.error === "bad_geom", "min pts");

  // clamp
  p = await c("set_polygon", {
    object_id: oid,
    unit: "norm",
    pts: [
      { x: -0.1, y: 0.1 },
      { x: 1.2, y: 0.1 },
      { x: 0.5, y: 0.9 },
    ],
  });
  console.log("clamp", p.geom.pts[0], p.clamped_keys);
  assert(p.geom.pts[0].x === 0, "clamped x");
  assert(p.clamped_keys?.length > 0, "clamped_keys");

  const commit = await c("commit_image");
  console.log("commit", commit);
  assert(commit.ok === true || commit.advanced !== undefined || !commit.error, "commit");

  // UI click filmstrip-ish next if present
  const nextBtn = page.getByRole("button", { name: /next/i }).first();
  if (await nextBtn.count()) {
    console.log("click next");
    await nextBtn.click().catch(() => {});
  }

  const shot = join(tmpdir(), `poly-smoke-${Date.now()}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  console.log("screenshot", shot);
  console.log("PASS polygons");
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(WEBMCP_POLYFILL);
  const cookie = await ensureAuthCookie(context);

  const boxId = await ensureProject(cookie, "boxes");
  const boxPage = await openStudio(context, boxId);
  await smokeBoxes(boxPage);
  await boxPage.close();

  const polyId = await ensureProject(cookie, "polygons");
  const polyPage = await openStudio(context, polyId);
  await smokePolys(polyPage);
  await polyPage.close();

  console.log("\nPASS shape webmcp smoke (boxes + polygons)");
  await browser.close();
}

main().catch((e) => {
  console.error("\nFAIL", e);
  process.exitCode = 1;
});
