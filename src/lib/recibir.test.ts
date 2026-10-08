import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { idsRecibidasPorAlmacen, esRecibida, KIND_RECIBIDA, pastillaDeEtapa, puedeRecibir, RECIBIDO_COLOR, recibirOrden } from "./recibir";
import { canTransition, stageInfo } from "./constants";
import type { NamedLocation, Stage, UserRole } from "./types";

/**
 * «Recibir» de almacén (D-409). El dueño, el 2026-09-26: *«warehouse puede darle delivery a una carga que
 * vaya donde ellos, pero si ellos lo hacen no aparecerá como delivered sino como received; y received es
 * lo mismo que delivered, solo que esto es para diferenciar si fue el driver o el warehouse»*.
 *
 * Tres reglas, y cada una con la pantalla que la usa: quién ve «Recibir», qué escribe, y cómo se pinta.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");

// Tiendas inventadas. A y B trabajan juntas (D-293); C y D van solas.
const TIENDAS: NamedLocation[] = [
  { name: "Tienda A", address: "1 A St", group: "NORTE" },
  { name: "Tienda B", address: "2 B St", group: "NORTE" },
  { name: "Tienda C", address: "3 C St" },
  { name: "Tienda D", address: "4 D St" },
] as NamedLocation[];
const INTERTIENDA = { storeToStore: true } as const;
const CLIENTE = { storeToStore: false } as const;

const almacenDe = (store: string | null) => ({ role: "warehouse" as UserRole, store });
/** Una Intertienda de `desde` a `hasta`, con la forma de D-312: «Vendido desde» (`store`) y la recogida son la
 *  tienda que manda; `delivery_name`, la que recibe. */
const carga = (desde: string, hasta: string, stage: Stage = "picked_up") => ({ store: desde, pickup_name: desde, delivery_name: hasta, stage });

describe("quién ve «Recibir»", () => {
  it("almacén de la tienda destino, en una Intertienda recogida que entra a su tienda", () => {
    expect(puedeRecibir(almacenDe("Tienda A"), carga("Tienda C", "Tienda A"), INTERTIENDA, TIENDAS)).toBe(true);
  });

  it("y en la de su grupo (D-293): Recepción es la suya y las que trabajan con ella", () => {
    expect(puedeRecibir(almacenDe("Tienda A"), carga("Tienda C", "Tienda B"), INTERTIENDA, TIENDAS)).toBe(true);
  });

  it("una que va a OTRA tienda no se la ofrece", () => {
    expect(puedeRecibir(almacenDe("Tienda A"), carga("Tienda C", "Tienda D"), INTERTIENDA, TIENDAS)).toBe(false);
  });

  it("la tienda de destino manda, no la que vende: una orden que SALE de la suya tampoco", () => {
    // La tienda A la manda a D: es trabajo de la Cola de A, no algo que A recibe.
    expect(puedeRecibir(almacenDe("Tienda A"), { store: "Tienda A", pickup_name: "Tienda A", delivery_name: "Tienda D", stage: "picked_up" }, INTERTIENDA, TIENDAS)).toBe(false);
  });

  it("entre dos tiendas del mismo grupo no: no está en Recepción, está en la Cola (D-374)", () => {
    expect(puedeRecibir(almacenDe("Tienda A"), carga("Tienda B", "Tienda A"), INTERTIENDA, TIENDAS)).toBe(false);
  });

  it("solo en picked_up: ni lista, ni preparando, ni ya entregada", () => {
    for (const stage of ["draft", "pending", "approved", "fulfilling", "ready", "delivered", "canceled"] as Stage[]) {
      expect(puedeRecibir(almacenDe("Tienda A"), carga("Tienda C", "Tienda A", stage), INTERTIENDA, TIENDAS), stage).toBe(false);
    }
  });

  it("solo almacén: chofer, office, gerente, ventas, logística y admin no", () => {
    for (const role of ["driver", "accounting", "manager", "sales", "logistics", "admin"] as UserRole[]) {
      expect(puedeRecibir({ role, store: "Tienda A" }, carga("Tienda C", "Tienda A"), INTERTIENDA, TIENDAS), role).toBe(false);
    }
  });

  it("almacén sin tienda no recibe nada", () => {
    expect(puedeRecibir(almacenDe(null), carga("Tienda C", "Tienda A"), INTERTIENDA, TIENDAS)).toBe(false);
    expect(puedeRecibir(null, carga("Tienda C", "Tienda A"), INTERTIENDA, TIENDAS)).toBe(false);
  });

  it("una orden de cliente no se recibe, aunque su destino se llame como la tienda", () => {
    expect(puedeRecibir(almacenDe("Tienda A"), carga("Tienda C", "Tienda A"), CLIENTE, TIENDAS)).toBe(false);
  });
});

