import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { puedeIniciarAprobacion } from "./etapas";
import { puedeFirmarSlot, slotsQuePuedoFirmar, type FirmaDeMerma } from "./firmas";
import { puedeGestionar } from "./mantenimiento";
import { slotsQueMeTocan } from "./grupos";
import {
  PERMISO_GERENTE, PERMISO_SUPERVISOR, esGerenteDeAlmacen, puedeCorregirMerma, puedeVerReporte, veLosReportes, type Quien,
} from "./visibilidad";

// Permiso de gerente (migración 334): `warehouse_ops_manager` vale como el rol `manager` dentro de Operaciones de
// Almacen, en SU tienda, y nada fuera de ella. El rol del hub no cambia.

const MIGRACION = readFileSync(join(process.cwd(), "supabase/migrations/334_warehouse_ops_permiso_de_gerente.sql"), "utf8").replace(/\r\n/g, "\n");
const SQL_PREVIO = (archivo: string) => readFileSync(join(process.cwd(), "supabase/migrations", archivo), "utf8").replace(/\r\n/g, "\n");

/** Un empleado de contabilidad (rol del hub «accounting») con acceso a Almacen, nivel por defecto (todos los reportes). */
const contador = (o: Partial<Quien> = {}): Quien => ({
  id: "c1", role: "accounting", store: "RDZ Pharr", module_access: ["warehouse_ops"], permissions: [PERMISO_GERENTE], warehouse_ops_role: null, ...o,
});
const soloSupervisor = (o: Partial<Quien> = {}): Quien => contador({ permissions: [PERMISO_SUPERVISOR], ...o });
const gerenteDeRol: Quien = { id: "g1", role: "manager", store: "RDZ Pharr", module_access: ["warehouse_ops"], permissions: [], warehouse_ops_role: null };

const merma = { kind: "scrap" as const, store: "RDZ Pharr" };
const otraTienda = { kind: "scrap" as const, store: "RDZ Edinburg" };
const reporteRRHH = { kind: "zone" as const, store: "RDZ Pharr", author_id: "x" };
const f = (slot: "gerente" | "supervisor", signer_id: string): FirmaDeMerma => ({ slot, signer_id, signer_name: signer_id, signed_at: "2026-11-19T12:00:00Z" });

