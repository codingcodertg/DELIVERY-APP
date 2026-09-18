"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { roleLabel } from "@/lib/constants";
import { avatarColor, initials } from "@/lib/utils";
import { agruparPorTienda, totalFilas } from "@/lib/switch-user";
import type { NamedLocation, Profile, UserRole } from "@/lib/types";

/**
 * «Switch usuario»: la lista por tienda desde la barra del hub (D-247).
 *
 * Es una **puerta**, no una función nueva. Entrar como alguien ya existía desde D-243, pero solo
 * dentro de la ficha de cada usuario: para reproducir el fallo de Patricia había que acordarse
 * de su nombre, abrir Usuarios, encontrarla y abrirla. Aquí se ve la plantilla entera agrupada
 * por tienda, que es como la tiene en la cabeza quien busca — «la de McAllen», no un apellido.
 *
 * **El camino al servidor es exactamente el mismo** (`/api/impersonate` con el id). Nada nuevo
 * ahí: las cuatro condiciones, el rastro y la cookie de vuelta son los de D-243, y este panel no
 * puede saltárselas aunque quisiera. Lo que pinta o deja de pintar es comodidad; la barrera
 * sigue estando en la ruta.
 */
/**
 * Recibe lo que pinta en vez de leerlo de `useData` (D-306): así el mismo panel sirve en la
 * página del hub —que se lo pasa desde su proveedor— y donde no hay proveedor. `enPagina` lo
 * pinta estático, no como desplegable colgando de un botón.
 */
export function SwitchUserPanel({ users, tiendas, onClose, enPagina = false }: {
  users: Profile[];
  tiendas: NamedLocation[];
  onClose: () => void;
  enPagina?: boolean;
}) {
  const { lang, t } = usePrefs();
  const confirmAction = useConfirm();
  const [filtro, setFiltro] = useState("");
  const [entrando, setEntrando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const grupos = useMemo(
    () => agruparPorTienda(users, tiendas, filtro),
    [users, tiendas, filtro],
  );

  async function entrar(id: string, nombre: string) {
    if (!await confirmAction(
      t(
        `Sign in as ${nombre}? Everything you do will be recorded as done by them, and it is logged.`,
        `¿Entrar como ${nombre}? Todo lo que hagas quedará registrado como hecho por esa persona, y queda en el registro de seguridad.`,
      ),
      { confirmLabel: t("Sign in as", "Entrar como") },
    )) return;

    setEntrando(id);
    setError(null);
    try {
      const r = await fetch("/api/impersonate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId: id }),
      });
      if (!r.ok) {
        // Se enseña AQUÍ y no se cierra en silencio: el panel es donde la persona está mirando,
        // y un panel que se cierra sin decir nada se lee como «ya está», que es lo contrario.
        setEntrando(null);
        setError(t("Could not sign in as this user.", "No se pudo entrar como este usuario."));
        return;
      }
      // Recarga entera: cambia la identidad de la sesión y todo lo que hay en memoria es del
      // admin. Mismo motivo que en la ficha.
      window.location.href = "/";
    } catch {
      setEntrando(null);
      setError(t("Could not sign in as this user.", "No se pudo entrar como este usuario."));
    }
  }

  return (
    <div className={"switch-panel" + (enPagina ? " en-pagina" : "")}>
      <div className="switch-panel-head">
        <input
          className="inp"
          autoFocus
          placeholder={t("Search by name…", "Buscar por nombre…")}
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        />
        <button className="btn btn-ghost btn-sm" onClick={onClose}>{t("Close", "Cerrar")}</button>
      </div>

      {error && <div className="hint" style={{ color: "var(--red)", fontWeight: 600, marginBottom: 6 }}>{error}</div>}

      {totalFilas(grupos) === 0 ? (
        <div className="hint">{t("Nobody matches that.", "Nadie coincide con eso.")}</div>
      ) : grupos.map((g) => (
        <div key={g.tienda ?? "__sin_tienda__"} style={{ marginBottom: 10 }}>
          <div className="switch-panel-store">
            {g.tienda ?? t("No store", "Sin tienda")}
          </div>
          {g.filas.map(({ user, puedeEntrar }) => (
            <div key={user.id} className="switch-row">
              <span className="avatar sm" style={{ background: avatarColor(user.full_name || "?") }}>
                {initials(user.full_name || "?")}
              </span>
              <span className="switch-row-name">{user.full_name}</span>
              <span className="hint switch-row-role">{roleLabel(user.role as UserRole, lang)}</span>
              {puedeEntrar ? (
                <button
                  className="btn btn-amber btn-sm"
                  disabled={entrando !== null}
                  onClick={() => void entrar(user.id, user.full_name || "")}
                >
                  {entrando === user.id ? t("Signing in…", "Entrando…") : t("Sign in as", "Entrar como")}
                </button>
              ) : (
                // Un admin sale en la lista, pero sin botón. Se enseña el motivo al pasar el
                // ratón en vez de esconderlo: que falte el botón sin explicación se lee como un
                // fallo de la pantalla.
                <span
                  className="hint"
                  title={t("You cannot sign in as another admin.", "No se puede entrar como otro administrador.")}
                  style={{ opacity: 0.7 }}
                >
                  —
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
