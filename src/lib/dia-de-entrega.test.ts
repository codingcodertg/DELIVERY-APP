import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  aniosValidos, cambiaLaFecha, esDomingo, maxFechaDeEntrega, notaDeDomingo, problemaAlAgendar, problemaDeFecha,
  puedeAutorizarDomingo, saltaDomingo, textoDelProblema, usaCasoEspecial, type CasoEspecial,
} from "./dia-de-entrega";
import { mapRowsToDrafts, parseCSV } from "./csv-import";
import { fechaPropuesta } from "./reprogramar-orden";
import { reprogramarIntertiendas } from "./reprogramar-intertiendas";
import type { OrderTypeRules } from "./required";
import { AvisoDeFecha } from "@/components/AvisoDeFecha";

// D-NEXT. El dueño, 2026-10-23: «el domingo no se hacen entregas» y «domingo solamente con un overdrive para casos
// especiales». «Hoy» va SIEMPRE explícito: con la fecha real, el rango de años cambia solo con el calendario.
const HOY = "2026-10-23"; // viernes
const DOMINGO = "2026-09-27";
const SABADO = "2026-09-26";
const LUNES = "2026-09-28";
const CON_MOTIVO: CasoEspecial = { marcado: true, motivo: "obra con grúa solo el domingo" };
const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("esDomingo: el día del calendario, sin zona horaria", () => {
  it("domingo sí; sábado y lunes no", () => {
    expect(esDomingo(DOMINGO)).toBe(true);
    expect(esDomingo(SABADO)).toBe(false);
    expect(esDomingo(LUNES)).toBe(false);
    expect(esDomingo("2026-10-25")).toBe(true);
    expect(esDomingo(HOY)).toBe(false);
  });
  it("una fecha `YYYY-MM-DD` es el día de Texas: no se corre al sábado como `new Date(\"2026-09-27\")` en UTC-5", () => {
    // `new Date("2026-09-27")` es la medianoche UTC; en Texas es el sábado a las 19:00. La regla mira las cifras.
    // La zona se fija aquí: en el CI (UTC) la trampa no existe y una regla con `new Date(...).getDay()` pasaría.
    const zona = process.env.TZ;
    process.env.TZ = "America/Chicago";
    try {
      expect(new Date("2026-09-27").getDay()).toBe(6); // la trampa existe en esta zona
      expect(esDomingo("2026-09-27")).toBe(true);
    } finally {
      if (zona === undefined) delete process.env.TZ; else process.env.TZ = zona;
    }
    expect(esDomingo("2026-09-27")).toBe(true);
    expect(esDomingo("2026-09-27T00:00:00")).toBe(true);
    expect(esDomingo("2026-09-26T23:30:00")).toBe(false);
  });
  it("lo que no es una fecha no es domingo", () => {
    for (const x of [null, undefined, "", "27/09/2026", "22026-09-27", "2026-02-30"]) expect(esDomingo(x)).toBe(false);
  });
});

