"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createStudioSession, type StudioSession } from "./session";
import type { StudioState } from "./types";

const Ctx = createContext<StudioSession | null>(null);

export function StudioProvider({
  projectId,
  boot,
  children,
}: {
  projectId: string;
  boot?: Partial<StudioState>;
  children: ReactNode;
}) {
  // One session for this provider mount. Parent should remount (key=projectId) on id change.
  const [session] = useState(() => createStudioSession(projectId, boot));
  const loaded = useRef(false);
  const destroyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (destroyTimer.current !== null) {
      clearTimeout(destroyTimer.current);
      destroyTimer.current = null;
    }
    if (!loaded.current) {
      loaded.current = true;
      void session.load();
    }
    return () => {
      // Strict Mode immediately replays this Effect in development. Defer final
      // disposal so the replay can retain the same session; real unmounts do not.
      destroyTimer.current = setTimeout(() => session.destroy(), 0);
    };
  }, [session]);

  return <Ctx.Provider value={session}>{children}</Ctx.Provider>;
}

export function useStudioSession(): StudioSession {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStudioSession outside StudioProvider");
  return s;
}

export function useStudioState(): StudioState;
export function useStudioState<T>(selector: (s: StudioState) => T): T;
export function useStudioState<T>(selector?: (s: StudioState) => T): T | StudioState {
  const session = useStudioSession();
  const sel = selector ?? ((s: StudioState) => s as unknown as T);

  return useSyncExternalStore(
    session.subscribe,
    () => sel(session.getState()),
    () => sel(session.getState()),
  );
}
