import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ROLE_CAPS, ROLE_ORDER, canCreate } from "./constants";
import { puedeSerVendedor, vendedoresDeLaTienda, vendedoresParaLaOrden } from "./sales-reps";
import type { Profile, UserRole } from "./types";

/**
 * El desplegable de «Vendedor» ofrece los de la tienda de la orden (D-290).
 *
 * El caso que lo pidió: un gerente que además vende no podía elegirse a sí mismo, porque la lista era
 * `users.filter((u) => u.role === "sales")`. Aquí se fija lo contrario, y sobre todo que **la lista no
 * se quede vacía nunca**: un campo obligatorio sin opciones no se puede rellenar.
 *
 * Quién califica no se escribe dos veces: la primera prueba compara `puedeSerVendedor`, rol por rol,
 * con `ROLE_CAPS` —la tabla de capacidades de la app—, así que si mañana alguien le quita `create` a un
 * rol, la lista de vendedores se entera aquí y no en producción.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const modal = leer("src/components/OrderModal.tsx");

/** Con acceso a Entregas salvo que se diga lo contrario: sin él nadie es asignable (D-299). */
const persona = (
  id: string, full_name: string, role: UserRole, store: string | null,
  permissions: string[] | null = null, module_access: string[] | null = ["deliveries"],
): Profile => ({ id, full_name, role, store, permissions, module_access }) as Profile;

/** Una plantilla parecida a la real: dos tiendas, una de ellas sin nadie de ventas. */
const GENTE: Profile[] = [
  persona("v-norte-b", "Bea Vendedora", "sales", "Tienda Norte"),
  persona("v-norte-a", "Ana Vendedora", "sales", "Tienda Norte"),
  persona("g-norte", "Gerente Norte", "manager", "Tienda Norte"),
  persona("v-sur", "Sara Vendedora", "sales", "Tienda Sur"),
  persona("g-oeste", "Gerente Oeste", "manager", "Tienda Oeste"),
  persona("alm-norte", "Almacén Norte", "warehouse", "Tienda Norte"),
  persona("cho-norte", "Chofer Norte", "driver", "Tienda Norte"),
  persona("log", "Logística", "logistics", null),
  persona("admin", "Admin", "admin", null),
  persona("v-sin-tienda", "Zoe Sin Tienda", "sales", null),
];
const nombres = (l: Profile[]) => l.map((u) => u.full_name);

describe("quién puede ser vendedor", () => {
  /**
   * **Esta parte la revisa D-299.** D-290 usó `canCreate` —quien puede registrar órdenes— y el dueño
   * lo corrigió al verlo: «me están saliendo todos los usuarios y solo deberían ser sales people o
   * managers». Lo que D-290 resolvió sigue resuelto: el gerente que vende entra, por ser `manager`.
   */
  it("es sales o manager, rol por rol, y ya no todo el que puede crear órdenes", () => {
    for (const rol of ROLE_ORDER) {
      const u = persona("x", "X", rol, "Tienda Norte");
      expect([rol, puedeSerVendedor(u)]).toEqual([rol, rol === "sales" || rol === "manager"]);
    }
    // Y la regla vieja ya no vale: office y admin pueden crear y NO son asignables.
    for (const rol of ["accounting", "admin"] as UserRole[]) {
      const u = persona("x", "X", rol, "Tienda Norte");
      expect([rol, canCreate(u), puedeSerVendedor(u)]).toEqual([rol, true, false]);
      expect([rol, ROLE_CAPS[rol].includes("create")]).toEqual([rol, true]);
    }
  });

  it("en concreto: el gerente que vende entra; office, almacén, chofer y logística no", () => {
    expect(puedeSerVendedor(persona("g", "G", "manager", "Tienda Norte"))).toBe(true);
    expect(puedeSerVendedor(persona("v", "V", "sales", "Tienda Norte"))).toBe(true);
    expect(puedeSerVendedor(persona("o", "O", "accounting", "Tienda Norte"))).toBe(false);
    expect(puedeSerVendedor(persona("a", "A", "warehouse", "Tienda Norte"))).toBe(false);
    expect(puedeSerVendedor(persona("c", "C", "driver", "Tienda Norte"))).toBe(false);
    expect(puedeSerVendedor(persona("l", "L", "logistics", "Tienda Norte"))).toBe(false);
  });

  it("y el permiso suelto de «crear» ya no basta: es el rol lo que se mira", () => {
    // Medido en producción el 2026-09-17: una cuenta de logística tiene ese permiso suelto. Con la
    // regla de D-290 era asignable; con esta, no.
    expect(puedeSerVendedor(persona("l", "L", "logistics", "Tienda Norte", ["create"]))).toBe(false);
  });

  it("quien no puede abrir Entregas no es asignable, aunque venda", () => {
    // Es la misma pregunta que hace la base (`has_deliveries_access()`, 083): acreditarle una orden a
    // quien no puede verla deja la orden sin dueño que la atienda.
    expect(puedeSerVendedor(persona("v", "V", "sales", "Tienda Norte", null, []))).toBe(false);
    expect(puedeSerVendedor(persona("v", "V", "sales", "Tienda Norte", null, null))).toBe(false);
    expect(puedeSerVendedor(persona("v", "V", "sales", "Tienda Norte", null, ["recruiting"]))).toBe(false);
    expect(puedeSerVendedor(persona("g", "G", "manager", "Tienda Norte", null, ["deliveries", "recruiting"]))).toBe(true);
  });
});

