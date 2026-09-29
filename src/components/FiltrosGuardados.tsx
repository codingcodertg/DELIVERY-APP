"use client";

import { useState } from "react";
import { MAX_FILTROS_GUARDADOS, MAX_NOMBRE_DE_FILTRO, filtroLlamado } from "@/lib/filtros-guardados";
import type { FiltroGuardado } from "@/lib/user-prefs";

/** Lo que contesta la página a cada acción: el texto a enseñar, y si es un problema. */
export type RespuestaDeFiltro = { texto: string; mal: boolean };

/**
 * El panel de «★ Filtros guardados» de Órdenes (D-NEXT). El dueño: «create cuztomizable filters that the user sorts different
 * columns and that stays as a filter».
 *
 * - **Guardar**: guarda lo que se ve ahora —los filtros de columna y el orden, y con la casilla, la pastilla de etapa y el chip
 *   de fechas— con el nombre escrito. Si el nombre ya existe, el botón dice «Reemplazar».
 * - Cada guardado tiene **Actualizar** (le pone lo que se ve ahora), **Renombrar** (en la misma línea) y **✕**, que no borra:
 *   pregunta en la misma línea y hay que decir «Sí, borrar».
 * - Aplicarlo es pulsar su pastilla en la fila de pastillas, no aquí: es donde está lo demás que cambia lo que se ve.
 *
 * Es un panel en la página y no un menú flotante: a 390 de ancho un menú colgado de la fila de pastillas —que se desplaza a lo
 * ancho y recorta lo que sobresale— no se vería entero.
 */
export function FiltrosGuardados({ lista, onGuardar, onActualizar, onRenombrar, onBorrar, onCerrar, t }: {
  lista: readonly FiltroGuardado[];
  onGuardar: (nombre: string, conPastilla: boolean) => Promise<RespuestaDeFiltro>;
  onActualizar: (nombre: string) => Promise<RespuestaDeFiltro>;
  onRenombrar: (viejo: string, nuevo: string) => Promise<RespuestaDeFiltro>;
  onBorrar: (nombre: string) => Promise<RespuestaDeFiltro>;
  onCerrar: () => void;
  t: (en: string, es: string) => string;
}) {
  const [nombre, setNombre] = useState("");
  const [conPastilla, setConPastilla] = useState(true);
  const [renombrando, setRenombrando] = useState<{ viejo: string; nuevo: string } | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<RespuestaDeFiltro | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const reemplaza = !!filtroLlamado(lista, nombre);
  const lleno = lista.length >= MAX_FILTROS_GUARDADOS && !reemplaza;

  const haz = async (accion: () => Promise<RespuestaDeFiltro>, alSalirBien?: () => void) => {
    if (ocupado) return;
    setOcupado(true);
    const r = await accion();
    setOcupado(false);
    setAviso(r);
    if (!r.mal) alSalirBien?.();
  };

  return (
    <div className="card filtros-guardados" data-filtros-guardados>
      <div className="filtros-guardados-cabeza">
        <b>★ {t("Saved filters", "Filtros guardados")}</b> <span className="plantillas-cols-cuenta">{lista.length}/{MAX_FILTROS_GUARDADOS}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="notif-clear" onClick={onCerrar} aria-label={t("Close", "Cerrar")}>✕</button>
      </div>
      <p className="hint" style={{ margin: "2px 0 6px" }}>
        {t("Saves the column filters and the sort you have now. It shows up as a ★ chip next to the others; tap it to put it back.",
          "Guarda los filtros de columna y el orden que tiene ahora. Sale como una pastilla ★ junto a las demás; púlsela para volver a ponerlo.")}
      </p>
      <form className="filtros-guardados-fila" onSubmit={(e) => { e.preventDefault(); const n = nombre.trim(); void haz(() => onGuardar(n, conPastilla), () => setNombre("")); }}>
        <input
          className="col-menu-search" value={nombre} maxLength={MAX_NOMBRE_DE_FILTRO} disabled={ocupado}
          onChange={(e) => { setNombre(e.target.value); setAviso(null); }}
          placeholder={t("Name, e.g. My Brownsville", "Nombre, p. ej. Mis Brownsville")}
          aria-label={t("Saved filter name", "Nombre del filtro guardado")}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={ocupado || !nombre.trim() || lleno}>
          {reemplaza ? t("Replace", "Reemplazar") : t("Save", "Guardar")}
        </button>
      </form>
      <label className="col-opt filtros-guardados-casilla">
        <input type="checkbox" checked={conPastilla} onChange={(e) => setConPastilla(e.target.checked)} />
        {t("Also the stage chip and the date chip selected now", "También la pastilla de etapa y el chip de fechas de ahora")}
      </label>
      {lleno && <div className="hint">{t(`Up to ${MAX_FILTROS_GUARDADOS} saved filters: delete one to save another.`, `Hasta ${MAX_FILTROS_GUARDADOS} filtros guardados: borre uno para guardar otro.`)}</div>}
      {lista.length > 0 && (
        <ul className="filtros-guardados-lista">
          {lista.map((g) => (
            <li key={g.n} data-filtro={g.n}>
              {renombrando?.viejo === g.n ? (
                <form className="filtros-guardados-fila" onSubmit={(e) => { e.preventDefault(); const r = renombrando; void haz(() => onRenombrar(r.viejo, r.nuevo.trim()), () => setRenombrando(null)); }}>
                  <input className="col-menu-search" value={renombrando.nuevo} maxLength={MAX_NOMBRE_DE_FILTRO} autoFocus disabled={ocupado}
                    aria-label={t(`New name for ${g.n}`, `Nombre nuevo para ${g.n}`)}
                    onChange={(e) => setRenombrando({ viejo: g.n, nuevo: e.target.value })} />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={ocupado || !renombrando.nuevo.trim()}>{t("OK", "Aceptar")}</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenombrando(null)}>{t("Cancel", "Cancelar")}</button>
                </form>
              ) : borrando === g.n ? (
                <span className="filtros-guardados-fila" role="group" aria-label={t(`Delete ${g.n}?`, `¿Borrar ${g.n}?`)}>
                  {t(`Delete “${g.n}”?`, `¿Borrar «${g.n}»?`)}
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => { setBorrando(null); void haz(() => onBorrar(g.n)); }}>{t("Yes, delete", "Sí, borrar")}</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBorrando(null)}>{t("No", "No")}</button>
                </span>
              ) : (
                <span className="filtros-guardados-fila">
                  <span className="filtros-guardados-nombre">★ {g.n}</span>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado} onClick={() => void haz(() => onActualizar(g.n))}
                    title={t("Replace it with the filters and sort you have now", "Ponerle los filtros y el orden que tiene ahora")}>{t("Update", "Actualizar")}</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado} onClick={() => { setAviso(null); setRenombrando({ viejo: g.n, nuevo: g.n }); }}>{t("Rename", "Renombrar")}</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado} aria-label={t(`Delete saved filter ${g.n}`, `Borrar filtro guardado ${g.n}`)} onClick={() => setBorrando(g.n)}>✕</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {aviso && <div className={"hint plantillas-cols-aviso" + (aviso.mal ? " plantillas-cols-mal" : "")} role="status">{aviso.texto}</div>}
    </div>
  );
}
