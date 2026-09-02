"use client";

import {
  type ComponentProps,
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/* -------------------------------------------------------------------------- */
/*                              frame generation                              */
/* -------------------------------------------------------------------------- */

/** One frame: flat board, 0 empty, 1–7 tetromino, 8 clear flash, 9 game over. */
export type TetrisFrames = number[][];

type Cell = [number, number];

const SHAPES: { id: number; rot: Cell[][] }[] = [
  {
    id: 1,
    rot: [
      [
        [0, 1],
        [1, 1],
        [2, 1],
        [3, 1],
      ],
      [
        [2, 0],
        [2, 1],
        [2, 2],
        [2, 3],
      ],
    ],
  },
  {
    id: 2,
    rot: [
      [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ],
    ],
  },
  {
    id: 3,
    rot: [
      [
        [1, 0],
        [0, 1],
        [1, 1],
        [2, 1],
      ],
      [
        [1, 0],
        [1, 1],
        [2, 1],
        [1, 2],
      ],
      [
        [0, 1],
        [1, 1],
        [2, 1],
        [1, 2],
      ],
      [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, 2],
      ],
    ],
  },
  {
    id: 4,
    rot: [
      [
        [1, 0],
        [2, 0],
        [0, 1],
        [1, 1],
      ],
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 2],
      ],
    ],
  },
  {
    id: 5,
    rot: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [2, 1],
      ],
      [
        [1, 0],
        [0, 1],
        [1, 1],
        [0, 2],
      ],
    ],
  },
  {
    id: 6,
    rot: [
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [2, 1],
      ],
      [
        [1, 0],
        [2, 0],
        [1, 1],
        [1, 2],
      ],
      [
        [0, 1],
        [1, 1],
        [2, 1],
        [2, 2],
      ],
      [
        [1, 0],
        [1, 1],
        [0, 2],
        [1, 2],
      ],
    ],
  },
  {
    id: 7,
    rot: [
      [
        [2, 0],
        [0, 1],
        [1, 1],
        [2, 1],
      ],
      [
        [1, 0],
        [1, 1],
        [1, 2],
        [2, 2],
      ],
      [
        [0, 1],
        [1, 1],
        [2, 1],
        [0, 2],
      ],
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [1, 2],
      ],
    ],
  },
];

const PIECES = SHAPES.map(({ id, rot }) => ({
  id,
  rot: rot.map((cells) => {
    const left = Math.min(...cells.map((c) => c[0]));
    const top = Math.min(...cells.map((c) => c[1]));
    return cells.map(([x, y]) => [x - left, y - top] as Cell);
  }),
}));

function hits(board: number[], cells: Cell[], ox: number, oy: number, w: number, h: number): boolean {
  for (const [cx, cy] of cells) {
    const x = ox + cx;
    const y = oy + cy;
    if (x < 0 || x >= w || y >= h) return true;
    if (y >= 0 && board[y * w + x]) return true;
  }
  return false;
}

function fall(board: number[], cells: Cell[], ox: number, from: number, w: number, h: number): number {
  let y = from;
  while (!hits(board, cells, ox, y + 1, w, h)) y++;
  return y;
}

function stamp(board: number[], cells: Cell[], ox: number, oy: number, id: number, w: number): number[] {
  const next = [...board];
  for (const [cx, cy] of cells) {
    const y = oy + cy;
    if (y >= 0) next[y * w + ox + cx] = id;
  }
  return next;
}

function fullRows(board: number[], w: number, h: number): number[] {
  const rows: number[] = [];
  for (let r = 0; r < h; r++) {
    let full = true;
    for (let c = 0; c < w; c++) {
      if (!board[r * w + c]) {
        full = false;
        break;
      }
    }
    if (full) rows.push(r);
  }
  return rows;
}

