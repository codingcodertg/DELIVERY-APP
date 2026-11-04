import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AvisoDeFecha } from "@/components/AvisoDeFecha";
import {
  aplicaCorteDeVentas, AVISO_CORTE_VENTAS, cortaPorMediodia, fechaCortadaParaVentas, HORA_DE_CORTE_VENTAS, minFechaParaRol,
  pasoElCorteDeVentas,
} from "./corte-de-ventas";

/** El dueño, 2026-11-04: «sales no pueden ingresar una orden para el mismo día después de las 12, tiene que ser para el día siguiente». */
const leer = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

// 2026-11-04 (miércoles): Texas va en CST (UTC−6). 2026-10-30 (viernes): todavía CDT (UTC−5). El cambio fue el domingo 1-nov.
const CST = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-06:00`);
const CDT = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-05:00`);

describe("la hora de corte: las 12:00 en Texas", () => {
  it("11:59 todavía no; 12:00 en punto, ya (horario de invierno, CST)", () => {
    expect(HORA_DE_CORTE_VENTAS).toBe(12);
    expect(pasoElCorteDeVentas(CST("2026-11-04", "11:59"))).toBe(false);
    expect(pasoElCorteDeVentas(CST("2026-11-04", "12:00"))).toBe(true);
    expect(minFechaParaRol("sales", CST("2026-11-04", "11:59"))).toBe("2026-11-04");
    expect(minFechaParaRol("sales", CST("2026-11-04", "12:00"))).toBe("2026-11-05");
  });

  it("igual en horario de verano (CDT): 11:59 hoy, 12:00 mañana", () => {
    expect(minFechaParaRol("sales", CDT("2026-10-30", "11:59"))).toBe("2026-10-30");
    expect(minFechaParaRol("sales", CDT("2026-10-30", "12:00"))).toBe("2026-10-31");
  });

  it("cambio de horario: la MISMA hora UTC cae antes o después de las 12 según la época del año", () => {
    // 17:30Z = 12:30 CDT el 30-oct (ya pasó el corte) y 11:30 CST el 2-nov (todavía no). Con UTC fijo se equivocaría uno.
    expect(pasoElCorteDeVentas(new Date("2026-10-30T17:30:00Z"))).toBe(true);
    expect(pasoElCorteDeVentas(new Date("2026-11-02T17:30:00Z"))).toBe(false);
    // El domingo del cambio (1-nov, día de 25 horas): las 12 son las 18:00Z.
    expect(pasoElCorteDeVentas(new Date("2026-11-01T17:59:00Z"))).toBe(false);
    expect(pasoElCorteDeVentas(new Date("2026-11-01T18:00:00Z"))).toBe(true);
    // Adelanto de primavera (domingo 14-mar-2027, día de 23 horas): las 12 CDT son las 17:00Z.
    expect(pasoElCorteDeVentas(new Date("2027-03-14T16:59:00Z"))).toBe(false);
    expect(pasoElCorteDeVentas(new Date("2027-03-14T17:00:00Z"))).toBe(true);
    expect(minFechaParaRol("sales", new Date("2027-03-14T17:00:00Z"))).toBe("2027-03-15");
    // La víspera del adelanto, de noche: «mañana» es el domingo, por calendario (no +24 h, que saltaría al lunes).
    expect(minFechaParaRol("sales", CST("2027-03-13", "23:30"))).toBe("2027-03-14");
  });

  it("mira el día de Texas, no el de UTC: a las 23:30 de Texas en UTC ya es mañana", () => {
    // 05:30Z del 5-nov = 23:30 CST del 4-nov → hoy en Texas es el 4 y el primer día de ventas, el 5.
    const noche = new Date("2026-11-05T05:30:00Z");
    expect(minFechaParaRol("sales", noche)).toBe("2026-11-05");
    expect(fechaCortadaParaVentas("2026-11-04", { rol: "sales", ahora: noche })).toBe(true);
    expect(fechaCortadaParaVentas("2026-11-05", { rol: "sales", ahora: noche })).toBe(false);
    // 13:00Z = 07:00 CST: por la mañana, hoy vale.
    expect(fechaCortadaParaVentas("2026-11-04", { rol: "sales", ahora: new Date("2026-11-04T13:00:00Z") })).toBe(false);
  });

  it("fin de mes y de año: el 31 de diciembre por la tarde, el primer día es el 1 de enero", () => {
    expect(minFechaParaRol("sales", CST("2026-12-31", "14:00"))).toBe("2027-01-01");
  });
});

