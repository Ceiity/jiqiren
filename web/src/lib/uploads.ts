import { useSyncExternalStore } from 'react';
import { ApiError, api, getCookie } from './api';

export type UploadStatus = 'queued' | 'uploading' | 'paused' | 'completing' | 'done' | 'error' | 'canceled';

export interface UploadTask {
  id: string;
  file: File;
  name: string;
  size: number;
  folderId: string | null;
  relativePath: string;
  status: UploadStatus;
  uploaded: number;
  speed: number;
  eta: number;
  error?: string;
  sessionId?: string;
  attempts: number;
  resumed?: boolean;
  createdAt: number;
  fileId?: string;
}

interface Config {
  concurrency: number;
  chunkSize: number;
  retries: number;
}

let config: Config = { concurrency: 3, chunkSize: 8 * 1024 * 1024, retries: 3 };
let tasks: UploadTask[] = [];
let snapshot: UploadTask[] = [];
const listeners = new Set<() => void>();
const xhrs = new Map<string, XMLHttpRequest>();
const completeListeners = new Set<(t: UploadTask) => void>();
let emitQueued = false;
let seq = 0;

function emit(immediate = false) {
  const flush = () => {
    emitQueued = false;
    snapshot = tasks.map((t) => ({ ...t }));
    listeners.forEach((l) => l());
  };
  if (immediate) return flush();
  if (emitQueued) return;
  emitQueued = true;
  setTimeout(flush, 100);
}

function update(id: string, patch: Partial<UploadTask>, immediate = true) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, patch);
  emit(immediate);
}

