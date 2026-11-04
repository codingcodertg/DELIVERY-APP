import type { Candidate } from "./types";
import { TABS } from "./constants";
import { telClean } from "./utils";
import { pestanasVisibles } from "./vista-del-gerente";
import { coincideBusqueda } from "./tabla-de-empleados";
import { estaDadoDeBaja } from "@/lib/baja";

/**
 * El buscador de la barra de RR. HH. (`GlobalSearch`). El dueño: «aquí no es solo candidatos, también empleados, pero
 * que se note la diferencia entre los 2».
 *
 * Dos fuentes, dos grupos: los candidatos que ya carga el módulo (`useData().candidates`, filtrados por la RLS: el
 * gerente de tienda solo trae los suyos) y los expedientes de Empleados. Los empleados salen SOLO para quien ya ve la
 * pestaña Empleados (`puedeBuscarEmpleados`, la misma regla que pinta la pestaña); la barrera de verdad es la acción
 * de servidor (`buscaEmpleadosParaLaBarra`), que repite la de `listEmployeeFiles` y lee con la sesión de quien busca.
 *
 * Los empleados se buscan EN EL SERVIDOR y solo viajan los que coinciden, recortados a lo que se pinta
 * (`EmpleadoEncontrado`): el expediente no se carga en el estado global del módulo (ver la cabecera de `actions/hr.ts`).
 *
 * Aquí vive lo puro: quién coincide, cómo se agrupan, qué etiqueta lleva cada grupo y adónde lleva cada clic.
 */

export type TipoDeResultado = "candidato" | "empleado";

/** Lo que el buscador necesita de un expediente. Ni notas, ni contraseñas, ni costos: solo con qué se busca y se pinta. */
export type EmpleadoParaBuscar = {
  id: string;
  full_name: string;
  job_title: string | null;
  department: string | null;
  /** La tienda que se enseña (la de la cuenta si la hay, si no la del expediente: `tiendaVisible`). */
  store: string | null;
  phone: string | null;
  ringcentral_ext: string | null;
  email: string | null;
  personal_email: string | null;
  employee_code: string | null;
  date_left: string | null;
};

/** Lo que vuelve al navegador por cada empleado que coincide: lo que se pinta en la fila, nada más. */
export type EmpleadoEncontrado = Pick<EmpleadoParaBuscar, "id" | "full_name" | "job_title" | "store" | "phone" | "date_left">;

/** Recorta un expediente a lo que se pinta. Lo demás (correos, extensión, número) sirve para coincidir, no viaja. */
export function aEncontrado(e: EmpleadoParaBuscar): EmpleadoEncontrado {
  return { id: e.id, full_name: e.full_name, job_title: e.job_title, store: e.store, phone: e.phone, date_left: e.date_left };
}

/** Lo más largo que se busca: la caja no necesita más, y la acción no debe recibir un texto sin tope. */
export const LARGO_MAXIMO = 100;

export type CandidatoParaBuscar = Pick<
  Candidate,
  "id" | "name" | "phone" | "email" | "role" | "tags" | "extra_phones" | "extra_emails" | "pinned"
>;

export type ResultadoDeBusqueda<C extends CandidatoParaBuscar = CandidatoParaBuscar, E extends EmpleadoEncontrado = EmpleadoEncontrado> =
  | { tipo: "candidato"; id: string; candidato: C }
  | { tipo: "empleado"; id: string; empleado: E };

export type GrupoDeResultados<C extends CandidatoParaBuscar = CandidatoParaBuscar, E extends EmpleadoEncontrado = EmpleadoEncontrado> = {
  tipo: TipoDeResultado;
  /** Posición del primer resultado del grupo en la lista plana (la de las flechas). */
  desde: number;
  items: ResultadoDeBusqueda<C, E>[];
};

/** Cuántos de cada grupo. Los candidatos se quedan en los 8 de antes; los empleados, 6, para que quepan los dos grupos. */
export const MAX_CANDIDATOS = 8;
export const MAX_EMPLEADOS = 6;

/** El parámetro con el que Empleados abre una ficha al llegar: `/recruiting/employees?ficha=<id>`. */
export const PARAM_FICHA = "ficha";

type T = (en: string, es: string) => string;

/** ¿Busca empleados este rol de RR. HH.? Exactamente quien ve la pestaña Empleados (admin y gerente; no el
 *  reclutador ni el gerente de tienda). No se inventa otra regla: es `pestanasVisibles` sobre las mismas `TABS`. */
export function puedeBuscarEmpleados(rolRrhh: string | null | undefined): boolean {
  return pestanasVisibles(TABS, rolRrhh ?? "").some((p) => p.id === "employees");
}

/** Los candidatos que coinciden: el filtro de siempre del buscador (nombre, teléfonos, correos, vacante, etiquetas),
 *  los fijados primero, y un tope. */
