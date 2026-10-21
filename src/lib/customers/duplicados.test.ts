import { describe, expect, it } from "vitest";
import {
  claveDeEmpresa, claveDeNombre, correos, dominiosCompartidos, gruposObvios, igualesParaUnir, juntaEnMemoria, levenshtein, motivoDeDuplicado,
  motivoDeLaCola, motivosDeLaCola, nombreContenido, normalizaNombre, planDeJuntar, similitud, sospechosos, telefonos, unionDeFilas,
  type FilaDeCliente,
} from "./duplicados";

/**
 * Empresas y duplicados (189): lo que decide qué filas son la misma compañía, qué fila sobrevive y qué se apunta. Todos
 * los nombres son INVENTADOS («Acme», «Zorro»…): la forma de los casos reales (medidos el 2026-10-21) sin sus datos.
 */
type F = FilaDeCliente & Record<string, unknown>;
let n = 0;
const fila = (c: Partial<F> & { id: number }): F => ({
  store: "MCA", account: `Cuenta ${++n}`, unified_account: null, phone: null, email: null, archived_at: null, company_id: `e${c.id}`, notes: null, ...c,
});

describe("normalizar", () => {
  it("quita la forma jurídica, los acentos, los puntos y los signos; & es «and»", () => {
    expect(normalizaNombre("H & A RGV Construction Corporation")).toBe("h and a rgv construction");
    expect(normalizaNombre("H&A RGV Construction Corp.")).toBe("h and a rgv construction");
    expect(normalizaNombre("Zorro Construction, LLC")).toBe(normalizaNombre("ZORRO CONSTRUCTION LLC"));
    expect(normalizaNombre("J MUÑIZ CONSTRUCTION")).toBe("j muniz construction");
    expect(normalizaNombre("`4MA CONSTRUCTION L.L.C.")).toBe("4ma construction");
    expect(normalizaNombre("THE ACME COMPANY, INC")).toBe("acme");
    expect(normalizaNombre("Acme Co. Ltd")).toBe("acme");
    // «co» solo como palabra: «Coastal» no pierde nada.
    expect(normalizaNombre("Coastal Corp")).toBe("coastal");
    expect(normalizaNombre(null)).toBe("");
  });
  it("la clave de nombre no mira los espacios: «EVENCIO LARA» y «EVENCIOLARA» son el mismo; sin letras, vacía", () => {
    expect(claveDeNombre("EVENCIO LARA")).toBe(claveDeNombre("EVENCIOLARA"));
    expect(claveDeNombre("D' SOL, LLC")).toBe(claveDeNombre("D`SOL"));
    expect(claveDeNombre("O J MORALES")).toBe("ojmorales");
    expect(claveDeNombre("LLC")).toBe("");
    expect(claveDeNombre("+")).toBe("");
  });
  it("teléfonos: cada uno de 10 dígitos, sin el 1; dos en un campo; lo corto y lo repetido no cuentan", () => {
    expect(telefonos("956-708-0518 / 956-378-3332")).toEqual(["9567080518", "9563783332"]);
    expect(telefonos("1 (956) 555-0123")).toEqual(["9565550123"]);
    expect(telefonos("956-555-0123 - Ana - owner")).toEqual(["9565550123"]);
    expect(telefonos("956-686-772")).toEqual([]);
    expect(telefonos("000-000-0000")).toEqual([]);
    expect(telefonos(null)).toEqual([]);
  });
  it("correos: todos los del campo, en minúsculas, también «Nombre <correo>»", () => {
    expect(correos("Ana@Acme.com;ventas@acme.com")).toEqual(["ana@acme.com", "ventas@acme.com"]);
    expect(correos("Ana Pérez <ana@acme.com>")).toEqual(["ana@acme.com"]);
    expect(correos("(956) 555-0123")).toEqual([]);
  });
  it("un dominio propio con 6 direcciones o más es compartido; con 5 no; uno gratuito nunca", () => {
    const de = (dom: string, k: number) => Array.from({ length: k }, (_, i) => ({ email: `p${i}@${dom}` }));
    expect([...dominiosCompartidos([...de("vendedores.test", 6), ...de("acme.test", 5), ...de("gmail.com", 40)])]).toEqual(["vendedores.test"]);
  });
});

describe("parecido", () => {
  it("levenshtein y similitud", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(similitud("abcd", "abcd")).toBe(1);
    expect(similitud("", "")).toBe(0);
    expect(similitud("acme builders", "acme bulders")).toBeCloseTo(1 - 1 / 13);
  });
  it("contenido: todas las palabras del corto (al menos dos) en el largo; una sola palabra o el mismo nombre, no", () => {
    expect(nombreContenido("zorro homes", "zorro signature homes")).toBe(true);
    expect(nombreContenido("zorro signature homes", "zorro homes")).toBe(true);
    expect(nombreContenido("zorro", "zorro homes")).toBe(false);
    expect(nombreContenido("zorro homes", "zorro homes")).toBe(false);
    expect(nombreContenido("zorro homes", "zorro builders")).toBe(false);
  });
});

