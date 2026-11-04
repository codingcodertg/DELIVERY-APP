import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AvisoDeFecha } from "@/components/AvisoDeFecha";
import {
  aplicaCorteDeVentas, AVISO_CORTE_VENTAS, esHoyTrasElMediodia, HORA_DE_CORTE_VENTAS, MENSAJE_DE_LA_237, pasoElCorteDeVentas,
  pideConfirmarMediodia, PREGUNTA_CORTE_VENTAS, preguntaSiEsParaHoy,
} from "./corte-de-ventas";

/**
 * D-845 (el dueño, 2026-11-04): «sales no pueden ingresar una orden para el mismo día después de las 12». El mismo día:
 * «no lo apliques como bloqueo; solo pregúntale al vendedor "¿seguro? ya es tarde"». Se pregunta, no se bloquea.
 */
const leer = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

// 2026-11-04 (miércoles): Texas va en CST (UTC−6). 2026-10-30 (viernes): todavía CDT (UTC−5). El cambio fue el domingo 1-nov.
const CST = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-06:00`);
const CDT = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-05:00`);

describe("la hora: las 12:00 en Texas", () => {
  it("11:59 todavía no; 12:00 en punto, ya (horario de invierno, CST)", () => {
    expect(HORA_DE_CORTE_VENTAS).toBe(12);
    expect(pasoElCorteDeVentas(CST("2026-11-04", "11:59"))).toBe(false);
    expect(pasoElCorteDeVentas(CST("2026-11-04", "12:00"))).toBe(true);
    expect(esHoyTrasElMediodia("2026-11-04", { rol: "sales", ahora: CST("2026-11-04", "11:59") })).toBe(false);
    expect(esHoyTrasElMediodia("2026-11-04", { rol: "sales", ahora: CST("2026-11-04", "12:00") })).toBe(true);
  });

  it("igual en horario de verano (CDT): 11:59 no, 12:00 sí", () => {
    expect(esHoyTrasElMediodia("2026-10-30", { rol: "sales", ahora: CDT("2026-10-30", "11:59") })).toBe(false);
    expect(esHoyTrasElMediodia("2026-10-30", { rol: "sales", ahora: CDT("2026-10-30", "12:00") })).toBe(true);
  });

  it("cambio de horario: la MISMA hora UTC cae antes o después de las 12 según la época del año", () => {
    // 17:30Z = 12:30 CDT el 30-oct (ya pasó) y 11:30 CST el 2-nov (todavía no). Con UTC fijo se equivocaría uno.
    expect(pasoElCorteDeVentas(new Date("2026-10-30T17:30:00Z"))).toBe(true);
    expect(pasoElCorteDeVentas(new Date("2026-11-02T17:30:00Z"))).toBe(false);
    // El domingo del cambio (1-nov, día de 25 horas): las 12 son las 18:00Z.
    expect(pasoElCorteDeVentas(new Date("2026-11-01T17:59:00Z"))).toBe(false);
    expect(pasoElCorteDeVentas(new Date("2026-11-01T18:00:00Z"))).toBe(true);
    // Adelanto de primavera (domingo 14-mar-2027, día de 23 horas): las 12 CDT son las 17:00Z.
    expect(pasoElCorteDeVentas(new Date("2027-03-14T16:59:00Z"))).toBe(false);
    expect(pasoElCorteDeVentas(new Date("2027-03-14T17:00:00Z"))).toBe(true);
    expect(esHoyTrasElMediodia("2027-03-14", { rol: "sales", ahora: new Date("2027-03-14T17:00:00Z") })).toBe(true);
  });

  it("mira el día de Texas, no el de UTC: a las 23:30 de Texas en UTC ya es mañana", () => {
    // 05:30Z del 5-nov = 23:30 CST del 4-nov → hoy en Texas es el 4: el 4 pregunta, el 5 (mañana) no.
    const noche = new Date("2026-11-05T05:30:00Z");
    expect(esHoyTrasElMediodia("2026-11-04", { rol: "sales", ahora: noche })).toBe(true);
    expect(esHoyTrasElMediodia("2026-11-05", { rol: "sales", ahora: noche })).toBe(false);
    // 13:00Z = 07:00 CST: por la mañana, nada que preguntar.
    expect(esHoyTrasElMediodia("2026-11-04", { rol: "sales", ahora: new Date("2026-11-04T13:00:00Z") })).toBe(false);
  });
});

