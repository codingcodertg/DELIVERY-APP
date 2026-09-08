import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EVENTO_DEJADO, escrituraDejarEnTienda, puedeDejarEnTienda } from "./leave-at-store";

// El caso del dueño: el chofer lleva el pedido en el camión, no puede entregarlo y lo descarga en
// una tienda del grupo; otro lo recoge DESDE AHÍ y lo entrega. Lo que se prueba aquí es lo que
// acaba en la base — qué se escribe y a quién se le ofrece.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const t = (en: string) => en;   // las pruebas leen el inglés; el español va aparte
const TIENDA = { name: "Tienda Centro", address: "100 Main St, McAllen, TX" };
const CHOFER = { role: "driver", full_name: "Ana Ruiz" };

const enCamion = {
  stage: "picked_up",
  assigned_driver: "Ana Ruiz",
  store: "Tienda Norte",
  pickup_lat: 25.9012,
  pickup_lng: -97.4934,
  pickup_gps_at: "2026-09-08T14:00:00.000Z",
};

describe("a quién se le ofrece dejar el pedido en una tienda", () => {
  it("al chofer que lo lleva, con el pedido en el camión", () => {
    expect(puedeDejarEnTienda(enCamion, CHOFER, true)).toBe(true);
  });
  it("solo en `picked_up`: antes no hay nada que descargar, después nada que devolver", () => {
    for (const stage of ["draft", "pending", "approved", "fulfilling", "ready", "delivered", "canceled", null, undefined]) {
      expect(puedeDejarEnTienda({ ...enCamion, stage }, CHOFER, true), String(stage)).toBe(false);
    }
  });
  it("un chofer NO descarga el camión de otro", () => {
    expect(puedeDejarEnTienda({ ...enCamion, assigned_driver: "Otro Chofer" }, CHOFER, true)).toBe(false);
    expect(puedeDejarEnTienda({ ...enCamion, assigned_driver: null }, CHOFER, true)).toBe(false);
    expect(puedeDejarEnTienda(enCamion, { role: "driver", full_name: null }, true)).toBe(false);
  });
  it("almacén y admin sí pueden, incluso si el pedido no tiene chofer", () => {
    // Alguien lo tiene físicamente; no poder soltarlo lo dejaría atascado en el camión de nadie.
    for (const rol of ["warehouse", "admin", "manager"]) {
      expect(puedeDejarEnTienda({ ...enCamion, assigned_driver: null }, { role: rol, full_name: "X" }, true), rol).toBe(true);
    }
  });
  it("quien no puede mover la etapa, no puede: ningún permiso nuevo", () => {
    // El segundo argumento es el `canDeliver` que ya decide «Marcar entregado». Esta acción no
    // abre una puerta propia: si no podías mover el pedido, sigues sin poder.
    expect(puedeDejarEnTienda(enCamion, CHOFER, false)).toBe(false);
    expect(puedeDejarEnTienda(enCamion, { role: "sales", full_name: "V" }, false)).toBe(false);
  });
});

