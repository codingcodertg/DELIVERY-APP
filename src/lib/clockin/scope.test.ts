import { describe, it, expect } from "vitest";
import { visibleStores } from "./scope";

// D-127. Esta regla existía desde hacía meses y NUNCA se aplicaba: la condición era
// `role === "manager"` y `clockin.profiles` solo emitía "owner" o "employee", así que todo el
// que entraba veía la empresa entera. Ahora que el nivel existe, la regla se fija con pruebas
// — es la que separa lo que ve una tienda de lo que ve otra.
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";

describe("visibleStores", () => {
  it("el dueño no está acotado", () => {
    expect(visibleStores("owner", A, [B])).toBeNull();
  });

  it("un empleado tampoco se acota por aquí", () => {
    // Lo suyo lo limita RLS y su propia pantalla, no este cálculo de tiendas.
    expect(visibleStores("employee", A, [])).toBeNull();
  });

  it("un gerente con tienda ve la suya", () => {
    expect(visibleStores("manager", A, [])).toEqual([A]);
  });

  it("y las que se le conceden, con la suya siempre incluida", () => {
    expect(visibleStores("manager", A, [B, C])).toEqual([A, B, C]);
  });

  it("no duplica si le conceden la suya", () => {
    expect(visibleStores("manager", A, [A, B])).toEqual([A, B]);
  });

  it("un gerente SIN tienda no se queda sin ver a nadie", () => {
    // Es el fallo fácil: acotar a una lista vacía dejaría a la persona sin cuadrilla y
    // parecería que la app está rota, cuando lo que falta es configurarle la tienda.
    expect(visibleStores("manager", null, [])).toBeNull();
  });

  it("una lista extra ausente se trata como vacía", () => {
    expect(visibleStores("manager", A, null)).toEqual([A]);
    expect(visibleStores("manager", A, undefined)).toEqual([A]);
  });
});
