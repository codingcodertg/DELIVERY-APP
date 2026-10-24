"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/erp/ui/badge";
import { Button } from "@/components/erp/ui/button";
import { Input } from "@/components/erp/ui/input";
import { cn } from "@/lib/erp/utils";
import { avisoDeNoCreadas, filaQueSeEnsena, filasDelAlta, tiendasDelAlta } from "@/lib/customers/alta";
import type { AlmacenDeClientes, Res } from "@/lib/customers/almacen";
import { coincidenciasDe, motivoDeCoincidenciaLabel, type Borrador } from "@/lib/customers/coincidencias";
import {
  contactosDe, contactoVacio, enEdicion, erroresDeContactos, parcheDeContactos, repartoDePastillas, rotuloDeContacto, textoDeCorreos,
  textoDeTelefonos, type Contacto, type ContactoEnEdicion,
} from "@/lib/customers/contactos";
import { claveDeEmpresa } from "@/lib/customers/duplicados";
import { CAMPOS_EN_MAYUSCULAS } from "@/lib/customers/formato";
import { useCierraAlSalir } from "@/lib/menu-desplegable";
import { rcCall } from "@/lib/recruiting/utils";
import { MOLDE_DEL_TELEFONO, telefonoAlEscribir, telefonoParaVer } from "@/lib/telefono-de-la-orden";
import {
  cierraLaFicha, ESTADOS, estadoClase, estadoLabel, estaArchivado, fecha, filasOcultas, filasPorGrupo, formDe, GRUPO_OCULTO, HISTORIAS, historiaLabel,
  MOTIVOS_DE_ARCHIVO, motivoLabel, nombreDeTienda, PARCHE_DESARCHIVAR, parcheArchivar, parcheDe, QB_ESTADOS, qbLabel,
  textoDeFila, TIENDAS,
  type Campo, type Cliente, type FilaDeFicha,
} from "@/lib/customers/reglas";

type T = (en: string, es: string) => string;

export const selCls =
  "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500";

/** D-665: cuánto se espera tras la última tecla para buscar duplicados, y cuántas coincidencias se enseñan. */
const RETARDO_DEL_AVISO_MS = 350;
const MAX_COINCIDENCIAS = 3;

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
 *
 * La tarjeta «Contacto» abre con los contactos (D-668): leyendo, una pastilla por contacto (`ContactosParaVer`);
 * editando, la lista que se escribe (`contactos`, `ContactosParaEditar`). Debajo, la dirección.
 */
export function TarjetasDeLaFicha({ cliente, form, editando = false, errores = [], onCampo, contactos, onContactos, t }: {
  cliente: Cliente | null;
  form?: Record<string, string>;
  editando?: boolean;
  errores?: string[];
  onCampo?: (k: string, v: string) => void;
  /** Los contactos mientras se editan, y quién los cambia. Sin ellos, la tarjeta enseña los de `cliente`. */
  contactos?: ContactoEnEdicion[];
  onContactos?: (c: ContactoEnEdicion[]) => void;
  t: T;
}) {
  const deLaFila = useMemo(() => contactosDe(cliente), [cliente]);
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
            {grupo.key === "contacto" && (editando && contactos && onContactos
              ? <ContactosParaEditar contactos={contactos} errores={errores} onCambia={onContactos} t={t} />
              : cliente && <ContactosParaVer key={cliente.id} contactos={deLaFila} t={t} />)}
            {filas.map(linea)}
          </section>
        ))}
        {/* D-660: «this was supposed to go into another like a hidden field in customer». Sin `open`: abre plegado. Desde
            D-662 va DENTRO de la rejilla, en el sitio de la sexta tarjeta (la de «Remove» de la plantilla del dueño). */}
        {ocultas.length > 0 && (
          <details className="group self-start rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-5 py-3" data-campos-ocultos>
            <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700">
              🔒 {t(GRUPO_OCULTO.en, GRUPO_OCULTO.es)}
            </summary>
            <div className="mt-2" data-grupo={GRUPO_OCULTO.key}>{ocultas}</div>
          </details>
        )}
      </div>
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

/** D-635: el teléfono como el de la orden de Entregas (D-630): solo números, y el formato se pone solo. */
function EntradaDeTelefono({ valor, mal, onCambia, ...resto }: { valor: string; mal?: boolean; onCambia: (v: string) => void } & Record<`data-${string}`, string | number>) {
  return (
    <Input value={telefonoParaVer(valor)} onChange={(e) => onCambia(telefonoAlEscribir(e.target.value))} type="tel" inputMode="numeric" placeholder={MOLDE_DEL_TELEFONO} className={cn(mal && "border-red-400 ring-1 ring-red-300")} {...resto} />
  );
}