describe("a quién y a qué fecha", () => {
  const TARDE = CST("2026-11-04", "15:00");

  it("solo ventas: admin, gerente, logística, almacén, office y chofer siguen pudiendo poner hoy", () => {
    expect(aplicaCorteDeVentas("sales")).toBe(true);
    for (const rol of ["admin", "manager", "logistics", "warehouse", "accounting", "driver", null, undefined]) {
      expect(aplicaCorteDeVentas(rol)).toBe(false);
      expect(minFechaParaRol(rol, TARDE)).toBe("2026-11-04");
      expect(fechaCortadaParaVentas("2026-11-04", { rol, ahora: TARDE })).toBe(false);
    }
  });

  it("por la tarde, ventas: hoy (y antes) no; mañana y después, sí; sin fecha, nada que decir", () => {
    expect(fechaCortadaParaVentas("2026-11-04", { rol: "sales", ahora: TARDE })).toBe(true);
    expect(fechaCortadaParaVentas("2026-11-03", { rol: "sales", ahora: TARDE })).toBe(true);
    expect(fechaCortadaParaVentas("2026-11-05", { rol: "sales", ahora: TARDE })).toBe(false);
    expect(fechaCortadaParaVentas("2026-11-04T00:00:00", { rol: "sales", ahora: TARDE })).toBe(true);
    expect(fechaCortadaParaVentas(null, { rol: "sales", ahora: TARDE })).toBe(false);
    expect(fechaCortadaParaVentas("", { rol: "sales", ahora: TARDE })).toBe(false);
  });

  it("la escritura: solo cuando PONE la fecha, o cuando manda a programar (enviar borrador, reenviar rechazada)", () => {
    // Fecha nueva u otra: corta.
    expect(cortaPorMediodia("2026-11-04", null, { rol: "sales", ahora: TARDE })).toBe(true);
    expect(cortaPorMediodia("2026-11-04", "2026-11-06", { rol: "sales", ahora: TARDE })).toBe(true);
    // La misma de siempre (se toca otra cosa): no es agendar.
    expect(cortaPorMediodia("2026-11-04", "2026-11-04", { rol: "sales", ahora: TARDE })).toBe(false);
    // …salvo que la escritura la mande a programar: el borrador de las 10 no se envía a las 3.
    expect(cortaPorMediodia("2026-11-04", "2026-11-04", { rol: "sales", ahora: TARDE, agenda: true })).toBe(true);
    expect(cortaPorMediodia("2026-11-05", "2026-11-05", { rol: "sales", ahora: TARDE, agenda: true })).toBe(false);
    // Por la mañana nada corta; y a la oficina nunca.
    expect(cortaPorMediodia("2026-11-04", null, { rol: "sales", ahora: CST("2026-11-04", "11:59"), agenda: true })).toBe(false);
    expect(cortaPorMediodia("2026-11-04", null, { rol: "manager", ahora: TARDE, agenda: true })).toBe(false);
  });

  it("el aviso, en los dos idiomas", () => {
    expect(AVISO_CORTE_VENTAS.en).toMatch(/After 12:00 noon, sales orders start tomorrow/);
    expect(AVISO_CORTE_VENTAS.es).toMatch(/Después de las 12:00 del mediodía/);
  });
});

describe("el aviso debajo del selector", () => {
  const pinta = (rol: string, fecha: string, ahora: Date) =>
    renderToStaticMarkup(createElement(AvisoDeFecha, {
      fecha, actual: null, rol, caso: { marcado: false, motivo: "" }, onCaso: () => {}, t: (_en: string, es: string) => es, hoy: "2026-11-04", ahora,
    }));
  it("a ventas por la tarde, hoy sale en rojo; por la mañana, o a la oficina, nada", () => {
    expect(pinta("sales", "2026-11-04", CST("2026-11-04", "12:00"))).toContain('data-aviso-fecha="corte-ventas"');
    expect(pinta("sales", "2026-11-04", CST("2026-11-04", "12:00"))).toContain(AVISO_CORTE_VENTAS.es);
    expect(pinta("sales", "2026-11-04", CST("2026-11-04", "11:59"))).toBe("");
    expect(pinta("sales", "2026-11-05", CST("2026-11-04", "15:00"))).toBe("");
    expect(pinta("manager", "2026-11-04", CST("2026-11-04", "15:00"))).toBe("");
  });
  it("el domingo conserva su propio aviso", () => {
    // Domingo 2026-11-08 por la tarde del sábado 7: ventas puede poner el 8 (es mañana), pero es domingo.
    expect(pinta("sales", "2026-11-08", CST("2026-11-07", "15:00"))).toContain('data-aviso-fecha="domingo"');
  });
});

