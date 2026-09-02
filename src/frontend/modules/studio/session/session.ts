import { commitStatus, type AnnObj, type Doc } from "../geometry/doc";
import * as studioApi from "../api";
import type {
  CommitResult,
  DeleteImageResult,
  ImgRow,
  OkErr,
  StudioSnapshot,
  StudioState,
  ToastUndo,
} from "./types";

function initial(projectId: string, boot?: Partial<StudioState>): StudioState {
  return {
    projectId,
    project: null,
    list: [],
    index: 0,
    doc: null,
    selected: null,
    urlSelected: null,
    tab: "labels",
    tool: undefined,
    loadState: "loading",
    assistOn: true,
    assistBusy: false,
    assistedIds: new Set(),
    uploadOpen: false,
    uploadBusy: false,
    uploadErr: null,
    toast: null,
    toastOut: false,
    toastUndo: null,
    agentToast: null,
    agentToastOut: false,
    edit: null,
    draft: "",
    histOpen: false,
    histPos: null,
    commentsOpen: false,
    commentsPos: null,
    commentsSide: false,
    synthOpen: false,
    synthPos: null,
    tip: null,
    ...boot,
  };
}

export class StudioSession {
  private state: StudioState;
  private listeners = new Set<() => void>();
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  private agentToastTimer: ReturnType<typeof setTimeout> | null = null;
  private imageAbort: AbortController | null = null;
  private destroyed = false;

  constructor(projectId: string, boot?: Partial<StudioState>) {
    this.state = initial(projectId, boot);
  }

  getState = (): StudioState => this.state;

  snapshot = (): StudioSnapshot => {
    const s = this.state;
    return {
      projectId: s.projectId,
      project: s.project,
      list: s.list,
      index: s.index,
      doc: s.doc,
    };
  };

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  destroy() {
    this.destroyed = true;
    this.imageAbort?.abort();
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (this.undoTimer) clearTimeout(this.undoTimer);
    if (this.agentToastTimer) clearTimeout(this.agentToastTimer);
    this.listeners.clear();
  }

  private patch(partial: Partial<StudioState> | ((s: StudioState) => Partial<StudioState>)) {
    if (this.destroyed) return;
    const next = typeof partial === "function" ? partial(this.state) : partial;
    this.state = { ...this.state, ...next };
    for (const fn of this.listeners) fn();
  }

  // ── load ──────────────────────────────────────────────

  async load() {
    this.patch({ loadState: "loading" });
    try {
      const [p, imgs] = await Promise.all([
        studioApi.fetchProject(this.state.projectId),
        studioApi.fetchImages(this.state.projectId),
      ]);
      if (!p || typeof p !== "object" || !("id" in p)) throw new Error("project");
      this.patch({
        project: p,
        list: imgs,
        assistOn: p.type === "keypoints",
        assistedIds: new Set(),
        loadState: "ready",
      });
      await this.loadCurrentImage();
    } catch {
      this.patch({ loadState: "error" });
    }
  }

  private applyDoc(doc: Doc) {
    const selected =
      this.state.selected && doc.objects.some((o) => o.id === this.state.selected)
        ? this.state.selected
        : (doc.objects[0]?.id ?? null);
    this.patch({ doc, selected, urlSelected: selected });
  }

