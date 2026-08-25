"use client";
// OPTIONAL in-app error console (dev only). Auto-opens on a window error /
// unhandled rejection and shows message / source / line / stack with Copy / Clear
// / Close. HARD-GATED to non-production: `NODE_ENV` is inlined at build time, so in
// a production build this whole component compiles to `return null` and is
// tree-shaken out — it can never render for staff/anon in prod.
import { useEffect, useState, type CSSProperties } from "react";

interface Entry {
  t: string;
  message: string;
  source?: string;
  line?: number;
  col?: number;
  stack?: string;
}

export function DevErrorConsole() {
  if (process.env.NODE_ENV === "production") return null; // never in a prod build
  return <DevErrorConsoleInner />;
}

function DevErrorConsoleInner() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      setEntries((p) => [
        ...p,
        { t: new Date().toLocaleTimeString(), message: e.message, source: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack },
      ]);
      setOpen(true);
    };
    const onRej = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string; stack?: string } | undefined;
      setEntries((p) => [
        ...p,
        { t: new Date().toLocaleTimeString(), message: `Unhandled rejection: ${r?.message ?? String(e.reason)}`, stack: r?.stack },
      ]);
      setOpen(true);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  if (!open || entries.length === 0) return null;

  const copy = () =>
    navigator.clipboard?.writeText(
      entries.map((e) => `[${e.t}] ${e.message}\n${e.source ?? ""}:${e.line ?? ""}:${e.col ?? ""}\n${e.stack ?? ""}`).join("\n\n"),
    );

  return (
    <div style={panel}>
      <div style={bar}>
        <strong style={{ color: "#ff6b6b" }}>dev errors ({entries.length})</strong>
        <span style={{ flex: 1 }} />
        <button onClick={copy} style={btn}>Copy</button>
        <button onClick={() => setEntries([])} style={btn}>Clear</button>
        <button onClick={() => setOpen(false)} style={btn}>Close</button>
      </div>
      <div style={{ padding: 10 }}>
        {entries.map((e, i) => (
          <div key={i} style={{ borderTop: i ? "1px solid #444" : "none", paddingTop: i ? 8 : 0, marginTop: i ? 8 : 0 }}>
            <div style={{ color: "#ffe08a", whiteSpace: "pre-wrap" }}>{e.message}</div>
            {e.source && <div style={{ color: "#9cf" }}>{e.source}:{e.line}:{e.col}</div>}
            {e.stack && <pre style={{ margin: "4px 0 0", whiteSpace: "pre-wrap", color: "#bbb" }}>{e.stack}</pre>}
          </div>
        ))}
      </div>
    </div>
  );
}

const panel: CSSProperties = {
  position: "fixed", bottom: 12, right: 12, width: 440, maxHeight: "50vh", overflow: "auto", zIndex: 99999,
  background: "#1b1b1b", color: "#eee", border: "1px solid #f33", borderRadius: 8,
  font: "12px/1.4 ui-monospace, monospace", boxShadow: "0 6px 24px rgba(0,0,0,.45)",
};
const bar: CSSProperties = { display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", background: "#2a0000", position: "sticky", top: 0 };
const btn: CSSProperties = { background: "#333", color: "#eee", border: "1px solid #555", borderRadius: 4, padding: "2px 8px", cursor: "pointer" };
