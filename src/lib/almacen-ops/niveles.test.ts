import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INFO_DE_NIVEL, NIVELES, SECCIONES, esAdminDeLaApp, leerNivelEscrito, nivelDe, nivelPorDefecto, puedeLlenar, tiposPermitidos } from "./nivel";
import { tiendasPara, vistaPermitida, type Vista } from "./puerta";
import { puedeCorregirMerma, puedeVerReporte, veLosReportes, type Quien } from "./visibilidad";
import { TIPOS, type TipoDeReporte } from "./tipos";
import { MODULE_ACCESS } from "@/lib/constants";

/**
 * D-NEXT (migración 265): niveles de Warehouse Ops. El dueño: «francis tiene acceso mismo que admin a todo, y los de
 * warehouse por ahora solo veran la parte de scrap solamente»; y luego «francis solo pharr».
 * La regla vive dos veces (aquí para pintar, en la base para hacerla cumplir); estas pruebas leen el SQL para que no
 * se separen.
 */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");
const SQL = leer("supabase/migrations/265_warehouse_ops_niveles.sql");

// La gente real, tal como queda al aplicar la 265.
const francis: Quien = { id: "francis", role: "manager", store: "RDZ Pharr", visible_stores: ["RDZ Pharr"], module_access: ["deliveries", "warehouse_ops"], warehouse_ops_role: "store_admin" };
const almacen: Quien = { id: "w1", role: "warehouse", store: "RDZ McAllen", module_access: ["deliveries", "warehouse_ops"], warehouse_ops_role: "scrap_only" };
const almacenSinNivel: Quien = { id: "w2", role: "warehouse", store: "RDZ Pharr", module_access: ["warehouse_ops"] };
const admin: Quien = { id: "a", role: "admin", module_access: [] };
const gerente: Quien = { id: "g", role: "manager", store: "RDZ Edinburg", module_access: ["warehouse_ops"] };
const ventas: Quien = { id: "v", role: "sales", store: "RDZ Pharr", module_access: ["warehouse_ops"] };
const sinModulo: Quien = { id: "x", role: "warehouse", store: "RDZ Pharr", module_access: ["deliveries"] };

const LOS_OTROS_SEIS = TIPOS.filter((k) => k !== "scrap");
const reporte = (kind: TipoDeReporte, store: string, author_id: string) => ({ kind, store, author_id });

describe("el nivel de cada quien", () => {
  it("admin del hub: admin siempre, con o sin casilla, escriba lo que escriba la columna", () => {
    expect(nivelDe(admin)).toBe("admin");
    expect(nivelDe({ ...admin, warehouse_ops_role: "scrap_only" })).toBe("admin");
  });
  it("sin la casilla no hay nivel, aunque la columna diga admin", () => {
    expect(nivelDe(sinModulo)).toBeNull();
    expect(nivelDe({ ...sinModulo, warehouse_ops_role: "admin" })).toBeNull();
    expect(tiposPermitidos({ ...sinModulo, warehouse_ops_role: "admin" })).toEqual([]);
  });
  it("sin nivel escrito manda el rol del hub: almacén = solo merma; los demás = todos los reportes", () => {
    expect(nivelDe(almacenSinNivel)).toBe("scrap_only");
    expect(nivelDe(gerente)).toBe("full");
    expect(nivelDe(ventas)).toBe("full");
    for (const rol of ["manager", "logistics", "sales", "office", "driver"]) expect(nivelPorDefecto(rol)).toBe("full");
    expect(nivelPorDefecto("warehouse")).toBe("scrap_only");
  });
  it("un nivel escrito gana al rol del hub; un valor desconocido no cuenta", () => {
    expect(nivelDe({ ...almacenSinNivel, warehouse_ops_role: "full" })).toBe("full");
    expect(nivelDe({ ...ventas, warehouse_ops_role: "scrap_only" })).toBe("scrap_only");
    expect(nivelDe({ ...ventas, warehouse_ops_role: "jefe" })).toBe("full");
  });
});

