"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelAugmentationJob,
  createAugmentationJob,
  fetchAugmentationJob,
  fetchAugmentationJobs,
  retryAugmentationJob,
  type AugmentationJob,
  type AugmentationMode,
  type AugmentationRequest,
  type TransformOperation,
} from "../api";
import { useStudioState } from "../session";

const ACTIVE = new Set(["queued", "running"]);
const DEFAULTS: Record<TransformOperation["op"], TransformOperation> = {
  flip: { op: "flip", axis: "horizontal", probability: 0.5 },
  affine: { op: "affine", rotate_degrees: 8, scale: 1, probability: 1 },
  crop_resize: { op: "crop_resize", x: 0.03, y: 0.03, width: 0.94, height: 0.94 },
  brightness_contrast: { op: "brightness_contrast", brightness: 1.08, contrast: 1.05 },
  hue_saturation: { op: "hue_saturation", hue_degrees: 4, saturation: 1.08 },
  blur: { op: "blur", radius: 1.2 },
  noise: { op: "noise", sigma: 5 },
  compression: { op: "compression", quality: 80 },
};
const PRESETS: Record<string, TransformOperation[]> = {
  Balanced: [DEFAULTS.flip, DEFAULTS.affine, DEFAULTS.brightness_contrast],
  Lighting: [DEFAULTS.brightness_contrast, DEFAULTS.hue_saturation, DEFAULTS.noise],
  Geometry: [DEFAULTS.flip, DEFAULTS.affine, DEFAULTS.crop_resize],
};

function clonePipeline(pipeline: TransformOperation[]) {
  return pipeline.map((operation) => ({ ...operation }));
}

function outputIds(job: AugmentationJob) {
  return (job.items ?? [])
    .map((item) => item.output_image_id)
    .filter((id): id is string => Boolean(id));
}

function OperationControl({
  operation,
  onChange,
}: {
  operation: TransformOperation;
  onChange: (operation: TransformOperation) => void;
}) {
  const number = (field: string, value: number, min: number, max: number, step: number) => (
    <label className="synth-param">
      <span>{field.replaceAll("_", " ")}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) =>
          onChange({ ...operation, [field]: Number(event.target.value) } as TransformOperation)
        }
      />
    </label>
  );
  if (operation.op === "flip") {
    return (
      <label className="synth-param">
        <span>axis</span>
        <select
          value={operation.axis}
          onChange={(event) =>
            onChange({ ...operation, axis: event.target.value as "horizontal" | "vertical" })
          }
        >
          <option value="horizontal">horizontal</option>
          <option value="vertical">vertical</option>
        </select>
      </label>
    );
  }
  if (operation.op === "affine") {
    return number("rotate_degrees", operation.rotate_degrees ?? 0, -360, 360, 1);
  }
  if (operation.op === "crop_resize") {
    return number("width", operation.width ?? 1, 0.01, 1, 0.01);
  }
  if (operation.op === "brightness_contrast") {
    return number("brightness", operation.brightness ?? 1, 0, 4, 0.05);
  }
  if (operation.op === "hue_saturation") {
    return number("hue_degrees", operation.hue_degrees ?? 0, -180, 180, 1);
  }
  if (operation.op === "blur") return number("radius", operation.radius ?? 1, 0, 100, 0.1);
  if (operation.op === "noise") return number("sigma", operation.sigma ?? 8, 0, 255, 1);
  return number("quality", operation.quality ?? 75, 1, 100, 1);
}

