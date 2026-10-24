import {
  claveDeEmpresa, claveDeNombre, codigoDeTienda, correos, dominiosCompartidos, nombreContenido, normalizaNombre, similitud,
  SIMILITUD_SOSPECHOSA, telefonos, type FilaDeCliente,
} from "./duplicados";
import { TIENDAS } from "./reglas";

type T = (en: string, es: string) => string;

/**
 * El aviso de duplicado en la ficha (D-665). El dueño: «make an alert that says hey this information matches another
 * account so we don't have duplicated». Mientras se escribe un alta o se edita una ficha, se compara lo escrito con la
 * lista que la pantalla YA tiene cargada (sin pedir nada a la base) y con las MISMAS reglas de `duplicados.ts` (D-633):
 *  - OBVIO: el mismo nombre normalizado (`claveDeNombre`: «LLC» = «L.L.C.», «&» = «and») o la misma cuenta unificada.
 *  - Mismo teléfono (`telefonos`: 10 dígitos, dé igual el formato) o el mismo correo (`correos`), salvo los de un
 *    dominio compartido (`dominiosCompartidos`: el correo de trabajo de alguien que sale en fichas ajenas). Un correo
 *    gratuito (`CORREO_GRATUITO`) cuenta solo si es la MISMA dirección, como siempre: su dominio nunca es «compartido».
 *  - SOSPECHOSO, con menos peso: el nombre parecido (similitud ≥ 0,85) o contenido en el otro («se parece a…»).
 * No bloquea guardar: es un aviso. Con uno OBVIO, «Guardar» pide «Guardar de todas formas».
 */
export type MotivoDeCoincidencia = "nombre" | "cuenta_unificada" | "telefono" | "correo" | "nombre_parecido" | "nombre_contenido";
/** El orden en que se dicen (y el peso: los primeros, más). */
export const MOTIVOS_DE_COINCIDENCIA: readonly MotivoDeCoincidencia[] = ["nombre", "cuenta_unificada", "telefono", "correo", "nombre_parecido", "nombre_contenido"];
const OBVIOS: readonly MotivoDeCoincidencia[] = ["nombre", "cuenta_unificada"];
const SOSPECHAS: readonly MotivoDeCoincidencia[] = ["nombre_parecido", "nombre_contenido"];

/** Lo escrito en la ficha que se compara. */
export type Borrador = { account?: string | null; unified_account?: string | null; phone?: string | null; email?: string | null };

export interface Coincidencia<F extends FilaDeCliente = FilaDeCliente> {
  empresa: string;
  /** La fila que más coincide: la que abre el enlace. */
  fila: F;
  /** Las tiendas de esa empresa (filas vivas), en el orden de `TIENDAS`. */
  tiendas: string[];
  motivos: MotivoDeCoincidencia[];
  /** Mismo nombre o misma cuenta unificada: «Guardar» pide confirmación. */
  obvia: boolean;
  /** Solo «se parece»: ni nombre, ni teléfono, ni correo iguales. */
  soloParecido: boolean;
}

/** El campo de la fila y lo mismo de todos sus contactos (193), en un texto que `telefonos` / `correos` saben partir. */
const conContactos = (campo: string | null, contactos: FilaDeCliente["contacts"], k: "phones" | "emails") =>
  [campo, ...(contactos ?? []).flatMap((c) => c[k])].filter(Boolean).join(" / ");

const rango = (s: string) => { const i = TIENDAS.findIndex((t) => t.code === codigoDeTienda(s)); return i < 0 ? TIENDAS.length : i; };
const peso = (m: readonly MotivoDeCoincidencia[]) => m.reduce((p, x) => p + (MOTIVOS_DE_COINCIDENCIA.length - MOTIVOS_DE_COINCIDENCIA.indexOf(x)) ** 2, 0);

/**
 * Las cuentas de `lista` con las que coincide el borrador, una por EMPRESA, de más a menos peso (lo obvio primero).
 * Fuera: las archivadas (no son clientes) y, al editar, la propia empresa (`excluirEmpresa`, su `claveDeEmpresa`).
 */