describe("lo OBVIO (gruposObvios)", () => {
  it("mismo nombre normalizado en varias tiendas: un grupo, ordenado por id", () => {
    const g = gruposObvios([
      fila({ id: 30, store: "PHR", account: "ACME HOME BUILDERS INC" }),
      fila({ id: 10, store: "BRO", account: "Acme Home Builders, Inc." }),
      fila({ id: 20, store: "WES", account: "ACME HOME BUILDERS" }),
      fila({ id: 40, store: "MCA", account: "Otra Cosa" }),
    ]);
    expect(g).toEqual([[10, 20, 30]]);
  });
  it("la misma cuenta unificada une nombres distintos ENTRE tiendas", () => {
    expect(gruposObvios([
      fila({ id: 1, store: "PHR", account: "Zorro Design Build", unified_account: "ZORRO DESIGN BUILD LLC" }),
      fila({ id: 2, store: "WES", account: "Zorro Luxury Homes", unified_account: "Zorro Design Build, LLC" }),
    ])).toEqual([[1, 2]]);
  });
  it("…pero NO une dos filas de la MISMA tienda con nombres distintos (eso es sospecha, no obvio)", () => {
    // La forma de «EL CIELO HOME CENTER» / «LOS PINOS HOME CENTER», las dos en Pharr con la misma cuenta unificada.
    const filas = [
      fila({ id: 1, store: "MCA", account: "Pino Home Center", unified_account: "PINO HOME CENTER" }),
      fila({ id: 2, store: "PHR", account: "Cielo Home Center", unified_account: "PINO HOME CENTER" }),
      fila({ id: 3, store: "PHR", account: "Pino Home Center", unified_account: "PINO HOME CENTER" }),
    ];
    expect(gruposObvios(filas)).toEqual([[1, 3]]);
  });
  it("…y sí une en la misma tienda si los nombres son casi iguales (≥ 0,85)", () => {
    expect(gruposObvios([
      fila({ id: 5, store: "EDG", account: "Ortiz Investment", unified_account: "ORTIZ INVESTMENTS" }),
      fila({ id: 6, store: "EDG", account: "Ortiz Investments", unified_account: "ORTIZ INVESTMENTS" }),
    ])).toEqual([[5, 6]]);
  });
  it("transitivo, y las archivadas no entran", () => {
    expect(gruposObvios([
      fila({ id: 1, store: "BRO", account: "Acme", unified_account: "ACME GROUP" }),
      fila({ id: 2, store: "MCA", account: "Acme Group", unified_account: "Acme Group" }),
      fila({ id: 3, store: "PHR", account: "Acme Group", archived_at: "2026-10-16T00:00:00Z" }),
      fila({ id: 4, store: "EDG", account: "Acme Group LLC" }),
    ])).toEqual([[1, 2, 4]]);
  });
});

describe("juntar dos filas de la misma tienda (unionDeFilas)", () => {
  const s = { id: 1, account: "ACME LLC", phone: "956-555-0123", email: null, rep_store: "IM", credit_limit: "20000.00", house_no: 7, notes: "nota vieja", terms: null };
  it("rellena lo vacío, se queda con lo suyo si choca y lo apunta, y pega las notas de la otra", () => {
    const { parche, linea } = unionDeFilas(s, { id: 9, account: "Acme, LLC", phone: "(956) 555-9999", email: "ana@acme.test", rep_store: "CRR", terms: "Net 30", house_no: 8, notes: "nota de la otra" });
    expect(parche.email).toBe("ana@acme.test");
    expect(parche.terms).toBe("Net 30");
    expect(parche.phone).toBeUndefined();
    expect(parche.rep_store).toBeUndefined();
    expect(parche.account).toBeUndefined();
    expect(linea).toBe("Del duplicado #9: cuenta «Acme, LLC»; vendedor tienda (QB) «CRR»; teléfono «(956) 555-9999»");
    expect(parche.notes).toBe("nota vieja\nDel duplicado #9: cuenta «Acme, LLC»; vendedor tienda (QB) «CRR»; teléfono «(956) 555-9999»\nDel duplicado #9 (notas): nota de la otra");
  });
  it("no apunta lo que dice lo mismo: teléfono por dígitos, correo sin mayúsculas, número como número, texto sin espacios de más", () => {
    const { linea } = unionDeFilas({ ...s, email: "Ana@Acme.test", terms: "Net  30" }, { id: 9, account: "acme llc", phone: "(956) 555 0123", email: "ana@acme.test", credit_limit: "20000", terms: "net 30", rep_store: "im" });
    expect(linea).toBe("Del duplicado #9: sin datos distintos");
    expect(igualesParaUnir("p", "956-555-0123", "(956) 555-0124")).toBe(false);
    expect(igualesParaUnir("m", "1500", "1500.00")).toBe(true);
  });
  it("House # y la tanda se rellenan pero un choque no se apunta; la cuenta nunca se rellena", () => {
    const { parche, linea } = unionDeFilas({ id: 1, account: "A", house_no: null, added_batch: "1", notes: null }, { id: 2, account: "B", house_no: 44, added_batch: "2", notes: null });
    expect(parche.house_no).toBe(44);
    expect(parche.added_batch).toBeUndefined();
    expect(linea).toBe("Del duplicado #2: cuenta «B»");
    expect(parche.notes).toBe(linea);
  });
});

