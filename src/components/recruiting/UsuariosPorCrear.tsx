"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { useData } from "@/lib/recruiting-data-provider";
import { veSolicitudesDeUsuario } from "@/lib/recruiting/contratar";
import { listUserCreationRequests, markUserCreationDone, type UserCreationRequest } from "@/app/recruiting/actions/contratar";

/**
 * «Usuarios por crear» (D-NEXT, 201): las solicitudes que manda «Hire». Solo el admin de RR. HH. la ve. Es un
 * bloque suelto a propósito, para colgarlo donde haga falta (hoy, arriba de Employees). Sin la 201 no pinta nada.
 */
export function UsuariosPorCrear() {
  const { me } = useData();
  const { t, lang } = usePrefs();
  const [rows, setRows] = useState<UserCreationRequest[]>([]);
  const [abierto, setAbierto] = useState(false);
  const admin = veSolicitudesDeUsuario(me?.role);

  const cargar = useCallback(async () => {
    const r = await listUserCreationRequests();
    if (r.ok) setRows(r.rows);
  }, []);
  useEffect(() => { if (admin) void cargar(); }, [admin, cargar]);

  if (!admin || rows.length === 0) return null;
  const fecha = (iso: string) => new Date(iso).toLocaleString(lang === "es" ? "es-MX" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="card" style={{ marginBottom: 12, padding: 10 }}>
      <button className="btn btn-ghost btn-sm" onClick={() => setAbierto(!abierto)}>
        👤 {t("Users to create", "Usuarios por crear")} <span className="badge" style={{ marginLeft: 6 }}>{rows.length}</span>
      </button>
      {abierto && (
        <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 6 }}>
          {rows.map((r) => (
            <li key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <strong>{r.full_name}</strong>
              <span className="hint" style={{ margin: 0 }}>
                {t("requested by", "pedido por")} {r.requested_by_name ?? "—"} · {fecha(r.requested_at)}
                {r.note ? ` · ${r.note}` : ""}
              </span>
              <button className="btn btn-green btn-sm" onClick={async () => {
                const x = await markUserCreationDone(r.id);
                if (x.ok) setRows((rs) => rs.filter((y) => y.id !== r.id));
              }}>✓ {t("Done", "Hecho")}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
