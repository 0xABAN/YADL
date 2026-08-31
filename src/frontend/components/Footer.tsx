const EXTRA = [
  {
    id: "comment",
    label: "Comment (T)",
    d: "M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm0,192a87.87,87.87,0,0,1-44.06-11.81,8,8,0,0,0-6.54-.67L40,216,52.47,178.6a8,8,0,0,0-.66-6.54A88,88,0,1,1,128,216Z",
    hint: "Notes for the agent on this image",
  },
  {
    id: "history",
    label: "History (H)",
    d: "M136,80v43.47l36.12,21.67a8,8,0,0,1-8.24,13.72l-40-24A8,8,0,0,1,120,128V80a8,8,0,0,1,16,0Zm-8-48A95.44,95.44,0,0,0,60.08,60.15C52.81,67.51,46.35,74.59,40,82V64a8,8,0,0,0-16,0v40a8,8,0,0,0,8,8H72a8,8,0,0,0,0-16H49c7.15-8.42,14.27-16.35,22.39-24.57a80,80,0,1,1,1.66,114.75,8,8,0,1,0-11,11.64A96,96,0,1,0,128,32Z",
    hint: "Versions of this photo",
  },
] as const;

export type Tip = { x: number; y: number; text: string };

export default function Footer({
  path,
  index,
  n,
  onPrev,
  onNext,
  onNextOpen,
  onCommit,
  onExport,
  onHistory,
  onComment,
  onTip,
  canCommit,
  commitReason,
  nCommitted,
  nOpen,
  histOpen,
  commentsOpen,
  commentCount,
  saveState,
}: {
  path: string;
  index: number;
  n: number;
  onPrev: () => void;
  onNext: () => void;
  onNextOpen: () => void;
  onCommit: () => void;
  onExport: () => void;
  onHistory: (btn: HTMLElement) => void;
  onComment: (btn: HTMLElement) => void;
  onTip: (tip: Tip | null) => void;
  canCommit: boolean;
  commitReason: string;
  nCommitted: number;
  nOpen: number;
  histOpen: boolean;
  commentsOpen: boolean;
  commentCount: number;
  saveState: "idle" | "saving" | "saved" | "error";
}) {
  const show = (el: HTMLElement, text: string) => {
    const r = el.getBoundingClientRect();
    const foot = el.closest("footer")?.getBoundingClientRect();
    onTip({ x: r.left + r.width / 2, y: foot?.top ?? r.top, text });
  };
  const commitHint = canCommit ? "Accept this sample" : commitReason;
  const saveLabel =
    saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : "";

  return (
    <footer data-footer>
      <div className="file-wrap">
        <span className="file" title={path}>
          {path || "—"}
        </span>
        {saveLabel && (
          <span className="progress nums" aria-live="polite">
            {saveLabel}
          </span>
        )}
      </div>
      <nav className="pager" aria-label="Images">
        <button type="button" disabled={index <= 0} aria-label="Previous image (K)" title="Previous (K)" onClick={onPrev}>
          <svg viewBox="0 0 256 256" width="16" height="16" aria-hidden="true">
            <path
              d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z"
              fill="currentColor"
            />
          </svg>
        </button>
        <span className="nums" aria-live="polite">
          {n ? `${index + 1}/${n}` : "0/0"}
        </span>
        <button type="button" disabled={index >= n - 1} aria-label="Next image (J)" title="Next (J)" onClick={onNext}>
          <svg viewBox="0 0 256 256" width="16" height="16" aria-hidden="true">
            <path
              d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z"
              fill="currentColor"
            />
          </svg>
        </button>
      </nav>
      <div className="actions">
        {EXTRA.map((t) => (
          <button
            key={t.id}
            type="button"
            className="act-link"
            data-tip={t.id}
            aria-label={t.label}
            aria-pressed={t.id === "history" ? histOpen : t.id === "comment" ? commentsOpen : undefined}
            title={t.hint}
            onClick={
              t.id === "history"
                ? (e) => onHistory(e.currentTarget)
                : t.id === "comment"
                  ? (e) => onComment(e.currentTarget)
                  : undefined
            }
            onMouseEnter={(e) => show(e.currentTarget, t.hint)}
            onMouseLeave={() => onTip(null)}
            onFocus={(e) => show(e.currentTarget, t.hint)}
            onBlur={() => onTip(null)}
          >
            <svg viewBox="0 0 256 256" width="22" height="22" aria-hidden="true">
              <path d={t.d} fill="currentColor" />
            </svg>
            {t.label}
            {t.id === "comment" && commentCount > 0 && <span className="cmt-badge">{commentCount}</span>}
          </button>
        ))}
        <span className="act-btn after-sep">
          <button
            className="commit"
            type="button"
            data-tip="next-open"
            disabled={nOpen === 0}
            title="Go to next uncommitted image"
            aria-label="Next open (N)"
            onClick={onNextOpen}
            onMouseEnter={(e) => show(e.currentTarget, "Go to next uncommitted image")}
            onMouseLeave={() => onTip(null)}
            onFocus={(e) => show(e.currentTarget, "Go to next uncommitted image")}
            onBlur={() => onTip(null)}
          >
            Next open (N)
          </button>
        </span>
        <span className="act-btn">
          <button
            className="commit"
            type="button"
            data-tip="commit"
            disabled={!canCommit}
            title={commitHint}
            aria-label={canCommit ? "Commit (C)" : commitReason}
            onClick={onCommit}
            onMouseEnter={(e) => show(e.currentTarget, commitHint)}
            onMouseLeave={() => onTip(null)}
            onFocus={(e) => show(e.currentTarget, commitHint)}
            onBlur={() => onTip(null)}
          >
            Commit (C)
          </button>
        </span>
        <span className="act-btn">
          <button
            className="commit"
            type="button"
            data-tip="export"
            disabled={nCommitted === 0}
            title={`${nCommitted} committed file${nCommitted === 1 ? "" : "s"}`}
            aria-label="Export (E)"
            onClick={onExport}
            onMouseEnter={(e) => show(e.currentTarget, `${nCommitted} committed`)}
            onMouseLeave={() => onTip(null)}
            onFocus={(e) => show(e.currentTarget, `${nCommitted} committed`)}
            onBlur={() => onTip(null)}
          >
            Export (E)
          </button>
        </span>
      </div>
    </footer>
  );
}
