"use client";

import { TablaEstandar } from "@/components/TablaEstandar";
import { useMemo, useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import { dateISO, fmtDT, fmtDayLong } from "@/lib/timetracker/helpers";

// Ported (D-071) from timetracker-clean's manager/AuditLog.jsx — grouped by
// day, with person + action filters. `auditLog` is kept live by the
// provider (latest 300, bounded — see its block comment).
//
// Desde 2026-11-24 (ayuda de Roberto: las vistas de fotos, excepciones y capturas «could probably be
// consolidated into payroll app») esta pantalla es SOLO el registro de auditoría: qué pasó, quién y
// cuándo, con su filtro por persona y por acción. Las otras tres vistas que tuvo (fotos de fichaje
// D-109, historial de excepciones y capturas de escritorio D-194) viven ahora en Nómina
// (`PayrollTabs`), como secciones plegadas, cada una con su propio selector de persona (D-186).
// Los enlaces viejos a esas vistas redirigen allí (next.config.mjs). La puerta de servidor de
// `audit/page.tsx` no cambia.
export function AuditTabs() {
  const { me, auditLog: items, allEmployees: users } = useData();
  const t = useT();
  const [who, setWho] = useState("");
  const [action, setAction] = useState("");

  const uMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const actionTypes = useMemo(() => Array.from(new Set(items.map((i) => i.action).filter((a): a is string => !!a))).sort(), [items]);

  const filtered = items.filter((i) => (!who || i.who === who) && (!action || i.action === action));

  const byDay = new Map<string, typeof items>();
  filtered.forEach((i) => {
    const d = i.at ? dateISO(new Date(i.at)) : "unknown";
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(i);
  });
  const days = Array.from(byDay.keys()).sort().reverse();

  if (me.role !== "admin") return <div className="card"><p className="muted">{t("common.adminsOnly")}</p></div>;

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>{t("mgr.audit.title")}</h2>
        <div className="row">
          <select value={who} onChange={(e) => setWho(e.target.value)} style={{ width: "auto" }}>
            <option value="">{t("mgr.audit.allPeople")}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
          <select value={action} onChange={(e) => setAction(e.target.value)} style={{ width: "auto" }}>
            <option value="">{t("mgr.audit.allActions")}</option>
            {actionTypes.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>{t("mgr.audit.empty")}</p>
      ) : days.map((d) => (
        <details key={d} style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
            {d === "unknown" ? t("mgr.audit.unknownDate") : fmtDayLong(d)} <span className="chip" style={{ marginLeft: 6 }}>{byDay.get(d)!.length}</span>
          </summary>
          <div style={{ marginTop: 6 }}>
            <TablaEstandar id="tt-auditoria" filas={byDay.get(d)!} claveDe={(it) => String(it.id)}
              columnas={[
                { key: "hora", en: t("mgr.audit.time"), es: t("mgr.audit.time"), ancho: 110, clase: "small nowrap", valor: (it) => it.at ?? null,
                  celda: (it) => (it.at ? fmtDT(new Date(it.at).getTime(), { hour: "2-digit", minute: "2-digit" }) : "…") },
                { key: "quien", en: t("mgr.audit.who"), es: t("mgr.audit.who"), ancho: 200, clase: "small", valor: (it) => (it.who && uMap.get(it.who)?.fullName) || null },
                { key: "accion", en: t("mgr.audit.action"), es: t("mgr.audit.action"), ancho: 180, clase: "small", valor: (it) => it.action,
                  celda: (it) => <span className="chip">{it.action}</span> },
                { key: "detalle", en: t("mgr.audit.detail"), es: t("mgr.audit.detail"), ancho: 380, clase: "small muted", envuelve: true, valor: (it) => it.detail ?? null,
                  celda: (it) => it.detail },
              ]} />
          </div>
        </details>
      ))}
    </div>
  );
}
