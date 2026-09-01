"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/doc";
import UploadPanel, { type SubmitOpts } from "@/components/UploadPanel";
import QrCard from "@/components/QrCard";
import { uploadFiles } from "@/lib/upload";

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
  { id: "hands", name: "Landmarks", blurb: "Identify keypoints on subjects." },
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
  const [err, setErr] = useState<"empty" | "taken" | null>(null);
  const [upMsg, setUpMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<Project[]>([]);
  const [ex, setEx] = useState(0);
  const [step, setStep] = useState<"form" | "up">("form");
  const [busy, setBusy] = useState(false);
  const [qrUrl, setQrUrl] = useState("");

  useEffect(() => {
    // resume upload step from phone QR (?name=&type=&up=1)
    const q = new URLSearchParams(window.location.search);
    if (q.get("up") === "1") {
      const n = (q.get("name") || "").trim();
      const t = q.get("type");
      if (n) setName(n);
      if (t === "boxes" || t === "polygons" || t === "hands") setType(t);
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
    setQrUrl(u.toString());
  }, [step, name, type]);

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

  const send = async (files: File[], opts: SubmitOpts) => {
    if (!files.length || busy) return;
    setBusy(true);
    setUpMsg(null);
    let pid: string | null = null;
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type }),
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
        fetch(`/api/projects/${pid}`, { method: "DELETE" });
        setUpMsg(upErr(up.status, detail));
        return;
      }
      router.push(`/studio/${pid}`);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        if (pid) fetch(`/api/projects/${pid}`, { method: "DELETE" });
        setUpMsg("Upload cancelled.");
        return;
      }
      if (pid) fetch(`/api/projects/${pid}`, { method: "DELETE" });
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
      // horizontal: sheet − 100 (unchanged); vertical: 20px below Recent/QR
      setGuide({ left: s.left - 100, top: p.bottom + 20 });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(sheet);
    ro.observe(side);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
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
            {TYPES.map((t) => (
              <button key={t.id} type="button" aria-pressed={type === t.id} onClick={() => setType(t.id)}>
                <b>{t.name}</b>
                <span>{t.blurb}</span>
              </button>
            ))}
          </div>
          <button className="commit" type="button" onClick={create}>
            Create Project
          </button>
            </>
          ) : (
            <UploadPanel busy={busy} err={upMsg} onSubmit={send} />
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
