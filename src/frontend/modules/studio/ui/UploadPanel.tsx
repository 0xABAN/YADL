"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACCEPT,
  ALL_EXTS,
  INTERVAL_MAX,
  INTERVAL_MIN,
  INTERVAL_STEP,
  MAX_B,
  clampInterval,
  filterFiles,
  fmtSize,
  kindOf,
  progressLabel,
  youtubeHint,
  type Kind,
  type UploadProgress,
} from "@/modules/create/upload";

type Row = { id: string; file: File; kind: Kind; url?: string };

export type SubmitOpts = {
  interval: number;
  signal: AbortSignal;
  onProgress: (p: UploadProgress) => void;
  youtubeUrl?: string;
};

function UploadPanel({
  busy = false,
  err = null,
  submitLabel = "Upload",
  onSubmit,
  onCancel,
}: {
  busy?: boolean;
  err?: string | null;
  submitLabel?: string;
  onSubmit: (files: File[], opts: SubmitOpts) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [over, setOver] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [yt, setYt] = useState("");
  const [interval, setIntervalSec] = useState(1);
  const [prog, setProg] = useState<UploadProgress | null>(null);
  const urls = useRef<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
      abortRef.current?.abort();
    };
  }, []);

  const hasVideo = rows.some((r) => r.kind === "video");
  const hasZip = rows.some((r) => r.kind === "zip");
  const ytUrl = yt.trim();
  const hasYt = youtubeHint(ytUrl);
  const ytBad = ytUrl.length > 0 && !hasYt;
  const totalBytes = rows.reduce((n, r) => n + r.file.size, 0);
  const overSize = totalBytes > MAX_B;
  const canSend = (rows.length > 0 || hasYt) && !busy && !overSize && !ytBad;

  const pct =
    prog?.phase === "upload" && prog.total
      ? Math.min(100, Math.round((100 * prog.loaded) / prog.total))
      : prog?.phase === "process"
        ? 100
        : null;
  const statusText = prog
    ? progressLabel(prog, { video: hasVideo, zip: hasZip, youtube: hasYt && !rows.length })
    : null;

  const add = (list: FileList | File[]) => {
    if (busy) return;
    const { ok, skipped: sk } = filterFiles(list);
    setSkipped((n) => n + sk);
    setRows((prev) => {
      const next = [...prev];
      for (const f of ok) {
        const kind = kindOf(f.name)!;
        const id = `${f.name}:${f.size}:${f.lastModified}:${Math.random()}`;
        let url: string | undefined;
        if (kind === "image") {
          url = URL.createObjectURL(f);
          urls.current.push(url);
        }
        next.push({ id, file: f, kind, url });
      }
      return next;
    });
  };

  const remove = (id: string) => {
    setRows((prev) => {
      const hit = prev.find((r) => r.id === id);
      if (hit?.url) {
        URL.revokeObjectURL(hit.url);
        urls.current = urls.current.filter((u) => u !== hit.url);
      }
      return prev.filter((r) => r.id !== id);
    });
  };

  const clear = () => {
    rows.forEach((r) => r.url && URL.revokeObjectURL(r.url));
    urls.current = [];
    setRows([]);
    setSkipped(0);
  };

  const cancel = () => {
    if (!abortRef.current) return;
    abortRef.current.abort();
    abortRef.current = null;
    setProg(null);
    onCancel?.();
  };

  const go = async () => {
    if (!canSend) return;
    const ac = new AbortController();
    abortRef.current = ac;
    const onlyYt = hasYt && rows.length === 0;
    setProg(
      onlyYt
        ? { phase: "process" }
        : { phase: "upload", loaded: 0, total: totalBytes || 1 },
    );
    try {
      await onSubmit(
        rows.map((r) => r.file),
        {
          interval: clampInterval(interval),
          signal: ac.signal,
          youtubeUrl: hasYt ? ytUrl : undefined,
          onProgress: (next) => {
            if (next.phase === "process") abortRef.current = null;
            setProg(next);
          },
        },
      );
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setProg(null);
    }
  };

  const formats = ALL_EXTS.join(" ");

  return (
    <>
      <div
        className={over ? "drop over" : busy ? "drop busy" : "drop"}
        aria-disabled={busy || undefined}
        onDragOver={(e) => {
          if (busy) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!busy) add(e.dataTransfer.files);
        }}
      >
        <p className="lead">Drag and drop to upload, or:</p>
        <div className="picks">
          <label className={busy ? "pick off" : "pick"}>
            Select files
            <input
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              disabled={busy}
              onChange={(e) => {
                if (e.target.files) add(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <label className={busy ? "pick off" : "pick"}>
            Select folder
            <input
              type="file"
              multiple
              hidden
              disabled={busy}
              // @ts-expect-error webkitdirectory
              webkitdirectory=""
              onChange={(e) => {
                if (e.target.files) add(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <div className="formats">
          <b>Supported</b>
          {formats} · YouTube URL
        </div>
        <label className="yt-url">
          <span className="yt-url-label">Or paste a YouTube link</span>
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://youtube.com/watch?v=…"
            value={yt}
            disabled={busy}
            onChange={(e) => setYt(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onDragOver={(e) => e.stopPropagation()}
          />
        </label>
        {ytBad && <small className="err">Public YouTube links only.</small>}
      </div>

      {rows.length > 0 && (
        <div className="file-list">
          <div className="file-list-head">
            <span>
              {rows.length} selected · {fmtSize(totalBytes)}
            </span>
            <button type="button" className="file-clear" onClick={clear} disabled={busy}>
              Clear
            </button>
          </div>
          <ul>
            {rows.map((r) => (
              <li key={r.id}>
                {r.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.url} alt="" />
                ) : (
                  <span className={`file-ico ${r.kind}`}>{r.kind === "video" ? "▶" : "Z"}</span>
                )}
                <span className="file-meta">
                  <b>{r.file.name}</b>
                  <small>
                    {fmtSize(r.file.size)}
                    {r.kind === "zip" ? " · expands on upload" : ""}
                  </small>
                </span>
                <button type="button" aria-label={`Remove ${r.file.name}`} disabled={busy} onClick={() => remove(r.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(hasVideo || hasYt) && (
        <label className="interval">
          <span className="interval-label">
            Frame interval
            <b>{interval.toFixed(1)} s</b>
          </span>
          <input
            type="range"
            min={INTERVAL_MIN}
            max={INTERVAL_MAX}
            step={INTERVAL_STEP}
            value={interval}
            disabled={busy}
            aria-valuemin={INTERVAL_MIN}
            aria-valuemax={INTERVAL_MAX}
            aria-valuenow={interval}
            aria-valuetext={`${interval.toFixed(1)} seconds`}
            onChange={(e) => setIntervalSec(clampInterval(Number(e.target.value)))}
          />
        </label>
      )}

      {(busy || prog) && (
        <div className="up-prog" aria-live="polite" aria-busy="true">
          <div
            className={prog?.phase === "process" ? "up-bar indet" : "up-bar"}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? undefined}
            aria-label={statusText ?? "Working"}
          >
            <i style={pct != null && prog?.phase === "upload" ? { width: `${pct}%` } : undefined} />
          </div>
          <p className="up-status">{statusText ?? "Starting…"}</p>
          {prog?.phase === "process" && (hasVideo || hasYt) && (
            <p className="up-hint">Long videos can take a minute.</p>
          )}
        </div>
      )}

      {skipped > 0 && (
        <small className="err">{skipped} skipped — unsupported type.</small>
      )}
      {overSize && <small className="err">Over {fmtSize(MAX_B)} total.</small>}
      {err && <small className="err">{err}</small>}

      {!busy ? (
        <button className="commit" type="button" disabled={!canSend} onClick={() => void go()}>
          {submitLabel}
        </button>
      ) : prog?.phase === "process" ? (
        <button className="commit" type="button" disabled>
          Processing…
        </button>
      ) : (
        <button className="commit abort" type="button" onClick={cancel}>
          Cancel upload
        </button>
      )}
      {onCancel && !busy && (
        <button type="button" className="skip" onClick={onCancel}>
          Cancel
        </button>
      )}
    </>
  );
}

export default UploadPanel;
