"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { CampoDecimal } from "@/components/CampoDecimal";
import { dinero } from "@/lib/estimator/modelo";
import {
  ACCEPT_DE_CAMARA, ACCEPT_DE_COMPETENCIA, LIMITES_DE_COMPETENCIA, TOPES_DE_TEXTO, estadoDeCompetencia, mensajeDeCompetencia, metaVacia,
  puedeQuitar, tamanoLegible, validaArchivos,
  type AlmacenDeCompetencia, type ArchivoDeCompetencia, type EstadoDeCompetencia, type MetaDeCompetencia,
} from "@/lib/estimator/competencia";
import {
  competidoresUsados, empresaDe, totalDe, type AlmacenDeLecturas, type LecturaGuardada, type LineaPropia,
} from "@/lib/estimator/lectura";
import { AvisoSin161, LISTA_DE_COMPETIDORES, ListaDeCompetidores, ProductosDeCompetencia } from "./ProductosCompetencia";

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

/**
 * Los dos botones para traer el estimado de la competencia (D-466): **«Tomar foto»** (con `capture`: en el celular
 * abre la cámara) y **«Elegir PDF o foto»** (galería y archivos). Son dos porque un solo `<input capture>` obliga a
 * usar la cámara y no deja elegir un PDF.
 */
export function BotonesDeArchivo({ t, apagado, onArchivos, refEntrada, marca }: {
  t: T; apagado: boolean; onArchivos: (lista: FileList | null) => void;
  refEntrada?: Ref<HTMLInputElement>; marca: "competencia" | "suelto";
}) {
  return (
    <>
      <label className="btn btn-primary btn-sm est-comp-elegir" data-tomar-foto={marca} aria-disabled={apagado}>
        📷 {t("Take photo", "Tomar foto")}
        <input type="file" accept={ACCEPT_DE_CAMARA} capture="environment" disabled={apagado}
          onChange={(e) => { onArchivos(e.target.files); e.target.value = ""; }} />
      </label>
      <label className="btn btn-ghost btn-sm est-comp-elegir" data-elegir-archivo={marca} aria-disabled={apagado}>
        📎 {t("Choose PDF or photo…", "Elegir PDF o foto…")}
        <input ref={refEntrada} type="file" multiple accept={ACCEPT_DE_COMPETENCIA} data-entrada-archivo={marca}
          disabled={apagado} onChange={(e) => onArchivos(e.target.files)} />
      </label>
    </>
  );
}

/**
 * La lista de lo subido: nombre, tamaño, quién y cuándo, y lo opcional. Quitar, solo a quien puede. Con `lecturas`
 * (D-466) cada archivo dice la empresa, el total y cuántos productos tiene guardados, y «Productos» abre su tabla
 * (`detalle`).
 */
