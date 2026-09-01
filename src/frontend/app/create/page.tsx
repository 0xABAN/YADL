"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/doc";
import UploadPanel, { type SubmitOpts, type UploadPanelHandle } from "@/components/UploadPanel";
import QrCard from "@/components/QrCard";
import { uploadFiles } from "@/lib/upload";
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

const DATA = [
  "data", "images", "frames", "photos", "pictures", "shots", "stills",
  "files", "samples", "examples", "batches", "media", "captures",
  "scans", "snaps", "assets", "inputs", "sets", "packs", "lots",
];

function upErr(status: number, detail?: string): string {
  const d = (detail || "").toLowerCase();
  if (status === 409 || d.includes("taken")) return "Name already exists.";
  if (d.includes("ffmpeg")) return "Video tools unavailable (ffmpeg).";
  if (d.includes("video")) return "Could not read video.";
  if (d.includes("files") || status === 400) return "Upload rejected (type, size, or count).";
  return "Upload failed.";
}

export default function New() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]["id"]>("boxes");
  const [template, setTemplate] = useState<(typeof TEMPLATES)[number]["id"]>("hand");
  const [err, setErr] = useState<"empty" | "taken" | null>(null);
  const [upMsg, setUpMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<Project[]>([]);
  const [ex, setEx] = useState(0);
  const [step, setStep] = useState<"form" | "up">("form");
  const [busy, setBusy] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const [agentPid, setAgentPid] = useState<string | null>(null);
  const uploadRef = useRef<UploadPanelHandle>(null);
  const nameRef = useRef(name);
  const typeRef = useRef(type);
  const templateRef = useRef(template);
  const stepRef = useRef(step);
  const rowsRef = useRef(rows);
  const agentPidRef = useRef(agentPid);
  nameRef.current = name;
  typeRef.current = type;
  templateRef.current = template;
  stepRef.current = step;
  rowsRef.current = rows;
  agentPidRef.current = agentPid;

  useEffect(() => {
    // resume upload step from phone QR (?name=&type=&up=1)
    const q = new URLSearchParams(window.location.search);
    if (q.get("up") === "1") {
      const n = (q.get("name") || "").trim();
      const t = q.get("type");
      if (n) setName(n);
      if (t === "boxes" || t === "polygons" || t === "keypoints" || t === "hands") {
        setType(t === "hands" ? "keypoints" : t);
      }
      const tmpl = q.get("template");
      if (tmpl === "hand" || tmpl === "pose" || tmpl === "face") setTemplate(tmpl);
      if (n) setStep("up");
    }
  }, []);

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
    if (step !== "up" || typeof window === "undefined") return;
    const u = new URL("/create", window.location.origin);
    u.searchParams.set("up", "1");
    u.searchParams.set("name", name.trim());
    u.searchParams.set("type", type);
    if (type === "keypoints") u.searchParams.set("template", template);
    setQrUrl(u.toString());
  }, [step, name, type, template]);

  useEffect(() => {
    const list = step === "form" ? EXAMPLES : DATA;
    const t = setInterval(() => setEx((i) => {
      let n = i % list.length;
      while (n === i % list.length) n = Math.floor(Math.random() * list.length);
      return n;
    }), 2200);
    return () => clearInterval(t);
  }, [step]);

  const go = (next: "form" | "up") => {
    const run = () => flushSync(() => setStep(next));
    if ("startViewTransition" in document) document.startViewTransition(run);
    else run();
  };

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
    setUpMsg(null);
    go("up");
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
            setAgentPid(String(p.id));
            setRows((rs) => [p as Project, ...rs.filter((x) => x.id !== p.id)]);
            go("up");
            return {
              project: p,
              studio_url: `/studio/${p.id}`,
              next: "Call upload_images to open the file picker, then use computer use to choose files and submit.",
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
          name: "upload_images",
          description:
            "Prepare the upload step file picker. Does not upload or submit. Browsers block programmatic pickers without a real click — after calling this, use computer use to click the highlighted control labeled Select files (data-webmcp=select-files), choose files, then click Upload.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          execute: async () => {
            if (stepRef.current !== "up") {
              return { error: "not_on_upload_step", hint: "create_project first or open upload UI" };
            }
            const r = uploadRef.current?.openFilePicker() ?? { opened: false, needsClick: true };
            return {
              ...r,
              target: { label: "Select files", selector: '[data-webmcp="select-files"]' },
              next: "Computer use: click Select files, choose files in the OS dialog, then click Upload.",
            };
          },
        },
      ],
      ac.signal,
    );
    return () => ac.abort();
  }, [router]);

  const send = async (files: File[], opts: SubmitOpts) => {
    if (!files.length || busy) return;
    setBusy(true);
    setUpMsg(null);
    let pid: string | null = agentPid;
    let createdHere = false;
    try {
      if (!pid) {
        const r = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            type,
            ...(type === "keypoints" ? { template } : {}),
          }),
          signal: opts.signal,
        });
        const p = await r.json().catch(() => ({}));
        if (r.status === 409) {
          setErr("taken");
          setUpMsg("Name already exists.");
          go("form");
          return;
        }
        if (!r.ok || !p.id) {
          setUpMsg(upErr(r.status, typeof p.detail === "string" ? p.detail : undefined));
          return;
        }
        pid = p.id as string;
        createdHere = true;
        setAgentPid(pid);
      }
      const up = await uploadFiles(`/api/projects/${pid}/images`, files, {
        interval: opts.interval,
        signal: opts.signal,
        onProgress: opts.onProgress,
      });
      if (!up.ok) {
        const detail =
          up.json && typeof up.json === "object" && up.json !== null && "detail" in up.json
            ? String((up.json as { detail: unknown }).detail)
            : undefined;
        if (createdHere) fetch(`/api/projects/${pid}`, { method: "DELETE" });
        setUpMsg(upErr(up.status, detail));
        return;
      }
      router.push(`/studio/${pid}`);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        if (createdHere && pid) fetch(`/api/projects/${pid}`, { method: "DELETE" });
        setUpMsg("Upload cancelled.");
        return;
      }
      if (createdHere && pid) fetch(`/api/projects/${pid}`, { method: "DELETE" });
      setUpMsg("Upload failed.");
    } finally {
      setBusy(false);
    }
  };

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
      // locked anchors: 100px left of sheet, 20px under Recent/QR only (not sheet) → viewport BR
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
  }, [step, rows.length, qrUrl]);

  return (
    <div className={step === "up" ? "create up" : "create"}>
      {guide && (
        <div
          className={step === "up" ? "create-guide up" : "create-guide"}
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
        {step === "form" ? (
          <>let&apos;s detect <span className="ex">{EXAMPLES[ex % EXAMPLES.length]}</span></>
        ) : (
          <>
            <button type="button" className="back" aria-label="Back" onClick={() => go("form")}>
              <svg viewBox="0 0 256 256" width="1em" height="1em" aria-hidden="true"><path d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z" fill="currentColor" /></svg>
            </button>
            upload <span className="ex">{DATA[ex % DATA.length]}</span>
          </>
        )}
      </h1>
      <div className="body">
        <div className={step === "up" ? "split up" : "split"}>
        <div className="sheet" ref={sheetRef}>
          {step === "form" ? (
            <>
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
            </>
          ) : (
            <UploadPanel ref={uploadRef} busy={busy} err={upMsg} onSubmit={send} />
          )}
        </div>
        {step === "up" ? (
          <QrCard ref={sideRef} url={qrUrl} />
        ) : (
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
        )}
        </div>
      </div>
    </div>
  );
}
