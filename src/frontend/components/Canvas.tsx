"use client";

import { useRef, useState } from "react";

export default function Canvas() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  return (
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
  );
}
