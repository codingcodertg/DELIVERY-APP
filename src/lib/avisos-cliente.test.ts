import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  HORAS_NOCHE_ANTES, TOKEN_DE_BAJA_RE, conAvisosSiCabe, correoValido, decidirAviso, esGsm7, horaEnTexas, idiomaDe,
  laBaseTieneAjustesDeAvisos, laBaseTieneAvisos, mananaEnTexas, pedirAvisoEnCamino, preferenciaDe, segmentosSms,
  siguienteParada, telefonoValido, textoDelAviso, tocaNocheAntes, tokenDeBaja, ventanaCorta,
  type OrdenParaAviso,
} from "@/lib/avisos-cliente";
import { darDeBaja, ejecutarEnCamino, ejecutarNocheAntes, contactoEnmascarado, origenPublico } from "@/lib/avisos-cliente-envio";
import { proveedorDelEntorno, proveedorReal, proveedorStub } from "@/lib/mensajeria";
import { baseFalsa } from "@/lib/avisos-cliente.fake-db";

/**
 * Avisos al cliente, como OptimoRoute (D-416, migración 150). El dueño, 2026-09-27: «solos haz 1 3 y 4» — el 1, un
 * aviso la noche antes y otro cuando el chofer va en camino, por SMS o correo, con seguimiento y baja.
 *
 * NADA de aquí sale de la máquina: el proveedor es `proveedorStub()` (cuenta lo que se le pide) y la base es
 * `baseFalsa` (memoria). `fetch` se sustituye por uno que revienta en las pruebas de ejecución, para que un camino que
 * se saltara el stub fallara en vez de llegar a RingCentral, Twilio o Resend.
 */

const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
// Las reglas de tipo de un demo recién sembrado: Customer a cliente; Intertienda y Transfer tienda-a-tienda.
const REGLAS = {
  Customer: { storeToStore: false, docRef: "invoice" as const },
  Intertienda: { storeToStore: true, docRef: "any" as const, homeIsDestination: true },
  Transfer: { storeToStore: true, docRef: "estimate" as const },
};
const orden = (over: Partial<OrdenParaAviso> = {}): OrdenParaAviso => ({
  id: "11111111-1111-4111-8111-111111111111", order_no: 1001, order_code: "MC1001", order_type: "Customer", stage: "ready",
  delivery_date: "2026-09-29", delivery_windows: "0800-1000", delivery_phone: "(956) 555-0101", is_training: false,
  assigned_driver: null, customer_email: null, notify_pref: "both", customer_lang: null, ...over,
});
const SIN_BAJAS = new Set<string>();

describe("contacto válido", () => {
  it("teléfono: 10 dígitos o 11 con 1 delante, en E.164; lo demás, nada", () => {
    expect(telefonoValido("(956) 555-0101")).toBe("+19565550101");
    expect(telefonoValido("1-956-555-0101")).toBe("+19565550101");
    expect(telefonoValido("+1 956 555 0101")).toBe("+19565550101");
    expect(telefonoValido("555-0101")).toBeNull();          // 7 dígitos: sin área
    expect(telefonoValido("0565550101")).toBeNull();        // área que empieza por 0
    expect(telefonoValido("1165550101")).toBeNull();        // área que empieza por 1
    expect(telefonoValido("52 899 123 4567")).toBeNull();   // 12 dígitos
    expect(telefonoValido(null)).toBeNull();
  });
  it("correo: con forma de correo y en minúsculas; lo demás, nada", () => {
    expect(correoValido("  Ana@Correo.COM ")).toBe("ana@correo.com");
    expect(correoValido("ana@correo")).toBeNull();
    expect(correoValido("ana correo.com")).toBeNull();
    expect(correoValido("")).toBeNull();
  });
});

