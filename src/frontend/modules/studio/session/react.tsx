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
  const bootRef = useRef(boot);
  // One session for this provider mount. Parent should remount (key=projectId) on id change.
  const [session] = useState(() => createStudioSession(projectId, bootRef.current));

  useEffect(() => {
    void session.load();
    return () => session.destroy();
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
  const selRef = useRef(sel);
  selRef.current = sel;

  return useSyncExternalStore(
    session.subscribe,
    () => selRef.current(session.getState()),
    () => selRef.current(session.getState()),
  );
}