describe("juntar empresas (juntaEnMemoria, el espejo de erp.junta_clientes)", () => {
  const ahora = "2026-10-21T15:00:00.000Z";
  it("tiendas distintas: misma empresa (la de la fila más vieja), nada se archiva, y no toca la lista de entrada", () => {
    const entrada = [fila({ id: 8, store: "PHR", account: "Acme" }), fila({ id: 3, store: "BRO", account: "Acme Inc" }), fila({ id: 5, store: "MCA", account: "Otra" })];
    const r = juntaEnMemoria(entrada, 8, 3, ahora, () => "nueva");
    expect(r.pasos).toEqual([]);
    expect(r.filas.find((f) => f.id === 8)!.company_id).toBe("e3");
    expect(r.filas.find((f) => f.id === 3)!.company_id).toBe("e3");
    expect(r.filas.find((f) => f.id === 5)!.company_id).toBe("e5");
    expect(entrada[0].company_id).toBe("e8");
  });
  it("misma tienda: sobrevive la de id menor, la otra se archiva con su motivo y sus datos van a las notas", () => {
    const r = juntaEnMemoria([
      fila({ id: 20, store: "PHR", account: "Acme LLC", phone: null, notes: null }),
      fila({ id: 12, store: "phr ", account: "ACME", phone: "956-555-0123", notes: null }),
    ], 20, 12, ahora, () => "nueva");
    const s = r.filas.find((f) => f.id === 12)!, o = r.filas.find((f) => f.id === 20)!;
    expect(r.pasos).toEqual([{ sobrevive: 12, archivada: 20, linea: "Del duplicado #20: cuenta «Acme LLC»" }]);
    expect(s.archived_at).toBeNull();
    expect(s.notes).toBe("Del duplicado #20: cuenta «Acme LLC»");
    expect(o.archived_at).toBe(ahora);
    expect(o.archived_reason).toBe(motivoDeDuplicado(12));
    expect(motivoDeDuplicado(12)).toBe("duplicado: unido a #12");
    expect(s.company_id).toBe(o.company_id);
  });
  it("con empresas de varias tiendas: se juntan enteras y solo la tienda repetida se une en una fila", () => {
    const r = juntaEnMemoria([
      fila({ id: 1, store: "BRO", account: "Acme", company_id: "A" }),
      fila({ id: 2, store: "PHR", account: "Acme", company_id: "A" }),
      fila({ id: 3, store: "PHR", account: "Acme Bros", company_id: "B" }),
      fila({ id: 4, store: "EDG", account: "Acme Bros", company_id: "B" }),
    ], 4, 2, ahora, () => "nueva");
    expect(new Set(r.filas.map((f) => f.company_id))).toEqual(new Set(["A"]));
    expect(r.pasos.map((p) => [p.sobrevive, p.archivada])).toEqual([[2, 3]]);
  });
  it("una fila archivada no se junta", () => {
    expect(() => juntaEnMemoria([fila({ id: 1 }), fila({ id: 2, archived_at: ahora })], 1, 2, ahora, () => "x")).toThrow();
  });
  it("sin company_id (código antes que la 189) cada fila es su empresa, y juntar crea una clave nueva", () => {
    expect(claveDeEmpresa({ id: 7, company_id: null })).toBe("#7");
    const r = juntaEnMemoria([fila({ id: 1, company_id: null, store: "BRO" }), fila({ id: 2, company_id: null, store: "MCA" })], 1, 2, ahora, () => "nueva");
    expect(r.filas.map((f) => f.company_id)).toEqual(["nueva", "nueva"]);
  });
});

