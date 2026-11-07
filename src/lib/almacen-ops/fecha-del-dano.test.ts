import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { diaDelReporte, diaEnTexas, esDia, fechaDelDanoValida, fmtDia, hoyEnTexas, ordenPorDia } from "./fecha-del-dano";
import { PASOS, PASO_FECHA_DEL_DANO, pasoCompleto, pasosVisibles, primerHueco, respuestasIniciales, respuestasParaGuardar, etiquetaDeOpcion } from "./pasos";
import { totalesPorTienda } from "./perdida";
import { puedeLlenar, tiposPermitidos } from "./nivel";
import { guardarBorrador, leerBorrador, type Almacen } from "./borradores";

/**
 * D-908 (migración 266): «scrap needs to be able to input the date it was broken». Un día, por defecto hoy en Texas,
 * editable, obligatorio y nunca futuro; en su columna; y las listas, filtros y totales de merma cuentan por ese día.
 */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");
const SQL = leer("supabase/migrations/266_merma_fecha_del_dano.sql");
const HOY = "2026-11-06";
const completo = { product: { id: 7, sku: "S", name: "N", cost: 1, pieces_per_box: 8 }, split: { damaged: 8, sample: 0 },
  qty: { boxes: 1, piecesPerBox: 8, loosePieces: 0 }, return_type: "internal", reason: "fell", photo: ["data:image/jpeg;base64,/9j/"] }; // 268: la merma ya no se envía sin foto

describe("hoy en Texas", () => {
  it("es el día de Texas, no el de UTC ni el del aparato", () => {
    // 6 nov 2026, 03:30 UTC = 5 nov, 21:30 en Texas (CST, UTC-6).
    expect(hoyEnTexas(new Date("2026-11-06T03:30:00Z"))).toBe("2026-11-05");
    expect(hoyEnTexas(new Date("2026-11-06T06:00:00Z"))).toBe("2026-11-06");
    // En verano Texas va a UTC-5.
    expect(hoyEnTexas(new Date("2026-07-02T04:59:00Z"))).toBe("2026-07-01");
    expect(hoyEnTexas(new Date("2026-07-02T05:00:00Z"))).toBe("2026-07-02");
    expect(diaEnTexas("2026-11-06T03:30:00Z")).toBe("2026-11-05");
    expect(diaEnTexas("no es fecha")).toBe("");
  });
});

describe("la fecha vale si es un día de verdad y no es futuro", () => {
  it("hoy y antes, sí; mañana, no", () => {
    expect(fechaDelDanoValida(HOY, HOY)).toBe(true);
    expect(fechaDelDanoValida("2026-11-05", HOY)).toBe(true);
    expect(fechaDelDanoValida("2025-12-31", HOY)).toBe(true);
    expect(fechaDelDanoValida("2026-11-07", HOY)).toBe(false);
    expect(fechaDelDanoValida("2027-01-01", HOY)).toBe(false);
  });
  it("vacío, a medias o un día que no existe, no", () => {
    for (const v of ["", "2026-11", "06/11/2026", "2026-02-30", "2026-13-01", "2026-11-6", null, undefined, 20261106]) {
      expect(fechaDelDanoValida(v, HOY), String(v)).toBe(false);
    }
    expect(esDia("2024-02-29")).toBe(true);
    expect(esDia("2026-02-29")).toBe(false);
  });
});

