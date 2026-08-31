"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/doc";

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

const EXTS = ".jpg,.jpeg,.png,.webp,.avif,.bmp,.heic,.heif,.zip";
const DATA = [
  "data", "images", "frames", "photos", "pictures", "shots", "stills",
  "files", "samples", "examples", "batches", "media", "captures",
  "scans", "snaps", "assets", "inputs", "sets", "packs", "lots",
];

export default function New() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]["id"]>("boxes");
  const [vis, setVis] = useState<"Private" | "Public">("Private");
  const [err, setErr] = useState<"empty" | "taken" | "fail" | null>(null);
  const [rows, setRows] = useState<Project[]>([]);
  const [ex, setEx] = useState(0);
  const [step, setStep] = useState<"form" | "up">("form");
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

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
    go("up");
  };

  const take = (list: FileList | File[]) => {
    setFiles([...list].filter((f) => EXTS.split(",").some((e) => f.name.toLowerCase().endsWith(e))));
  };

  const send = async () => {
    if (!files.length || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type }),
      });
      const p = await r.json();
      if (r.status === 409) {
        setErr("taken");
        return;
      }
      if (!r.ok || !p.id) {
        setErr("fail");
        return;
      }
      const body = new FormData();
      files.forEach((f) => body.append("files", f));
      const up = await fetch(`/api/projects/${p.id}/images`, { method: "POST", body });
      if (!up.ok) {
        fetch(`/api/projects/${p.id}`, { method: "DELETE" });
        setErr("fail");
        return;
      }
      router.push(`/studio/${p.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={step === "up" ? "create up" : "create"}>
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
          <>let's detect <span className="ex">{EXAMPLES[ex % EXAMPLES.length]}</span></>
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
        <div className="sheet">
          {step === "form" ? (
            <>
          <div className="fields">
            <p className="k">Project name</p>
            <p className="k">Visibility</p>
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
            <div className="vis">
              <button type="button" aria-pressed={vis === "Private"} onClick={() => setVis("Private")}>
                <svg viewBox="0 0 256 256" width="14" height="14" aria-hidden="true"><path d="M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96Z" fill="currentColor" /></svg>
                Private
              </button>
              <button type="button" aria-pressed={vis === "Public"} onClick={() => setVis("Public")}>
                <svg viewBox="0 0 256 256" width="14" height="14" aria-hidden="true"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm88,104a87.61,87.61,0,0,1-3.33,24H170.87a140.36,140.36,0,0,0,0-48h41.8A87.61,87.61,0,0,1,216,128ZM128,40a87.61,87.61,0,0,1,24,3.33V85.13a140.36,140.36,0,0,0-48,0V43.33A87.61,87.61,0,0,1,128,40ZM40,128a87.61,87.61,0,0,1,3.33-24h41.8a140.36,140.36,0,0,0,0,48H43.33A87.61,87.61,0,0,1,40,128Zm88,88a87.61,87.61,0,0,1-24-3.33V170.87a140.36,140.36,0,0,0,48,0v41.8A87.61,87.61,0,0,1,128,216Z" fill="currentColor" /></svg>
                Public
              </button>
            </div>
            {err === "empty" && <small className="err">Name cannot be empty.</small>}
            {err === "taken" && <small className="err">Name already exists.</small>}
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
            Create {vis} Project
          </button>
            </>
          ) : (
            <>
              <div
                className={over ? "drop over" : "drop"}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  take(e.dataTransfer.files);
                }}
              >
                {files.length > 0 && <p className="picked">{files.length} selected</p>}
                <p className="lead">Drag and drop to upload, or:</p>
                <div className="picks">
                  <label className="pick">
                    Select files
                    <input type="file" accept={EXTS} multiple hidden onChange={(e) => e.target.files && take(e.target.files)} />
                  </label>
                  <label className="pick">
                    Select folder
                    <input type="file" multiple hidden ref={(n) => n?.setAttribute("webkitdirectory", "true")} onChange={(e) => e.target.files && take(e.target.files)} />
                  </label>
                </div>
                <div className="formats">
                  <b>Supported</b>
                  {EXTS.replaceAll(",", " ")}
                </div>
              </div>
              {err === "taken" && <small className="err">Name already exists.</small>}
              {err === "fail" && <small className="err">Upload failed.</small>}
              <button className="commit" type="button" disabled={!files.length || busy} onClick={send}>
                {busy ? "Uploading" : "Upload"}
              </button>
              <a className="skip" href="/auth">Skip</a>
            </>
          )}
        </div>
        <div className="history">
          <h2>Open</h2>
          {rows.length === 0 ? (
            <p className="empty">No projects yet.</p>
          ) : (
            rows.slice(0, 3).map((p) => (
              <div key={p.id} className="row">
                <a href={`/studio/${p.id}`}>
                  {p.name}
                  <small>{p.type}</small>
                </a>
                <button
                  type="button"
                  aria-label="delete"
                  onClick={() => {
                    if (!confirm(`Delete ${p.name}?`)) return;
                    fetch(`/api/projects/${p.id}`, { method: "DELETE" }).then((r) => {
                      if (r.ok) setRows((rs) => rs.filter((x) => x.id !== p.id));
                    });
                  }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