describe("lo SOSPECHOSO (sospechosos)", () => {
  it("nombre parecido (≥ 0,85), contenido, teléfono, correo y cuenta unificada; a_id < b_id", () => {
    const s = sospechosos([
      fila({ id: 1, store: "BRO", account: "Zorro Design and Construction" }),
      fila({ id: 2, store: "BRO", account: "Zorro Design and Contruction" }),
      fila({ id: 3, store: "MCA", account: "Halcon Homes" }),
      fila({ id: 4, store: "PHR", account: "Halcon Signature Homes" }),
      fila({ id: 5, store: "EDG", account: "Uno", phone: "956-555-0101" }),
      fila({ id: 6, store: "EDG", account: "Dos", phone: "(956) 555-0101" }),
      fila({ id: 7, store: "WES", account: "Tres", email: "x@tres.test" }),
      fila({ id: 8, store: "WES", account: "Cuatro", email: "X@Tres.test" }),
      fila({ id: 9, store: "MCA", account: "Pino Home Center", unified_account: "PINO GROUP" }),
      fila({ id: 10, store: "MCA", account: "Cielo Retail", unified_account: "Pino Group" }),
    ]);
    const de = (a: number, b: number) => s.find((x) => x.a_id === a && x.b_id === b)?.motivos;
    expect(de(1, 2)).toEqual(["nombre_parecido"]);
    expect(de(3, 4)).toEqual(["nombre_contenido"]);
    expect(de(5, 6)).toEqual(["telefono"]);
    expect(de(7, 8)).toEqual(["correo"]);
    expect(de(9, 10)).toEqual(["cuenta_unificada"]);
    expect(s).toHaveLength(5);
    expect(s.every((x) => x.a_id < x.b_id)).toBe(true);
  });
  it("el corte es 0,85: justo por debajo no sale", () => {
    // 20 letras con 3 distintas = 0,85 (sale); con 4 = 0,80 (no sale).
    const a = "abcdefghijklmnopqrst";
    const s = sospechosos([
      fila({ id: 1, account: a }),
      fila({ id: 2, account: "XYZdefghijklmnopqrst" }),
      fila({ id: 3, store: "PHR", account: "wxyzefghijklmnopqrst" }),
    ]);
    expect(s.find((x) => x.a_id === 1 && x.b_id === 2)?.score).toBe(0.85);
    expect(s.find((x) => x.a_id === 1 && x.b_id === 3)).toBeUndefined();
  });
  it("la misma empresa no se sospecha de sí misma; y una pareja de empresas sale UNA vez, con la unión de motivos", () => {
    const s = sospechosos([
      fila({ id: 1, store: "BRO", account: "Acme Builders", company_id: "A", phone: "956-555-0101" }),
      fila({ id: 2, store: "PHR", account: "Acme Bulders", company_id: "A" }),
      fila({ id: 3, store: "MCA", account: "Acme Bulders", company_id: "B", phone: "956-555-0101" }),
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].motivos).toEqual(["nombre_parecido", "telefono"]);
    expect([s[0].a_id, s[0].b_id]).toEqual([1, 3]);
  });
  it("el correo de un dominio compartido no es prueba; lo archivado no entra", () => {
    const vendedores = Array.from({ length: 6 }, (_, i) => fila({ id: 100 + i, account: `Cliente ${String.fromCharCode(65 + i)}${i}xq`, email: `v${i}@vendedores.test` }));
    const s = sospechosos([
      ...vendedores,
      fila({ id: 1, account: "Primero", email: "v0@vendedores.test" }),
      fila({ id: 2, account: "Segundo", phone: "956-555-0199" }),
      fila({ id: 3, account: "Tercero", phone: "956-555-0199", archived_at: "2026-10-16T00:00:00Z" }),
    ]);
    expect(s.filter((x) => x.motivos.includes("correo"))).toEqual([]);
    expect(s.filter((x) => x.motivos.includes("telefono"))).toEqual([]);
  });
  it("la cola guarda los motivos en su orden fijo y los vuelve a leer", () => {
    expect(motivoDeLaCola(["telefono", "nombre_parecido"])).toBe("nombre_parecido,telefono");
    expect(motivosDeLaCola("telefono, correo,raro")).toEqual(["telefono", "correo"]);
  });
});

describe("el plan del guion (planDeJuntar)", () => {
  it("junta cada grupo obvio en orden y luego busca sospechas sobre lo que queda", () => {
    const p = planDeJuntar([
      fila({ id: 1, store: "BRO", account: "Acme Builders LLC" }),
      fila({ id: 2, store: "PHR", account: "ACME BUILDERS" }),
      fila({ id: 3, store: "PHR", account: "Acme Builders, Inc." }),
      fila({ id: 4, store: "MCA", account: "Acme Bulders" }),
    ], "2026-10-21T00:00:00Z", () => "nueva");
    expect(p.grupos).toEqual([[1, 2, 3]]);
    expect(p.llamadas).toEqual([[1, 2], [1, 3]]);
    expect(p.pasos.map((x) => [x.sobrevive, x.archivada])).toEqual([[2, 3]]);
    expect(p.sospechas.map((x) => [x.a_id, x.b_id, x.motivos])).toEqual([[1, 4, ["nombre_parecido"]]]);
  });
});