describe("el personal de almacén: solo merma", () => {
  for (const q of [almacen, almacenSinNivel]) {
    it(`${q.id}: una sola sección, la merma`, () => {
      expect(tiposPermitidos(q)).toEqual(["scrap"]);
      expect(puedeLlenar(q, "scrap")).toBe(true);
      for (const k of LOS_OTROS_SEIS) expect(puedeLlenar(q, k), k).toBe(false);
      expect(veLosReportes(q)).toBe(false);
      expect(esAdminDeLaApp(q)).toBe(false);
    });
    it(`${q.id}: la URL escrita a mano de otro formulario o de la vista de gerentes no abre`, () => {
      for (const k of LOS_OTROS_SEIS) expect(vistaPermitida(q, { v: "nuevo", tipo: k }), k).toBe(false);
      expect(vistaPermitida(q, { v: "reportes" })).toBe(false);
      expect(vistaPermitida(q, { v: "nuevo", tipo: "scrap" })).toBe(true);
      expect(vistaPermitida(q, { v: "mios" })).toBe(true);
      expect(vistaPermitida(q, { v: "inicio" })).toBe(true);
    });
    it(`${q.id}: ve SUS mermas y nada más (ni un incidente suyo de antes, ni la merma de otro)`, () => {
      expect(puedeVerReporte(q, reporte("scrap", q.store!, q.id))).toBe(true);
      expect(puedeVerReporte(q, reporte("scrap", q.store!, "otro"))).toBe(false);
      expect(puedeVerReporte(q, reporte("incident", q.store!, q.id))).toBe(false);
      expect(puedeVerReporte(q, reporte("maintenance", q.store!, q.id))).toBe(false);
      expect(puedeVerReporte(q, reporte("insubordination", q.store!, q.id))).toBe(false);
      expect(puedeCorregirMerma(q, { kind: "scrap", store: q.store! })).toBe(false);
    });
  }
  it("el permiso de supervisor no le abre nada mientras su nivel sea solo merma", () => {
    const sup = { ...almacen, permissions: ["warehouse_ops_supervisor"] };
    expect(veLosReportes(sup)).toBe(false);
    expect(puedeVerReporte(sup, reporte("scrap", "RDZ McAllen", "otro"))).toBe(false);
    expect(puedeCorregirMerma(sup, { kind: "scrap", store: "RDZ McAllen" })).toBe(false);
  });
  it("sin el módulo no entra a nada", () => {
    const vistas: Vista[] = [{ v: "nuevo", tipo: "scrap" }, { v: "mios" }, { v: "reportes" }];
    for (const v of vistas) expect(vistaPermitida(sinModulo, v), v.v).toBe(false);
  });
});

describe("Francis: admin de la app, solo en su tienda (la del hub, no una escrita aquí)", () => {
  it("todos los formularios y la vista de gerentes", () => {
    expect(nivelDe(francis)).toBe("store_admin");
    expect(esAdminDeLaApp(francis)).toBe(true);
    expect(tiposPermitidos(francis)).toEqual([...TIPOS]);
    for (const k of TIPOS) expect(vistaPermitida(francis, { v: "nuevo", tipo: k }), k).toBe(true);
    expect(vistaPermitida(francis, { v: "reportes" })).toBe(true);
    expect(veLosReportes(francis)).toBe(true);
  });
  it("en Pharr ve y corrige todo, de cualquier autor, también lo de RR. HH.", () => {
    for (const k of TIPOS) expect(puedeVerReporte(francis, reporte(k, "RDZ Pharr", "otro")), k).toBe(true);
    expect(puedeCorregirMerma(francis, { kind: "scrap", store: "RDZ Pharr" })).toBe(true);
  });
  it("fuera de Pharr no ve ni corrige nada, ni lo que hubiera llenado él", () => {
    for (const k of TIPOS) {
      expect(puedeVerReporte(francis, reporte(k, "RDZ McAllen", "otro")), k).toBe(false);
      expect(puedeVerReporte(francis, reporte(k, "RDZ McAllen", "francis")), k).toBe(false);
    }
    expect(puedeCorregirMerma(francis, { kind: "scrap", store: "RDZ McAllen" })).toBe(false);
  });
  it("solo se le ofrece su tienda para llenar y filtrar; a los demás, todas", () => {
    const tiendas = ["RDZ McAllen", "RDZ Pharr", "RDZ Edinburg"];
    expect(tiendasPara(francis, tiendas)).toEqual(["RDZ Pharr"]);
    expect(tiendasPara(admin, tiendas)).toEqual(tiendas);
    expect(tiendasPara(almacen, tiendas)).toEqual(tiendas);
  });
  it("la tienda sale de su asignación del hub: cambiársela lo mueve aquí también", () => {
    const movido = { ...francis, store: "RDZ McAllen", visible_stores: ["RDZ McAllen"] };
    expect(puedeVerReporte(movido, reporte("incident", "RDZ McAllen", "otro"))).toBe(true);
    expect(puedeVerReporte(movido, reporte("incident", "RDZ Pharr", "otro"))).toBe(false);
  });
  it("pasarlo a «admin» le abre todas las tiendas (es el único cambio)", () => {
    const todo = { ...francis, warehouse_ops_role: "admin" };
    expect(puedeVerReporte(todo, reporte("insubordination", "RDZ McAllen", "otro"))).toBe(true);
    expect(puedeCorregirMerma(todo, { kind: "scrap", store: "RDZ Brownsville" })).toBe(true);
    expect(tiendasPara(todo, ["A", "B"])).toEqual(["A", "B"]);
  });
});