describe("qué escribe «Recibir»", () => {
  it("la etapa `delivered` de siempre, con el evento `received`, y nada más", async () => {
    const setStage = vi.fn(async () => true);
    await expect(recibirOrden(setStage, "o1")).resolves.toBe(true);
    expect(setStage).toHaveBeenCalledWith("o1", "delivered", undefined, undefined, "received");
    expect(KIND_RECIBIDA).toBe("received");
  });

  it("el salto existe en la lista del cliente: los proveedores no lo paran antes de escribir", () => {
    expect(canTransition("picked_up", "delivered")).toBe(true);
  });

  it("y la base se lo deja a almacén (145): picked_up → delivered está en su rama, sin límite de tienda", () => {
    const sql = leer("supabase/migrations/145_gerente_hace_bodega.sql");
    const rama = sql.slice(sql.indexOf("elsif r = 'warehouse' then"), sql.indexOf("-- 142: DESHACER UN PASO, y solo en ordenes de sus tiendas"));
    expect(rama.length).toBeGreaterThan(0);
    expect(rama).toContain("(old_stage = 'picked_up'  and new_stage = 'delivered')");
    // Desde `ready` NO: por eso «Recibir» solo sale en picked_up. Abrirlo sería otra migración.
    expect(rama).not.toMatch(/old_stage = 'ready'\s+and new_stage = 'delivered'/);
  });

  it("la 157 es la última que define el guard, y es la 145 con una sola lista cambiada (si cambia, hay que releer lo de arriba)", () => {
    // Hasta D-452 la última era la 145. La 157 la copia letra por letra y solo deja nacer una carga partida también en
    // pending (lo compara `cargas-partidas.test.ts`); lo que esta prueba lee de la 145 sigue valiendo tal cual.
    const define = readdirSync("supabase/migrations").filter((f) => /^\d+_.*\.sql$/.test(f))
      .filter((f) => leer(`supabase/migrations/${f}`).includes("function public.guard_delivery_stage()")).sort();
    expect(define[define.length - 1]).toBe("157_partes_de_orden.sql");
    expect(define[define.length - 2]).toBe("145_gerente_hace_bodega.sql");
  });
});