describe("problemaDeFecha: año imposible y domingo", () => {
  it("los años van del anterior a dos más", () => {
    expect(aniosValidos(HOY)).toEqual({ desde: 2025, hasta: 2028 });
    expect(maxFechaDeEntrega(HOY)).toBe("2028-12-31");
  });
  it("los dos casos medidos en producción: año de 5 cifras y 2023", () => {
    expect(problemaDeFecha("22026-10-11", { hoy: HOY })).toBe("fecha_imposible");
    expect(problemaDeFecha("2023-08-13", { hoy: HOY })).toBe("fecha_imposible");
  });
  it("los bordes: 2025 y 2028 valen; 2024 y 2029 no (aunque caigan en domingo, el año manda y no hay excepción)", () => {
    expect(problemaDeFecha("2025-01-06", { hoy: HOY })).toBeNull();
    expect(problemaDeFecha("2028-12-30", { hoy: HOY })).toBeNull();
    expect(problemaDeFecha("2025-01-05", { hoy: HOY })).toBe("domingo");
    expect(problemaDeFecha("2028-12-31", { hoy: HOY })).toBe("domingo");
    expect(problemaDeFecha("2024-12-29", { hoy: HOY, excepcion: true })).toBe("fecha_imposible");
    expect(problemaDeFecha("2029-01-07", { hoy: HOY, excepcion: true })).toBe("fecha_imposible");
    expect(problemaDeFecha("2024-12-31", { hoy: HOY })).toBe("fecha_imposible");
    expect(problemaDeFecha("2029-01-01", { hoy: HOY })).toBe("fecha_imposible");
  });
  it("un día que no existe o una forma rara es imposible; sin fecha, nada", () => {
    expect(problemaDeFecha("2026-02-30", { hoy: HOY })).toBe("fecha_imposible");
    expect(problemaDeFecha("10/12/2026", { hoy: HOY })).toBe("fecha_imposible");
    expect(problemaDeFecha(null, { hoy: HOY })).toBeNull();
    expect(problemaDeFecha("", { hoy: HOY })).toBeNull();
  });
  it("domingo: no, salvo excepción; sábado y lunes, siempre", () => {
    expect(problemaDeFecha(DOMINGO, { hoy: HOY })).toBe("domingo");
    expect(problemaDeFecha(DOMINGO, { hoy: HOY, excepcion: true })).toBeNull();
    expect(problemaDeFecha(SABADO, { hoy: HOY })).toBeNull();
    expect(problemaDeFecha(LUNES, { hoy: HOY })).toBeNull();
  });
});

describe("problemaAlAgendar: el caso especial es de oficina, gerente y admin, con motivo", () => {
  it("quién lo puede dar", () => {
    for (const r of ["accounting", "manager", "admin"]) expect(puedeAutorizarDomingo(r)).toBe(true);
    for (const r of ["sales", "driver", "warehouse", "logistics", null, undefined]) expect(puedeAutorizarDomingo(r)).toBe(false);
  });
  it("oficina, gerente y admin, con la casilla y el motivo, ponen domingo", () => {
    for (const rol of ["accounting", "manager", "admin"]) expect(problemaAlAgendar(DOMINGO, null, { rol, caso: CON_MOTIVO, hoy: HOY })).toBeNull();
  });
  it("vendedor, chofer, almacén y logística no, aunque marquen la casilla", () => {
    for (const rol of ["sales", "driver", "warehouse", "logistics"]) expect(problemaAlAgendar(DOMINGO, null, { rol, caso: CON_MOTIVO, hoy: HOY })).toBe("domingo");
  });
  it("sin casilla, domingo; con la casilla y sin motivo (o «x»), pide el motivo", () => {
    expect(problemaAlAgendar(DOMINGO, null, { rol: "manager", hoy: HOY })).toBe("domingo");
    expect(problemaAlAgendar(DOMINGO, null, { rol: "manager", caso: { marcado: false, motivo: "con motivo" }, hoy: HOY })).toBe("domingo");
    expect(problemaAlAgendar(DOMINGO, null, { rol: "manager", caso: { marcado: true, motivo: "  x " }, hoy: HOY })).toBe("domingo_sin_motivo");
  });
  it("el año imposible no tiene excepción, ni para el admin", () => {
    expect(problemaAlAgendar("22026-10-11", null, { rol: "admin", caso: CON_MOTIVO, hoy: HOY })).toBe("fecha_imposible");
  });
  it("una orden que YA estaba en domingo se edita sin tocarle la fecha (como D-532); cambiarla a otro domingo, no", () => {
    expect(cambiaLaFecha(DOMINGO, DOMINGO)).toBe(false);
    expect(problemaAlAgendar(DOMINGO, DOMINGO, { rol: "sales", hoy: HOY })).toBeNull();
    expect(problemaAlAgendar("22026-10-11", "22026-10-11", { rol: "sales", hoy: HOY })).toBeNull();
    expect(problemaAlAgendar("2026-10-25", DOMINGO, { rol: "sales", hoy: HOY })).toBe("domingo");
    expect(problemaAlAgendar(LUNES, DOMINGO, { rol: "sales", hoy: HOY })).toBeNull();
  });
});

