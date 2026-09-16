"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import {
  buscaPersonas, departamentosDe, mailtoHref, personasDe, telHref, tiendasDelDirectorio,
  type PersonaDirectorio,
} from "@/lib/phone-book";

/**
 * El directorio de la compañía (D-256).
 *
 * En cascada porque así se pidió, con su motivo dicho: **tienda → departamento → personas →
 * la persona**, «un poquito más difícil que solo buscar». Y con un buscador arriba que se la
 * salta, para quien ya sabe el nombre.
 *
 * Todo lo que se ve sale de una sola llamada a `public.phone_book()`, que devuelve ocho
 * columnas, y solo de las personas activas que tienen algún dato de contacto — sin teléfono,
 * extensión ni correo no hay tarjeta que pintar, y la función ya no las manda (110). Esta
 * pantalla no puede enseñar de más aunque se equivoque: lo que no vuelve de esa función no
 * está aquí, y tampoco hay un segundo filtro aquí que pueda decir otra cosa.
 */
export default function DirectoryPage() {
  const { t } = usePrefs();
  const [filas, setFilas] = useState<PersonaDirectorio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [tienda, setTienda] = useState<string | null | undefined>(undefined);
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
  const tiendas = useMemo(() => tiendasDelDirectorio(filas ?? []), [filas]);
  const deptos = useMemo(
    () => (tienda === undefined ? [] : departamentosDe(filas ?? [], tienda)),
    [filas, tienda],
  );
  const personas = useMemo(
    () => (tienda === undefined || depto === undefined ? [] : personasDe(filas ?? [], tienda, depto)),
    [filas, tienda, depto],
  );

  const nombreTienda = (s: string | null) => s ?? t("No store", "Sin tienda");
  const nombreDepto = (s: string | null) => s ?? t("No department", "Sin departamento");

  const volverATiendas = () => { setTienda(undefined); setDepto(undefined); setPersona(null); };
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
              <FilaPersona key={`${p.full_name}-${i}`} p={p} onPick={() => setPersona(p)} conSitio />
            ))
          )}
        </div>
      ) : tienda === undefined ? (
        <div className="card">
          <div className="section-label" style={{ marginTop: 0 }}>{t("Stores", "Tiendas")}</div>
          {tiendas.length === 0 ? (
            <div className="hint">{t("Nobody in the directory yet.", "Todavía no hay nadie en el directorio.")}</div>
          ) : (
            tiendas.map((g) => (
              <button key={g.tienda ?? "__sin__"} className="dir-row" onClick={() => setTienda(g.tienda)}>
                <span className="dir-row-name">{nombreTienda(g.tienda)}</span>
                <span className="hint">{g.personas}</span>
              </button>
            ))
          )}
        </div>
      ) : depto === undefined ? (
        <div className="card">
          <div className="dir-crumbs">
            <button className="btn btn-ghost btn-sm" onClick={volverATiendas}>← {t("Stores", "Tiendas")}</button>
            <span className="section-label" style={{ margin: 0 }}>{nombreTienda(tienda)}</span>
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
            <button className="btn btn-ghost btn-sm" onClick={volverATiendas}>← {t("Stores", "Tiendas")}</button>
            <button className="btn btn-ghost btn-sm" onClick={volverADeptos}>← {nombreTienda(tienda)}</button>
            <span className="section-label" style={{ margin: 0 }}>{nombreDepto(depto)}</span>
          </div>
          {personas.map((p, i) => (
            <FilaPersona key={`${p.full_name}-${i}`} p={p} onPick={() => setPersona(p)} />
          ))}
        </div>
      )}

      {persona && <TarjetaPersona p={persona} onClose={() => setPersona(null)} />}
    </>
  );
}

function FilaPersona({ p, onPick, conSitio }: { p: PersonaDirectorio; onPick: () => void; conSitio?: boolean }) {
  return (
    <button className="dir-row" onClick={onPick}>
      <span className="dir-row-name">{p.full_name}</span>
      <span className="hint dir-row-side">
        {[p.title, conSitio ? p.store : null, conSitio ? p.department : null].filter(Boolean).join(" · ")}
      </span>
    </button>
  );
}

/** La tarjeta de una persona: lo que se vino a buscar, con los enlaces que se pueden pulsar. */
function TarjetaPersona({ p, onClose }: { p: PersonaDirectorio; onClose: () => void }) {
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

          <span className="hint">{t("Store", "Tienda")}</span>
          <span>{p.store || sinDato}</span>

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
