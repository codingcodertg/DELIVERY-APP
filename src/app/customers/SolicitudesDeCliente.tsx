"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/erp/ui/input";
import { cn } from "@/lib/erp/utils";
import type { AlmacenDeClientes } from "@/lib/customers/almacen";
import { contactosDe, enEdicion, type ContactoEnEdicion } from "@/lib/customers/contactos";
import { textoDeValor } from "@/lib/customers/edicion-como-solicitud";
import { CAMPOS_EN_MAYUSCULAS } from "@/lib/customers/formato";
import { redesDe, redesEnEdicion, type RedesEnEdicion } from "@/lib/customers/redes";
import { avisoDeErrores, dondeEstaElError, formDe, nombreDeTienda, type Cliente } from "@/lib/customers/reglas";
import {
  accionesDeSolicitud, cambiosContraLaFila, correccionesDelAdmin, cuentaPorEstado, estadosAVer, ETIQUETA_DE_ESTADO, filaDeSolicitud,
  filtraPorEstado, notaValida, payloadCorregido,
} from "@/lib/customers/revision-de-solicitud";
import { resumenDeSolicitud, type EstadoDeSolicitud, type SolicitudDeCliente } from "@/lib/customers/solicitud-de-cliente";
import { vendedoresEnOrden, type Vendedor } from "@/lib/customers/vendedores";
import { TarjetasDeLaFicha } from "./FichaDeCliente";

type T = (en: string, es: string) => string;

/** La pastilla de estado (`.sema`, blanco sobre su color: `globals.css`). */
const Estado = ({ status, t }: { status: EstadoDeSolicitud; t: T }) => (
  <span className={cn("sema", `sema-sol-${status}`)} data-pastilla-estado={status}>{t(ETIQUETA_DE_ESTADO[status].en, ETIQUETA_DE_ESTADO[status].es)}</span>
);

const Clase = ({ s, t }: { s: SolicitudDeCliente; t: T }) => (
  <span className="text-xs text-slate-600">{s.kind === "edicion" ? `✏️ ${t("Edit", "Edición")}` : `✨ ${t("New", "Nuevo")}`}</span>
);

/** La lista vacía dice por qué: no hay ninguna, o no hay en ese estado (solo texto). */
const vaciaPorEstado = (e: EstadoDeSolicitud, total: number, esAdmin: boolean, t: T) => {
  if (total === 0) return esAdmin ? t("No requests yet. Sales and managers send them from the list.", "Aún no hay solicitudes. Las mandan ventas y gerentes desde la lista.") : t("You haven't requested anything yet.", "Aún no has pedido nada.");
  if (e === "pending") return t("Nothing waiting for a decision.", "Nada esperando decisión.");
  if (e === "review") return t("Nothing sent back to check.", "Nada devuelto para revisar.");
  if (e === "approved") return t("No approved requests.", "Ninguna solicitud aprobada.");
  return t("No denied requests.", "Ninguna solicitud rechazada.");
};

const cuentaDe = (s: SolicitudDeCliente) => (s.kind === "edicion" ? textoDeValor(s.before?.account) : resumenDeSolicitud(s).cuenta);
const tiendasDe = (s: SolicitudDeCliente) => s.stores.map((c) => nombreDeTienda(c)).join(", ");
const enMayusculas = (k: string, v: string) => ((CAMPOS_EN_MAYUSCULAS as readonly string[]).includes(k) ? v.toUpperCase() : v);

/**
 * Las solicitudes de cliente: de alta (D-743, 216) y de edición (D-780, 221). D-865 (242): una FILA por solicitud, con
 * chips por estado (abre en Pendiente), y al pulsarla su tarjeta con la solicitud entera: un alta, agrupada como la ficha;
 * una edición, cada campo con el valor de hoy → lo pedido. En la tarjeta el admin aprueba, rechaza (con nota), la pasa a
 * «Revisar» (con nota) o la corrige antes de aprobar. Vendedor y gerente ven las suyas, solo para leer.
 * Cada decisión la escribe la base con su función; aquí solo se pinta lo que vuelve.
 */