describe("la nota del historial", () => {
  it("solo cuando se pone un domingo con el caso especial", () => {
    expect(usaCasoEspecial(DOMINGO, null, { rol: "accounting", caso: CON_MOTIVO, hoy: HOY })).toBe(true);
    expect(usaCasoEspecial(DOMINGO, LUNES, { rol: "admin", caso: CON_MOTIVO, hoy: HOY })).toBe(true);
    // La casilla quedó marcada, pero la fecha es un lunes: no hay nada que autorizar.
    expect(usaCasoEspecial(LUNES, null, { rol: "accounting", caso: CON_MOTIVO, hoy: HOY })).toBe(false);
    // El domingo que ya tenía: no se escribe la fecha, no hay nota.
    expect(usaCasoEspecial(DOMINGO, DOMINGO, { rol: "accounting", caso: CON_MOTIVO, hoy: HOY })).toBe(false);
    expect(usaCasoEspecial(DOMINGO, null, { rol: "sales", caso: CON_MOTIVO, hoy: HOY })).toBe(false);
    expect(usaCasoEspecial(DOMINGO, null, { rol: "manager", caso: { marcado: true, motivo: "" }, hoy: HOY })).toBe(false);
  });
  it("dice quién y por qué", () => {
    expect(notaDeDomingo("Persona Uno", "  obra   con grúa ", "es")).toBe("Entrega en domingo autorizada por Persona Uno: obra con grúa");
    expect(notaDeDomingo("Persona Uno", "crane job", "en")).toBe("Sunday delivery authorized by Persona Uno: crane job");
  });
});

describe("los avisos", () => {
  it("al vendedor: pídeselo a la oficina; a la oficina: la casilla; donde no hay casilla, dónde está", () => {
    expect(textoDelProblema("domingo", "sales", { hoy: HOY }).es).toBe("Los domingos no hay entregas. Si es un caso especial, pídeselo a la oficina.");
    expect(textoDelProblema("domingo", "accounting", { hoy: HOY }).es).toContain("marca «Caso especial: entregar en domingo»");
    expect(textoDelProblema("domingo", "manager", { hoy: HOY, sinCasilla: true }).es).toContain("usa «📅 Reprogramar» o la ficha");
    expect(textoDelProblema("domingo", "sales", { hoy: HOY, sinCasilla: true }).es).toContain("pídeselo a la oficina");
    expect(textoDelProblema("fecha_imposible", "admin", { hoy: HOY }).es).toBe("Esa fecha de entrega no es válida: el año tiene que estar entre 2025 y 2028.");
  });
  const pinta = (rol: string, fecha: string, caso: CasoEspecial = { marcado: false, motivo: "" }, actual: string | null = null) =>
    renderToStaticMarkup(createElement(AvisoDeFecha, { fecha, actual, rol, caso, onCaso: () => {}, t: (_en: string, es: string) => es, hoy: HOY }));
  it("en pantalla: el vendedor ve el aviso sin casilla; la oficina, la casilla y, marcada, el motivo", () => {
    const vendedor = pinta("sales", DOMINGO);
    expect(vendedor).toContain('data-aviso-fecha="domingo"');
    expect(vendedor).toContain("pídeselo a la oficina");
    expect(vendedor).not.toContain("data-caso-especial");
    const oficina = pinta("accounting", DOMINGO);
    expect(oficina).toContain("data-caso-especial");
    expect(oficina).toContain("Caso especial: entregar en domingo");
    expect(oficina).not.toContain("data-motivo-domingo");
    expect(pinta("accounting", DOMINGO, CON_MOTIVO)).toContain("data-motivo-domingo");
  });
  it("en pantalla: nada en lunes ni en el domingo que ya tenía; el año imposible, sin casilla", () => {
    expect(pinta("accounting", LUNES)).toBe("");
    expect(pinta("accounting", DOMINGO, CON_MOTIVO, DOMINGO)).toBe("");
    const malo = pinta("admin", "2023-08-13");
    expect(malo).toContain('data-aviso-fecha="imposible"');
    expect(malo).not.toContain("data-caso-especial");
  });
});

