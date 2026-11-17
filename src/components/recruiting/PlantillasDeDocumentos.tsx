"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mensajeDeError } from "@/lib/mensaje-de-error";
import { usePrefs } from "@/lib/prefs";
import { MODO_DEMO, AVISO_DEMO } from "@/lib/recruiting/modo-demo";
import { useData } from "@/lib/recruiting-data-provider";
import { fmtDateTime } from "@/lib/utils";
import { createClient as creaClienteNavegador } from "@/lib/supabase/client";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { BuscadorConBorrar } from "@/components/BuscadorConBorrar";
import {
  addVariantVersion, createDocument, createVariant, deleteDocument, deleteVariant, listDocumentLibrary, listVariantVersions,
  prepareDocUpload, signDocFileUrl, updateDocument, updateVariant,
  type DocumentoFila, type VarianteFila, type VersionFila,
} from "@/app/recruiting/actions/plantillas";
import {
  CATEGORIAS_SUGERIDAS, EXTENSIONES_VARIANTE, MARCADORES, MAX_BYTES_VARIANTE, extensionPermitida, filtraDocumentos, tamanoLegible,
} from "@/lib/recruiting/plantillas-de-documentos";
import { camposDeDocx, etiquetasDeCampos } from "@/lib/recruiting/campos-de-documento";

/**
 * La biblioteca de documentos de ingreso (migración 315): los documentos, sus variantes y su archivo.
 * Un documento tiene variantes (por puesto u oferta); cada variante es un archivo .docx/.pdf/.xlsx con su versión.
 */

type Modo =
  | { tipo: "documento"; doc?: DocumentoFila }
  | { tipo: "variante"; variante?: VarianteFila; documentoId: string };

