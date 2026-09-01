"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/doc";
import UploadPanel, { type SubmitOpts, type UploadPanelHandle } from "@/components/UploadPanel";
import QrCard from "@/components/QrCard";
import { uploadFiles } from "@/lib/upload";
import { registerWebMcpTools } from "@/lib/webmcp";

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

function qs() {
  return new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
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
  const [ex, setEx] = useState(0);
  const [ready, setReady] = useState(false);
  const uploadRef = useRef<UploadPanelHandle>(null);
  const pidRef = useRef(pid);
  pidRef.current = pid;

  // boot from query: id= existing project, or name+type for create-on-submit
  useEffect(() => {
    const q = qs();
    const id = (q.get("id") || "").trim();
    const n = (q.get("name") || "").trim();
    const t = q.get("type");
    const tmpl = q.get("template");
    const intervalRaw = q.get("interval");
    const aim = q.get("aim") === "1";

    if (t === "boxes" || t === "polygons" || t === "keypoints") setType(t);
    else if (t === "hands") setType("keypoints");
    if (tmpl === "hand" || tmpl === "pose" || tmpl === "face") setTemplate(tmpl);
    if (n) setName(n);

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
        if (p.type === "boxes" || p.type === "polygons" || p.type === "keypoints") setType(p.type);
        if (p.template === "hand" || p.template === "pose" || p.template === "face") setTemplate(p.template);
      } else if (!n) {
        setUpMsg("Missing project. Create one first.");
      }
      setReady(true);
      // aim Select files after panel mounts
      if (aim || intervalRaw) {
        requestAnimationFrame(() => {
          setTimeout(() => {
            if (intervalRaw && Number.isFinite(Number(intervalRaw))) {
              uploadRef.current?.setFrameInterval(Number(intervalRaw));
            }
            if (aim) uploadRef.current?.preparePicker();
            // drop aim from URL so refresh doesn't re-fire
            const u = new URL(window.location.href);
            if (u.searchParams.has("aim")) {
              u.searchParams.delete("aim");
              window.history.replaceState(null, "", u.pathname + u.search);
            }
          }, 50);
        });
      }
    };
    void boot();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const u = new URL("/upload", window.location.origin);
    if (pid) u.searchParams.set("id", pid);
    else {
      if (name.trim()) u.searchParams.set("name", name.trim());
      u.searchParams.set("type", type);
      if (type === "keypoints") u.searchParams.set("template", template);
    }
    setQrUrl(u.toString());
  }, [pid, name, type, template]);

  useEffect(() => {
    const t = setInterval(() => setEx((i) => {
      let n = i % DATA.length;
      while (n === i % DATA.length) n = Math.floor(Math.random() * DATA.length);
      return n;
    }), 2200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void registerWebMcpTools(
      [
        {
          name: "prepare_media_upload",
          description:
            "Prepare media upload for an existing project (images, video, or zip). Loads /upload for project_id, optional video frame_interval, and aims Select files. Does not upload — computer use clicks Select files, chooses files, then Upload.",
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

            // already on this project — aim in place
            if (pidRef.current === project_id) {
              setUpMsg(null);
              if (interval != null) uploadRef.current?.setFrameInterval(interval);
              const aim =
                uploadRef.current?.preparePicker() ??
                ({ needsClick: true, selector: '[data-webmcp="select-files"]', label: "Select files" } as const);
              return {
                prepared: true,
                project_id,
                project: proj,
                frame_interval: interval,
                needs_user_gesture: true,
                target: { label: aim.label, selector: aim.selector },
                next: "Computer use: click Select files, choose images/video/zip, then click Upload.",
              };
            }

            const u = new URL("/upload", window.location.origin);
            u.searchParams.set("id", project_id);
            u.searchParams.set("aim", "1");
            if (interval != null) u.searchParams.set("interval", String(interval));
            router.push(u.pathname + u.search);
            return {
              prepared: true,
              project_id,
              project: proj,
              frame_interval: interval,
              upload_url: u.pathname + u.search,
              needs_user_gesture: true,
              target: { label: "Select files", selector: '[data-webmcp="select-files"]' },
              next: "Page opens upload UI and highlights Select files. Computer use: click it, choose media, then Upload.",
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
    let id: string | null = pid;
    let createdHere = false;
    try {
      if (!id) {
        const n = name.trim();
        if (!n) {
          setUpMsg("Missing project name.");
          return;
        }
        const r = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: n,
            type,
            ...(type === "keypoints" ? { template } : {}),
          }),
          signal: opts.signal,
        });
        const p = await r.json().catch(() => ({}));
        if (r.status === 409) {
          setUpMsg("Name already exists.");
          return;
        }
        if (!r.ok || !p.id) {
          setUpMsg(upErr(r.status, typeof p.detail === "string" ? p.detail : undefined));
          return;
        }
        id = p.id as string;
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
  }, [qrUrl, ready]);

  return (
    <div className="create up">
      {guide && (
        <div
          className="create-guide up"
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
        <a href="/create" className="back" aria-label="Back">
          <svg viewBox="0 0 256 256" width="1em" height="1em" aria-hidden="true"><path d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z" fill="currentColor" /></svg>
        </a>
        upload <span className="ex">{DATA[ex % DATA.length]}</span>
      </h1>
      <div className="body">
        <div className="split up">
          <div className="sheet" ref={sheetRef}>
            {ready && (
              <UploadPanel ref={uploadRef} busy={busy} err={upMsg} onSubmit={send} />
            )}
          </div>
          <QrCard ref={sideRef} url={qrUrl} />
        </div>
      </div>
    </div>
  );
}