describe("las fechas que se proponen saltan el domingo", () => {
  it("saltaDomingo", () => {
    expect(saltaDomingo(DOMINGO)).toBe(LUNES);
    expect(saltaDomingo(SABADO)).toBe(SABADO);
    expect(saltaDomingo("2026-12-27")).toBe("2026-12-28");
  });
  it("«📅 Reprogramar» propone el lunes en vez del domingo", () => {
    expect(fechaPropuesta(SABADO, "2026-09-20")).toBe(LUNES);
    expect(fechaPropuesta(null, SABADO)).toBe(LUNES);
    expect(fechaPropuesta(null, "2026-09-24")).toBe("2026-09-25");
  });
  it("el cron de Intertiendas (D-406) un domingo las pasa al lunes, no a hoy", () => {
    const reglas: OrderTypeRules = { Intertienda: { storeToStore: true, docRef: "any", homeIsDestination: true } };
    const orden = { id: "a", order_type: "Intertienda", stage: "approved", delivery_date: SABADO, is_training: false, order_code: "A" };
    expect(reprogramarIntertiendas([orden], DOMINGO, reglas)).toEqual([{ id: "a", etiqueta: "A", antes: SABADO, despues: LUNES }]);
    expect(reprogramarIntertiendas([{ ...orden, delivery_date: "2026-09-24" }], SABADO, reglas)[0].despues).toBe(SABADO);
  });
});

describe("la importación CSV rechaza la fila, con su motivo", () => {
  it("domingo y año imposible no entran; lunes sí", () => {
    const rows = parseCSV(
      "Account,Delivery Address,Delivery Date\n" +
      `Cuenta Uno,1 Calle Uno,${DOMINGO}\n` +
      "Cuenta Dos,2 Calle Dos,22026-10-11\n" +
      `Cuenta Tres,3 Calle Tres,${LUNES}\n` +
      "Cuenta Cuatro,4 Calle Cuatro,2023-08-12",
    );
    const { drafts, warnings } = mapRowsToDrafts(rows, HOY);
    expect(drafts.map((d) => d.account)).toEqual(["Cuenta Tres"]);
    expect(warnings).toEqual([
      `Row 2: skipped (delivery date ${DOMINGO}). There are no deliveries on Sundays. If it's a special case, ask the office.`,
      "Row 3: skipped (delivery date 22026-10-11). That delivery date isn't valid: the year has to be between 2025 and 2028.",
      "Row 5: skipped (delivery date 2023-08-12). That delivery date isn't valid: the year has to be between 2025 and 2028.",
    ]);
  });
});