export function PlantillasDeDocumentos({ onClose }: { onClose: () => void }) {
  const { t, lang } = usePrefs();
  const { notify, roles } = useData();
  const [documentos, setDocumentos] = useState<DocumentoFila[]>([]);
  const [variantes, setVariantes] = useState<VarianteFila[]>([]);
  const [sinTabla, setSinTabla] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");
  const [categoria, setCategoria] = useState("");
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo | null>(null);
  const [historial, setHistorial] = useState<{ variante: VarianteFila; versiones: VersionFila[] } | null>(null);
  const [nuevaVersionDe, setNuevaVersionDe] = useState<VarianteFila | null>(null);
  const [detectados, setDetectados] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const inputArchivo = useRef<HTMLInputElement>(null);
  const [archivoPara, setArchivoPara] = useState<{ fn: (f: File) => void } | null>(null);

  const carga = useCallback(async () => {
    if (MODO_DEMO) { setCargando(false); setErr(t(AVISO_DEMO.en, AVISO_DEMO.es)); return; }
    const r = await listDocumentLibrary();
    setCargando(false);
    if (!r.ok) { setSinTabla(r.sinTabla); setErr(r.sinTabla ? null : mensajeDeError(r.message)); return; }
    setSinTabla(false); setErr(null);
    setDocumentos(r.documentos); setVariantes(r.variantes);
  }, []);
  useEffect(() => { void carga(); }, [carga]);

  const categorias = useMemo(() => [...new Set(documentos.map((d) => d.category).filter((c): c is string => !!c))].sort(), [documentos]);
  const visibles = filtraDocumentos(documentos, { buscar, categoria });
  const doc = documentos.find((d) => d.id === seleccion) ?? null;
  const varsDelDoc = variantes.filter((v) => v.template_id === seleccion);
  const numVariantes = (id: string) => variantes.filter((v) => v.template_id === id).length;

  /** Un archivo elegido en el navegador: se lee para mostrar qué campos amarillos tiene. */
  const alElegirArchivo = async (file: File) => {
    if (!extensionPermitida(file.name, EXTENSIONES_VARIANTE)) { notify(t("Documents must be Word (.docx), PDF or Excel (.xlsx).", "Los documentos deben ser Word (.docx), PDF o Excel (.xlsx).")); return; }
    if (file.size <= 0 || file.size > MAX_BYTES_VARIANTE) { notify(t("Documents are 20 MB max.", "Los documentos son de 20 MB como máximo.")); return; }
    if (file.name.toLowerCase().endsWith(".docx")) {
      try {
        const c = camposDeDocx(await file.arrayBuffer());
        setDetectados(etiquetasDeCampos(c));
      } catch { setDetectados([]); }
    } else setDetectados(null);
  };

  const pideArchivo = (fn: (f: File) => void) => {
    setDetectados(null);
    setArchivoPara({ fn });
    setTimeout(() => inputArchivo.current?.click(), 0);
  };

  /** Sube el archivo por firma y devuelve la ruta reservada, o null si algo falló (ya avisado). */
  const subeVariante = async (file: File, variantId: string | null, templateId: string | null) => {
    const pedida = await prepareDocUpload({ kind: "variante", variantId, templateId, fileName: file.name, size: file.size });
    if (!pedida.ok) { notify(mensajeDeError(pedida.message)); return null; }
    const up = await creaClienteNavegador().storage.from("hr-docs").uploadToSignedUrl(pedida.path, pedida.token, file, { contentType: undefined });
    if (up.error) { notify(mensajeDeError(up.error.message)); return null; }
    return { id: pedida.id, version: pedida.version, path: pedida.path };
  };

  const guardaDocumento = async (form: HTMLFormElement) => {
    const fd = new FormData(form);
    const datos = {
      name: String(fd.get("name") ?? ""), description: String(fd.get("description") ?? ""),
      category: String(fd.get("category") ?? ""), sortOrder: Number(fd.get("sortOrder") ?? 100) || 100,
      active: fd.get("active") === "on", appliesToAll: fd.get("appliesToAll") === "on",
    };
    setBusy(true);
    const r = modo?.tipo === "documento" && modo.doc
      ? await updateDocument(modo.doc.id, datos)
      : await createDocument(datos);
    setBusy(false);
    if (!r.ok) { notify(mensajeDeError(r.message)); return; }
    setModo(null);
    const nuevoId = (r as { id?: string }).id;
    if (r.ok && nuevoId) setSeleccion(nuevoId);
    await carga();
    notify(t("Saved ✓", "Guardado ✓"));
  };

  const guardaVariante = async (form: HTMLFormElement, fileNuevo: File | null) => {
    if (modo?.tipo !== "variante") return;
    const fd = new FormData(form);
    const label = String(fd.get("label") ?? "");
    const positions = String(fd.get("positions") ?? "");
    const offerNote = String(fd.get("offerNote") ?? "");
    const active = fd.get("active") === "on";
    setBusy(true);
    if (modo.variante) {
      const r = await updateVariant(modo.variante.id, { label, positions, offerNote, active });
      setBusy(false);
      if (!r.ok) { notify(mensajeDeError(r.message)); return; }
    } else {
      if (!fileNuevo) { setBusy(false); notify(t("Choose the file for this variant.", "Elija el archivo de esta variante.")); return; }
      const sub = await subeVariante(fileNuevo, null, modo.documentoId);
      if (!sub) { setBusy(false); return; }
      const r = await createVariant({
        id: sub.id, templateId: modo.documentoId, label, positions, offerNote, active,
        file: { path: sub.path, fileName: fileNuevo.name, size: fileNuevo.size },
      });
      setBusy(false);
      if (!r.ok) { notify(mensajeDeError(r.message)); return; }
    }
    setModo(null); setDetectados(null);
    await carga();
    notify(t("Saved ✓", "Guardado ✓"));
  };

  const borraDoc = async (d: DocumentoFila) => {
    if (!window.confirm(t(`Delete «${d.name}»?`, `¿Borrar «${d.name}»?`))) return;
    const r = await deleteDocument(d.id);
    if (!r.ok) notify(mensajeDeError(r.message)); else { if (seleccion === d.id) setSeleccion(null); await carga(); }
  };

  const borraVar = async (v: VarianteFila) => {
    if (!window.confirm(t(`Delete the variant «${v.label}»?`, `¿Borrar la variante «${v.label}»?`))) return;
    const r = await deleteVariant(v.id);
    if (!r.ok) notify(mensajeDeError(r.message)); else await carga();
  };

  const abreArchivo = async (path: string) => {
    const url = await signDocFileUrl(path);
    if (url) window.open(url, "_blank", "noopener"); else notify(t("Could not open the file.", "No se pudo abrir el archivo."));
  };

  const verHistorial = async (v: VarianteFila) => {
    const r = await listVariantVersions(v.id);
    if (!r.ok) { notify(mensajeDeError(r.message)); return; }
    setHistorial({ variante: v, versiones: r.versiones });
  };

  const colDocs: ColumnaEstandar<DocumentoFila>[] = [
    { key: "name", en: "Document", es: "Documento", ancho: 260, valor: (d) => d.name,
      celda: (d) => <b style={{ opacity: d.active ? 1 : 0.5 }}>{d.name}{!d.active && ` (${t("archived", "archivado")})`}</b> },
    { key: "category", en: "Category", es: "Categoría", ancho: 140, valor: (d) => d.category ?? "" },
    { key: "variantes", en: "Variants", es: "Variantes", ancho: 90, valor: (d) => numVariantes(d.id), numerico: true },
    { key: "todos", en: "For everyone", es: "Para todos", ancho: 110, valor: (d) => (d.applies_to_all ? t("Yes", "Sí") : t("No", "No")) },
  ];
  const colVars: ColumnaEstandar<VarianteFila>[] = [
    { key: "label", en: "Variant", es: "Variante", ancho: 260, valor: (v) => v.label,
      celda: (v) => <span style={{ opacity: v.active ? 1 : 0.5 }}>{v.label}{!v.active && ` (${t("archived", "archivada")})`}</span> },
    { key: "positions", en: "Positions", es: "Puestos", ancho: 240, valor: (v) => v.positions.join(", ") },
    { key: "offer", en: "Offer", es: "Oferta", ancho: 150, valor: (v) => v.offer_note ?? "" },
    { key: "version", en: "Version", es: "Versión", ancho: 80, valor: (v) => v.version, numerico: true },
    { key: "archivo", en: "File", es: "Archivo", ancho: 200, valor: (v) => v.file_name,
      celda: (v) => <span className="hint">{v.file_name} · {tamanoLegible(v.size)}</span> },
  ];

  if (cargando) return <Caja onClose={onClose} titulo={t("Onboarding documents", "Documentos de ingreso")}><div className="hint">{t("Loading…", "Cargando…")}</div></Caja>;

  return (
    <Caja onClose={onClose} titulo={t("Onboarding documents", "Documentos de ingreso")} ancho={1080}>
      <input ref={inputArchivo} type="file" hidden accept={EXTENSIONES_VARIANTE.map((e) => "." + e).join(",")}
        onChange={(e) => {
          const f = e.target.files?.[0]; e.target.value = "";
          if (!f) return;
          if (archivoPara) { void alElegirArchivo(f); archivoPara.fn(f); }
        }} />

      <div className="hint" data-ayuda style={{ background: "var(--tint-blue)", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
        <b>{t("How it works", "Cómo funciona")}:</b> {t("in Word, highlight in yellow the parts that change per employee (date, position, hours, pay). The app asks HR for them each time. Hours and pay are typed by hand, never taken from the employee file.",
          "en Word, marque en amarillo lo que cambia por persona (fecha, puesto, horas, pago). La app se lo pregunta a RR. HH. cada vez. Horas y pago se escriben a mano, nunca vienen del expediente.")}
        <div style={{ marginTop: 4 }}>{t("Also works: placeholders", "También sirven los marcadores")}: {MARCADORES.map((m) => (
          <code key={m.key} style={{ marginRight: 6 }}>{`{{${m.key}}}`}</code>))}</div>
      </div>

      {sinTabla && <div className="hint" data-aviso="315">{t("Migration 315 is not applied yet: onboarding documents are set up pending.", "Falta aplicar la migración 315: los documentos de ingreso están pendientes de configurar.")}</div>}
      {err && <div className="hint" style={{ color: "var(--red)" }}>{err}</div>}

      {!sinTabla && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
            <BuscadorConBorrar maxWidth={260} valor={buscar} onValor={setBuscar} placeholder={t("Search documents…", "Buscar documentos…")} />
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">{t("All categories", "Todas las categorías")}</option>
              {[...new Set([...CATEGORIAS_SUGERIDAS, ...categorias])].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" data-accion="nuevo-documento" style={{ marginLeft: "auto" }}
              onClick={() => setModo({ tipo: "documento" })}>＋ {t("New document", "Nuevo documento")}</button>
          </div>

          {modo?.tipo === "documento" && (
            <form className="card" style={{ marginBottom: 10 }} data-form="documento"
              onSubmit={(e) => { e.preventDefault(); void guardaDocumento(e.currentTarget); }}>
              <div className="grid g3">
                <div><label>{t("Name", "Nombre")}</label><input name="name" required defaultValue={modo.doc?.name ?? ""} /></div>
                <div><label>{t("Category (optional)", "Categoría (opcional)")}</label>
                  <input name="category" list="categorias-de-documentos" defaultValue={modo.doc?.category ?? ""} />
                  <datalist id="categorias-de-documentos">{CATEGORIAS_SUGERIDAS.map((c) => <option key={c} value={c} />)}</datalist></div>
                <div><label>{t("Order", "Orden")}</label><input name="sortOrder" type="number" defaultValue={modo.doc?.sort_order ?? 100} /></div>
              </div>
              <div style={{ marginTop: 10 }}><label>{t("Description", "Descripción")}</label><textarea name="description" rows={2} defaultValue={modo.doc?.description ?? ""} /></div>
              <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
                <label style={{ textTransform: "none", fontWeight: 500 }}><input type="checkbox" name="active" defaultChecked={modo.doc?.active ?? true} /> {t("Active", "Activo")}</label>
                <label style={{ textTransform: "none", fontWeight: 500 }}><input type="checkbox" name="appliesToAll" defaultChecked={modo.doc?.applies_to_all ?? false} /> {t("Applies to everyone (e.g. handbook)", "Aplica a todos (p. ej. manual)")}</label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="btn btn-primary btn-sm" disabled={busy}>{t("Save", "Guardar")}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModo(null)}>{t("Cancel", "Cancelar")}</button>
              </div>
            </form>
          )}

          <TablaEstandar<DocumentoFila>
            id="documentos-de-ingreso-biblioteca" filas={visibles} claveDe={(d) => d.id} onFila={(d) => setSeleccion(d.id)}
            data-tabla="biblioteca-documentos" columnas={colDocs} sinCaja
            vacio={t("No documents yet.", "Todavía no hay documentos.")}
            claseDeFila={(d) => (d.id === seleccion ? "sel" : undefined)}
            anchoDeAcciones={150}
            acciones={(d) => (
              <span style={{ display: "flex", gap: 4 }}>
                <button className="btn btn-ghost btn-sm" data-accion="editar-documento" onClick={(e) => { e.stopPropagation(); setModo({ tipo: "documento", doc: d }); }}>✏️</button>
                <button className="btn btn-ghost btn-sm" data-accion="borrar-documento" onClick={(e) => { e.stopPropagation(); void borraDoc(d); }}>🗑</button>
              </span>
            )}
          />

          {doc && (
            <div className="card" style={{ marginTop: 12 }} data-documento-abierto={doc.id}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <h3 style={{ margin: 0 }}>{doc.name}</h3>
                <button className="btn btn-primary btn-sm" data-accion="nueva-variante" style={{ marginLeft: "auto" }}
                  onClick={() => { setDetectados(null); setModo({ tipo: "variante", documentoId: doc.id }); }}>＋ {t("New variant", "Nueva variante")}</button>
              </div>

              {modo?.tipo === "variante" && (
                <form className="card" style={{ marginTop: 10 }} data-form="variante"
                  onSubmit={(e) => { e.preventDefault(); const f = (e.currentTarget.elements.namedItem("archivo") as HTMLInputElement | null)?.files?.[0] ?? null; void guardaVariante(e.currentTarget, f); }}>
                  <div className="grid g3">
                    <div><label>{t("Variant name", "Nombre de la variante")}</label><input name="label" required defaultValue={modo.variante?.label ?? ""} placeholder="Junior Sales — $13/hr + commission" /></div>
                    <div><label>{t("Applies to positions (comma separated)", "Aplica a los puestos (separados por coma)")}</label>
                      <input name="positions" list="puestos-de-documentos" defaultValue={modo.variante?.positions.join(", ") ?? ""} />
                      <datalist id="puestos-de-documentos">{(roles ?? []).map((p) => <option key={p} value={p} />)}</datalist></div>
                    <div><label>{t("Offer note (optional)", "Nota de la oferta (opcional)")}</label><input name="offerNote" defaultValue={modo.variante?.offer_note ?? ""} placeholder="$11/hr" /></div>
                  </div>
                  {!modo.variante && (
                    <div style={{ marginTop: 10 }}>
                      <label>{t("File (.docx, .pdf or .xlsx, 20 MB max)", "Archivo (.docx, .pdf o .xlsx, 20 MB máximo)")}</label>
                      <input name="archivo" type="file" accept={EXTENSIONES_VARIANTE.map((e) => "." + e).join(",")}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) void alElegirArchivo(f); }} />
                    </div>
                  )}
                  {detectados && (
                    <div className="hint" data-campos-detectados style={{ marginTop: 8 }}>
                      <b>{t("Detected fields", "Campos detectados")}:</b> {detectados.length ? detectados.join(", ") : t("none (highlight them in yellow in Word)", "ninguno (márquelos en amarillo en Word)")}
                    </div>
                  )}
                  <label style={{ textTransform: "none", fontWeight: 500, marginTop: 8, display: "block" }}>
                    <input type="checkbox" name="active" defaultChecked={modo.variante?.active ?? true} /> {t("Active", "Activa")}
                  </label>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button className="btn btn-primary btn-sm" disabled={busy}>{t("Save", "Guardar")}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setModo(null); setDetectados(null); }}>{t("Cancel", "Cancelar")}</button>
                  </div>
                </form>
              )}

              <div style={{ marginTop: 10 }}>
                <TablaEstandar<VarianteFila>
                  id="variantes-de-documento" filas={varsDelDoc} claveDe={(v) => v.id} data-tabla="variantes" columnas={colVars} sinCaja
                  vacio={t("No variants yet. Add one with its file.", "Sin variantes. Agregue una con su archivo.")}
                  anchoDeAcciones={250}
                  acciones={(v) => (
                    <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <button className="btn btn-ghost btn-sm" data-accion="bajar-variante" onClick={() => void abreArchivo(v.file_path)}>⬇</button>
                      <button className="btn btn-ghost btn-sm" data-accion="nueva-version" onClick={() => { setNuevaVersionDe(v); pideArchivo(async (f) => {
                        const sub = await subeVariante(f, v.id, null);
                        if (!sub) return;
                        const r = await addVariantVersion(v.id, { path: sub.path, fileName: f.name, size: f.size });
                        if (!r.ok) notify(mensajeDeError(r.message)); else { notify(t("New version saved ✓", "Versión nueva guardada ✓")); await carga(); }
                        setNuevaVersionDe(null);
                      }); }}>⬆ {t("New version", "Nueva versión")}</button>
                      <button className="btn btn-ghost btn-sm" data-accion="historial" onClick={() => void verHistorial(v)}>🕘</button>
                      <button className="btn btn-ghost btn-sm" data-accion="editar-variante" onClick={() => { setDetectados(null); setModo({ tipo: "variante", documentoId: doc.id, variante: v }); }}>✏️</button>
                      <button className="btn btn-ghost btn-sm" data-accion="borrar-variante" onClick={() => void borraVar(v)}>🗑</button>
                    </span>
                  )}
                />
              </div>

              {historial && historial.variante.template_id === doc.id && (
                <div className="hint" style={{ marginTop: 8 }} data-historial>
                  <b>{t("Previous versions of", "Versiones anteriores de")} {historial.variante.label}:</b>
                  {historial.versiones.length === 0 && <span> {t("none", "ninguna")}</span>}
                  {historial.versiones.map((h) => (
                    <div key={h.id}>v{h.version} · {h.file_name} · {fmtDateTime(h.created_at)}{" "}
                      <button className="btn btn-ghost btn-sm" onClick={() => void abreArchivo(h.file_path)}>⬇</button></div>
                  ))}
                  <button className="btn btn-ghost btn-sm" onClick={() => setHistorial(null)}>{t("Close", "Cerrar")}</button>
                </div>
              )}
              {nuevaVersionDe && <div className="hint" style={{ marginTop: 6 }}>{t("Choosing the file for version", "Eligiendo el archivo de la versión")} {nuevaVersionDe.version + 1}…</div>}
              {busy && <div className="hint">{t("Working…", "Trabajando…")}</div>}
            </div>
          )}
        </>
      )}
    </Caja>
  );
}

function Caja({ titulo, children, onClose, ancho = 760 }: { titulo: string; children: React.ReactNode; onClose: () => void; ancho?: number }) {
  const { t } = usePrefs();
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: ancho }} data-dialogo="plantillas-de-documentos">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0 }}>📄 {titulo}</h3>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={onClose} aria-label={t("Close", "Cerrar")}>✕</button>
        </div>
        <div style={{ marginTop: 10 }}>{children}</div>
      </div>
    </div>
  );
}
