const EXTRA = [
  { id: "comment", label: "Comment", d: "M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm0,192a87.87,87.87,0,0,1-44.06-11.81,8,8,0,0,0-6.54-.67L40,216,52.47,178.6a8,8,0,0,0-.66-6.54A88,88,0,1,1,128,216Z" },
  { id: "export", label: "Export", d: "M224,152v56a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V152a8,8,0,0,1,16,0v48H208V152a8,8,0,0,1,16,0Zm-94.34,2.34a8,8,0,0,0,11.32,0l40-40a8,8,0,0,0-11.32-11.32L136,132.69V40a8,8,0,0,0-16,0v92.69L99.31,103a8,8,0,0,0-11.32,11.32Z" },
] as const;

export default function Footer({
  path,
  index,
  n,
  onPrev,
  onNext,
  onCommit,
  onExport,
}: {
  path: string;
  index: number;
  n: number;
  onPrev: () => void;
  onNext: () => void;
  onCommit: () => void;
  onExport: () => void;
}) {
  return (
    <footer>
      <span className="file" title={path}>{path || "—"}</span>
      <nav className="pager">
        <button type="button" disabled={index <= 0} aria-label="Previous" onClick={onPrev}>
          <svg viewBox="0 0 256 256" width="16" height="16" aria-hidden="true">
            <path d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z" fill="currentColor" />
          </svg>
        </button>
        <span>{n ? `${index + 1}/${n}` : "0/0"}</span>
        <button type="button" disabled={index >= n - 1} aria-label="Next" onClick={onNext}>
          <svg viewBox="0 0 256 256" width="16" height="16" aria-hidden="true">
            <path d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z" fill="currentColor" />
          </svg>
        </button>
      </nav>
      <div className="actions">
        <div className="extra">
          {EXTRA.map((t) => (
            <button key={t.id} type="button" onClick={t.id === "export" ? onExport : undefined}>
              <svg viewBox="0 0 256 256" width="22" height="22" aria-hidden="true">
                <path d={t.d} fill="currentColor" />
              </svg>
              {t.label}
            </button>
          ))}
        </div>
        <button className="commit" type="button" onClick={onCommit}>
          Commit
        </button>
      </div>
    </footer>
  );
}