describe("qué se escribe: el origen cambia de verdad", () => {
  const { patch, note } = escrituraDejarEnTienda({ pedido: enCamion, tienda: TIENDA, me: CHOFER, t });

  it("el origen pasa a ser la tienda donde se dejó", () => {
    expect(patch.store).toBe("Tienda Centro");
    expect(patch.pickup_name).toBe("Tienda Centro");
  });
  it("`pickup_address` se BORRA, y ese es el punto entero", () => {
    // El origen de las millas es una cascada: `pickup_address` gana, y si no la hay se usa la
    // dirección guardada de la tienda. Cambiar solo `store` dejaría un pedido con dirección
    // explícita saliendo del sitio viejo **en silencio** — el fallo que esto evita.
    expect(patch.pickup_address).toBeNull();
    // Y no se copia la dirección de la tienda dentro del pedido: sigue habiendo una sola copia,
    // en Ajustes. Si la tienda se muda, el pedido la sigue.
    expect(patch.pickup_address).not.toBe(TIENDA.address);
  });
  it("vuelve a estar disponible: sin chofer", () => {
    expect(patch.assigned_driver).toBeNull();
  });
  it("las millas y la duración se borran, no se recalculan ni se dejan mintiendo", () => {
    // Recalcular gastaría cuota de Google Routes en cada descarga; dejarlas enseñaría un número
    // contado desde donde el pedido ya no está. Se borran: el siguiente pulsa «Calcular».
    expect(patch.route_miles).toBeNull();
    expect(patch.route_duration).toBeNull();
  });
  it("los sellos del viaje abandonado se limpian, como ya hace el reparto de una orden parcial", () => {
    // `departed_at` puesto le diría al segundo chofer «en camino desde» una hora ajena y le
    // quitaría el botón de iniciar viaje; y `analytics.ts` le apuntaría a él el viaje del primero.
    expect(patch.departed_at).toBeNull();
    expect(patch.arrived_at).toBeNull();
    expect(patch.pickup_lat).toBeNull();
    expect(patch.pickup_lng).toBeNull();
    expect(patch.pickup_gps_at).toBeNull();
  });
  it("NO toca nada más: ni la tarifa cobrada, ni pallets, ni fotos, ni el pin de la entrega", () => {
    // La lista completa, cerrada. Si mañana alguien añade un campo aquí, esta prueba lo canta —
    // que es lo que hace falta cuando lo que se escribe acaba en la base.
    expect(Object.keys(patch).sort()).toEqual([
      "arrived_at", "assigned_driver", "departed_at", "pickup_address", "pickup_gps_at",
      "pickup_lat", "pickup_lng", "pickup_name", "route_duration", "route_miles", "store",
    ]);
    for (const campo of ["delivery_fee", "actual_pallets", "est_pallets", "photos", "delivery_lat", "delivery_pin_source", "stage"]) {
      expect(patch, campo).not.toHaveProperty(campo);
    }
  });
  it("la etapa NO la pone el parche: la mueve `setStage`, que es quien comprueba la transición", () => {
    expect(patch).not.toHaveProperty("stage");
  });
});

describe("el rastro: un pedido que cambia de sitio sin rastro es un pedido perdido", () => {
  it("la nota dice dónde, quién y de dónde venía", () => {
    const { note } = escrituraDejarEnTienda({ pedido: enCamion, tienda: TIENDA, me: CHOFER, t });
    expect(note).toContain("Tienda Centro");
    expect(note).toContain("Ana Ruiz");
    expect(note).toContain("origin changed from Tienda Norte");
  });
  it("guarda dónde se recogió la primera vez, porque ese GPS se borra del pedido", () => {
    // Es la única copia que sobrevive: el campo se limpia aquí y lo sobrescribiría igualmente la
    // siguiente recogida.
    const { note } = escrituraDejarEnTienda({ pedido: enCamion, tienda: TIENDA, me: CHOFER, t });
    expect(note).toContain("25.90120");
    expect(note).toContain("-97.49340");
  });
  it("sin GPS de recogida, la nota no inventa coordenadas", () => {
    const sinGps = { ...enCamion, pickup_lat: null, pickup_lng: null };
    const { note } = escrituraDejarEnTienda({ pedido: sinGps, tienda: TIENDA, me: CHOFER, t });
    expect(note).not.toContain("first pickup at");
    expect(note).toContain("Tienda Centro");
  });
  it("dejarlo en su propia tienda de origen no dice que el origen cambió", () => {
    const { note, patch } = escrituraDejarEnTienda({
      pedido: enCamion, tienda: { name: "Tienda Norte", address: "x" }, me: CHOFER, t,
    });
    expect(note).not.toContain("origin changed");
    expect(patch.store).toBe("Tienda Norte");   // se escribe igual: el resto del gesto sí aplica
  });
  it("sin nombre de quien lo deja, cae al chofer asignado antes que a «alguien»", () => {
    const { note } = escrituraDejarEnTienda({ pedido: enCamion, tienda: TIENDA, me: null, t });
    expect(note).toContain("Ana Ruiz");
  });
  it("la nota existe en los dos idiomas, entera — no medio traducida", () => {
    // El hub no tiene diccionario de claves: cada texto lleva sus dos idiomas en el propio `t`
    // (D-220). Si alguien añade un trozo a la nota y olvida el español, aquí se ve.
    const es = (_en: string, esp: string) => esp;
    const { note } = escrituraDejarEnTienda({ pedido: enCamion, tienda: TIENDA, me: CHOFER, t: es });
    expect(note).toContain("Dejado en Tienda Centro");
    expect(note).toContain("origen cambiado desde Tienda Norte");
    expect(note).toContain("primera recogida en");
    expect(note).toContain("vuelve a la lista para otro chofer");
    expect(note).not.toMatch(/Left at|origin changed|first pickup|back on the board/);
  });
  it("el evento tiene nombre propio y se queda para siempre", () => {
    // `kind` es texto en `order_events`, así que no hace falta migración; pero se elige una vez.
    // En inglés, como `created` / `edited` / `geocode_failed`.
    expect(EVENTO_DEJADO).toBe("dropped_at_store");
  });
});