describe("el formulario de merma", () => {
  const paso = PASOS.scrap.find((p) => p.id === PASO_FECHA_DEL_DANO)!;
  it("tiene el paso de la fecha, y solo la merma lo tiene", () => {
    expect(paso.tipo).toBe("fecha");
    expect(paso.en).toBe("What date was it broken?");
    expect(paso.es).toBe("¿Qué día se rompió?");
    expect(PASOS.scrap.map((p) => p.id)).toEqual(["product", "photo", "qty", "return_type", "reason", "broken_on", "broken_by", "crma", "comments"]);
    for (const [tipo, pasos] of Object.entries(PASOS)) {
      if (tipo !== "scrap") expect(pasos.some((p) => p.tipo === "fecha"), tipo).toBe(false);
    }
    expect(pasosVisibles("scrap", {}).some((p) => p.id === "broken_on")).toBe(true);
  });
  it("arranca en hoy (Texas) y se puede cambiar", () => {
    expect(respuestasIniciales("scrap", null, HOY)).toEqual({ broken_on: HOY });
    expect(respuestasIniciales("incident", null, HOY)).toEqual({});
    expect(pasoCompleto(paso, respuestasIniciales("scrap", null, HOY), HOY)).toBe(true);
    expect(pasoCompleto(paso, { broken_on: "2026-11-03" }, HOY)).toBe(true);
  });
  it("es obligatoria: sin fecha o con una futura el paso no avanza y el resumen no envía", () => {
    expect(pasoCompleto(paso, {}, HOY)).toBe(false);
    expect(pasoCompleto(paso, { broken_on: "" }, HOY)).toBe(false);
    expect(pasoCompleto(paso, { broken_on: "2026-11-07" }, HOY)).toBe(false);
    const i = pasosVisibles("scrap", completo).findIndex((p) => p.id === "broken_on");
    expect(primerHueco("scrap", completo, HOY)).toBe(i);
    expect(primerHueco("scrap", { ...completo, broken_on: "2026-11-07" }, HOY)).toBe(i);
    expect(primerHueco("scrap", { ...completo, broken_on: "2026-11-01" }, HOY)).toBe(-1);
    expect(primerHueco("scrap", respuestasIniciales("scrap", completo, HOY), HOY)).toBe(-1);
  });
  it("viaja en answers, que es de donde la base la pasa a su columna", () => {
    expect(respuestasParaGuardar("scrap", { ...completo, broken_on: "2026-11-01" })).toEqual({ return_type: "internal", reason: "fell", broken_on: "2026-11-01" });
  });
  it("el resumen la enseña como fecha", () => {
    expect(etiquetaDeOpcion("scrap", "broken_on", "2026-11-01", "en")).toBe(fmtDia("2026-11-01", "en"));
    expect(fmtDia("2026-11-01", "en")).toMatch(/Nov 01, 2026/);
    expect(fmtDia("2026-11-01", "es")).toMatch(/01 nov 2026/);
    expect(fmtDia(null)).toBe("—");
  });
  it("quien solo tiene merma (el personal de almacén) llena este formulario, con su fecha", () => {
    const almacen = { role: "warehouse", module_access: ["warehouse_ops"], warehouse_ops_role: "scrap_only" };
    expect(tiposPermitidos(almacen)).toEqual(["scrap"]);
    expect(puedeLlenar(almacen, "scrap")).toBe(true);
    expect(PASOS.scrap.some((p) => p.id === "broken_on")).toBe(true);
  });
});

describe("los borradores", () => {
  const memoria = (): Almacen => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };
  it("guardan la fecha elegida y la devuelven al reabrir", () => {
    const a = memoria();
    guardarBorrador("u", { id: "b1", tipo: "scrap", r: { ...completo, broken_on: "2026-11-02" }, paso: 4, tienda: "RDZ Pharr", guardado: "2026-11-06T10:00:00Z" }, a);
    const b = leerBorrador("u", "b1", a)!;
    expect(b.r.broken_on).toBe("2026-11-02");
    expect(respuestasIniciales("scrap", b.r, HOY).broken_on).toBe("2026-11-02");
  });
  it("un borrador de antes (sin fecha) recibe hoy; uno con una fecha que ya no vale, también", () => {
    expect(respuestasIniciales("scrap", completo, HOY).broken_on).toBe(HOY);
    expect(respuestasIniciales("scrap", { ...completo, broken_on: "2026-12-25" }, HOY).broken_on).toBe(HOY);
    expect(respuestasIniciales("scrap", { ...completo, broken_on: "basura" }, HOY).broken_on).toBe(HOY);
  });
});

