import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ETAPAS_PARA_TOMAR, KIND_TOMADA_POR_CHOFER, MINIMO_PARA_BUSCAR, ajenasParaTomar, etiquetaDeLaOrden, facturaParaBuscar,
  falloAlTomar, mensajeDelFallo, motivoLimpio, motivoValido, notaDeExcepcion, numerosDeFactura, sePuedeBuscar, type OrdenParaTomar,
} from "./tomar-orden";

// D-625 (2026-10-21) · el dueño: «Drivers will need to be able to search for invoice numbers that aren't assigned to them
// and pick them up even if they're not assigned to them. That will be only exceptions». Lo que DECIDE vive en la base
// (migración 188, ensayada con ROLLBACK contra producción); aquí, la forma del texto, los errores y las puertas.

const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const t = (en: string, es: string) => `${en}|${es}`;

describe("el texto que se busca", () => {
  it("sin espacios ni '#', en mayúsculas; desde 4 caracteres", () => {
    expect(facturaParaBuscar("  #171 280 ")).toBe("171280");
    expect(facturaParaBuscar("m-12345")).toBe("M-12345");
    expect(MINIMO_PARA_BUSCAR).toBe(4);
    expect(sePuedeBuscar("171")).toBe(false);
    expect(sePuedeBuscar("# 1712")).toBe(true);
    expect(sePuedeBuscar(null)).toBe(false);
  });

  it("la copia de numeros_de_factura (188) parte igual que la base los casos de su autocomprobación", () => {
    expect(numerosDeFactura("179745, 179783")).toEqual(expect.arrayContaining(["179745", "179783"]));
    expect(numerosDeFactura("147834-148487")).toEqual(expect.arrayContaining(["147834", "148487", "147834-148487"]));
    expect(numerosDeFactura("M-12345")).toEqual(expect.arrayContaining(["M-12345", "M", "12345"]));
    expect(numerosDeFactura("#171280")).toEqual(["171280"]);
    expect(numerosDeFactura("171198/ 171205/ 171207")).toEqual(expect.arrayContaining(["171198", "171205", "171207"]));
    expect(numerosDeFactura(null)).toEqual([]);
    // Exacto: un número incompleto no está.
    expect(numerosDeFactura("171280")).not.toContain("17128");
  });

  it("puerta: la 188 parte con las mismas dos expresiones y compara contra el texto normalizado igual", () => {
    const sql = leer("supabase/migrations/188_chofer_toma_orden.sql");
    expect(sql).toContain("'[^A-Z0-9-]+'");
    expect(sql).toContain("'[^A-Z0-9]+'");
    expect(sql).toContain("q   text := upper(regexp_replace(coalesce(p_texto, ''), '[\\s#]', '', 'g'));");
    expect(sql).toContain("if char_length(q) < 4 then");
    expect(sql).toContain("where d.stage in ('approved','fulfilling','ready')");
  });
});

describe("el motivo", () => {
  it("se limpia y pide 3 letras o más (como la base)", () => {
    expect(motivoLimpio("  el   otro\nno vino ")).toBe("el otro no vino");
    expect(motivoValido("ok")).toBe(false);
    expect(motivoValido("  ok  ")).toBe(false);
    expect(motivoValido("ya")).toBe(false);
    expect(motivoValido("sí, urge")).toBe(true);
    expect(leer("supabase/migrations/188_chofer_toma_orden.sql")).toContain("if char_length(limpio) < 3 then");
  });
});

describe("lo que se ofrece para tomar", () => {
  const fila = (id: string, extra: Partial<OrdenParaTomar> = {}): OrdenParaTomar => ({
    id, order_no: 1140, order_suffix: null, order_code: null, invoice_num: "171280", account: "Acme", store: "RDZ Pharr",
    pickup_name: null, delivery_name: null, delivery_address: null, delivery_date: "2026-10-22", stage: "approved",
    assigned_driver: null, est_pallets: 2, es_mia: false, ...extra,
  });
  it("ni las suyas, ni las que ya están en su lista, ni las que ya no esperan recogida", () => {
    const filas = [fila("a"), fila("b", { es_mia: true }), fila("c"), fila("d", { stage: "picked_up" }), fila("e", { stage: "ready", assigned_driver: "Otro" })];
    expect(ajenasParaTomar(filas, new Set(["c"])).map((f) => f.id)).toEqual(["a", "e"]);
    expect([...ETAPAS_PARA_TOMAR].sort()).toEqual(["approved", "fulfilling", "ready"]);
  });
  it("la etiqueta: número, carga y factura", () => {
    expect(etiquetaDeLaOrden({ order_no: 1140, order_suffix: "b", invoice_num: " 171280 " })).toBe("#1140b · INV 171280");
    expect(etiquetaDeLaOrden({ order_no: 7, order_suffix: null, invoice_num: null })).toBe("#7");
  });
});