describe("los demás quedan como estaban", () => {
  it("el admin del hub: todo, en todas las tiendas", () => {
    expect(tiposPermitidos(admin)).toEqual([...TIPOS]);
    for (const k of TIPOS) expect(puedeVerReporte(admin, reporte(k, "RDZ Weslaco", "otro")), k).toBe(true);
    expect(puedeCorregirMerma(admin, { kind: "scrap", store: "RDZ Weslaco" })).toBe(true);
    expect(veLosReportes(admin)).toBe(true);
  });
  it("un gerente con el módulo: los siete, lo de su tienda (también RR. HH.) y corrige la merma de su tienda", () => {
    expect(tiposPermitidos(gerente)).toEqual([...TIPOS]);
    expect(puedeVerReporte(gerente, reporte("insubordination", "RDZ Edinburg", "otro"))).toBe(true);
    expect(puedeVerReporte(gerente, reporte("safety", "RDZ Pharr", "otro"))).toBe(false);
    expect(puedeCorregirMerma(gerente, { kind: "scrap", store: "RDZ Edinburg" })).toBe(true);
    expect(veLosReportes(gerente)).toBe(true);
  });
  it("cualquier otro rol con el módulo: los siete y solo lo suyo que no es de RR. HH.", () => {
    expect(tiposPermitidos(ventas)).toEqual([...TIPOS]);
    expect(puedeVerReporte(ventas, reporte("incident", "RDZ Pharr", "v"))).toBe(true);
    expect(puedeVerReporte(ventas, reporte("incident", "RDZ Pharr", "otro"))).toBe(false);
    expect(puedeVerReporte(ventas, reporte("positive", "RDZ Pharr", "v"))).toBe(false);
    expect(veLosReportes(ventas)).toBe(false);
  });
  it("RR. HH. sin el módulo sigue viendo los de RR. HH. de todas las tiendas, y no llena nada", () => {
    const rrhh: Quien = { id: "h", role: "office", recruiting_role: "manager" };
    expect(puedeVerReporte(rrhh, reporte("zone", "RDZ Pharr", "otro"))).toBe(true);
    expect(puedeVerReporte(rrhh, reporte("scrap", "RDZ Pharr", "otro"))).toBe(false);
    expect(vistaPermitida(rrhh, { v: "reportes" })).toBe(true);
    expect(vistaPermitida(rrhh, { v: "nuevo", tipo: "scrap" })).toBe(false);
    expect(vistaPermitida(rrhh, { v: "mios" })).toBe(false);
  });
});