describe("cómo se pinta: «Received» es «Delivered» con otro nombre", () => {
  const ev = (delivery_id: string, kind: string, created_at: string) => ({ delivery_id, kind, created_at });

  it("la última entrega fue un «Recibir»: se pinta Received", () => {
    expect(idsRecibidasPorAlmacen([ev("o1", "received", "2026-09-26T10:00:00Z")]).has("o1")).toBe(true);
  });

  it("recibida, deshecha y entregada después por el chofer: Delivered", () => {
    const ids = idsRecibidasPorAlmacen([
      ev("o1", "delivered", "2026-09-26T12:00:00Z"),
      ev("o1", "picked_up", "2026-09-26T11:00:00Z"),
      ev("o1", "received", "2026-09-26T10:00:00Z"),
    ]);
    expect(ids.has("o1")).toBe(false);
  });

  it("y al revés: entregada, deshecha y recibida después por almacén: Received", () => {
    const ids = idsRecibidasPorAlmacen([
      ev("o1", "received", "2026-09-26T12:00:00Z"),
      ev("o1", "picked_up", "2026-09-26T11:00:00Z"),
      ev("o1", "delivered", "2026-09-26T10:00:00Z"),
    ]);
    expect(ids.has("o1")).toBe(true);
  });

  it("decide la HORA, no el orden en que llegan los eventos", () => {
    // El proveedor los trae del más nuevo al más viejo; aquí van al revés, para que un «me quedo con el
    // primero» o «con el último» no pase por casualidad.
    const alReves = [ev("o1", "received", "2026-09-26T10:00:00Z"), ev("o1", "delivered", "2026-09-26T12:00:00Z")];
    expect(idsRecibidasPorAlmacen(alReves).has("o1")).toBe(false);
    expect(idsRecibidasPorAlmacen([...alReves].reverse()).has("o1")).toBe(false);
    const alDerecho = [ev("o2", "delivered", "2026-09-26T10:00:00Z"), ev("o2", "received", "2026-09-26T12:00:00Z")];
    expect(idsRecibidasPorAlmacen(alDerecho).has("o2")).toBe(true);
    expect(idsRecibidasPorAlmacen([...alDerecho].reverse()).has("o2")).toBe(true);
  });

  it("los demás eventos no cuentan: una nota o una edición después de recibirla no la vuelve Delivered", () => {
    const ids = idsRecibidasPorAlmacen([
      ev("o1", "note", "2026-09-26T13:00:00Z"),
      ev("o1", "edited", "2026-09-26T12:30:00Z"),
      ev("o1", "received", "2026-09-26T12:00:00Z"),
    ]);
    expect(ids.has("o1")).toBe(true);
  });

  it("cada orden con lo suyo", () => {
    const ids = idsRecibidasPorAlmacen([ev("o1", "received", "2026-09-26T10:00:00Z"), ev("o2", "delivered", "2026-09-26T10:00:00Z")]);
    expect([...ids]).toEqual(["o1"]);
  });

  it("solo una entregada: si se deshizo el paso, se pinta su etapa", () => {
    const ids = new Set(["o1"]);
    expect(esRecibida({ id: "o1", stage: "delivered" }, ids)).toBe(true);
    expect(esRecibida({ id: "o1", stage: "picked_up" }, ids)).toBe(false);
    expect(esRecibida({ id: "o1", stage: "delivered" }, undefined)).toBe(false);
  });

  it("la pastilla: «Recibido / Received», en un verde que no es el de Entregado", () => {
    const ids = new Set(["o1"]);
    expect(pastillaDeEtapa({ id: "o1", stage: "delivered" }, ids, "es")).toEqual({ texto: "Recibido", color: RECIBIDO_COLOR });
    expect(pastillaDeEtapa({ id: "o1", stage: "delivered" }, ids, "en")).toEqual({ texto: "Received", color: RECIBIDO_COLOR });
    expect(RECIBIDO_COLOR).not.toBe(stageInfo("delivered").color);
  });

  it("y la del chofer (o office) sigue siendo la de siempre", () => {
    expect(pastillaDeEtapa({ id: "o2", stage: "delivered" }, new Set(["o1"]), "en")).toEqual({ texto: "Delivered", color: stageInfo("delivered").color });
    expect(pastillaDeEtapa({ id: "o2", stage: "ready" }, new Set(), "es")).toEqual({ texto: "Listo", color: stageInfo("ready").color });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Las pantallas usan lo probado arriba. Leen el fuente: una prueba de la función no dice nada de quien la llama.
// ---------------------------------------------------------------------------------------------------------------

describe("las pantallas", () => {
  const tabla = plano(leer("src/components/OrdersTable.tsx"));
  const almacen = plano(leer("src/app/(app)/warehouse/page.tsx"));
  const ficha = plano(leer("src/components/OrderModal.tsx"));

  it("Órdenes (y Recepción, la Cola y el Gestor, que usan su tabla): las dos pastillas de la fila salen de `pastillaDeEtapa`", () => {
    expect(tabla).toContain("const recibidas = useMemo(() => idsRecibidasPorAlmacen(events), [events]);");
    expect(tabla).toContain("const ctx: Ctx = { lang, t, byInvoice, motivos: motivosDeAnulacion(settings), recibidas, marcas };");
    // la columna Etapa
    expect(tabla).toContain("cell: (d, { lang, motivos, recibidas, marcas }) => { const p = pastillaDeEtapa(d, recibidas, lang);");
    // la cabecera de la fila (la tarjeta del teléfono)
    expect(tabla).toContain("cell: (d, { lang, byInvoice, recibidas, marcas }) => { const s = pastillaDeEtapa(d, recibidas, lang);");
    expect(tabla).not.toContain("stageInfo(d.stage)");
  });

  it("en el filtro por etapa va dentro de Entregado: el valor de la columna sigue siendo la etapa", () => {
    expect(tabla).toContain('{ key: "stage", en: "Stage", es: "Etapa", pastillas: true, value: (d, { lang }) => stageLabel(d.stage, lang),');
  });

  it("Recepción: «Recibir» en la fila, con `puedeRecibir` y la escritura de `recibirOrden`", () => {
    const recepcion = almacen.slice(almacen.indexOf('resizeKey="warehouse-recepcion"'), almacen.indexOf("La ruta del día, de SOLO LECTURA"));
    expect(recepcion.length).toBeGreaterThan(0);
    expect(recepcion).toContain("accionDeFila={(d) => puedeRecibir(me, d, orderTypeRule(d.order_type, settings.order_type_rules), settings.stores) ? (");
    expect(almacen).toContain("const ok = await recibirOrden(setStage, d.id);");
    // Solo en Recepción: la Cola no lo ofrece.
    expect((almacen.match(/accionDeFila=/g) ?? []).length).toBe(1);
  });

  it("la tabla pinta la acción de la fila sin abrir la orden al pulsarla", () => {
    expect(tabla).toContain('{c.key === "__id" && accionDeFila && (() => { const accion = accionDeFila(d); return accion ? <span className="accion-de-fila" onClick={(e) => e.stopPropagation()}>{accion}</span> : null; })()}');
  });

  it("la ficha: «Recibir» con `puedeRecibir`, la escritura de `recibirOrden`, y en lugar de «Marcar entregado»", () => {
    expect(ficha).toContain("const puedeRecibirla = !!existing && puedeRecibir(me, { ...existing, stage }, orderTypeRule(existing.order_type, settings.order_type_rules), settings.stores);");
    expect(ficha).toContain("const ok = await recibirOrden(setStage, existing.id);");
    expect(ficha).toContain("puedeRecibirla={puedeRecibirla}");
    // Nota D-497: los botones de la ficha son la principal y un menú «Acciones ▾»; qué sale lo decide
    // `lib/acciones-de-la-ficha.ts` (la ficha le pasa `puedeRecibirla`). El bloque se busca allí, con la misma forma.
    const logica = plano(leer("src/lib/acciones-de-la-ficha.ts"));
    const i = logica.indexOf('if (e.puedeRecibirla && stage === "picked_up" && !abierto.pod) {');
    expect(i).toBeGreaterThan(-1);
    const bloque = logica.slice(i, logica.indexOf("// Entregar ya / deshacer un paso", i));
    expect(bloque).toContain('hay.push({ id: "recibir", texto: { en: "📥 Receive", es: "📥 Recibir" }, estilo: "btn-green" });');
    // «Marcar entregado» con POD va en el `else`: a almacén, en SU carga, no le sale.
    expect(bloque.indexOf('} else if (canDeliver(yo) && stage === "picked_up" && !abierto.pod) {')).toBeGreaterThan(bloque.indexOf('id: "recibir"'));
    expect(bloque.indexOf('id: "marcar_entregado"')).toBeGreaterThan(bloque.indexOf("} else if (canDeliver(yo)"));
    expect(ficha).toContain("recibir: onReceive,");
    expect(ficha).toContain("onReceive={() => void recibir()}");
  });

  it("la ficha: la pastilla de la cabecera y el historial («Recibida por almacén»)", () => {
    expect(ficha).toContain("const info = existing ? pastillaDeEtapa({ id: existing.id, stage }, idsRecibidasPorAlmacen(events), lang)");
    expect(ficha).toContain('<span className="sema" style={{ background: info.color, color: "#fff" }}>{info.texto}</span>');
    expect(ficha).toContain('if (kind === KIND_RECIBIDA) return lang === "es" ? "📥 Recibida por almacén" : "📥 Received by warehouse";');
  });

  it("el demo guarda el `kind` que le pasan, como el proveedor real", () => {
    const local = plano(leer("src/lib/local-data-provider.tsx"));
    expect(local).toContain('const setStage = useCallback<DataState["setStage"]>(async (id, stage, note, extra, kind) => {');
    expect(local).toContain("events: addEvent(s, id, kind ?? (stage as Stage), note),");
    const real = plano(leer("src/lib/data-provider.tsx"));
    expect(real).toContain("void logEvent(id, kind ?? stage, note);");
  });

  it("Auditoría dice «Recibida por almacén», con el verde de Recibido", () => {
    const audit = plano(leer("src/app/(app)/audit/page.tsx"));
    expect(audit).toContain('if (kind === KIND_RECIBIDA) return lang === "es" ? "Recibida por almacén" : "Received by warehouse";');
    expect(audit).toContain("background: r.kind === KIND_RECIBIDA ? RECIBIDO_COLOR : stageInfo(r.kind).color");
  });

  it("el evento entra en la lista al escribirlo, sin esperar la recarga por tiempo real", () => {
    const real = plano(leer("src/lib/data-provider.tsx"));
    const i = real.indexOf("const logEvent = useCallback(");
    expect(i).toBeGreaterThan(-1);
    const cuerpo = real.slice(i, real.indexOf("[supabase, me],", i));
    expect(cuerpo).toContain("}).select().single();");
    expect(cuerpo).toContain("if (data) setEvents((prev) => (prev.some((e) => e.id === (data as OrderEvent).id) ? prev : [data as OrderEvent, ...prev]));");
  });

  it("y sin señal, la cola de salida también lo guarda: al reenviarse sigue siendo «received»", () => {
    const real = plano(leer("src/lib/data-provider.tsx"));
    expect(real).toContain("deliveryId: id, stage, patch, note, kind, at: new Date().toISOString(), tries: 0,");
    expect(real).toContain("void logEventRef.current?.(it.deliveryId, it.kind ?? it.stage, it.note);");
  });
});
