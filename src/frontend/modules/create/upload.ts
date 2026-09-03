export const IMG_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".avif", ".bmp", ".heic", ".heif"] as const;
export const VID_EXTS = [".mp4", ".mov", ".webm", ".mkv"] as const;
export const ZIP_EXTS = [".zip"] as const;
export const ALL_EXTS = [...IMG_EXTS, ...VID_EXTS, ...ZIP_EXTS] as const;
export const ACCEPT = ALL_EXTS.join(",");

export const MAX_B = 100 * 1024 * 1024;
export const INTERVAL_MIN = 0.1;
export const INTERVAL_MAX = 5;
export const INTERVAL_STEP = 0.1;

export function clampInterval(n: number): number {
  const x = Math.round(n / INTERVAL_STEP) * INTERVAL_STEP;
  return Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, Math.round(x * 10) / 10));
}

export type Kind = "image" | "video" | "zip";

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export function kindOf(name: string): Kind | null {
  const e = extOf(name);
  if ((IMG_EXTS as readonly string[]).includes(e)) return "image";
  if ((VID_EXTS as readonly string[]).includes(e)) return "video";
  if ((ZIP_EXTS as readonly string[]).includes(e)) return "zip";
  return null;
}

export function filterFiles(list: FileList | File[]): { ok: File[]; skipped: number } {
  const ok: File[] = [];
  let skipped = 0;
  for (const f of [...list]) {
    if (kindOf(f.name)) ok.push(f);
    else skipped++;
  }
  return { ok, skipped };
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** upload = bytes to S3; process = server expand/save after PUTs */
export type UploadProgress =
  | { phase: "upload"; loaded: number; total: number }
  | { phase: "process" };

export type UploadResult = { ok: boolean; status: number; json: unknown };

type PresignItem = { name: string; key: string; content_type: string; url: string };

function putS3(
  url: string,
  file: File,
  contentType: string,
  opts: {
    signal?: AbortSignal;
    onProgress?: (loaded: number) => void;
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);

    const onAbort = () => xhr.abort();
    opts.signal?.addEventListener("abort", onAbort);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded);
    };

    xhr.onload = () => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`s3 ${xhr.status}`));
    };
    xhr.onerror = () => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(new Error("network"));
    };
    xhr.onabort = () => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };

    xhr.send(file);
  });
}

/**
 * Presign → browser PUT to S3 → complete (avoids Vercel 4.5MB body cap).
 * `url` is `/api/projects/:id/images` (legacy multipart base).
 */
export async function uploadFiles(
  url: string,
  files: File[],
  opts: {
    interval?: number;
    signal?: AbortSignal;
    onProgress?: (p: UploadProgress) => void;
  } = {},
): Promise<UploadResult> {
  const base = url.replace(/\/$/, "");
  const interval = opts.interval != null ? clampInterval(opts.interval) : 1;

  const presignRes = await fetch(`${base}/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: files.map((f) => ({
        name: f.name,
        content_type: f.type || "",
        size: f.size,
      })),
    }),
    signal: opts.signal,
  });
  if (!presignRes.ok) {
    const json = await presignRes.json().catch(() => null);
    return { ok: false, status: presignRes.status, json };
  }
  const presignJson = (await presignRes.json()) as { items: PresignItem[] };
  const items = presignJson.items;
  if (!items?.length || items.length !== files.length) {
    return { ok: false, status: 400, json: presignJson };
  }

  const total = files.reduce((s, f) => s + f.size, 0);
  let done = 0;
  opts.onProgress?.({ phase: "upload", loaded: 0, total });

  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const item = items[i];
      const before = done;
      await putS3(item.url, file, item.content_type, {
        signal: opts.signal,
        onProgress: (loaded) =>
          opts.onProgress?.({ phase: "upload", loaded: before + loaded, total }),
      });
      done += file.size;
      opts.onProgress?.({ phase: "upload", loaded: done, total });
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { ok: false, status: 0, json: { error: String(e) } };
  }

  opts.onProgress?.({ phase: "process" });

  const completeRes = await fetch(`${base}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      interval,
      files: items.map((it) => ({ name: it.name, key: it.key })),
    }),
    signal: opts.signal,
  });
  const json = await completeRes.json().catch(() => null);
  return { ok: completeRes.ok, status: completeRes.status, json };
}

export function progressLabel(
  p: UploadProgress,
  kind: { video?: boolean; zip?: boolean; youtube?: boolean } = {},
): string {
  if (p.phase === "upload") {
    const pct = p.total ? Math.min(100, Math.round((100 * p.loaded) / p.total)) : 0;
    return `Uploading ${pct}% · ${fmtSize(p.loaded)} / ${fmtSize(p.total)}`;
  }
  if (kind.youtube) return "Fetching YouTube…";
  if (kind.video) return "Extracting frames…";
  if (kind.zip) return "Unpacking zip…";
  return "Saving images…";
}

/** Server-side YouTube pull → frames (no browser bytes). */
export async function uploadFromUrl(
  url: string,
  youtubeUrl: string,
  opts: {
    interval?: number;
    signal?: AbortSignal;
    onProgress?: (p: UploadProgress) => void;
  } = {},
): Promise<UploadResult> {
  const base = url.replace(/\/$/, "");
  const interval = opts.interval != null ? clampInterval(opts.interval) : 1;
  opts.onProgress?.({ phase: "process" });
  const res = await fetch(`${base}/from_url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: youtubeUrl.trim(), interval }),
    signal: opts.signal,
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

export function youtubeHint(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  if (!s) return false;
  return (
    s.includes("youtube.com/") ||
    s.includes("youtu.be/") ||
    s.startsWith("youtube.com") ||
    s.startsWith("youtu.be")
  );
}
