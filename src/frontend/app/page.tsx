"use client";

import { useRef, useState } from "react";

export default function Home() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  return (
    <div className="shell">
      <header>
        <span>Imigen</span>
        <nav>
          <button type="button" disabled>
            &lt;
          </button>
          <span>0 / 0</span>
          <button type="button" disabled>
            &gt;
          </button>
        </nav>
        <button type="button">Commit</button>
      </header>
      <aside>
        <h1>Classes</h1>
      </aside>
      <main
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: pos.x, y: pos.y, px: e.clientX, py: e.clientY };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPos({
            x: drag.current.x + e.clientX - drag.current.px,
            y: drag.current.y + e.clientY - drag.current.py,
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <div className="world" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
          <img src="/default.jpg" alt="" draggable={false} />
        </div>
      </main>
    </div>
  );
}