describe("la lista que se ofrece", () => {
  it("son los de la tienda de la orden, en orden alfabético", () => {
    expect(nombres(vendedoresParaLaOrden(GENTE, "Tienda Norte"))).toEqual(["Ana Vendedora", "Bea Vendedora", "Gerente Norte"]);
  });

  it("una tienda sin ventas ofrece a su gerente, que es justo el caso que lo pidió", () => {
    expect(nombres(vendedoresParaLaOrden(GENTE, "Tienda Oeste"))).toEqual(["Gerente Oeste"]);
  });

  it("no se cuela nadie de otra tienda, ni el almacén o el chofer de la suya", () => {
    const lista = nombres(vendedoresParaLaOrden(GENTE, "Tienda Norte"));
    for (const fuera of ["Sara Vendedora", "Gerente Oeste", "Almacén Norte", "Chofer Norte", "Zoe Sin Tienda", "Admin"]) {
      expect([fuera, lista.includes(fuera)]).toEqual([fuera, false]);
    }
  });

  it("quien no tiene tienda no sale en ninguna tienda", () => {
    // Medido: 3 cuentas de ventas están sin tienda asignada (2026-09-17). Con la regla del dueño
    // —«solo los vendedores de esa tienda»— dejan de aparecer, y eso es lo correcto, no un olvido.
    for (const tienda of ["Tienda Norte", "Tienda Sur", "Tienda Oeste"]) {
      expect([tienda, nombres(vendedoresParaLaOrden(GENTE, tienda)).includes("Zoe Sin Tienda")]).toEqual([tienda, false]);
    }
    expect(nombres(vendedoresDeLaTienda(GENTE, null))).toEqual([]);
  });

  it("el nombre de la tienda se compara sin importar espacios ni mayúsculas", () => {
    expect(nombres(vendedoresParaLaOrden(GENTE, "  tienda norte "))).toEqual(["Ana Vendedora", "Bea Vendedora", "Gerente Norte"]);
  });
});

describe("la lista nunca se queda sin opciones", () => {
  // Sin Admin desde D-299: puede crear órdenes, pero no es vendedor.
  const TODOS = ["Ana Vendedora", "Bea Vendedora", "Gerente Norte", "Gerente Oeste", "Sara Vendedora", "Zoe Sin Tienda"];

  it("si la orden aún no tiene tienda, se ofrecen todos los asignables", () => {
    expect(nombres(vendedoresParaLaOrden(GENTE, null))).toEqual(TODOS);
    expect(nombres(vendedoresParaLaOrden(GENTE, ""))).toEqual(TODOS);
  });

  it("si la tienda de la orden no tiene a nadie, también — un obligatorio sin opciones no se rellena", () => {
    // Red de seguridad, no el camino normal: medido el 2026-09-17, las seis tiendas tienen al menos a
    // una persona que puede crear órdenes, Weslaco incluida (su gerente).
    expect(nombres(vendedoresParaLaOrden(GENTE, "Tienda Que No Existe"))).toEqual(TODOS);
    expect(vendedoresParaLaOrden([], "Tienda Norte")).toEqual([]);
  });

  it("y el vendedor ya puesto sigue en la lista aunque no cumpla (D-267)", () => {
    const conForastero = nombres(vendedoresParaLaOrden(GENTE, "Tienda Norte", "v-sur"));
    expect(conForastero).toContain("Sara Vendedora");
    expect(conForastero).toEqual(["Ana Vendedora", "Bea Vendedora", "Gerente Norte", "Sara Vendedora"]);
    // Ni se duplica cuando sí cumple, ni se inventa a nadie cuando el id no existe.
    expect(nombres(vendedoresParaLaOrden(GENTE, "Tienda Norte", "v-norte-a"))).toEqual(["Ana Vendedora", "Bea Vendedora", "Gerente Norte"]);
    expect(nombres(vendedoresParaLaOrden(GENTE, "Tienda Norte", "fantasma"))).toEqual(["Ana Vendedora", "Bea Vendedora", "Gerente Norte"]);
  });

  it("alguien que ya no puede crear, pero está puesto en la orden, se conserva", () => {
    // Un vendedor que pasó a almacén: su orden vieja no puede quedarse con el selector vacío.
    const conAlmacen = nombres(vendedoresParaLaOrden(GENTE, "Tienda Norte", "alm-norte"));
    expect(conAlmacen).toEqual(["Almacén Norte", "Ana Vendedora", "Bea Vendedora", "Gerente Norte"]);
  });
});

describe("el formulario usa esa regla, y la de la tienda de la orden", () => {
  it("el desplegable se alimenta de la función compartida, con `d.store`", () => {
    expect(modal).toContain("const salesReps = useMemo(() => vendedoresParaLaOrden(users, d.store, d.assigned_sales_rep, settings.stores), [users, d.store, d.assigned_sales_rep, settings.stores]);");
    // La tienda que manda es la de la orden: `me.store` aquí sería la de quien mira, que puede estar
    // registrando una orden vendida desde otra tienda.
    expect(modal).not.toContain("vendedoresParaLaOrden(users, me.store");
  });

  it("ya no queda el filtro viejo por rol", () => {
    expect(modal).not.toContain('users.filter((u) => u.role === "sales")');
  });

  it("y avisa cuando lo que enseña es el respaldo", () => {
    expect(modal).toContain("const tiendaSinVendedores = !!d.store && vendedoresDeLaTienda(users, d.store, settings.stores).length === 0;");
    expect(modal).toContain("Esta tienda no tiene a nadie asignado");
  });

  it("no cambia quién está obligado a elegir vendedor", () => {
    // Sigue siendo solo la orden nueva, y los mismos roles: este encargo cambia la lista, no la regla.
    expect(modal).toContain('const needsSalesRep = isNew && (ordersLikeOfficeManager(me.role) || me.role === "admin" || me.role === "driver")');
  });
});
