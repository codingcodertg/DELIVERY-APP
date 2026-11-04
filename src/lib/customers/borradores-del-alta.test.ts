import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contactoVacio } from "./contactos";
import { redesEnEdicion } from "./redes";
import { claveDelBorradorDelAlta, type BorradorDelAlta } from "./borrador-del-alta";
import {
  borraBorrador, borradoresDe, claveDeLosBorradores, guardaBorrador, leeBorradores, MAX_BORRADORES, nombreDelBorrador, resumenDelBorrador,
  type AlmacenDelNavegador,
} from "./borradores-del-alta";

/**
 * D-NEXT: Roberto Rodriguez Jr (admin), 2026-11-04, tras D-847: «show the list of the drafts separately so you can have
 * many». Varios borradores por persona, en una lista aparte, en este navegador.
 */
const memoria = () => {
  const m = new Map<string, string>();
  const almacen: AlmacenDelNavegador = () => ({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) });
  return { m, almacen };
};
const ids = (prefijo = "b") => { let n = 0; return () => `${prefijo}${++n}`; };
const borrador = (cambios: Partial<BorradorDelAlta> = {}): BorradorDelAlta => ({
  guardado: "2026-11-04T18:48:00.000Z",
  form: { account: "ACME TILE", terms: "", store: "MCA" },
  contactos: [{ ...contactoVacio(), name: "OMAR", address: "123 TEST DR RGV" }],
  redes: redesEnEdicion({}),
  tiendas: ["MCA"],
  ...cambios,
});
const t = (en: string, es: string) => `${en}|${es}`;

describe("borradores del alta: guardar, actualizar, borrar", () => {
  it("la clave es otra que la de D-847 y lleva el id de la persona", () => {
    expect(claveDeLosBorradores("u1")).toBe("rtg_customers_new_drafts_u1");
    expect(claveDeLosBorradores("u1")).not.toBe(claveDelBorradorDelAlta("u1"));
    expect(claveDeLosBorradores("u1")).not.toBe(claveDeLosBorradores("u2"));
  });
  it("sin id crea uno nuevo cada vez: caben varios, el más reciente primero; otra persona no los ve", () => {
    const { almacen } = memoria();
    const nuevo = ids();
    expect(guardaBorrador(almacen, "u1", borrador(), null, nuevo)).toEqual({ ok: true, id: "b1", creado: true });
    expect(guardaBorrador(almacen, "u1", borrador({ guardado: "2026-11-04T19:00:00.000Z", form: { account: "BETA" } }), null, nuevo)).toEqual({ ok: true, id: "b2", creado: true });
    const lista = leeBorradores(almacen, "u1");
    expect(lista.map((b) => b.id)).toEqual(["b2", "b1"]);
    expect(lista[1]).toEqual({ id: "b1", ...borrador() });
    expect(leeBorradores(almacen, "u2")).toEqual([]);
  });
  it("con el id de uno que está, lo ACTUALIZA (no crea otro) y sube arriba", () => {
    const { almacen } = memoria();
    const nuevo = ids();
    guardaBorrador(almacen, "u1", borrador(), null, nuevo);
    guardaBorrador(almacen, "u1", borrador({ guardado: "2026-11-04T19:00:00.000Z", form: { account: "BETA" } }), null, nuevo);
    const r = guardaBorrador(almacen, "u1", borrador({ guardado: "2026-11-04T20:00:00.000Z", form: { account: "ACME TILE LLC" } }), "b1", nuevo);
    expect(r).toEqual({ ok: true, id: "b1", creado: false });
    const lista = leeBorradores(almacen, "u1");
    expect(lista.map((b) => [b.id, b.form.account])).toEqual([["b1", "ACME TILE LLC"], ["b2", "BETA"]]);
  });
  it("con un id que ya no está (borrado en otra pestaña), crea uno nuevo", () => {
    const { almacen } = memoria();
    expect(guardaBorrador(almacen, "u1", borrador(), "ya-no", ids())).toEqual({ ok: true, id: "b1", creado: true });
  });
  it("borrar quita SOLO ese; al quitar el último, la clave desaparece", () => {
    const { m, almacen } = memoria();
    const nuevo = ids();
    guardaBorrador(almacen, "u1", borrador(), null, nuevo);
    guardaBorrador(almacen, "u1", borrador({ form: { account: "BETA" } }), null, nuevo);
    expect(borraBorrador(almacen, "u1", "b1")).toBe(true);
    expect(leeBorradores(almacen, "u1").map((b) => b.id)).toEqual(["b2"]);
    expect(borraBorrador(almacen, "u1", "no-existe")).toBe(true);
    expect(borraBorrador(almacen, "u1", "b2")).toBe(true);
    expect(m.has(claveDeLosBorradores("u1"))).toBe(false);
  });
});

