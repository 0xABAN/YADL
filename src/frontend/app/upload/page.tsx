"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/doc";
import CreateChrome from "@/components/CreateChrome";
import UploadPanel, { type SubmitOpts } from "@/components/UploadPanel";
import QrCard from "@/components/QrCard";
import { createProject, parseProjectType, parseTemplate } from "@/lib/projectsApi";
import { uploadPath } from "@/lib/projectRoutes";
import { uploadFiles } from "@/lib/upload";
import { useRotatingIndex } from "@/lib/useRotatingIndex";
import { useSheetGuide } from "@/lib/useSheetGuide";

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

export default function UploadPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<"boxes" | "polygons" | "keypoints">("boxes");
  const [template, setTemplate] = useState<"hand" | "pose" | "face">("hand");
  const [pid, setPid] = useState<string | null>(null);
  const [upMsg, setUpMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const [ready, setReady] = useState(false);
  const ex = useRotatingIndex(DATA.length);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const guide = useSheetGuide(sheetRef, sideRef);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = (q.get("id") || "").trim();
    const n = (q.get("name") || "").trim();

    const boot = async () => {
      if (id) {
        const r = await fetch(`/api/projects/${id}`);
        if (r.status === 401) {
          location.href = "/auth";
          return;
        }
        if (!r.ok) {
          setUpMsg("Project not found.");
          setReady(true);
          return;
        }
        const p = (await r.json()) as Project;
        setPid(p.id);
        setName(p.name);
        const pt = parseProjectType(p.type);
        if (pt) setType(pt);
        const tmpl = parseTemplate(p.template);
        if (tmpl) setTemplate(tmpl);
      } else {
        if (n) setName(n);
        const pt = parseProjectType(q.get("type"));
        if (pt) setType(pt);
        const tmpl = parseTemplate(q.get("template"));
        if (tmpl) setTemplate(tmpl);
        if (!n) setUpMsg("Missing project. Create one first.");
      }
      setReady(true);
    };
    void boot();
  }, []);

  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    const path = pid
      ? uploadPath({ id: pid })
      : uploadPath({
          name: name.trim() || undefined,
          type,
          template: type === "keypoints" ? template : undefined,
        });
    setQrUrl(`${window.location.origin}${path}`);
  }, [ready, pid, name, type, template]);

  const send = async (files: File[], opts: SubmitOpts) => {
    if (!files.length || busy) return;
    setBusy(true);
    setUpMsg(null);
    let id: string | null = pid;
    let createdHere = false;
    try {
      if (!id) {
        const n = name.trim();
        if (!n) {
          setUpMsg("Missing project name.");
          return;
        }
        const res = await createProject({
          name: n,
          type,
          template: type === "keypoints" ? template : undefined,
          signal: opts.signal,
        });
        if (!res.ok) {
          setUpMsg(res.error === "name_taken" ? "Name already exists." : upErr(res.status ?? 0, String(res.detail ?? "")));
          return;
        }
        id = res.project.id;
        createdHere = true;
        setPid(id);
      }
      const up = await uploadFiles(`/api/projects/${id}/images`, files, {
        interval: opts.interval,
        signal: opts.signal,
        onProgress: opts.onProgress,
      });
      if (!up.ok) {
        const detail =
          up.json && typeof up.json === "object" && up.json !== null && "detail" in up.json
            ? String((up.json as { detail: unknown }).detail)
            : undefined;
        if (createdHere) fetch(`/api/projects/${id}`, { method: "DELETE" });
        setUpMsg(upErr(up.status, detail));
        return;
      }
      router.push(`/studio/${id}`);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        if (createdHere && id) fetch(`/api/projects/${id}`, { method: "DELETE" });
        setUpMsg("Upload cancelled.");
        return;
      }
      if (createdHere && id) fetch(`/api/projects/${id}`, { method: "DELETE" });
      setUpMsg("Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="create up">
      {guide && (
        <div
          className="create-guide up"
          aria-hidden="true"
          style={{ left: guide.left, top: guide.top }}
        />
      )}
      <CreateChrome />
      <h1>
        <a href="/create" className="back" aria-label="Back">
          <svg viewBox="0 0 256 256" width="1em" height="1em" aria-hidden="true"><path d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z" fill="currentColor" /></svg>
        </a>
        upload <span className="ex">{DATA[ex]}</span>
      </h1>
      <div className="body">
        <div className="split up">
          <div className="sheet" ref={sheetRef}>
            {ready && <UploadPanel busy={busy} err={upMsg} onSubmit={send} />}
          </div>
          <QrCard ref={sideRef} url={qrUrl} />
        </div>
      </div>
    </div>
  );
}
