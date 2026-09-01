export const IMG_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".avif", ".bmp", ".heic", ".heif"] as const;
export const VID_EXTS = [".mp4", ".mov", ".webm", ".mkv"] as const;
export const ZIP_EXTS = [".zip"] as const;
export const ALL_EXTS = [...IMG_EXTS, ...VID_EXTS, ...ZIP_EXTS] as const;
export const ACCEPT = ALL_EXTS.join(",");

export const MAX_N = 500;
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

/** upload = bytes on the wire; process = server extract/save after body is sent */
export type UploadProgress =
  | { phase: "upload"; loaded: number; total: number }
  | { phase: "process" };

export type UploadResult = { ok: boolean; status: number; json: unknown };

export function uploadFiles(
  url: string,
  files: File[],
  opts: {
    interval?: number;
    signal?: AbortSignal;
    onProgress?: (p: UploadProgress) => void;
  } = {},
): Promise<UploadResult> {
  const iv =
    opts.interval != null ? clampInterval(opts.interval) : null;
  const q = iv != null && iv !== 1 ? `?interval=${iv}` : "";
  const body = new FormData();
  files.forEach((f) => body.append("files", f));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${url}${q}`);
    xhr.responseType = "json";

    const onAbort = () => xhr.abort();
    opts.signal?.addEventListener("abort", onAbort);

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      opts.onProgress?.({ phase: "upload", loaded: e.loaded, total: e.total });
    };
    xhr.upload.onload = () => opts.onProgress?.({ phase: "process" });

    xhr.onload = () => {
      opts.signal?.removeEventListener("abort", onAbort);
      const json = xhr.response ?? null;
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, json });
    };
    xhr.onerror = () => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(new Error("network"));
    };
    xhr.onabort = () => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };

    xhr.send(body);
  });
}

export function progressLabel(
  p: UploadProgress,
  kind: { video?: boolean; zip?: boolean } = {},
): string {
  if (p.phase === "upload") {
    const pct = p.total ? Math.min(100, Math.round((100 * p.loaded) / p.total)) : 0;
    return `Uploading ${pct}% · ${fmtSize(p.loaded)} / ${fmtSize(p.total)}`;
  }
  if (kind.video) return "Extracting frames…";
  if (kind.zip) return "Unpacking zip…";
  return "Saving images…";
}