function collapse(board: number[], rows: number[], w: number, h: number): number[] {
  const kept: number[][] = [];
  for (let r = 0; r < h; r++) {
    if (rows.includes(r)) continue;
    kept.push(board.slice(r * w, r * w + w));
  }
  const next = new Array<number>((h - kept.length) * w).fill(0);
  for (const row of kept) next.push(...row);
  return next;
}

function rate(board: number[], lines: number, w: number, h: number): number {
  const heights: number[] = [];
  let holes = 0;
  for (let c = 0; c < w; c++) {
    let top = h;
    for (let r = 0; r < h; r++) {
      if (board[r * w + c]) {
        top = r;
        break;
      }
    }
    heights.push(h - top);
    for (let r = top + 1; r < h; r++) if (!board[r * w + c]) holes++;
  }
  let stack = 0;
  let bumps = 0;
  for (let c = 0; c < w; c++) {
    stack += heights[c];
    if (c) bumps += Math.abs(heights[c] - heights[c - 1]);
  }
  return -0.51 * stack + 0.76 * lines - 0.36 * holes - 0.18 * bumps;
}

type Move = { rot: number; x: number; y: number; value: number };

function moves(board: number[], piece: { id: number; rot: Cell[][] }, w: number, h: number): Move[] {
  const out: Move[] = [];
  for (let r = 0; r < piece.rot.length; r++) {
    const cells = piece.rot[r];
    const span = Math.max(...cells.map((c) => c[0]));
    for (let x = 0; x + span < w; x++) {
      const y = fall(board, cells, x, -4, w, h);
      const landed = stamp(board, cells, x, y, piece.id, w);
      const lines = fullRows(landed, w, h);
      out.push({ rot: r, x, y, value: rate(collapse(landed, lines, w, h), lines.length, w, h) });
    }
  }
  return out.sort((a, b) => b.value - a.value);
}