export const uploadStore = {
  configure(c: Partial<Config>) {
    config = { ...config, ...c };
    pump();
  },
  add(files: { file: File; relativePath?: string }[], folderId: string | null) {
    const now = Date.now();
    for (const { file, relativePath } of files) {
      tasks.push({
        id: `u${++seq}`,
        file,
        name: file.name,
        size: file.size,
        folderId,
        relativePath: relativePath ?? '',
        status: 'queued',
        uploaded: 0,
        speed: 0,
        eta: Infinity,
        attempts: 0,
        createdAt: now,
      });
    }
    emit(true);
    pump();
  },
  pause(id: string) {
    const t = tasks.find((x) => x.id === id);
    if (!t || !['queued', 'uploading'].includes(t.status)) return;
    update(id, { status: 'paused', speed: 0 });
    xhrs.get(id)?.abort();
    pump();
  },
  resume(id: string) {
    const t = tasks.find((x) => x.id === id);
    if (!t || !['paused', 'error'].includes(t.status)) return;
    update(id, { status: 'queued', error: undefined, attempts: 0 });
    pump();
  },
  cancel(id: string) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const sid = t.sessionId;
    update(id, { status: 'canceled', speed: 0 });
    xhrs.get(id)?.abort();
    if (sid) api(`/api/uploads/${sid}`, { method: 'DELETE' }).catch(() => {});
    pump();
  },
  pauseAll() {
    tasks.filter((t) => ['queued', 'uploading'].includes(t.status)).forEach((t) => uploadStore.pause(t.id));
  },
  resumeAll() {
    tasks.filter((t) => ['paused', 'error'].includes(t.status)).forEach((t) => uploadStore.resume(t.id));
  },
  clearFinished() {
    tasks = tasks.filter((t) => !['done', 'canceled'].includes(t.status));
    emit(true);
  },
  remove(id: string) {
    const t = tasks.find((x) => x.id === id);
    if (t && ['uploading', 'queued'].includes(t.status)) uploadStore.cancel(id);
    tasks = tasks.filter((x) => x.id !== id);
    emit(true);
  },
  onComplete(fn: (t: UploadTask) => void) {
    completeListeners.add(fn);
    return () => {
      completeListeners.delete(fn);
    };
  },
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useUploads(): UploadTask[] {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function uploadSummary(list: UploadTask[]) {
  const active = list.filter((t) => ['queued', 'uploading', 'completing', 'paused', 'error'].includes(t.status));
  const total = active.reduce((a, t) => a + t.size, 0);
  const done = active.reduce((a, t) => a + t.uploaded, 0);
  const speed = list.reduce((a, t) => a + (t.status === 'uploading' ? t.speed : 0), 0);
  return {
    activeCount: active.length,
    runningCount: list.filter((t) => t.status === 'uploading' || t.status === 'completing').length,
    errorCount: list.filter((t) => t.status === 'error').length,
    doneCount: list.filter((t) => t.status === 'done').length,
    progress: total ? done / total : active.length ? 0 : 1,
    speed,
    eta: speed > 0 ? (total - done) / speed : Infinity,
  };
}

/* ---------------- engine ---------------- */

function pump() {
  const running = tasks.filter((t) => t.status === 'uploading' || t.status === 'completing').length;
  let slots = config.concurrency - running;
  for (const t of tasks) {
    if (slots <= 0) break;
    if (t.status === 'queued') {
      slots--;
      void run(t);
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (t: UploadTask) => t.status === 'uploading' || t.status === 'completing';

function putChunk(t: UploadTask, sessionId: string, offset: number, blob: Blob, onProgress: (loaded: number) => void): Promise<{ received: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrs.set(t.id, xhr);
    xhr.open('PUT', `/api/uploads/${sessionId}?offset=${offset}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-CSRF-Token', getCookie('nl_csrf'));
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      xhrs.delete(t.id);
      let body: { ok: boolean; data?: { received: number }; error?: { code: string; message: string; received?: number } } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.ok) resolve(body.data!);
      else reject(new ApiError(xhr.status, body?.error?.code ?? 'HTTP', body?.error?.message ?? `上传失败 (${xhr.status})`, body?.error ?? {}));
    };
    xhr.onerror = () => {
      xhrs.delete(t.id);
      reject(new ApiError(0, 'NETWORK', '网络中断'));
    };
    xhr.onabort = () => {
      xhrs.delete(t.id);
      reject(new ApiError(0, 'ABORTED', '已暂停'));
    };
    xhr.send(blob);
  });
}

async function run(t: UploadTask) {
  update(t.id, { status: 'uploading', error: undefined });
  let lastBytes = t.uploaded;
  let lastTime = performance.now();
  const trackSpeed = (uploaded: number) => {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    if (dt >= 0.4) {
      const inst = (uploaded - lastBytes) / dt;
      const speed = t.speed ? t.speed * 0.6 + inst * 0.4 : inst;
      lastBytes = uploaded;
      lastTime = now;
      update(t.id, { uploaded, speed, eta: speed > 0 ? (t.size - uploaded) / speed : Infinity }, false);
    } else {
      update(t.id, { uploaded }, false);
    }
  };

  while (alive(t)) {
    try {
      // 1. session (create, or recover offset after pause / reload / failure)
      if (t.sessionId) {
        try {
          const s = await api<{ received: number; status: string }>(`/api/uploads/${t.sessionId}`);
          if (s.status !== 'uploading' && s.status !== 'done') t.sessionId = undefined;
          else t.uploaded = s.received;
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) t.sessionId = undefined;
          else throw e;
        }
      }
      if (!t.sessionId) {
        const s = await api<{ id: string; received: number; resumed: boolean }>('/api/uploads', {
          method: 'POST',
          body: {
            name: t.name,
            size: t.size,
            folderId: t.folderId,
            relativePath: t.relativePath || undefined,
            fingerprint: `${t.name}:${t.size}:${t.file.lastModified}:${t.relativePath}`,
          },
        });
        update(t.id, { sessionId: s.id, uploaded: s.received, resumed: s.resumed && s.received > 0 });
      }
      if (!alive(t)) return;
      lastBytes = t.uploaded;
      lastTime = performance.now();
      // 2. chunks
      while (t.uploaded < t.size && alive(t)) {
        const start = t.uploaded;
        const end = Math.min(start + config.chunkSize, t.size);
        try {
          const r = await putChunk(t, t.sessionId!, start, t.file.slice(start, end), (loaded) => trackSpeed(start + loaded));
          update(t.id, { uploaded: r.received, attempts: 0 }, false);
        } catch (e) {
          if (e instanceof ApiError && e.code === 'OFFSET_MISMATCH' && typeof e.extra.received === 'number') {
            update(t.id, { uploaded: e.extra.received as number });
            continue;
          }
          throw e;
        }
      }
      if (!alive(t)) return;
      // 3. finalize
      update(t.id, { status: 'completing', speed: 0 });
      const file = await api<{ id: string }>(`/api/uploads/${t.sessionId}/complete`, { method: 'POST', body: {} });
      update(t.id, { status: 'done', uploaded: t.size, fileId: file.id, eta: 0 });
      completeListeners.forEach((fn) => fn(t));
      break;
    } catch (e) {
      if (!alive(t)) return; // paused / canceled
      const err = e as ApiError;
      const fatal = ['QUOTA_EXCEEDED', 'FILE_TOO_LARGE', 'BAD_REQUEST', 'UNAUTHORIZED', 'NOT_FOUND'].includes(err.code) || err.status === 413 || err.status === 400;
      if (!fatal && t.attempts < config.retries) {
        update(t.id, { attempts: t.attempts + 1, speed: 0, error: `${err.message}，正在重试 (${t.attempts + 1}/${config.retries})` });
        await sleep(Math.min(16_000, 1000 * 2 ** t.attempts));
        if (t.status === 'completing') update(t.id, { status: 'uploading' });
        continue;
      }
      update(t.id, { status: 'error', error: err.message, speed: 0 });
      break;
    }
  }
  pump();
}

/* ---------------- drag & drop helpers ---------------- */

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (cb: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (cb: (e: FsEntry[]) => void, err: (e: unknown) => void) => void };
}

async function walk(entry: FsEntry, prefix: string, out: { file: File; relativePath?: string }[]) {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((res, rej) => entry.file!(res, rej));
    out.push({ file, relativePath: prefix ? `${prefix}/${file.name}` : undefined });
  } else if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const dir = prefix ? `${prefix}/${entry.name}` : entry.name;
    for (;;) {
      const batch = await new Promise<FsEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walk(e, dir, out);
    }
  }
}

export async function collectDropped(dt: DataTransfer): Promise<{ file: File; relativePath?: string }[]> {
  const out: { file: File; relativePath?: string }[] = [];
  const entries = [...dt.items]
    .filter((i) => i.kind === 'file')
    .map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.())
    .filter(Boolean) as FsEntry[];
  if (!entries.length) return [...dt.files].map((file) => ({ file }));
  for (const e of entries) await walk(e, '', out);
  return out;
}

export function filesFromInput(list: FileList | null): { file: File; relativePath?: string }[] {
  if (!list) return [];
  return [...list].map((file) => ({ file, relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined }));
}