describe("decidirAviso: a quién sí y a quién no", () => {
  it("una Customer aprobada/lista con teléfono: SMS al E.164", () => {
    expect(decidirAviso(orden(), "night_before", REGLAS, SIN_BAJAS)).toEqual({ ok: true, sms: "+19565550101", email: null });
  });
  it("nunca Transfer ni Intertienda (tienda-a-tienda, según Ajustes)", () => {
    expect(decidirAviso(orden({ order_type: "Transfer" }), "night_before", REGLAS, SIN_BAJAS)).toEqual({ ok: false, motivo: "tienda_a_tienda" });
    expect(decidirAviso(orden({ order_type: "Intertienda" }), "night_before", REGLAS, SIN_BAJAS)).toEqual({ ok: false, motivo: "tienda_a_tienda" });
  });
  it("sin tipo no se sabe a quién va: nada", () => {
    expect(decidirAviso(orden({ order_type: "" }), "night_before", REGLAS, SIN_BAJAS)).toEqual({ ok: false, motivo: "sin_tipo" });
  });
  it("nunca una orden de enseñanza", () => {
    expect(decidirAviso(orden({ is_training: true }), "night_before", REGLAS, SIN_BAJAS)).toEqual({ ok: false, motivo: "training" });
  });
  it("la noche antes: aprobada en adelante; ni pendiente, ni borrador, ni entregada, ni anulada", () => {
    for (const stage of ["approved", "fulfilling", "ready", "picked_up"] as const) {
      expect(decidirAviso(orden({ stage }), "night_before", REGLAS, SIN_BAJAS).ok, stage).toBe(true);
    }
    for (const stage of ["draft", "pending", "rejected", "delivered", "canceled"] as const) {
      expect(decidirAviso(orden({ stage }), "night_before", REGLAS, SIN_BAJAS), stage).toEqual({ ok: false, motivo: "etapa" });
    }
  });
  it("en camino: solo si ya va en el camión (picked_up)", () => {
    expect(decidirAviso(orden({ stage: "picked_up" }), "on_the_way", REGLAS, SIN_BAJAS).ok).toBe(true);
    expect(decidirAviso(orden({ stage: "ready" }), "on_the_way", REGLAS, SIN_BAJAS)).toEqual({ ok: false, motivo: "etapa" });
  });
  it("la preferencia manda: none nada, sms sin correo, email sin SMS, both los dos", () => {
    const o = orden({ customer_email: "Ana@Correo.com" });
    expect(decidirAviso({ ...o, notify_pref: "none" }, "night_before", REGLAS, SIN_BAJAS)).toEqual({ ok: false, motivo: "no_avisar" });
    expect(decidirAviso({ ...o, notify_pref: "sms" }, "night_before", REGLAS, SIN_BAJAS)).toEqual({ ok: true, sms: "+19565550101", email: null });
    expect(decidirAviso({ ...o, notify_pref: "email" }, "night_before", REGLAS, SIN_BAJAS)).toEqual({ ok: true, sms: null, email: "ana@correo.com" });
    expect(decidirAviso({ ...o, notify_pref: "both" }, "night_before", REGLAS, SIN_BAJAS)).toEqual({ ok: true, sms: "+19565550101", email: "ana@correo.com" });
  });
  it("una preferencia desconocida o ausente (base sin la 150) es both", () => {
    expect(preferenciaDe({})).toBe("both");
    expect(preferenciaDe({ notify_pref: "whatsapp" })).toBe("both");
  });
  it("dado de baja: ese canal no; si no queda ninguno, nada", () => {
    const o = orden({ customer_email: "ana@correo.com" });
    expect(decidirAviso(o, "night_before", REGLAS, new Set(["+19565550101"]))).toEqual({ ok: true, sms: null, email: "ana@correo.com" });
    expect(decidirAviso(o, "night_before", REGLAS, new Set(["+19565550101", "ana@correo.com"]))).toEqual({ ok: false, motivo: "dado_de_baja" });
  });
  it("sin contacto válido: nada", () => {
    expect(decidirAviso(orden({ delivery_phone: "555-0101" }), "night_before", REGLAS, SIN_BAJAS)).toEqual({ ok: false, motivo: "sin_contacto" });
  });
});

describe("cuándo: la noche antes a la hora de Ajustes, en Texas", () => {
  // 2026-09-28 es verano (CDT, UTC-5); 2026-12-09, invierno (CST, UTC-6).
  it("hora de Texas en verano y en invierno", () => {
    expect(horaEnTexas(new Date("2026-09-28T23:30:00Z"))).toBe(18);
    expect(horaEnTexas(new Date("2026-12-10T00:30:00Z"))).toBe(18);
  });
  it("toca desde la hora elegida hasta antes de las 21, y no antes", () => {
    expect(tocaNocheAntes(new Date("2026-09-28T22:59:00Z"), 18)).toBe(false); // 17:59 CDT
    expect(tocaNocheAntes(new Date("2026-09-28T23:00:00Z"), 18)).toBe(true);  // 18:00
    expect(tocaNocheAntes(new Date("2026-09-29T01:59:00Z"), 18)).toBe(true);  // 20:59
    expect(tocaNocheAntes(new Date("2026-09-29T02:00:00Z"), 18)).toBe(false); // 21:00: tarde
    expect(tocaNocheAntes(new Date("2026-09-28T21:10:00Z"), 16)).toBe(true);  // 16:10 con la hora en 16
  });
  it("una hora que no está en la lista vale como las 18", () => {
    expect(tocaNocheAntes(new Date("2026-09-28T22:30:00Z"), 3)).toBe(false);   // 17:30
    expect(tocaNocheAntes(new Date("2026-09-28T23:30:00Z"), 3)).toBe(true);    // 18:30
  });
  it("mañana es el día siguiente EN TEXAS (a las 00:30 UTC todavía es ayer allí)", () => {
    expect(mananaEnTexas(new Date("2026-09-29T00:30:00Z"))).toBe("2026-09-29");
    expect(mananaEnTexas(new Date("2026-11-01T23:30:00Z"))).toBe("2026-11-02"); // el día que cambia la hora
  });
});