describe("todos los sitios que escriben delivery_date usan la regla", () => {
  const modal = leer("src/components/OrderModal.tsx");
  it("la ficha: al enviar/editar (passesChecks), el borrador, y «solo la fecha»", () => {
    const i = modal.indexOf("const passesChecks = async (draft: Draft, opts: { facturaYaDecidida?: boolean } = {}): Promise<boolean> => {");
    expect(i).toBeGreaterThan(-1);
    const cabeza = modal.slice(i, modal.indexOf("const miss = computeMissing(draft);", i));
    expect(cabeza).toContain("if (fechaNoVale(draft.delivery_date)) return false;");
    const save = modal.slice(modal.indexOf("const save = async () => {"), modal.indexOf("const lastRouted = useRef<string>"));
    expect(save).toContain('if ((payload.stage ?? "draft") === "draft" && fechaNoVale(payload.delivery_date)) return;');
    const soloFecha = save.slice(save.indexOf('alcance === "solo_fecha"'), save.indexOf("parcheSoloFecha(d)"));
    expect(soloFecha).toContain("if (fechaNoVale(d.delivery_date)) return;");
    // `fechaNoVale` pasa la fecha actual de la orden y la casilla, y avisa con el texto del rol.
    expect(modal).toContain("const p = problemaAlAgendar(nueva, existing?.delivery_date, { rol: me.role, caso: casoDomingo });");
  });
  it("la ficha: la nota tras cada escritura (crear con los dos botones, guardar cambios, solo la fecha)", () => {
    expect(modal).toContain("if (usaCasoEspecial(nueva, actual, { rol: me.role, caso: casoDomingo })) await addNote(id, notaDeDomingo(me.full_name, casoDomingo.motivo, lang));");
    expect(modal.split("if (row) await anotaDomingo(row.id, payload.delivery_date, null);").length - 1).toBe(2);
    expect(modal).toContain("if (ok) await anotaDomingo(existing!.id, payload.delivery_date, existing!.delivery_date);");
    expect(modal).toContain("if (ok) await anotaDomingo(existing!.id, d.delivery_date, existing!.delivery_date);");
  });
  it("la ficha: los dos selectores llevan `max` y el aviso con la casilla; duplicar no nace en domingo", () => {
    expect(modal.split("min={minFechaDeEntrega()} max={maxFechaDeEntrega()} />").length - 1).toBe(2);
    expect(modal.split("<AvisoDeFecha fecha={d.delivery_date} actual={existing?.delivery_date} rol={me.role} caso={casoDomingo} onCaso={setCasoDomingo} t={t} />").length - 1).toBe(2);
    expect(modal).toContain("borradorDuplicado(existing, saltaDomingo(todayISO()))");
  });
  it("«📅 Reprogramar»: el cuadro no se enciende con domingo sin caso especial y manda la casilla", () => {
    const cuadro = leer("src/components/ReprogramarOrden.tsx");
    expect(cuadro).toContain("&& !problemaAlAgendar(fecha, pedido.delivery_date, { rol, caso, hoy });");
    expect(cuadro).toContain("await reprogramarOrden(pedido.id, fecha, nota, lang, caso);");
    expect(cuadro).toContain("<AvisoDeFecha fecha={fecha} actual={pedido.delivery_date} rol={rol} caso={caso} onCaso={setCaso} t={t} />");
  });
  it("los dos proveedores (y con ellos «Reprogramar a …» de Recomendaciones) paran el domingo y anotan el caso especial", () => {
    for (const p of ["src/lib/data-provider.tsx", "src/lib/local-data-provider.tsx"]) {
      const f = leer(p);
      const i = f.indexOf("reprogramarOrden");
      const cuerpo = f.slice(f.indexOf("async (id, fecha, nota, lang, caso) => {", i));
      const antesDeEscribir = cuerpo.slice(0, cuerpo.indexOf("updateDelivery(id, { delivery_date: fecha })"));
      expect(antesDeEscribir).toContain("const problema = problemaAlAgendar(fecha, antes, { rol: me?.role, caso });");
      expect(antesDeEscribir).toContain("if (problema) {");
      expect(cuerpo.slice(0, 2000)).toContain("notaDeDomingo(me?.full_name, caso.motivo, lang)");
    }
  });
  it("el Gestor (celda de fecha) y la fecha en bloque de Órdenes, sin casilla", () => {
    const gestor = leer("src/app/(app)/routes/page.tsx");
    const reschedule = gestor.slice(gestor.indexOf("const reschedule = (id: string, delivery_date: string) => {"));
    expect(reschedule.slice(0, reschedule.indexOf("return updateDelivery(id, { delivery_date });"))).toContain("const problemaDeLaFecha = problemaAlAgendar(delivery_date, actual, { rol: me?.role });");
    expect(gestor).toContain("max={maxFechaDeEntrega()}\n        min={minFechaDeEntrega()}");
    const ordenes = leer("src/app/(app)/page.tsx");
    const bloque = ordenes.slice(ordenes.indexOf("const bulkSetDate = (date: string) => {"));
    expect(bloque.slice(0, bloque.indexOf("return cambioEnBloque("))).toContain("const problemaDeLaFecha = problemaAlAgendar(date, null, { rol: me?.role });");
    expect(ordenes).toContain("onChange={(e) => setFechaEnBloque(e.target.value)} max={maxFechaDeEntrega()}");
  });
});
