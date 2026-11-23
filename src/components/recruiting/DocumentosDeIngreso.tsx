"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mensajeDeError } from "@/lib/mensaje-de-error";
import { usePrefs } from "@/lib/prefs";
import { MODO_DEMO, AVISO_DEMO } from "@/lib/recruiting/modo-demo";
import { hoyEnBrownsville } from "@/lib/recruiting/hora-de-brownsville";
import { useData } from "@/lib/recruiting-data-provider";
import { fmtDateTime } from "@/lib/utils";
import { createClient as creaClienteNavegador } from "@/lib/supabase/client";
import { ENCABEZADO } from "@/lib/estimator/hoja";
import {
  attachSignedCopy, listOnboardingDocs, prepareDocUpload, saveReviewedFields, setOnboardingStatus, setOnboardingVariant,
  signDocFileUrl, type DocumentoFila, type RegistroDeIngreso, type VarianteFila,
} from "@/app/recruiting/actions/plantillas";
import {
  documentosParaEmpleado, varianteMarcada, ESTADOS_DOCUMENTO, EXTENSIONES_FIRMADO, MAX_BYTES_FIRMADO,
  puedeCambiarEstado, extensionPermitida, extensionDe, idiomaDeVariante, parejaDeIdioma, type EstadoDocumento,
} from "@/lib/recruiting/plantillas-de-documentos";
import {
  camposDeDocx, claveDeEntrada, clavesObligatorias, etiquetasDeCampos, faltanCampos, pasaValores, valoresSugeridos,
  type CampoDetectado,
} from "@/lib/recruiting/campos-de-documento";
import { InterruptorDeIdioma } from "@/components/recruiting/InterruptorDeIdioma";
import { mapaDeMarcadores, fechaLarga } from "@/lib/recruiting/plantillas-de-documentos";
import {
  htmlDeDocx, limpiaHtmlPintado, preparaDocumento, imprimeArchivo, descargaArchivo,
} from "@/lib/recruiting/imprimir-documento";
import {
  ayudaDeCampo, isoDeMDY, mdyDeIso, pagoConSigno, pagoSinSigno, progresoDeCampos, sustituyeMarcadores,
} from "@/lib/recruiting/vista-de-documento";

/**
 * Documentos de ingreso dentro de la ficha del empleado (migración 315).
 *
 * Solo aparecen los documentos que le tocan por su puesto (o los que son «para todos»). Cada uno es una tarjeta con su
 * variante, su estado y su copia firmada. Imprimir y bajar pasan SIEMPRE por la revisión: RR. HH. ve los datos del
 * documento, los confirma y recién entonces sale. «Imprimir todos los pendientes» hace una revisión por documento.
 */

export type DatosDelEmpleado = { fullName: string; position: string | null; hireDate: string | null; store: string | null };

type Fila = {
  documento: DocumentoFila;
  opciones: VarianteFila[];
  marcada: VarianteFila | null;
  sugerida: boolean;
  registro: RegistroDeIngreso | null;
  estado: EstadoDocumento;
};

type Props = { employeeId: string; datos: DatosDelEmpleado; puesto?: string | null };

/** Hoy en Brownsville (la zona del módulo), no la del aparato. */
const HOY = () => hoyEnBrownsville();

