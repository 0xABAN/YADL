"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/doc";
import { registerWebMcpTools } from "@/lib/webmcp";

const EXAMPLES = [
  "faces", "hands", "dogs", "cats", "cars", "trucks", "buses", "bikes",
  "planes", "ships", "drones", "people", "crowds", "pedestrians", "cyclists",
  "animals", "birds", "fish", "sharks", "whales", "bees", "cattle", "horses",
  "wildlife", "weeds", "crops", "blight", "rust", "cracks", "leaks", "smoke",
  "flames", "floods", "potholes", "lane lines", "road signs", "stop signs",
  "plates", "helmets", "hard hats", "vests", "masks", "gloves", "seatbelts",
  "phones", "tumors", "lesions", "cells", "pills", "bones", "organs",
  "bacteria", "pollen", "flowers", "leaves", "fruit", "bruises", "mold",
  "pests", "mushrooms", "coral", "algae", "eggs", "nests", "tracks",
  "logos", "barcodes", "QR codes", "text", "handwriting", "receipts",
  "labels", "tickets", "passports", "graffiti", "defects", "dents",
  "scratches", "spills", "debris", "litter", "plastics", "oil spills",
  "clouds", "lightning", "aurora", "stars", "craters", "fossils", "gems",
  "coins", "stamps", "sneakers", "watches", "jewelry", "tools", "parts",
  "pallets", "forklifts", "parcels", "boxes", "shelves", "keypoints",
  "poses", "gestures", "blinks", "tattoos", "uniforms", "jerseys", "balls",
  "cones", "crosswalks", "bike lanes", "parking spots", "doors", "windows",
  "lights", "snow", "hail", "frost", "stumps", "knots", "tiles", "bricks",
  "cables", "chips", "wires", "meters", "gauges", "flares", "roofs",
  "tires", "brakes", "engines", "fabric", "stitches", "buttons", "zippers",
  "teeth", "cavities", "moles", "wounds", "burns", "vials", "colonies",
  "vessels", "nerves", "falls", "drowsiness", "queues", "desks", "chairs",
  "rooms", "trash", "players", "swings", "bins", "addresses", "seals",
  "toppings", "garnish", "allergens", "ripeness", "grapes", "apples",
  "tomatoes", "corn", "wheat", "rice", "trees", "logs", "ore", "dust",
  "solar panels", "damage", "wear", "syringes", "capsules", "retina",
  "emotions", "irises", "pupils", "eyes", "lips", "ASL signs",
  "yoga poses", "dance moves", "goal lines", "offside", "jersey numbers",
  "fill levels", "empty shelves", "price tags", "brand logos",
  "butterflies", "crop rows", "PCB faults", "weld beads", "solder gaps",
  "rust spots", "wind damage", "speed limits", "comic panels",
  "book spines", "wine labels", "album art", "latte art", "pizza",
  "sushi", "meat", "traffic cones", "fire hydrants", "streetlights",
  "power lines", "paw prints", "number plates", "smiles", "frowns",
  "fractures", "polyps", "nodules", "cataracts", "glaucoma",
  "misalignments", "missing parts", "loose bolts", "open valves",
  "products", "out of stock", "standing water", "bare soil",
  "deer", "bears", "foxes", "owls", "insects", "bats",
  "lane markings", "red lights", "mailboxes",
];

const TYPES = [
  { id: "boxes", name: "Bounding boxes", blurb: "Identify objects and their positions with bounding boxes." },
  { id: "polygons", name: "Polygons", blurb: "Detect objects and their actual shape." },
  { id: "keypoints", name: "Keypoints", blurb: "Identify landmarks on subjects (hand, pose, face)." },
] as const;

const TEMPLATES = [
  { id: "hand", name: "Hand" },
  { id: "pose", name: "Pose" },
  { id: "face", name: "Face" },
] as const;

function uploadPath(opts: {
  id?: string;
  name?: string;
  type?: string;
  template?: string;
  aim?: boolean;
  interval?: number;
}) {
  const u = new URLSearchParams();
  if (opts.id) u.set("id", opts.id);
  if (opts.name) u.set("name", opts.name);
  if (opts.type) u.set("type", opts.type);
  if (opts.template) u.set("template", opts.template);
  if (opts.aim) u.set("aim", "1");
  if (opts.interval != null) u.set("interval", String(opts.interval));
  const q = u.toString();
  return q ? `/upload?${q}` : "/upload";
}

