import { describe, expect, it } from "vitest";
import { coincidenciasDe, motivoDeCoincidenciaLabel } from "./coincidencias";
import { claveDeEmpresa, DIRECCIONES_DE_UN_DOMINIO_COMPARTIDO, type FilaDeCliente } from "./duplicados";
import { TIENDAS } from "./reglas";

/**
 * D-665 (2026-10-23). El dueño: «make an alert that says hey this information matches another account so we don't have
 * duplicated». Las reglas son las de `duplicados.ts` (D-633); aquí, datos que las CONTRADIGAN: la forma distinta que es
 * el mismo nombre, el mismo teléfono con otro formato, el correo gratuito que no prueba nada, el dominio compartido, la
 * propia empresa. Nombres inventados; tiendas por referencia a `TIENDAS`.
 */
const [A, B, C] = TIENDAS.map((x) => x.code);
let n = 0;
const fila = (c: Partial<FilaDeCliente>): FilaDeCliente => {
  const id = ++n;
  return { id, store: A, account: `Nada Que Ver ${id}`, unified_account: null, phone: null, email: null, archived_at: null, company_id: `e${id}`, ...c };
};
const ids = (r: { fila: FilaDeCliente }[]) => r.map((x) => x.fila.id);

describe("mismo nombre (OBVIO): las formas no distinguen", () => {
  it("«L.L.C.» = «LLC», «&» = «and», y mayúsculas y espacios dan igual", () => {
    const llc = fila({ account: "Acme Builders LLC" });
    const and = fila({ account: "H and A Tile" });
    const lista = [fila({}), llc, and];
    const r1 = coincidenciasDe({ account: "ACME  BUILDERS L.L.C." }, lista);
    expect(ids(r1)).toEqual([llc.id]);
    expect(r1[0]).toMatchObject({ motivos: ["nombre"], obvia: true, soloParecido: false });
    expect(ids(coincidenciasDe({ account: "h & a tile" }, lista))).toEqual([and.id]);
  });
  it("la misma cuenta unificada también es obvia; un nombre de una letra no se parece a nada", () => {
    const u = fila({ account: "Otro Nombre", unified_account: "Grupo Demo" });
    const una = fila({ account: "A" });
    expect(coincidenciasDe({ account: "Distinto", unified_account: "GRUPO  DEMO" }, [u])[0]).toMatchObject({ motivos: ["cuenta_unificada"], obvia: true });
    expect(coincidenciasDe({ account: "A" }, [una])).toEqual([]);
  });
});

describe("mismo teléfono y mismo correo", () => {
  it("el teléfono con otro formato (y con el 1 delante) es el mismo; otro número, no", () => {
    const t = fila({ phone: "956.555.0199" });
    expect(coincidenciasDe({ phone: "+1 (956) 555-0199" }, [t])[0]).toMatchObject({ motivos: ["telefono"], obvia: false, soloParecido: false });
    expect(coincidenciasDe({ phone: "(956) 555-0198" }, [t])).toEqual([]);
  });
  it("correo gratuito: la MISMA dirección cuenta, otra del mismo dominio no; y por muchos que haya, su dominio nunca es «compartido»", () => {
    const muchos = Array.from({ length: DIRECCIONES_DE_UN_DOMINIO_COMPARTIDO + 1 }, (_, i) => fila({ email: `persona${i}@gmail.com` }));
    expect(coincidenciasDe({ email: "PERSONA0@gmail.com" }, muchos).map((c) => [c.fila.id, c.motivos])).toEqual([[muchos[0].id, ["correo"]]]);
    expect(coincidenciasDe({ email: "otra@gmail.com" }, muchos)).toEqual([]);
  });
  it("un dominio propio con muchas direcciones (compartido) NO cuenta; con menos, sí", () => {
    const compartido = Array.from({ length: DIRECCIONES_DE_UN_DOMINIO_COMPARTIDO }, (_, i) => fila({ email: `v${i}@vendedor.example` }));
    expect(coincidenciasDe({ email: "v0@vendedor.example" }, compartido)).toEqual([]);
    const pocos = compartido.slice(1);
    expect(ids(coincidenciasDe({ email: "v1@vendedor.example" }, pocos))).toEqual([pocos[0].id]);
  });
});

describe("parecido (SOSPECHOSO, con menos peso)", () => {
  it("un nombre casi igual o contenido en el otro: «se parece», no obvio", () => {
    const casi = fila({ account: "Acme Builders" });
    const contiene = fila({ account: "Acme Signature Homes" });
    expect(coincidenciasDe({ account: "Acme Builder" }, [casi])[0]).toMatchObject({ motivos: ["nombre_parecido"], obvia: false, soloParecido: true });
    expect(coincidenciasDe({ account: "Acme Homes" }, [contiene])[0]).toMatchObject({ motivos: ["nombre_contenido"], soloParecido: true });
  });
  it("lo obvio va antes que el dato, y el dato antes que el parecido, aunque en la lista vengan al revés", () => {
    const parecido = fila({ account: "Demo Tiles Group" });
    const telefono = fila({ account: "Zeta", phone: "9565550111" });
    const nombre = fila({ account: "Demo Tile Group" });
    expect(ids(coincidenciasDe({ account: "Demo Tile Group", phone: "956-555-0111" }, [parecido, telefono, nombre]))).toEqual([nombre.id, telefono.id, parecido.id]);
  });
});

describe("qué queda fuera, y una por empresa", () => {
  it("la propia empresa no cuenta (al editar); otra empresa con el mismo nombre, sí", () => {
    const yo = fila({ account: "Demo Mia", company_id: "mia" });
    const yoOtraTienda = fila({ account: "Demo Mia", store: B, company_id: "mia" });
    const otra = fila({ account: "Demo Mia", store: C });
    expect(ids(coincidenciasDe({ account: "Demo Mia" }, [yo, yoOtraTienda, otra], { excluirEmpresa: claveDeEmpresa(yo) }))).toEqual([otra.id]);
    expect(coincidenciasDe({ account: "Demo Mia" }, [yo, yoOtraTienda, otra])).toHaveLength(2);
  });
  it("las archivadas no son clientes: no salen", () => {
    expect(coincidenciasDe({ account: "Demo Vieja" }, [fila({ account: "Demo Vieja", archived_at: "2026-10-16T00:00:00Z" })])).toEqual([]);
  });
  it("una empresa en dos tiendas sale UNA vez, con sus tiendas en orden y los motivos juntos; la fila, la del nombre", () => {
    const porTel = fila({ account: "Otra Cosa", store: C, phone: "9565550122", company_id: "dos" });
    const porNombre = fila({ account: "Demo Doble Inc", store: A, company_id: "dos" });
    const r = coincidenciasDe({ account: "Demo Doble", phone: "(956) 555-0122" }, [porTel, porNombre]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ empresa: "dos", tiendas: [A, C], motivos: ["nombre", "telefono"], obvia: true });
    expect(r[0].fila.id).toBe(porNombre.id);
  });
  it("cada motivo se dice", () => {
    const t = (_en: string, es: string) => es;
    expect(motivoDeCoincidenciaLabel("nombre", t)).toBe("mismo nombre");
    expect(motivoDeCoincidenciaLabel("telefono", t)).toBe("mismo teléfono");
    expect(motivoDeCoincidenciaLabel("correo", t)).toBe("mismo correo");
  });
});
