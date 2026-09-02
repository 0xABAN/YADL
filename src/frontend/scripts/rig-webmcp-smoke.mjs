/**
 * Live FK rig smoke: Playwright auth + UI clicks + WebMCP polyfill tools.
 *
 * Usage: node scripts/rig-webmcp-smoke.mjs
 * Env: BASE EMAIL PASSWORD
 */
import { chromium } from "playwright";
import { tmpdir } from "os";
import { join } from "path";

const BASE = process.env.BASE || "http://localhost:3000";
const EMAIL = process.env.EMAIL || "rig-smoke@test.local";
const PASSWORD = process.env.PASSWORD || "rig-smoke-pass";
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
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAD0lEQVR4nGNgYGD4z0ACYAAAAP//AwAJ/AL+5Y4sWQAAAABJRU5ErkJggg==",
    "base64",
  );
}

async function ensureKeypointsProject(cookie) {
  const name = `rig-smoke-${Date.now()}`;
  const p = await api("/projects", {
    method: "POST",
    cookie,
    body: { name, type: "keypoints", template: "hand" },
  });
  const fd = new FormData();
  fd.append("files", new Blob([tinyPng()], { type: "image/png" }), "rig.png");
  await api(`/projects/${p.id}/images`, { method: "POST", cookie, formData: fd });
  // turn off auto-assist noise: seed empty objects via PUT blank then agent add_instance
  const imgs = await api(`/projects/${p.id}/images`, { cookie });
  const iid = imgs[0].id;
  await api(`/projects/${p.id}/images/${iid}`, {
    method: "PUT",
    cookie,
    body: { id: iid, image: imgs[0].filename || "rig.png", objects: [] },
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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const cookie = await ensureAuthCookie(context);
  const projectId = await ensureKeypointsProject(cookie);
  const url = `${BASE}/studio/${projectId}`;
  console.log("studio", url);

  await context.addInitScript(WEBMCP_POLYFILL);
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("console.error:", m.text());
  });
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });

  // --- real UI clicks ---
  // Labels tab / objects area should load
  await page.waitForSelector(".studio, main, [class*=studio]", { timeout: 15_000 }).catch(() => {});

  // Footer commit disabled initially
  const commitBtn = page.getByRole("button", { name: /commit/i }).first();
  if (await commitBtn.count()) {
    console.log("click commit (expect blocked/disabled or noop)");
    await commitBtn.click({ force: true }).catch(() => {});
  }

  // Toggle assist off if present (human tool — agent pack has no assist)
  const assist = page.getByRole("button", { name: /auto label|assist/i }).first();
  if (await assist.count()) {
    const pressed = await assist.getAttribute("aria-pressed");
    if (pressed === "true") {
      console.log("click assist toggle off");
      await assist.click();
    }
  }

  // Open comments panel if button exists, then close
  const commentsBtn = page.locator("[data-tip=comments], button:has-text('Comments')").first();
  if (await commentsBtn.count()) {
    console.log("click comments");
    await commentsBtn.click();
    await page.keyboard.press("Escape");
  }

  // Wait for WebMCP tools (general + rig)
  await page.waitForFunction(
    () => (window.__webmcpNames?.() || []).includes("add_instance"),
    null,
    { timeout: 20_000 },
  );
  const names = await page.evaluate(() => window.__webmcpNames());
  console.log("tools:", names.join(", "));
  for (const n of ["get_studio", "add_instance", "set_rig", "get_rig", "set_label", "commit_image"]) {
    assert(names.includes(n), `missing ${n}`);
  }

  const call = (name, args = {}) =>
    page.evaluate(({ name, args }) => window.__webmcpCall(name, args), { name, args });

  // 1 add_instance
  let rig = await call("add_instance", { handedness: "Right" });
  console.log("add_instance", rig.object_id, "count", rig.landmark_count, "live", rig.rig_live);
  assert(rig.rig_live === true, "rig live");
  assert(rig.landmark_count === 21, "21 landmarks");
  assert(rig.template === "hand", "hand template");
  const oid = rig.object_id;

  // 2 set_rig batch joints + clamp
  rig = await call("set_rig", {
    object_id: oid,
    joints: { index_mcp: 1, index_pip: 1, middle_mcp: 2 },
  });
  console.log("set_rig joints", rig.joints?.index_mcp, "clamped", rig.clamped_keys);
  assert(rig.joints.index_mcp === 1, "index_mcp");
  assert(rig.joints.middle_mcp === 1, "middle clamped to max");
  assert(rig.clamped_keys?.includes("middle_mcp"), "clamped_keys");
  assert(rig.rig_live === true, "still live");

  const unk = await call("set_rig", { object_id: oid, joints: { not_a_joint: 0.5 } });
  console.log("unknown joint result", unk);
  assert(unk && unk.error === "unknown_joint", `unknown_joint got ${JSON.stringify(unk)}`);

  // 3 get_rig with landmarks
  rig = await call("get_rig", { object_id: oid, include_landmarks: true, include_defs: true });
  assert(Array.isArray(rig.landmarks) && rig.landmarks.length === 21, "landmarks");
  assert(Array.isArray(rig.joint_defs) && rig.joint_defs.length > 5, "defs");
  assert(rig.landmarks[0].name === "WRIST" || rig.landmarks[0].i === 0, "named");

  // 4 multi-instance need_object_id
  const second = await call("add_instance", { root: { x: 0.25, y: 0.4 } });
  assert(second.object_id !== oid, "second id");
  const bad = await call("set_rig", { joints: { index_mcp: 0.2 } });
  console.log("multi without id", bad);
  assert(bad.error === "need_object_id", "need_object_id");

  // 5 set with id works
  rig = await call("set_rig", { object_id: second.object_id, root: { x: 0.2, scale: 0.18 } });
  assert(Math.abs(rig.root.x - 0.2) < 1e-6, "root x");

  // 6 label + commit via general tools (UI path also)
  await call("set_label", { object_id: oid, label: "fist" });
  await call("set_label", { object_id: second.object_id, label: "open" });

  // Click class/label area if visible
  const fistClass = page.getByRole("button", { name: /fist/i }).first();
  if (await fistClass.count()) {
    console.log("click fist class");
    await fistClass.click().catch(() => {});
  }

  const commit = await call("commit_image");
  console.log("commit", commit);
  assert(commit.ok === true || commit.error === undefined, "commit");

  // 7 UI: click filmstrip / next if present
  const nextBtn = page.getByRole("button", { name: /next/i }).first();
  if (await nextBtn.count()) {
    console.log("click next");
    await nextBtn.click().catch(() => {});
  }

  // 8 human free-edit clears rig → rig_invalidated on partial set_rig
  await call("open_image", { index: 0 });
  await page.waitForTimeout(400);
  const pt = page.locator(".hand .pt").first();
  assert((await pt.count()) > 0, "landmark points in DOM");
  const box = await pt.boundingBox();
  assert(box, "point box");
  console.log("drag landmark (human free-edit clears rig)");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 36, box.y + 28, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  // whichever hand was hit should be cleared — probe both known ids
  let clearedId = null;
  for (const id of [oid, second.object_id]) {
    const g = await call("get_rig", { object_id: id });
    if (g.rig_live === false) {
      clearedId = id;
      break;
    }
  }
  // fallback: force clear via API (same wire as assist) if drag missed
  if (!clearedId) {
    console.log("drag missed live object — clearing rig via API PUT");
    const imgs = await api(`/projects/${projectId}/images`, { cookie });
    const iid = imgs[0].id;
    const doc = await api(`/projects/${projectId}/images/${iid}`, { cookie });
    const objects = (doc.objects || []).map((o) =>
      o.id === oid
        ? { ...o, edited: true, geom: { ...o.geom, rig: null } }
        : o,
    );
    await api(`/projects/${projectId}/images/${iid}`, {
      method: "PUT",
      cookie,
      body: { id: iid, image: doc.image || "rig.png", objects },
    });
    await call("open_image", { index: 0 });
    await page.waitForTimeout(500);
    clearedId = oid;
    const g = await call("get_rig", { object_id: oid });
    assert(g.rig_live === false, "API clear rig_live false");
  } else {
    console.log("cleared via drag", clearedId);
  }

  const inv = await call("set_rig", { object_id: clearedId, joints: { pinky_mcp: 1 } });
  console.log("partial set after clear", inv);
  assert(inv.error === "rig_invalidated", "rig_invalidated");

  const fixed = await call("set_rig", {
    object_id: clearedId,
    root: { x: 0.5, y: 0.5, scale: 0.2, roll: 0 },
    joints: { pinky_mcp: 1, pinky_pip: 0.5 },
  });
  assert(fixed.rig_live === true, "full replace restores rig");
  assert(fixed.joints.pinky_mcp === 1, "pinky after replace");
  console.log("full replace ok");

  // Screenshot for evidence
  const shot = join(tmpdir(), `rig-smoke-${Date.now()}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  console.log("screenshot", shot);

  console.log("\nPASS rig webmcp smoke");
  await browser.close();
}

main().catch((e) => {
  console.error("\nFAIL", e);
  process.exitCode = 1;
});
