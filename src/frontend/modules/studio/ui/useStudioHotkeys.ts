"use client";

import { useEffect } from "react";
import { commitStatus, named } from "../geometry/doc";
import type { StudioSession } from "../session";

/** Global studio keyboard shortcuts (label, nav, commit, undo toast, rail). */
export function useStudioHotkeys(session: StudioSession, opts?: { toggleRail?: () => void }) {
  const toggleRail = opts?.toggleRail;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        if (!session.getState().toastUndo) return;
        e.preventDefault();
        e.stopPropagation();
        void session.undoLast();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleRail?.();
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      const st = session.getState();
      const objects = st.doc?.objects ?? [];
      const classes = (st.project?.classes ?? []).filter((c) => named(c));
      const canCommit = commitStatus(objects).can_commit;
      if (k === "j") {
        e.preventDefault();
        session.setIndex(st.index + 1);
        return;
      }
      if (k === "k") {
        e.preventDefault();
        session.setIndex(st.index - 1);
        return;
      }
      if (k === "c" && canCommit) {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>("footer [data-tip=commit]:not(:disabled)")?.click();
        return;
      }
      if (k === "e") {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>("footer [data-tip=export]:not(:disabled)")?.click();
        return;
      }
      if (k === "l" || e.code === "KeyL") {
        e.preventDefault();
        session.openNewLabel();
        return;
      }
      if (k === "n") {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>("footer [data-tip=next-open]:not(:disabled)")?.click();
        return;
      }
      if (k === "h") {
        e.preventDefault();
        document.querySelector<HTMLElement>("[data-tip=history]")?.click();
        return;
      }
      if (k === "t") {
        e.preventDefault();
        document.querySelector<HTMLElement>("[data-tip=comment]")?.click();
        return;
      }
      if (k === "escape") {
        session.dismissPanels();
        return;
      }
      if ((k === "backspace" || k === "delete") && st.selected) {
        e.preventDefault();
        void session.saveObjects(objects.filter((o) => o.id !== st.selected));
        session.setEdit(null);
        return;
      }
      if (/^[1-9]$/.test(e.key) && st.selected) {
        const cls = classes[Number(e.key) - 1];
        if (!cls) return;
        e.preventDefault();
        void session.saveObjects(
          objects.map((o) => (o.id === st.selected ? { ...o, label: cls } : o)),
        );
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [session, toggleRail]);
}
