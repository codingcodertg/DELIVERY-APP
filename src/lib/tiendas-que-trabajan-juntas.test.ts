import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { grupoDeLaTienda, mismaTiendaOGrupo, tiendasDelGrupo, trabajaConOtras } from "./store-group";
import { vendedoresDeLaTienda, vendedoresParaLaOrden } from "./sales-reps";
import { registroDeLugar } from "./named-location";
import type { NamedLocation, Profile, UserRole } from "./types";

/**
 * Dos tiendas que trabajan juntas (D-293).
 *
 * El dueño: «no, no como una tienda; siempre 2 tiendas, pero ambos employees mirarán las órdenes de
 * ambas». Así que lo que se comparte es el trabajo, no la identidad: la orden conserva su tienda.
 *
 * Las pruebas van **por tienda, no por rol**, que es donde está el riesgo: abrir de más haría que un
 * vendedor de una tercera tienda viera las dos agrupadas. Aquí las tiendas se llaman Norte, Sur y
 * Oeste: los nombres reales son datos del dueño y viven en Ajustes, no en el repo.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const modal = leer("src/components/OrderModal.tsx");
const almacen = leer("src/app/(app)/warehouse/page.tsx");
const rutas = leer("src/app/(app)/routes/page.tsx");
const datos = leer("src/app/(app)/data/page.tsx");

/** Norte y Sur trabajan juntas; Oeste va sola aunque tenga el mismo código de directorio que ellas. */
const TIENDAS: NamedLocation[] = [
  { name: "Tienda Norte", address: "100 Norte Ave", group: "G1", directory_code: "RFT" },
  { name: "Tienda Sur", address: "200 Sur Blvd", group: "G1", directory_code: "RFT" },
  { name: "Tienda Oeste", address: "300 Oeste Rd", directory_code: "RFT" },
];
/** Con acceso a Entregas: sin él no es asignable como vendedor (D-299). */
const persona = (id: string, full_name: string, role: UserRole, store: string | null): Profile =>
  ({ id, full_name, role, store, permissions: null, module_access: ["deliveries"] }) as Profile;

describe("quién trabaja con quién", () => {
  it("una tienda agrupada trae a las dos; la de al lado, solo a ella", () => {
    expect(tiendasDelGrupo("Tienda Norte", TIENDAS).sort()).toEqual(["Tienda Norte", "Tienda Sur"]);
    expect(tiendasDelGrupo("Tienda Sur", TIENDAS).sort()).toEqual(["Tienda Norte", "Tienda Sur"]);
    expect(tiendasDelGrupo("Tienda Oeste", TIENDAS)).toEqual(["Tienda Oeste"]);
  });

  it("el código de directorio NO agrupa: las tres lo comparten y Oeste sigue sola", () => {
    // El campo cosmético del directorio no puede decidir quién ve qué (por eso el grupo es su propia
    // clave). Si algún día alguien los confunde, esta prueba cae.
    expect(TIENDAS.every((s) => s.directory_code === "RFT")).toBe(true);
    expect(tiendasDelGrupo("Tienda Oeste", TIENDAS)).toEqual(["Tienda Oeste"]);
    expect(mismaTiendaOGrupo("Tienda Oeste", "Tienda Norte", TIENDAS)).toBe(false);
  });

  it("sin grupo en ninguna tienda, todo queda como antes", () => {
    const sinGrupos = TIENDAS.map(({ group: _g, ...resto }) => resto);
    for (const s of sinGrupos) expect(tiendasDelGrupo(s.name, sinGrupos)).toEqual([s.name]);
    expect(mismaTiendaOGrupo("Tienda Norte", "Tienda Sur", sinGrupos)).toBe(false);
    expect(trabajaConOtras("Tienda Norte", sinGrupos)).toBe(false);
    expect(grupoDeLaTienda("Tienda Norte", sinGrupos)).toBeNull();
  });

  it("una tienda sola con un grupo que no comparte nadie sigue sola", () => {
    const rara: NamedLocation[] = [{ name: "Tienda Norte", address: "x", group: "solo_yo" }];
    expect(tiendasDelGrupo("Tienda Norte", rara)).toEqual(["Tienda Norte"]);
    expect(trabajaConOtras("Tienda Norte", rara)).toBe(false);
  });

  it("el nombre se compara sin importar espacios ni mayúsculas, y «sin tienda» no empareja", () => {
    expect(tiendasDelGrupo("  tienda norte ", TIENDAS).sort()).toEqual(["Tienda Norte", "Tienda Sur"]);
    expect(tiendasDelGrupo(null, TIENDAS)).toEqual([]);
    expect(mismaTiendaOGrupo(null, null, TIENDAS)).toBe(false);
    expect(mismaTiendaOGrupo("", "", TIENDAS)).toBe(false);
  });

  it("una tienda que ya no está en Ajustes se compara consigo misma", () => {
    // Una orden vieja de una tienda borrada no puede dejar de ser de su tienda.
    expect(tiendasDelGrupo("Tienda Borrada", TIENDAS)).toEqual(["Tienda Borrada"]);
    expect(mismaTiendaOGrupo("Tienda Borrada", "Tienda Borrada", TIENDAS)).toBe(true);
  });
});

