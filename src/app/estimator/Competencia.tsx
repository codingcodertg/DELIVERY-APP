"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CampoDecimal } from "@/components/CampoDecimal";
import { dinero } from "@/lib/estimator/modelo";
import {
  ACCEPT_DE_COMPETENCIA, LIMITES_DE_COMPETENCIA, TOPES_DE_TEXTO, estadoDeCompetencia, mensajeDeCompetencia, metaVacia,
  puedeQuitar, tamanoLegible, validaArchivos,
  type AlmacenDeCompetencia, type ArchivoDeCompetencia, type EstadoDeCompetencia, type MetaDeCompetencia,
} from "@/lib/estimator/competencia";

type T = (en: string, es: string) => string;
type Yo = { id: string; name: string; admin: boolean };

/** Lo que dice la sección cuando no se puede subir. Aparte para poder pintarlo en una prueba sin navegador. */
export function AvisoDeCompetencia({ estado, t }: { estado: EstadoDeCompetencia; t: T }) {
  if (estado === "sin-base") {
    return (
      <p className="hint" data-competencia-sin-base>
        {t(
          "Not available yet: the database has not been updated (migration 153). The rest of the Quote Builder works as usual.",
          "Todavía no disponible: falta actualizar la base (migración 153). El resto del Cotizador funciona igual.",
        )}
      </p>
    );
  }
  if (estado === "sin-cotizacion") {
    return (
      <p className="hint" data-competencia-sin-cotizacion>
        {t(
          "Save this estimate's quote first: the competitor's estimate is attached to it.",
          "Guarda primero la cotización de este estimado: el estimado de la competencia va pegado a ella.",
        )}
      </p>
    );
  }
  return null;
}