describe("cada camino de ventas usa la regla", () => {
  const modal = leer("src/components/OrderModal.tsx");

  it("la ficha: los dos selectores empiezan en el primer día del rol", () => {
    expect(modal.split("min={minFechaParaRol(me.role)}").length - 1).toBe(2);
  });
  it("la ficha: crear, enviar, guardar, borrador y «solo la fecha» pasan por `fechaNoVale`, que mira el corte primero", () => {
    expect(modal).toContain("if (cortaPorMediodia(nueva, existing?.delivery_date, { rol: me.role })) { notify(t(AVISO_CORTE_VENTAS.en, AVISO_CORTE_VENTAS.es)); return true; }");
    // passesChecks (crear y enviar), el borrador y «solo la fecha»
    expect(modal).toContain("if (fechaNoVale(draft.delivery_date)) return false;");
    expect(modal).toContain("if (fechaNoVale(d.delivery_date)) return;");
    expect(modal).toContain('if ((payload.stage ?? "draft") === "draft" && fechaNoVale(payload.delivery_date)) return;');
  });
  it("la ficha: enviar un borrador o reenviar una rechazada mira el corte aunque no cambie la fecha", () => {
    expect(modal).toContain("if (esEnvioDeBorrador(existing.stage, to)\n      && cortaPorMediodia(existing.delivery_date, existing.delivery_date, { rol: me.role, agenda: true })) {");
  });
  it("duplicar nace en el primer día del rol (mañana para ventas por la tarde), saltando el domingo", () => {
    expect(modal).toContain("borradorDuplicado(existing, saltaDomingo(minFechaParaRol(me.role)))");
  });
  it("«Reprogramar»: el selector, el botón y los dos proveedores", () => {
    const rep = leer("src/components/ReprogramarOrden.tsx");
    expect(rep).toContain("min={minFechaParaRol(rol)}");
    expect(rep).toContain("&& !cortaPorMediodia(fecha, pedido.delivery_date, { rol })\n    && !problemaAlAgendar(");
    for (const p of ["src/lib/data-provider.tsx", "src/lib/local-data-provider.tsx"]) {
      expect(leer(p)).toContain("if (cortaPorMediodia(fecha, antes, { rol: me?.role })) {");
    }
  });
  it("el aviso debajo del selector lo dice antes de guardar", () => {
    const aviso = leer("src/components/AvisoDeFecha.tsx");
    expect(aviso).toContain("if (!imposible && !esDomingo(fecha) && cortaPorMediodia(fecha, actual, { rol, ahora })) {");
    expect(aviso).toContain("t(AVISO_CORTE_VENTAS.en, AVISO_CORTE_VENTAS.es)");
  });
  it("la celda del Gestor y la fecha en bloque, por si llegan a ventas (permiso suelto)", () => {
    expect(leer("src/app/(app)/routes/page.tsx")).toContain("if (cortaPorMediodia(delivery_date, actual, { rol: me?.role })) {");
    expect(leer("src/app/(app)/page.tsx")).toContain("if (cortaPorMediodia(date, null, { rol: me?.role })) {");
  });
});

describe("la base lo repite (migración 237, sin aplicar al escribirla)", () => {
  const sql = leer("supabase/migrations/237_corte_mediodia_ventas.sql");
  const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("hora de Texas, las 12, solo ventas, solo órdenes programadas", () => {
    expect(codigo).toContain("now() at time zone 'America/Chicago'");
    expect(codigo).toContain("extract(hour from ahora_tx) >= 12 and NEW.delivery_date <= ahora_tx::date");
    expect(codigo).toContain("if coalesce(public.current_user_role(), 'sales') <> 'sales' then return NEW; end if;");
    expect(codigo).toContain("if auth.uid() is null then return NEW; end if;");
    expect(codigo).toContain("not in ('pending','approved','fulfilling','ready') then return NEW;");
    expect(codigo).toContain("create trigger deliveries_guard_corte_ventas before insert or update on public.deliveries");
  });
  it("una orden ya programada que se toca sin cambiarle la fecha pasa; la que sale de borrador o rechazada, no", () => {
    expect(codigo).toContain("and NEW.delivery_date is not distinct from OLD.delivery_date\n     and OLD.stage in ('pending','approved','fulfilling','ready') then\n    return NEW;");
  });
  it("el mensaje de la base es el mismo aviso de la pantalla", () => {
    expect(codigo).toContain(`'${AVISO_CORTE_VENTAS.en} / ${AVISO_CORTE_VENTAS.es}'`);
  });
  it("se registra en el libro de migraciones", () => {
    expect(sql).toContain("-- @ledger-below\ninsert into public.schema_migrations (name, checksum)\n  values ('237_corte_mediodia_ventas.sql',");
  });
});
