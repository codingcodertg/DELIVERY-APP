import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INFO_DE_NIVEL, esAsociado, tiposPermitidos, nivelDe } from "./nivel";
import { vistaPermitida, type Vista } from "./puerta";
import { puedeCorregirMerma, puedeExportar, puedeVerReporte, veLosReportes, veReportesDeLaTienda, type Quien } from "./visibilidad";
import { veMantenimiento } from "./mantenimiento";
import { veConteos } from "./conteos";

/**
 * 17 nov: el Associate (nivel `scrap_only`, «Associate (Deliveries + scrap)»). Usa las pantallas de almacén de Deliveries
 * y LLENA merma; ve SOLO sus propios reportes de merma. Sin reportes de otros, sin KPI, sin dashboards, sin conteos
 * de inventario, sin mantenimiento, sin configuración. La base (migración 324) aplica lo mismo; el test lee el SQL.
 */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");
const SQL324 = leer("supabase/migrations/324_warehouse_associate.sql");

// Un Associate tal como lo deja el hub: rol `warehouse`, casilla de la app, sin nivel escrito (manda el rol: scrap_only).
const asociado: Quien = { id: "w1", role: "warehouse", store: "RDZ McAllen", visible_stores: [], module_access: ["deliveries", "warehouse_ops"] };
const asociadoEscrito: Quien = { ...asociado, warehouse_ops_role: "scrap_only" };
const otroDelPiso = "w2";
const gerente: Quien = { id: "g", role: "manager", store: "RDZ McAllen", module_access: ["deliveries", "warehouse_ops"] };
const supervisorFull: Quien = { id: "s", role: "warehouse", store: "RDZ McAllen", permissions: ["warehouse_ops_supervisor"], module_access: ["warehouse_ops"], warehouse_ops_role: "full" };
const admin: Quien = { id: "a", role: "admin", module_access: [] };

const reporte = (kind: "scrap" | "incident" | "maintenance", store: string, author_id: string) => ({ kind, store, author_id });

describe("Associate (scrap_only, 17 nov)", () => {
  it("la etiqueta del selector de Usuarios es la misma en los dos idiomas", () => {
    expect(INFO_DE_NIVEL.scrap_only.en).toBe("Associate (Deliveries + scrap)");
    expect(INFO_DE_NIVEL.scrap_only.es).toBe("Associate (Deliveries + scrap)");
  });

  it("es Associate el nivel scrap_only, con o sin nivel escrito; el resto no", () => {
    expect(esAsociado(asociado)).toBe(true);
    expect(esAsociado(asociadoEscrito)).toBe(true);
    expect(esAsociado(supervisorFull)).toBe(false);
    expect(esAsociado(gerente)).toBe(false);
    expect(esAsociado(admin)).toBe(false);
    expect(esAsociado({ ...asociado, module_access: [] })).toBe(false);
  });

  it("llena solo merma, y entra a su inicio, al formulario de merma y a «Mis reportes»", () => {
    expect(nivelDe(asociado)).toBe("scrap_only");
    expect(tiposPermitidos(asociado)).toEqual(["scrap"]);
    expect(vistaPermitida(asociado, { v: "inicio" })).toBe(true);
    expect(vistaPermitida(asociado, { v: "nuevo", tipo: "scrap" })).toBe(true);
    expect(vistaPermitida(asociado, { v: "mios" })).toBe(true);
  });

  it("solo ve SUS propios reportes de merma: ni los de su tienda, ni los de otros, ni otros tipos", () => {
    expect(puedeVerReporte(asociado, reporte("scrap", asociado.store!, asociado.id))).toBe(true);
    expect(puedeVerReporte(asociado, reporte("scrap", asociado.store!, otroDelPiso))).toBe(false);
    expect(puedeVerReporte(asociado, reporte("scrap", "RDZ Pharr", otroDelPiso))).toBe(false);
    expect(puedeVerReporte(asociado, reporte("incident", asociado.store!, asociado.id))).toBe(false);
    expect(puedeVerReporte(asociado, reporte("maintenance", asociado.store!, asociado.id))).toBe(false);
  });

  it("no tiene la vista de reportes de la tienda, ni gerencia, ni KPI, ni exportar, ni corregir merma", () => {
    expect(veReportesDeLaTienda(asociado)).toBe(false);
    expect(veLosReportes(asociado)).toBe(false);
    expect(puedeExportar(asociado)).toBe(false);
    expect(puedeCorregirMerma(asociado, { kind: "scrap", store: asociado.store! })).toBe(false);
    expect(vistaPermitida(admin, { v: "reportes" })).toBe(true);
  });

  it("sin mantenimiento ni conteos de inventario, ni en el inicio ni con la URL escrita a mano", () => {
    expect(veMantenimiento(asociado)).toBe(false);
    expect(veConteos(asociado)).toBe(false);
    const vistas: Vista[] = [{ v: "mantenimiento" }, { v: "conteos" }];
    for (const v of vistas) expect(vistaPermitida(asociado, v), v.v).toBe(false);
  });

  it("el permiso de supervisor no le sube nada si su nivel es solo merma", () => {
    const sup: Quien = { ...asociado, permissions: ["warehouse_ops_supervisor"] };
    expect(veLosReportes(sup)).toBe(false);
    expect(veReportesDeLaTienda(sup)).toBe(false);
    expect(puedeVerReporte(sup, reporte("scrap", sup.store!, otroDelPiso))).toBe(false);
  });

  it("el resto no cambia: el supervisor de almacén (full) sigue viendo la merma de su tienda y la vista de tienda", () => {
    expect(veReportesDeLaTienda(supervisorFull)).toBe(true);
    expect(puedeVerReporte(supervisorFull, reporte("scrap", supervisorFull.store!, otroDelPiso))).toBe(true);
    expect(puedeVerReporte(supervisorFull, reporte("scrap", "RDZ Pharr", otroDelPiso))).toBe(false);
    expect(veMantenimiento(supervisorFull)).toBe(true);
    expect(veConteos(supervisorFull)).toBe(true);
  });
});

describe("324: la base aplica lo mismo", () => {
  it("el archivo existe con el nombre que registra el ledger y el marcador va pegado al cuerpo", () => {
    expect(SQL324).toContain("end $chk$;\n-- @ledger-below\n");
    expect(SQL324).toContain("insert into public.schema_migrations (name, checksum) values ('324_warehouse_associate.sql',");
  });

  it("warehouse_ops_can_see: scrap_only aparece UNA vez (solo lo suyo); la rama de la tienda (292) ya no está", () => {
    const f = SQL324.slice(SQL324.indexOf("create or replace function public.warehouse_ops_can_see"), SQL324.indexOf("$function$;"));
    expect(f.split("'scrap_only'").length - 1).toBe(1);
    expect(f).toContain("(n.nivel = 'scrap_only' and r_author = p.id");
  });

  it("warehouse_ops_in_store no cuenta a scrap_only (equipo, listas, refacciones, uso y conteos)", () => {
    const f = SQL324.slice(SQL324.indexOf("create or replace function public.warehouse_ops_in_store"), SQL324.indexOf("revoke all on function public.warehouse_ops_in_store"));
    expect(f).toContain("not in ('', 'scrap_only')");
  });

  it("warehouse_ops_people (selector de merma) no pasa por in_store: sigue dando la gente de la tienda a cualquier nivel", () => {
    const f = SQL324.slice(SQL324.indexOf("create or replace function public.warehouse_ops_people"), SQL324.indexOf("revoke all on function public.warehouse_ops_people"));
    expect(f).not.toContain("warehouse_ops_in_store");
    expect(f).toContain("p.visible_stores");
  });
});
