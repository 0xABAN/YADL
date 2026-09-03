import { commitStatus, type AnnObj, type Doc } from "../geometry/doc";
import * as studioApi from "../api";
import type {
  AutoLabelStatus,
  CommitResult,
  DeleteImageResult,
  ImagePage,
  ImgRow,
  OkErr,
  StudioSnapshot,
  StudioState,
  ToastUndo,
} from "./types";

const PAGE_LIMIT = 100;

function catalogState(page: ImagePage) {
  return {
    list: page.items,
    pageOffset: page.offset,
    total: page.total,
    committedCount: page.committed,
    emptyCount: page.empty,
  };
}

function initial(projectId: string, boot?: Partial<StudioState>): StudioState {
  return {
    projectId,
    project: null,
    list: [],
    pageOffset: 0,
    total: 0,
    committedCount: 0,
    emptyCount: 0,
    index: 0,
    doc: null,
    selected: null,
    urlSelected: null,
    tab: "labels",
    tool: undefined,
    loadState: "loading",
    assistOn: true,
    assistBusy: false,
    autoLabelResults: new Map(),
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
      pageOffset: s.pageOffset,
      total: s.total,
      committedCount: s.committedCount,
      emptyCount: s.emptyCount,
      index: s.index,
      doc: s.doc,
      autoLabelStatus: s.doc ? (s.autoLabelResults.get(s.doc.id) ?? null) : null,
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
      const { index } = this.state;
      const offset = Math.floor(index / PAGE_LIMIT) * PAGE_LIMIT;
      const [p, page] = await Promise.all([
        studioApi.fetchProject(this.state.projectId),
        studioApi.fetchImages(this.state.projectId, offset, PAGE_LIMIT),
      ]);
      if (!p || typeof p !== "object" || !("id" in p)) throw new Error("project");
      this.patch({
        project: p,
        ...catalogState(page),
        index: page.total ? Math.min(index, page.total - 1) : 0,
        assistOn: p.type === "keypoints",
        assistedIds: new Set(),
        autoLabelResults: new Map(),
        loadState: "ready",
      });
      await this.loadCurrentImage();
    } catch {
      this.patch({ loadState: "error" });
    }
  }

  private rowAt(index: number) {
    const { list, pageOffset } = this.state;
    return list[index - pageOffset];
  }

  private async ensurePage(index: number) {
    const row = this.rowAt(index);
    if (row) return row;
    const { projectId } = this.state;
    const offset = Math.floor(index / PAGE_LIMIT) * PAGE_LIMIT;
    const page = await studioApi.fetchImages(projectId, offset, PAGE_LIMIT);
    this.patch(catalogState(page));
    return page.items[index - page.offset];
  }

  async refreshCatalog(keepIndex = this.state.index) {
    const { projectId } = this.state;
    const offset = Math.floor(Math.max(0, keepIndex) / PAGE_LIMIT) * PAGE_LIMIT;
    let page = await studioApi.fetchImages(projectId, offset, PAGE_LIMIT);
    if (!page.items.length && page.total && offset > 0) {
      const last = Math.floor((page.total - 1) / PAGE_LIMIT) * PAGE_LIMIT;
      page = await studioApi.fetchImages(projectId, last, PAGE_LIMIT);
    }
    const index = page.total ? Math.min(keepIndex, page.total - 1) : 0;
    this.patch({
      ...catalogState(page),
      index,
    });
  }

  private applyDoc(doc: Doc) {
    const selected =
      this.state.selected && doc.objects.some((o) => o.id === this.state.selected)
        ? this.state.selected
        : (doc.objects[0]?.id ?? null);
    this.patch({
      doc,
      selected,
      urlSelected: selected,
    });
  }

  private recordAutoLabel(imageId: string, status: AutoLabelStatus) {
    const results = new Map(this.state.autoLabelResults);
    results.set(imageId, status);
    this.patch({ autoLabelResults: results });
  }

  async loadCurrentImage() {
    this.imageAbort?.abort();
    const ac = new AbortController();
    this.imageAbort = ac;

    const { index } = this.state;
    let row;
    try {
      row = await this.ensurePage(index);
    } catch {
      if (!ac.signal.aborted) this.patch({ doc: null });
      return;
    }
    if (ac.signal.aborted) return;
    const { project, projectId, assistOn, assistedIds } = this.state;
    const iid = row?.id;
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
        project?.type === "keypoints" &&
        (assistOn || doc.generated) &&
        !doc.objects.length &&
        !assistedIds.has(iid);

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
      this.patch({
        doc,
        selected,
        urlSelected: selected,
        assistedIds: nextAssisted,
        assistBusy: true,
      });
      try {
        const d2 = await studioApi.postAssist(projectId, iid, false, ac.signal);
        if (ac.signal.aborted) return;
        const status = d2.objects.length ? "completed" : "no_detection";
        this.recordAutoLabel(iid, status);
        this.applyDoc(d2);
      } catch (e) {
        if ((e as Error)?.name === "AbortError") {
          const roll = new Set(this.state.assistedIds);
          roll.delete(iid);
          this.patch({ assistedIds: roll });
        } else {
          this.recordAutoLabel(iid, "failed");
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

  async openImageAt(i: number): Promise<string | null> {
    const n = this.state.total;
    const next = n ? Math.min(Math.max(0, i), n - 1) : 0;
    if (!n) return null;
    let row;
    try {
      row = await this.ensurePage(next);
    } catch {
      return null;
    }
    if (next !== this.state.index || this.state.doc?.id !== row?.id) {
      this.patch({
        index: next,
        doc: null,
        selected: null,
        urlSelected: null,
      });
      void this.loadCurrentImage();
    }
    return row?.id ?? null;
  }

  setIndex(i: number) {
    void this.openImageAt(i);
  }

  async openImageById(id: string): Promise<string | null> {
    const local = this.state.list.findIndex((row) => row.id === id);
    if (local >= 0) return await this.openImageAt(this.state.pageOffset + local);
    try {
      const located = await studioApi.locateImage(this.state.projectId, id);
      if (!Number.isInteger(located.index)) return null;
      return await this.openImageAt(located.index);
    } catch {
      return null;
    }
  }

  async nextOpen(): Promise<string | null> {
    const result = await studioApi.nextUncommittedImage(this.state.projectId, this.state.index);
    if (result.ok && Number.isInteger(result.data.index)) {
      return await this.openImageAt(result.data.index);
    }
    // Compatibility path for a briefly mixed frontend/backend deploy and local API mocks.
    const { list, pageOffset, index } = this.state;
    for (let step = 1; step < list.length; step++) {
      const local = ((index - pageOffset + step) % list.length + list.length) % list.length;
      if (!list[local].committed) return await this.openImageAt(pageOffset + local);
    }
    return null;
  }

  async waitForImage(imageId: string, ms = 2500): Promise<boolean> {
    const ready = () => this.state.doc?.id === imageId && !this.state.assistBusy;
    if (ready()) return true;
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        unsubscribe();
        resolve(ready);
      };
      const unsubscribe = this.subscribe(() => {
        if (ready()) finish(true);
      });
      timer = setTimeout(() => finish(false), ms);
      if (ready()) finish(true);
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
    const wasEmpty = this.state.list.find((x) => x.id === d.id)?.empty ?? false;
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
      emptyCount: this.state.emptyCount + (empty === wasEmpty ? 0 : empty ? 1 : -1),
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
          emptyCount: this.state.emptyCount + (empty === wasEmpty ? 0 : empty ? -1 : 1),
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

  async ensureClass(label: string): Promise<boolean> {
    const p = this.state.project;
    if (!p) return false;
    if (p.classes.includes(label)) return true;
    const optimistic = { ...p, classes: [...p.classes, label] };
    this.patch({ project: optimistic });
    const row = await studioApi.postClass(this.state.projectId, label);
    if (row) {
      this.patch({ project: row });
      return true;
    }
    if (this.state.project === optimistic) this.patch({ project: p });
    return false;
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
      this.patch({
        doc: nextDoc,
        list,
        committedCount: this.state.committedCount + (first ? 1 : 0),
      });
      if (!first) {
        this.showToast("Updated", { undo: { kind: "objects", objects: prev }, holdMs: 5000 });
        return { ok: true, advanced: false };
      }
      this.showToast("Committed", { holdMs: 1200 });
      const i = this.state.index;
      const advancedTo = Math.min(i + 1, Math.max(0, this.state.total - 1));
      if (advancedTo !== i) this.setIndex(advancedTo);
      return { ok: true, advanced: advancedTo !== i };
    } catch {
      return { ok: false, error: "cannot_commit", reason: "Commit failed" };
    }
  }

  async deleteCurrent(): Promise<DeleteImageResult> {
    const d = this.state.doc;
    if (!d || !this.state.total) return { ok: false, error: "no_image" };
    const iid = d.id;
    const at = this.state.index;
    const ok = await studioApi.deleteImage(this.state.projectId, iid);
    if (!ok) return { ok: false, error: "delete_failed" };
    this.patch({
      selected: null,
      urlSelected: null,
      edit: null,
      histOpen: false,
      commentsOpen: false,
      doc: null,
    });
    await this.refreshCatalog(at);
    if (this.state.total) void this.loadCurrentImage();
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
    await this.refreshCatalog(u.index);
    this.patch({ index: u.index });
    void this.loadCurrentImage();
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
      const status = d2.objects.length ? "completed" : "no_detection";
      this.recordAutoLabel(doc.id, status);
      this.applyDoc(d2);
    } catch {
      this.recordAutoLabel(doc.id, "failed");
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
    this.patch({ uploadOpen: false });
    await this.refreshCatalog();
    if (added[0]?.id) {
      await this.openImageById(added[0].id);
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

  toggleSynthetic() {
    this.patch({ tip: null, histOpen: false, commentsOpen: false, edit: null });
    if (this.state.synthOpen) {
      this.patch({ synthOpen: false });
      return;
    }
    this.patch({ synthOpen: true });
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

  private showAgentNotice(message: string, holdMs: number) {
    if (this.agentToastTimer) clearTimeout(this.agentToastTimer);
    this.patch({
      agentToastOut: false,
      agentToast: message,
    });
    this.agentToastTimer = setTimeout(() => this.patch({ agentToastOut: true }), holdMs);
  }

  /** Agent WebMCP tool invoke — separate from human toasts so they don't clobber each other. */
  showAgentTool(name: string, holdMs = 1600) {
    this.showAgentNotice(`Agent used \`${name}\``, holdMs);
  }

  showAgentRegistrationError(name: string, holdMs = 5000) {
    this.showAgentNotice(`Could not register \`${name}\``, holdMs);
  }

  clearAgentToast() {
    this.patch({ agentToast: null, agentToastOut: false });
  }

  clampIndexToList() {
    const { total, index } = this.state;
    if (total && index >= total) this.patch({ index: total - 1 });
  }
}

export function createStudioSession(
  projectId: string,
  boot?: Partial<StudioState>,
): StudioSession {
  return new StudioSession(projectId, boot);
}
