import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inicioDeVentana, rutaPorChofer, SIN_CHOFER } from "./ruta-del-dia";
import { htmlDeLasHojasDeCarga } from "./slip";
import { canTransition } from "./constants";
import type { Delivery, Settings } from "./types";

// Las siete quejas de almacén (D-287). Datos inventados: ni tiendas, ni choferes, ni cifras del
// dueño.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
/** Solo el código: los comentarios pueden nombrar lo que se quitó, el código no. */
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

const parada = (extra: Partial<Delivery> = {}): Delivery => ({
  id: Math.random().toString(36).slice(2),
  order_no: 1,
  stage: "ready",
  delivery_date: "2026-09-18",
  assigned_driver: null,
  route_seq: null,
  delivery_windows: null,
  est_pallets: null,
  actual_pallets: null,
  account: "Cuenta",
  delivery_address: "1 Calle",
  ...extra,
} as unknown as Delivery);

describe("rutaPorChofer: una hoja por chofer, y «sin asignar» al final", () => {
  it("agrupa por chofer y deja los sin asignar de últimos", () => {
    const grupos = rutaPorChofer([
      parada({ assigned_driver: null }),
      parada({ assigned_driver: "Zoe" }),
      parada({ assigned_driver: "Ana" }),
      parada({ assigned_driver: "" }),
      parada({ assigned_driver: "   " }),
    ]);
    expect(grupos.map((g) => g.chofer)).toEqual(["Ana", "Zoe", SIN_CHOFER]);
    // Los tres sin chofer —null, vacío y espacios— caen en el mismo grupo.
    expect(grupos.at(-1)!.paradas).toHaveLength(3);
  });

  it("y ese «al final» no depende de cómo se llame el chofer", () => {
    // El fallo que esto fija: el centinela era un NUL y su comentario decía «sorts unassigned
    // last». Medido, `localeCompare` deja el NUL PRIMERO, así que la hoja sin chofer salía de
    // primera. Con un nombre que empieza por «A» —lo más favorable al orden alfabético— el grupo
    // sin asignar tiene que seguir siendo el último.
    expect(rutaPorChofer([parada({ assigned_driver: null }), parada({ assigned_driver: "Aaron" })])
      .map((g) => g.chofer)).toEqual(["Aaron", SIN_CHOFER]);
    // Y con un solo grupo sin chofer, sigue siendo el único.
    expect(rutaPorChofer([parada({ assigned_driver: null })]).map((g) => g.chofer)).toEqual([SIN_CHOFER]);
  });

  it("dentro de un chofer: por secuencia de ruta, y sin secuencia por ventana", () => {
    const grupos = rutaPorChofer([
      parada({ assigned_driver: "Ana", route_seq: 3, id: "tres" }),
      parada({ assigned_driver: "Ana", route_seq: 1, id: "uno" }),
      parada({ assigned_driver: "Ana", route_seq: 2, id: "dos" }),
    ]);
    expect(grupos[0].paradas.map((p) => p.id)).toEqual(["uno", "dos", "tres"]);

    const porVentana = rutaPorChofer([
      parada({ assigned_driver: "Ana", delivery_windows: "1300-1500", id: "tarde" }),
      parada({ assigned_driver: "Ana", delivery_windows: "0800-1000", id: "manana" }),
      parada({ assigned_driver: "Ana", delivery_windows: null, id: "sin-ventana" }),
    ]);
    expect(porVentana[0].paradas.map((p) => p.id)).toEqual(["manana", "tarde", "sin-ventana"]);
  });

  it("una parada con secuencia va antes que otra sin ella, aunque su ventana sea más tarde", () => {
    const grupos = rutaPorChofer([
      parada({ assigned_driver: "Ana", route_seq: null, delivery_windows: "0800-1000", id: "sin-seq" }),
      parada({ assigned_driver: "Ana", route_seq: 5, delivery_windows: "1600-1800", id: "con-seq" }),
    ]);
    expect(grupos[0].paradas.map((p) => p.id)).toEqual(["con-seq", "sin-seq"]);
  });

  it("los pallets del grupo son los reales, y el estimado solo cuando no hay real", () => {
    const grupos = rutaPorChofer([
      parada({ assigned_driver: "Ana", est_pallets: 4, actual_pallets: 6 }),
      parada({ assigned_driver: "Ana", est_pallets: 3, actual_pallets: null }),
      parada({ assigned_driver: "Ana", est_pallets: null, actual_pallets: null }),
    ]);
    expect(grupos[0].pallets).toBe(9); // 6 real + 3 estimado + 0
  });

  it("inicioDeVentana: el minuto de arranque, y sin ventana al final del día", () => {
    expect(inicioDeVentana(parada({ delivery_windows: "0800-1000" }))).toBe(8 * 60);
    expect(inicioDeVentana(parada({ delivery_windows: "1345-1500" }))).toBe(13 * 60 + 45);
    expect(inicioDeVentana(parada({ delivery_windows: null }))).toBe(9999);
    expect(inicioDeVentana(parada({ delivery_windows: "a saber" }))).toBe(9999);
  });
});