describe("vercel.json: una entrada diaria por cada hora que se puede elegir, en verano y en invierno", () => {
  const vercel = JSON.parse(leer("vercel.json")) as { crons: { path: string; schedule: string }[] };
  const nuestros = vercel.crons.filter((c) => c.path.startsWith("/api/cron/avisos-noche-antes/"));
  it("10 entradas, diarias, cada una con su franja = su hora UTC", () => {
    expect(nuestros).toHaveLength(10);
    for (const c of nuestros) {
      const m = c.schedule.match(/^0 (\d{1,2}) \* \* \*$/);
      expect(m, c.schedule).not.toBeNull();
      expect(Number(c.path.split("/").pop())).toBe(Number(m![1]));
    }
  });
  it("cada hora elegible de Texas tiene un cron que cae en ella, en CDT (UTC-5) y en CST (UTC-6)", () => {
    const horasUtc = new Set(nuestros.map((c) => Number(c.schedule.split(" ")[1])));
    for (const h of HORAS_NOCHE_ANTES) {
      expect(horasUtc.has((h + 5) % 24), `CDT ${h}`).toBe(true);
      expect(horasUtc.has((h + 6) % 24), `CST ${h}`).toBe(true);
    }
  });
});

describe("el texto", () => {
  const enlaces = { seguimiento: "https://rtg-hub.vercel.app/track/11111111-1111-4111-8111-111111111111", baja: "https://rtg-hub.vercel.app/unsubscribe/AbCdEfGh12345678" };
  it("sin idioma: inglés Y español en un solo mensaje, con los dos enlaces", () => {
    const t = textoDelAviso(orden(), "night_before", enlaces);
    expect(t.sms).toContain("Your delivery #MC1001 is scheduled for tomorrow");
    expect(t.sms).toContain("Su entrega #MC1001 llega mañana");
    expect(t.sms).toContain(enlaces.seguimiento);
    expect(t.sms).toContain(enlaces.baja);
    expect(t.asunto).toContain(" / ");
  });
  it("con idioma de la orden: solo ese", () => {
    const en = textoDelAviso(orden({ customer_lang: "en" }), "on_the_way", enlaces);
    expect(en.sms).toContain("Your driver is on the way");
    expect(en.sms).not.toContain("chofer");
    const es = textoDelAviso(orden({ customer_lang: "es" }), "on_the_way", enlaces);
    expect(es.sms).toContain("Su chofer va en camino");
    expect(es.sms).not.toContain("driver");
    expect(es.correo).toContain(enlaces.baja);
  });
  it("todos los SMS son GSM-7 (un acento fuera del alfabeto dobla el coste) y caben en 3 segmentos (2 en un idioma)", () => {
    for (const tipo of ["night_before", "on_the_way"] as const) {
      for (const customer_lang of [null, "en", "es"] as const) {
        const { sms } = textoDelAviso(orden({ customer_lang, order_code: "MCA10001", order_suffix: "b", delivery_windows: "1230-1545" }), tipo, enlaces);
        expect(esGsm7(sms), `${tipo} ${customer_lang}: ${sms}`).toBe(true);
        expect(segmentosSms(sms), `${tipo} ${customer_lang}`).toBeLessThanOrEqual(customer_lang ? 2 : 3);
      }
    }
  });
  it("segmentos: 160 en uno, 153 por segmento; fuera de GSM-7, 70 y 67", () => {
    expect(segmentosSms("a".repeat(160))).toBe(1);
    expect(segmentosSms("a".repeat(161))).toBe(2);
    expect(segmentosSms("a".repeat(306))).toBe(2);
    expect(segmentosSms("a".repeat(307))).toBe(3);
    expect(segmentosSms("á".repeat(70))).toBe(1);
    expect(segmentosSms("á".repeat(71))).toBe(2);
    expect(esGsm7("mañana é ñ")).toBe(true);
    expect(esGsm7("está")).toBe(false);
  });
  it("la ventana, corta", () => {
    expect(ventanaCorta("0800-1000")).toBe("8-10AM");
    expect(ventanaCorta("1300-1500")).toBe("1-3PM");
    expect(ventanaCorta("1130-1330")).toBe("11:30AM-1:30PM");
    expect(ventanaCorta("cuando pueda")).toBe("");
  });
  it("el idioma de la orden: en, es o ninguno", () => {
    expect(idiomaDe({ customer_lang: "es" })).toBe("es");
    expect(idiomaDe({ customer_lang: "fr" })).toBeNull();
  });
});

