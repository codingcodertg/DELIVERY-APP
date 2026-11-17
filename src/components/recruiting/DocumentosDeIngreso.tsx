"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mensajeDeError } from "@/lib/mensaje-de-error";
import { usePrefs } from "@/lib/prefs";
import { MODO_DEMO, AVISO_DEMO } from "@/lib/recruiting/modo-demo";
import { hoyEnBrownsville } from "@/lib/recruiting/hora-de-brownsville";
import { useData } from "@/lib/recruiting-data-provider";
import { fmtDateTime } from "@/lib/utils";
import { createClient as creaClienteNavegador } from "@/lib/supabase/client";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import {
  attachSignedCopy, listOnboardingDocs, prepareDocUpload, saveReviewedFields, setOnboardingStatus, setOnboardingVariant,
  signDocFileUrl, type DocumentoFila, type RegistroDeIngreso, type VarianteFila,
} from "@/app/recruiting/actions/plantillas";
import {
  documentosParaEmpleado, varianteMarcada, ESTADOS_DOCUMENTO, EXTENSIONES_FIRMADO, MAX_BYTES_FIRMADO,
  puedeCambiarEstado, extensionPermitida, extensionDe, type EstadoDocumento,
} from "@/lib/recruiting/plantillas-de-documentos";
import {
  camposDeDocx, claveDeEntrada, etiquetasDeCampos, faltanCampos, valoresSugeridos, type CampoDetectado,
} from "@/lib/recruiting/campos-de-documento";
import { mapaDeMarcadores } from "@/lib/recruiting/plantillas-de-documentos";
import { preparaDocumento, pintaDocx, imprimeArchivo, descargaArchivo } from "@/lib/recruiting/imprimir-documento";

/**
 * Documentos de ingreso dentro de la ficha del empleado (migración 315).
 *
 * Solo aparecen los documentos que le tocan por su puesto (o los que son «para todos»). Cada uno con su variante, su estado
 * y su copia firmada. Imprimir y bajar pasan SIEMPRE por la revisión: RR. HH. ve los campos del documento, los confirma
 * y recién entonces sale. «Imprimir todos los pendientes» hace una revisión por documento y luego imprime.
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
  const [revisando, setRevisando] = useState<{ fila: Fila; accion: "imprimir" | "descargar" }[] | null>(null);
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

  const columnas: ColumnaEstandar<Fila>[] = [
    { key: "documento", en: "Document", es: "Documento", ancho: 260,
      valor: (f) => f.documento.name,
      celda: (f) => (
        <span>
          <b>{f.documento.name}</b>{f.sugerida && <span className="badge" style={{ marginLeft: 6 }} data-sugerido>★ {t("for this position", "para su puesto")}</span>}
          {f.documento.description && <div className="hint" style={{ marginTop: 2 }}>{f.documento.description}</div>}
        </span>
      ) },
    { key: "variante", en: "Variant", es: "Variante", ancho: 240,
      valor: (f) => f.marcada?.label ?? "",
      celda: (f) => (
        <select value={f.marcada?.id ?? ""} disabled={busy || f.opciones.length === 0} data-variante={f.documento.id}
          onChange={(e) => void cambiaVariante(f, e.target.value)} style={{ width: "100%" }}>
          {!f.marcada && <option value="">{t("— choose —", "— elegir —")}</option>}
          {f.opciones.map((v) => <option key={v.id} value={v.id}>{v.label}{!v.active ? ` (${t("archived", "archivada")})` : ""}</option>)}
        </select>
      ) },
    { key: "estado", en: "Status", es: "Estado", ancho: 150,
      valor: (f) => f.estado,
      celda: (f) => (
        <select value={f.estado} disabled={busy} data-estado-de={f.documento.id} onChange={(e) => void cambiaEstado(f, e.target.value as EstadoDocumento)}>
          {ESTADOS_DOCUMENTO.map((e) => <option key={e.key} value={e.key}>{lang === "es" ? e.es : e.en}</option>)}
        </select>
      ) },
    { key: "firmado", en: "Signed copy", es: "Copia firmada", ancho: 200,
      valor: (f) => f.registro?.signed_file_name ?? "",
      celda: (f) => f.registro?.signed_file_path
        ? <button className="btn btn-ghost btn-sm" onClick={() => void abreFirma(f.registro!.signed_file_path!)}>📎 {f.registro.signed_file_name}</button>
        : <span className="hint">—</span> },
    { key: "quien", en: "Marked by", es: "Marcado por", ancho: 190,
      valor: (f) => f.registro?.updated_at ?? "",
      celda: (f) => f.registro
        ? <span className="hint">{f.registro.updated_by_name ?? "—"} · {fmtDateTime(f.registro.updated_at)}{f.registro.reviewed_at ? <div>{t("reviewed", "revisado")} {fmtDateTime(f.registro.reviewed_at)}</div> : null}</span>
        : <span className="hint">—</span> },
  ];

  return (
    <div data-bloque="documentos-de-ingreso">
      <input ref={inputFirma} type="file" hidden accept={EXTENSIONES_FIRMADO.map((e) => "." + e).join(",")}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void subeFirma(f); }} />
      {err && <div className="hint" style={{ color: "var(--red)" }}>{err}</div>}
      {filas.length === 0 ? (
        <div className="hint">{t("No onboarding documents apply to this position.", "Ningún documento de ingreso le toca a su puesto.")}</div>
      ) : (
        <TablaEstandar<Fila>
          id="documentos-de-ingreso" filas={filas} claveDe={(f) => f.documento.id} data-tabla="documentos-de-ingreso"
          columnas={columnas} sinCaja
          barra={pendientes.length > 0 && (
            <button className="btn btn-primary btn-sm" data-accion="imprimir-pendientes" disabled={busy}
              onClick={() => setRevisando(pendientes.map((fila) => ({ fila, accion: "imprimir" as const })))}>
              🖨 {t(`Print all pending (${pendientes.length})`, `Imprimir todos los pendientes (${pendientes.length})`)}
            </button>
          )}
          acciones={(f) => (
            <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <button className="btn btn-ghost btn-sm" data-accion="imprimir" disabled={!f.marcada || busy}
                title={t("Review the information, then print", "Revisar la información y luego imprimir")}
                onClick={() => setRevisando([{ fila: f, accion: "imprimir" }])}>🖨 {t("Print", "Imprimir")}</button>
              <button className="btn btn-ghost btn-sm" data-accion="descargar" disabled={!f.marcada || busy}
                onClick={() => setRevisando([{ fila: f, accion: "descargar" }])}>⬇ {t("Download", "Descargar")}</button>
              <button className="btn btn-ghost btn-sm" data-accion="firmado" disabled={busy}
                onClick={() => { setFirmando(f.documento.id); setTimeout(() => inputFirma.current?.click(), 0); }}>
                ⬆ {t("Signed copy", "Copia firmada")}
              </button>
            </span>
          )}
          anchoDeAcciones={320}
        />
      )}
      {revisando && revisando.length > 0 && (
        <RevisionDeDocumento
          key={revisando[0].fila.documento.id + revisando[0].accion}
          employeeId={employeeId} datos={datos} item={revisando[0]}
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
 * La revisión de un documento antes de imprimirlo o bajarlo: los campos amarillos del .docx, prellenados, editables, y la
 * vista previa del documento ya rellenado. Horas y pago van vacíos y son obligatorios. No sale nada hasta que se marca
 * «He revisado la información».
 */