describe("las hojas de carga se imprimen sin abrir ventana", () => {
  const ajustes = { app_name: "Prueba", stores: [] } as unknown as Settings;
  const codigo = (() => {
    const src = leer("src/lib/slip.ts");
    // Sin comentarios: el de `imprimeDocumento` cita a propósito el `window.open` de antes.
    return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*(\*|\/\/)/.test(l)).join("\n");
  })();

  it("ya no queda ningún window.open en el código", () => {
    // La causa medida de «no funciona en escritorio»: `desktop/main.js` deniega las ventanas que
    // no son de un origen propio, y `window.open("")` llega como `about:blank`. Devolvía null y el
    // botón no hacía nada.
    expect(codigo).not.toContain("window.open");
    expect(codigo).toContain("imprimeDocumento(");
    // Los dos botones pasan por ahí: el comprobante y las hojas de carga.
    expect(codigo).toContain("imprimeDocumento(htmlDelComprobante(");
    expect(codigo).toContain("imprimeDocumento(htmlDeLasHojasDeCarga(");
  });

  it("y el fichero no lleva bytes de control", () => {
    // El NUL del centinela hacía que `grep` lo tomara por binario.
    const raros = [...leer("src/lib/slip.ts")].filter((c) => {
      const n = c.codePointAt(0)!;
      return n < 32 && n !== 9 && n !== 10 && n !== 13;
    });
    expect(raros).toHaveLength(0);
    // Control del detector: con un NUL dentro, cuenta uno.
    expect([..."a" + String.fromCharCode(0)].filter((c) => c.codePointAt(0)! < 32)).toHaveLength(1);
  });

  it("la hoja sin chofer es la ÚLTIMA página, no la primera", () => {
    const html = htmlDeLasHojasDeCarga([
      parada({ assigned_driver: null, account: "Cliente sin chofer" }),
      parada({ assigned_driver: "Aaron", account: "Cliente de Aaron" }),
    ], ajustes, "es", "2026-09-18");
    expect(html.indexOf("Aaron")).toBeLessThan(html.indexOf("Sin asignar"));
  });

  it("una página por chofer, con sus paradas en orden", () => {
    const html = plano(htmlDeLasHojasDeCarga([
      parada({ assigned_driver: "Ana", route_seq: 2, account: "Segunda" }),
      parada({ assigned_driver: "Ana", route_seq: 1, account: "Primera" }),
      parada({ assigned_driver: "Beto", account: "De Beto" }),
    ], ajustes, "es", "2026-09-18"));
    expect((html.match(/class="sheet"/g) ?? [])).toHaveLength(2);
    expect(html.indexOf("Primera")).toBeLessThan(html.indexOf("Segunda"));
  });

  it("y sale de rutaPorChofer, no de un agrupado propio", () => {
    expect(codigo).toContain("rutaPorChofer(orders)");
    expect(codigo).not.toContain("localeCompare");
  });
});