export function DocumentosDeIngreso({ employeeId, datos, puesto }: Props) {
  const { t, lang } = usePrefs();
  const { notify } = useData();
  const [data, setData] = useState<{ documentos: DocumentoFila[]; variantes: VarianteFila[]; registros: RegistroDeIngreso[] } | null>(null);
  const [sinTabla, setSinTabla] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revisando, setRevisando] = useState<{ fila: Fila }[] | null>(null);
  const [firmando, setFirmando] = useState<string | null>(null);
  const inputFirma = useRef<HTMLInputElement>(null);

  const carga = useCallback(async () => {
    const r = await listOnboardingDocs(employeeId);
    if (!r.ok) { setSinTabla(r.sinTabla); setErr(r.sinTabla ? null : mensajeDeError(r.message)); setData({ documentos: [], variantes: [], registros: [] }); return; }
    setSinTabla(false); setErr(null);
    setData({ documentos: r.documentos, variantes: r.variantes, registros: r.registros });
  }, [employeeId]);

  useEffect(() => { void carga(); }, [carga]);

  const filas: Fila[] = useMemo(() => {
    if (!data) return [];
    return documentosParaEmpleado(data.documentos, data.variantes, puesto).map(({ documento, variantes, sugerida }) => {
      const todas = data.variantes.filter((v) => v.template_id === documento.id);
      const registro = data.registros.find((r) => r.template_id === documento.id) ?? null;
      const marcada = varianteMarcada(registro?.variant_id, sugerida, todas);
      // La variante guardada puede estar archivada: se deja en la lista para no perderla.
      const opciones = marcada && !variantes.some((v) => v.id === marcada.id) ? [...variantes, marcada] : variantes;
      return { documento, opciones, marcada, sugerida: !!sugerida, registro, estado: (registro?.status ?? "pending") as EstadoDocumento };
    });
  }, [data, puesto]);

  if (data === null) return <div className="hint">{t("Loading…", "Cargando…")}</div>;
  if (sinTabla) return <div className="hint" data-aviso="315">{t("Migration 315 is not applied yet: onboarding documents are set up pending.", "Falta aplicar la migración 315: los documentos de ingreso están pendientes de configurar.")}</div>;

  const pendientes = filas.filter((f) => f.estado === "pending" && f.marcada);

  const cambiaVariante = async (fila: Fila, variantId: string) => {
    const v = fila.opciones.find((x) => x.id === variantId);
    if (!v) return;
    if (MODO_DEMO) { notify(t(AVISO_DEMO.en, AVISO_DEMO.es)); return; }
    setBusy(true);
    const r = await setOnboardingVariant({ employeeId, templateId: fila.documento.id, variantId: v.id, variantVersion: v.version });
    setBusy(false);
    if (!r.ok) notify(mensajeDeError(r.message)); else await carga();
  };

  const cambiaEstado = async (fila: Fila, status: EstadoDocumento) => {
    const c = puedeCambiarEstado(fila.estado, status, !!fila.registro?.signed_file_path);
    if (!c.ok) {
      if (c.motivo === "con_firma") notify(t("It has a signed copy: it can't go back to pending.", "Tiene copia firmada: no puede volver a pendiente."));
      return;
    }
    if (MODO_DEMO) { notify(t(AVISO_DEMO.en, AVISO_DEMO.es)); return; }
    setBusy(true);
    const r = await setOnboardingStatus({ employeeId, templateId: fila.documento.id, status });
    setBusy(false);
    if (!r.ok) notify(mensajeDeError(r.message)); else await carga();
  };

  const abreFirma = async (path: string) => {
    const url = await signDocFileUrl(path);
    if (url) window.open(url, "_blank", "noopener"); else notify(t("Could not open the file.", "No se pudo abrir el archivo."));
  };

  const subeFirma = async (file: File) => {
    const templateId = firmando;
    setFirmando(null);
    if (!templateId) return;
    if (MODO_DEMO) { notify(t(AVISO_DEMO.en, AVISO_DEMO.es)); return; }
    if (!extensionPermitida(file.name, EXTENSIONES_FIRMADO)) { notify(t("Signed copies: PDF, Word, Excel or an image.", "Copias firmadas: PDF, Word, Excel o imagen.")); return; }
    if (file.size <= 0 || file.size > MAX_BYTES_FIRMADO) { notify(t("Signed copies are 25 MB max.", "Las copias firmadas son de 25 MB como máximo.")); return; }
    setBusy(true);
    const pedida = await prepareDocUpload({ kind: "firmado", employeeId, templateId, fileName: file.name, size: file.size });
    if (!pedida.ok) { setBusy(false); notify(mensajeDeError(pedida.message)); return; }
    const up = await creaClienteNavegador().storage.from("hr-docs").uploadToSignedUrl(pedida.path, pedida.token, file, { contentType: file.type || undefined });
    if (up.error) { setBusy(false); notify(mensajeDeError(up.error.message)); return; }
    const r = await attachSignedCopy({ employeeId, templateId, file: { path: pedida.path, fileName: file.name, size: file.size } });
    setBusy(false);
    if (!r.ok) notify(mensajeDeError(r.message)); else { notify(t("Signed copy saved ✓", "Copia firmada guardada ✓")); await carga(); }
  };

  const etiquetaEstado = (e: EstadoDocumento) => {
    const s = ESTADOS_DOCUMENTO.find((x) => x.key === e);
    return s ? (lang === "es" ? s.es : s.en) : e;
  };

  return (
    <div data-bloque="documentos-de-ingreso">
      <input ref={inputFirma} type="file" hidden accept={EXTENSIONES_FIRMADO.map((e) => "." + e).join(",")}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void subeFirma(f); }} />
      {err && <div className="hint" style={{ color: "var(--red)" }}>{err}</div>}
      {filas.length === 0 ? (
        <div className="hint">{t("No onboarding documents apply to this position.", "Ningún documento de ingreso le toca a su puesto.")}</div>
      ) : (
        <>
          {pendientes.length > 0 && (
            <div className="docs-cabecera">
              <button className="btn btn-primary btn-sm" data-accion="imprimir-pendientes" disabled={busy}
                onClick={() => setRevisando(pendientes.map((fila) => ({ fila })))}>
                🖨 {t(`Print all pending (${pendientes.length})`, `Imprimir todos los pendientes (${pendientes.length})`)}
              </button>
            </div>
          )}
          <div className="docs-lista" data-tabla="documentos-de-ingreso">
            {filas.map((f) => {
              // El mismo documento en el otro idioma (si lo hay): sale el interruptor y la lista enseña solo un idioma.
              const pareja = f.marcada ? parejaDeIdioma(f.opciones, f.marcada) : null;
              const idioma = idiomaDeVariante(f.marcada?.label);
              const aElegir = f.opciones.filter((v) => v.id === f.marcada?.id || !parejaDeIdioma(f.opciones, v) || idiomaDeVariante(v.label) === idioma);
              return (
              <article key={f.documento.id} className="docs-tarjeta" data-documento={f.documento.id}>
                <div className="docs-tarjeta-cab">
                  <div className="docs-titulo-bloque">
                    <h4 className="docs-titulo">{f.documento.name}</h4>
                    {f.sugerida && <span className="badge" data-sugerido>★ {t("for this position", "para su puesto")}</span>}
                  </div>
                  <span className="docs-estado" data-estado={f.estado}>{etiquetaEstado(f.estado)}</span>
                </div>
                {f.documento.description && <p className="docs-descripcion">{f.documento.description}</p>}

                <div className="docs-ajustes">
                  {aElegir.length > 1 ? (
                    <div className="docs-control">
                      <label htmlFor={`docs-variante-${f.documento.id}`}>{t("Variant", "Variante")}</label>
                      <select id={`docs-variante-${f.documento.id}`} value={f.marcada?.id ?? ""} disabled={busy} data-variante={f.documento.id}
                        onChange={(e) => void cambiaVariante(f, e.target.value)}>
                        {!f.marcada && <option value="">{t("— choose —", "— elegir —")}</option>}
                        {aElegir.map((v) => <option key={v.id} value={v.id}>{v.label}{!v.active ? ` (${t("archived", "archivada")})` : ""}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div className="docs-variante-texto">
                      <span>{t("Variant", "Variante")}:</span> <b data-variante-fija={f.documento.id}>{f.marcada?.label ?? t("none", "ninguna")}</b>
                    </div>
                  )}
                  {pareja && (
                    <div className="docs-control docs-control-idioma">
                      <label>{t("Language", "Idioma")}</label>
                      <InterruptorDeIdioma idioma={idioma} disabled={busy} de={f.documento.id} onCambia={() => void cambiaVariante(f, pareja.id)} />
                    </div>
                  )}
                  <div className="docs-control">
                    <label htmlFor={`docs-estado-${f.documento.id}`}>{t("Status", "Estado")}</label>
                    <select id={`docs-estado-${f.documento.id}`} value={f.estado} disabled={busy} data-estado-de={f.documento.id}
                      onChange={(e) => void cambiaEstado(f, e.target.value as EstadoDocumento)}>
                      {ESTADOS_DOCUMENTO.map((e) => <option key={e.key} value={e.key}>{lang === "es" ? e.es : e.en}</option>)}
                    </select>
                  </div>
                </div>

                <div className="docs-acciones">
                  <button className="btn btn-primary btn-sm" data-accion="imprimir" disabled={!f.marcada || busy}
                    title={t("Review the information, then print", "Revisar la información y luego imprimir")}
                    onClick={() => setRevisando([{ fila: f }])}>🖨 {t("Review & print", "Revisar e imprimir")}</button>
                  <button className="btn btn-ghost btn-sm" data-accion="descargar" disabled={!f.marcada || busy}
                    onClick={() => setRevisando([{ fila: f }])}>⬇ {t("Download", "Descargar")}</button>
                  <button className="btn btn-ghost btn-sm" data-accion="firmado" disabled={busy}
                    onClick={() => { setFirmando(f.documento.id); setTimeout(() => inputFirma.current?.click(), 0); }}>
                    ⬆ {t("Upload signed copy", "Subir copia firmada")}
                  </button>
                  {f.registro?.signed_file_path && (
                    <button className="btn btn-ghost btn-sm" data-accion="ver-firmado" onClick={() => void abreFirma(f.registro!.signed_file_path!)}>
                      📎 {t("View signed copy", "Ver copia firmada")}{f.registro.signed_file_name ? `: ${f.registro.signed_file_name}` : ""}
                    </button>
                  )}
                </div>

                {f.registro && (
                  <div className="docs-meta hint">
                    {t("Marked by", "Marcado por")} {f.registro.updated_by_name ?? "—"} · {fmtDateTime(f.registro.updated_at)}
                    {f.registro.reviewed_at ? ` · ${t("reviewed", "revisado")} ${fmtDateTime(f.registro.reviewed_at)}` : ""}
                  </div>
                )}
              </article>
              );
            })}
          </div>
        </>
      )}
      {revisando && revisando.length > 0 && (
        <RevisionDeDocumento
          key={revisando[0].fila.documento.id}
          employeeId={employeeId} datos={datos} fila={revisando[0].fila}
          onCancel={() => setRevisando(null)}
          onDone={async (ok) => {
            const resto = revisando.slice(1);
            if (ok) await carga();
            setRevisando(resto.length ? resto : null);
          }} />
      )}
    </div>
  );
}

