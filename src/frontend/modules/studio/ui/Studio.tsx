"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Canvas from "../canvas/Canvas";
import { commitStatus, named, writeObjects, type AnnObj } from "../geometry/doc";
import {
  cancelAugmentationJob,
  createAugmentationJob,
  exportUrl,
  fetchAugmentationJob,
  fetchAugmentationJobs,
  fetchProjectComments,
  retryAugmentationJob,
} from "../api";
import { StudioProvider, useStudioSession, useStudioState, type StudioSession } from "../session";
import { studioPageTools } from "../tools/studioTools";
import { rigPageTools } from "../tools/rigTools";
import { boxPageTools, polyPageTools } from "../tools/shapeTools";
import { onWebMcpActivity, onWebMcpInvoke, registerWebMcpTools } from "@/shared/webmcp";
import Classes from "./Classes";
import Comments from "./Comments";
import Synthetic from "./Synthetic";
import Footer from "./Footer";
import LabelForm from "./LabelForm";
import HistoryPanel from "./HistoryPanel";
import StudioUpload from "./StudioUpload";
import { useStudioHotkeys } from "./useStudioHotkeys";

function relTime(iso: string) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const sec = Math.round((t - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const abs = Math.abs(sec);
  if (abs < 60) return rtf.format(sec, "second");
  if (abs < 3600) return rtf.format(Math.round(sec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), "hour");
  return rtf.format(Math.round(sec / 86400), "day");
}

function urlStateKey(state: Pick<ReturnType<StudioSession["getState"]>, "index" | "tab" | "urlSelected" | "tool">) {
  return [state.index, state.tab, state.urlSelected ?? "", state.tool ?? ""].join("\0");
}

function StudioBody() {
  const session = useStudioSession();
  const s = useStudioState();
  const router = useRouter();
  const pathname = usePathname();
  const webMcpUrl = useRef({ active: 0, suppressed: null as string | null });

  const {
    project,
    list,
    pageOffset,
    total,
    committedCount,
    index,
    doc,
    selected,
    urlSelected,
    tab,
    tool,
    loadState,
    assistOn,
    assistBusy,
    toast,
    toastOut,
    toastUndo,
    agentToast,
    agentToastOut,
    edit,
    draft,
    histOpen,
    histPos,
    commentsOpen,
    commentsPos,
    commentsSide,
    synthOpen,
    tip,
  } = s;

  useEffect(() => {
    const key = urlStateKey({ index, tab, urlSelected, tool });
    if (webMcpUrl.current.active || webMcpUrl.current.suppressed === key) return;
    const q = new URLSearchParams();
    if (index > 0) q.set("i", String(index));
    if (tab !== "labels") q.set("tab", tab);
    if (urlSelected) q.set("obj", urlSelected);
    if (tool && tool !== "landmarks" && tool !== "box" && tool !== "polygon") q.set("tool", tool);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [index, tab, urlSelected, tool, pathname, router]);

  useEffect(() => {
    session.clampIndexToList();
  }, [total, index, session]);

  const imageSizeRef = useRef<{
    imageId: string | null;
    size: { w: number; h: number } | null;
  }>({ imageId: null, size: null });
  const onImageSize = useCallback((size: { w: number; h: number } | null) => {
    imageSizeRef.current = { imageId: session.getState().doc?.id ?? null, size };
  }, [session]);

  useEffect(() => {
    if (loadState !== "ready") return;
    const ac = new AbortController();
    const saveObjects = async (objects: AnnObj[]) => {
      try {
        await session.saveObjects(objects, { selectFallback: false });
        return true;
      } catch {
        return false;
      }
    };
    const shapeDeps = {
      get: () => session.snapshot(),
      saveObjects,
      ensureClass: (name: string) => session.ensureClass(name),
      getImageSize: () => {
        const current = imageSizeRef.current;
        return current.imageId === session.getState().doc?.id ? current.size : null;
      },
    };
    const ptype = session.getState().project?.type;
    const tools = [
      ...studioPageTools({
        get: () => session.snapshot(),
        openImageAt: (i) => session.openImageAt(i),
        openImageById: (id) => session.openImageById(id),
        openNextUncommitted: () => session.nextOpen(),
        saveObjects,
        ensureClass: (name) => session.ensureClass(name),
        commitCurrent: () => session.commitCurrent(),
        deleteCurrent: () => session.deleteCurrent(),
        addComment: (body) => session.addComment(body),
        deleteComment: (cid) => session.deleteComment(cid),
        listComments: async () => {
          try {
            const images = await fetchProjectComments(session.getState().projectId);
            return { ok: true as const, images };
          } catch {
            return { ok: false as const, error: "list_failed" };
          }
        },
        waitForImage: (imageId, ms) => session.waitForImage(imageId, ms),
        createAugmentationJob: (body) =>
          createAugmentationJob(session.getState().projectId, body),
        listAugmentationJobs: (offset, limit) =>
          fetchAugmentationJobs(session.getState().projectId, offset, limit),
        getAugmentationJob: (jobId, itemOffset, itemLimit) =>
          fetchAugmentationJob(
            session.getState().projectId,
            jobId,
            itemOffset,
            itemLimit,
          ),
        refreshCatalog: () => session.refreshCatalog(),
        cancelAugmentationJob: (jobId) =>
          cancelAugmentationJob(session.getState().projectId, jobId),
        retryAugmentationJob: (jobId) =>
          retryAugmentationJob(session.getState().projectId, jobId),
      }),
      ...(ptype === "keypoints"
        ? rigPageTools({
            get: () => session.snapshot(),
            saveObjects,
          })
        : ptype === "boxes"
          ? boxPageTools(shapeDeps)
          : ptype === "polygons"
            ? polyPageTools(shapeDeps)
            : []),
    ];
    void registerWebMcpTools(tools, ac.signal, {
      onRegistrationError: (name) => session.showAgentRegistrationError(name),
    });
    return () => ac.abort();
  }, [session, loadState, project?.type]);

  // Live session listener — survives tool re-register / avoids destroyed-session closures
  useEffect(() => onWebMcpInvoke((name) => session.showAgentTool(name)), [session]);
  useEffect(
    () =>
      onWebMcpActivity((_name, active) => {
        if (active) {
          webMcpUrl.current.active += 1;
          return;
        }
        webMcpUrl.current.active = Math.max(0, webMcpUrl.current.active - 1);
        if (!webMcpUrl.current.active) {
          webMcpUrl.current.suppressed = urlStateKey(session.getState());
        }
      }),
    [session],
  );

  const [railOn, setRailOn] = useState(true);
  const toggleRail = useCallback(() => setRailOn((v) => !v), []);
  useStudioHotkeys(session, { toggleRail });

  const objects = useMemo(() => doc?.objects ?? [], [doc?.objects]);
  const editing = edit && edit !== "new" ? objects.find((o) => o.id === edit) : undefined;
  const classes = (project?.classes ?? []).filter((c) => named(c));
  const { can_commit: canCommit, reasons: commitReasons } = commitStatus(objects);
  const commitReason = commitReasons[0] ?? "";
  const validityLabel = canCommit
    ? "Valid annotation"
    : `Invalid annotation: ${commitReasons.join(", ") || "blocked"}`;
  const currentRow = list[index - pageOffset];
  const nCommitted = committedCount;
  const canNextOpen = total - committedCount > (currentRow?.committed ? 0 : 1);

  const stamp = useCallback(
    async (name: string) => {
      const label = name.trim();
      if (!label || !project) return;
      const creating = edit === "new";
      if (!(await session.ensureClass(label))) return;
      if (!creating) {
        const target = editing?.id ?? selected;
        if (target) {
          await session.saveObjects(objects.map((o) => (o.id === target ? { ...o, label } : o)));
        }
      }
      session.setEdit(null);
      session.setTab("labels");
    },
    [session, project, edit, editing?.id, selected, objects],
  );

  const railStatus = loadState === "error" ? "Could not load project." : undefined;
  // Project/image/assist wait is short — silent chrome + center tetris, no copy.
  const canvasBusy =
    loadState === "loading" ||
    (loadState === "ready" && total > 0 && (!doc?.url || assistBusy));

  const save = useCallback((objs: AnnObj[]) => void session.saveObjects(objs), [session]);
  const refreshCatalog = useCallback(() => session.refreshCatalog(), [session]);
  const openAugmentationOutput = useCallback(
    (imageId: string) => session.openImageById(imageId),
    [session],
  );

  return (
    <div className={railOn ? "shell" : "shell rail-off"}>
      <a href="#studio-main" className="skip-in">
        Skip to canvas
      </a>
      {railOn ? (
        <a href="/create" className="studio-back" aria-label="Back to projects">
          <svg viewBox="0 0 256 256" width="16" height="16" aria-hidden="true">
            <path
              d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z"
              fill="currentColor"
            />
          </svg>
        </a>
      ) : (
        <button type="button" className="studio-back" aria-label="Show labels rail" onClick={toggleRail}>
          <svg viewBox="0 0 256 256" width="16" height="16" aria-hidden="true">
            <path
              d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z"
              fill="currentColor"
            />
          </svg>
        </button>
      )}
      <h1 className="sr-only">Studio{project ? ` — ${project.name}` : ""}</h1>
      {loadState === "ready" && total > 0 && doc && !assistBusy && (
        <div className={`validity ${canCommit ? "ok" : "bad"}`} aria-live="polite">
          {validityLabel}
        </div>
      )}
      <Classes
        classes={classes}
        objects={objects}
        selected={selected}
        tab={tab}
        onTab={(t) => session.setTab(t)}
        status={railStatus}
        onSelect={(id) => session.selectObject(id)}
        onRename={(old, name) => void session.renameClass(old, name)}
        onAdd={() => session.openNewLabel()}
        onCollapse={toggleRail}
        onDrop={async (name) => {
          if (!confirm(`Delete ${name}?`)) return;
          await session.dropClass(name);
        }}
      />
      <div id="studio-main">
        <Canvas
          src={doc?.url ?? undefined}
          alt={doc?.image || (total === 0 ? "No images" : "Sample")}
          objects={doc ? objects : []}
          projectType={project?.type ?? "keypoints"}
          classes={classes}
          selectedId={doc ? selected : null}
          assistOn={assistOn}
          assistBusy={assistBusy}
          tool={tool}
          onTool={(t) => session.setTool(t)}
          onChange={doc ? save : () => {}}
          onSelect={doc ? (id) => session.setSelected(id) : () => {}}
          onAssistOn={() => session.toggleAssist()}
          onAssistReseed={() => void session.reseedAssist()}
          commentsOpen={!!doc && commentsOpen}
          commentCount={doc?.comments?.length ?? 0}
          syntheticOpen={synthOpen}
          onComment={doc ? (btn) => session.toggleComments(btn, true) : () => {}}
          onSynthetic={() => session.toggleSynthetic()}
          sidePanel={
            synthOpen ? (
              <Synthetic
                open
                onClose={() => session.closeSynthetic()}
                onCatalogChange={refreshCatalog}
                onOpenImage={openAugmentationOutput}
              />
            ) : null
          }
          onEdit={doc ? (oid) => session.editObject(oid) : () => {}}
          railOn={railOn}
          onToggleRail={toggleRail}
          onImageSize={onImageSize}
          busy={canvasBusy}
        />
      </div>
      {edit && (
        <LabelForm
          edit={edit}
          draft={draft}
          classes={classes}
          objects={objects}
          onDraft={(v) => session.setDraft(v)}
          onClose={() => session.setEdit(null)}
          onStamp={(name) => void stamp(name)}
          onDelete={() => {
            if (editing) void session.saveObjects(objects.filter((o) => o.id !== editing.id));
            session.setEdit(null);
          }}
        />
      )}
      <Footer
        path={doc && project ? `${project.name}/${doc.image}` : ""}
        index={total ? Math.min(index, total - 1) : 0}
        n={total}
        onPrev={() => session.setIndex(index - 1)}
        onNext={() => session.setIndex(index + 1)}
        onNextOpen={() => void session.nextOpen()}
        onDelete={() => void session.deleteCurrent()}
        onAdd={() => session.openUpload()}
        onCommit={async () => {
          const res = await session.commitCurrent();
          if (!res.ok && res.error === "cannot_commit" && res.reason === "Commit failed") {
            session.showToast("Commit failed", { holdMs: 1500 });
          }
        }}
        onCopy={() => {
          if (!doc) return;
          const payload = { image: doc.image, id: doc.id, objects: writeObjects(doc.objects) };
          void navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(
            () => session.showToast("Copied", { holdMs: 1200 }),
            () => session.showToast("Copy failed", { holdMs: 1600 }),
          );
        }}
        onExport={() => {
          location.href = exportUrl(session.getState().projectId);
        }}
        onHistory={(btn) => session.toggleHistory(btn)}
        onComment={(btn) => session.toggleComments(btn, false)}
        onTip={(t) => session.setTip(t)}
        canCommit={canCommit}
        commitReason={commitReason}
        nCommitted={nCommitted}
        canNextOpen={canNextOpen}
        histOpen={histOpen}
        commentsOpen={commentsOpen}
        commentCount={doc?.comments?.length ?? 0}
      />
      {commentsOpen && commentsPos && (
        <Comments
          open
          pos={commentsPos}
          side={commentsSide}
          comments={doc?.comments ?? []}
          objects={objects}
          classes={classes}
          selectedId={selected}
          onClose={() => session.closeComments()}
          onAdd={async (body) => {
            await session.addComment(body);
          }}
          onDelete={async (cid) => {
            await session.deleteComment(cid);
          }}
          onSelect={(oid) => {
            session.setSelected(oid);
            session.setTab("objects");
          }}
          relTime={relTime}
        />
      )}
      <HistoryPanel
        open={histOpen}
        pos={histPos}
        history={doc?.history ?? []}
        onClose={() => session.closeHistory()}
        onRestore={(objs) => void session.saveObjects(objs ?? [])}
      />
      {tip && (
        <span className="tip" data-foot-tip style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </span>
      )}
      <StudioUpload />
      {agentToast && (
        <div
          className={`live agent-live${agentToastOut ? " out" : ""}${toast ? " stacked" : ""}`}
          aria-live="polite"
          onAnimationEnd={(e) => {
            if (e.animationName !== "live-out") return;
            session.clearAgentToast();
          }}
        >
          {agentToast}
        </div>
      )}
      {toast && (
        <div
          className={`live${toastOut ? " out" : ""}`}
          aria-live="polite"
          onAnimationEnd={(e) => {
            if (e.animationName !== "live-out") return;
            session.clearToast();
          }}
        >
          {toast}
          {(toast === "Updated" || toast === "Deleted") && toastUndo && (
            <>
              {" "}
              <button type="button" className="undo-link" onClick={() => void session.undoLast()}>
                Undo
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Studio({ id }: { id: string }) {
  const sp = useSearchParams();
  const boot = useMemo(
    () => ({
      index: Math.max(0, Number(sp.get("i")) || 0),
      selected: sp.get("obj"),
      urlSelected: sp.get("obj"),
      tab: (sp.get("tab") === "objects" ? "objects" : "labels") as "labels" | "objects",
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once from initial URL
    [id],
  );
  return (
    <StudioProvider key={id} projectId={id} boot={boot}>
      <StudioBody />
    </StudioProvider>
  );
}
