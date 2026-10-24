"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/erp/ui/badge";
import { Button } from "@/components/erp/ui/button";
import { Input } from "@/components/erp/ui/input";
import { cn } from "@/lib/erp/utils";
import type { AlmacenDeClientes } from "@/lib/customers/almacen";
import { CAMPOS_EN_MAYUSCULAS } from "@/lib/customers/formato";
import { MOLDE_DEL_TELEFONO, telefonoAlEscribir, telefonoParaVer } from "@/lib/telefono-de-la-orden";
import {
  cierraLaFicha, ESTADOS, estadoClase, estadoLabel, estaArchivado, fecha, filasOcultas, filasPorGrupo, formDe, GRUPO_OCULTO, HISTORIAS, historiaLabel, mailUrl,
  MOTIVOS_DE_ARCHIVO, motivoLabel, nombreDeTienda, PARCHE_DESARCHIVAR, parcheArchivar, parcheDe, QB_ESTADOS, qbLabel,
  telUrl, textoDeFila, TIENDAS,
  type Campo, type Cliente, type FilaDeFicha,
} from "@/lib/customers/reglas";

type T = (en: string, es: string) => string;

export const selCls =
  "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500";

/** Los nombres (cuenta, contacto, cargo…) salen en MAYÚSCULAS según se escriben (D-635). */
const enMayusculas = (k: string, v: string) => ((CAMPOS_EN_MAYUSCULAS as readonly string[]).includes(k) ? v.toUpperCase() : v);

/**
 * Las tarjetas de la ficha (D-634): el cascarón de la ficha de un artículo del ERP (secciones en tarjetas, filas
 * «etiqueta / valor»), con todos los campos por grupo (`filasPorGrupo`). Las pintan la ventana de la lista y la página
 * `/customers/[id]`. Con `editando`, cada campo que se corrige es su control; House # y la CONCATENATE se leen siempre.
 * Sin `cliente` (un alta) no hay nada que leer: solo salen los controles.
 *
 * Debajo, «🔒 Campos ocultos» (D-660): Añadido (tanda), N.º House y la CONCATENATE, en un `<details>` que abre
 * PLEGADO. Editando, «Añadido (tanda)» se corrige ahí dentro.
 */
export function TarjetasDeLaFicha({ cliente, form, editando = false, errores = [], onCampo, t }: {
  cliente: Cliente | null;
  form?: Record<string, string>;
  editando?: boolean;
  errores?: string[];
  onCampo?: (k: string, v: string) => void;
  t: T;
}) {
  const linea = (fila: FilaDeFicha) => {
    if (editando && fila.campo && form && onCampo) {
      return (
        <label key={fila.key} className="block space-y-1 py-1.5" data-campo={fila.key}>
          <span className="text-xs text-slate-500">{t(fila.en, fila.es)}</span>
          <ControlDeCampo campo={fila.campo} valor={form[fila.key] ?? ""} mal={errores.includes(fila.key)} onCambia={(v) => onCampo(fila.key, v)} t={t} />
        </label>
      );
    }
    if (!cliente) return null;
    return (
      <div key={fila.key} className="flex justify-between gap-4 border-b border-slate-100 py-1.5 text-sm last:border-0" data-campo={fila.key}>
        <span className="text-slate-500">{t(fila.en, fila.es)}</span>
        <span className={cn("whitespace-pre-wrap text-right text-slate-900", fila.key === "concatenate" ? "font-mono" : "font-medium")}>{textoDeFila(cliente, fila, t)}</span>
      </div>
    );
  };
  const ocultas = filasOcultas().map(linea).filter((x) => x !== null);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filasPorGrupo().map(({ grupo, filas }) => (
          <section key={grupo.key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-grupo={grupo.key}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t(grupo.en, grupo.es)}</h2>
            {filas.map(linea)}
          </section>
        ))}
      </div>
      {/* D-660: «this was supposed to go into another like a hidden field in customer». Sin `open`: abre plegado. */}
      {ocultas.length > 0 && (
        <details className="group rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-5 py-3" data-campos-ocultos>
          <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700">
            🔒 {t(GRUPO_OCULTO.en, GRUPO_OCULTO.es)}
          </summary>
          <div className="mt-2 max-w-xl" data-grupo={GRUPO_OCULTO.key}>{ocultas}</div>
        </details>
      )}
    </div>
  );
}

