"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/** Place create-guide: 100px left of sheet, 20px under side (Recent/QR). */
export function useSheetGuide(
  sheetRef: RefObject<HTMLElement | null>,
  sideRef: RefObject<HTMLElement | null>,
) {
  const [guide, setGuide] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    const side = sideRef.current;
    if (!sheet || !side) return;
    const place = () => {
      const s = sheet.getBoundingClientRect();
      const p = side.getBoundingClientRect();
      const left = s.left - 100;
      const top = p.bottom + 20;
      setGuide((g) => (g && g.left === left && g.top === top ? g : { left, top }));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(sheet);
    ro.observe(side);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [sheetRef, sideRef]);

  return guide;
}
