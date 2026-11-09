"use client";

import { useMemo, useState } from "react";
import { ConfirmProvider } from "@/lib/confirm";
import { DataProvider as ProveedorDelHub, useData as useHub } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { MODO_DEMO } from "@/lib/recruiting/modo-demo";
import { AvisoDeDemo } from "@/components/recruiting/AvisoDeDemo";
import { ROLE_ORDER, roleLabel, type ModuleAccessKey } from "@/lib/constants";
import {
  MODULOS_DE_GERENTE, colorDeRol, etiquetaDeModulo, planDarLosOcho, tieneModulo,
} from "@/lib/hub-usuarios-permisos";
import {
  GRUPOS_DE_PERMISOS, ROL_POR_DEFECTO, columnaDeRol, etiquetaDeRol, opcionesDeRol, tieneRolPropio,
} from "@/lib/security/permisos-grupos";
import type { Profile, UserRole } from "@/lib/types";

/** Lo que el panel de Security sabe «en vivo» de cada persona, SIN migración: dentro ahora + la app cliente (D-940 Fase A).
 *  El módulo/pantalla exacto en vivo es la Fase B (necesita el latido con la ruta). */
export interface VivoDeUsuario { online: boolean; app: string; mins: number | null; mod: string | null }

const ICONO: Record<string, string> = {
  deliveries: "🚚", estimator: "🧮", leads: "🎯", customers: "🏢", promos: "🏷️",
  warehouse_ops: "🏭", recruiting: "👥", timetracker: "⏱️", surveys: "📋", erp: "🗂️",
};

/**
 * «Permisos» dentro de Security (D-940, Fase A). Administra lo que puede abrir cada persona —INCLUIDO el rol por app
 * (RR. HH., Time Tracker, Inventario, Almacén tienen escalafón propio)— y muestra, al lado, quién está en vivo.
 *
 * Es la ventana del hub (como `PermisosDelEmpleado`): el proveedor de datos DEL HUB se monta AQUÍ, y solo cuando el
 * admin la abre (D-693/695: montarlo en toda la página mató la memoria en Vercel). Las escrituras son las del
 * data-provider; esta vista solo decide QUÉ tocar.
 */
export function PanelDePermisos({ hub, vivo }: { hub: Profile | null; vivo: Record<string, VivoDeUsuario> }) {
  const { t } = usePrefs();
  const [abierto, setAbierto] = useState(false);

  if (MODO_DEMO) return <AvisoDeDemo titulo={t("Permissions", "Permisos")} />;
  if (!hub) return null;

  if (!abierto) {
    return (
      <div className="card" style={{ margin: 0 }}>
        <b>🛡 {t("Permissions manager", "Administrador de permisos")}</b>
        <p className="hint" style={{ margin: "4px 0 10px" }}>
          {t("What each person can open — including the role per app — and who is live right now.",
            "Qué puede abrir cada persona —incluido el rol por app— y quién está en vivo ahora mismo.")}
        </p>
        <button className="btn" data-accion="abrir-permisos" onClick={() => setAbierto(true)}>{t("Open", "Abrir")}</button>
      </div>
    );
  }
  return (
    <ConfirmProvider>
      <ProveedorDelHub me={hub}>
        <Cuerpo vivo={vivo} />
      </ProveedorDelHub>
    </ConfirmProvider>
  );
}