/** El control de un campo, según su tipo: los cerrados en desplegable, el teléfono con su molde, los nombres en MAYÚSCULAS. */
function ControlDeCampo({ campo: f, valor, mal, onCambia, t }: { campo: Campo; valor: string; mal: boolean; onCambia: (v: string) => void; t: T }) {
  // La tienda no sale aquí: es de la cabecera y se cambia en las pastillas de tiendas (`selectorDeTienda`).
  const marca = cn(mal && "border-red-400 ring-1 ring-red-300");
  if (f.tipo === "estado") {
    return (
      <select className={cn(selCls, "w-full")} value={valor} onChange={(e) => onCambia(e.target.value)}>
        <option value="">{estadoLabel(null, t)}</option>
        {ESTADOS.map((e) => <option key={e} value={e}>{estadoLabel(e, t)}</option>)}
      </select>
    );
  }
  if (f.tipo === "historia") {
    return (
      <select className={cn(selCls, "w-full")} value={valor} onChange={(e) => onCambia(e.target.value)}>
        <option value="">—</option>
        {HISTORIAS.map((h) => <option key={h} value={h}>{historiaLabel(h, t)}</option>)}
      </select>
    );
  }
  if (f.tipo === "qb") {
    return (
      <select className={cn(selCls, "w-full")} value={valor} onChange={(e) => onCambia(e.target.value)}>
        <option value="">—</option>
        {QB_ESTADOS.map((q) => <option key={q} value={q}>{qbLabel(q, t)}</option>)}
      </select>
    );
  }
  if (f.tipo === "textarea") {
    return (
      <textarea
        rows={3}
        value={valor}
        onChange={(e) => onCambia(e.target.value)}
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
      />
    );
  }
  if (f.key === "phone") {
    // D-635: como el teléfono de la orden de Entregas (D-630): solo números, y el formato se pone solo.
    return (
      <Input value={telefonoParaVer(valor)} onChange={(e) => onCambia(telefonoAlEscribir(e.target.value))} type="tel" inputMode="numeric" placeholder={MOLDE_DEL_TELEFONO} className={marca} />
    );
  }
  return (
    <Input
      value={valor}
      // D-635: los nombres salen en MAYÚSCULAS según se escriben.
      onChange={(e) => onCambia(enMayusculas(f.key, e.target.value))}
      inputMode={f.tipo === "num" ? "decimal" : undefined}
      className={marca}
    />
  );
}

/**
 * La ficha de un cliente en una VENTANA centrada, como la de una orden en Entregas (D-654). El dueño: «cuando uno le da
 * clic al cliente […] abre ese side window por al lado, y eso no me sirve. Yo ocupo que, así como en el delivery app, se
 * abra un window, así como un form, que uno solo puede dar afuera y exit out, y ya me dé la ficha completa». Sustituye
 * al cajón lateral: dentro van las tarjetas de la página `/customers/[id]` (`TarjetasDeLaFicha`), y quien puede editar
 * pulsa «✏️ Editar» y las tarjetas pasan a controles; guarda con su botón (no al vuelo: una lista maestra se corrige con
 * intención). Se cierra con un clic fuera, con ✕ y con Escape; con cambios sin guardar, pregunta antes.
 *
 * Arriba va el NOMBRE de la cuenta y su estado, no «tienda · tienda+cuenta» (el dueño: «dice RDC McAllen y después […]
 * como un ID»); la tienda se ve en las pastillas de tiendas, y ahí se cambia. Ni «Cuenta» ni «Tienda» se repiten abajo.
 * `cliente` null = alta.
 */