describe("borradores del alta: el tope", () => {
  const lleno = () => {
    const { m, almacen } = memoria();
    const nuevo = ids();
    for (let i = 0; i < MAX_BORRADORES; i++) {
      expect(guardaBorrador(almacen, "u1", borrador({ guardado: new Date(Date.UTC(2026, 10, 4, 0, i)).toISOString() }), null, nuevo).ok).toBe(true);
    }
    return { m, almacen, nuevo };
  };
  it(`son ${MAX_BORRADORES}, un número sensato`, () => {
    expect(MAX_BORRADORES).toBe(50);
  });
  it("al llegar, uno NUEVO no se guarda y se dice por qué; no se tira ninguno a escondidas", () => {
    const { m, almacen, nuevo } = lleno();
    const antes = m.get(claveDeLosBorradores("u1"));
    expect(guardaBorrador(almacen, "u1", borrador({ form: { account: "EL 51" } }), null, nuevo)).toEqual({ ok: false, motivo: "tope" });
    expect(m.get(claveDeLosBorradores("u1"))).toBe(antes);
    expect(leeBorradores(almacen, "u1")).toHaveLength(MAX_BORRADORES);
  });
  it("lleno, actualizar uno que ya está sí se puede", () => {
    const { almacen, nuevo } = lleno();
    expect(guardaBorrador(almacen, "u1", borrador({ guardado: "2026-11-05T00:00:00.000Z", form: { account: "CAMBIADO" } }), "b7", nuevo)).toEqual({ ok: true, id: "b7", creado: false });
    expect(leeBorradores(almacen, "u1")[0]).toMatchObject({ id: "b7", form: { account: "CAMBIADO" } });
  });
});

describe("borradores del alta: el navegador que no deja", () => {
  it("leer da la lista vacía; guardar dice «almacen»; borrar dice false; nada lanza", () => {
    const roto: AlmacenDelNavegador = () => { throw new Error("SecurityError"); };
    expect(leeBorradores(roto, "u1")).toEqual([]);
    expect(guardaBorrador(roto, "u1", borrador(), null, ids())).toEqual({ ok: false, motivo: "almacen" });
    const { m, almacen } = memoria();
    guardaBorrador(almacen, "u1", borrador(), null, ids());
    const lleno: AlmacenDelNavegador = () => ({ ...almacen(), setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => { throw new Error("QuotaExceededError"); } });
    expect(guardaBorrador(lleno, "u1", borrador({ form: { account: "OTRO" } }), null, ids("x"))).toEqual({ ok: false, motivo: "almacen" });
    expect(borraBorrador(lleno, "u1", "b1")).toBe(false);
    expect(m.size).toBe(1);
  });
  it("basura, otra versión, sin id, ids repetidos o borradores vacíos se caen", () => {
    const { m, almacen } = memoria();
    m.set(claveDeLosBorradores("u1"), "{no es json");
    expect(leeBorradores(almacen, "u1")).toEqual([]);
    expect(borradoresDe({ v: 99, borradores: [{ id: "a", ...borrador() }] })).toEqual([]);
    expect(borradoresDe({ v: 1, borradores: "x" })).toEqual([]);
    const lista = borradoresDe({
      v: 1,
      borradores: [
        { id: "a", ...borrador() },
        { id: "a", ...borrador({ form: { account: "REPETIDO" } }) },
        { ...borrador() },
        { id: "  ", ...borrador() },
        { id: "vacio", ...borrador({ form: { store: "MCA" }, contactos: [contactoVacio()] }) },
        null, "x",
      ],
    });
    expect(lista.map((b) => [b.id, b.form.account])).toEqual([["a", "ACME TILE"]]);
  });
});

