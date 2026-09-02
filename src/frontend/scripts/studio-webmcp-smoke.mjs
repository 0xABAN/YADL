/**
 * Live Studio WebMCP smoke via Playwright.
 * Polyfills document.modelContext (no Chrome WebMCP flag required),
 * auths with sid cookie, opens /studio/:id, executes the 8 tools.
 *
 * Usage:
 *   node scripts/studio-webmcp-smoke.mjs
 * Env: BASE=http://localhost:3000  EMAIL=… PASSWORD=…  (optional PROJECT_ID)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3000";
const EMAIL = process.env.EMAIL || "smoke@test.local";
const PASSWORD = process.env.PASSWORD || "smoke-test-pass";
const API = BASE.replace(/\/$/, "") + "/api";

async function api(path, { method = "GET", body, cookie } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text}`);
  return { json, headers: r.headers, status: r.status };
}

function pickSid(setCookie) {
  if (!setCookie) return null;
  const parts = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of parts) {
    const m = String(c).match(/^sid=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}

async function ensureAuth() {
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
  const setCookies =
    typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [];
  const sid = pickSid(setCookies.length ? setCookies : r.headers.get("set-cookie"));
  return sid ? `sid=${sid}` : null;
}

async function ensureProject(cookie) {
  if (process.env.PROJECT_ID) return process.env.PROJECT_ID;
  const { json: projects } = await api("/projects", { cookie });
  let p = (projects || []).find((x) => x.name === "webmcp-studio-smoke");
  if (!p) {
    ({ json: p } = await api("/projects", {
      method: "POST",
      cookie,
      body: { name: "webmcp-studio-smoke", type: "boxes" },
    }));
  }
  const { json: imgs } = await api(`/projects/${p.id}/images`, { cookie });
  if (!imgs?.length) {
    // upload via multipart
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAD0lEQVR4nGNgYGD4z0ACYAAAAP//AwAJ/AL+5Y4sWQAAAABJRU5ErkJggg==",
      "base64",
    );
    const fd = new FormData();
    fd.append("files", new Blob([png], { type: "image/png" }), "smoke.png");
    const up = await fetch(`${API}/projects/${p.id}/images`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: fd,
    });
    if (!up.ok) throw new Error(`upload ${up.status} ${await up.text()}`);
  }
  const { json: list } = await api(`/projects/${p.id}/images`, { cookie });
  const iid = list[0].id;
  await api(`/projects/${p.id}/images/${iid}`, {
    method: "PUT",
    cookie,
    body: {
      id: iid,
      image: list[0].filename || "smoke.png",
      objects: [
        {
          id: "obj_1",
          kind: "box",
          label: null,
          edited: false,
          geom: { t: "box", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        },
        {
          id: "obj_2",
          kind: "box",
          label: null,
          edited: false,
          geom: { t: "box", x: 0.5, y: 0.5, w: 0.15, h: 0.15 },
        },
      ],
    },
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  let cookie = await ensureAuth();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  if (!cookie) {
    // login via UI/API in browser
    const page0 = await context.newPage();
    await page0.goto(`${BASE}/auth`);
    // try API from page
    const sid = await page0.evaluate(async ({ email, password, api }) => {
      let r = await fetch(`${api}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });
      if (!r.ok) {
        r = await fetch(`${api}/auth/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
          credentials: "include",
        });
      }
      return document.cookie;
    }, { email: EMAIL, password: PASSWORD, api: API });
    console.log("browser auth cookies:", sid);
    await page0.close();
  } else {
    await context.addCookies([
      {
        name: "sid",
        value: cookie.replace(/^sid=/, ""),
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  }

  // ensure project using cookie from context
  const cookies = await context.cookies();
  const sidCookie = cookies.find((c) => c.name === "sid");
  assert(sidCookie, "no sid cookie after auth");
  const cookieHeader = `sid=${sidCookie.value}`;
  const projectId = await ensureProject(cookieHeader);
  const url = `${BASE}/studio/${projectId}`;
  console.log("studio", url);

  await context.addInitScript(WEBMCP_POLYFILL);
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("console.error:", m.text());
  });
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });

  // wait for tools
  await page.waitForFunction(
    () => (window.__webmcpNames?.() || []).includes("get_studio"),
    null,
    { timeout: 15_000 },
  );
  const names = await page.evaluate(() => window.__webmcpNames());
  console.log("tools:", names.join(", "));
  const expected = [
    "studio_guide",
    "get_studio",
    "open_image",
    "set_label",
    "delete_object",
    "commit_image",
    "delete_image",
    "get_comments",
    "comment",
  ];
  for (const n of expected) assert(names.includes(n), `missing tool ${n}`);

  const call = (name, args = {}) =>
    page.evaluate(({ name, args }) => window.__webmcpCall(name, args), { name, args });

  // 1 get_studio
  let snap = await call("get_studio");
  console.log("get_studio progress", snap.progress, "current", snap.current?.id, "objs", snap.current?.objects);
  assert(snap.project?.id === projectId, "project id");
  assert(snap.current?.objects?.some((o) => o.id === "obj_1"), "obj_1 present");
  assert(snap.current?.can_commit === false, "cannot commit unlabeled");
  assert(Array.isArray(snap.current?.unlabeled) && snap.current.unlabeled.includes("obj_1"), "unlabeled");

  // 2 set_label
  let cur = await call("set_label", { object_id: "obj_1", label: "dog" });
  console.log("set_label", cur.current?.objects, "can_commit", cur.current?.can_commit);
  assert(cur.current?.objects?.find((o) => o.id === "obj_1")?.label === "dog", "label dog");
  assert(cur.current?.can_commit === true, "can commit after label");

  // 3 delete_object junk
  cur = await call("delete_object", { object_id: "obj_2" });
  assert(!cur.current?.objects?.some((o) => o.id === "obj_2"), "obj_2 gone");
  assert(cur.current?.objects?.length === 1, "one object left");

  // 4 comment add
  let comments = await call("comment", { op: "add", body: "smoke note" });
  console.log("comment add", comments.comments);
  assert(comments.comments?.some((c) => c.body === "smoke note"), "comment body");
  const cid = comments.comments.find((c) => c.body === "smoke note").id;

  // 5 studio_guide
  const guide = await call("studio_guide");
  assert(Array.isArray(guide.guide) && guide.guide.length > 0, "guide tips");
  assert(!guide.geometry_tools?.includes?.("open_upload"), "no upload tool");

  // 6 commit_image
  const committed = await call("commit_image");
  console.log("commit", committed);
  assert(committed.ok === true, "commit ok");
  assert(committed.current?.committed === true || committed.advanced !== undefined, "committed state");

  // 7 open_image index 0 (still only one image after commit advance may stay)
  snap = await call("get_studio");
  const open = await call("open_image", { index: 0 });
  assert(open.current?.index === 0, "open index 0");

  // 8 next_uncommitted may error if none — ok
  const next = await call("open_image", { next_uncommitted: true });
  console.log("next_uncommitted", next);

  // comment delete
  comments = await call("comment", { op: "delete", id: cid });
  assert(!comments.comments?.some((c) => c.id === cid), "comment deleted");

  // skip delete_image (destructive on shared smoke project) — call then we could restore
  // verify tool exists by dry discovery only already done

  console.log("\nPASS studio webmcp smoke");
  await browser.close();
}

main().catch(async (e) => {
  console.error("\nFAIL", e);
  process.exitCode = 1;
});
