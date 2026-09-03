"use client";

import { imagesUploadUrl } from "../api";
import { useStudioSession, useStudioState } from "../session";
import { uploadFiles, uploadFromUrl } from "@/modules/create/upload";
import UploadPanel from "./UploadPanel";

function uploadErrDetail(json: unknown): string {
  const detail =
    json && typeof json === "object" && json !== null && "detail" in json
      ? String((json as { detail: unknown }).detail).toLowerCase()
      : "";
  if (detail.includes("ffmpeg")) return "Video tools unavailable (ffmpeg).";
  if (detail.includes("yt-dlp")) return "YouTube tools unavailable (yt-dlp).";
  if (detail.includes("private")) return "Video is private or login-only.";
  if (detail.includes("youtube") || detail === "url") return "Could not fetch that YouTube link.";
  if (detail.includes("video")) return "Could not read video.";
  return "Upload rejected (type, size, or count).";
}

export default function StudioUpload() {
  const session = useStudioSession();
  const uploadOpen = useStudioState((s) => s.uploadOpen);
  const uploadBusy = useStudioState((s) => s.uploadBusy);
  const uploadErr = useStudioState((s) => s.uploadErr);

  if (!uploadOpen) return null;

  return (
    <div
      className="studio-upload"
      role="dialog"
      aria-label="Add media"
      onClick={() => session.closeUpload()}
      onKeyDown={(e) => {
        if (e.key === "Escape") session.closeUpload();
      }}
    >
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Add media</h2>
        <UploadPanel
          busy={uploadBusy}
          err={uploadErr}
          submitLabel="Add"
          onCancel={() => session.closeUpload()}
          onSubmit={async (files, opts) => {
            const yt = (opts.youtubeUrl || "").trim();
            if ((!files.length && !yt) || session.getState().uploadBusy) return;
            session.setUploadBusy(true);
            session.setUploadErr(null);
            try {
              const base = imagesUploadUrl(session.getState().projectId);
              const added: { id: string; filename: string }[] = [];
              if (yt) {
                const r = await uploadFromUrl(base, yt, {
                  interval: opts.interval,
                  signal: opts.signal,
                  onProgress: opts.onProgress,
                });
                if (!r.ok) {
                  session.setUploadErr(uploadErrDetail(r.json));
                  return;
                }
                if (Array.isArray(r.json)) added.push(...(r.json as typeof added));
              }
              if (files.length) {
                const r = await uploadFiles(base, files, {
                  interval: opts.interval,
                  signal: opts.signal,
                  onProgress: opts.onProgress,
                });
                if (!r.ok) {
                  session.setUploadErr(uploadErrDetail(r.json));
                  return;
                }
                if (Array.isArray(r.json)) added.push(...(r.json as typeof added));
              }
              await session.afterUpload(added);
            } catch (e) {
              if ((e as Error)?.name === "AbortError") session.setUploadErr("Upload cancelled.");
              else session.setUploadErr("Upload failed.");
            } finally {
              session.setUploadBusy(false);
            }
          }}
        />
      </div>
    </div>
  );
}
