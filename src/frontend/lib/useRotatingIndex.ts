"use client";

import { useEffect, useState } from "react";

/** Random index ≠ current, every `ms`. Pauses when the tab is hidden. */
export function useRotatingIndex(length: number, ms = 2200): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (length < 2) return;
    const tick = () => {
      if (document.hidden) return;
      setI((cur) => {
        let n = cur % length;
        while (n === cur % length) n = Math.floor(Math.random() * length);
        return n;
      });
    };
    const t = setInterval(tick, ms);
    return () => clearInterval(t);
  }, [length, ms]);
  return i % Math.max(length, 1);
}
