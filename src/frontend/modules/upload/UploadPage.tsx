"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/modules/studio/geometry/doc";
import CreateChrome from "@/modules/studio/ui/CreateChrome";
import UploadPanel, { type SubmitOpts } from "@/modules/studio/ui/UploadPanel";
import QrCard from "@/modules/studio/ui/QrCard";
import { createProject, parseProjectType, parseTemplate } from "@/modules/create/projectsApi";
import { uploadPath } from "@/modules/create/projectRoutes";
import { uploadError, uploadFiles, uploadFromUrl } from "@/modules/create/upload";
import { useRotatingIndex } from "@/modules/create/useRotatingIndex";
import { useSheetGuide } from "@/modules/create/useSheetGuide";
import { apiResult } from "@/shared/api/client";

const DATA = [
  "data", "images", "frames", "photos", "pictures", "shots", "stills",
  "files", "samples", "examples", "batches", "media", "captures",
  "scans", "snaps", "assets", "inputs", "sets", "packs", "lots",
];

export default function UploadPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<"boxes" | "polygons" | "keypoints">("boxes");
  const [template, setTemplate] = useState<"hand" | "pose" | "face">("hand");
  const [pid, setPid] = useState<string | null>(null);
  const [upMsg, setUpMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
        const r = await apiResult<Project>(`/projects/${id}`);
        if (!r.ok) {
          if (r.status !== 401) setUpMsg("Project not found.");
          setReady(true);
          return;
        }
        const p = r.data;
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

  const qrUrl = ready && typeof window !== "undefined"
    ? `${window.location.origin}${
        pid
          ? uploadPath({ id: pid })
          : uploadPath({
              name: name.trim() || undefined,
              type,
              template: type === "keypoints" ? template : undefined,
            })
      }`
    : "";

  const send = async (files: File[], opts: SubmitOpts) => {
    const yt = (opts.youtubeUrl || "").trim();
    if ((!files.length && !yt) || busy) return;
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
          setUpMsg(res.error === "name_taken" ? "Name already exists." : uploadError(res.status ?? 0, String(res.detail ?? "")));
          return;
        }
        id = res.project.id;
        createdHere = true;
        setPid(id);
      }
      const fail = (status: number, json: unknown) => {
        const detail =
          json && typeof json === "object" && json !== null && "detail" in json
            ? String((json as { detail: unknown }).detail)
            : undefined;
        if (createdHere) void apiResult(`/projects/${id}`, { method: "DELETE", raw: true });
        setUpMsg(uploadError(status, detail));
      };
      if (yt) {
        const up = await uploadFromUrl(`/api/projects/${id}/images`, yt, {
          interval: opts.interval,
          signal: opts.signal,
          onProgress: opts.onProgress,
        });
        if (!up.ok) {
          fail(up.status, up.json);
          return;
        }
      }
      if (files.length) {
        const up = await uploadFiles(`/api/projects/${id}/images`, files, {
          interval: opts.interval,
          signal: opts.signal,
          onProgress: opts.onProgress,
        });
        if (!up.ok) {
          fail(up.status, up.json);
          return;
        }
      }
      router.push(`/studio/${id}`);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        if (createdHere && id) void apiResult(`/projects/${id}`, { method: "DELETE", raw: true });
        setUpMsg("Upload cancelled.");
        return;
      }
      if (createdHere && id) void apiResult(`/projects/${id}`, { method: "DELETE", raw: true });
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