describe("la base dice lo mismo (migración 265)", () => {
  it("los niveles del check son los de la app", () => {
    const lista = /warehouse_ops_role in \(([^)]+)\)\);/.exec(SQL)![1].split(",").map((x) => x.trim().replace(/'/g, ""));
    expect(lista).toEqual([...NIVELES]);
    expect(Object.keys(INFO_DE_NIVEL).sort()).toEqual([...NIVELES].sort());
  });
  it("warehouse_ops_kinds_of abre, nivel por nivel, lo mismo que SECCIONES", () => {
    for (const n of NIVELES) {
      const m = new RegExp(`when '${n}' then array\\[([^\\]]+)\\]`).exec(SQL);
      expect(m, n).not.toBeNull();
      const tipos = m![1].split(",").map((x) => x.trim().replace(/'/g, ""));
      expect(tipos.sort(), n).toEqual([...SECCIONES[n].tipos].sort());
    }
    expect(SQL).toContain("else array[]::text[]");
  });
  it("el nivel efectivo: admin del hub, luego la casilla, luego lo escrito, luego el rol del hub", () => {
    const f = SQL.slice(SQL.indexOf("function public.warehouse_ops_level_of"), SQL.indexOf("function public.warehouse_ops_level()"));
    const orden = ["when p.role = 'admin' then 'admin'", "when not ('warehouse_ops' = any(coalesce(p.module_access, '{}'))) then null",
      "when p.warehouse_ops_role is not null then p.warehouse_ops_role", "when p.role = 'warehouse' then 'scrap_only'", "else 'full'"];
    const pos = orden.map((x) => f.indexOf(x));
    expect(pos.every((p) => p > 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });
  it("el servidor rechaza a quien solo tiene merma en los otros formularios: un guardia BEFORE INSERT en la tabla", () => {
    expect(SQL).toMatch(/create trigger warehouse_reports_guard_kind before insert on public\.warehouse_reports\s+for each row execute function public\.guard_warehouse_report_kind\(\)/);
    const g = SQL.slice(SQL.indexOf("create or replace function public.guard_warehouse_report_kind"), SQL.indexOf("create trigger warehouse_reports_guard_kind"));
    expect(g).toContain("not (NEW.kind = any(public.warehouse_ops_kinds_of(public.warehouse_ops_level())))");
    expect(g).toContain("errcode = '42501'");
    // Y al admin «solo en sus tiendas», un reporte de otra tienda.
    expect(g).toContain("public.warehouse_ops_level() = 'store_admin'");
    expect(g).toContain("p.store = NEW.store or NEW.store = any(coalesce(p.visible_stores, '{}'))");
  });
  it("la RLS: solo merma ve lo SUYO de los tipos que abre; store_admin, solo su tienda; admin, todo", () => {
    const f = SQL.slice(SQL.indexOf("function public.warehouse_ops_can_see"), SQL.indexOf("function public.warehouse_ops_can_manage"));
    expect(f).toContain("n.nivel = 'admin'");
    expect(f).toContain("or (n.nivel = 'store_admin' and t.mia)");
    expect(f).toContain("(n.nivel = 'scrap_only' and r_author = p.id and r_kind = any(public.warehouse_ops_kinds_of(n.nivel)))");
    expect(f).toContain("or (n.nivel = 'full' and p.role = 'manager' and t.mia)");
    expect(f).toContain("p.recruiting_role in ('admin', 'manager')");
    expect(f).toContain("(p.store = r_store or r_store = any(coalesce(p.visible_stores, '{}'))) is true as mia");
    expect(f).not.toContain("p.role = 'admin'");
  });
  it("las dos correcciones de merma pasan por warehouse_ops_can_manage, que limita la tienda", () => {
    expect(SQL.match(/if yo is null or not public\.warehouse_ops_can_manage\(r\.store\) then/g) ?? []).toHaveLength(2);
    const f = SQL.slice(SQL.indexOf("function public.warehouse_ops_can_manage"), SQL.indexOf("function public.warehouse_ops_edit_scrap_product"));
    expect(f).toContain("or (n.nivel = 'store_admin' and t.mia)");
    expect(f).toContain("or (n.nivel = 'full' and t.mia");
    expect(f).not.toContain("scrap_only");
  });
  it("nadie se pone el nivel a sí mismo, y nadie pregunta el de otro", () => {
    expect(SQL).toContain("or NEW.warehouse_ops_role is distinct from OLD.warehouse_ops_role");
    expect(SQL).toContain("or NEW.customers_role     is distinct from OLD.customers_role");
    expect(SQL).toContain("revoke all on function public.warehouse_ops_level_of(uuid) from public, anon, authenticated;");
  });
  it("activa a la gente real: Francis por su usuario como store_admin, y el rol warehouse como solo merma", () => {
    expect(SQL).toContain("set warehouse_ops_role = 'store_admin',");
    expect(SQL).toContain("where username = 'flestarpe'");
    expect(SQL).toMatch(/set warehouse_ops_role = coalesce\(warehouse_ops_role, 'scrap_only'\),[\s\S]+?where role = 'warehouse' and left_at is null/);
    expect(SQL).not.toMatch(/insert into (auth\.users|public\.profiles)/);
    // La tienda no va escrita: sale de la asignación del hub.
    expect(SQL.split("-- 5. Activar")[1].split("-- Autocomprobacion")[0]).not.toMatch(/store\s*=\s*'|visible_stores\s*=/);
  });
  it("lleva su registro", () => {
    expect(SQL).toContain("-- @ledger-below");
    expect(SQL).toContain("values ('265_warehouse_ops_niveles.sql', '");
    expect(SQL).not.toContain("D-NEXT");
  });
});

describe("la pantalla", () => {
  const pagina = leer("src/app/operaciones/[[...ruta]]/page.tsx");
  const pantalla = leer("src/app/operaciones/Operaciones.tsx");
  it("la página del servidor comprueba la ruta antes de pintar y devuelve al inicio", () => {
    expect(pagina).not.toContain('"use client"');
    expect(pagina).toContain("vistaPermitida(");
    expect(pagina).toContain('redirect("/operaciones")');
    expect(pagina.indexOf("vistaPermitida(")).toBeLessThan(pagina.indexOf("<Operaciones"));
  });
  it("lo que importa el servidor no trae React", () => {
    for (const f of ["src/lib/almacen-ops/nivel.ts", "src/lib/almacen-ops/puerta.ts", "src/lib/almacen-ops/visibilidad.ts", "src/lib/almacen-ops/tipos.ts"]) {
      const src = leer(f);
      expect(src, f).not.toMatch(/from "react"/);
      expect(src, f).not.toContain('"use client"');
    }
  });
  it("el inicio pinta solo las tarjetas que el nivel abre; con una sola, sin tablero", () => {
    expect(pantalla).toContain("tiposPermitidos(ctx.yo)");
    expect(pantalla).not.toMatch(/\bTIPOS\.map\(/);
    expect(pantalla).toContain("ops-tarjeta-unica");
    expect(pantalla).toContain("{llena && !unico && (");
    expect(pantalla).toContain("if (!vistaPermitida(ctx.yo, vista)) return <Inicio ctx={ctx} />;");
  });
  it("el nivel se lee aparte y con tolerancia: sin la 265 aplicada, manda el rol del hub", async () => {
    const sinColumna = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: "42703", message: "column profiles.warehouse_ops_role does not exist" } }) }) }) }) };
    expect(await leerNivelEscrito(sinColumna, "u")).toBeNull();
    const conNivel = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { warehouse_ops_role: "store_admin" }, error: null }) }) }) }) };
    expect(await leerNivelEscrito(conNivel, "u")).toBe("store_admin");
    const revienta = { from: () => { throw new Error("red"); } };
    expect(await leerNivelEscrito(revienta, "u")).toBeNull();
    // Y la lista de usuarios del hub no lleva la columna en su select principal (la tumbaría en todas las apps).
    const proveedor = leer("src/lib/data-provider.tsx");
    const principal = /\.from\("profiles"\)\.select\("(id, full_name, username[^"]+)"\)/.exec(proveedor)![1];
    expect(principal).not.toContain("warehouse_ops_role");
    expect(proveedor).toContain('.select("id, warehouse_ops_role")');
  });
});