describe("la lista y los filtros van por el día en que se rompió", () => {
  const merma = { kind: "scrap", created_at: "2026-11-06T15:00:00Z", broken_on: "2026-11-02" };
  it("merma: su fecha del daño; un reporte de antes sin ella, el día en que se reportó en Texas", () => {
    expect(diaDelReporte(merma)).toBe("2026-11-02");
    expect(diaDelReporte({ kind: "scrap", created_at: "2026-11-06T03:30:00Z", broken_on: null })).toBe("2026-11-05");
    expect(diaDelReporte({ kind: "scrap", created_at: "2026-11-06T15:00:00Z" })).toBe("2026-11-06");
  });
  it("los demás tipos: el día en que se reportaron, en Texas", () => {
    expect(diaDelReporte({ kind: "safety", created_at: "2026-11-06T03:30:00Z" })).toBe("2026-11-05");
    expect(diaDelReporte({ kind: "safety", created_at: "2026-11-06T03:30:00Z", broken_on: "2026-01-01" })).toBe("2026-11-05");
  });
  it("orden: más reciente primero por ese día; el mismo día, lo último reportado primero", () => {
    const filas = [
      { id: "a", kind: "scrap", created_at: "2026-11-06T15:00:00Z", broken_on: "2026-11-02" },
      { id: "b", kind: "safety", created_at: "2026-11-04T15:00:00Z" },
      { id: "c", kind: "scrap", created_at: "2026-11-03T15:00:00Z", broken_on: "2026-11-03" },
      { id: "d", kind: "scrap", created_at: "2026-11-05T15:00:00Z", broken_on: "2026-11-02" },
    ];
    expect(ordenPorDia(filas).map((f) => f.id)).toEqual(["b", "c", "a", "d"]);
  });
  it("la pantalla usa esas funciones para ordenar, filtrar, la columna y la tarjeta", () => {
    const lista = leer("src/app/operaciones/ListaDeReportes.tsx");
    expect(lista).toContain("const dia = diaDelReporte(r);");
    expect(lista).not.toContain("r.created_at.slice(0, 10)");
    expect(lista.match(/ordenPorDia\(/g) ?? []).toHaveLength(2);
    expect(lista).toContain('r.kind === "scrap" ? fmtDia(diaDelReporte(r), lang) : fmtDateTime(r.created_at)');
    expect(lista).toContain('<dt>{t("Date broken", "Fecha del daño")}</dt><dd data-fecha-del-dano={diaDelReporte(r)}>');
    expect(leer("src/app/operaciones/Operaciones.tsx")).toContain("data-borrador-fecha={b.r.broken_on}");
    const asistente = leer("src/app/operaciones/Asistente.tsx");
    expect(asistente).toContain('<input type="date" className="ops-campo ops-campo-fecha" value={dia} max={hoy} required');
    expect(asistente).toContain("respuestasIniciales(tipo, inicial?.r)");
  });
});

describe("los totales de pérdida van por el día en que se rompió", () => {
  const ahora = new Date(2026, 10, 6, 12); // viernes 6 nov 2026; la semana empezó el domingo 1
  it("una merma reportada hoy pero rota el mes pasado no entra en esta semana ni en este mes", () => {
    const t = totalesPorTienda([
      { created_at: new Date(2026, 10, 6, 9).toISOString(), broken_on: "2026-10-20", store: "A", total_loss: 100 },
      { created_at: new Date(2026, 10, 6, 9).toISOString(), broken_on: "2026-11-02", store: "A", total_loss: 10 },
    ], ahora);
    expect(t.A).toEqual({ semana: 10, mes: 10, todo: 110 });
  });
  it("rota este mes antes del domingo: cuenta en el mes y no en la semana", () => {
    // Nov 2026 empieza en domingo, así que se prueba con otra semana: «ahora» el jueves 12.
    const t = totalesPorTienda([{ created_at: new Date(2026, 10, 12, 9).toISOString(), broken_on: "2026-11-05", store: "A", total_loss: 7 }], new Date(2026, 10, 12, 12));
    expect(t.A).toEqual({ semana: 0, mes: 7, todo: 7 });
  });
  it("el domingo que abre la semana ya cuenta (el día entero, no desde una hora)", () => {
    const t = totalesPorTienda([{ created_at: new Date(2026, 10, 12, 9).toISOString(), broken_on: "2026-11-08", store: "A", total_loss: 3 }], new Date(2026, 10, 12, 12));
    expect(t.A.semana).toBe(3);
  });
  it("sin fecha del daño (un reporte de antes en una pantalla vieja) sigue contando por cuándo se reportó", () => {
    const t = totalesPorTienda([{ created_at: new Date(2026, 10, 5).toISOString(), store: "A", total_loss: 4 }], ahora);
    expect(t.A).toEqual({ semana: 4, mes: 4, todo: 4 });
  });
});

describe("la base (migración 266)", () => {
  it("la columna es una fecha y lo que ya hay se rellena con el día en que se reportó, en Texas", () => {
    expect(SQL).toContain("alter table public.warehouse_reports add column if not exists broken_on date;");
    expect(SQL).toMatch(/set broken_on = \(created_at at time zone 'America\/Chicago'\)::date\s+where kind = 'scrap' and broken_on is null;/);
  });
  it("el trigger la valida al insertar: un día de verdad, no futuro en Texas; sin ella, hoy en Texas", () => {
    expect(SQL).toMatch(/create trigger warehouse_reports_broken_on before insert on public\.warehouse_reports\s+for each row execute function public\.warehouse_report_set_broken_on\(\)/);
    const f = SQL.slice(SQL.indexOf("create or replace function public.warehouse_report_set_broken_on"), SQL.indexOf("create trigger warehouse_reports_broken_on"));
    expect(f).toContain("hoy date := (now() at time zone 'America/Chicago')::date;");
    expect(f).toContain("NEW.answers->>'broken_on'");
    expect(f).toContain("d := coalesce(NEW.broken_on, hoy);");
    expect(f).toContain("if d > hoy then");
    expect(f).toContain("la fecha del dano no puede ser futura");
    expect(f).toContain("la fecha del dano no es valida");
    // La saca de answers y solo la merma la lleva.
    expect(f).toContain("NEW.answers := NEW.answers - 'broken_on'");
    expect(f).toMatch(/if NEW\.kind <> 'scrap' then\s+NEW\.broken_on := null;/);
  });
  it("obligatoria en merma y vacía en lo demás, por check", () => {
    expect(SQL).toContain("check ((kind = 'scrap' and broken_on is not null) or (kind <> 'scrap' and broken_on is null));");
  });
  it("no toca la función que registra (misma firma: la pantalla desplegada sigue entrando)", () => {
    expect(SQL).not.toMatch(/create or replace function public\.warehouse_ops_file_report/);
    expect(SQL).not.toMatch(/create policy/);
  });
  it("lleva su registro", () => {
    expect(SQL).toContain("-- @ledger-below");
    expect(SQL).toContain("values ('266_merma_fecha_del_dano.sql', '");
    expect(SQL).not.toContain("D-908");
  });
});
