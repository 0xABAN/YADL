"use client";

import { imagesUploadUrl } from "../api";
import { useStudioSession, useStudioState } from "../session";
import { uploadFiles } from "@/modules/create/upload";
import UploadPanel from "./UploadPanel";

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
            if (!files.length || session.getState().uploadBusy) return;
            session.setUploadBusy(true);
            session.setUploadErr(null);
            try {
              const r = await uploadFiles(imagesUploadUrl(session.getState().projectId), files, {
                interval: opts.interval,
                signal: opts.signal,
                onProgress: opts.onProgress,
              });
              if (!r.ok) {
                const detail =
                  r.json && typeof r.json === "object" && r.json !== null && "detail" in r.json
                    ? String((r.json as { detail: unknown }).detail).toLowerCase()
                    : "";
                session.setUploadErr(
                  detail.includes("ffmpeg")
                    ? "Video tools unavailable (ffmpeg)."
                    : detail.includes("video")
                      ? "Could not read video."
                      : "Upload rejected (type, size, or count).",
                );
                return;
              }
              const added = (Array.isArray(r.json) ? r.json : []) as { id: string; filename: string }[];
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
