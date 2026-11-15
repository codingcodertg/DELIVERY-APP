// Pruebas de las funciones puras de la extensión. Se corren con `node --test tools/indeed-extension/`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const N = createRequire(import.meta.url)("./nucleo.js");

test("el externalId sale de la URL cuando trae el id", async () => {
  assert.equal(await N.externalIdDe({ kind: "message", url: "https://employers.indeed.com/messages/Ab12cd34ef" }), "msg-Ab12cd34ef");
  assert.equal(await N.externalIdDe({ kind: "application", url: "https://employers.indeed.com/applications/Xy98Zw76" }), "app-Xy98Zw76");
  assert.equal(await N.externalIdDe({ kind: "message", url: "https://employers.indeed.com/messages?conversationId=QQ11ww22" }), "msg-QQ11ww22");
});

test("sin id en la URL, el hash es estable para el mismo contenido y distinto si cambia", async () => {
  const datos = { kind: "application", url: "https://employers.indeed.com/applications", nombre: "Maria Lopez", puesto: "Cashier", primerTiempo: "2026-11-13T14:05:00.000Z" };
  const a = await N.externalIdDe(datos);
  const b = await N.externalIdDe({ ...datos });
  const c = await N.externalIdDe({ ...datos, puesto: "Driver" });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^app-h[0-9a-f]{32}$/);
  assert.doesNotMatch(a, /\s/);
});

test("el deduplicado recuerda los envíos y recorta los más viejos", () => {
  let mapa = {};
  assert.equal(N.yaEnviado(mapa, "msg-1"), false);
  mapa = N.anotaEnviado(mapa, "msg-1", "created");
  assert.equal(N.yaEnviado(mapa, "msg-1"), true);
  for (let i = 0; i < 10; i++) mapa = N.anotaEnviado(mapa, `x-${i}`, "noted", 5);
  assert.equal(Object.keys(mapa).length, 5);
  assert.equal(N.yaEnviado(mapa, "msg-1"), false);
  assert.equal(N.yaEnviado(mapa, "x-9"), true);
});

test("el texto del resultado: nombre, frase y agenda; nunca el teléfono", () => {
  const t = N.textoDeResultado(
    { ok: true, resultado: { result: "created", scheduledAt: "2026-11-16T18:00:00.000Z", error: null } },
    "Jesse Sanchez",
  );
  assert.match(t, /^Jesse Sanchez: Perfil creado · llamada agendada/);
  assert.match(t, /12:00/);
  assert.equal(N.textoDeResultado({ ok: true, resultado: { result: "skipped", error: "ya recibido antes (mismo externalId): no se vuelve a procesar" } }), "Ya estaba enviado");
  assert.equal(N.textoDeResultado({ ok: true, resultado: { result: "duplicate" } }), "Ya estaba en RTG Hub");
  assert.equal(N.textoDeResultado({ ok: false, error: "Falta el token" }), "Falta el token");
  assert.match(N.mensajePorEstado(401), /Token incorrecto/);
});

test("teléfono, vacante y calificaciones desde texto", () => {
  assert.equal(N.telefonoDeTexto("Phone: (956) 555-0182"), "9565550182");
  assert.equal(N.telefonoDeTexto("+1 956.555.0199"), "9565550199");
  assert.equal(N.telefonoDeTexto("sin número"), null);
  assert.deepEqual(N.datosDeVacante("Hola\nCashier • McAllen, TX 78501"), { puesto: "Cashier", ubicacion: "McAllen, TX 78501" });
  assert.deepEqual(N.calificacionesDeTexto("Qualifications\nForklift • Spanish\nSee full application"), ["Forklift", "Spanish"]);
});

test("solo enlaces https de indeed.com", () => {
  assert.equal(N.enlaceIndeed("https://www.indeed.com/x"), "https://www.indeed.com/x");
  assert.equal(N.enlaceIndeed("http://www.indeed.com/x"), null);
  assert.equal(N.enlaceIndeed("https://indeed.com.evil.net/x"), null);
});
