"use client";

// Offline buffering (D-074), ported from timetracker-clean's
// web/src/lib/offlineQueue.js: when the network drops, session updates and
// screenshots are stashed locally and flushed on reconnect, so no worked
// time or shots are lost on a flaky connection. Session patches are small
// JSON -> localStorage (keep only the latest patch per session). Screenshots
// are large binary -> IndexedDB.
//
// Unlike the original, this module doesn't import a singleton Supabase
// client directly — flush()/initOfflineQueue() take the actual
// updateSession/uploadScreenshot functions as arguments, supplied by
// timetracker-data-provider.tsx, so the schema-scoped client and the
// toSnakeRow/rowToCamel conversion stay in one place (the provider), not
// duplicated here.
//
// Limitation carried over from the original: a session must be STARTED
// while online (the initial insert needs the server to mint the row id).
// Dropping offline mid-session is fully covered — the tracker keeps
// counting locally and the buffered patches sync later.

import type { Screenshot, Session } from "@/lib/timetracker/types";

const LS_SESSIONS = "tt_offline_sessions";
const DB_NAME = "tt_offline";
const DB_VERSION = 1;
const STORE = "shots";

export type QueuedShotRec = {
  employeeUid: string;
  sessionId: string | null;
  blob: Blob;
  date: string | null;
  activityPercent: number;
};
type StoredShot = QueuedShotRec & { id: number };

export type OfflineOps = {
  /** La vía viva, con la guarda de `is_live`. `false` = ya no hay fila viva (D-241). */
  updateLiveSession: (id: string, patch: Partial<Session>) => Promise<boolean>;
  uploadScreenshot: (rec: QueuedShotRec) => Promise<Screenshot>;
};

// --- session patches (localStorage) ---------------------------------------
function loadPatches(): Record<string, Partial<Session>> {
  try { return JSON.parse(localStorage.getItem(LS_SESSIONS) || "{}"); } catch { return {}; }
}
function savePatches(o: Record<string, Partial<Session>>) {
  try { localStorage.setItem(LS_SESSIONS, JSON.stringify(o)); } catch { /* quota — ignore */ }
}
// Buffer the LATEST state for a session (merge over any prior buffered patch).
export function queueSession(id: string, patch: Partial<Session>) {
  if (!id) return;
  const o = loadPatches();
  o[id] = { ...(o[id] || {}), ...patch };
  savePatches(o);
  emit();
}

// --- screenshots (IndexedDB) -----------------------------------------------
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

export async function queueShot(rec: QueuedShotRec): Promise<boolean> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    await idbReq(tx.objectStore(STORE).add(rec));
    emit();
    return true;
  } catch { return false; }
}
async function countShots(): Promise<number> {
  try { const db = await openDB(); return await idbReq(db.transaction(STORE, "readonly").objectStore(STORE).count()); }
  catch { return 0; }
}
async function allShots(): Promise<StoredShot[]> {
  const db = await openDB();
  return idbReq(db.transaction(STORE, "readonly").objectStore(STORE).getAll() as IDBRequest<StoredShot[]>);
}
async function deleteShot(id: number) {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  await idbReq(tx.objectStore(STORE).delete(id));
}

// --- flush (send everything buffered, oldest first; stop on first failure) -
let flushing = false;
export async function flush(ops: OfflineOps) {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    // 1) session patches
    const patches = loadPatches();
    for (const id of Object.keys(patches)) {
      try {
        // El valor que devuelve dice si había fila viva, y aquí los dos casos acaban igual:
        // el parche se quita de la cola (D-241). Si entró, porque ya está guardado. Si no
        // había fila viva —la sesión se cerró mientras esto esperaba, o entró en nómina y la
        // RLS la filtra— porque no hay dónde aplicarlo, y guardarlo para el próximo intento
        // sería atascar la cola entera detrás de un parche que no va a entrar nunca. Lo que
        // NO puede pasar es lo de antes: aplicarlo sobre la fila cerrada y pisarle el cierre.
        await ops.updateLiveSession(id, patches[id]);
        delete patches[id]; savePatches(patches);
      }
      catch { break; } // still offline / server error — retry next time
    }
    // 2) screenshots
    let shots: StoredShot[] = [];
    try { shots = await allShots(); } catch { shots = []; }
    for (const s of shots) {
      try {
        await ops.uploadScreenshot({ employeeUid: s.employeeUid, sessionId: s.sessionId, blob: s.blob, date: s.date, activityPercent: s.activityPercent });
        await deleteShot(s.id);
      } catch { break; }
    }
  } finally {
    flushing = false;
    emit();
  }
}

// --- status subscription (for the UI indicator) ----------------------------
export type OfflineStatus = { online: boolean; sessions: number; shots: number; total: number };
const listeners = new Set<(s: OfflineStatus) => void>();
export function subscribeOfflineStatus(cb: (s: OfflineStatus) => void): () => void {
  listeners.add(cb);
  status().then(cb);
  return () => listeners.delete(cb);
}
async function status(): Promise<OfflineStatus> {
  const sessions = Object.keys(loadPatches()).length;
  const shots = await countShots();
  return { online: navigator.onLine, sessions, shots, total: sessions + shots };
}
function emit() { status().then((s) => listeners.forEach((cb) => { try { cb(s); } catch { /* ignore */ } })); }

// --- init: flush on reconnect + periodic retry ------------------------------
let inited = false;
export function initOfflineQueue(ops: OfflineOps) {
  if (inited) return;
  inited = true;
  window.addEventListener("online", () => { emit(); flush(ops); });
  window.addEventListener("offline", emit);
  setInterval(() => { if (navigator.onLine) flush(ops); }, 30000);
  if (navigator.onLine) flush(ops);
}