export default function Synthetic({
  open,
  pos,
  onClose,
  onCatalogChange,
  onOpenImage,
}: {
  open: boolean;
  pos: { x: number; y: number } | null;
  onClose: () => void;
  onCatalogChange: () => Promise<void>;
  onOpenImage: (imageId: string) => Promise<string | null>;
}) {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const { projectId, list, doc } = useStudioState();
  const [mode, setMode] = useState<AugmentationMode>("transform");
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [sources, setSources] = useState<ReadonlySet<string>>(
    () => new Set(doc?.id ? [doc.id] : []),
  );
  const [pipeline, setPipeline] = useState<TransformOperation[]>(clonePipeline(PRESETS.Balanced));
  const [operation, setOperation] = useState<TransformOperation["op"]>("flip");
  const [prompt, setPrompt] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [seed, setSeed] = useState(0);
  const [aspectRatio, setAspectRatio] =
    useState<"1:1" | "3:2" | "2:3" | "16:9" | "9:16">("1:1");
  const [resolution, setResolution] = useState<"1k" | "2k" | "4k">("1k");
  const [quality, setQuality] = useState<"low" | "medium" | "high">("medium");
  const [format, setFormat] = useState<"png" | "jpeg" | "webp">("png");
  const [jobs, setJobs] = useState<AugmentationJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const seenTerminal = useRef(new Set<string>());

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const loadJobs = useCallback(async () => {
    try {
      const page = await fetchAugmentationJobs(projectId, 0, 20);
      const detailed = await Promise.all(
        page.items.map(async (job) => {
          if (!job.progress.succeeded && !job.progress.failed && !job.progress.submission_unknown) {
            return job;
          }
          try {
            return await fetchAugmentationJob(projectId, job.id, 0, 100);
          } catch {
            return job;
          }
        }),
      );
      setJobs(detailed);
      const newlyTerminal = detailed.filter(
        (job) => !ACTIVE.has(job.status) && !seenTerminal.current.has(job.id),
      );
      if (newlyTerminal.length) {
        newlyTerminal.forEach((job) => seenTerminal.current.add(job.id));
        if (newlyTerminal.some((job) => job.progress.succeeded > 0)) await onCatalogChange();
      }
    } catch {
      setNote("Couldn’t load generation jobs.");
    }
  }, [onCatalogChange, projectId]);

  useEffect(() => {
    if (!open) return;
    const kickoff = window.setTimeout(() => void loadJobs(), 0);
    const id = window.setInterval(() => void loadJobs(), 2_000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(id);
    };
  }, [open, loadJobs]);

  useEffect(() => {
    if (mode !== "transform") promptRef.current?.focus();
  }, [mode]);

  const selectedRows = useMemo(() => list.filter((row) => sources.has(row.id)), [list, sources]);
  const selectedPreset = useMemo(
    () =>
      Object.entries(PRESETS).find(
        ([, value]) => JSON.stringify(value) === JSON.stringify(pipeline),
      )?.[0] ?? null,
    [pipeline],
  );
  const canSubmit =
    !busy &&
    quantity >= 1 &&
    (mode === "text_to_image"
      ? Boolean(prompt.trim())
      : sources.size > 0 && (mode === "transform" ? pipeline.length > 0 : Boolean(prompt.trim())));

  const submit = async () => {
    if (!canSubmit) return;
    let body: AugmentationRequest;
    const source_image_ids = [...sources];
    if (mode === "transform") {
      body = { mode, source_image_ids, variants_per_source: quantity, seed, pipeline };
    } else {
      const wave = {
        prompt: prompt.trim(),
        aspect_ratio: aspectRatio,
        resolution,
        quality,
        output_format: format,
      };
      body =
        mode === "text_to_image"
          ? { mode, count: quantity, ...wave }
          : { mode, source_image_ids, variants_per_source: quantity, ...wave };
    }
    setBusy(true);
    setNote(null);
    try {
      const job = await createAugmentationJob(projectId, body);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setNote(`Queued ${job.requested_count} output${job.requested_count === 1 ? "" : "s"}.`);
    } catch {
      setNote("Couldn’t create the generation job. Check the options and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!open || !pos) return null;

  return (
    <div
      className="hist comments side synth"
      data-synth
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label="Generate data"
    >
      <header>
        <h2>Generate data</h2>
        <button type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="synth-tabs" role="tablist" aria-label="Generation mode">
        {(["transform", "text_to_image", "image_edit"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
          >
            {value === "transform" ? "Transform" : value === "text_to_image" ? "Generate" : "Edit"}
          </button>
        ))}
      </div>
      <div className="synth-body">
        {mode !== "text_to_image" && (
          <fieldset className="synth-section">
            <legend>Sources</legend>
            <div className="synth-source-summary">
              <span>
                {selectedRows.length} selected{doc?.image ? ` · ${doc.image}` : ""}
              </span>
              <button type="button" onClick={() => setSourcePickerOpen((value) => !value)}>
                {sourcePickerOpen ? "Done" : "Choose"}
              </button>
            </div>
            {sourcePickerOpen && (
              <div className="synth-sources">
                {list.map((row) => (
                  <label key={row.id}>
                    <input
                      type="checkbox"
                      checked={sources.has(row.id)}
                      onChange={() =>
                        setSources((current) => {
                          const next = new Set(current);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        })
                      }
                    />
                    <span>{row.filename}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}

        {mode === "transform" ? (
          <fieldset className="synth-section">
            <legend>Recipe</legend>
            <div className="synth-presets">
              {Object.entries(PRESETS).map(([name, value]) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={selectedPreset === name}
                  onClick={() => setPipeline(clonePipeline(value))}
                >
                  {name}
                </button>
              ))}
            </div>
            <details className="synth-advanced">
              <summary>Fine-tune {pipeline.length}-step pipeline</summary>
              <ol className="synth-pipeline">
                {pipeline.map((item, itemIndex) => (
                  <li key={`${item.op}-${itemIndex}`}>
                    <strong>{item.op.replaceAll("_", " ")}</strong>
                    <OperationControl
                      operation={item}
                      onChange={(next) =>
                        setPipeline((current) =>
                          current.map((entry, index) => (index === itemIndex ? next : entry)),
                        )
                      }
                    />
                    <span className="synth-row-actions">
                      <button
                        type="button"
                        aria-label={`Move ${item.op} up`}
                        disabled={itemIndex === 0}
                        onClick={() =>
                          setPipeline((current) => {
                            const next = [...current];
                            [next[itemIndex - 1], next[itemIndex]] = [
                              next[itemIndex],
                              next[itemIndex - 1],
                            ];
                            return next;
                          })
                        }
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${item.op} down`}
                        disabled={itemIndex === pipeline.length - 1}
                        onClick={() =>
                          setPipeline((current) => {
                            const next = [...current];
                            [next[itemIndex], next[itemIndex + 1]] = [
                              next[itemIndex + 1],
                              next[itemIndex],
                            ];
                            return next;
                          })
                        }
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${item.op}`}
                        onClick={() =>
                          setPipeline((current) =>
                            current.filter((_, index) => index !== itemIndex),
                          )
                        }
                      >
                        ×
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="synth-add-operation">
                <select
                  aria-label="Operation"
                  value={operation}
                  onChange={(event) => setOperation(event.target.value as TransformOperation["op"])}
                >
                  {Object.keys(DEFAULTS).map((name) => (
                    <option key={name} value={name}>
                      {name.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    setPipeline((current) => [...current, { ...DEFAULTS[operation] }])
                  }
                >
                  Add operation
                </button>
              </div>
            </details>
          </fieldset>
        ) : (
          <label className="synth-prompt-label" htmlFor="synth-prompt">
            <span>{mode === "image_edit" ? "Edit prompt" : "Prompt"}</span>
            <textarea
              id="synth-prompt"
              ref={promptRef}
              className="synth-prompt"
              rows={3}
              spellCheck={false}
              placeholder={
                mode === "image_edit"
                  ? "Describe what should change…"
                  : "Describe the images to generate…"
              }
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
        )}

        <div className="synth-options">
          <label>
            <span>{mode === "text_to_image" ? "Outputs" : "Variants per source"}</span>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
          {mode === "transform" && (
            <label>
              <span>Seed</span>
              <input
                type="number"
                value={seed}
                onChange={(event) => setSeed(Number(event.target.value) || 0)}
              />
            </label>
          )}
        </div>
        {mode !== "transform" && (
          <details className="synth-advanced synth-wave-options">
            <summary>Image options · {aspectRatio}, {resolution}, {quality}, {format}</summary>
            <div className="synth-options">
              <label>
                <span>Aspect ratio</span>
                <select
                  value={aspectRatio}
                  onChange={(event) => setAspectRatio(event.target.value as typeof aspectRatio)}
                >
                  {["1:1", "3:2", "2:3", "16:9", "9:16"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Resolution</span>
                <select
                  value={resolution}
                  onChange={(event) => setResolution(event.target.value as typeof resolution)}
                >
                  {["1k", "2k", "4k"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Quality</span>
                <select
                  value={quality}
                  onChange={(event) => setQuality(event.target.value as typeof quality)}
                >
                  {["low", "medium", "high"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Format</span>
                <select value={format} onChange={(event) => setFormat(event.target.value as typeof format)}>
                  {["png", "jpeg", "webp"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        )}
        <button
          type="button"
          className="synth-go"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {busy ? "Queuing…" : "Create job"}
        </button>
        {note && (
          <p className="synth-note" role="status">
            {note}
          </p>
        )}
        {jobs.length > 0 && (
          <section className="synth-jobs" aria-label="Generation jobs">
            <h3>Recent jobs</h3>
            {jobs.slice(0, 3).map((job) => {
            const complete =
              job.progress.succeeded +
              job.progress.failed +
              job.progress.cancelled +
              job.progress.submission_unknown;
            const firstOutput = outputIds(job)[0];
            const failures = (job.items ?? []).filter((item) => item.error);
            return (
              <article key={job.id} data-job-status={job.status}>
                <div>
                  <strong>{job.mode.replaceAll("_", " ")}</strong>
                  <span>{job.status}</span>
                </div>
                <progress max={job.requested_count} value={Math.min(job.requested_count, complete)} />
                <small>
                  {complete} of {job.requested_count} finished · {job.progress.succeeded} ready
                </small>
                {failures.slice(0, 2).map((item) => (
                  <p key={item.id} className="synth-error">
                    Item {item.ordinal + 1}: {item.error}
                  </p>
                ))}
                <div className="synth-job-actions">
                  {ACTIVE.has(job.status) && (
                    <button
                      type="button"
                      onClick={async () => {
                        await cancelAugmentationJob(projectId, job.id);
                        await loadJobs();
                      }}
                    >
                      Cancel
                    </button>
                  )}
                  {(job.progress.failed > 0 ||
                    job.progress.cancelled > 0 ||
                    job.progress.submission_unknown > 0) && (
                    <button
                      type="button"
                      onClick={async () => {
                        await retryAugmentationJob(projectId, job.id);
                        await loadJobs();
                      }}
                    >
                      Retry
                    </button>
                  )}
                  {firstOutput && (
                    <button type="button" onClick={() => void onOpenImage(firstOutput)}>
                      Open first output
                    </button>
                  )}
                </div>
              </article>
            );
            })}
          </section>
        )}
      </div>
    </div>
  );
}