export default function New() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]["id"]>("boxes");
  const [template, setTemplate] = useState<(typeof TEMPLATES)[number]["id"]>("hand");
  const [err, setErr] = useState<"empty" | "taken" | null>(null);
  const [rows, setRows] = useState<Project[]>([]);
  const [ex, setEx] = useState(0);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    // old phone QR /create?up=1&name=… → /upload
    const q = new URLSearchParams(window.location.search);
    if (q.get("up") === "1") {
      const n = (q.get("name") || "").trim();
      const t = q.get("type") || undefined;
      const tmpl = q.get("template") || undefined;
      if (n) {
        router.replace(uploadPath({ name: n, type: t, template: tmpl }));
      }
    }
  }, [router]);

  useEffect(() => {
    fetch("/api/projects").then((r) => {
      if (r.status === 401) {
        location.href = "/auth";
        return [];
      }
      return r.json();
    }).then((d) => setRows(Array.isArray(d) ? d : []));
  }, []);

  useEffect(() => {
    const t = setInterval(() => setEx((i) => {
      let n = i % EXAMPLES.length;
      while (n === i % EXAMPLES.length) n = Math.floor(Math.random() * EXAMPLES.length);
      return n;
    }), 2200);
    return () => clearInterval(t);
  }, []);

  const create = () => {
    const n = name.trim();
    if (!n) {
      setErr("empty");
      return;
    }
    if (rows.some((p) => p.name === n)) {
      setErr("taken");
      return;
    }
    setErr(null);
    router.push(
      uploadPath({
        name: n,
        type,
        template: type === "keypoints" ? template : undefined,
      }),
    );
  };

  useEffect(() => {
    const ac = new AbortController();
    void registerWebMcpTools(
      [
        {
          name: "list_projects",
          description: "List the user's recent YADL projects (id, name, type, template).",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          execute: async () => {
            const r = await fetch("/api/projects");
            if (r.status === 401) return { error: "auth_required" };
            if (!r.ok) return { error: "list_failed", status: r.status };
            const data = await r.json();
            return { projects: Array.isArray(data) ? data : [] };
          },
        },
        {
          name: "create_project",
          description:
            "Create a labeling project. type is boxes, polygons, or keypoints. For keypoints, pass template hand|pose|face (default hand). Does not upload files.",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Project name" },
              type: {
                type: "string",
                enum: ["boxes", "polygons", "keypoints"],
                description: "Annotation type",
              },
              template: {
                type: "string",
                enum: ["hand", "pose", "face"],
                description: "Keypoint skeleton when type=keypoints",
              },
            },
            required: ["name", "type"],
            additionalProperties: false,
          },
          execute: async (args) => {
            const n = String(args.name ?? "").trim();
            const t = args.type as string;
            if (!n) return { error: "empty_name" };
            if (t !== "boxes" && t !== "polygons" && t !== "keypoints") return { error: "bad_type" };
            const tmpl =
              t === "keypoints"
                ? args.template === "pose" || args.template === "face" || args.template === "hand"
                  ? args.template
                  : "hand"
                : undefined;
            setName(n);
            setType(t);
            if (tmpl) setTemplate(tmpl);
            setErr(null);
            const r = await fetch("/api/projects", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: n, type: t, ...(tmpl ? { template: tmpl } : {}) }),
            });
            const p = await r.json().catch(() => ({}));
            if (r.status === 409) {
              setErr("taken");
              return { error: "name_taken" };
            }
            if (!r.ok || !p.id) {
              return { error: "create_failed", status: r.status, detail: p.detail };
            }
            setRows((rs) => [p as Project, ...rs.filter((x) => x.id !== p.id)]);
            const upload_url = uploadPath({ id: String(p.id) });
            return {
              project: p,
              studio_url: `/studio/${p.id}`,
              upload_url,
              next: "Call prepare_media_upload with this project id (or open upload_url), then computer-use Select files → choose media → Upload.",
            };
          },
        },
        {
          name: "open_project",
          description: "Open a project studio by id or exact name.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
            },
            additionalProperties: false,
          },
          execute: async (args) => {
            let id = typeof args.id === "string" ? args.id.trim() : "";
            if (!id && typeof args.name === "string") {
              const want = args.name.trim();
              const hit = rowsRef.current.find((p) => p.name === want);
              if (hit) id = hit.id;
              else {
                const r = await fetch("/api/projects");
                const data = r.ok ? await r.json() : [];
                const list = Array.isArray(data) ? (data as Project[]) : [];
                const found = list.find((p) => p.name === want);
                if (found) id = found.id;
              }
            }
            if (!id) return { error: "not_found" };
            router.push(`/studio/${id}`);
            return { opened: id, studio_url: `/studio/${id}` };
          },
        },
        {
          name: "prepare_media_upload",
          description:
            "Prepare media upload for an existing project. Opens /upload for project_id, optional frame_interval, aims Select files. Does not upload — computer use finishes picker and Upload.",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "Project id from create_project or list_projects" },
              frame_interval: {
                type: "number",
                description: "Seconds between video frames (0.1–5).",
              },
            },
            required: ["project_id"],
            additionalProperties: false,
          },
          execute: async (args) => {
            const project_id = String(args.project_id ?? "").trim();
            if (!project_id) {
              return { error: "missing_project_id", code: "missing_project_id", message: "project_id is required" };
            }
            const check = await fetch(`/api/projects/${project_id}`);
            if (check.status === 404) {
              return { error: "not_found", code: "not_found", message: "project not found", project_id };
            }
            if (check.status === 401) {
              return { error: "auth_required", code: "auth_required", message: "sign in required" };
            }
            if (!check.ok) {
              return { error: "project_check_failed", code: "project_check_failed", status: check.status, project_id };
            }
            const proj = (await check.json().catch(() => null)) as Project | null;
            const interval =
              typeof args.frame_interval === "number" && Number.isFinite(args.frame_interval)
                ? args.frame_interval
                : undefined;
            const upload_url = uploadPath({ id: project_id, aim: true, interval });
            router.push(upload_url);
            return {
              prepared: true,
              project_id,
              project: proj,
              frame_interval: interval,
              upload_url,
              needs_user_gesture: true,
              target: { label: "Select files", selector: '[data-webmcp="select-files"]' },
              next: "Upload page highlights Select files. Computer use: click it, choose media, then Upload.",
            };
          },
        },
      ],
      ac.signal,
    );
    return () => ac.abort();
  }, [router]);

  const sheetRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const [guide, setGuide] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    const side = sideRef.current;
    if (!sheet || !side) return;
    const place = () => {
      const s = sheet.getBoundingClientRect();
      const p = side.getBoundingClientRect();
      const left = s.left - 100;
      const top = p.bottom + 20;
      setGuide((g) => (g && g.left === left && g.top === top ? g : { left, top }));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(sheet);
    ro.observe(side);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [rows.length]);

  return (
    <div className="create">
      {guide && (
        <div
          className="create-guide"
          aria-hidden="true"
          style={{ left: guide.left, top: guide.top }}
        />
      )}
      <a className="word" href="/create">
        yadl.
      </a>
      <nav className="create-nav" aria-label="Credit">
        <div className="marquee">
          <div className="marquee-track">
            {[0, 1].map((half) => (
              <span key={half} aria-hidden={half === 1 || undefined}>
                {Array.from({ length: 12 }, (_, i) => (
                  <span key={i} className="marquee-item">
                    made for the 2026 webmcp challenge
                    <span className="marquee-sep" aria-hidden="true">
                      •
                    </span>
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>
      </nav>
      <h1>
        let&apos;s detect <span className="ex">{EXAMPLES[ex % EXAMPLES.length]}</span>
      </h1>
      <div className="body">
        <div className="split">
          <div className="sheet" ref={sheetRef}>
            <div className="fields">
              <p className="k">Project name</p>
              <input
                type="text"
                aria-label="Project name"
                value={name}
                placeholder="E.g., 'Dog Breeds'"
                onChange={(e) => {
                  setName(e.target.value);
                  if (err) setErr(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && create()}
              />
              <small className="err" aria-live="polite">
                {err === "empty" ? "Name cannot be empty." : err === "taken" ? "Name already exists." : ""}
              </small>
            </div>
            <div className="types">
              <div className="type-group">
                {TYPES.map((t) =>
                  t.id === "keypoints" ? (
                    <div
                      key={t.id}
                      className="type-card"
                      data-on={type === "keypoints" || undefined}
                      role="button"
                      tabIndex={0}
                      aria-pressed={type === "keypoints"}
                      onClick={() => setType("keypoints")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setType("keypoints");
                        }
                      }}
                    >
                      <b>{t.name}</b>
                      <span>{t.blurb}</span>
                      <div
                        className="tmpl"
                        role="group"
                        aria-label="Keypoint template"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {TEMPLATES.map((tmpl) => (
                          <button
                            key={tmpl.id}
                            type="button"
                            aria-pressed={type === "keypoints" && template === tmpl.id}
                            onClick={() => {
                              setType("keypoints");
                              setTemplate(tmpl.id);
                            }}
                          >
                            {tmpl.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <button key={t.id} type="button" aria-pressed={type === t.id} onClick={() => setType(t.id)}>
                      <b>{t.name}</b>
                      <span>{t.blurb}</span>
                    </button>
                  ),
                )}
              </div>
            </div>
            <button className="commit" type="button" onClick={create}>
              Create Project
            </button>
          </div>
          <div className="history" ref={sideRef}>
            <h2>Recent</h2>
            {rows.length === 0 ? (
              <p className="empty">No projects yet.</p>
            ) : (
              <div className="history-list">
                {rows.map((p) => (
                  <div key={p.id} className="row">
                    <a href={`/studio/${p.id}`}>
                      {p.name}
                      <small>{TYPES.find((t) => t.id === p.type)?.name ?? p.type}</small>
                    </a>
                    <button
                      type="button"
                      aria-label="delete"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!confirm(`Delete ${p.name}?`)) return;
                        const id = p.id;
                        setRows((rs) => rs.filter((x) => x.id !== id));
                        fetch(`/api/projects/${id}`, { method: "DELETE" }).then((r) => {
                          if (!r.ok) setRows((rs) => (rs.some((x) => x.id === id) ? rs : [...rs, p]));
                        }).catch(() => setRows((rs) => (rs.some((x) => x.id === id) ? rs : [...rs, p])));
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