describe("Usuarios: el admin cambia el nivel sin tocar código", () => {
  const m = MODULE_ACCESS.find((x) => x.key === "warehouse_ops")!;
  it("el módulo declara su columna y sus niveles", () => {
    expect(m.roleColumn).toBe("warehouse_ops_role");
    expect(m.roleKeys).toEqual([...NIVELES]);
    expect(m.accessColumn).toBe("module_access");
    for (const n of NIVELES) {
      expect(m.roleLabel(n, "en")).toBe(INFO_DE_NIVEL[n].en);
      expect(m.roleLabel(n, "es")).toBe(INFO_DE_NIVEL[n].es);
    }
    // La frase de los permisos finos le pasa un rol del hub: no revienta.
    expect(m.roleLabel("manager", "en")).toBeTruthy();
  });
  it("sin nivel escrito enseña el que la base aplicará, y al admin del hub se le fija", () => {
    expect(m.roleDefault?.("warehouse")).toBe("scrap_only");
    expect(m.roleDefault?.("manager")).toBe("full");
    expect(m.roleFixedFor?.("admin")).toBe("admin");
    expect(m.roleFixedFor?.("manager")).toBeUndefined();
  });
  it("el diálogo escribe el nivel en SU columna y la casilla no lo toca", () => {
    const dlg = leer("src/components/UserDialog.tsx");
    expect(dlg).toContain("updateUserWarehouseOpsRole(u.id, roleValue);");
    expect(dlg).toContain("updateUserWarehouseOpsAccess(u.id, { granted });");
    const prov = leer("src/lib/data-provider.tsx");
    expect(prov).toContain('.update({ warehouse_ops_role: nivel }).eq("id", userId)');
    expect(prov).toContain('"warehouse_ops_role_changed"');
  });
});