describe("el cableado: un solo control, dos pantallas, cero permisos nuevos", () => {
  const control = leer("src/components/LeaveAtStore.tsx");
  const modal = leer("src/components/OrderModal.tsx");
  const ruta = leer("src/app/(app)/my-route/page.tsx");
  const provider = leer("src/lib/data-provider.tsx");

  it("la ficha y Mi ruta usan el MISMO control", () => {
    // Copiarlo daría dos gestos con el mismo nombre y distinto efecto, y este escribe en la base.
    for (const [nombre, src] of [["modal", modal], ["mi ruta", ruta]] as const) {
      expect(src, nombre).toContain('from "@/components/LeaveAtStore"');
      expect(src, nombre).toContain("<LeaveAtStore");
    }
  });
  it("el control no decide permisos por su cuenta: usa `canDeliver` y el módulo puro", () => {
    expect(control).toContain("puedeDejarEnTienda(pedido, me, canDeliver(me))");
    expect(control).toContain('from "@/lib/constants"');
    // Y no inventa su propia tabla de roles.
    expect(control).not.toMatch(/role === "(admin|manager|warehouse)"/);
  });
  it("la guarda de transición que ya existía no se toca ni se relaja", () => {
    // `picked_up → ready` ya era legal; el encargo no era cambiar quién mueve etapas.
    expect(leer("src/lib/constants.ts")).toContain('picked_up:  ["delivered", "ready"]');
    expect(provider).toContain('if (current && me?.role !== "admin" && !canTransition(current.stage, stage))');
  });
  it("el gesto pasa por `setStage`, con su `kind` propio y el parche del módulo", () => {
    expect(control).toContain("escrituraDejarEnTienda({ pedido, tienda: elegida, me, t })");
    expect(control).toContain('setStage(pedido.id, "ready", note, patch, EVENTO_DEJADO)');
    // `kind` es opcional y por defecto sigue siendo la etapa: nada de lo que ya existía cambia.
    expect(provider).toContain("void logEvent(id, kind ?? stage, note);");
  });
  it("la tienda se compara con `nombreNormalizado`, no con una tercera forma nueva", () => {
    expect(control).toContain('from "@/lib/store-pins"');
    expect(control).toContain("nombreNormalizado(s.name) === buscada");
  });
  it("no hay texto libre: la tienda sale de `settings.stores`", () => {
    expect(control).toContain("settings.stores.map((s) => (");
    expect(control).not.toMatch(/<input[^>]*tienda/i);
  });
  it("se pide la tienda ANTES de mover nada", () => {
    // Un «dejado» sin decir dónde es justo el pedido perdido que esto viene a evitar.
    expect(control).toContain("if (!elegida) return;");
    const antes = control.indexOf("if (!elegida) return;");
    expect(antes).toBeGreaterThan(0);
    expect(antes).toBeLessThan(control.indexOf("setStage(pedido.id"));
  });
});