describe("borradores del alta: el borrador único de D-847 pasa a la lista, una vez", () => {
  const conElViejo = () => {
    const mem = memoria();
    mem.m.set(claveDelBorradorDelAlta("u1"), JSON.stringify({ v: 1, ...borrador({ guardado: "2026-11-04T17:00:00.000Z", form: { account: "VIEJO" } }) }));
    return mem;
  };
  it("al leer, entra en la lista con su id, su hora y todo lo escrito, y la clave vieja se borra", () => {
    const { m, almacen } = conElViejo();
    const lista = leeBorradores(almacen, "u1", ids("m"));
    expect(lista).toEqual([{ id: "m1", ...borrador({ guardado: "2026-11-04T17:00:00.000Z", form: { account: "VIEJO" } }) }]);
    expect(m.has(claveDelBorradorDelAlta("u1"))).toBe(false);
    expect(leeBorradores(almacen, "u1", ids("otra"))).toEqual(lista);
  });
  it("se suma a los que ya había, en su sitio por hora, aunque la lista esté llena (no se pierde)", () => {
    const { m, almacen } = conElViejo();
    const nuevo = ids();
    m.set(claveDeLosBorradores("u1"), JSON.stringify({ v: 1, borradores: Array.from({ length: MAX_BORRADORES }, (_, i) => ({ id: `b${i}`, ...borrador() })) }));
    const lista = leeBorradores(almacen, "u1", nuevo);
    expect(lista).toHaveLength(MAX_BORRADORES + 1);
    expect(lista.at(-1)?.form.account).toBe("VIEJO");
    expect(m.has(claveDelBorradorDelAlta("u1"))).toBe(false);
  });
  it("si la lista no se puede escribir, la clave vieja se QUEDA (y el borrador se enseña igual)", () => {
    const { m, almacen } = conElViejo();
    const sinEscribir: AlmacenDelNavegador = () => ({ ...almacen(), setItem: () => { throw new Error("QuotaExceededError"); } });
    expect(leeBorradores(sinEscribir, "u1", ids("m")).map((b) => b.form.account)).toEqual(["VIEJO"]);
    expect(m.has(claveDelBorradorDelAlta("u1"))).toBe(true);
    // La próxima vez, con el navegador ya bien, entra.
    expect(leeBorradores(almacen, "u1", ids("m")).map((b) => b.id)).toEqual(["m1"]);
    expect(m.has(claveDelBorradorDelAlta("u1"))).toBe(false);
  });
  it("si ya estaba en la lista (paso anterior que no pudo borrar la vieja), no se duplica", () => {
    const { m, almacen } = conElViejo();
    m.set(claveDeLosBorradores("u1"), JSON.stringify({ v: 1, borradores: [{ id: "m1", ...borrador({ guardado: "2026-11-04T17:00:00.000Z", form: { account: "VIEJO" } }) }] }));
    expect(leeBorradores(almacen, "u1", ids("z")).map((b) => b.id)).toEqual(["m1"]);
    expect(m.has(claveDelBorradorDelAlta("u1"))).toBe(false);
  });
  it("guardar uno nuevo también pasa el viejo antes (no lo pisa)", () => {
    const { almacen } = conElViejo();
    guardaBorrador(almacen, "u1", borrador({ guardado: "2026-11-04T20:00:00.000Z", form: { account: "NUEVO" } }), null, ids());
    expect(leeBorradores(almacen, "u1").map((b) => b.form.account)).toEqual(["NUEVO", "VIEJO"]);
  });
});

