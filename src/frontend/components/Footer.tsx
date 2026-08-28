const EXTRA = [
  { id: "comment", label: "Comment", d: "M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm0,192a87.87,87.87,0,0,1-44.06-11.81,8,8,0,0,0-6.54-.67L40,216,52.47,178.6a8,8,0,0,0-.66-6.54A88,88,0,1,1,128,216Z" },
  { id: "history", label: "History", d: "M136,80v43.47l36.12,21.67a8,8,0,0,1-8.24,13.72l-40-24A8,8,0,0,1,120,128V80a8,8,0,0,1,16,0Zm-8-48A95.44,95.44,0,0,0,60.08,60.15C52.81,67.51,46.35,74.59,40,82V64a8,8,0,0,0-16,0v40a8,8,0,0,0,8,8H72a8,8,0,0,0,0-16H49c7.15-8.42,14.27-16.35,22.39-24.57a80,80,0,1,1,1.66,114.75,8,8,0,1,0-11,11.64A96,96,0,1,0,128,32Z" },
] as const;

export default function Footer() {
  return (
    <footer>
      <span className="file" title="/default.jpg">/default.jpg</span>
      <nav className="pager">
        <button type="button" disabled aria-label="Previous">
          <svg viewBox="0 0 256 256" width="16" height="16" aria-hidden="true">
            <path d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z" fill="currentColor" />
          </svg>
        </button>
        <span>0/0</span>
        <button type="button" disabled aria-label="Next">
          <svg viewBox="0 0 256 256" width="16" height="16" aria-hidden="true">
            <path d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z" fill="currentColor" />
          </svg>
        </button>
      </nav>
      <div className="actions">
        <div className="extra">
          {EXTRA.map((t) => (
            <button key={t.id} type="button">
              <svg viewBox="0 0 256 256" width="22" height="22" aria-hidden="true">
                <path d={t.d} fill="currentColor" />
              </svg>
              {t.label}
            </button>
          ))}
        </div>
        <button className="commit" type="button">
          Commit
        </button>
      </div>
    </footer>
  );
}