describe("a quién y a qué fecha", () => {
  const TARDE = CST("2026-11-04", "15:00");

  it("solo ventas: admin, gerente, logística, almacén, office y chofer no reciben la pregunta", () => {
    expect(aplicaCorteDeVentas("sales")).toBe(true);
    for (const rol of ["admin", "manager", "logistics", "warehouse", "accounting", "driver", null, undefined]) {
      expect(aplicaCorteDeVentas(rol)).toBe(false);
      expect(esHoyTrasElMediodia("2026-11-04", { rol, ahora: TARDE })).toBe(false);
      expect(pideConfirmarMediodia("2026-11-04", null, { rol, ahora: TARDE, agenda: true })).toBe(false);
    }
  });

  it("por la tarde, ventas: solo HOY pide la pregunta; mañana y después, no; sin fecha, nada que decir", () => {
    expect(esHoyTrasElMediodia("2026-11-04", { rol: "sales", ahora: TARDE })).toBe(true);
    expect(esHoyTrasElMediodia("2026-11-04T00:00:00", { rol: "sales", ahora: TARDE })).toBe(true);
    expect(esHoyTrasElMediodia("2026-11-05", { rol: "sales", ahora: TARDE })).toBe(false);
    // Un día pasado no es esto: lo para D-532 antes.
    expect(esHoyTrasElMediodia("2026-11-03", { rol: "sales", ahora: TARDE })).toBe(false);
    expect(esHoyTrasElMediodia(null, { rol: "sales", ahora: TARDE })).toBe(false);
    expect(esHoyTrasElMediodia("", { rol: "sales", ahora: TARDE })).toBe(false);
  });

  it("la escritura: pregunta cuando PONE hoy, o cuando manda a programar para hoy (enviar borrador, reenviar rechazada)", () => {
    expect(pideConfirmarMediodia("2026-11-04", null, { rol: "sales", ahora: TARDE })).toBe(true);
    expect(pideConfirmarMediodia("2026-11-04", "2026-11-06", { rol: "sales", ahora: TARDE })).toBe(true);
    // La misma de siempre (se toca otra cosa): no es agendar, no pregunta.
    expect(pideConfirmarMediodia("2026-11-04", "2026-11-04", { rol: "sales", ahora: TARDE })).toBe(false);
    // …salvo que la escritura la mande a programar.
    expect(pideConfirmarMediodia("2026-11-04", "2026-11-04", { rol: "sales", ahora: TARDE, agenda: true })).toBe(true);
    expect(pideConfirmarMediodia("2026-11-05", "2026-11-05", { rol: "sales", ahora: TARDE, agenda: true })).toBe(false);
    // Por la mañana nada pregunta.
    expect(pideConfirmarMediodia("2026-11-04", null, { rol: "sales", ahora: CST("2026-11-04", "11:59"), agenda: true })).toBe(false);
  });

  it("la pregunta y el aviso, en los dos idiomas; el aviso es un consejo, no un «no se puede»", () => {
    expect(PREGUNTA_CORTE_VENTAS.en).toBe("It's after 12:00 noon. Are you sure this order is for today?");
    expect(PREGUNTA_CORTE_VENTAS.es).toBe("Ya es después de las 12:00 del mediodía. ¿Seguro que esta orden es para hoy?");
    expect(PREGUNTA_CORTE_VENTAS.si).toEqual({ en: "Yes, for today", es: "Sí, para hoy" });
    expect(PREGUNTA_CORTE_VENTAS.cambiar).toEqual({ en: "Change date", es: "Cambiar fecha" });
    expect(AVISO_CORTE_VENTAS.en).toMatch(/^It's after 12:00 noon\. Make sure/);
    expect(AVISO_CORTE_VENTAS.es).toMatch(/^Ya es después de las 12:00 del mediodía\. Asegúrate/);
    expect(AVISO_CORTE_VENTAS.en).not.toMatch(/start tomorrow/);
  });

  it("preguntaSiEsParaHoy usa el diálogo que le pasan, con «Sí, para hoy» y «Cambiar fecha», y devuelve su respuesta", async () => {
    const llamadas: Array<[string, { confirmLabel: string; cancelLabel: string }]> = [];
    const es = (_en: string, s: string) => s;
    const si = await preguntaSiEsParaHoy(async (m, o) => { llamadas.push([m, o]); return true; }, es);
    const no = await preguntaSiEsParaHoy(async () => false, es);
    expect([si, no]).toEqual([true, false]);
    expect(llamadas).toEqual([[PREGUNTA_CORTE_VENTAS.es, { confirmLabel: "Sí, para hoy", cancelLabel: "Cambiar fecha" }]]);
  });
});

describe("el aviso debajo del selector", () => {
  const pinta = (rol: string, fecha: string, ahora: Date) =>
    renderToStaticMarkup(createElement(AvisoDeFecha, {
      fecha, actual: null, rol, caso: { marcado: false, motivo: "" }, onCaso: () => {}, t: (_en: string, es: string) => es, hoy: "2026-11-04", ahora,
    }));
  it("a ventas por la tarde, hoy sale como consejo (ámbar); por la mañana, mañana, o a la oficina, nada", () => {
    const html = pinta("sales", "2026-11-04", CST("2026-11-04", "12:00"));
    expect(html).toContain('data-aviso-fecha="corte-ventas"');
    expect(html).toContain(AVISO_CORTE_VENTAS.es);
    expect(html).toContain("var(--amber-soft)");
    expect(html).not.toContain("var(--red");
    expect(pinta("sales", "2026-11-04", CST("2026-11-04", "11:59"))).toBe("");
    expect(pinta("sales", "2026-11-05", CST("2026-11-04", "15:00"))).toBe("");
    expect(pinta("manager", "2026-11-04", CST("2026-11-04", "15:00"))).toBe("");
  });
  it("el domingo conserva su propio aviso", () => {
    expect(pinta("sales", "2026-11-08", CST("2026-11-07", "15:00"))).toContain('data-aviso-fecha="domingo"');
  });
});

describe("cada camino de ventas pregunta en vez de bloquear", () => {
  const modal = leer("src/components/OrderModal.tsx");

  it("la ficha: los selectores vuelven a empezar en hoy y duplicar vuelve a nacer hoy (como antes de D-845)", () => {
    expect(modal.split("min={minFechaDeEntrega()} max={maxFechaDeEntrega()} />").length - 1).toBe(2);
    expect(modal).toContain("const payload: Draft = borradorDuplicado(existing, saltaDomingo(todayISO()));");
    expect(modal).not.toContain("minFechaParaRol");
  });
  it("la ficha: una pregunta con el diálogo de la app (useConfirm), nunca window.confirm", () => {
    expect(modal).toContain("!pideConfirmarMediodia(nueva, existing?.delivery_date, { rol: me.role, agenda }) || preguntaSiEsParaHoy(confirmAction, t);");
    expect(modal).not.toContain("window.confirm(");
    // `fechaNoVale` (que dice que no) ya no mira la hora.
    const fechaNoVale = modal.slice(modal.indexOf("const fechaNoVale"), modal.indexOf("const siguePorMediodia"));
    expect(fechaNoVale).not.toMatch(/Mediodia|CORTE/);
  });
  it("la ficha: crear y enviar (passesChecks), borrador, «solo la fecha», enviar borrador y reenviar rechazada preguntan", () => {
    expect(modal).toContain("if (!(await siguePorMediodia(draft.delivery_date))) return false;");
    expect(modal).toContain("if (!(await siguePorMediodia(d.delivery_date))) return;");
    expect(modal).toContain('if ((payload.stage ?? "draft") === "draft" && !(await siguePorMediodia(payload.delivery_date))) return;');
    expect(modal).toContain("if (esEnvioDeBorrador(existing.stage, to) && !(await siguePorMediodia(existing.delivery_date, { agenda: true }))) return;");
    // Una vez por guardado: cada camino tiene su propia línea, y ninguna pasa por dos.
    expect(modal.split("await siguePorMediodia(").length - 1).toBe(4);
  });
  it("«Reprogramar»: el selector empieza en hoy, el botón pregunta y los dos proveedores ya no bloquean", () => {
    const rep = leer("src/components/ReprogramarOrden.tsx");
    expect(rep).toContain("min={hoy}");
    expect(rep).toContain('import { useConfirm } from "@/lib/confirm";');
    expect(rep).toContain("if (pideConfirmarMediodia(fecha, pedido.delivery_date, { rol }) && !(await preguntaSiEsParaHoy(confirmAction, t))) return;");
    expect(rep).not.toMatch(/const valida = [^\n]*Mediodia/);
    for (const p of ["src/lib/data-provider.tsx", "src/lib/local-data-provider.tsx"]) {
      expect(leer(p)).not.toContain("corte-de-ventas\";");
      expect(leer(p)).not.toContain("AVISO_CORTE_VENTAS");
    }
  });
  it("el aviso debajo del selector lo aconseja antes de guardar", () => {
    const aviso = leer("src/components/AvisoDeFecha.tsx");
    expect(aviso).toContain("if (!imposible && !esDomingo(fecha) && pideConfirmarMediodia(fecha, actual, { rol, ahora })) {");
    expect(aviso).toContain("t(AVISO_CORTE_VENTAS.en, AVISO_CORTE_VENTAS.es)");
  });
  it("la celda del Gestor y la fecha en bloque, por si llegan a ventas: preguntan, no bloquean", () => {
    expect(leer("src/app/(app)/routes/page.tsx")).toContain("if (pideConfirmarMediodia(delivery_date, actual, { rol: me?.role }) && !(await preguntaSiEsParaHoy(confirmAction, t))) return;");
    expect(leer("src/app/(app)/page.tsx")).toContain("if (pideConfirmarMediodia(date, null, { rol: me?.role }) && !(await preguntaSiEsParaHoy(confirmAction, t))) return;");
  });
});

describe("la migración 237: EN ESPERA por decisión del dueño (sin aplicar, sin editar)", () => {
  const sql = leer("supabase/migrations/237_corte_mediodia_ventas.sql");
  const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("la nota de espera vive en corte-de-ventas.ts", () => {
    const regla = leer("src/lib/corte-de-ventas.ts");
    expect(regla).toContain("MIGRACIÓN 237");
    expect(regla).toContain("EN ESPERA por decisión del");
    expect(regla).toContain("NO se aplica hasta que él lo diga");
  });
  it("el archivo sigue como se escribió (hora de Texas, las 12, solo ventas)", () => {
    expect(codigo).toContain("now() at time zone 'America/Chicago'");
    expect(codigo).toContain("extract(hour from ahora_tx) >= 12 and NEW.delivery_date <= ahora_tx::date");
    expect(codigo).toContain("create trigger deliveries_guard_corte_ventas before insert or update on public.deliveries");
  });
  it("su mensaje es MENSAJE_DE_LA_237, que ya no es el aviso de la pantalla", () => {
    expect(codigo).toContain(`'${MENSAJE_DE_LA_237.en} / ${MENSAJE_DE_LA_237.es}'`);
    expect(MENSAJE_DE_LA_237.en).not.toBe(AVISO_CORTE_VENTAS.en);
  });
  it("se registra en el libro de migraciones", () => {
    expect(sql).toContain("-- @ledger-below\ninsert into public.schema_migrations (name, checksum)\n  values ('237_corte_mediodia_ventas.sql',");
  });
});