/** «📋»: copia el texto; si el navegador no deja, lo enseña para copiarlo a mano. */
function BotonCopiar({ texto, t }: { texto: string; t: T }) {
  const [hecho, setHecho] = useState(false);
  const copia = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setHecho(true);
      setTimeout(() => setHecho(false), 1500);
    } catch {
      window.prompt(t("Copy it from here:", "Cópialo de aquí:"), texto);
    }
  };
  return (
    <button type="button" onClick={copia} className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      title={t("Copy", "Copiar")} aria-label={t(`Copy ${texto}`, `Copiar ${texto}`)} data-copiar={texto}>
      {hecho ? `✓ ${t("Copied", "Copiado")}` : "📋"}
    </button>
  );
}

/**
 * Los contactos de la tarjeta «Contacto» (D-668). Como las pastillas de tiendas: una pastilla por contacto, y al
 * pulsarla se ve ese; si no caben (`PASTILLAS_A_LA_VISTA`), «+N» abre un desplegable con los demás. Del elegido: el
 * nombre, el cargo y la nota, y debajo sus teléfonos (pulsar llama con RingCentral, como en RR. HH.) y sus correos
 * (pulsar abre el correo), cada uno con «📋» para solo copiarlo.
 */
function ContactosParaVer({ contactos, t }: { contactos: Contacto[]; t: T }) {
  const [elegido, setElegido] = useState(0);
  // «+N»: un menú propio (no un <select>: en el teléfono el nativo se estiraba y cortaba el nombre).
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useCierraAlSalir(menu, () => setMenu(false), () => [menuRef.current]);
  if (!contactos.length) {
    return <p className="border-b border-slate-100 py-1.5 text-sm text-slate-400" data-contactos="0">{t("No contact yet", "Sin contacto todavía")}</p>;
  }
  const i = Math.min(elegido, contactos.length - 1);
  const c = contactos[i];
  const { pastillas, enElMenu } = repartoDePastillas(contactos.length);
  const pastilla = (activa: boolean) =>
    cn("max-w-[11rem] truncate rounded-full border px-3 py-1 text-xs", activa ? "border-clay-200 bg-clay-50 font-medium text-clay-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50");
  return (
    <div className="space-y-2 border-b border-slate-100 pb-3" data-contactos={contactos.length}>
      {contactos.length > 1 && (
        <div role="tablist" aria-label={t("Contacts", "Contactos")} className="flex flex-wrap items-center gap-1.5">
          {pastillas.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={k === i} onClick={() => setElegido(k)} className={pastilla(k === i)} title={rotuloDeContacto(contactos[k], k, t)} data-pastilla-de-contacto={k}>
              {rotuloDeContacto(contactos[k], k, t)}
            </button>
          ))}
          {enElMenu.length > 0 && (
            <div className="relative" ref={menuRef}>
              <button type="button" onClick={() => setMenu((m) => !m)} className={pastilla(enElMenu.includes(i))} aria-haspopup="menu" aria-expanded={menu}
                title={t("More contacts", "Más contactos")} data-mas-contactos={enElMenu.length}>
                {enElMenu.includes(i) ? rotuloDeContacto(contactos[i], i, t) : `+${enElMenu.length}`} ▾
              </button>
              {menu && (
                <div role="menu" className="absolute left-0 top-full z-20 mt-1 min-w-[11rem] max-w-[16rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg" data-menu-de-contactos>
                  {enElMenu.map((k) => (
                    <button key={k} type="button" role="menuitem" onClick={() => { setElegido(k); setMenu(false); }}
                      className={cn("block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-slate-50", k === i ? "font-medium text-clay-700" : "text-slate-700")} data-opcion-de-contacto={k}>
                      {rotuloDeContacto(contactos[k], k, t)}
                      {contactos[k].title && contactos[k].name && <span className="ml-1 text-xs text-slate-400">· {contactos[k].title}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div className="space-y-1" data-contacto-elegido={i}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-words font-medium text-slate-900" data-campo="contact_name">{c.name ?? t("No name", "Sin nombre")}</span>
          {c.title && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600" data-campo="contact_title">{c.title}</span>}
        </div>
        {c.note && <p className="break-words text-xs italic text-slate-500" data-nota-de-contacto>{c.note}</p>}
        {c.phones.length > 0 && (
          <ul className="space-y-0.5" data-campo="phone">
            {c.phones.map((p) => (
              <li key={p} className="flex items-center gap-1">
                <a href={rcCall(p)} className="text-sm text-clay-600 hover:underline" title={t("Call with RingCentral", "Llamar con RingCentral")} data-llamar={p}>📞 {p}</a>
                <BotonCopiar texto={p} t={t} />
              </li>
            ))}
          </ul>
        )}
        {c.emails.length > 0 && (
          <ul className="space-y-0.5" data-campo="email">
            {c.emails.map((e) => (
              <li key={e} className="flex min-w-0 items-center gap-1">
                <a href={`mailto:${e}`} className="min-w-0 break-all text-sm text-clay-600 hover:underline" title={t("Write an email", "Escribir un correo")} data-escribir={e}>✉️ {e}</a>
                <BotonCopiar texto={e} t={t} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Editar los contactos (D-668): cuantos hagan falta, y cada uno con cuantos teléfonos y correos hagan falta. El nombre
 * y el cargo salen en MAYÚSCULAS al escribir; el teléfono con el molde de Entregas. Un hueco vacío no cuenta.
 */
function ContactosParaEditar({ contactos, errores, onCambia, t }: { contactos: ContactoEnEdicion[]; errores: string[]; onCambia: (c: ContactoEnEdicion[]) => void; t: T }) {
  const cambia = (i: number, c: Partial<ContactoEnEdicion>) => onCambia(contactos.map((x, j) => (j === i ? { ...x, ...c } : x)));
  const etiqueta = "text-xs text-slate-500";
  const quitar = "shrink-0 rounded px-1.5 text-sm text-slate-400 hover:bg-slate-100 hover:text-red-600";
  const mas = "text-xs font-medium text-clay-600 hover:underline";
  return (
    <div className="space-y-3 border-b border-slate-100 pb-3" data-contactos-editando={contactos.length}>
      {contactos.map((c, i) => (
        <fieldset key={i} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/50 p-3" data-contacto-editable={i}>
          <div className="flex items-center justify-between">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t(`Contact ${i + 1}`, `Contacto ${i + 1}`)}</legend>
            {contactos.length > 1 && (
              <button type="button" className="text-xs text-slate-500 hover:text-red-600" onClick={() => onCambia(contactos.filter((_, j) => j !== i))} data-quitar-contacto={i}>
                ✕ {t("Remove contact", "Quitar contacto")}
              </button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className={etiqueta}>{t("Name", "Nombre")}</span>
              <Input value={c.name} onChange={(e) => cambia(i, { name: enMayusculas("contact_name", e.target.value) })} data-nombre-de-contacto={i} />
            </label>
            <label className="block space-y-1">
              <span className={etiqueta}>{t("Title", "Cargo")}</span>
              <Input value={c.title} onChange={(e) => cambia(i, { title: enMayusculas("contact_title", e.target.value) })} placeholder={t("Owner, A/P…", "Dueño, A/P…")} data-cargo-de-contacto={i} />
            </label>
          </div>
          <div className="space-y-1">
            <span className={etiqueta}>{t("Phones", "Teléfonos")}</span>
            {c.phones.map((p, j) => (
              <div key={j} className="flex items-center gap-1">
                <EntradaDeTelefono valor={p} mal={errores.includes(`contacto.${i}.phones.${j}`)} onCambia={(v) => cambia(i, { phones: c.phones.map((x, k) => (k === j ? v : x)) })} data-telefono-de-contacto={`${i}.${j}`} />
                {c.phones.length > 1 && <button type="button" className={quitar} onClick={() => cambia(i, { phones: c.phones.filter((_, k) => k !== j) })} aria-label={t("Remove phone", "Quitar teléfono")}>✕</button>}
              </div>
            ))}
            <button type="button" className={mas} onClick={() => cambia(i, { phones: [...c.phones, ""] })} data-agregar-telefono={i}>+ {t("Add phone", "Agregar teléfono")}</button>
          </div>
          <div className="space-y-1">
            <span className={etiqueta}>{t("Emails", "Correos")}</span>
            {c.emails.map((m, j) => (
              <div key={j} className="flex items-center gap-1">
                <Input value={m} type="email" inputMode="email" onChange={(e) => cambia(i, { emails: c.emails.map((x, k) => (k === j ? e.target.value : x)) })}
                  className={cn(errores.includes(`contacto.${i}.emails.${j}`) && "border-red-400 ring-1 ring-red-300")} data-correo-de-contacto={`${i}.${j}`} />
                {c.emails.length > 1 && <button type="button" className={quitar} onClick={() => cambia(i, { emails: c.emails.filter((_, k) => k !== j) })} aria-label={t("Remove email", "Quitar correo")}>✕</button>}
              </div>
            ))}
            <button type="button" className={mas} onClick={() => cambia(i, { emails: [...c.emails, ""] })} data-agregar-correo={i}>+ {t("Add email", "Agregar correo")}</button>
          </div>
          <label className="block space-y-1">
            <span className={etiqueta}>{t("Note", "Nota")}</span>
            <Input value={c.note} onChange={(e) => cambia(i, { note: e.target.value })} placeholder={t("e.g. only for POs", "p. ej. solo para POs")} data-nota-de-contacto={i} />
          </label>
        </fieldset>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onCambia([...contactos, contactoVacio()])} data-agregar-contacto>
        + {t("Add contact", "Agregar contacto")}
      </Button>
    </div>
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
 * `cliente` null = alta. En el alta la tienda son CASILLAS (D-664): una por tienda y «Todas»; se crea una fila por tienda
 * marcada, todas de la misma empresa nueva, y al terminar la ventana enseña la de la primera tienda con sus pastillas.
 */
export function FichaEnVentana({ cliente, hermanas, lista = [], onCambia, puedeEditar, almacen, onClose, onGuardado, editarAlAbrir = false, t }: {
  cliente: Cliente | null;
  /** La lista que la pantalla ya tiene cargada: contra ella se busca el duplicado mientras se escribe (D-665). */
  lista?: readonly Cliente[];
  /** Las filas de la misma empresa (189), una por tienda, en orden: las pestañas. */
  hermanas: Cliente[];
  onCambia: (c: Cliente) => void;
  puedeEditar: boolean; almacen: AlmacenDeClientes; onClose: () => void;
  /** La fila guardada (la que se enseña) y, en un alta en varias tiendas, TODAS las creadas (D-664). */
  onGuardado: (c: Cliente, creados?: Cliente[]) => void;
  /** «✏️ Editar» de la página del cliente (D-648) llega aquí: la ventana abre ya editando. */
  editarAlAbrir?: boolean;
  t: T;
}) {
  const nuevo = cliente === null;
  const original = useMemo(() => formDe(cliente), [cliente]);
  const [form, setForm] = useState<Record<string, string>>(original);
  useEffect(() => { setForm(original); }, [original]);
  // D-668: los contactos van aparte del resto de campos: una lista que se edita entera.
  const contactosOriginales = useMemo(() => contactosDe(cliente), [cliente]);
  const [contactos, setContactos] = useState<ContactoEnEdicion[]>(() => enEdicion(contactosOriginales));
  useEffect(() => { setContactos(enEdicion(contactosOriginales)); }, [contactosOriginales]);
  const [editando, setEditando] = useState(puedeEditar && (nuevo || editarAlAbrir));
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tono: "rojo" | "verde" | "ambar"; texto: string } | null>(null);
  // D-664: las tiendas marcadas en el alta. `form.store` lleva la primera, para que «sin tienda» siga siendo un error.
  const [tiendasAlta, setTiendasAlta] = useState<string[]>([]);
  const marcaTiendas = (marcadas: string[]) => {
    const orden = tiendasDelAlta(marcadas);
    setTiendasAlta(orden);
    setForm((f) => ({ ...f, store: orden[0] ?? "" }));
  };
  const { parche, errores } = useMemo(() => {
    const campos = parcheDe(form, original, nuevo);
    return {
      parche: { ...campos.parche, ...parcheDeContactos(contactosOriginales, contactos, cliente) },
      errores: [...campos.errores, ...erroresDeContactos(contactos)],
    };
  }, [form, original, nuevo, contactosOriginales, contactos, cliente]);
  const cambiado = Object.keys(parche).length > 0;

  // D-665: «this information matches another account». Mientras se edita (alta o ficha), lo escrito se compara con la
  // lista ya cargada (`coincidenciasDe`, las reglas de D-633), con un pequeño retardo para no buscar a cada tecla. Fuera
  // la propia empresa. No bloquea: con una coincidencia OBVIA (mismo nombre), «Guardar» pide «Guardar de todas formas».
  const borrador = JSON.stringify({ account: form.account ?? "", unified_account: form.unified_account ?? "", phone: textoDeTelefonos(contactos), email: textoDeCorreos(contactos) });
  const [borradorQuieto, setBorradorQuieto] = useState(borrador);
  useEffect(() => { const h = setTimeout(() => setBorradorQuieto(borrador), RETARDO_DEL_AVISO_MS); return () => clearTimeout(h); }, [borrador]);
  const coinciden = useMemo(
    () => (editando ? coincidenciasDe(JSON.parse(borradorQuieto) as Borrador, lista, { excluirEmpresa: cliente ? claveDeEmpresa(cliente) : null }) : []),
    [editando, borradorQuieto, lista, cliente],
  );
  const hayObvia = coinciden.some((c) => c.obvia);
  const [deTodasFormas, setDeTodasFormas] = useState(false);
  useEffect(() => { setDeTodasFormas(false); }, [coinciden]);

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

  const textoDelFallo = (r: Extract<Res<unknown>, { ok: false }>, varias = false) =>
    r.duplicado
      ? varias
        ? t("That account already exists in those stores.", "Esa cuenta ya existe en esas tiendas.")
        : t("That account already exists in that store.", "Esa cuenta ya existe en esa tienda.")
      : r.sinPermiso
        ? t("Not saved: the database did not accept the change (no permission).", "No se guardó: la base no aceptó el cambio (sin permiso).")
        : t("Not saved: ", "No se guardó: ") + r.error;

  /** Escribe y pinta lo que devolvió la base; en rojo lo que no se guardó. */
  const aplicar = async (escritura: () => ReturnType<AlmacenDeClientes["guardar"]>, hecho: string): Promise<boolean> => {
    setOcupado(true);
    setAviso(null);
    const r = await escritura();
    setOcupado(false);
    if (!r.ok) {
      setAviso({ tono: "rojo", texto: textoDelFallo(r) });
      return false;
    }
    setAviso({ tono: "verde", texto: hecho });
    onGuardado(r.valor);
    return true;
  };

  // D-664: el alta crea una fila por tienda marcada, con los mismos datos y la MISMA empresa nueva (como «Separar»). La
  // que choca no se crea y se dice cuál; las demás, sí. Se enseña la de la primera tienda marcada que se creó.
  const crearEnLasTiendas = async () => {
    setOcupado(true);
    setAviso(null);
    const r = await almacen.crearVarias(filasDelAlta(parche, tiendasAlta, crypto.randomUUID()));
    setOcupado(false);
    if (!r.ok) { setAviso({ tono: "rojo", texto: textoDelFallo(r, tiendasAlta.length > 1) }); return; }
    const ver = filaQueSeEnsena(r.valor, tiendasAlta);
    if (!ver) return;
    const faltan = avisoDeNoCreadas(r.valor, t);
    setAviso(faltan ? { tono: "ambar", texto: t("Saved ✓ ", "Guardado ✓ ") + faltan } : { tono: "verde", texto: t("Saved ✓", "Guardado ✓") });
    setEditando(false);
    onGuardado(ver, r.valor.creados);
  };

  const guardar = async () => {
    if (errores.length) { setAviso({ tono: "rojo", texto: t("Check the highlighted fields.", "Revisa los campos marcados.") }); return; }
    if (hayObvia && !deTodasFormas) {
      setDeTodasFormas(true);
      setAviso({ tono: "ambar", texto: t("Another account has this name. Press «Save anyway» to go on.", "Ya hay otra cuenta con este nombre. Pulsa «Guardar de todas formas» para seguir.") });
      return;
    }
    if (nuevo) { await crearEnLasTiendas(); return; }
    if (await aplicar(() => almacen.guardar(cliente.id, parche), t("Saved ✓", "Guardado ✓"))) setEditando(false);
  };
  const cancelar = () => {
    if (nuevo) { pedirCierre(); return; }
    setForm(original);
    setContactos(enEdicion(contactosOriginales));
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
  /** El enlace del aviso: abre la ficha de esa cuenta (leyendo). Con algo escrito sin guardar, pregunta antes. */
  const abreCoincidencia = (c: Cliente) => {
    if (cambiadoRef.current && !window.confirm(t("Leave without saving your changes?", "¿Salir sin guardar los cambios?"))) return;
    setEditando(false);
    setAviso(null);
    onCambia(c);
  };
  const tiendas = nuevo ? [] : hermanas.length > 0 ? hermanas : [cliente];

  // El alta (D-664): una casilla por tienda y «Todas», en el sitio de las pastillas. Al menos una (si no, en rojo).
  const todasMarcadas = TIENDAS.every((x) => tiendasAlta.includes(x.code));
  const casilla = (marcada: boolean) =>
    cn("flex cursor-pointer select-none items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
      marcada ? "border-clay-200 bg-clay-50 font-medium text-clay-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50");
  const casillasDelAlta = (
    <div role="group" aria-label={t("Stores", "Tiendas")} className="flex flex-wrap items-center gap-1.5" data-tiendas-del-alta>
      <span className={cn("text-xs", errores.includes("store") ? "font-medium text-red-600" : "text-slate-500")}>{t("Stores *", "Tiendas *")}</span>
      <label className={casilla(todasMarcadas)} data-casilla-todas>
        <input type="checkbox" checked={todasMarcadas}
          onChange={(e) => marcaTiendas(e.target.checked ? TIENDAS.map((x) => x.code) : [])} />
        {t("All", "Todas")}
      </label>
      {TIENDAS.map((x) => {
        const marcada = tiendasAlta.includes(x.code);
        return (
          <label key={x.code} className={casilla(marcada)} data-casilla-tienda={x.code}>
            <input type="checkbox" checked={marcada}
              onChange={(e) => marcaTiendas(e.target.checked ? [...tiendasAlta, x.code] : tiendasAlta.filter((c) => c !== x.code))} />
            {x.nombre}
          </label>
        );
      })}
    </div>
  );

  // La tienda de esta fila, para cambiarla: en las pastillas, en el sitio de la suya (D-654: ya no hay campo «Tienda» abajo).
  const selectorDeTienda = (
    <select
      className={cn(selCls, "h-8 rounded-full text-xs", errores.includes("store") && "border-red-400 ring-1 ring-red-300")}
      value={form.store ?? ""}
      onChange={(e) => campo("store", e.target.value)}
      aria-label={t("Store of this row", "Tienda de esta fila")}
      data-tienda-de-la-fila
    >
      <option value="">—</option>
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
          {nuevo && editando && casillasDelAlta}
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
          {/* D-668: el teléfono y el correo ya no van aquí arriba, sueltos («956-… Omar»): van en la tarjeta «Contacto»,
              con su persona. */}
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
          {coinciden.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900" role="status" data-aviso-duplicado>
              {coinciden.slice(0, MAX_COINCIDENCIAS).map((c) => (
                <p key={c.empresa} className="break-words" data-coincidencia={c.obvia ? "obvia" : c.soloParecido ? "parecida" : "dato"}>
                  ⚠ {c.soloParecido ? t("Looks like another account: ", "Se parece a otra cuenta: ") : t("This matches another account: ", "Esto coincide con otra cuenta: ")}
                  <button type="button" className="font-semibold underline hover:text-amber-700" onClick={() => abreCoincidencia(c.fila)} data-abre-coincidencia={c.fila.id}>
                    {c.fila.account}
                  </button>
                  {" "}({c.tiendas.map(nombreDeTienda).join(", ")}) — {c.motivos.map((m) => motivoDeCoincidenciaLabel(m, t)).join(" / ")}
                </p>
              ))}
              {coinciden.length > MAX_COINCIDENCIAS && (
                <p className="text-xs text-amber-800">{t(`and ${coinciden.length - MAX_COINCIDENCIAS} more`, `y ${coinciden.length - MAX_COINCIDENCIAS} más`)}</p>
              )}
            </div>
          )}
          <TarjetasDeLaFicha cliente={cliente} form={form} editando={editando} errores={errores} onCampo={campo} contactos={contactos} onContactos={setContactos} t={t} />
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
            {aviso && <span className={cn("text-sm", aviso.tono === "verde" ? "text-emerald-600" : aviso.tono === "ambar" ? "text-amber-700" : "text-red-600")} role="status">{aviso.texto}</span>}
            {editando && (
              <>
                <Button variant="outline" onClick={cancelar} disabled={ocupado}>{t("Cancel", "Cancelar")}</Button>
                <Button onClick={guardar} disabled={ocupado || !cambiado} data-guardar-ficha>
                  {ocupado ? t("Saving…", "Guardando…") : deTodasFormas ? t("Save anyway", "Guardar de todas formas") : nuevo ? t("Create", "Crear") : t("Save", "Guardar")}
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
