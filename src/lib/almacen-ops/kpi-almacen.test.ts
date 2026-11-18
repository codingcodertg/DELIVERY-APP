import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  META_DE_MERMA_PCT, MINIMO_DE_PERSONAS_TIEMPO, aplicaExcepcion, listasAntesDeRecoger, mesesHastaHoy, nivelDeBono, puntajeGeneral, rangoDelMes,
  resultadoDeMerma, resultadoDeTiempo, truncaDecimales, type EntregaParaListas,
} from "./kpi-almacen";
import type { EventoDeOrden } from "./kpi-entregas";

const MES = { desde: "2026-11-01", hasta: "2026-11-30" };

// ---------------------------------------------------------------------------------------------------------------------
describe("meses", () => {
  it("el rango de un mes va del día 1 al último, incluido febrero bisiesto", () => {
    expect(rangoDelMes("2026-11")).toEqual({ desde: "2026-11-01", hasta: "2026-11-30" });
    expect(rangoDelMes("2028-02")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
    expect(rangoDelMes("2026-02")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
  });
  it("rechaza meses mal escritos", () => {
    expect(rangoDelMes("2026-13")).toBeNull();
    expect(rangoDelMes("2026-00")).toBeNull();
    expect(rangoDelMes("2026-1")).toBeNull();
    expect(rangoDelMes("")).toBeNull();
  });
  it("los meses del selector van del actual hacia atrás, cruzando el año", () => {
    expect(mesesHastaHoy("2026-02-10", 4)).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
    expect(mesesHastaHoy("nope")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("excepción de las 4 horas", () => {
  const recogida = "2026-11-10T18:00:00Z";
  it("creada a menos de 4 horas antes de la recogida: aplica", () => {
    expect(aplicaExcepcion("2026-11-10T14:01:00Z", recogida)).toBe(true);
    expect(aplicaExcepcion("2026-11-10T17:59:59Z", recogida)).toBe(true);
  });
  it("exactamente 4 horas antes NO aplica (es estrictamente menos de 4)", () => {
    expect(aplicaExcepcion("2026-11-10T14:00:00Z", recogida)).toBe(false);
  });
  it("creada más de 4 horas antes: no aplica", () => {
    expect(aplicaExcepcion("2026-11-10T06:00:00Z", recogida)).toBe(false);
  });
  it("sin fecha de creación o con fecha rota: no aplica (no hay con qué medirla)", () => {
    expect(aplicaExcepcion(null, recogida)).toBe(false);
    expect(aplicaExcepcion(undefined, recogida)).toBe(false);
    expect(aplicaExcepcion("no es fecha", recogida)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("listas a tiempo (buenas / malas / excluidas)", () => {
  const ent = (id: string, creada: string | null): EntregaParaListas => ({
    id, order_code: id, invoice_num: null, store: "Pharr", pickup_name: null, delivery_date: null, created_at: creada,
  });
  const ev = (delivery_id: string, kind: string, created_at: string): EventoDeOrden => ({ delivery_id, kind, created_by: "u1", created_at });

  it("lista antes de la recogida = buena", () => {
    const r = listasAntesDeRecoger(
      [ent("a", "2026-11-10T06:00:00Z")],
      [ev("a", "ready", "2026-11-10T12:00:00Z"), ev("a", "picked_up", "2026-11-10T13:00:00Z")],
      MES,
    );
    expect(r).toEqual({ buenas: 1, malas: 0, excluidas: 0, recogidas: 1, pct: 100 });
  });

  it("marcada lista después de recogida, creada hace más de 4 horas = mala", () => {
    const r = listasAntesDeRecoger(
      [ent("a", "2026-11-10T06:00:00Z")],
      [ev("a", "picked_up", "2026-11-10T13:00:00Z"), ev("a", "ready", "2026-11-10T13:30:00Z")],
      MES,
    );
    expect(r.malas).toBe(1);
    expect(r.excluidas).toBe(0);
    expect(r.pct).toBe(0);
  });

  it("nunca marcada, creada hace más de 4 horas = mala", () => {
    const r = listasAntesDeRecoger([ent("a", "2026-11-10T06:00:00Z")], [ev("a", "picked_up", "2026-11-10T13:00:00Z")], MES);
    expect(r.malas).toBe(1);
  });

  it("no lista y creada a menos de 4 horas: EXCLUIDA, no cuenta contra el almacén ni en el denominador", () => {
    const r = listasAntesDeRecoger(
      [ent("buena", "2026-11-10T06:00:00Z"), ent("corta", "2026-11-10T11:00:00Z")],
      [
        ev("buena", "ready", "2026-11-10T12:00:00Z"), ev("buena", "picked_up", "2026-11-10T13:00:00Z"),
        ev("corta", "picked_up", "2026-11-10T13:00:00Z"),
      ],
      MES,
    );
    expect(r).toEqual({ buenas: 1, malas: 0, excluidas: 1, recogidas: 2, pct: 100 });
  });

  it("la excepción aplica también a una lista tarde (no lista = tarde o nunca)", () => {
    const r = listasAntesDeRecoger(
      [ent("a", "2026-11-10T11:00:00Z")],
      [ev("a", "picked_up", "2026-11-10T13:00:00Z"), ev("a", "ready", "2026-11-10T13:10:00Z")],
      MES,
    );
    expect(r.excluidas).toBe(1);
    expect(r.malas).toBe(0);
    expect(r.pct).toBeNull();
  });

  it("empate exacto (lista y recogida a la misma hora) NO es a tiempo", () => {
    const r = listasAntesDeRecoger([ent("a", "2026-11-10T06:00:00Z")], [ev("a", "ready", "2026-11-10T13:00:00Z"), ev("a", "picked_up", "2026-11-10T13:00:00Z")], MES);
    expect(r.buenas).toBe(0);
    expect(r.malas).toBe(1);
  });

  it("órdenes nunca recogidas no cuentan", () => {
    const r = listasAntesDeRecoger([ent("a", "2026-11-10T06:00:00Z")], [ev("a", "ready", "2026-11-10T12:00:00Z")], MES);
    expect(r.recogidas).toBe(0);
    expect(r.pct).toBeNull();
  });

  it("el porcentaje es buenas / (buenas + malas), sin contar excluidas: 3 de 4 = 75", () => {
    const e = [ent("1", "2026-11-10T06:00:00Z"), ent("2", "2026-11-10T06:00:00Z"), ent("3", "2026-11-10T06:00:00Z"), ent("4", "2026-11-10T06:00:00Z"), ent("5", "2026-11-10T17:00:00Z")];
    const evs: EventoDeOrden[] = [];
    for (const id of ["1", "2", "3"]) evs.push(ev(id, "ready", "2026-11-10T12:00:00Z"), ev(id, "picked_up", "2026-11-10T13:00:00Z"));
    evs.push(ev("4", "picked_up", "2026-11-10T13:00:00Z"));
    evs.push(ev("5", "picked_up", "2026-11-10T18:30:00Z")); // creada 1h30 antes: excluida
    const r = listasAntesDeRecoger(e, evs, MES);
    expect(r).toMatchObject({ buenas: 3, malas: 1, excluidas: 1, pct: 75 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("merma a precio de venta vs. ventas", () => {
  it("la meta es 0.5 %: menos de eso cumple; exactamente 0.5 NO cumple", () => {
    expect(META_DE_MERMA_PCT).toBe(0.5);
    expect(resultadoDeMerma(499, 100_000).cumple).toBe(true);   // 0.499 %
    expect(resultadoDeMerma(500, 100_000).cumple).toBe(false);  // 0.5 %
    expect(resultadoDeMerma(501, 100_000).cumple).toBe(false);
  });
  it("calcula el porcentaje sobre las ventas netas", () => {
    const r = resultadoDeMerma(1_240.5, 310_000);
    expect(r.pct).toBeCloseTo((1_240.5 / 310_000) * 100, 8); // 0.4001 %
    expect(r.ventas).toBe(310_000);
    expect(r.valor).toBe(1_240.5);
  });
  it("sin ventas (null) no hay porcentaje ni veredicto: nunca se inventa", () => {
    expect(resultadoDeMerma(1_000, null)).toEqual({ valor: 1_000, ventas: null, pct: null, cumple: null });
  });
  it("ventas en cero o no numéricas cuentan como sin datos", () => {
    expect(resultadoDeMerma(1_000, 0)).toMatchObject({ ventas: null, pct: null, cumple: null });
    expect(resultadoDeMerma(1_000, Number.NaN)).toMatchObject({ ventas: null, pct: null, cumple: null });
  });
  it("merma sin valor (NaN) se trata como cero", () => {
    expect(resultadoDeMerma(Number.NaN, 1_000)).toMatchObject({ valor: 0, pct: 0, cumple: true });
  });
  it("truncar, no redondear, para que 0.4996 % no se vea como 0.50 %", () => {
    expect(truncaDecimales(0.4996, 2)).toBe(0.49);
    expect(truncaDecimales(0.5, 2)).toBe(0.5);
    expect(truncaDecimales(99.96, 1)).toBe(99.9);
    expect(truncaDecimales(100, 1)).toBe(100);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("fichajes", () => {
  it("porcentaje de turnos fichados bien", () => {
    expect(resultadoDeTiempo(52, 49).pct).toBeCloseTo((49 / 52) * 100, 8);
  });
  it("sin turnos no hay porcentaje", () => {
    expect(resultadoDeTiempo(0, 0).pct).toBeNull();
  });
  it("los bien nunca pasan del total", () => {
    expect(resultadoDeTiempo(3, 9)).toMatchObject({ turnos: 3, bien: 3, pct: 100 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("puntaje general y bono", () => {
  it("promedio de los KPI con dato; merma cumple = 100, no cumple = 0", () => {
    expect(puntajeGeneral({ listas: 100, tiempo: 100, merma: true })).toBe(100);
    expect(puntajeGeneral({ listas: 90, tiempo: 90, merma: false })).toBe(60);
    expect(puntajeGeneral({ listas: 80, tiempo: null, merma: true })).toBe(90);
  });
  it("los KPI sin dato no entran en el promedio; sin ninguno, sin puntaje", () => {
    expect(puntajeGeneral({ listas: null, tiempo: null, merma: null })).toBeNull();
    expect(puntajeGeneral({ listas: 96, tiempo: null, merma: null })).toBe(96);
  });
  it("tramos del bono: 100 completo", () => {
    expect(nivelDeBono(100)).toBe("completo");
  });
  it("tramos del bono: 99.99 medio, 95 medio", () => {
    expect(nivelDeBono(99.99)).toBe("medio");
    expect(nivelDeBono(95)).toBe("medio");
  });
  it("tramos del bono: 94.99 cuarto, 90 cuarto", () => {
    expect(nivelDeBono(94.99)).toBe("cuarto");
    expect(nivelDeBono(90)).toBe("cuarto");
  });
  it("tramos del bono: 89.99 ninguno", () => {
    expect(nivelDeBono(89.99)).toBe("ninguno");
    expect(nivelDeBono(0)).toBe("ninguno");
  });
  it("sin puntaje, sin tramo", () => {
    expect(nivelDeBono(null)).toBeNull();
    expect(nivelDeBono(Number.NaN)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("migración 325: la puerta de gerencia y el registro", () => {
  const SQL = readFileSync(join(process.cwd(), "supabase/migrations/325_kpi_almacen.sql"), "utf8").replace(/\r\n/g, "\n");
  const [cuerpo, registro] = SQL.split("-- @ledger-below");

  it("la función existe, es SECURITY DEFINER y solo la puede ejecutar authenticated", () => {
    expect(SQL).toContain("create or replace function public.warehouse_ops_kpi_almacen_mes(p_store text, p_desde date, p_hasta date)");
    expect(SQL).toContain("security definer");
    expect(SQL).toContain("revoke all on function public.warehouse_ops_kpi_almacen_mes(text, date, date) from public, anon;");
    expect(SQL).toContain("grant execute on function public.warehouse_ops_kpi_almacen_mes(text, date, date) to authenticated;");
  });

  it("la puerta de gerencia va ANTES de cualquier lectura y rechaza al personal de merma", () => {
    const gate = SQL.indexOf("PUERTA DE GERENCIA");
    expect(gate).toBeGreaterThan(0);
    const primeraLectura = SQL.indexOf("from public.warehouse_reports");
    expect(gate).toBeLessThan(primeraLectura);
    expect(SQL).toContain("v_nivel in ('admin', 'store_admin')");
    expect(SQL).toContain("v_recruiting in ('admin', 'manager')");
    expect(SQL).toContain("coalesce(v_nivel = 'full' and (coalesce(v_role = 'manager', false)");
    expect(SQL).toContain("coalesce('warehouse_ops_supervisor' = any(v_perms), false)");
    expect(SQL).toContain("using errcode = '42501'");
    // scrap_only nunca aparece como nivel permitido.
    expect(SQL).not.toMatch(/v_nivel in \([^)]*scrap_only/);
  });

  it("la puerta es a prueba de NULL: cada término va con coalesce, y un NULL rechaza (no abre)", () => {
    // Con recruiting_role NULL, «v_recruiting in (...)» da NULL; sin coalesce el `if not (...)` no lanza.
    expect(SQL).toContain("coalesce(v_recruiting in ('admin', 'manager'), false)");
    expect(SQL).toContain("coalesce(v_role = 'admin', false)");
    expect(SQL).toContain("coalesce(v_nivel in ('admin', 'store_admin'), false)");
    expect(SQL).toContain("if not coalesce(v_ok, false) then");
    expect(SQL).not.toMatch(/if not \(\s*v_role = 'admin'/);
  });

  it("sin fila de perfil se rechaza antes de evaluar nada", () => {
    const sinFila = SQL.indexOf("if not found then");
    expect(sinFila).toBeGreaterThan(0);
    expect(SQL.slice(sinFila, sinFila + 200)).toContain("errcode = '42501'");
    expect(sinFila).toBeLessThan(SQL.indexOf("v_ok := coalesce("));
  });

  it("solo meses completos: el día 1 y el último día del mes, o 22023", () => {
    expect(SQL).toContain("p_desde <> date_trunc('month', p_desde)::date");
    expect(SQL).toContain("p_hasta <> (date_trunc('month', p_desde) + interval '1 month - 1 day')::date");
    expect(SQL).toContain("using errcode = '22023'");
  });

  it("con menos de 3 personas, los números de fichaje salen null (la base, no solo la pantalla)", () => {
    expect(MINIMO_DE_PERSONAS_TIEMPO).toBe(3);
    expect(SQL).toContain("'turnos',       case when v_personas >= 3 then v_turnos else null end");
    expect(SQL).toContain("'turnos_bien',  case when v_personas >= 3 then v_bien else null end");
    expect(SQL).toContain("'horas',        case when v_personas >= 3 then round(v_horas, 2) else null end");
  });

  it("ninguna respuesta de la ruta filtra el detalle de la base", () => {
    const ruta = readFileSync(join(process.cwd(), "src/app/api/almacen-ops/kpi-almacen/route.ts"), "utf8");
    expect(ruta).not.toMatch(/detail\s*:/);
    expect(ruta).toContain('errorAlCliente("kpi-almacen"');
  });

  it("la tienda también debe ser de quien pide", () => {
    expect(SQL).toContain("if not public.warehouse_ops_in_store(p_store) then");
  });

  it("el registro lleva el checksum del cuerpo", () => {
    const sha = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    expect(registro).toContain(`values ('325_kpi_almacen.sql', '${sha}')`);
  });
});