/**
 * La revisión de un documento antes de imprimirlo o bajarlo. Izquierda: el formulario con los datos del documento
 * (prellenados, editables, obligatorios marcados). Derecha: la hoja del documento ya rellenada, como la cotización.
 * Abajo, fija: «He revisado la información» y los botones. No sale nada hasta que se marca la casilla.
 *
 * Imprimir en un .docx usa `window.print()` sobre la hoja: CSS de impresión (`recruiting.css`), igual que la cotización.
 */
function RevisionDeDocumento({ employeeId, datos, fila, onDone, onCancel }: {
  employeeId: string; datos: DatosDelEmpleado;
  fila: Fila;
  onDone: (ok: boolean) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t, lang } = usePrefs();
  const { notify } = useData();
  // La variante que se revisa. Empieza en la marcada; el interruptor de idioma la cambia por su traducción aquí mismo.
  const [variante, setVariante] = useState<VarianteFila>(fila.marcada!);
  const pareja = parejaDeIdioma(fila.opciones, variante);
  const idioma = idiomaDeVariante(variante.label);
  // El idioma de las fechas que escribe la app en el documento: el del documento si tiene dos idiomas; si no, el de la pantalla.
  const idiomaDelTexto = idioma === "es" ? "es" : pareja ? "en" : lang;
  /** Lo que había en el formulario justo antes de cambiar de idioma, para pasarlo al otro documento. */
  const previo = useRef<{ campos: CampoDetectado[]; valores: Record<string, string>; sugeridos: Record<string, string> } | null>(null);
  const sugeridosRef = useRef<Record<string, string>>({});
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [campos, setCampos] = useState<CampoDetectado[]>([]);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [baseHtml, setBaseHtml] = useState<string | null>(null);
  const [htmlErr, setHtmlErr] = useState<string | null>(null);
  const [revisado, setRevisado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cargaErr, setCargaErr] = useState<string | null>(null);
  const cuerpoRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const esDocx = extensionDe(variante.file_name) === "docx";

  // Los datos del empleado que llenan los marcadores {{...}}. Solo cambian si cambian sus valores, no por identidad del objeto.
  const { fullName, position, hireDate, store } = datos;
  const mapa = useMemo(
    () => mapaDeMarcadores({ fullName, position, hireDate, store }, HOY(), idiomaDelTexto),
    [fullName, position, hireDate, store, idiomaDelTexto],
  );

  /** Cambia al mismo documento en el otro idioma. Lo escrito pasa; la casilla de «revisado» se vuelve a pedir. */
  const cambiaIdioma = () => {
    if (!pareja || busy) return;
    previo.current = { campos, valores, sugeridos: sugeridosRef.current };
    setBytes(null); setBaseHtml(null); setHtmlErr(null); setCargaErr(null); setRevisado(false);
    setVariante(pareja);
  };

  // 1) Bajar el archivo, leer sus campos y poner los valores: los guardados si son de ESTA versión; si no, los sugeridos.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const url = await signDocFileUrl(variante.file_path);
      if (!url) { if (vivo) setCargaErr(t("Could not read the document.", "No se pudo leer el documento.")); return; }
      const res = await fetch(url);
      const b = new Uint8Array(await res.arrayBuffer());
      if (!vivo) return;
      setBytes(b);
      const c = esDocx ? camposDeDocx(b) : [];
      setCampos(c);
      const sugeridos = valoresSugeridos(c, datos, { idioma: idiomaDeVariante(variante.label) });
      const guardados = fila.registro && fila.registro.variant_id === variante.id && fila.registro.variant_version === variante.version
        ? fila.registro.field_values : {};
      const deEsteArchivo = { ...sugeridos, ...Object.fromEntries(Object.entries(guardados).filter(([k]) => k in sugeridos)) };
      // Si se llega aquí por el interruptor de idioma, lo que ya se escribió en el otro idioma pasa a este.
      setValores(previo.current ? { ...deEsteArchivo, ...pasaValores(previo.current, { campos: c, sugeridos: deEsteArchivo }) } : deEsteArchivo);
      previo.current = null;
      sugeridosRef.current = sugeridos;
    })().catch((e) => { if (vivo) setCargaErr(mensajeDeError(e)); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variante.id, variante.version]);

  // 2) El .docx convertido a HTML (una vez por archivo; los valores se ponen después, sin volver a convertir).
  useEffect(() => {
    if (!bytes || !esDocx) return;
    let vivo = true;
    htmlDeDocx(bytes, mapa)
      .then((h) => { if (vivo) setBaseHtml(h); })
      .catch((e) => { if (vivo) setHtmlErr(mensajeDeError(e)); });
    return () => { vivo = false; };
  }, [bytes, esDocx, mapa]);

  // 3) La hoja con los valores actuales dentro. Se escribe en el DOM (no en React) y se limpia como antes.
  useEffect(() => {
    const el = cuerpoRef.current;
    if (!el || baseHtml === null) return;
    // Se parsea en una <template> (inerte: no carga imágenes ni ejecuta nada) y se limpia ANTES de meterlo en la hoja.
    const plantilla = document.createElement("template");
    plantilla.innerHTML = sustituyeMarcadores(baseHtml, campos, valores);
    limpiaHtmlPintado(plantilla.content);
    el.replaceChildren(plantilla.content);
  }, [baseHtml, campos, valores]);

  const entradas = useMemo(() => {
    const vistas = new Map<string, CampoDetectado[]>();
    for (const c of campos) {
      const k = claveDeEntrada(c);
      vistas.set(k, [...(vistas.get(k) ?? []), c]);
    }
    return [...vistas.entries()];
  }, [campos]);

  const faltan = faltanCampos(campos, valores);
  const progreso = progresoDeCampos(entradas.map(([k]) => k), valores);
  const pct = progreso.total ? Math.round((progreso.hechos / progreso.total) * 100) : 100;
  const puedeSalir = !!bytes && revisado && faltan.length === 0 && !busy;

  const cambia = (clave: string, v: string) => setValores((prev) => ({ ...prev, [clave]: v }));

  /** Un clic en un valor de la hoja enfoca su casilla del formulario. */
  const alClicarHoja = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-entrada]");
    if (!el) return;
    const input = formRef.current?.querySelector<HTMLInputElement>(`[data-campo="${el.dataset.entrada}"] input`);
    if (input) { input.focus(); input.scrollIntoView({ block: "center", behavior: "smooth" }); }
  };

  const guardaCampos = async (): Promise<boolean> => {
    if (!campos.length) return true;
    const r = await saveReviewedFields({
      employeeId, templateId: fila.documento.id, variantId: variante.id, variantVersion: variante.version, values: valores,
    });
    if (!r.ok) { notify(mensajeDeError(r.message)); return false; }
    return true;
  };

  const descarga = async () => {
    if (!bytes || !puedeSalir) return;
    setBusy(true);
    try {
      if (!(await guardaCampos())) { setBusy(false); return; }
      descargaArchivo(esDocx ? preparaDocumento(bytes, valores, mapa) : bytes, variante.file_name);
      await onDone(true);
    } catch (e) { notify(mensajeDeError(e)); setBusy(false); }
  };

  const imprime = async () => {
    if (!bytes || !puedeSalir) return;
    setBusy(true);
    try {
      if (!(await guardaCampos())) { setBusy(false); return; }
      if (esDocx) window.print();
      else await imprimeArchivo(bytes, variante.file_name);
      await onDone(true);
    } catch (e) { notify(mensajeDeError(e)); setBusy(false); }
  };

  const titulo = t(`Review & print: ${fila.documento.name}`, `Revisar e imprimir: ${fila.documento.name}`);
  const hoyTexto = fechaLarga(HOY(), idiomaDelTexto);
  const obligatorias = clavesObligatorias(campos);
  // El nombre del documento en la biblioteca está en inglés: en la hoja en español no se pone (el archivo trae su título).
  const nombreEnLaHoja = idioma === "es" ? "" : fila.documento.name;

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-dialogo="revision-documento">
        <h3>{titulo}</h3>
        <div className="docs-revision-cab">
          <div className="hint">{t("Variant", "Variante")}: <b data-variante-en-revision>{variante.label}</b>{variante.offer_note ? ` · ${variante.offer_note}` : ""}</div>
          {pareja && <InterruptorDeIdioma idioma={idioma} disabled={busy} de={fila.documento.id} onCambia={cambiaIdioma} />}
        </div>
        {cargaErr && <div className="hint" style={{ color: "var(--red)" }}>{cargaErr}</div>}
        {htmlErr && <div className="hint" style={{ color: "var(--red)" }}>{t("The preview could not be drawn.", "No se pudo dibujar la vista previa.")} {htmlErr}</div>}
        {!bytes && !cargaErr && <div className="hint">{t("Loading…", "Cargando…")}</div>}

        {bytes && (
          <div className="docs-revision">
            <section className="docs-formulario" ref={formRef} data-campos-del-documento>
              <div className="docs-formulario-cab">
                <b>{t("Employee details for this document", "Datos del empleado para este documento")}</b>
                {esDocx && progreso.total > 0 && (
                  <div className="docs-progreso" data-progreso>
                    <span>{t(`${progreso.hechos} of ${progreso.total} completed`, `${progreso.hechos} de ${progreso.total} completados`)}</span>
                    <div className="docs-progreso-barra" aria-hidden="true"><div className="docs-progreso-relleno" style={{ width: `${pct}%` }} /></div>
                  </div>
                )}
              </div>
              {!esDocx && <div className="hint">{t("This file has no editable fields. It goes out as it is.", "Este archivo no tiene campos editables. Sale tal cual.")}</div>}
              {esDocx && entradas.length === 0 && <div className="hint">{t("No yellow fields found in this document.", "No hay campos amarillos en este documento.")}</div>}
              {entradas.map(([clave, lista]) => {
                // Todo campo amarillo se llena antes de imprimir (el dueño: «yellow fields require inputs»).
                const obligatorio = obligatorias.includes(clave);
                const tipo = lista[0].clave;
                // D-1124 (Roberto: «this is odd»): la plantilla llama «Employment Type» al campo de horas; se dice qué es.
                const etiqueta = tipo === "weekly_hours" ? `${t("Hours per week", "Horas por semana")} (${etiquetasDeCampos(lista).join(" / ")})` : etiquetasDeCampos(lista).join(" / ");
                const pista = lista[0].original;
                const v = valores[clave] ?? "";
                const id = `docs-campo-${clave}`;
                return (
                  <div key={clave} className="docs-campo-form" data-campo={clave}>
                    <label htmlFor={id}>{etiqueta}{obligatorio ? " *" : ""}</label>
                    {tipo === "start_date" ? (
                      <input id={id} type="date" value={isoDeMDY(v)} onChange={(e) => cambia(clave, mdyDeIso(e.target.value))} />
                    ) : tipo === "pay_rate" ? (
                      <div className="docs-moneda">
                        <span aria-hidden="true">$</span>
                        <input id={id} inputMode="decimal" value={pagoSinSigno(v)} placeholder={obligatorio ? `${t("e.g.", "p. ej.")} ${pagoSinSigno(pista)}` : pagoSinSigno(pista)}
                          onChange={(e) => cambia(clave, pagoConSigno(e.target.value))} />
                      </div>
                    ) : tipo === "weekly_hours" ? (
                      <input id={id} type="number" min={0} step="any" inputMode="decimal" value={v}
                        placeholder={obligatorio ? `${t("e.g.", "p. ej.")} ${pista}` : pista}
                        onChange={(e) => cambia(clave, e.target.value)} />
                    ) : (
                      <input id={id} value={v} placeholder={pista} onChange={(e) => cambia(clave, e.target.value)} />
                    )}
                    <div className="docs-ayuda">
                      {obligatorio && <span className="docs-requerido">{t("Required", "Obligatorio")} · </span>}
                      {ayudaDeCampo(tipo, t)}
                    </div>
                  </div>
                );
              })}
              {faltan.length > 0 && <div className="docs-faltan" data-faltan>{t("Fill in the required fields (*).", "Llene los campos obligatorios (*).")}</div>}
            </section>

            <section className="docs-vista-columna">
              <div className="docs-vista-cab">
                <b>{t("Document preview", "Vista previa del documento")}</b>
                {esDocx && <span className="hint">{t("Click a value to edit it.", "Haga clic en un valor para cambiarlo.")}</span>}
              </div>
              {esDocx ? (
                <div className="docs-vista" data-vista-previa>
                  {/* La hoja del documento: encabezado de la empresa como en la cotización, el texto, y el pie con la fecha. */}
                  <div className="docs-hoja" data-hoja>
                    <div className="docs-hoja-encabezado">
                      <div className="docs-hoja-empresa">{ENCABEZADO}</div>
                      {nombreEnLaHoja && <div className="docs-hoja-titulo">{nombreEnLaHoja}</div>}
                    </div>
                    <div ref={cuerpoRef} className="docs-hoja-cuerpo" onClick={alClicarHoja} data-cuerpo-documento />
                    <div className="docs-hoja-pie">{nombreEnLaHoja ? `${nombreEnLaHoja} · ` : ""}{hoyTexto}</div>
                  </div>
                </div>
              ) : (
                <div className="docs-vista"><div className="hint">{t("Preview not available for this file type.", "Sin vista previa para este tipo de archivo.")}</div></div>
              )}
            </section>
          </div>
        )}

        <div className="docs-barra" data-barra-revision>
          <label className="docs-revisado">
            <input type="checkbox" checked={revisado} onChange={(e) => setRevisado(e.target.checked)} data-revisado />
            {t("I reviewed the information", "He revisado la información")}
          </label>
          <div className="docs-barra-acciones">
            <button className="btn btn-ghost" disabled={busy} onClick={onCancel}>{t("Cancel", "Cancelar")}</button>
            <button className="btn btn-ghost" data-accion="revision-descargar" disabled={!puedeSalir}
              onClick={() => void descarga()}>
              ⬇ {esDocx ? t("Download .docx", "Descargar .docx") : t("Download", "Descargar")}
            </button>
            <button className="btn btn-primary" data-accion="revision-imprimir" disabled={!puedeSalir || (esDocx && baseHtml === null)}
              onClick={() => void imprime()}>
              🖨 {t("Print", "Imprimir")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