function Cuerpo({ vivo }: { vivo: Record<string, VivoDeUsuario> }) {
  const { t, lang } = usePrefs();
  const hub = useHub();
  const { ready, users, notify } = hub;
  const [vista, setVista] = useState<"persona" | "matriz">("persona");
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [rolf, setRolf] = useState<string>("");
  const [ocupado, setOcupado] = useState(false);

  const ALL_KEYS = useMemo(() => GRUPOS_DE_PERMISOS.flatMap((g) => g.keys), []);
  const lista = useMemo(() => {
    const term = q.trim().toLowerCase();
    return [...users]
      .filter((u) => {
        if (rolf === "__live") return vivo[u.id]?.online;
        if (rolf && u.role !== rolf) return false;
        return !term || (u.full_name + " " + (u.username ?? "")).toLowerCase().includes(term);
      })
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [users, q, rolf, vivo]);

  const actual = users.find((u) => u.id === sel) ?? lista[0] ?? null;

  const corre = async (f: () => Promise<unknown>) => { setOcupado(true); try { await f(); } finally { setOcupado(false); } };

  async function toggleModulo(u: Profile, key: ModuleAccessKey, on: boolean) {
    if (u.role === "admin") return; // tiene todo por su rol; no se le quita aquí
    if (key === "deliveries") { await hub.updateUserModules(u.id, on ? { grant: ["deliveries"] } : { revoke: ["deliveries"] }); return; }
    if (tieneRolPropio(key)) {
      const def = ROL_POR_DEFECTO[key] ?? opcionesDeRol(key)[0] ?? null;
      if (key === "recruiting") await hub.updateUserRecruitingAccess(u.id, { granted: on, recruiting_role: on ? (u.recruiting_role ?? def) : null });
      else if (key === "timetracker") await hub.updateUserTimetrackerAccess(u.id, { granted: on, timetracker_role: on ? (u.timetracker_role ?? def) : null });
      else if (key === "erp") await hub.updateUserErpAccess(u.id, { granted: on, erp_role: on ? (u.erp_role ?? def) : null });
      else if (key === "warehouse_ops") { await hub.updateUserWarehouseOpsAccess(u.id, { granted: on }); if (on && !u.warehouse_ops_role && def) await hub.updateUserWarehouseOpsRole(u.id, def); }
      return;
    }
    await hub.updateUserModules(u.id, on ? { grant: [key] } : { revoke: [key] });
  }

  async function cambiaRol(u: Profile, key: ModuleAccessKey, role: string) {
    if (key === "recruiting") await hub.updateUserRecruitingAccess(u.id, { granted: true, recruiting_role: role });
    else if (key === "timetracker") await hub.updateUserTimetrackerAccess(u.id, { granted: true, timetracker_role: role });
    else if (key === "erp") await hub.updateUserErpAccess(u.id, { granted: true, erp_role: role });
    else if (key === "warehouse_ops") await hub.updateUserWarehouseOpsRole(u.id, role);
  }

  const rolDeApp = (u: Profile, key: ModuleAccessKey): string | null => {
    const col = columnaDeRol(key);
    if (!col) return null;
    return (u as unknown as Record<string, string | null>)[col] ?? null;
  };

  if (!ready) return <div className="hint" style={{ padding: 12 }}>{t("Loading…", "Cargando…")}</div>;

  return (
    <div className="perm">
      <div className="perm-seg" role="tablist" aria-label={t("View", "Vista")}>
        {(["persona", "matriz"] as const).map((v) => (
          <button key={v} role="tab" aria-selected={vista === v} data-vista={v} onClick={() => setVista(v)}>
            {v === "persona" ? t("By person", "Por persona") : t("Matrix", "Matriz")}
          </button>
        ))}
      </div>

      {vista === "persona" ? (
        <div className="perm-panes">
          {/* Lista */}
          <div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search…", "Buscar…")} aria-label={t("Search", "Buscar")}
                style={{ flex: 1, minWidth: 0, font: "inherit", fontSize: 13, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-2, var(--bg))", color: "var(--ink, inherit)" }} />
              <select value={rolf} onChange={(e) => setRolf(e.target.value)} aria-label={t("Filter", "Filtrar")}
                style={{ font: "inherit", fontSize: 13, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-2, var(--bg))", color: "var(--ink, inherit)" }}>
                <option value="">{t("All", "Todos")}</option>
                <option value="__live">● {t("Live only", "Solo en vivo")}</option>
                {ROLE_ORDER.map((r) => <option key={r} value={r}>{roleLabel(r, lang)}</option>)}
              </select>
            </div>
            <ul className="perm-list">
              {lista.map((u) => {
                const v = vivo[u.id]; const on = !!v?.online;
                return (
                  <li key={u.id}>
                    <button className="perm-person" aria-current={actual?.id === u.id} onClick={() => setSel(u.id)}>
                      <span className="perm-ava" style={{ background: colorDeRol(u.role) }}>{inic(u.full_name)}{on && <span className="onair" />}</span>
                      <span className="perm-meta">
                        <span className="perm-nm">{u.full_name}</span>
                        <span className="perm-ro">{roleLabel(u.role, lang)}{u.store ? ` · ${u.store}` : ""}</span>
                        <span className={`perm-lv ${on ? "on" : "off"}`}>{on ? `● ${t("Live", "En vivo")} · ${enVivoTexto(v, lang)}` : `○ ${haceTexto(v?.mins ?? null, t)}`}</span>
                      </span>
                      <span className="perm-cnt">{cuentaModulos(u)}</span>
                    </button>
                  </li>
                );
              })}
              {lista.length === 0 && <li className="hint" style={{ padding: 10 }}>{t("Nobody here.", "Nadie aquí.")}</li>}
            </ul>
          </div>

          {/* Detalle */}
          <div className="perm-detail">
            {!actual ? <div className="hint" style={{ padding: 16 }}>{t("Pick a person.", "Elige una persona.")}</div> : (
              <Detalle u={actual} vivo={vivo[actual.id]} lang={lang} t={t} ocupado={ocupado}
                esAdmin={actual.role === "admin"} rolDeApp={rolDeApp}
                onModulo={(k, on) => void corre(() => toggleModulo(actual, k, on))}
                onRolApp={(k, r) => void corre(() => cambiaRol(actual, k, r))}
                onRolDeliveries={(r) => void corre(() => hub.updateUserRole(actual.id, r))}
                onDarLosOcho={() => void corre(async () => { const grant = MODULOS_DE_GERENTE.filter((k) => !tieneModulo(actual, k)); if (grant.length) { const { ok } = await hub.updateUserModules(actual.id, { grant }); notify(ok ? t("Done: the 8 manager modules.", "Hecho: los 8 de gerente.") : t("Could not save.", "No se pudo guardar.")); } })}
              />
            )}
          </div>
        </div>
      ) : (
        <Matriz users={lista} allKeys={ALL_KEYS} vivo={vivo} lang={lang} t={t} ocupado={ocupado}
          onCell={(u, k, on) => void corre(() => toggleModulo(u, k, on))} />
      )}
    </div>
  );
}

function Detalle({ u, vivo, lang, t, ocupado, esAdmin, rolDeApp, onModulo, onRolApp, onRolDeliveries, onDarLosOcho }: {
  u: Profile; vivo: VivoDeUsuario | undefined; lang: "en" | "es"; t: (en: string, es: string) => string; ocupado: boolean; esAdmin: boolean;
  rolDeApp: (u: Profile, key: ModuleAccessKey) => string | null;
  onModulo: (key: ModuleAccessKey, on: boolean) => void; onRolApp: (key: ModuleAccessKey, role: string) => void;
  onRolDeliveries: (role: UserRole) => void; onDarLosOcho: () => void;
}) {
  const on = !!vivo?.online;
  return (
    <>
      <div className="perm-dhead">
        <span className="perm-ava" style={{ width: 44, height: 44, fontSize: 15, background: colorDeRol(u.role) }}>{inic(u.full_name)}{on && <span className="onair" />}</span>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>{u.full_name}</h3>
          <div className="hint" style={{ margin: 0 }}>{t("signs in as", "entra con")} <b>{u.username ?? "—"}</b> · {cuentaModulos(u)} {t("apps", "apps")}</div>
        </div>
        <span className="perm-rolepill" style={{ background: colorDeRol(u.role), marginLeft: "auto" }}>{roleLabel(u.role, lang)}</span>
      </div>

      <div className={`perm-now ${on ? "on" : ""}`}>
        <span className="ni">{on ? "🟢" : "🕓"}</span>
        <div style={{ minWidth: 0 }}>
          <div className="nt">{on ? `${t("Live", "En vivo")} · ${enVivoTexto(vivo, lang)}` : t("Offline", "Fuera de línea")}</div>
          <div className="nd">{on ? (vivo?.mod ? `${vivo.app} · ${t("in the last hour", "en la última hora")}` : t("Signed in in the last hour", "Dentro en la última hora")) : `${t("Last seen", "Última vez")} ${haceTexto(vivo?.mins ?? null, t)}`}</div>
        </div>
      </div>

      <div className="perm-fields">
        <div className="perm-field">
          <label>{t("Role (Deliveries / identity)", "Rol (Entregas / identidad)")}</label>
          <select className="perm-mrole" style={{ maxWidth: "none" }} value={u.role} disabled={ocupado} onChange={(e) => onRolDeliveries(e.target.value as UserRole)}>
            {ROLE_ORDER.map((r) => <option key={r} value={r}>{roleLabel(r, lang)}</option>)}
          </select>
        </div>
        <div className="perm-field">
          <label>{t("Store", "Tienda")}</label>
          <input className="perm-mrole" style={{ maxWidth: "none" }} value={u.store ?? "—"} disabled readOnly />
        </div>
      </div>

      <div className="perm-quick">
        <button className="btn btn-sm btn-green" disabled={ocupado || esAdmin} data-accion="dar-ocho" onClick={onDarLosOcho}>★ {t("Give the 8 manager modules", "Dar los 8 de gerente")}</button>
      </div>

      <div className="perm-groups">
        {GRUPOS_DE_PERMISOS.map((g) => (
          <div className="perm-grp" key={g.titulo_en}>
            <h4>{lang === "es" ? g.titulo_es : g.titulo_en}</h4>
            <div className="perm-mods">
              {g.keys.map((key) => {
                const has = tieneModulo(u, key);
                const conRol = tieneRolPropio(key) && has;
                const rolActual = rolDeApp(u, key);
                return (
                  <div className={`perm-mod ${has ? "on" : ""}`} key={key} data-mod={key}>
                    <span className="perm-mic">{ICONO[key] ?? "▫️"}</span>
                    <span className="perm-mx">
                      <span className="perm-mt">{etiquetaDeModulo(key, lang)}</span>
                      {conRol && (
                        <select className="perm-mrole" value={rolActual ?? (ROL_POR_DEFECTO[key] ?? "")} disabled={ocupado} data-rol={key}
                          onChange={(e) => onRolApp(key, e.target.value)}>
                          {opcionesDeRol(key).map((r) => <option key={r} value={r}>{etiquetaDeRol(key, r, lang)}</option>)}
                        </select>
                      )}
                    </span>
                    <button className="perm-sw" role="switch" aria-checked={has} aria-label={etiquetaDeModulo(key, lang)}
                      disabled={ocupado || esAdmin} data-sw={key} onClick={() => onModulo(key, !has)} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {esAdmin && <p className="hint">{t("Admins have every module through their role; app roles (cost, tiers) can still be set above.", "Los administradores tienen todos los módulos por su rol; los roles por app (costo, niveles) sí se pueden ajustar arriba.")}</p>}
      </div>
    </>
  );
}

function Matriz({ users, allKeys, vivo, lang, t, ocupado, onCell }: {
  users: Profile[]; allKeys: ModuleAccessKey[]; vivo: Record<string, VivoDeUsuario>; lang: "en" | "es";
  t: (en: string, es: string) => string; ocupado: boolean; onCell: (u: Profile, key: ModuleAccessKey, on: boolean) => void;
}) {
  return (
    <div className="perm-matrix-wrap">
      <table className="perm-matrix">
        <thead>
          <tr>
            <th className="who">{t("Person", "Persona")}</th>
            <th>{t("Live", "En vivo")}</th>
            {allKeys.map((k) => <th key={k} title={etiquetaDeModulo(k, lang)}>{ICONO[k]}<div style={{ fontSize: 9, fontWeight: 600, marginTop: 2 }}>{etiquetaDeModulo(k, lang)}</div></th>)}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const v = vivo[u.id]; const on = !!v?.online;
            return (
              <tr key={u.id}>
                <td className="who">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="perm-ava" style={{ width: 28, height: 28, fontSize: 11, background: colorDeRol(u.role) }}>{inic(u.full_name)}{on && <span className="onair" />}</span>
                    <span><div style={{ fontWeight: 600 }}>{u.full_name}</div><span className="perm-rolepill" style={{ background: colorDeRol(u.role) }}>{roleLabel(u.role, lang)}</span></span>
                  </div>
                </td>
                <td style={{ textAlign: "left" }}>
                  <span className={`perm-livechip ${on ? "on" : "off"}`}>{on ? `● ${enVivoTexto(v, lang)}` : `○ ${haceTexto(v?.mins ?? null, t)}`}</span>
                </td>
                {allKeys.map((k) => {
                  const has = tieneModulo(u, k);
                  return (
                    <td key={k}>
                      <button className={`perm-cell ${has ? "on" : "off"}`} disabled={ocupado || u.role === "admin"} aria-label={`${u.full_name} — ${etiquetaDeModulo(k, lang)}`}
                        onClick={() => onCell(u, k, !has)}>{has ? "✓" : "·"}</button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- helpers de presentación ----
/** Qué enseñar en el «en vivo»: el MÓDULO exacto (Fase B, migración 278) si se conoce la ruta; si no, el cliente (Fase A). */
function enVivoTexto(v: VivoDeUsuario | undefined, lang: "en" | "es"): string {
  if (!v) return "";
  if (v.mod) return `${ICONO[v.mod] ?? "▫️"} ${etiquetaDeModulo(v.mod as ModuleAccessKey, lang)}`;
  return v.app;
}
function inic(n: string): string { return n.split(" ").slice(0, 2).map((x) => x[0] ?? "").join("").toUpperCase(); }
function cuentaModulos(u: Profile): number {
  const keys: ModuleAccessKey[] = GRUPOS_DE_PERMISOS.flatMap((g) => g.keys);
  return keys.filter((k) => tieneModulo(u, k)).length;
}
function haceTexto(mins: number | null, t: (en: string, es: string) => string): string {
  if (mins == null) return t("never signed in", "nunca entró");
  if (mins < 1) return t("seconds ago", "hace segundos");
  if (mins < 60) return t(`${mins} min ago`, `hace ${mins} min`);
  if (mins < 1440) return t(`${Math.round(mins / 60)} h ago`, `hace ${Math.round(mins / 60)} h`);
  return t(`${Math.round(mins / 1440)} d ago`, `hace ${Math.round(mins / 1440)} d`);
}