export function buscaCandidatos<C extends CandidatoParaBuscar>(candidatos: readonly C[], texto: string, max = MAX_CANDIDATOS): C[] {
  const s = texto.trim().toLowerCase();
  if (!s) return [];
  const digitos = telClean(s);
  return candidatos
    .filter((c) => {
      const pajar = (
        c.name +
        " " + c.phone +
        " " + (c.email || "") +
        " " + (c.role || "") +
        " " + c.tags.join(" ") +
        " " + c.extra_phones.join(" ") +
        " " + c.extra_emails.join(" ")
      ).toLowerCase();
      return pajar.includes(s) || (digitos.length >= 3 && telClean(c.phone).includes(digitos));
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
    .slice(0, max);
}

/** Los empleados que coinciden: lo mismo que mira la caja de la pantalla Empleados (`coincideBusqueda`), más el
 *  número de empleado y el teléfono por dígitos («9565550101» encuentra «956-555-0101»). Los activos primero. */
export function buscaEmpleados<E extends EmpleadoParaBuscar>(empleados: readonly E[], texto: string, max = MAX_EMPLEADOS, hoy?: string): E[] {
  const s = texto.trim().slice(0, LARGO_MAXIMO);
  if (!s) return [];
  const digitos = telClean(s).replace(/\+/g, "");
  const codigo = s.toLowerCase();
  return empleados
    .filter((e) =>
      coincideBusqueda(e, s) ||
      (e.employee_code ?? "").toLowerCase().includes(codigo) ||
      (digitos.length >= 3 && telClean(e.phone).replace(/\+/g, "").includes(digitos)))
    .map((e, i) => ({ e, i, baja: estaDadoDeBaja(e.date_left, hoy) }))
    .sort((a, b) => Number(a.baja) - Number(b.baja) || a.i - b.i)
    .slice(0, max)
    .map((x) => x.e);
}

/** Los dos grupos, candidatos primero, sin grupos vacíos. `planos` es la lista que recorren las flechas y Enter;
 *  `desde` dice en qué posición de esa lista empieza cada grupo. */
export function agrupaResultados<C extends CandidatoParaBuscar, E extends EmpleadoEncontrado>(
  candidatos: readonly C[], empleados: readonly E[],
): { grupos: GrupoDeResultados<C, E>[]; planos: ResultadoDeBusqueda<C, E>[] } {
  const deCandidatos: ResultadoDeBusqueda<C, E>[] = candidatos.map((c) => ({ tipo: "candidato", id: c.id, candidato: c }));
  const deEmpleados: ResultadoDeBusqueda<C, E>[] = empleados.map((e) => ({ tipo: "empleado", id: e.id, empleado: e }));
  const grupos: GrupoDeResultados<C, E>[] = [];
  if (deCandidatos.length) grupos.push({ tipo: "candidato", desde: 0, items: deCandidatos });
  if (deEmpleados.length) grupos.push({ tipo: "empleado", desde: deCandidatos.length, items: deEmpleados });
  return { grupos, planos: [...deCandidatos, ...deEmpleados] };
}

/** La pastilla de cada fila. */
export function etiquetaDeTipo(tipo: TipoDeResultado, t: T): string {
  return tipo === "candidato" ? t("Candidate", "Candidato") : t("Employee", "Empleado");
}

/** La cabecera de cada grupo, con cuántos hay. */
export function cabeceraDeGrupo(tipo: TipoDeResultado, n: number, t: T): string {
  return (tipo === "candidato" ? t("Candidates", "Candidatos") : t("Employees", "Empleados")) + " · " + n;
}

/** El texto del cuadro: dice «y empleados» solo a quien de verdad los va a encontrar. */
export function placeholderDelBuscador(conEmpleados: boolean, t: T): string {
  return conEmpleados
    ? t("🔍 Search candidates and employees…  ( / )", "🔍 Buscar candidatos y empleados…  ( / )")
    : t("🔍 Search candidates…  ( / )", "🔍 Buscar candidatos…  ( / )");
}

/** La segunda línea de un empleado: puesto · tienda · teléfono (lo que haya), y «Baja» si ya se fue. */
export function detalleDeEmpleado(e: EmpleadoEncontrado, t: T, hoy?: string): string {
  const partes = [e.job_title, e.store, e.phone].map((v) => (v ?? "").trim()).filter(Boolean);
  if (estaDadoDeBaja(e.date_left, hoy)) partes.unshift(t("Left", "Baja"));
  return partes.join(" · ");
}

export type Destino = { tipo: "perfil"; id: string } | { tipo: "ruta"; href: string };

/** Adónde lleva el clic: el candidato abre su perfil (el modal de siempre); el empleado, su ficha en RR. HH. › Empleados. */
export function destinoDeResultado(r: Pick<ResultadoDeBusqueda, "tipo" | "id">): Destino {
  if (r.tipo === "candidato") return { tipo: "perfil", id: r.id };
  return { tipo: "ruta", href: "/recruiting/employees?" + PARAM_FICHA + "=" + encodeURIComponent(r.id) };
}

/** La ficha que pide la URL de Empleados, o null. */
export function fichaPedida(params: { get(nombre: string): string | null } | null | undefined): string | null {
  const id = (params?.get(PARAM_FICHA) ?? "").trim();
  return id || null;
}