describe("los errores de la base, en palabras", () => {
  it("cada código TOMAR_… y la función sin aplicar", () => {
    expect(falloAlTomar({ message: "TOMAR_SIN_MOTIVO: write why" })).toBe("sin-motivo");
    expect(falloAlTomar({ message: "TOMAR_ETAPA: only an approved…" })).toBe("etapa");
    expect(falloAlTomar({ message: "TOMAR_YA_ES_TUYA: …" })).toBe("ya-es-tuya");
    expect(falloAlTomar({ message: "TOMAR_NO_PERMITIDO: …" })).toBe("no-permitido");
    expect(falloAlTomar({ message: "TOMAR_SIN_SESION: …" })).toBe("sin-sesion");
    expect(falloAlTomar({ message: "TOMAR_NO_GUARDADA: …" })).toBe("no-existe");
    expect(falloAlTomar({ code: "PGRST202", message: "Could not find the function public.tomar_orden_para_recoger" })).toBe("sin-funcion");
    expect(falloAlTomar({ message: "algo raro" })).toBe("otro");
    expect(falloAlTomar(null)).toBe("otro");
    expect(mensajeDelFallo("sin-motivo", t)).toContain("3 letras");
    expect(mensajeDelFallo("etapa", t)).toContain("ya no se puede tomar");
  });
  it("cada código que el texto lee existe en la 188 (y al revés)", () => {
    const sql = leer("supabase/migrations/188_chofer_toma_orden.sql");
    const codigos = [...new Set(sql.match(/TOMAR_[A-Z_]+/g) ?? [])].sort();
    expect(codigos).toEqual(["TOMAR_ETAPA", "TOMAR_NO_EXISTE", "TOMAR_NO_GUARDADA", "TOMAR_NO_PERMITIDO", "TOMAR_SIN_MOTIVO", "TOMAR_SIN_NOMBRE", "TOMAR_SIN_SESION", "TOMAR_YA_ES_TUYA"]);
    const lib = leer("src/lib/tomar-orden.ts");
    for (const c of codigos.filter((c) => c !== "TOMAR_SIN_NOMBRE")) expect(lib, c).toContain(`"${c}"`);
  });
});

describe("la nota del historial (demo) es la misma que escribe la base", () => {
  it("con y sin chofer de antes, en los dos idiomas", () => {
    expect(notaDeExcepcion({ yo: "Ana", antes: "Beto", motivo: " el  otro no vino ", lang: "es" }))
      .toBe("⚠️ Excepción: Ana tomó esta orden para recogerla (era de Beto): el otro no vino");
    expect(notaDeExcepcion({ yo: "Ana", antes: null, motivo: "urge", lang: "en" }))
      .toBe("⚠️ Exception: Ana took this order to pick it up (it had no driver): urge");
    const sql = leer("supabase/migrations/188_chofer_toma_orden.sql");
    expect(sql).toContain("'⚠️ Excepción: ' || mio || ' tomó esta orden para recogerla'");
    expect(sql).toContain("' (era de ' || o.assigned_driver || ')'");
    expect(sql).toContain("' (no tenía chofer)'");
  });
});

describe("puertas: la base, el proveedor, la pantalla del chofer y la campana", () => {
  it("la 188: guard con el bloque y solo esas columnas; funciones definer solo para authenticated; aviso con su kind", () => {
    const sql = leer("supabase/migrations/188_chofer_toma_orden.sql");
    const bloque = sql.slice(sql.indexOf("if current_setting('rtg.tomar_orden', true) = OLD.id::text then"), sql.indexOf("if r in ('manager','accounting') then return NEW; end if;"));
    for (const c of ["assigned_driver", "route_seq", "pickup_seq", "load_no", "delivery_date", "updated_at"]) expect(bloque, c).toContain(`probe.${c}`);
    expect((bloque.match(/probe\.[a-z_]+\s*:=/g) ?? []).length).toBe(6);
    expect(sql).toContain("perform set_config('rtg.tomar_orden', p_id::text, true);");
    expect(sql).toContain("grant execute on function public.tomar_orden_para_recoger(uuid, text, text) to authenticated;");
    expect(sql).toContain("revoke execute on function public.buscar_factura_para_recoger(text) from public, anon;");
    expect(sql).toContain(`'${KIND_TOMADA_POR_CHOFER}', aviso`);
    expect(sql).not.toMatch(/^\s*(begin|commit)\s*;/im);
  });

  it("el proveedor llama a las dos funciones y recarga; el modo enseñanza no escribe", () => {
    const dp = leer("src/lib/data-provider.tsx");
    expect(dp).toContain('supabase.rpc("buscar_factura_para_recoger", { p_texto: texto })');
    expect(dp).toContain('supabase.rpc("tomar_orden_para_recoger", { p_id: id, p_motivo: motivo, p_lang: lang })');
    expect(dp).toContain('await reloadTables(["deliveries", "order_events", "notifications"]);');
    const tramo = dp.slice(dp.indexOf("const tomarOrdenParaRecoger = useCallback"), dp.indexOf("const marcarParada = useCallback"));
    expect(tramo.indexOf("if (teaching)")).toBeGreaterThan(-1);
    expect(tramo.indexOf("if (teaching)")).toBeLessThan(tramo.indexOf("supabase.rpc("));
  });

  it("la pestaña Órdenes del chofer pinta las ajenas bajo su buscador, solo al chofer, y abre la tomada", () => {
    const pagina = leer("src/app/(app)/driver/page.tsx");
    expect(pagina).toContain('{me.role === "driver" && (\n        <TomarFacturaAjena texto={q} misIds={new Set(scoped.map((d) => d.id))} alTomar={(id) => { setTomada(id); setQ(""); }} />');
    expect(pagina).toContain("if (d) { setOpen(d); setTomada(null); }");
    const comp = leer("src/components/TomarFacturaAjena.tsx");
    expect(comp).toContain("const ajenas = ajenasParaTomar(filas, misIds);");
    expect(comp).toContain("disabled={!motivoValido(motivo) || tomando}");
    expect(comp).toContain("if (!sePuede) { setFilas([]); return; }");
  });

  it("la campana pinta el aviso en ámbar", () => {
    expect(leer("src/components/NotificationBell.tsx")).toContain(': n.kind === KIND_TOMADA_POR_CHOFER ? "var(--amber)"');
  });
});