export function ListaDeCompetencia({ archivos, me, t, lang, confirmando, ocupado, onAbrir, onQuitar, onConfirmar, lecturas, abierto, onProductos, detalle }: {
  archivos: ArchivoDeCompetencia[]; me: Yo; t: T; lang: string; confirmando: string | null; ocupado: boolean;
  onAbrir: (a: ArchivoDeCompetencia) => void; onQuitar: (a: ArchivoDeCompetencia) => void; onConfirmar: (id: string | null) => void;
  lecturas?: Record<string, LecturaGuardada>; abierto?: string | null; onProductos?: (id: string | null) => void;
  detalle?: (a: ArchivoDeCompetencia) => ReactNode;
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
          {(empresaDe(a, lecturas?.[a.id]) || totalDe(a, lecturas?.[a.id]) !== null || a.note || lecturas?.[a.id]) && (
            <div className="est-comp-meta">
              {empresaDe(a, lecturas?.[a.id]) && <span>{t("Competitor", "Competidor")}: <b data-competencia-empresa>{empresaDe(a, lecturas?.[a.id])}</b></span>}
              {totalDe(a, lecturas?.[a.id]) !== null && <span>{t("Their total", "Su total")}: <b data-competencia-total>{dinero(totalDe(a, lecturas?.[a.id])!)}</b></span>}
              {lecturas?.[a.id] && <span data-competencia-n-productos>{lecturas[a.id].items.length} {t("product(s)", "producto(s)")}</span>}
              {a.note && <span>{t("Note", "Nota")}: {a.note}</span>}
            </div>
          )}
          <div className="est-acciones" style={{ marginTop: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAbrir(a)}>{t("Open", "Abrir")}</button>
            {onProductos && (
              <button type="button" className={"btn btn-sm " + (abierto === a.id ? "btn-primary" : "btn-ghost")} data-competencia-productos
                aria-expanded={abierto === a.id} onClick={() => onProductos(abierto === a.id ? null : a.id)}>
                🧾 {t("Products", "Productos")}{lecturas?.[a.id] ? ` (${lecturas[a.id].items.length})` : ""}
              </button>
            )}
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
          {abierto === a.id && detalle?.(a)}
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
export function SeccionCompetencia({ almacen, lecturas: almacenLecturas, propias, quoteId, me, baseCotizaciones, guardarCotizacion, t, lang }: {
  almacen: AlmacenDeCompetencia; quoteId: string | null; me: Yo; baseCotizaciones: boolean | null; t: T; lang: string;
  /** Dónde viven los productos leídos (161) y quién lee (D-466). */
  lecturas: AlmacenDeLecturas;
  /** Las líneas de ESTA cotización, para emparejar a mano cada producto de la competencia con la propia. */
  propias: LineaPropia[];
  /** Sin cotización guardada no hay dónde pegar el archivo: en vez de solo decirlo, se ofrece guardarla desde aquí. */
  guardarCotizacion?: { puede: boolean; hacer: () => void };
}) {
  /** null = aún no se sabe; false = falta la 161 (los productos, apagados; los archivos siguen). */
  const [base161, setBase161] = useState<boolean | null>(null);
  const [lecturas, setLecturas] = useState<Record<string, LecturaGuardada>>({});
  const [abierto, setAbierto] = useState<string | null>(null);
  /** Las empresas escritas en CUALQUIER estimado de la competencia (156): la lista que se ofrece al teclear. */
  const [otrasEmpresas, setOtrasEmpresas] = useState<string[]>([]);
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
    if (r.ok) {
      setArchivos(r.valor);
      const l = await almacenLecturas.cargar(r.valor.map((a) => a.id));
      if (l.ok) { setBase161(true); setLecturas(l.valor); }
      else if (l.sinTabla) setBase161(false);
      return;
    }
    if (r.sinTabla) { setBaseArchivos(false); return; }
    setError(`${t("Could not read the files", "No se pudieron leer los archivos")}: ${r.error}`);
  }, [almacen, almacenLecturas, quoteId, t]);
  // Otra cotización: lo elegido para la anterior no se cuela en esta.
  useEffect(() => { setPendientes([]); setConfirmando(null); setAbierto(null); }, [quoteId]);
  // Las empresas ya usadas en otros estimados. Sin la 156 no se pueden listar: la lista queda con las de aquí.
  useEffect(() => {
    if (estado !== "lista") return;
    let vivo = true;
    void almacen.listarTodos().then((r) => { if (vivo && r.ok) setOtrasEmpresas(r.valor.map((e) => e.competitor ?? "")); });
    return () => { vivo = false; };
  }, [almacen, estado]);
  const competidores = useMemo(
    () => competidoresUsados([...otrasEmpresas, ...archivos.map((a) => a.competitor), ...Object.values(lecturas).map((l) => l.competitor)]),
    [otrasEmpresas, archivos, lecturas],
  );
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
      {estado === "sin-cotizacion" && guardarCotizacion && (
        <div className="est-acciones">
          <button type="button" className="btn btn-primary btn-sm" data-competencia-guardar-cotizacion disabled={!guardarCotizacion.puede}
            onClick={guardarCotizacion.hacer}>
            💾 {t("Save the quote to attach a competitor's estimate", "Guardar la cotización para pegar el estimado de la competencia")}
          </button>
          {!guardarCotizacion.puede && <span className="hint">{t("Fill in the estimate # first.", "Escribe primero el # de estimado.")}</span>}
        </div>
      )}
      {error && <div className="est-aviso rojo" data-competencia-error>{error}</div>}
      <ListaDeCompetidores nombres={competidores} />

      {estado === "lista" && (
        <>
          <ListaDeCompetencia archivos={archivos} me={me} t={t} lang={lang} confirmando={confirmando} ocupado={ocupado}
            onAbrir={(a) => void abrir(a)} onQuitar={(a) => void quitar(a)} onConfirmar={setConfirmando}
            lecturas={lecturas} abierto={abierto} onProductos={setAbierto}
            detalle={(a) => (base161 === false ? <AvisoSin161 t={t} /> : (
              <ProductosDeCompetencia archivo={a} almacen={almacenLecturas} guardada={lecturas[a.id] ?? null}
                puedeEditar={puedeQuitar(a, me)} propias={propias} t={t}
                onGuardada={(l) => setLecturas((m) => ({ ...m, [l.file_id]: l }))} onSin161={() => setBase161(false)} />
            ))} />

          {pendientes.map((p) => (
            <div key={p.clave} className="est-linea" data-competencia-pendiente={p.file.name}>
              <div className="est-linea-cab">
                <span>⬆ {p.file.name} · {tamanoLegible(p.file.size)}</span>
                <button type="button" className="btn btn-danger btn-sm" disabled={ocupado}
                  onClick={() => setPendientes((ps) => ps.filter((x) => x.clave !== p.clave))}>✕</button>
              </div>
              <div className="grid g3">
                <div className="field">
                  <label>{t("Competitor company", "Empresa competidora")}</label>
                  <input value={p.meta.competitor} maxLength={TOPES_DE_TEXTO.competidor} data-competencia-competidor list={LISTA_DE_COMPETIDORES}
                    placeholder={t("Pick one or type a new one", "Elige una o escribe una nueva")}
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
            <BotonesDeArchivo t={t} marca="competencia" refEntrada={entrada} onArchivos={elegir}
              apagado={ocupado || archivos.length + pendientes.length >= max} />
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