/** La lista de lo subido: nombre, tamaño, quién y cuándo, y lo opcional. Quitar, solo a quien puede. */
export function ListaDeCompetencia({ archivos, me, t, lang, confirmando, ocupado, onAbrir, onQuitar, onConfirmar }: {
  archivos: ArchivoDeCompetencia[]; me: Yo; t: T; lang: string; confirmando: string | null; ocupado: boolean;
  onAbrir: (a: ArchivoDeCompetencia) => void; onQuitar: (a: ArchivoDeCompetencia) => void; onConfirmar: (id: string | null) => void;
}) {
  if (!archivos.length) {
    return <p className="hint" data-competencia-vacia>{t("No competitor's estimate attached.", "No hay estimado de la competencia.")}</p>;
  }
  const fecha = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(lang === "es" ? "es-MX" : "en-US", { dateStyle: "medium", timeStyle: "short" });
  };
  return (
    <ul className="est-comp-lista" data-competencia-lista>
      {archivos.map((a) => (
        <li key={a.id} className="est-comp-item" data-competencia-archivo={a.file_name}>
          <div className="est-comp-cab">
            <button type="button" className="est-comp-nombre" data-competencia-abrir onClick={() => onAbrir(a)} title={t("Open", "Abrir")}>
              {a.mime_type === "application/pdf" ? "📄" : "🖼️"} {a.file_name}
            </button>
            <span className="hint" data-competencia-tamano>{tamanoLegible(a.size_bytes)}</span>
          </div>
          <div className="hint" data-competencia-quien>
            {a.uploaded_by_name ?? "?"} · {fecha(a.uploaded_at)}
          </div>
          {(a.competitor || a.competitor_total !== null || a.note) && (
            <div className="est-comp-meta">
              {a.competitor && <span>{t("Competitor", "Competidor")}: <b>{a.competitor}</b></span>}
              {a.competitor_total !== null && <span>{t("Their total", "Su total")}: <b data-competencia-total>{dinero(a.competitor_total)}</b></span>}
              {a.note && <span>{t("Note", "Nota")}: {a.note}</span>}
            </div>
          )}
          <div className="est-acciones" style={{ marginTop: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAbrir(a)}>{t("Open", "Abrir")}</button>
            {puedeQuitar(a, me) && (confirmando === a.id ? (
              <>
                <button type="button" className="btn btn-danger btn-sm" data-competencia-confirmar disabled={ocupado} onClick={() => onQuitar(a)}>
                  {t("Yes, remove", "Sí, quitar")}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onConfirmar(null)}>{t("Cancel", "Cancelar")}</button>
              </>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" data-competencia-quitar disabled={ocupado} onClick={() => onConfirmar(a.id)}>
                ✕ {t("Remove", "Quitar")}
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

type Pendiente = { clave: string; file: File; meta: MetaDeCompetencia };

/**
 * «Competitor's estimate / Estimado de la competencia» (D-425). **Interno**: vive fuera de la hoja
 * del cliente (`HojaCliente` solo recibe `HojaDelCliente`) y al imprimir queda escondido con todo lo
 * demás. Va pegado a la cotización guardada: sin `quoteId` no hay carpeta, y lo dice.
 */
export function SeccionCompetencia({ almacen, quoteId, me, baseCotizaciones, t, lang }: {
  almacen: AlmacenDeCompetencia; quoteId: string | null; me: Yo; baseCotizaciones: boolean | null; t: T; lang: string;
}) {
  const [baseArchivos, setBaseArchivos] = useState<boolean | null>(null);
  const [archivos, setArchivos] = useState<ArchivoDeCompetencia[]>([]);
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    void almacen.disponible().then((r) => {
      if (!vivo) return;
      if (r.ok) setBaseArchivos(true);
      else if (r.sinTabla) setBaseArchivos(false);
      else setError(r.error);
    });
    return () => { vivo = false; };
  }, [almacen]);

  const estado = estadoDeCompetencia({ baseCotizaciones, baseArchivos, quoteId });

  const cargar = useCallback(async () => {
    if (!quoteId) { setArchivos([]); return; }
    const r = await almacen.listar(quoteId);
    if (r.ok) { setArchivos(r.valor); return; }
    if (r.sinTabla) { setBaseArchivos(false); return; }
    setError(`${t("Could not read the files", "No se pudieron leer los archivos")}: ${r.error}`);
  }, [almacen, quoteId, t]);
  // Otra cotización: lo elegido para la anterior no se cuela en esta.
  useEffect(() => { setPendientes([]); setConfirmando(null); }, [quoteId]);
  useEffect(() => {
    if (estado === "lista") void cargar(); else setArchivos([]);
  }, [estado, cargar]);

  const elegir = (lista: FileList | null) => {
    const nuevos = Array.from(lista ?? []);
    if (entrada.current) entrada.current.value = "";
    if (!nuevos.length) return;
    const juntos = [...pendientes.map((p) => p.file), ...nuevos];
    const fallo = validaArchivos(juntos, archivos.length);
    if (fallo) { setError(mensajeDeCompetencia(fallo, t)); return; }
    setError(null);
    setPendientes((p) => [...p, ...nuevos.map((file, i) => ({ clave: `${Date.now()}-${i}-${file.name}`, file, meta: metaVacia() }))]);
  };

  const setMeta = (clave: string, patch: Partial<MetaDeCompetencia>) =>
    setPendientes((ps) => ps.map((p) => (p.clave === clave ? { ...p, meta: { ...p.meta, ...patch } } : p)));

  const subir = async () => {
    if (!quoteId || !pendientes.length || estado !== "lista") return;
    const fallo = validaArchivos(pendientes.map((p) => p.file), archivos.length);
    if (fallo) { setError(mensajeDeCompetencia(fallo, t)); return; }
    setOcupado(true);
    setError(null);
    const quedan: Pendiente[] = [];
    for (const p of pendientes) {
      const r = await almacen.subir(quoteId, p.file, p.meta);
      if (r.ok) continue;
      if (r.sinTabla) { setBaseArchivos(false); setOcupado(false); return; }
      quedan.push(p);
      setError(`${t("Not uploaded", "No se subió")} «${p.file.name}»: ${r.error}`);
    }
    setPendientes(quedan);
    await cargar();
    setOcupado(false);
  };

  const abrir = async (a: ArchivoDeCompetencia) => {
    const r = await almacen.abrir(a);
    if (!r.ok) { setError(`${t("Could not open the file", "No se pudo abrir el archivo")}: ${r.error}`); return; }
    window.open(r.valor, "_blank", "noopener,noreferrer");
  };

  const quitar = async (a: ArchivoDeCompetencia) => {
    if (!puedeQuitar(a, me)) return;
    setOcupado(true);
    const r = await almacen.quitar(a);
    setOcupado(false);
    setConfirmando(null);
    if (!r.ok) { setError(`${t("Not removed", "No se quitó")}: ${r.error}`); return; }
    await cargar();
  };

  const max = LIMITES_DE_COMPETENCIA.maxPorCotizacion;
  const mb = Math.round(LIMITES_DE_COMPETENCIA.maxBytes / (1024 * 1024));

  return (
    <div className={`card est-competencia${estado === "sin-base" ? " apagada" : ""}`} data-competencia={estado}>
      <h2>🕵️ {t("Competitor's estimate", "Estimado de la competencia")}</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        <b>{t("Internal — never printed on the customer copy.", "Interno — nunca sale en la copia del cliente.")}</b>{" "}
        {t(`PDF or photo, up to ${mb} MB each, ${max} per quote.`, `PDF o foto, hasta ${mb} MB cada uno, ${max} por cotización.`)}
      </p>
      <AvisoDeCompetencia estado={estado} t={t} />
      {error && <div className="est-aviso rojo" data-competencia-error>{error}</div>}

      {estado === "lista" && (
        <>
          <ListaDeCompetencia archivos={archivos} me={me} t={t} lang={lang} confirmando={confirmando} ocupado={ocupado}
            onAbrir={(a) => void abrir(a)} onQuitar={(a) => void quitar(a)} onConfirmar={setConfirmando} />

          {pendientes.map((p) => (
            <div key={p.clave} className="est-linea" data-competencia-pendiente={p.file.name}>
              <div className="est-linea-cab">
                <span>⬆ {p.file.name} · {tamanoLegible(p.file.size)}</span>
                <button type="button" className="btn btn-danger btn-sm" disabled={ocupado}
                  onClick={() => setPendientes((ps) => ps.filter((x) => x.clave !== p.clave))}>✕</button>
              </div>
              <div className="grid g3">
                <div className="field">
                  <label>{t("Competitor (optional)", "Competidor (opcional)")}</label>
                  <input value={p.meta.competitor} maxLength={TOPES_DE_TEXTO.competidor} data-competencia-competidor
                    onChange={(e) => setMeta(p.clave, { competitor: e.target.value })} />
                </div>
                <div className="field">
                  <label>{t("Their total $ (optional)", "Su total $ (opcional)")}</label>
                  <CampoDecimal value={p.meta.competitor_total} data-competencia-su-total
                    onValor={(n) => setMeta(p.clave, { competitor_total: n })} />
                </div>
                <div className="field">
                  <label>{t("Note (optional)", "Nota (opcional)")}</label>
                  <input value={p.meta.note} maxLength={TOPES_DE_TEXTO.nota} data-competencia-nota
                    onChange={(e) => setMeta(p.clave, { note: e.target.value })} />
                </div>
              </div>
            </div>
          ))}

          <div className="est-acciones">
            <label className="btn btn-ghost btn-sm est-comp-elegir" data-competencia-elegir
              aria-disabled={ocupado || archivos.length + pendientes.length >= max}>
              📎 {t("Choose files…", "Elegir archivos…")}
              <input ref={entrada} type="file" multiple accept={ACCEPT_DE_COMPETENCIA} data-competencia-input
                disabled={ocupado || archivos.length + pendientes.length >= max}
                onChange={(e) => elegir(e.target.files)} />
            </label>
            {pendientes.length > 0 && (
              <button type="button" className="btn btn-primary btn-sm" data-competencia-subir disabled={ocupado} onClick={() => void subir()}>
                ⬆ {t(`Upload ${pendientes.length}`, `Subir ${pendientes.length}`)}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