describe("borradores del alta: nombre y resumen de la lista", () => {
  it("el nombre es la cuenta; sin cuenta, «(untitled)» / «(sin nombre)»", () => {
    expect(nombreDelBorrador(borrador(), t)).toBe("ACME TILE");
    expect(nombreDelBorrador(borrador({ form: { account: "   " } }), t)).toBe("(untitled)|(sin nombre)");
    expect(nombreDelBorrador({ form: {} }, t)).toBe("(untitled)|(sin nombre)");
  });
  it("el resumen: primer contacto y tienda", () => {
    expect(resumenDelBorrador(borrador())).toBe("OMAR · RDZ McAllen");
    expect(resumenDelBorrador(borrador({ tiendas: ["MCA", "PHR"] }))).toBe("OMAR · RDZ McAllen, RDZ Pharr");
    expect(resumenDelBorrador(borrador({ tiendas: ["MCA", "PHR", "WES"] }))).toBe("OMAR · RDZ McAllen +2");
  });
  it("sin nombre de contacto, su teléfono en la forma del hub o su correo en minúsculas; sin tiendas marcadas, la del formulario", () => {
    expect(resumenDelBorrador(borrador({ contactos: [{ ...contactoVacio(), phones: ["9563405910"] }] }))).toBe("(956) 340-5910 · RDZ McAllen");
    expect(resumenDelBorrador(borrador({ contactos: [{ ...contactoVacio(), emails: ["Omar@Acme.COM"] }], tiendas: [] }))).toBe("omar@acme.com · RDZ McAllen");
    expect(resumenDelBorrador(borrador({ contactos: [contactoVacio(), { ...contactoVacio(), name: "ANA" }] }))).toBe("ANA · RDZ McAllen");
    expect(resumenDelBorrador(borrador({ contactos: [], tiendas: [], form: { account: "X" } }))).toBe("");
  });
});

describe("borradores del alta: la pantalla", () => {
  const leer = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const clientes = leer("src/app/customers/Clientes.tsx");
  const lista = leer("src/app/customers/BorradoresDelAlta.tsx");
  const ficha = leer("src/app/customers/FichaDeCliente.tsx");
  it("«💾 Borradores (N)» junto a «+ Nuevo cliente»: solo si hay alguno y solo quien puede crear", () => {
    expect(clientes).toContain("{puedeCrear && borradores.length > 0 && (");
    expect(clientes).toContain("const puedeCrear = puedeEditar || puedeDarDeAlta;");
    expect(clientes.indexOf("data-abrir-borradores")).toBeLessThan(clientes.indexOf('t("New customer", "Nuevo cliente")'));
    expect(clientes).toContain('{t("Drafts", "Borradores")}');
  });
  it("«Abrir» abre «Nuevo cliente» con ese borrador; la ficha lo recibe", () => {
    expect(clientes).toContain('setFicha({ tipo: "nuevo", borrador: b })');
    expect(clientes).toContain('borradorAlAbrir={ficha.tipo === "nuevo" ? ficha.borrador ?? null : null}');
  });
  it("«Borrar» pregunta con el diálogo de la app (useConfirm), nunca window.confirm; y Clientes monta su proveedor", () => {
    expect(lista).toContain('import { useConfirm } from "@/lib/confirm";');
    expect(lista).not.toContain("window.confirm");
    expect(lista).toContain("danger: true");
    expect(leer("src/app/customers/layout.tsx")).toContain("<ConfirmProvider>{cascaron}</ConfirmProvider>");
  });
  it("la fecha de cada fila sale en hora de Texas (cuandoSeGuardo), y todo es bilingüe", () => {
    expect(lista).toContain("cuandoSeGuardo(b.guardado, lang)");
    expect(lista).toContain('t("Open", "Abrir")');
    expect(lista).toContain('t("Delete", "Borrar")');
  });
  it("«Guardar borrador» actualiza el abierto o crea otro, y el aviso lo dice; el tope se avisa", () => {
    expect(ficha).toContain("guardaBorrador(almacenDelNavegador, yo, { ...borradorActual, guardado }, borradorId)");
    expect(ficha).toContain('t("Draft updated ✓", "Borrador actualizado ✓")');
    expect(ficha).toContain('t("New draft saved ✓');
    expect(ficha).toContain('r.motivo === "tope"');
    expect(ficha).toContain('t("Could not save the draft in this browser.", "No se pudo guardar el borrador en este navegador.")');
  });
});