  async loadCurrentImage() {
    this.imageAbort?.abort();
    const ac = new AbortController();
    this.imageAbort = ac;

    const { list, index, project, projectId, assistOn, assistedIds } = this.state;
    const iid = list[Math.min(index, Math.max(0, list.length - 1))]?.id;
    if (!iid) {
      this.patch({ doc: null });
      return;
    }

    this.patch({
      edit: null,
      histOpen: false,
      commentsOpen: false,
      synthOpen: false,
    });

    try {
      const doc = await studioApi.fetchImage(projectId, iid);
      if (ac.signal.aborted) return;

      const willAssist =
        assistOn && project?.type === "keypoints" && !doc.objects.length && !assistedIds.has(iid);

      if (!willAssist) {
        this.applyDoc(doc);
        return;
      }

      // Seed flag + busy before paint so Valid/Invalid doesn't flash on empty doc.
      const nextAssisted = new Set(assistedIds);
      nextAssisted.add(iid);
      const selected =
        this.state.selected && doc.objects.some((o) => o.id === this.state.selected)
          ? this.state.selected
          : (doc.objects[0]?.id ?? null);
      this.patch({ doc, selected, urlSelected: selected, assistedIds: nextAssisted, assistBusy: true });
      try {
        const d2 = await studioApi.postAssist(projectId, iid, false, ac.signal);
        if (ac.signal.aborted) return;
        this.applyDoc(d2);
      } catch (e) {
        if ((e as Error)?.name === "AbortError") {
          const roll = new Set(this.state.assistedIds);
          roll.delete(iid);
          this.patch({ assistedIds: roll });
        }
      } finally {
        if (!ac.signal.aborted) this.patch({ assistBusy: false });
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      this.patch({ doc: null });
    }
  }

  // ── navigation ────────────────────────────────────────

  setIndex(i: number) {
    const n = this.state.list.length;
    const next = n ? Math.min(Math.max(0, i), n - 1) : 0;
    if (next === this.state.index) return;
    this.patch({ index: next, doc: null, selected: null, urlSelected: null });
    void this.loadCurrentImage();
  }

  nextOpen() {
    const { list, index } = this.state;
    if (!list.length) return;
    const idx = Math.min(index, list.length - 1);
    for (let k = 1; k < list.length; k++) {
      const j = (idx + k) % list.length;
      if (!list[j].committed) {
        this.setIndex(j);
        return;
      }
    }
  }

  async waitForImage(imageId: string, ms = 2500): Promise<boolean> {
    const t0 = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (this.state.doc?.id === imageId) {
          resolve(true);
          return;
        }
        if (Date.now() - t0 > ms) {
          resolve(false);
          return;
        }
        setTimeout(tick, 16);
      };
      tick();
    });
  }

  // ── objects ───────────────────────────────────────────

  async saveObjects(objects: AnnObj[], options?: { selectFallback?: boolean }) {
    const d = this.state.doc;
    if (!d) return;
    const previousList = this.state.list;
    const previousSelected = this.state.selected;
    const previousUrlSelected = this.state.urlSelected;
    const next: Doc = { ...d, objects };
    const empty = objects.length === 0;
    const list = this.state.list.map((x) => (x.id === d.id ? { ...x, empty } : x));
    const selected =
      this.state.selected && objects.some((o) => o.id === this.state.selected)
        ? this.state.selected
        : options?.selectFallback === false
          ? null
          : (objects[0]?.id ?? null);
    this.patch({
      doc: next,
      list,
      selected,
      urlSelected: options?.selectFallback === false ? this.state.urlSelected : selected,
    });
    try {
      await studioApi.putImage(this.state.projectId, next, objects);
    } catch (error) {
      if (this.state.doc === next) {
        this.patch({
          doc: d,
          list: previousList,
          selected: previousSelected,
          urlSelected: previousUrlSelected,
        });
      }
      throw error;
    }
  }

  setSelected(id: string | null) {
    this.patch({ selected: id, urlSelected: id });
  }

  // ── classes ───────────────────────────────────────────

  async ensureClass(label: string) {
    const p = this.state.project;
    if (!p || p.classes.includes(label)) return;
    const optimistic = { ...p, classes: [...p.classes, label] };
    this.patch({ project: optimistic });
    const row = await studioApi.postClass(this.state.projectId, label);
    if (row) this.patch({ project: row });
  }

  async renameClass(oldName: string, name: string) {
    const label = name.trim();
    if (!label || label === oldName) return;
    const row = await studioApi.patchClass(this.state.projectId, oldName, label);
    if (!row) return;
    const doc = this.state.doc;
    this.patch({
      project: row,
      doc: doc
        ? { ...doc, objects: doc.objects.map((o) => (o.label === oldName ? { ...o, label } : o)) }
        : doc,
    });
  }

  async dropClass(name: string) {
    const row = await studioApi.deleteClass(this.state.projectId, name);
    if (!row) return;
    const doc = this.state.doc;
    this.patch({
      project: row,
      doc: doc
        ? {
            ...doc,
            objects: doc.objects.map((o) => (o.label === name ? { ...o, label: null } : o)),
          }
        : doc,
    });
  }

  // ── commit / delete ───────────────────────────────────

  async commitCurrent(): Promise<CommitResult> {
    const d = this.state.doc;
    const ls = this.state.list;
    if (!d) return { ok: false, error: "no_image" };
    const status = commitStatus(d.objects);
    if (!status.can_commit) {
      return {
        ok: false,
        error: "cannot_commit",
        reason: status.reasons.join(", ") || "blocked",
      };
    }
    const first = !d.committed;
    const prev = d.objects;
    try {
      const body = await studioApi.postCommit(this.state.projectId, d.id);
      const nextDoc: Doc = {
        ...d,
        committed: true,
        history: body.history ?? d.history,
      };
      const list = this.state.list.map((x) => (x.id === d.id ? { ...x, committed: true } : x));
      this.patch({ doc: nextDoc, list });
      if (!first) {
        this.showToast("Updated", { undo: { kind: "objects", objects: prev }, holdMs: 5000 });
        return { ok: true, advanced: false };
      }
      this.showToast("Committed", { holdMs: 1200 });
      const i = this.state.index;
      const advancedTo = Math.min(i + 1, Math.max(0, ls.length - 1));
      if (advancedTo !== i) this.setIndex(advancedTo);
      return { ok: true, advanced: advancedTo !== i };
    } catch {
      return { ok: false, error: "cannot_commit", reason: "Commit failed" };
    }
  }

  async deleteCurrent(): Promise<DeleteImageResult> {
    const d = this.state.doc;
    const ls = this.state.list;
    if (!d || !ls.length) return { ok: false, error: "no_image" };
    const iid = d.id;
    const at = this.state.index;
    const ok = await studioApi.deleteImage(this.state.projectId, iid);
    if (!ok) return { ok: false, error: "delete_failed" };
    const next = ls.filter((x) => x.id !== iid);
    const ni = Math.min(at, Math.max(0, next.length - 1));
    this.patch({
      list: next,
      selected: null,
      urlSelected: null,
      edit: null,
      histOpen: false,
      commentsOpen: false,
      doc: null,
      index: ni,
    });
    if (next.length) void this.loadCurrentImage();
    this.showToast("Deleted", { undo: { kind: "image", id: iid, index: at }, holdMs: 5000 });
    return { ok: true, deleted_id: iid };
  }

  async undoLast(): Promise<boolean> {
    const u = this.state.toastUndo;
    if (!u) return false;
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.patch({ toastUndo: null });
    if (u.kind === "objects") {
      await this.saveObjects(u.objects);
      this.showToast("Reverted", { holdMs: 1000 });
      return true;
    }
    const item = await studioApi.restoreImage(this.state.projectId, u.id);
    if (!item) {
      this.showToast("Restore failed", { holdMs: 1500 });
      return true;
    }
    const ls = this.state.list;
    if (!ls.some((x) => x.id === item.id)) {
      const next = [...ls];
      next.splice(Math.min(u.index, next.length), 0, item);
      this.patch({ list: next, index: u.index });
      void this.loadCurrentImage();
    } else {
      this.patch({ index: u.index });
      void this.loadCurrentImage();
    }
    this.showToast("Restored", { holdMs: 1200 });
    return true;
  }

  // ── comments ──────────────────────────────────────────

  async addComment(body: string): Promise<OkErr> {
    const d = this.state.doc;
    if (!d) return { ok: false, error: "no_image" };
    try {
      const next = await studioApi.postComment(this.state.projectId, d.id, body);
      this.applyDoc(next);
      return { ok: true };
    } catch {
      return { ok: false, error: "comment_failed" };
    }
  }

  async deleteComment(cid: string): Promise<OkErr> {
    const d = this.state.doc;
    if (!d) return { ok: false, error: "no_image" };
    try {
      const next = await studioApi.deleteComment(this.state.projectId, d.id, cid);
      this.applyDoc(next);
      return { ok: true };
    } catch {
      return { ok: false, error: "comment_failed" };
    }
  }

  // ── assist ────────────────────────────────────────────

  toggleAssist() {
    if (this.state.project?.type !== "keypoints") return;
    this.patch({ assistOn: !this.state.assistOn });
  }

  async reseedAssist() {
    const { project, doc, assistBusy, projectId, assistedIds } = this.state;
    if (project?.type !== "keypoints" || !doc || assistBusy) return;
    const next = new Set(assistedIds);
    next.add(doc.id);
    this.patch({ assistedIds: next, assistBusy: true });
    try {
      const d2 = await studioApi.postAssist(projectId, doc.id, true);
      this.applyDoc(d2);
    } catch {
      /* silent */
    } finally {
      this.patch({ assistBusy: false });
    }
  }

  // ── upload UI ─────────────────────────────────────────

  openUpload() {
    this.patch({ uploadErr: null, uploadOpen: true });
  }

  closeUpload() {
    if (this.state.uploadBusy) return;
    this.patch({ uploadOpen: false });
  }

  setUploadBusy(v: boolean) {
    this.patch({ uploadBusy: v });
  }

  setUploadErr(err: string | null) {
    this.patch({ uploadErr: err });
  }

  async afterUpload(added: ImgRow[]) {
    const imgs = await studioApi.fetchImages(this.state.projectId);
    this.patch({ list: imgs, uploadOpen: false });
    if (added[0]?.id) {
      const j = imgs.findIndex((x) => x.id === added[0].id);
      if (j >= 0) this.setIndex(j);
    }
    this.showToast(`Added ${added.length}`, { holdMs: 1200 });
  }

  // ── UI chrome ─────────────────────────────────────────

  setTab(tab: "labels" | "objects") {
    this.patch({ tab });
  }

  setTool(tool: StudioState["tool"]) {
    this.patch({ tool });
  }

  setTip(tip: StudioState["tip"]) {
    this.patch({ tip });
  }

  openNewLabel() {
    this.patch({
      tip: null,
      histOpen: false,
      commentsOpen: false,
      synthOpen: false,
      tab: "labels",
      draft: "",
      edit: "new",
    });
  }

  setEdit(edit: string | null) {
    this.patch({ edit });
  }

  setDraft(draft: string) {
    this.patch({ draft });
  }

  selectObject(id: string) {
    this.patch({
      selected: id,
      urlSelected: id,
      commentsOpen: false,
      histOpen: false,
      edit: id,
      draft: "",
    });
  }

  editObject(oid: string | null) {
    if (oid == null) {
      this.patch({ edit: this.state.edit === "new" ? "new" : null });
      return;
    }
    this.patch({
      commentsOpen: false,
      histOpen: false,
      edit: oid,
      selected: oid,
      urlSelected: oid,
      draft: "",
    });
  }

  toggleHistory(btn: HTMLElement) {
    this.patch({ tip: null, commentsOpen: false });
    if (this.state.histOpen) {
      this.patch({ histOpen: false });
      return;
    }
    const r = btn.getBoundingClientRect();
    const foot = btn.closest("footer")?.getBoundingClientRect();
    this.patch({
      histPos: { x: r.left + r.width / 2, y: foot?.top ?? r.top },
      histOpen: true,
    });
  }

  closeHistory() {
    this.patch({ histOpen: false });
  }

  toggleComments(btn: HTMLElement, side: boolean) {
    this.patch({ tip: null, histOpen: false, synthOpen: false, edit: null });
    if (this.state.commentsOpen) {
      this.patch({ commentsOpen: false });
      return;
    }
    const r = btn.getBoundingClientRect();
    const foot = btn.closest("footer")?.getBoundingClientRect();
    this.patch({
      commentsSide: side,
      commentsPos: side
        ? { x: r.right + 12, y: r.top + r.height / 2 }
        : { x: r.left + r.width / 2, y: foot?.top ?? r.top },
      commentsOpen: true,
    });
  }

  closeComments() {
    this.patch({ commentsOpen: false });
  }

  toggleSynthetic(btn: HTMLElement) {
    this.patch({ tip: null, histOpen: false, commentsOpen: false, edit: null });
    if (this.state.synthOpen) {
      this.patch({ synthOpen: false });
      return;
    }
    const r = btn.getBoundingClientRect();
    this.patch({
      synthPos: { x: r.right + 12, y: r.top + r.height / 2 },
      synthOpen: true,
    });
  }

  closeSynthetic() {
    this.patch({ synthOpen: false });
  }

  dismissPanels() {
    this.patch({ edit: null, histOpen: false, commentsOpen: false, synthOpen: false });
  }

  showToast(msg: string, opts?: { holdMs?: number; undo?: ToastUndo }) {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.patch({
      toastOut: false,
      toast: msg,
      toastUndo: opts?.undo ?? null,
    });
    if (opts?.holdMs != null) {
      this.toastTimer = setTimeout(() => this.patch({ toastOut: true }), opts.holdMs);
    }
    if (opts?.undo) {
      this.undoTimer = setTimeout(() => {
        this.patch({ toastUndo: null, toastOut: true });
      }, opts.holdMs ?? 5000);
    }
  }

  clearToast() {
    this.patch({ toast: null, toastOut: false });
  }

  /** Agent WebMCP tool invoke — separate from human toasts so they don't clobber each other. */
  showAgentTool(name: string, holdMs = 1600) {
    if (this.agentToastTimer) clearTimeout(this.agentToastTimer);
    this.patch({
      agentToastOut: false,
      agentToast: `Agent used \`${name}\``,
    });
    this.agentToastTimer = setTimeout(() => this.patch({ agentToastOut: true }), holdMs);
  }

  clearAgentToast() {
    this.patch({ agentToast: null, agentToastOut: false });
  }

  clampIndexToList() {
    const { list, index } = this.state;
    if (list.length && index >= list.length) this.patch({ index: list.length - 1 });
  }
}

export function createStudioSession(
  projectId: string,
  boot?: Partial<StudioState>,
): StudioSession {
  return new StudioSession(projectId, boot);
}