function bag(): number[] {
  const order = [0, 1, 2, 3, 4, 5, 6];
  for (let i = order.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function generateTetrisFrames(w: number, h: number): TetrisFrames {
  const cells = w * h;
  const frames: TetrisFrames = [];
  let board = new Array<number>(cells).fill(0);
  let queue: number[] = [];
  let placed = 0;
  let alive = true;

  while (alive && placed < 60 && frames.length < 900) {
    if (!queue.length) queue = bag();
    const piece = PIECES[queue.shift()!];
    const spots = moves(board, piece, w, h);
    if (!spots.length) break;

    const slip = Math.max(0, placed - 10) * 0.06;
    const spot = spots[Math.random() < slip ? Math.min(spots.length - 1, 1 + ((Math.random() * 2) | 0)) : 0];
    const shape = piece.rot[spot.rot];
    const tall = Math.max(...shape.map((c) => c[1])) + 1;

    for (let y = -tall; y <= spot.y; y++) {
      if (y + tall <= 0) continue;
      frames.push(stamp(board, shape, spot.x, y, piece.id, w));
    }

    board = stamp(board, shape, spot.x, spot.y, piece.id, w);
    if (shape.some(([, cy]) => spot.y + cy < 0)) alive = false;

    const rows = fullRows(board, w, h);
    if (rows.length) {
      const flash = [...board];
      for (const r of rows) for (let c = 0; c < w; c++) flash[r * w + c] = 8;
      frames.push(flash, [...board], flash);
      board = collapse(board, rows, w, h);
      frames.push([...board], [...board]);
    }

    placed++;
  }

  const flood = [...board];
  for (let r = h - 1; r >= 0; r--) {
    for (let c = 0; c < w; c++) flood[r * w + c] = 9;
    frames.push([...flood]);
  }
  const empty = new Array<number>(cells).fill(0);
  frames.push([...flood], empty, [...flood], empty, empty);

  return frames;
}

/* -------------------------------------------------------------------------- */
/*                                  component                                 */
/* -------------------------------------------------------------------------- */

const PALETTE = [
  "var(--tetris-1)",
  "var(--tetris-2)",
  "var(--tetris-3)",
  "var(--tetris-4)",
  "var(--tetris-5)",
  "var(--tetris-6)",
  "var(--tetris-7)",
];

type Size = number | string;
const size = (value: Size) => (typeof value === "number" ? `${value}px` : value);

export type TetrisLoaderProps = {
  columns?: number;
  rows?: number;
  cellSize?: Size;
  gap?: Size;
  speed?: number;
  playing?: boolean;
  loop?: boolean;
  onComplete?: () => void;
  label?: string;
  colors?: readonly string[];
  flashColor?: string;
  deadColor?: string;
  dotClassName?: string;
} & ComponentProps<"div">;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => setReduced(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);
  return reduced;
}

export function TetrisLoader({
  columns = 8,
  rows = 16,
  cellSize = 6,
  gap = 2,
  speed = 40,
  playing = true,
  loop = true,
  onComplete,
  label = "Loading",
  colors = PALETTE,
  flashColor = "var(--tetris-flash)",
  deadColor = "var(--tetris-dead)",
  dotClassName,
  className,
  style,
  ...props
}: TetrisLoaderProps) {
  const width = Math.max(4, Math.round(columns));
  const height = Math.max(6, Math.round(rows));

  const gridRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  const reduced = useReducedMotion();
  const [round, setRound] = useState(0);
  // Each completed round intentionally invalidates this randomized frame set.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const game = useMemo(() => generateTetrisFrames(width, height), [width, height, round]);

  const completeRef = useRef(onComplete);
  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    frame.current = 0;
  }, [game]);

  const paint = useCallback(
    (dots: HTMLDivElement[], index: number) => {
      const board = game?.[index];
      if (!board) return;
      dots.forEach((dot, i) => {
        const value = board[i] ?? 0;
        dot.style.backgroundColor = value ? `var(--tetris-cell-${value})` : "";
      });
    },
    [game],
  );

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const dots = Array.from(grid.children) as HTMLDivElement[];
    if (frame.current >= game.length) frame.current = 0;

    if (reduced) {
      paint(dots, Math.floor(game.length * 0.55));
      return;
    }

    paint(dots, frame.current);
    if (!playing) return;

    let request = 0;
    let last = performance.now();
    let owed = 0;

    const tick = (now: number) => {
      owed += now - last;
      last = now;
      if (owed > speed * 4) owed = speed;

      let ended = false;
      while (owed >= speed) {
        owed -= speed;
        frame.current++;
        if (frame.current >= game.length) {
          ended = true;
          break;
        }
      }

      paint(dots, Math.min(frame.current, game.length - 1));

      if (!ended) {
        request = requestAnimationFrame(tick);
        return;
      }

      completeRef.current?.();
      if (loop) setRound((r) => r + 1);
      else frame.current = game.length - 1;
    };

    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [game, playing, speed, loop, paint, reduced]);

  const vars: Record<string, string> = {
    "--tetris-cell": size(cellSize),
    "--tetris-gap": size(gap),
    "--tetris-cell-8": flashColor,
    "--tetris-cell-9": deadColor,
  };
  for (let i = 0; i < 7; i++) vars[`--tetris-cell-${i + 1}`] = colors[i] ?? PALETTE[i];

  return (
    <div
      ref={gridRef}
      role="status"
      aria-label={label}
      aria-busy={playing && !reduced}
      className={["tetris-loader", className].filter(Boolean).join(" ")}
      style={
        {
          gridTemplateColumns: `repeat(${width}, var(--tetris-cell))`,
          gap: "var(--tetris-gap)",
          ...vars,
          ...style,
        } as CSSProperties
      }
      {...props}
    >
      {Array.from({ length: width * height }).map((_, i) => (
        <div
          key={i}
          className={["tetris-loader-cell", dotClassName].filter(Boolean).join(" ")}
          style={{ height: "var(--tetris-cell)", borderRadius: "calc(var(--tetris-cell) / 3)" }}
        />
      ))}
    </div>
  );
}

export default TetrisLoader;