function RevisionDeDocumento({ employeeId, datos, item, onDone, onCancel }: {
  employeeId: string; datos: DatosDelEmpleado;
  item: { fila: Fila; accion: "imprimir" | "descargar" };
  onDone: (ok: boolean) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t, lang } = usePrefs();
  const { notify } = useData();
  const { fila, accion } = item;
  const variante = fila.marcada!;
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [campos, setCampos] = useState<CampoDetectado[]>([]);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [revisado, setRevisado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cargaErr, setCargaErr] = useState<string | null>(null);
  const vistaRef = useRef<HTMLDivElement>(null);
  const esDocx = extensionDe(variante.file_name) === "docx";

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
      const sugeridos = valoresSugeridos(c, datos);
      const guardados = fila.registro && fila.registro.variant_id === variante.id && fila.registro.variant_version === variante.version
        ? fila.registro.field_values : {};
      setValores({ ...sugeridos, ...Object.fromEntries(Object.entries(guardados).filter(([k]) => k in sugeridos)) });
    })().catch((e) => { if (vivo) setCargaErr(mensajeDeError(e)); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variante.id, variante.version]);

  const entradas = useMemo(() => {
    const vistas = new Map<string, CampoDetectado[]>();
    for (const c of campos) {
      const k = claveDeEntrada(c);
      vistas.set(k, [...(vistas.get(k) ?? []), c]);
    }
    return [...vistas.entries()];
  }, [campos]);

  const faltan = faltanCampos(campos, valores);
  const mapa = useMemo(() => mapaDeMarcadores(datos, HOY(), lang), [datos, lang]);

  // 2) Vista previa del documento ya rellenado.
  useEffect(() => {
    if (!bytes || !esDocx || !vistaRef.current) return;
    const cuerpo = vistaRef.current;
    let vivo = true;
    (async () => {
      const preparado = preparaDocumento(bytes, valores, mapa);
      cuerpo.replaceChildren();
      if (!vivo) return;
      await pintaDocx(preparado, cuerpo);
    })().catch(() => { if (vivo) cuerpo.textContent = t("The preview could not be drawn.", "No se pudo dibujar la vista previa."); });
    return () => { vivo = false; };
  }, [bytes, valores, esDocx, mapa, t]);

  const confirma = async () => {
    if (!bytes || faltan.length || !revisado) return;
    setBusy(true);
    try {
      const tienenCampos = campos.length > 0;
      if (tienenCampos) {
        const r = await saveReviewedFields({
          employeeId, templateId: fila.documento.id, variantId: variante.id, variantVersion: variante.version, values: valores,
        });
        if (!r.ok) { notify(mensajeDeError(r.message)); setBusy(false); return; }
      }
      const final = esDocx ? preparaDocumento(bytes, valores, mapa) : bytes;
      if (accion === "imprimir") await imprimeArchivo(final, variante.file_name);
      else descargaArchivo(final, variante.file_name);
      await onDone(true);
    } catch (e) {
      notify(mensajeDeError(e));
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1000 }} data-dialogo="revision-documento">
        <h3>{t("Review before ", "Revisar antes de ")}{accion === "imprimir" ? t("printing", "imprimir") : t("downloading", "descargar")}: {fila.documento.name}</h3>
        <div className="hint">{t("Variant", "Variante")}: <b>{variante.label}</b>{variante.offer_note ? ` · ${variante.offer_note}` : ""}</div>
        {cargaErr && <div className="hint" style={{ color: "var(--red)" }}>{cargaErr}</div>}
        {!bytes && !cargaErr && <div className="hint">{t("Loading…", "Cargando…")}</div>}

        {bytes && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 1fr) minmax(0, 2fr)", gap: 14, marginTop: 10 }}>
            <div data-campos-del-documento>
              <b>{t("Information in the document", "Información del documento")}</b>
              {!esDocx && <div className="hint">{t("This file has no editable fields. It goes out as it is.", "Este archivo no tiene campos editables. Sale tal cual.")}</div>}
              {esDocx && entradas.length === 0 && <div className="hint">{t("No yellow fields found in this document.", "No hay campos amarillos en este documento.")}</div>}
              {entradas.map(([clave, lista]) => {
                const obligatorio = lista.some((c) => c.clave === "weekly_hours" || c.clave === "pay_rate");
                const etiqueta = etiquetasDeCampos(lista).join(" / ");
                const pista = lista[0].original;
                return (
                  <div key={clave} style={{ marginTop: 10 }} data-campo={clave}>
                    <label>{etiqueta}{obligatorio ? " *" : ""}</label>
                    <input value={valores[clave] ?? ""} placeholder={obligatorio ? `${t("e.g.", "p. ej.")} ${pista}` : pista}
                      onChange={(e) => setValores({ ...valores, [clave]: e.target.value })} />
                    {obligatorio && <div className="hint">{t("Typed by hand each time; not taken from the file.", "Se escribe a mano cada vez; no viene del expediente.")}</div>}
                  </div>
                );
              })}
              {faltan.length > 0 && <div className="hint" style={{ color: "var(--red)", marginTop: 8 }} data-faltan>{t("Fill in the required fields (*).", "Llene los campos obligatorios (*).")}</div>}
            </div>

            <div>
              <b>{t("Preview", "Vista previa")}</b>
              <div ref={vistaRef} data-vista-previa style={{ maxHeight: "52vh", overflow: "auto", border: "1px solid var(--line, #ddd)", borderRadius: 8, background: "var(--paper, #fff)", marginTop: 6 }} />
            </div>
          </div>
        )}

        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14, textTransform: "none", fontWeight: 500 }}>
          <input type="checkbox" checked={revisado} onChange={(e) => setRevisado(e.target.checked)} data-revisado />
          {t("I reviewed the information", "He revisado la información")}
        </label>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" disabled={busy} onClick={onCancel}>{t("Cancel", "Cancelar")}</button>
          <button className="btn btn-ghost" data-accion="revision-descargar" disabled={!bytes || !revisado || faltan.length > 0 || busy}
            onClick={async () => { setBusy(true); await saveIfNeeded(); if (bytes) descargaArchivo(esDocx ? preparaDocumento(bytes, valores, mapa) : bytes, variante.file_name); await onDone(true); }}>
            ⬇ {t("Download .docx", "Descargar")}
          </button>
          <button className="btn btn-primary" data-accion="revision-confirmar" disabled={!bytes || !revisado || faltan.length > 0 || busy}
            onClick={() => void confirma()}>
            {accion === "imprimir"
              ? `✓ ${t("Information is correct — Print", "La información es correcta — Imprimir")}`
              : `✓ ${t("Information is correct — Download", "La información es correcta — Descargar")}`}
          </button>
        </div>
      </div>
    </div>
  );

  async function saveIfNeeded() {
    if (campos.length) await saveReviewedFields({ employeeId, templateId: fila.documento.id, variantId: variante.id, variantVersion: variante.version, values: valores });
  }
}