describe("el vendedor asignable se presta entre las dos, y solo entre esas dos", () => {
  const GENTE: Profile[] = [
    persona("n1", "Ana Norte", "sales", "Tienda Norte"),
    persona("s1", "Sara Sur", "sales", "Tienda Sur"),
    persona("o1", "Olga Oeste", "sales", "Tienda Oeste"),
  ];
  const nombres = (l: Profile[]) => l.map((u) => u.full_name);

  it("una orden de una de las dos ofrece a las dos", () => {
    expect(nombres(vendedoresParaLaOrden(GENTE, "Tienda Norte", null, TIENDAS))).toEqual(["Ana Norte", "Sara Sur"]);
    expect(nombres(vendedoresParaLaOrden(GENTE, "Tienda Sur", null, TIENDAS))).toEqual(["Ana Norte", "Sara Sur"]);
  });

  it("y la tienda de al lado no ve a ninguna de las dos, ni ellas a ella", () => {
    expect(nombres(vendedoresParaLaOrden(GENTE, "Tienda Oeste", null, TIENDAS))).toEqual(["Olga Oeste"]);
    expect(nombres(vendedoresParaLaOrden(GENTE, "Tienda Norte", null, TIENDAS))).not.toContain("Olga Oeste");
  });

  it("sin la lista de tiendas se comporta como antes de esta decisión", () => {
    // La firma la añade D-293 con un valor por defecto: quien no la pase sigue teniendo el de D-290.
    expect(nombres(vendedoresParaLaOrden(GENTE, "Tienda Norte"))).toEqual(["Ana Norte"]);
    expect(nombres(vendedoresDeLaTienda(GENTE, "Tienda Norte"))).toEqual(["Ana Norte"]);
  });
});

describe("el grupo se guarda en Ajustes, no en el código", () => {
  it("se escribe cuando hay valor y se borra la clave cuando se vacía", () => {
    const con = registroDeLugar(undefined, { name: "Tienda Norte", address: "100 Norte Ave", group: " G1 " }, { directoryCode: true });
    expect(con.group).toBe("G1");
    const sin = registroDeLugar(undefined, { name: "Tienda Norte", address: "100 Norte Ave", group: "  " }, { directoryCode: true });
    expect("group" in sin).toBe(false);
  });

  it("el admin lo edita en Datos, con su propia casilla y su aviso", () => {
    expect(datos).toContain("onChange={(e) => setDraft({ ...draft, group: e.target.value })}");
    expect(datos).toContain('{t("Works together with", "Trabaja junto con")}');
    // Y queda dicho ahí mismo que no es el código de directorio.
    expect(datos).toContain("No es el código de directorio.");
  });

  it("ningún nombre de tienda del dueño vive en el código", () => {
    // Por PALABRAS, no por subcadena: «permissions» contiene «mission» y hacía fallar el barrido
    // ingenuo. Lo que se busca es el nombre suelto, que es como aparecería si alguien lo clavara.
    const palabras = (s: string) => new Set(s.toLowerCase().split(/[^a-z]+/));
    for (const [nombre, src] of [["store-group", leer("src/lib/store-group.ts")], ["modal", modal], ["almacén", almacen]] as const) {
      expect([...palabras(src)], nombre).not.toContain("mcallen");
      expect([...palabras(src)], nombre).not.toContain("mission");
    }
  });
});

describe("dónde se comparte el trabajo", () => {
  it("almacén: la cola es la del grupo para quien está fijado, y la elegida para quien elige", () => {
    expect(almacen).toContain("(lockedToOwnStore ? tiendasDelGrupo(me?.store, settings.stores) : effectiveStore ? [effectiveStore] : [])");
    expect(almacen).toContain('if (tiendasDeLaCola.includes(d.store ?? "")) return true;');
    expect(almacen).toContain("if (tiendasDeLaCola.length > 0 && !atStore(d)) return false;");
  });

  it("la ficha: se puede vender desde la otra, y el selector solo queda fijo si no hay grupo", () => {
    expect(modal).toContain("me.role !== \"sales\" || !me.store");
    expect(modal).toContain("todas.filter((n) => mismaTiendaOGrupo(n, me.store, settings.stores) || n === d.store)");
    expect(modal).toContain('const origenFijo = me.role === "sales" && !!me.store && !homeIsDestination && !trabajaConOtras(me.store, settings.stores);');
    // Y desde D-302 se congela también en un tipo que recibe, donde su tienda vende y recibe.
    expect(modal).toContain("disabled={!salesFields || origenFijo || tiendaCongelada}");
  });

  it("rutas: la sugerencia de chofer mira el grupo, y sigue siendo sugerencia", () => {
    expect(rutas).toContain("const sameStore = drivers.filter((u) => mismaTiendaOGrupo(u.store, d.store, settings.stores)).map((u) => u.full_name);");
    // El respaldo de siempre: si nadie del grupo tiene hueco, cualquiera.
    expect(rutas).toContain("const pick = sameStore.find(hasRoom) ?? sameStore[0]");
  });

  it("y lo que NO cambia: la orden sigue teniendo su tienda y la lista no se cierra", () => {
    const listaOrdenes = leer("src/app/(app)/page.tsx");
    // Nadie ha metido un corte por tienda en la lista de Órdenes: sigue sin haber ninguno.
    expect(listaOrdenes).not.toContain("tiendasDelGrupo(");
    expect(listaOrdenes).not.toContain("mismaTiendaOGrupo(");
    // Y la tienda de origen se sigue escribiendo tal cual en la orden.
    expect(modal).toContain("eligeOrigen(p, v, settings.stores)");
  });
});