describe("el permiso de gerente, como prueba de cliente", () => {
  it("el nombre del permiso es el mismo que usa la base", () => {
    expect(PERMISO_GERENTE).toBe("warehouse_ops_manager");
    expect(MIGRACION).toContain(`'${PERMISO_GERENTE}' = any(coalesce(p.permissions, '{}'))`);
  });

  it("es gerente con el permiso o con el rol del hub; el supervisor no lo es", () => {
    expect(esGerenteDeAlmacen(contador())).toBe(true);
    expect(esGerenteDeAlmacen(gerenteDeRol)).toBe(true);
    expect(esGerenteDeAlmacen(contador({ permissions: [] }))).toBe(false);
    expect(esGerenteDeAlmacen(soloSupervisor())).toBe(false);
  });

  it("ve los reportes de RR. HH. de su tienda (como el gerente), no los de otra", () => {
    expect(puedeVerReporte(contador(), reporteRRHH)).toBe(true);
    expect(puedeVerReporte(contador({ store: "RDZ Edinburg" }), reporteRRHH)).toBe(false);
    expect(puedeVerReporte(contador({ permissions: [] }), reporteRRHH)).toBe(false);
    expect(puedeVerReporte(soloSupervisor(), reporteRRHH)).toBe(false);
  });

  it("ve la pantalla de reportes de gerencia (KPI, hoja) igual que el gerente", () => {
    expect(veLosReportes(contador())).toBe(true);
    expect(veLosReportes(contador({ permissions: [] }))).toBe(false);
  });

  it("puede corregir la merma de su tienda, no la de otra", () => {
    expect(puedeCorregirMerma(contador(), merma)).toBe(true);
    expect(puedeCorregirMerma(contador(), otraTienda)).toBe(false);
  });

  it("inicia la aprobacion (arma el grupo) de su tienda, no la de otra", () => {
    expect(puedeIniciarAprobacion(contador(), merma)).toBe(true);
    expect(puedeIniciarAprobacion(contador(), otraTienda)).toBe(false);
    expect(puedeIniciarAprobacion(contador({ permissions: [] }), merma)).toBe(false);
  });

  it("gestiona mantenimiento y refacciones de su tienda (visible_stores cuenta)", () => {
    expect(puedeGestionar(contador(), "RDZ Pharr")).toBe(true);
    expect(puedeGestionar(contador(), "RDZ Edinburg")).toBe(false);
    expect(puedeGestionar(contador({ store: "RDZ Edinburg", visible_stores: ["RDZ Pharr"] }), "RDZ Pharr")).toBe(true);
  });

  it("firma SOLO el espacio «gerente»", () => {
    expect(slotsQuePuedoFirmar(contador())).toEqual(["gerente"]);
    expect(slotsQueMeTocan(contador())).toEqual(["gerente"]);
    expect(puedeFirmarSlot([], "gerente", "c1", contador())).toBe(true);
    expect(puedeFirmarSlot([], "supervisor", "c1", contador())).toBe(false);
  });

  it("con los dos permisos firma cualquiera de los dos, pero no los dos en la misma hoja", () => {
    const ambos = contador({ permissions: [PERMISO_GERENTE, PERMISO_SUPERVISOR] });
    expect(slotsQuePuedoFirmar(ambos)).toEqual(["gerente", "supervisor"]);
    expect(puedeFirmarSlot([], "gerente", "c1", ambos)).toBe(true);
    expect(puedeFirmarSlot([], "supervisor", "c1", ambos)).toBe(true);
    expect(puedeFirmarSlot([f("gerente", "c1")], "supervisor", "c1", ambos)).toBe(false);
    expect(puedeFirmarSlot([f("supervisor", "c1")], "gerente", "c1", ambos)).toBe(false);
  });

  it("solo el permiso de supervisor: sigue con poderes de supervisor y nada de gerente", () => {
    const sup = soloSupervisor();
    expect(slotsQuePuedoFirmar(sup)).toEqual(["supervisor"]);
    expect(puedeFirmarSlot([], "gerente", "c1", sup)).toBe(false);
    expect(puedeFirmarSlot([], "supervisor", "c1", sup)).toBe(true);
    expect(puedeIniciarAprobacion(sup, merma)).toBe(false);
    expect(puedeGestionar(sup, "RDZ Pharr")).toBe(true);
    expect(veLosReportes(sup)).toBe(true);
    expect(puedeVerReporte(sup, reporteRRHH)).toBe(false);
  });

  it("el nivel sigue mandando: un Associate (solo merma) con el permiso no gana poderes de gerente", () => {
    const asociado = contador({ warehouse_ops_role: "scrap_only" });
    expect(puedeIniciarAprobacion(asociado, merma)).toBe(false);
    expect(puedeGestionar(asociado, "RDZ Pharr")).toBe(false);
    expect(veLosReportes(asociado)).toBe(false);
  });

  it("sin el modulo de Almacen el permiso no abre nada", () => {
    const sinModulo = contador({ module_access: [] });
    expect(puedeIniciarAprobacion(sinModulo, merma)).toBe(false);
    expect(puedeGestionar(sinModulo, "RDZ Pharr")).toBe(false);
    expect(veLosReportes(sinModulo)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Migración 334: el helper y las seis funciones (cada una igual a su última versión, salvo la prueba de gerente)
// ---------------------------------------------------------------------------------------------------------------------

/** El texto de una función creada con «create or replace», desde su encabezado hasta el cierre de su cuerpo. */
function cuerpo(src: string, nombre: string): string {
  const i = src.indexOf(`create or replace function public.${nombre}(`);
  expect(i, nombre).toBeGreaterThanOrEqual(0);
  const op = /\bas\s+(\$[a-z]*\$)/i.exec(src.slice(i));
  expect(op, nombre).not.toBeNull();
  const tag = op![1];
  const cierre = src.indexOf(`${tag};`, i + op!.index + op![0].length);
  return src.slice(i, cierre + tag.length + 1);
}

const SEIS = [
  { archivo: "265_warehouse_ops_niveles.sql", nombre: "warehouse_ops_can_manage" },
  { archivo: "324_warehouse_associate.sql", nombre: "warehouse_ops_can_see" },
  { archivo: "293_firma_por_papel.sql", nombre: "warehouse_ops_can_sign_slot" },
  { archivo: "297_merma_gerente_inicia_historial_borrar.sql", nombre: "warehouse_ops_can_start_approval" },
  { archivo: "293_firma_por_papel.sql", nombre: "warehouse_ops_firmante_valido" },
  { archivo: "327_merma_rechazo.sql", nombre: "warehouse_ops_kpi_almacen_mes" },
];

describe("migración 334: forma del helper y de las seis funciones", () => {
  it("el helper existe: security definer, search_path fijo, y no lo puede llamar anon ni authenticated", () => {
    const h = cuerpo(MIGRACION, "warehouse_ops_es_gerente");
    expect(h).toContain("(p_uid uuid)");
    expect(h).toContain("returns boolean");
    expect(h).toContain("security definer set search_path = public");
    expect(h).toContain("p.role = 'manager' or 'warehouse_ops_manager' = any(coalesce(p.permissions, '{}'))");
    expect(h).toContain("where p.id = p_uid");
    expect(MIGRACION).toContain("revoke all on function public.warehouse_ops_es_gerente(uuid) from public, anon, authenticated;");
    expect(MIGRACION).not.toMatch(/grant execute on function public\.warehouse_ops_es_gerente/);
  });

  it.each(SEIS)("$nombre: redefinida, usa el helper y no conserva la prueba de rol de gerente", ({ nombre }) => {
    const f = cuerpo(MIGRACION, nombre);
    expect(f).toContain("public.warehouse_ops_es_gerente(");
    expect(f).not.toContain("p.role = 'manager'");
    expect(f).not.toContain("v_role = 'manager'");
  });

  it.each(SEIS)("$nombre: fuera de la prueba de gerente, es idéntica a su última versión", ({ archivo, nombre }) => {
    const nueva = cuerpo(MIGRACION, nombre);
    const previa = cuerpo(SQL_PREVIO(archivo), nombre);
    const revertida = nueva
      .split("public.warehouse_ops_es_gerente(p.id)").join("p.role = 'manager'")
      .split("coalesce(public.warehouse_ops_es_gerente(auth.uid()), false)").join("coalesce(v_role = 'manager', false)");
    expect(revertida).toBe(previa);
  });

  it("la migración no aplica nada a mano: sin inserción en el libro, con la línea para el dueño", () => {
    expect(MIGRACION.split("-- @ledger-below")[1].trim().startsWith("insert into public.schema_migrations")).toBe(true);
    expect(MIGRACION).toContain("-- @ledger-below");
  });
});