export function FichaEnVentana({ cliente, hermanas, onCambia, puedeEditar, almacen, onClose, onGuardado, editarAlAbrir = false, t }: {
  cliente: Cliente | null;
  /** Las filas de la misma empresa (189), una por tienda, en orden: las pestañas. */
  hermanas: Cliente[];
  onCambia: (c: Cliente) => void;
  puedeEditar: boolean; almacen: AlmacenDeClientes; onClose: () => void; onGuardado: (c: Cliente) => void;
  /** «✏️ Editar» de la página del cliente (D-648) llega aquí: la ventana abre ya editando. */
  editarAlAbrir?: boolean;
  t: T;
}) {
  const nuevo = cliente === null;
  const original = useMemo(() => formDe(cliente), [cliente]);
  const [form, setForm] = useState<Record<string, string>>(original);
  useEffect(() => { setForm(original); }, [original]);
  const [editando, setEditando] = useState(puedeEditar && (nuevo || editarAlAbrir));
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tono: "rojo" | "verde"; texto: string } | null>(null);
  const { parche, errores } = useMemo(() => parcheDe(form, original, nuevo), [form, original, nuevo]);
  const cambiado = Object.keys(parche).length > 0;

  // Archivar (181): se pide el motivo en la propia ficha (uno de los del script, o escrito), y se escribe por el mismo
  // almacén que todo lo demás: la fila vuelve de la base y es lo que se pinta.
  const archivado = cliente !== null && estaArchivado(cliente);
  const [archivando, setArchivando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [motivoLibre, setMotivoLibre] = useState("");
  useEffect(() => { setArchivando(false); setMotivo(""); setMotivoLibre(""); }, [cliente]);

  // Cerrar: un clic fuera, ✕ o Escape. Con algo escrito sin guardar se pregunta: un clic fuera sin querer no lo tira.
  const cambiadoRef = useRef(cambiado);
  cambiadoRef.current = cambiado;
  const pedirCierre = () => {
    if (cambiadoRef.current && !window.confirm(t("Close without saving your changes?", "¿Cerrar sin guardar los cambios?"))) return;
    onClose();
  };
  const pedirCierreRef = useRef(pedirCierre);
  pedirCierreRef.current = pedirCierre;
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => { if (!e.defaultPrevented && cierraLaFicha({ tecla: e.key })) pedirCierreRef.current(); };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, []);
  // Como la ficha de la orden: el clic de fuera solo cierra si EMPEZÓ fuera (soltar un arrastre encima no cierra).
  const fueraRef = useRef(false);

  /** Escribe y pinta lo que devolvió la base; en rojo lo que no se guardó. */
  const aplicar = async (escritura: () => ReturnType<AlmacenDeClientes["guardar"]>, hecho: string): Promise<boolean> => {
    setOcupado(true);
    setAviso(null);
    const r = await escritura();
    setOcupado(false);
    if (!r.ok) {
      setAviso({
        tono: "rojo",
        texto: r.duplicado
          ? t("That account already exists in that store.", "Esa cuenta ya existe en esa tienda.")
          : r.sinPermiso
            ? t("Not saved: the database did not accept the change (no permission).", "No se guardó: la base no aceptó el cambio (sin permiso).")
            : t("Not saved: ", "No se guardó: ") + r.error,
      });
      return false;
    }
    setAviso({ tono: "verde", texto: hecho });
    onGuardado(r.valor);
    return true;
  };

  const guardar = async () => {
    if (errores.length) { setAviso({ tono: "rojo", texto: t("Check the highlighted fields.", "Revisa los campos marcados.") }); return; }
    if (await aplicar(() => (nuevo ? almacen.crear(parche) : almacen.guardar(cliente.id, parche)), t("Saved ✓", "Guardado ✓"))) setEditando(false);
  };
  const cancelar = () => {
    if (nuevo) { pedirCierre(); return; }
    setForm(original);
    setEditando(false);
    setAviso(null);
  };
  const archivar = async () => {
    if (nuevo) return;
    await aplicar(() => almacen.guardar(cliente.id, parcheArchivar(motivo === "otro" ? motivoLibre : motivo)), t("Archived ✓", "Archivado ✓"));
    setArchivando(false);
  };
  const desarchivar = async () => {
    if (nuevo) return;
    await aplicar(() => almacen.guardar(cliente.id, PARCHE_DESARCHIVAR), t("Restored ✓", "Desarchivado ✓"));
  };
  // Separar (189): esta fila deja la empresa y pasa a ser la suya propia (otra clave). Las demás no se tocan.
  const separar = async () => {
    if (nuevo) return;
    await aplicar(() => almacen.guardar(cliente.id, { company_id: crypto.randomUUID() }), t("Split ✓", "Separada ✓"));
  };

  const campo = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const tel = telUrl(form.phone ?? null);
  const mail = mailUrl(form.email ?? null);
  const tiendas = nuevo ? [] : hermanas.length > 0 ? hermanas : [cliente];

  // La tienda de esta fila, para cambiarla: en las pastillas, en el sitio de la suya (D-654: ya no hay campo «Tienda» abajo).
  const selectorDeTienda = (
    <select
      className={cn(selCls, "h-8 rounded-full text-xs", errores.includes("store") && "border-red-400 ring-1 ring-red-300")}
      value={form.store ?? ""}
      onChange={(e) => campo("store", e.target.value)}
      aria-label={t("Store of this row", "Tienda de esta fila")}
      data-tienda-de-la-fila
    >
      <option value="">{nuevo ? t("Store *", "Tienda *") : "—"}</option>
      {TIENDAS.map((x) => <option key={x.code} value={x.code}>{x.nombre} ({x.code})</option>)}
      {form.store && !TIENDAS.some((x) => x.code === form.store) && <option value={form.store}>{form.store}</option>}
    </select>
  );

  return (
    <div
      className="overlay"
      data-ficha-de-cliente
      onMouseDown={(e) => { fueraRef.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (cierraLaFicha({ clicEnElFondo: e.target === e.currentTarget, empezoEnElFondo: fueraRef.current })) pedirCierre(); }}
    >
      <div className="modal" style={{ maxWidth: 1100 }} role="dialog" aria-modal="true"
        aria-label={nuevo ? t("New customer", "Nuevo cliente") : cliente.account}>
        <div className="flex items-start gap-3 border-b border-slate-200 pb-3">
          <div className="min-w-0 flex-1">
            {editando ? (
              // El nombre se corrige aquí, en su sitio (D-654: ya no hay campo «Cuenta» abajo).
              <Input
                value={form.account ?? ""}
                onChange={(e) => campo("account", enMayusculas("account", e.target.value))}
                placeholder={t("Account name *", "Nombre de la cuenta *")}
                aria-label={t("Account", "Cuenta")}
                data-nombre-editable
                className={cn("h-10 text-lg font-semibold", errores.includes("account") && "border-red-400 ring-1 ring-red-300")}
              />
            ) : (
              <h2 className="break-words text-xl font-semibold text-slate-900" data-nombre-de-la-cuenta>{cliente?.account}</h2>
            )}
            {!nuevo && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Badge className={estadoClase(cliente.status_store)}>{estadoLabel(cliente.status_store, t)}</Badge>
                {archivado && (
                  <Badge className="border-slate-200 bg-slate-100 text-slate-500">{t("Archived", "Archivado")} · {motivoLabel(cliente.archived_reason, t)}</Badge>
                )}
                <span className="text-xs text-slate-400">{t("updated", "actualizado")} {fecha(cliente.updated_at)}</span>
              </div>
            )}
          </div>
          {puedeEditar && !editando && (
            <Button size="sm" onClick={() => { setEditando(true); setAviso(null); }} data-editar-en-la-ventana>✏️ {t("Edit", "Editar")}</Button>
          )}
          <button type="button" onClick={pedirCierre} className="rounded-md px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100" aria-label={t("Close", "Cerrar")} data-cerrar-ficha>✕</button>
        </div>

        {/* Las tiendas de la empresa (189): cada pestaña es la fila de esa tienda, con su contacto, su vendedor y su CRM. Con
            una sola, su pastilla: es donde se ve la tienda. Editando, la de esta fila es su desplegable. */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 py-2" role="tablist" aria-label={t("Stores of this company", "Tiendas de esta empresa")} data-tiendas={tiendas.length}>
          {nuevo && editando && selectorDeTienda}
          {!nuevo && tiendas.map((h) => {
            const repetida = tiendas.filter((x) => x.store === h.store).length > 1;
            if (h.id === cliente.id && editando) return <span key={h.id}>{selectorDeTienda}</span>;
            return (
              <button
                key={h.id}
                type="button"
                role="tab"
                aria-selected={h.id === cliente.id}
                disabled={h.id !== cliente.id && cambiado}
                title={h.id !== cliente.id && cambiado ? t("Save or undo your changes first", "Guarda o deshaz los cambios primero") : h.account}
                onClick={() => { if (h.id !== cliente.id) onCambia(h); }}
                className={cn("rounded-full border px-3 py-1 text-xs disabled:opacity-50", h.id === cliente.id ? "border-clay-200 bg-clay-50 font-medium text-clay-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}
              >
                {nombreDeTienda(h.store)}{repetida ? ` · ${h.account}` : ""}
              </button>
            );
          })}
          {!nuevo && (tel || mail) && (
            <span className="flex flex-wrap gap-3 px-1 text-sm">
              {tel && <a href={tel} className="text-clay-600 hover:underline">📞 {form.phone}</a>}
              {mail && <a href={mail} className="text-clay-600 hover:underline">✉️ {form.email}</a>}
            </span>
          )}
          {puedeEditar && !nuevo && tiendas.length > 1 && (
            <Button variant="ghost" size="sm" className="ml-auto text-xs text-slate-500" onClick={separar} disabled={ocupado || cambiado}
              title={t("This store's row stops being part of this company (nothing is deleted)", "La fila de esta tienda deja de ser de esta empresa (no se borra nada)")}>
              {t("Split from company", "Separar de la empresa")}
            </Button>
          )}
        </div>

        <div className="space-y-3 pt-3">
          {archivado && (
            <p className="rounded-md border border-slate-200 bg-slate-100 p-2 text-xs text-slate-600">
              <span className="font-medium">{t("Archived", "Archivado")}</span> {fecha(cliente.archived_at)} · {motivoLabel(cliente.archived_reason, t)}
              {" — "}{t("hidden from the list; not a customer. It can be restored.", "escondido de la lista; no es un cliente. Se puede desarchivar.")}
            </p>
          )}
          {!puedeEditar && (
            <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-500">
              {t("Read-only — admins and managers can edit.", "Solo lectura — editan los admins y los managers.")}
            </p>
          )}
          <TarjetasDeLaFicha cliente={cliente} form={form} editando={editando} errores={errores} onCampo={campo} t={t} />
        </div>

        {puedeEditar && !nuevo && archivando && (
          <div className="mt-3 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <label className="block space-y-1">
              <span className="text-xs text-slate-500">{t("Why is it archived?", "¿Por qué se archiva?")}</span>
              <select className={cn(selCls, "w-full")} value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label={t("Reason", "Motivo")}>
                <option value="">{t("Choose a reason…", "Elige un motivo…")}</option>
                {MOTIVOS_DE_ARCHIVO.map((m) => <option key={m} value={m}>{motivoLabel(m, t)}</option>)}
                <option value="otro">{t("Other (write it)", "Otro (escríbelo)")}</option>
              </select>
            </label>
            {motivo === "otro" && (
              <Input value={motivoLibre} onChange={(e) => setMotivoLibre(e.target.value)} placeholder={t("Reason", "Motivo")} />
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setArchivando(false)}>{t("Cancel", "Cancelar")}</Button>
              <Button size="sm" onClick={archivar} disabled={ocupado || motivo === "" || (motivo === "otro" && motivoLibre.trim() === "")}>
                {ocupado ? t("Saving…", "Guardando…") : t("Archive", "Archivar")}
              </Button>
            </div>
          </div>
        )}
        {(puedeEditar || aviso) && (
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-3" data-acciones-de-la-ficha>
            {puedeEditar && !nuevo && (archivado ? (
              <Button variant="ghost" className="mr-auto" onClick={desarchivar} disabled={ocupado || editando}>{t("Restore", "Desarchivar")}</Button>
            ) : (
              <Button variant="ghost" className="mr-auto text-slate-500" onClick={() => setArchivando(true)} disabled={ocupado || archivando || editando}>{t("Archive…", "Archivar…")}</Button>
            ))}
            {aviso && <span className={cn("text-sm", aviso.tono === "verde" ? "text-emerald-600" : "text-red-600")} role="status">{aviso.texto}</span>}
            {editando && (
              <>
                <Button variant="outline" onClick={cancelar} disabled={ocupado}>{t("Cancel", "Cancelar")}</Button>
                <Button onClick={guardar} disabled={ocupado || !cambiado} data-guardar-ficha>
                  {ocupado ? t("Saving…", "Guardando…") : nuevo ? t("Create", "Crear") : t("Save", "Guardar")}
                </Button>
              </>
            )}
          </div>
        )}
        {/* La burbuja de Ayuda va fija abajo a la derecha, por encima de todo, y por debajo de 1400 px cae encima de la
            ventana: tapaba «Guardar» en el teléfono (medido a 390 px). Este hueco (el de D-530) deja que lo último suba por
            encima de ella. Es un elemento y no un relleno: el `.modal` del teléfono fija su `padding` y ganaba. */}
        <div aria-hidden className="h-[var(--hueco-de-ayuda)] min-[1400px]:hidden" data-hueco-de-ayuda />
      </div>
    </div>
  );
}