describe("volver de listo a preparando (queja 2)", () => {
  it("la app ya permite la vuelta, que era lo que faltaba", () => {
    expect(canTransition("ready", "fulfilling")).toBe(true);
    // Y no se abre de más: lo que no era legal sigue sin serlo.
    expect(canTransition("ready", "approved")).toBe(false);
    expect(canTransition("delivered", "fulfilling")).toBe(false);
    expect(canTransition("ready", "picked_up")).toBe(true);
  });

  it("y la base la permitía ya: la última migración que toca el guard la tiene", () => {
    // Que la app y la base digan lo mismo. Se busca la ÚLTIMA migración que define el guard, no
    // una escrita a mano aquí: la lista crece.
    const dir = "supabase/migrations";
    const ficheros = readdirSync(join(process.cwd(), dir))
      .filter((f) => f.endsWith(".sql") && leer(`${dir}/${f}`).includes("function public.guard_delivery_stage"))
      .sort();
    expect(ficheros.length).toBeGreaterThan(0);
    const vigente = leer(`${dir}/${ficheros.at(-1)!}`);
    expect(plano(vigente)).toContain("(old_stage = 'ready' and new_stage = 'fulfilling')");
  });

  it("el botón está, solo para quien prepara y solo en listo, y pregunta antes", () => {
    const modal = plano(leer("src/components/OrderModal.tsx"));
    expect(modal).toContain('if (stage === "ready") { btns.push(');
    expect(modal).toContain("onClick={onBackToPreparing}");
    const vuelta = modal.slice(modal.indexOf("const volverAPreparar"), modal.indexOf("const volverAPreparar") + 900);
    // La pregunta tiene que DECIDIR, no solo estar: se exige la forma exacta y que un «no» corte.
    // Un `true || await confirmAction(...)` cumpliría un `toContain("await confirmAction(")` y no
    // preguntaría nada; con esto, cae.
    expect(vuelta).toMatch(/const ok = await confirmAction\(/);
    expect(vuelta).toContain("if (!ok) return;");
    // Va por setStage, así que queda registrada como cualquier cambio de etapa, con nota.
    expect(vuelta).toMatch(/setStage\(existing\.id, "fulfilling", t\(/);
  });
});

describe("el chofer y los dos números de pallets (quejas 3 y 6)", () => {
  const tarjeta = plano(leer("src/components/ChoferYPallets.tsx"));
  const modal = plano(leer("src/components/OrderModal.tsx"));

  it("cada número dice de quién es, y sin dato va un guion", () => {
    expect(tarjeta).toContain('t("Sales/office estimate", "Estimado de ventas u oficina")');
    expect(tarjeta).toContain('t("Warehouse real", "Real de almacén")');
    expect(tarjeta).toContain("{pedido.est_pallets ?? \"—\"}");
    expect(tarjeta).toContain("{pedido.actual_pallets ?? \"—\"}");
    // No calcula: ni suma, ni elige uno por el otro.
    expect(tarjeta).not.toMatch(/actual_pallets \?\? .*est_pallets/);
  });

  it("el chofer al que se carga sale en la tarjeta", () => {
    expect(tarjeta).toContain('t("Driver to load", "Chofer al que se carga")');
    expect(tarjeta).toContain('t("Unassigned", "Sin asignar")');
  });

  it("y la tarjeta está en los DOS diálogos que le quedan al almacén: listo y recoger", () => {
    // Eran tres. El de la tarifa desapareció con D-NEXT —el dueño se lo quitó al almacén—, así
    // que la tarjeta se queda en los dos que siguen preguntando algo.
    expect((modal.match(/<ChoferYPallets pedido=\{existing\} \/>/g) ?? [])).toHaveLength(2);
  });

  it("marcar listo sigue escribiendo solo el real, así que el estimado no se pierde", () => {
    const confirmar = modal.slice(modal.indexOf("const confirmReady"), modal.indexOf("const confirmPickup"));
    expect(confirmar).toContain('setStage(existing.id, "ready"');
    expect(confirmar).toContain("{ actual_pallets: n }");
    // Lo que no puede pasar: que el real pise el estimado de ventas.
    expect(confirmar).not.toContain("est_pallets:");
  });
});

describe("comenzar a preparar sin tarifa (queja 4) — la salida sobra desde D-NEXT", () => {
  const modal = plano(leer("src/components/OrderModal.tsx"));

  /**
   * Esta pareja medía la **salida** que D-287 abrió en el diálogo de tarifa: «Sin tarifa —
   * continuar igual», para que almacén no se quedara parado cuando ventas no había cobrado.
   *
   * Con D-NEXT no hay diálogo del que salir: el dueño le quitó al almacén la confirmación entera
   * (*«quítale el bloqueo a warehouse con lo de la tarifa»*), así que lo que D-287 arreglaba ya no
   * puede volver a pasar por la puerta de delante. **No se borran: se dan la vuelta**, porque lo
   * que hay que impedir ahora es que el bloqueo reaparezca.
   */
  it("el botón ya no pasa por ningún diálogo: mueve la etapa y ya", () => {
    // Se mira el bloque de almacén entero y no la línea del `onClick`: escribir el manejador
    // aparte —`const empezar = () => onMove("fulfilling")`— es la misma decisión, y una cita
    // literal del `onClick` lo daría por roto. Medido con ese gemelo.
    const bloque = modal.slice(modal.indexOf("if (canFulfill(me)) {"), modal.indexOf('if (stage === "fulfilling") {'));
    expect(bloque).toContain('if (stage === "approved") btns.push(<button key="start"');
    expect(bloque).toContain('onMove("fulfilling")');
  });

  it("y no queda nada de la confirmación: ni estado, ni manejadores, ni la salida de D-287", () => {
    for (const muerto of ["startFee", "showStartConfirm", "confirmStart", "startSinTarifa", "onRequestStart"]) {
      // El comentario que cuenta que estuvieron ahí sí puede nombrarlos; el código, no.
      expect(sinComentarios(leer("src/components/OrderModal.tsx")), muerto).not.toContain(muerto);
    }
    expect(modal).not.toContain('t("No fee — continue anyway", "Sin tarifa — continuar igual")');
  });

  it("nadie que no sea ventas escribe ya la tarifa al cambiar de etapa", () => {
    // Es la mitad que importa: se fue el bloqueo, pero también se fue la escritura. Se mira el
    // cuerpo ENTERO de `move` —el camino por el que pasan todos los cambios de etapa— y no solo
    // la llamada a `setStage`: reintroducir la tarifa en el `extra` de unas líneas antes no
    // tocaría esa llamada y pasaría desapercibido. Medido con ese mutante.
    const mover = modal.slice(modal.indexOf("const move = async (to: Stage"), modal.indexOf("const depart = async ()"));
    expect(mover).not.toContain("delivery_fee");
  });

  it("control: «Marcar listo» SIGUE preguntando los pallets, que eso no se tocó", () => {
    // Sin esto, «se quitó el diálogo» podría significar que se quitaron los dos. Se cita la
    // GUARDA además del botón: dejar el botón escrito pero inalcanzable —`if (false)`— pasaba
    // una prueba que solo buscara el `onClick`. Medido con ese mutante.
    expect(modal).toContain('if (stage === "fulfilling") {');
    const listo = modal.slice(modal.indexOf('if (stage === "fulfilling") {'));
    expect(listo.slice(0, listo.indexOf("</button>"))).toContain("onClick={onRequestReady}");
    const confirmar = modal.slice(modal.indexOf("const confirmReady"), modal.indexOf("const confirmPickup"));
    expect(confirmar).toContain('setStage(existing.id, "ready"');
    expect(confirmar).toContain("{ actual_pallets: n }");
  });

  it("y la 🚩 SIN TARIFA sigue avisando donde avisaba (D-147, D-148)", () => {
    // Lo que queda después de quitar la revisión: la bandera de la tabla, la del modal y el
    // panel de «Requiere atención». Si esto cae, el cambio dejó la tarifa sin vigilar del todo.
    expect(modal).toContain('🚩 {existing?.delivery_fee == null ? t("NO FEE", "SIN TARIFA")');
    expect(plano(leer("src/components/OrdersTable.tsx"))).toContain('t("NO FEE", "SIN TARIFA")');
    expect(leer("src/lib/attention.ts")).toContain('"no_fee"');
  });
});

describe("la ruta del día en Almacén, de solo lectura (quejas 5 y 7)", () => {
  const pagina = plano(leer("src/app/(app)/warehouse/page.tsx"));

  it("hay dos vistas y la de ruta usa el agrupado compartido", () => {
    expect(pagina).toContain('t("Day\'s route", "Ruta del día")');
    expect(pagina).toContain("rutaPorChofer(cargasDelDia)");
  });

  it("la hoja impresa y la pantalla miran las MISMAS órdenes", () => {
    expect(pagina).toContain("printLoadSheets(cargasDelDia, settings, lang, loadDate)");
    // El filtro vive una vez: si se escribiera dos veces, la hoja y la pantalla podrían discrepar.
    expect((pagina.match(/ACTIVAS\.includes\(d\.stage\)/g) ?? [])).toHaveLength(1);
  });

  it("es de solo lectura: abre la orden, pero no cambia nada desde ahí", () => {
    const vista = pagina.slice(pagina.indexOf("ruta.map((g)"), pagina.indexOf("</tbody>"));
    expect(vista).toContain("onClick={() => setOpen(d)}");
    expect(vista).not.toMatch(/setStage|updateDelivery|reorderStops/);
  });

  it("y desde D-289 sí promete las posiciones en vivo, porque ya puede leerlas", () => {
    // Esta prueba decía lo CONTRARIO hasta la migración 121: la vista no podía enseñar dónde va el
    // camión porque la política de `driver_locations` no dejaba leer a almacén, y prometerlo habría
    // sido pintar un mapa siempre vacío. Con la 121 aplicada, la promesa se puede cumplir, así que
    // el canario cambia de lado en vez de borrarse.
    expect(pagina).toContain("driverLocations");
    expect(pagina).toContain("choferesEnVivo(driverLocations");
  });
});
