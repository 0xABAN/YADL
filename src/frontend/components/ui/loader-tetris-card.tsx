"use client";

import { TetrisLoader } from "./loader-tetris";

/** Demo-style card: tetris board + title/subtitle (no Tailwind). */
export function TetrisLoaderCard({
  title = "Loading studio",
  subtitle = "Fetching project and media…",
  label,
}: {
  title?: string;
  subtitle?: string;
  label?: string;
}) {
  return (
    <div className="tetris-card" role="status" aria-live="polite">
      <TetrisLoader
        columns={8}
        rows={16}
        cellSize={3}
        gap={1}
        speed={40}
        label={label ?? title}
      />
      <div className="tetris-card-copy">
        <p className="tetris-card-title">{title}</p>
        <p className="tetris-card-sub">{subtitle}</p>
      </div>
    </div>
  );
}

export default TetrisLoaderCard;