describe("token de baja", () => {
  it("16 caracteres base64url de 12 bytes; menos bytes, error", () => {
    const tk = tokenDeBaja(new Uint8Array([251, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(tk).toMatch(TOKEN_DE_BAJA_RE);
    expect(tk).toHaveLength(16);
    expect(tk).toContain("-"); // 0xfb 0xff → «-_» en base64url, no «+/»
    expect(() => tokenDeBaja(new Uint8Array(8))).toThrow();
  });
  it("la página de baja muestra el contacto enmascarado", () => {
    expect(contactoEnmascarado("+19565550101")).toBe("***-***-0101");
    expect(contactoEnmascarado("ana@correo.com")).toBe("a***@correo.com");
  });
});

describe("la siguiente parada es la de «Mi ruta»", () => {
  it("la primera sin entregar, en el orden dado", () => {
    expect(siguienteParada([{ stage: "delivered", n: 1 }, { stage: "picked_up", n: 2 }, { stage: "ready", n: 3 }])?.n).toBe(2);
    expect(siguienteParada([{ stage: "delivered" }])).toBeNull();
  });
  it("«Mi ruta» la usa para su «Siguiente parada» (la pantalla y el aviso no pueden discrepar)", () => {
    const src = leer("src/app/(app)/my-route/page.tsx");
    expect(src).toMatch(/const next = siguienteParada\(stops\);/);
    expect(src).not.toMatch(/stops\.find\(\(d\) => d\.stage !== "delivered"\)/);
  });
});

describe("pedirAvisoEnCamino (lo que hace la app al guardar una etapa)", () => {
  it("apagado: no pide nada", () => {
    const f = vi.fn(async () => ({}));
    expect(pedirAvisoEnCamino("x", "delivered", false, f)).toBe(false);
    expect(pedirAvisoEnCamino("x", "delivered", undefined, f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("encendido: al recoger y al entregar, sí; en otra etapa, no", async () => {
    const f = vi.fn(async () => ({}));
    expect(pedirAvisoEnCamino("a", "picked_up", true, f)).toBe(true);
    expect(pedirAvisoEnCamino("b", "delivered", true, f)).toBe(true);
    expect(pedirAvisoEnCamino("c", "approved", true, f)).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[0]).toEqual(["/api/avisos-cliente/en-camino", expect.objectContaining({ method: "POST", body: JSON.stringify({ id: "a" }) })]);
  });
  it("un fallo de red no revienta al chofer", async () => {
    const f = vi.fn(async () => { throw new Error("offline"); });
    expect(() => pedirAvisoEnCamino("a", "delivered", true, f)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
  it("data-provider lo llama en setStage y al vaciar la cola offline, con el interruptor de Ajustes", () => {
    const src = leer("src/lib/data-provider.tsx");
    expect(src).toContain("pedirAvisoEnCamino(id, stage, settings.notify_on_the_way_enabled);");
    expect(src).toContain("pedirAvisoEnCamino(it.deliveryId, it.stage, avisoEnCaminoRef.current);");
    expect(src).toContain("avisoEnCaminoRef.current = settings.notify_on_the_way_enabled;");
  });
});

describe("la base sin la 150 no se rompe", () => {
  it("Ajustes: los interruptores solo si la fila trae la columna", () => {
    expect(laBaseTieneAjustesDeAvisos({ id: 1 })).toBe(false);
    expect(laBaseTieneAjustesDeAvisos({ id: 1, notify_night_before_enabled: false })).toBe(true);
  });
  it("la ficha: sin la columna, las claves no viajan", () => {
    const p = { account: "X", customer_email: "a@b.co", notify_pref: "sms" as const, customer_lang: "es" as const };
    expect(conAvisosSiCabe(p, [{ id: "1" }])).toEqual({ account: "X" });
    expect(conAvisosSiCabe(p, [{ id: "1", notify_pref: "both" }])).toEqual(p);
    expect(laBaseTieneAvisos([])).toBe(false);
  });
  it("la ficha los usa al guardar, pero ya NO enseña correo, preferencia ni idioma (D-436)", () => {
    const src = leer("src/components/OrderModal.tsx");
    expect(src).toContain("const payload = conRequisitosSiCabe(conAvisosSiCabe(conPrioridadSiCabe({");
    expect(src).not.toContain("laBaseTieneAvisos(deliveries)");
    expect(src).not.toContain('data-campo="notify_pref"');
    expect(src).not.toContain('data-campo="customer_lang"');
  });
  it("Ajustes enseña la tarjeta con su comprobación", () => {
    const src = leer("src/app/(app)/settings/page.tsx");
    expect(src).toContain("<AvisosAlCliente settings={settings}");
    expect(src).toContain("const hayColumnas = laBaseTieneAjustesDeAvisos(settings);");
  });
});

describe("el proveedor: nunca el real en el demo", () => {
  it("NEXT_PUBLIC_LOCAL_MODE=true → stub, aunque haya llaves", () => {
    const p = proveedorDelEntorno({ NEXT_PUBLIC_LOCAL_MODE: "true", RINGCENTRAL_CLIENT_ID: "x", RESEND_API_KEY: "y" });
    expect(p).not.toBe(proveedorReal);
    expect("envios" in p).toBe(true);
  });
  it("fuera del demo, el real", () => {
    expect(proveedorDelEntorno({})).toBe(proveedorReal);
  });
  it("/api/notify usa el mismo proveedor (no una copia)", () => {
    const src = leer("src/app/api/notify/route.ts");
    expect(src).toContain("await proveedorReal.sms(body.to, body.message)");
    expect(src).not.toContain("api.twilio.com");
  });
  it("origen de los enlaces: el dominio de producción si Vercel lo da, si no el de la petición", () => {
    expect(origenPublico("https://x-123.vercel.app/api/cron/y", { VERCEL_PROJECT_PRODUCTION_URL: "rtg-hub.vercel.app" })).toBe("https://rtg-hub.vercel.app");
    expect(origenPublico("http://localhost:3000/api/x", {})).toBe("http://localhost:3000");
  });
});

// ---------------------------------------------------------------------------
// Ejecución, con base falsa y proveedor stub
// ---------------------------------------------------------------------------

const AHORA_1830 = new Date("2026-09-28T23:30:00Z"); // 18:30 en Texas del 28; mañana = 29
const ajustes = (over: Record<string, unknown> = {}) => ({
  id: 1, notify_night_before_enabled: true, notify_on_the_way_enabled: true, notify_night_before_hour: 18, order_type_rules: REGLAS, ...over,
});
const UNICAS = { customer_notifications: [["unsub_token"]] };
let semilla = 0;
const aleatorio = () => { semilla++; return new Uint8Array(Array.from({ length: 12 }, (_, i) => (semilla * 31 + i) % 256)); };

function montar(ordenes: OrdenParaAviso[], aj = ajustes(), bajas: string[] = []) {
  const db = baseFalsa({ settings: [aj], deliveries: ordenes as never[], customer_notify_optouts: bajas.map((contact) => ({ contact, channel: "sms" })) }, UNICAS);
  const proveedor = proveedorStub();
  const ctx = { db, proveedor, origen: "https://rtg-hub.vercel.app", aleatorio };
  return { db, proveedor, ctx };
}

describe("ejecutarNocheAntes", () => {
  const ordenes = [
    orden({ id: "a", delivery_date: "2026-09-29" }),                                             // sí
    orden({ id: "b", delivery_date: "2026-09-29", order_type: "Transfer" }),                     // tienda-a-tienda
    orden({ id: "c", delivery_date: "2026-09-29", is_training: true }),                          // enseñanza (ni se lee)
    orden({ id: "d", delivery_date: "2026-09-30" }),                                             // pasado mañana
    orden({ id: "e", delivery_date: "2026-09-29", delivery_phone: "9565550199", customer_email: "e@correo.com", notify_pref: "email" }), // correo
    orden({ id: "f", delivery_date: "2026-09-29", stage: "pending" }),                           // pendiente
    orden({ id: "g", delivery_date: "2026-09-29", delivery_phone: "9565550177" }),               // dado de baja
  ];

  it("apagado en Ajustes: no lee ni una orden y no manda nada", async () => {
    const { db, proveedor, ctx } = montar(ordenes, ajustes({ notify_night_before_enabled: false }));
    const r = await ejecutarNocheAntes(ctx, { ahora: AHORA_1830 });
    expect(r).toEqual({ ok: true, apagado: true });
    expect(db.lecturas).toEqual(["settings"]);
    expect(proveedor.envios).toEqual([]);
  });
  // Solo `true` enciende: un valor nulo o ausente (columna recién creada, fila rara) es APAGADO. Es la puerta que
  // separa esto de un SMS real a un cliente; un `=== false` la dejaría abierta con null (mutante del orquestador).
  it.each([null, undefined])("interruptor %s en Ajustes: cuenta como apagado y no manda nada", async (valor) => {
    const { proveedor, ctx } = montar(ordenes, ajustes({ notify_night_before_enabled: valor as unknown as boolean }));
    expect(await ejecutarNocheAntes(ctx, { ahora: AHORA_1830 })).toEqual({ ok: true, apagado: true });
    expect(proveedor.envios).toEqual([]);
  });
  it("antes de la hora elegida: nada", async () => {
    const { proveedor, ctx } = montar(ordenes, ajustes({ notify_night_before_hour: 20 }));
    expect(await ejecutarNocheAntes(ctx, { ahora: AHORA_1830 })).toEqual({ ok: true, fueraDeHora: true });
    expect(proveedor.envios).toEqual([]);
  });
  it("a la hora: solo a las Customer de MAÑANA, aprobadas, con contacto y sin baja; registra una fila por aviso", async () => {
    const { db, proveedor, ctx } = montar(ordenes, ajustes(), ["+19565550177"]);
    const r = await ejecutarNocheAntes(ctx, { ahora: AHORA_1830 });
    expect(r.ok).toBe(true);
    expect(r.manana).toBe("2026-09-29");
    expect(proveedor.envios.map((e) => `${e.canal}:${e.to}`)).toEqual(["sms:+19565550101", "correo:e@correo.com"]);
    const registro = db.tablas.customer_notifications;
    expect(registro.map((f) => `${f.delivery_id}:${f.kind}:${f.sms_status}:${f.email_status}`)).toEqual(["a:night_before:dry_run:null", "e:night_before:null:dry_run"]);
    expect(registro[0].sms_segments).toBeGreaterThan(0);
    expect(String(registro[0].unsub_token)).toMatch(TOKEN_DE_BAJA_RE);
    // El SMS lleva el enlace de baja de SU fila.
    expect(proveedor.envios[0].texto).toContain(`https://rtg-hub.vercel.app/unsubscribe/${registro[0].unsub_token}`);
    expect(proveedor.envios[0].texto).toContain("https://rtg-hub.vercel.app/track/a");
    expect((r.resultados ?? []).filter((x) => x.estado === "omitida").map((x) => `${x.id}:${"motivo" in x ? x.motivo : ""}`).sort())
      .toEqual(["b:tienda_a_tienda", "g:dado_de_baja"]);
    // La pendiente (f) ni se lee: la consulta ya pide solo las etapas del aviso; la de enseñanza (c), tampoco.
    expect((r.resultados ?? []).map((x) => x.id)).not.toContain("f");
    expect((r.resultados ?? []).map((x) => x.id)).not.toContain("c");
  });
  it("idempotente: correr otra vez (el cron de la hora siguiente) no manda nada más", async () => {
    const { db, proveedor, ctx } = montar(ordenes);
    await ejecutarNocheAntes(ctx, { ahora: AHORA_1830 });
    const antes = proveedor.envios.length;
    const r2 = await ejecutarNocheAntes(ctx, { ahora: new Date("2026-09-29T00:30:00Z") });
    expect(proveedor.envios.length).toBe(antes);
    expect(db.tablas.customer_notifications).toHaveLength(3);
    expect((r2.resultados ?? []).filter((x) => x.estado === "ya_enviado").map((x) => x.id)).toEqual(["a", "e", "g"]);
  });
  it("una orden REPROGRAMADA recibe el aviso de su fecha nueva (la clave lleva el día); la misma fecha, no", async () => {
    const { db, proveedor, ctx } = montar([orden({ id: "a", delivery_date: "2026-09-29" })]);
    await ejecutarNocheAntes(ctx, { ahora: AHORA_1830 });
    expect(proveedor.envios).toHaveLength(1);
    db.tablas.deliveries[0].delivery_date = "2026-10-01";                         // se reprograma
    await ejecutarNocheAntes(ctx, { ahora: new Date("2026-09-30T23:30:00Z") });   // la noche del 30
    expect(proveedor.envios).toHaveLength(2);
    expect(proveedor.envios[1].texto).toContain("Oct 1");
    await ejecutarNocheAntes(ctx, { ahora: new Date("2026-10-01T00:30:00Z") });   // otra franja, misma noche
    expect(proveedor.envios).toHaveLength(2);
    expect(db.tablas.customer_notifications.map((f) => `${f.delivery_id}:${f.service_date}`)).toEqual(["a:2026-09-29", "a:2026-10-01"]);
  });
  it("?ensayo: decide pero no reclama ni envía", async () => {
    const { db, proveedor, ctx } = montar(ordenes);
    const r = await ejecutarNocheAntes(ctx, { ahora: AHORA_1830, ensayo: true });
    expect((r.resultados ?? []).filter((x) => x.estado === "ensayo").map((x) => x.id)).toEqual(["a", "e", "g"]);
    expect(proveedor.envios).toEqual([]);
    expect(db.tablas.customer_notifications ?? []).toEqual([]);
  });
  it("un fallo del proveedor queda en el registro como failed y no se reintenta solo", async () => {
    const { db, ctx } = montar([orden({ id: "a" })]);
    const roto = { ...ctx, proveedor: { sms: async () => ({ ok: false as const, error: "sms send failed (500)" }), correo: async () => ({ ok: true as const, proveedor: "x" }) } };
    await ejecutarNocheAntes(roto, { ahora: AHORA_1830 });
    expect(db.tablas.customer_notifications[0]).toMatchObject({ sms_status: "failed", error: "sms send failed (500)" });
    const cuenta = vi.fn(async () => ({ ok: true as const, proveedor: "x" }));
    await ejecutarNocheAntes({ ...ctx, proveedor: { sms: cuenta, correo: cuenta } }, { ahora: AHORA_1830 });
    expect(cuenta).not.toHaveBeenCalled();
  });
});

describe("ejecutarEnCamino", () => {
  const ruta = (etapas: string[], over: Partial<OrdenParaAviso>[] = []) =>
    etapas.map((stage, i) => ({
      ...orden({ id: `r${i + 1}`, stage: stage as OrdenParaAviso["stage"], assigned_driver: "Chofer Uno", delivery_date: "2026-09-29", delivery_phone: `95655501${10 + i}`, ...(over[i] ?? {}) }),
      route_seq: i + 1, morning_priority: false, delivery_windows: null, route_miles: null,
    })) as unknown as OrdenParaAviso[];

  it("entregó la 1: la 2 ya va en el camión → «en camino» a la 2, una sola vez", async () => {
    const { db, proveedor, ctx } = montar(ruta(["delivered", "picked_up", "picked_up"]));
    const r = await ejecutarEnCamino(ctx, "r1");
    expect(r.siguiente).toBe("r2");
    expect(proveedor.envios.map((e) => e.to)).toEqual(["+19565550111"]);
    expect(proveedor.envios[0].texto).toContain("on the way");
    await ejecutarEnCamino(ctx, "r1");
    expect(proveedor.envios).toHaveLength(1);
    expect(db.tablas.customer_notifications.map((f) => `${f.delivery_id}:${f.kind}`)).toEqual(["r2:on_the_way"]);
  });
  it("sigue el orden de la ruta (route_seq), no el de la base", async () => {
    const filas = ruta(["picked_up", "picked_up"]);
    (filas[0] as unknown as { route_seq: number }).route_seq = 2;
    (filas[1] as unknown as { route_seq: number }).route_seq = 1;
    const { proveedor, ctx } = montar(filas);
    expect((await ejecutarEnCamino(ctx, "r1")).siguiente).toBe("r2");
    expect(proveedor.envios.map((e) => e.to)).toEqual(["+19565550111"]);
  });
  it("la siguiente aún no está cargada (otro viaje): nada", async () => {
    const { proveedor, ctx } = montar(ruta(["delivered", "ready"]));
    const r = await ejecutarEnCamino(ctx, "r1");
    expect(r.siguiente).toBe("r2");
    expect(r.resultado).toEqual({ id: "r2", estado: "omitida", motivo: "etapa" });
    expect(proveedor.envios).toEqual([]);
  });
  it("otro chofer u otro día no cuentan como «siguiente»", async () => {
    const filas = [...ruta(["delivered"]), orden({ id: "x", stage: "picked_up", assigned_driver: "Chofer Dos", delivery_date: "2026-09-29" }), orden({ id: "y", stage: "picked_up", assigned_driver: "Chofer Uno", delivery_date: "2026-09-30" })];
    const { proveedor, ctx } = montar(filas);
    expect((await ejecutarEnCamino(ctx, "r1")).siguiente).toBeNull();
    expect(proveedor.envios).toEqual([]);
  });
  it("apagado en Ajustes: no lee la ruta ni manda", async () => {
    const { db, proveedor, ctx } = montar(ruta(["delivered", "picked_up"]), ajustes({ notify_on_the_way_enabled: false }));
    expect(await ejecutarEnCamino(ctx, "r1")).toEqual({ ok: true, apagado: true });
    expect(db.lecturas).toEqual(["settings"]);
    expect(proveedor.envios).toEqual([]);
  });
});

describe("darDeBaja", () => {
  it("el token de un aviso da de baja su teléfono y su correo, y el siguiente aviso ya no les llega", async () => {
    const { db, proveedor, ctx } = montar([orden({ id: "a", customer_email: "ana@correo.com" })]);
    await ejecutarNocheAntes(ctx, { ahora: AHORA_1830 });
    expect(proveedor.envios).toHaveLength(2);
    const token = String(db.tablas.customer_notifications[0].unsub_token);
    const r = await darDeBaja(db, token);
    expect(r).toEqual({ ok: true, contactos: ["***-***-0101", "a***@correo.com"] });
    expect(db.tablas.customer_notify_optouts.map((f) => f.contact).sort()).toEqual(["+19565550101", "ana@correo.com"]);
    // Otra orden del mismo cliente, otro día: ya no.
    db.tablas.deliveries.push({ ...orden({ id: "b", customer_email: "ana@correo.com", delivery_date: "2026-09-30" }) });
    await ejecutarNocheAntes(ctx, { ahora: new Date("2026-09-29T23:30:00Z") });
    expect(proveedor.envios).toHaveLength(2);
  });
  it("un token mal formado o que no existe: no toca nada", async () => {
    const { db } = montar([]);
    expect(await darDeBaja(db, "corto")).toEqual({ ok: false, motivo: "token" });
    expect(await darDeBaja(db, "AbCdEfGh12345678")).toEqual({ ok: false, motivo: "no_encontrado" });
    expect(db.tablas.customer_notify_optouts ?? []).toEqual([]);
  });
});

describe("la 150", () => {
  const sql = leer("supabase/migrations/150_avisos_al_cliente.sql");
  const [cuerpo, registro] = sql.replace(/\r\n/g, "\n").split("-- @ledger-below\n");
  it("sin begin/commit propios, sin D-416 (numerar cambiaría el checksum), con reversión y su fila del registro al día", () => {
    expect(cuerpo).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(sql).not.toMatch(/D-416|D-\d{3}/);
    expect(cuerpo).toMatch(/Reversion/);
    const sha = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    expect(registro.trim()).toBe(`insert into public.schema_migrations (name, checksum) values ('150_avisos_al_cliente.sql', '${sha}') on conflict (name) do nothing;`);
  });
  it("los interruptores nacen APAGADOS y la hora en 18", () => {
    expect(cuerpo).toContain("notify_night_before_enabled boolean not null default false");
    expect(cuerpo).toContain("notify_on_the_way_enabled   boolean not null default false");
    expect(cuerpo).toContain("notify_night_before_hour    smallint not null default 18");
    expect(cuerpo).toContain("check (notify_night_before_hour between 12 and 20)");
    expect(Math.min(...HORAS_NOCHE_ANTES)).toBe(12);
    expect(Math.max(...HORAS_NOCHE_ANTES)).toBe(20);
  });
  it("un aviso por orden, tipo y día (la clave del reclamo idempotente), con las preferencias de la app", () => {
    expect(cuerpo).toContain("constraint customer_notifications_once        unique (delivery_id, kind, service_date)");
    expect(leer("src/lib/avisos-cliente-envio.ts")).toContain('{ onConflict: "delivery_id,kind,service_date", ignoreDuplicates: true }');
    expect(cuerpo).toContain("check (notify_pref in ('both', 'sms', 'email', 'none'))");
    expect(cuerpo).toContain("check (kind in ('night_before', 'on_the_way'))");
  });
  it("RLS: solo lectura para el admin, ninguna escritura desde la app, anon nada", () => {
    expect(cuerpo).toContain("revoke all on public.customer_notifications  from anon, authenticated;");
    expect(cuerpo).toContain("revoke all on public.customer_notify_optouts from anon, authenticated;");
    expect(cuerpo).not.toMatch(/grant (insert|update|delete)/i);
    expect((cuerpo.match(/create policy/g) ?? []).length).toBe(2);
    expect(cuerpo).not.toMatch(/for (all|insert|update|delete)/i);
  });
});