export function SolicitudesDeCliente({ inicial = null, solicitudes, clientes, esAdmin, almacen, onDecidida, onClose, t }: {
  /** D-867: la solicitud que abre el enlace de un aviso (`?solicitud=N`): se abre su tarjeta, en su pestaña. */
  inicial?: number | null;
  solicitudes: readonly SolicitudDeCliente[];
  /** La lista de clientes que ya se leyó: de ahí sale el valor de hoy de una edición. */
  clientes: readonly Cliente[];
  esAdmin: boolean;
  almacen: AlmacenDeClientes;
  /** Tras decidir o corregir: quien llama relee la lista de clientes y las solicitudes. */
  onDecidida: () => void;
  onClose: () => void;
  t: T;
}) {
  const [filtro, setFiltro] = useState<EstadoDeSolicitud>("pending");
  const [abierta, setAbierta] = useState<number | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  // Sin la 242 en la base no hay «Revisar» ni corrección (se esconden); con ella, sí.
  const [revision, setRevision] = useState(false);
  useEffect(() => {
    let vivo = true;
    if (esAdmin) void almacen.revisionDeSolicitudes().then((r) => { if (vivo) setRevision(r); });
    return () => { vivo = false; };
  }, [almacen, esAdmin]);

  // Las solicitudes pueden llegar después de abrir el panel: se abre en cuanto aparece, una sola vez por enlace.
  const [yaAbierta, setYaAbierta] = useState<number | null>(null);
  useEffect(() => {
    if (inicial === null || inicial === yaAbierta) return;
    const una = solicitudes.find((x) => x.id === inicial);
    if (!una) return;
    setYaAbierta(inicial);
    setFiltro(una.status);
    setAbierta(inicial);
  }, [inicial, yaAbierta, solicitudes]);

  const cuentas = useMemo(() => cuentaPorEstado(solicitudes), [solicitudes]);
  const filas = useMemo(() => filtraPorEstado(solicitudes, filtro), [solicitudes, filtro]);
  const s = abierta === null ? null : solicitudes.find((x) => x.id === abierta) ?? null;
  const abre = (id: number) => { setAviso(null); setAbierta(id); };

  return (
    <div className="overlay cli-panel" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-solicitudes-de-cliente>
      <div className="modal" style={{ maxWidth: s ? 1180 : 960 }} role="dialog" aria-modal="true" aria-label={t("Customer requests", "Solicitudes de cliente")}>
        <div className="flex items-start gap-3 border-b border-slate-200 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-slate-900">📝 {t("Customer requests", "Solicitudes de cliente")}</h2>
            <p className="text-xs text-slate-500">
              {esAdmin
                ? t("New customers and edits requested by sales and managers. Click a row to review it.", "Clientes nuevos y ediciones que piden ventas y gerentes. Pulsa una fila para revisarla.")
                : t("What you have requested and how it was decided.", "Lo que has pedido y en qué quedó.")}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded px-2 text-lg text-slate-400 hover:bg-slate-100" aria-label={t("Close", "Cerrar")}>✕</button>
        </div>
        {aviso && <p className={cn("mt-2 rounded-md p-2 text-sm", aviso.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800")} role="status">{aviso.texto}</p>}

        {s ? (
          <TarjetaDeSolicitud
            key={s.id}
            s={s}
            actual={s.customer_id === null ? null : clientes.find((c) => c.id === s.customer_id) ?? null}
            esAdmin={esAdmin}
            revision={revision}
            almacen={almacen}
            onVolver={() => setAbierta(null)}
            onHecho={(texto, cerrar) => { setAviso({ ok: true, texto }); if (cerrar) setAbierta(null); onDecidida(); }}
            onFallo={(texto) => setAviso({ ok: false, texto })}
            t={t}
          />
        ) : (
          <>
            <div className="cli-estados mt-3 flex flex-wrap gap-2" role="group" aria-label={t("Status", "Estado")} data-chips-de-estado>
              {estadosAVer(revision, cuentas).map((e) => (
                <button key={e} type="button" className={cn("chip", e === "pending" && "chip-pend", filtro === e && "on")} onClick={() => setFiltro(e)} data-chip-estado={e} aria-pressed={filtro === e}>
                  {t(ETIQUETA_DE_ESTADO[e].en, ETIQUETA_DE_ESTADO[e].es)}<span className="cnt">{cuentas[e]}</span>
                </button>
              ))}
            </div>
            <div className="tbl-scroll mt-3 max-h-[60vh]">
              <table className="orders" style={{ minWidth: 640 }} data-tabla-de-solicitudes>
                <thead>
                  <tr>
                    <th>{t("Type", "Clase")}</th>
                    <th>{t("Account", "Cuenta")}</th>
                    <th>{t("Store", "Tienda")}</th>
                    <th>{t("Requested by", "Pidió")}</th>
                    <th>{t("Date", "Fecha")}</th>
                    <th>{t("Status", "Estado")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((x) => (
                    <tr key={x.id} className="clickable" onClick={() => abre(x.id)} data-solicitud={x.id} data-estado={x.status} data-clase={x.kind}
                      tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abre(x.id); } }}>
                      <td><Clase s={x} t={t} /></td>
                      <td className="font-medium text-slate-900">{cuentaDe(x)}</td>
                      <td>{tiendasDe(x)}</td>
                      <td>{x.requested_name ?? x.requested_by.slice(0, 8)}</td>
                      <td className="tabular-nums">{x.created_at.slice(0, 10)}</td>
                      <td><Estado status={x.status} t={t} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filas.length === 0 && <p className="py-6 text-center text-sm text-slate-500" data-cli-vacia>{vaciaPorEstado(filtro, solicitudes.length, esAdmin, t)}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** La tarjeta de una solicitud: todo lo pedido y, para el admin, las acciones y la corrección. */
function TarjetaDeSolicitud({ s, actual, esAdmin, revision, almacen, onVolver, onHecho, onFallo, t }: {
  s: SolicitudDeCliente;
  actual: Cliente | null;
  esAdmin: boolean;
  revision: boolean;
  almacen: AlmacenDeClientes;
  onVolver: () => void;
  onHecho: (texto: string, cerrar: boolean) => void;
  onFallo: (texto: string) => void;
  t: T;
}) {
  const edicion = s.kind === "edicion";
  const acciones = accionesDeSolicitud(s.status, { esAdmin, revision });
  const fila = useMemo(() => filaDeSolicitud(s, actual), [s, actual]);
  const cambios = useMemo(() => (edicion ? cambiosContraLaFila(s, actual) : []), [edicion, s, actual]);
  const corregidas = useMemo(() => correccionesDelAdmin(s), [s]);
  const [nota, setNota] = useState("");
  const [ocupada, setOcupada] = useState(false);

  // Corregir: el formulario de la ficha sobre lo pedido.
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [contactos, setContactos] = useState<ContactoEnEdicion[]>([]);
  const [redes, setRedes] = useState<RedesEnEdicion>(() => redesEnEdicion({}));
  const [contactoElegido, setContactoElegido] = useState(0);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const empiezaACorregir = () => {
    setForm(formDe(fila));
    setContactos(enEdicion(contactosDe(fila)));
    setRedes(redesEnEdicion(redesDe(fila)));
    setContactoElegido(0);
    setCorrigiendo(true);
    if (!vendedores.length) void almacen.vendedores().then((r) => { if (r.ok) setVendedores(vendedoresEnOrden(r.valor)); });
  };
  const correccion = useMemo(() => (corrigiendo ? payloadCorregido(s, actual, form, contactos, redes) : null), [corrigiendo, s, actual, form, contactos, redes]);
  const errores = correccion?.errores ?? [];
  const textoDeErrores = errores.includes("nada")
    ? t("Nothing would change on the customer: undo a correction or deny the request.", "Nada cambiaría en el cliente: deshaz alguna corrección o rechaza la solicitud.")
    : errores.length ? avisoDeErrores(errores, t) : "";

  const corre = async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, prefijo: [string, string], hecho: string) => {
    setOcupada(true);
    const r = await fn();
    setOcupada(false);
    if (!r.ok) { onFallo(t(prefijo[0], prefijo[1]) + r.error); return; }
    onHecho(hecho, true);
  };
  /** Guarda la corrección en la solicitud (242). Sin cambios no escribe nada. */
  const guardaCorreccion = async (): Promise<boolean> => {
    if (!correccion || correccion.errores.length) return false;
    if (!correccion.cambiado) return true;
    setOcupada(true);
    const r = await almacen.corregirSolicitud(s.id, correccion.payload);
    setOcupada(false);
    if (!r.ok) { onFallo(t("Corrections not saved: ", "No se guardó la corrección: ") + r.error); return false; }
    return true;
  };
  const aprobar = async () => {
    if (corrigiendo && !(await guardaCorreccion())) return;
    if (edicion) {
      await corre(() => almacen.aprobarEdicion(s.id, nota), ["Not approved: ", "No se aprobó: "], t("Approved ✓ The customer was updated.", "Aprobada ✓ El cliente quedó actualizado."));
      return;
    }
    setOcupada(true);
    const r = await almacen.aprobarSolicitud(s.id);
    setOcupada(false);
    if (!r.ok) { onFallo(t("Not approved: ", "No se aprobó: ") + r.error); return; }
    onHecho(t(`Approved ✓ ${r.valor.length} customer row(s) created.`, `Aprobada ✓ ${r.valor.length} fila(s) de cliente creadas.`), true);
  };
  const rechazar = () => corre(() => almacen.rechazarSolicitud(s.id, nota.trim()), ["Not denied: ", "No se rechazó: "], t("Denied. The requester sees your note.", "Rechazada. Quien la pidió ve tu nota."));
  const revisar = () => corre(() => almacen.revisarSolicitud(s.id, nota.trim()), ["Not moved: ", "No se movió: "], t("Moved to Needs check.", "Pasada a Revisar."));
  const guardarSolo = async () => {
    if (await guardaCorreccion()) { setCorrigiendo(false); onHecho(t("Corrections saved on the request ✓", "Corrección guardada en la solicitud ✓"), false); }
  };

  const conNota = notaValida(nota);
  const hayAcciones = acciones.aprobar || acciones.rechazar || acciones.revisar;

  return (
    <div className="mt-3 space-y-4" data-tarjeta-de-solicitud={s.id} data-estado={s.status} data-clase={s.kind}>
      {/* Cabecera: volver, la cuenta (editable al corregir un alta) y sus pastillas. */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onVolver} data-volver-a-la-lista>← {t("All requests", "Todas las solicitudes")}</button>
        <Clase s={s} t={t} />
        {corrigiendo && !edicion ? (
          <Input className={cn("h-9 max-w-80 font-semibold", errores.includes("account") && "border-red-400 ring-1 ring-red-300")} value={form.account ?? ""} aria-label={t("Account", "Cuenta")}
            onChange={(e) => { const v = enMayusculas("account", e.target.value); setForm((f) => ({ ...f, account: v })); }} data-corregir-cuenta />
        ) : (
          <h3 className="text-lg font-semibold text-slate-900">{edicion ? cuentaDe(s) : fila.account || "—"}</h3>
        )}
        <span className="text-sm text-slate-600">{tiendasDe(s)}</span>
        <Estado status={s.status} t={t} />
        <span className="ml-auto text-xs text-slate-500">#{s.id} · {s.requested_name ?? s.requested_by.slice(0, 8)} · {s.created_at.slice(0, 10)}</span>
      </div>

      {/* Las notas: por qué se pidió, qué hay que revisar, qué decidió el admin, qué corrigió. */}
      {(s.note || s.review_note || s.decision_note || corregidas.length > 0) && (
        <div className="space-y-1 text-sm">
          {s.note && <p className="text-slate-700">📝 {t("Why", "Por qué")}: {s.note}</p>}
          {s.review_note && <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900" data-nota-de-revision>⚠️ {t("To check", "Por revisar")}: {s.review_note}</p>}
          {s.decision_note && <p className="text-slate-700">🗒️ {t("Admin", "Admin")}: {s.decision_note}</p>}
          {corregidas.length > 0 && (
            <p className="text-xs text-slate-500" data-correcciones-del-admin>
              ✏️ {t("Corrected by the admin", "Corregida por el admin")}: {corregidas.map((c) => `${t(c.en, c.es)}: ${c.antes} → ${c.despues}`).join(" · ")}
            </p>
          )}
        </div>
      )}

      {/* Una edición: valor de hoy → lo pedido. */}
      {edicion && !corrigiendo && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-cambios-pedidos>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("Requested changes", "Cambios pedidos")}</h4>
          <div className="tbl-scroll">
            <table className="orders" style={{ minWidth: 0 }}>
              <thead><tr><th>{t("Field", "Campo")}</th><th>{t("Current", "Ahora")}</th><th>{t("Requested", "Pedido")}</th></tr></thead>
              <tbody>
                {cambios.map((c) => (
                  <tr key={c.key} data-cambio={c.key}>
                    <td className="text-slate-500">{t(c.en, c.es)}</td>
                    <td className="whitespace-normal text-slate-500">{c.antes}{c.desfasado && <span className="ml-1 text-xs text-amber-700" title={t("Changed since it was requested", "Cambió desde que se pidió")}>⚠️</span>}</td>
                    <td className="whitespace-normal font-semibold text-slate-900">{c.despues}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!actual && <p className="mt-2 text-xs text-slate-500">{t("The customer row is not in this list: «Current» is what the requester saw.", "La fila del cliente no está en esta lista: «Ahora» es lo que vio quien pidió.")}</p>}
        </section>
      )}

      {/* Un alta, o cualquiera al corregir: las tarjetas de la ficha. */}
      {(corrigiendo || !edicion) && (
        <div data-ficha-de-solicitud>
          <TarjetasDeLaFicha
            cliente={fila}
            form={corrigiendo ? form : undefined}
            editando={corrigiendo}
            errores={errores}
            onCampo={(k, v) => setForm((f) => ({ ...f, [k]: v }))}
            contactos={corrigiendo ? contactos : undefined}
            onContactos={setContactos}
            contactoElegido={contactoElegido}
            onEligeContacto={setContactoElegido}
            redes={corrigiendo ? redes : undefined}
            onRedes={setRedes}
            vendedores={vendedores}
            t={t}
          />
        </div>
      )}

      {corrigiendo && correccion && (correccion.faltan.length > 0 || textoDeErrores) && (
        <div className="space-y-1 text-sm">
          {textoDeErrores && <p className="rounded-md bg-red-50 p-2 text-red-800" role="alert" data-errores-de-correccion>{textoDeErrores}</p>}
          {correccion.faltan.length > 0 && (
            <p className="rounded-md bg-amber-50 p-2 text-amber-900" data-faltan>
              {t("Still missing for a complete customer: ", "Aún falta para un cliente completo: ")}{[...new Set(correccion.faltan.map((k) => dondeEstaElError(k, t)))].join(" · ")}
            </p>
          )}
        </div>
      )}

      {/* Las acciones del admin. */}
      {hayAcciones && (
        <div className="space-y-2 border-t border-slate-200 pt-3" data-acciones-de-solicitud>
          {!corrigiendo && (
            <label className="block space-y-1">
              <span className="text-xs text-slate-600">{t("Note for the requester (required to deny or send to Needs check)", "Nota para quien lo pidió (obligatoria para rechazar o pasar a Revisar)")}</span>
              <textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm" data-nota-de-decision />
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {corrigiendo ? (
              <>
                <button type="button" className="btn btn-green" disabled={ocupada || errores.length > 0} onClick={() => void aprobar()} data-guardar-y-aprobar>✓ {t("Save & approve", "Guardar y aprobar")}</button>
                <button type="button" className="btn btn-primary" disabled={ocupada || errores.length > 0 || !correccion?.cambiado} onClick={() => void guardarSolo()} data-guardar-correccion>💾 {t("Save corrections", "Guardar corrección")}</button>
                <button type="button" className="btn btn-ghost" disabled={ocupada} onClick={() => setCorrigiendo(false)} data-cancelar-correccion>{t("Cancel", "Cancelar")}</button>
              </>
            ) : (
              <>
                {acciones.aprobar && <button type="button" className="btn btn-green" disabled={ocupada} onClick={() => void aprobar()} data-aprobar={s.id}>{ocupada ? "…" : `✓ ${t("Approve", "Aprobar")}`}</button>}
                {acciones.revisar && <button type="button" className="btn btn-amber" disabled={ocupada || !conNota} onClick={() => void revisar()} data-pedir-revisar={s.id} title={conNota ? undefined : t("Write what must be checked", "Escribe qué hay que comprobar")}>⚠️ {t("Needs check", "Revisar")}</button>}
                {acciones.rechazar && <button type="button" className="btn btn-danger" disabled={ocupada || !conNota} onClick={() => void rechazar()} data-confirmar-rechazo={s.id} title={conNota ? undefined : t("Write a note for the requester", "Escribe una nota para quien lo pidió")}>✕ {t("Deny", "Rechazar")}</button>}
                {acciones.corregir && <button type="button" className="btn btn-ghost ml-auto" disabled={ocupada} onClick={empiezaACorregir} data-corregir={s.id}>✏️ {t("Correct before approving", "Corregir antes de aprobar")}</button>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
