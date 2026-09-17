"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import {
  buscaPersonas, departamentosDe, grupoDe, mailtoHref, personasDe, saltaDepartamentos, telHref,
  tiendasDelDirectorio, type GrupoTienda, type PersonaDirectorio,
} from "@/lib/phone-book";

/**
 * El directorio de la compañía (D-256).
 *
 * En cascada porque así se pidió, con su motivo dicho: **tienda → departamento → personas →
 * la persona**, «un poquito más difícil que solo buscar». Y con un buscador arriba que se la
 * salta, para quien ya sabe el nombre.
 *
 * Todo lo que se ve sale de una sola llamada a `public.phone_book()`, y solo de las personas
 * activas con extensión de RingCentral (111) y teléfono (116). Quién ve los grupos «Remote» y «Sin tienda» lo
 * decide esa función según el rol, no esta pantalla. Esta pantalla no puede enseñar de más
 * aunque se equivoque: lo que no vuelve de esa función no está aquí, y tampoco hay un segundo
 * filtro aquí que pueda decir otra cosa.
 */
export default function DirectoryPage() {
  const { t } = usePrefs();
  const [filas, setFilas] = useState<PersonaDirectorio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [grupo, setGrupo] = useState<string | undefined>(undefined);
  const [depto, setDepto] = useState<string | null | undefined>(undefined);
  const [persona, setPersona] = useState<PersonaDirectorio | null>(null);

  useEffect(() => {
    let vivo = true;
    const supabase = createClient();
    void supabase.rpc("phone_book").then(({ data, error: e }) => {
      if (!vivo) return;
      // El error se ENSEÑA. Una lista vacía y muda se lee como «no hay nadie», que es una
      // respuesta distinta de «no se pudo preguntar».
      if (e) { setError(e.message); setFilas([]); return; }
      setFilas((data ?? []) as PersonaDirectorio[]);
    });
    return () => { vivo = false; };
  }, []);

  const encontradas = useMemo(() => buscaPersonas(filas ?? [], busca), [filas, busca]);
  const grupos = useMemo(() => tiendasDelDirectorio(filas ?? []), [filas]);
  const elegido = grupos.find((g) => g.clave === grupo);
  // Sin nivel de departamento cuando su única opción sería «Sin departamento» (D-256, 111).
  const sinNivelDepto = grupo !== undefined && saltaDepartamentos(filas ?? [], grupo);
  const deptos = useMemo(
    () => (grupo === undefined ? [] : departamentosDe(filas ?? [], grupo)),
    [filas, grupo],
  );
  const personas = useMemo(
    () => (grupo === undefined || depto === undefined ? [] : personasDe(filas ?? [], grupo, depto)),
    [filas, grupo, depto],
  );

  const nombreGrupo = (g: Pick<GrupoTienda, "tipo" | "tienda"> | undefined) =>
    !g ? ""
      : g.tipo === "remote" ? "Remote"
      : g.tipo === "sin_tienda" ? t("No store", "Sin tienda")
      : (g.tienda as string);
  const nombreDepto = (s: string | null) => s ?? t("No department", "Sin departamento");

  const eligeGrupo = (clave: string) => {
    setGrupo(clave);
    // Saltar el nivel es entrar directo en su única opción, que es «sin departamento».
    setDepto(saltaDepartamentos(filas ?? [], clave) ? null : undefined);
  };
  const volverAGrupos = () => { setGrupo(undefined); setDepto(undefined); setPersona(null); };
  const volverADeptos = () => { setDepto(undefined); setPersona(null); };

  return (
    <>
      <div className="page-head">
        <h2>📇 {t("Company phone book", "Directorio de la compañía")}</h2>
        <Link href="/home" className="btn btn-ghost btn-sm">{t("Back to hub", "Volver al hub")}</Link>
      </div>

      <div className="card">
        <input
          className="inp"
          value={busca}
          onChange={(e) => { setBusca(e.target.value); setPersona(null); }}
          placeholder={t("Search a person by name…", "Buscar a una persona por nombre…")}
        />
        <div className="hint" style={{ marginTop: 6 }}>
          {t("Or browse by store and department below.", "O baja por tienda y departamento aquí abajo.")}
        </div>
      </div>

      {error && <div className="card"><div className="hint" style={{ color: "var(--red)" }}>{error}</div></div>}

      {filas === null ? (
        <div className="card"><div className="hint">{t("Loading…", "Cargando…")}</div></div>
      ) : busca.trim() ? (
        <div className="card">
          <div className="section-label" style={{ marginTop: 0 }}>
            {t("Search results", "Resultados")} · {encontradas.length}
          </div>
          {encontradas.length === 0 ? (
            <div className="hint">{t("Nobody matches that.", "Nadie coincide con eso.")}</div>
          ) : (
            encontradas.map((p, i) => (
              <FilaPersona
                key={`${p.full_name}-${i}`} p={p} sitio={nombreGrupo(grupoDe(p))} onPick={() => setPersona(p)}
              />
            ))
          )}
        </div>
      ) : grupo === undefined ? (
        <div className="card">
          <div className="section-label" style={{ marginTop: 0 }}>{t("Stores", "Tiendas")}</div>
          {grupos.length === 0 ? (
            <div className="hint">{t("Nobody in the directory yet.", "Todavía no hay nadie en el directorio.")}</div>
          ) : (
            grupos.map((g) => (
              <button key={g.clave} className="dir-row" onClick={() => eligeGrupo(g.clave)}>
                <span className="dir-row-name">{nombreGrupo(g)}</span>
                <span className="hint">{g.personas}</span>
              </button>
            ))
          )}
        </div>
      ) : depto === undefined ? (
        <div className="card">
          <div className="dir-crumbs">
            <button className="btn btn-ghost btn-sm" onClick={volverAGrupos}>← {t("Stores", "Tiendas")}</button>
            <span className="section-label" style={{ margin: 0 }}>{nombreGrupo(elegido)}</span>
          </div>
          {deptos.map((g) => (
            <button key={g.departamento ?? "__sin__"} className="dir-row" onClick={() => setDepto(g.departamento)}>
              <span className="dir-row-name">{nombreDepto(g.departamento)}</span>
              <span className="hint">{g.personas}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="card">
          <div className="dir-crumbs">
            <button className="btn btn-ghost btn-sm" onClick={volverAGrupos}>← {t("Stores", "Tiendas")}</button>
            {sinNivelDepto ? (
              // Sin nivel de departamento no hay a dónde volver en medio: el grupo es el título.
              <span className="section-label" style={{ margin: 0 }}>{nombreGrupo(elegido)}</span>
            ) : (
              <>
                <button className="btn btn-ghost btn-sm" onClick={volverADeptos}>← {nombreGrupo(elegido)}</button>
                <span className="section-label" style={{ margin: 0 }}>{nombreDepto(depto)}</span>
              </>
            )}
          </div>
          {personas.map((p, i) => (
            <FilaPersona key={`${p.full_name}-${i}`} p={p} onPick={() => setPersona(p)} />
          ))}
        </div>
      )}

      {persona && (
        <TarjetaPersona p={persona} sitio={nombreGrupo(grupoDe(persona))} onClose={() => setPersona(null)} />
      )}
    </>
  );
}

/** `sitio` solo en los resultados de búsqueda, donde la persona llega sin la cascada encima. */
function FilaPersona({ p, onPick, sitio }: { p: PersonaDirectorio; onPick: () => void; sitio?: string }) {
  return (
    <button className="dir-row" onClick={onPick}>
      <span className="dir-row-name">{p.full_name}</span>
      <span className="hint dir-row-side">
        {[p.title, sitio, sitio !== undefined ? p.department : null].filter(Boolean).join(" · ")}
      </span>
    </button>
  );
}

/** La tarjeta de una persona: lo que se vino a buscar, con los enlaces que se pueden pulsar. */
function TarjetaPersona({ p, sitio, onClose }: { p: PersonaDirectorio; sitio: string; onClose: () => void }) {
  const { t } = usePrefs();
  const tel = telHref(p.phone);
  const correo = mailtoHref(p.email);
  const sinDato = <span className="hint">—</span>;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <h3 style={{ margin: 0, flex: 1 }}>{p.full_name}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        {p.title && <div className="hint" style={{ marginTop: 2 }}>{p.title}</div>}

        <div className="dir-card-grid">
          <span className="hint">{t("Phone", "Teléfono")}</span>
          <span>{tel ? <a href={tel}>{p.phone}</a> : sinDato}</span>

          <span className="hint">{t("Extension", "Extensión")}</span>
          <span>{p.ringcentral_ext || sinDato}</span>

          <span className="hint">{t("Email", "Correo")}</span>
          <span>{correo ? <a href={correo}>{p.email}</a> : sinDato}</span>

          {/* El sitio de la cascada, no `p.store`: una fila de grupo llega sin tienda, y la
              tarjeta tiene que decir lo mismo que la lista de donde se abrió. */}
          <span className="hint">{t("Store", "Tienda")}</span>
          <span>{sitio || sinDato}</span>

          <span className="hint">{t("Department", "Departamento")}</span>
          <span>{p.department || sinDato}</span>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>{t("Close", "Cerrar")}</button>
        </div>
      </div>
    </div>
  );
}