export function coincidenciasDe<F extends FilaDeCliente>(borrador: Borrador, lista: readonly F[], o: { excluirEmpresa?: string | null } = {}): Coincidencia<F>[] {
  const vivas = lista.filter((f) => !f.archived_at);
  const nombre = claveDeNombre(borrador.account);
  const norm = normalizaNombre(borrador.account);
  const unificada = claveDeNombre(borrador.unified_account);
  const tels = telefonos(borrador.phone);
  const compartidos = dominiosCompartidos(vivas);
  const mails = correos(borrador.email).filter((c) => !compartidos.has(c.split("@")[1]));
  const porEmpresa = new Map<string, { fila: F; motivos: MotivoDeCoincidencia[] }>();
  for (const f of vivas) {
    const empresa = claveDeEmpresa(f);
    if (o.excluirEmpresa && empresa === o.excluirEmpresa) continue;
    const motivos: MotivoDeCoincidencia[] = [];
    if (nombre && nombre === claveDeNombre(f.account)) motivos.push("nombre");
    if (unificada && unificada === claveDeNombre(f.unified_account)) motivos.push("cuenta_unificada");
    // D-NEXT: con los teléfonos y correos de TODOS sus contactos, no solo el espejo del primero.
    if (tels.length && telefonos(conContactos(f.phone, f.contacts, "phones")).some((t) => tels.includes(t))) motivos.push("telefono");
    if (mails.length && correos(conContactos(f.email, f.contacts, "emails")).some((c) => mails.includes(c))) motivos.push("correo");
    // Sin un nombre de dos letras o más (`claveDeNombre`), no hay con qué parecerse: «A» no se parece a «A».
    if (!motivos.includes("nombre") && nombre) {
      const otro = normalizaNombre(f.account);
      const largo = Math.max(norm.length, otro.length);
      // Como `sospechosos`: si los largos difieren más de un 15 %, la similitud no llega; no se calcula.
      const cerca = largo > 0 && Math.abs(norm.length - otro.length) / largo <= 1 - SIMILITUD_SOSPECHOSA + 1e-9;
      if (cerca && similitud(norm, otro) >= SIMILITUD_SOSPECHOSA) motivos.push("nombre_parecido");
      else if (nombreContenido(norm, otro)) motivos.push("nombre_contenido");
    }
    if (!motivos.length) continue;
    const ya = porEmpresa.get(empresa);
    if (!ya) { porEmpresa.set(empresa, { fila: f, motivos }); continue; }
    if (peso(motivos) > peso(ya.motivos)) ya.fila = f;
    ya.motivos = MOTIVOS_DE_COINCIDENCIA.filter((m) => ya.motivos.includes(m) || motivos.includes(m));
  }
  return [...porEmpresa].map(([empresa, { fila, motivos }]) => {
    // «Parecido» no se dice si ya hay algo más fuerte de nombre (la misma cuenta unificada ya lo cubre).
    const dichos = motivos.some((m) => OBVIOS.includes(m)) ? motivos.filter((m) => !SOSPECHAS.includes(m)) : motivos;
    const tiendas = [...new Set(vivas.filter((f) => claveDeEmpresa(f) === empresa).map((f) => codigoDeTienda(f.store)))].sort((a, b) => rango(a) - rango(b) || a.localeCompare(b));
    return { empresa, fila, tiendas, motivos: dichos, obvia: dichos.some((m) => OBVIOS.includes(m)), soloParecido: dichos.every((m) => SOSPECHAS.includes(m)) };
  }).sort((a, b) => peso(b.motivos) - peso(a.motivos) || a.fila.id - b.fila.id);
}

export function motivoDeCoincidenciaLabel(m: MotivoDeCoincidencia, t: T): string {
  switch (m) {
    case "nombre": return t("same name", "mismo nombre");
    case "cuenta_unificada": return t("same unified account", "misma cuenta unificada");
    case "telefono": return t("same phone", "mismo teléfono");
    case "correo": return t("same email", "mismo correo");
    case "nombre_parecido": return t("similar name", "nombre parecido");
    case "nombre_contenido": return t("name contained in the other", "un nombre contiene al otro");
  }
}
