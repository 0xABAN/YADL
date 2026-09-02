"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/modules/studio/geometry/doc";
import ConfirmDialog from "@/modules/studio/ui/ConfirmDialog";
import CreateChrome from "@/modules/studio/ui/CreateChrome";
import { createPageTools } from "@/modules/create/createTools";
import { fetchProjects } from "@/modules/create/projectsApi";
import { uploadPath } from "@/modules/create/projectRoutes";
import { registerWebMcpTools } from "@/shared/webmcp";
import { useRotatingIndex } from "@/modules/create/useRotatingIndex";
import { useSheetGuide } from "@/modules/create/useSheetGuide";
import { apiResult } from "@/shared/api/client";

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

export default function New() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]["id"]>("boxes");
  const [template, setTemplate] = useState<(typeof TEMPLATES)[number]["id"]>("hand");
  const [err, setErr] = useState<"empty" | "taken" | null>(null);
  const [rows, setRows] = useState<Project[]>([]);
  const [pendingDel, setPendingDel] = useState<Project | null>(null);
  const [agentNotice, setAgentNotice] = useState<string | null>(null);
  const agentToolTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ex = useRotatingIndex(EXAMPLES.length);
  const rowsRef = useRef(rows);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const guide = useSheetGuide(sheetRef, sideRef);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("up") === "1") {
      const n = (q.get("name") || "").trim();
      if (n) {
        router.replace(
          uploadPath({ name: n, type: q.get("type") || undefined, template: q.get("template") || undefined }),
        );
      }
    }
  }, [router]);

  useEffect(() => {
    void fetchProjects().then((r) => {
      if (!r.ok) {
        if (r.error === "auth_required") router.replace("/auth");
        return;
      }
      setRows(r.projects);
    });
  }, [router]);

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

  const showAgentTool = useCallback((toolName: string) => {
    if (agentToolTimer.current) clearTimeout(agentToolTimer.current);
    setAgentNotice(`Agent used \`${toolName}\``);
    agentToolTimer.current = setTimeout(() => setAgentNotice(null), 1600);
  }, []);

  const showRegistrationError = useCallback((toolName: string) => {
    if (agentToolTimer.current) clearTimeout(agentToolTimer.current);
    setAgentNotice(`Could not register \`${toolName}\``);
    agentToolTimer.current = setTimeout(() => setAgentNotice(null), 5000);
  }, []);

  useEffect(() => () => {
    if (agentToolTimer.current) clearTimeout(agentToolTimer.current);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void registerWebMcpTools(
      createPageTools({
        router,
        getRows: () => rowsRef.current,
        onCreated: (p) => setRows((rs) => [p, ...rs.filter((x) => x.id !== p.id)]),
      }),
      ac.signal,
      { onInvoke: showAgentTool, onRegistrationError: showRegistrationError },
    );
    return () => ac.abort();
  }, [router, showAgentTool, showRegistrationError]);

  return (
    <div className="create">
      {guide && (
        <div
          className="create-guide"
          aria-hidden="true"
          style={{ left: guide.left, top: guide.top }}
        />
      )}
      <CreateChrome />
      <h1>
        let&apos;s detect <span className="ex">{EXAMPLES[ex]}</span>
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
                        setPendingDel(p);
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
      <ConfirmDialog
        open={!!pendingDel}
        message={pendingDel ? `Delete ${pendingDel.name}?` : ""}
        onCancel={() => setPendingDel(null)}
        onConfirm={() => {
          const p = pendingDel;
          setPendingDel(null);
          if (!p) return;
          const id = p.id;
          setRows((rs) => rs.filter((x) => x.id !== id));
          void apiResult(`/projects/${id}`, { method: "DELETE", raw: true }).then((r) => {
            if (!r.ok) setRows((rs) => (rs.some((x) => x.id === id) ? rs : [...rs, p]));
          });
        }}
      />
      {agentNotice && (
        <div className="live create-agent-live" aria-live="polite">
          {agentNotice}
        </div>
      )}
    </div>
  );
}
