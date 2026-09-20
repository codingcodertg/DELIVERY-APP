import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LETRAS_PARA_SUGERIR, decisionAlConfirmar, sugerenciasPara } from "./account-combobox";
import {
  CAJA_DE_LA_ZONA, CAJA_DE_TEXAS, cajaDe, centroDe, cuerpoDePlaces, esDeTexasGoogle, esDeTexasMapbox, esDeTexasOSM, esTextoDeTexas,
  urlDeGoogleGeocode, urlDeMapbox, urlDeOSM,
} from "./busqueda-de-direccion";
import { ROLE_DEFAULT_COLUMNS } from "./constants";
import { contactoAlElegirCuenta, laCuentaRecuerda } from "./cuenta-elegida";
import { CUENTA_DE_MOSTRADOR, CUENTA_DE_MOSTRADOR_EN } from "./customer-type";
import { LOCAL_ZONE_DEFAULT, puntoEnZonaLocal } from "./delivery-zone";
import { facturaComparable, ordenConEsaFactura } from "./misma-factura";
import { missingKeys } from "./required";
import { colLabel } from "./utils";

/** El formulario de orden y la tabla, tras los nueve cambios del dueño (D-NEXT). Cuentas, facturas y calles inventadas. */

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
const formulario = leer("src/components/OrderModal.tsx");

describe("4 · «Misma factura»: solo el número COMPLETO", () => {
  const ordenes = [
    { id: "o1", order_no: 1, stage: "delivered", invoice_num: "INV-1045", account: "Constructora Uno" },
    { id: "o2", order_no: 2, stage: "approved", invoice_num: " inv-1045 ", account: "Constructora Uno" },
    { id: "o3", order_no: 3, stage: "canceled", invoice_num: "INV-1045" },
    { id: "o4", order_no: 4, stage: "approved", invoice_num: "INV-10456" },
    { id: "o5", order_no: 5, stage: "approved", invoice_num: null },
  ];
  it("medio número no encuentra nada; tampoco uno que lo CONTIENE", () => {
    expect(ordenConEsaFactura(ordenes, "INV-104")).toBeNull();
    expect(ordenConEsaFactura(ordenes, "1045")).toBeNull();
    expect(ordenConEsaFactura(ordenes, "INV-10456")?.id).toBe("o4");
  });
  it("el completo casa sin importar mayúsculas, espacios ni el «#»; y da la orden MÁS RECIENTE que no esté anulada", () => {
    expect(ordenConEsaFactura(ordenes, "inv-1045")?.id).toBe("o2");
    expect(ordenConEsaFactura(ordenes, "  # INV - 1045 ")?.id).toBe("o2");
    expect(facturaComparable(" #Inv 10 45 ")).toBe("inv1045");
  });
  it("la orden que se está editando no se encuentra a sí misma; vacío no busca", () => {
    expect(ordenConEsaFactura(ordenes, "INV-1045", "o2")?.id).toBe("o1");
    expect(ordenConEsaFactura(ordenes, "INV-10456", "o4")).toBeNull();
    expect(ordenConEsaFactura(ordenes, "   ")).toBeNull();
    expect(ordenConEsaFactura(ordenes, "#")).toBeNull();                    // no casa con las órdenes SIN factura
  });
  it("el formulario: un campo y una lupa; busca al pulsar o con Enter, nunca al teclear; y ya no hay lista", () => {
    const a = formulario.indexOf("function BuscaFactura(");
    expect(a).toBeGreaterThanOrEqual(0);
    const c = formulario.slice(a, formulario.indexOf("/** Visual meta for each note tag", a));
    expect(c).toContain("onClick={buscar}");
    expect(c).toContain('if (e.key === "Enter") { e.preventDefault(); buscar(); }');
    expect(c).toContain("onChange={(e) => { setQ(e.target.value); setHallada(undefined); }}");
    expect(c).toContain("🔍");
    expect(c).not.toMatch(/\.filter\(|\.map\(/);                             // nada que listar
    expect(formulario).toContain("busca={(n) => ordenConEsaFactura(deliveries, n, existing?.id)}");
    expect(formulario).not.toMatch(/PastInvoicePicker|pastInvoiceOptions/);
  });
});

describe("5 · Cuenta: no enseña la lista sin haber tecleado", () => {
  const CUENTAS = ["Alfa Builders", "Bravo Homes", "Constructora Uno"];
  it(`hacen falta ${LETRAS_PARA_SUGERIR} letras: ni vacío, ni una, ni espacios`, () => {
    expect(LETRAS_PARA_SUGERIR).toBe(2);
    expect(sugerenciasPara(CUENTAS, "")).toEqual([]);
    expect(sugerenciasPara(CUENTAS, "b")).toEqual([]);
    expect(sugerenciasPara(CUENTAS, " b ")).toEqual([]);
    expect(sugerenciasPara(CUENTAS, "br")).toEqual(["Bravo Homes"]);
    expect(sugerenciasPara(CUENTAS, "", "Bravo Homes")).toEqual([]);         // tampoco «la que ya tiene»
  });
  it("lo tecleado sin sugerencias sigue siendo una cuenta manual con ese texto", () => {
    expect(decisionAlConfirmar({ texto: "B", sugerencias: sugerenciasPara(CUENTAS, "B"), activo: -1 })).toEqual({ origen: "manual", valor: "B" });
  });
  it("el campo no se abre al ENFOCARLO, solo al teclear o con la flecha", () => {
    const a = formulario.indexOf("function AccountCombo(");
    const c = formulario.slice(a, formulario.indexOf("\n}\n", a));
    expect(c).not.toContain("onFocus");
    expect(c).toContain("onChange={(e) => { setTexto(e.target.value); setAbierto(true); setActivo(-1); }}");
  });
});

describe("6 y 7 · «Venta al mostrador» es una opción fija del campo, y no recuerda a nadie", () => {
  const guardada = { contact: "Persona Guardada", phone: "9560000001" };
  const ultima = { contact: "Cliente De Ayer", delivery_phone: "9560000002" };
  const actual = { contact: "Lo Que Había", delivery_phone: "9560000003" };

  it("al elegir mostrador, contacto y teléfono quedan VACÍOS: ni los de antes, ni los de la última orden de mostrador", () => {
    for (const cuenta of [CUENTA_DE_MOSTRADOR, CUENTA_DE_MOSTRADOR_EN.toUpperCase()]) {
      expect(contactoAlElegirCuenta({ cuenta, guardada: undefined, ultimaOrden: ultima, actual })).toEqual({ contact: "", delivery_phone: "" });
      expect(contactoAlElegirCuenta({ cuenta, guardada, ultimaOrden: undefined, actual })).toEqual({ contact: "", delivery_phone: "" });
    }
  });
  it("cualquier otra cuenta, como siempre: la guardada manda; si no, la última orden; si no, lo que había", () => {
    expect(contactoAlElegirCuenta({ cuenta: "Constructora Uno", guardada, ultimaOrden: ultima, actual })).toEqual({ contact: "Persona Guardada", delivery_phone: "9560000001" });
    expect(contactoAlElegirCuenta({ cuenta: "Constructora Uno", guardada: undefined, ultimaOrden: ultima, actual })).toEqual({ contact: "Cliente De Ayer", delivery_phone: "9560000002" });
    expect(contactoAlElegirCuenta({ cuenta: "Nueva", guardada: undefined, ultimaOrden: undefined, actual })).toEqual({ contact: "Lo Que Había", delivery_phone: "9560000003" });
  });
  it("vacíos DE PARTIDA, no opcionales: siguen faltando para poder enviar", () => {
    const faltan = missingKeys({ order_type: "Customer", account: CUENTA_DE_MOSTRADOR, contact: "", delivery_phone: "" });
    expect([faltan.has("contact"), faltan.has("delivery_phone")]).toEqual([true, true]);
  });
  it("la de mostrador no «recuerda»: ni se ofrece guardar su contacto, ni sus direcciones pasan a ser sitios", () => {
    expect([laCuentaRecuerda(CUENTA_DE_MOSTRADOR), laCuentaRecuerda(` ${CUENTA_DE_MOSTRADOR_EN} `), laCuentaRecuerda("Constructora Uno"), laCuentaRecuerda(""), laCuentaRecuerda(null)])
      .toEqual([false, false, true, false, false]);
    expect(formulario).toContain("{salesFields && laCuentaRecuerda(d.account) && !!d.contact?.trim() && !!d.delivery_phone?.trim() &&");
    expect(formulario).toContain("if (laCuentaRecuerda(v) && !isIntertienda) {");
  });
  it("el formulario: la opción está siempre a mano, se guarda SIEMPRE con la misma cadena, y usa la regla probada", () => {
    expect(formulario).toContain("fija={{ valor: CUENTA_DE_MOSTRADOR, etiqueta: t(CUENTA_DE_MOSTRADOR_EN, CUENTA_DE_MOSTRADOR) }}");
    expect(formulario).toContain("const v = esCuentaDeMostrador(elegida) ? CUENTA_DE_MOSTRADOR : elegida;");
    expect(formulario).toContain("...contactoAlElegirCuenta({ cuenta: v, guardada: rec, ultimaOrden: past, actual: p }),");
    expect(formulario).toContain("onMouseDown={(e) => { e.preventDefault(); elegir(fija.valor); }}>");
    // El nombre no está escrito a mano en la pantalla: sale de la constante.
    expect(formulario).not.toContain(`"${CUENTA_DE_MOSTRADOR}"`);
  });
});

describe("1 · «Buscar dirección en el mapa» se quitó; soltar el pin sigue", () => {
  it("ni el botón ni su función; el pin a mano y su «Buscando…» (geocodificación inversa) se quedan", () => {
    expect(formulario).not.toMatch(/lookupAddress|Look up address on map|Buscar dirección en el mapa"/);
    expect(formulario).not.toContain('fetch("/api/geocode-point"');
    expect(formulario.split("Set exact location on map").length - 1).toBe(2);
    expect(formulario).toContain('const res = await fetch("/api/reverse-geocode", {');
    expect(formulario.split("{pinLookupBusy ? (").length - 1).toBe(2);
  });
});

describe("2 · el autocompletado busca en Texas, y antes en la zona verde", () => {
  it("la caja de la zona se CALCULA del polígono: lo envuelve entero, y cada lado lo toca un vértice", () => {
    const z = CAJA_DE_LA_ZONA;
    for (const [lat, lng] of LOCAL_ZONE_DEFAULT) {
      expect(lat >= z.sur && lat <= z.norte && lng >= z.oeste && lng <= z.este).toBe(true);
    }
    expect(LOCAL_ZONE_DEFAULT.some((v) => v[0] === z.sur) && LOCAL_ZONE_DEFAULT.some((v) => v[0] === z.norte)).toBe(true);
    expect(LOCAL_ZONE_DEFAULT.some((v) => v[1] === z.oeste) && LOCAL_ZONE_DEFAULT.some((v) => v[1] === z.este)).toBe(true);
    // Con otro contorno, otra caja: no hay números clavados.
    expect(cajaDe([[1, -5], [3, -9], [2, -7]])).toEqual({ sur: 1, oeste: -9, norte: 3, este: -5 });
    expect(centroDe({ sur: 1, oeste: -9, norte: 3, este: -5 })).toEqual({ lat: 2, lng: -7 });
    expect(puntoEnZonaLocal(centroDe(z).lat, centroDe(z).lng)).toBe(true);
  });
  it("la zona verde cabe dentro de Texas: el sesgo nunca apunta fuera del límite", () => {
    const z = CAJA_DE_LA_ZONA, t = CAJA_DE_TEXAS;
    expect(z.sur >= t.sur && z.norte <= t.norte && z.oeste >= t.oeste && z.este <= t.este).toBe(true);
  });
  it("Places: sesgo por la zona verde (no restricción), solo EE. UU.", () => {
    const z = CAJA_DE_LA_ZONA;
    expect(cuerpoDePlaces("100 calle")).toEqual({
      input: "100 calle", includedRegionCodes: ["us"],
      locationBias: { rectangle: { low: { latitude: z.sur, longitude: z.oeste }, high: { latitude: z.norte, longitude: z.este } } },
    });
  });
  it("Geocoding, Mapbox y Nominatim: Texas como límite; la zona como sesgo donde el proveedor lo admite", () => {
    const z = CAJA_DE_LA_ZONA, t = CAJA_DE_TEXAS, c = centroDe(z);
    const g = new URL(urlDeGoogleGeocode("100 calle #2", "LLAVE"));
    expect([g.searchParams.get("address"), g.searchParams.get("components"), g.searchParams.get("bounds"), g.searchParams.get("key")])
      .toEqual(["100 calle #2", "administrative_area:TX|country:US", `${z.sur},${z.oeste}|${z.norte},${z.este}`, "LLAVE"]);
    const m = new URL(urlDeMapbox("100 calle", "TOKEN"));
    expect([m.searchParams.get("bbox"), m.searchParams.get("proximity"), m.searchParams.get("country")]).toEqual([`${t.oeste},${t.sur},${t.este},${t.norte}`, `${c.lng},${c.lat}`, "us"]);
    const o = new URL(urlDeOSM("100 calle"));
    expect([o.searchParams.get("viewbox"), o.searchParams.get("bounded"), o.searchParams.get("addressdetails"), o.searchParams.get("countrycodes")])
      .toEqual([`${t.oeste},${t.norte},${t.este},${t.sur}`, "1", "1", "us"]);
  });
  it("el texto de Places: el estado va al FINAL; no cuela lo que solo se parece", () => {
    const si = ["100 Calle Uno, McAllen, TX, USA", "100 Calle Uno, McAllen, TX 78501, USA", "100 Calle Uno, McAllen, TX 78501-1234", "Edinburg, Texas, United States", "100 Calle Uno, Mission, tx"];
    const no = ["100 State Line Ave, Texarkana, AR, USA", "100 TX-107, Springfield, MO, USA", "100 Texas St, Shreveport, LA 71101, USA", "Texas City Rd, Somewhere, OK, USA", "", "100 Calle Uno, McAllen, TXA, USA"];
    expect(si.filter(esTextoDeTexas)).toEqual(si);
    expect(no.filter(esTextoDeTexas)).toEqual([]);
    expect(esTextoDeTexas(null)).toBe(false);
  });
  it("las respuestas estructuradas se filtran por el ESTADO, no por el texto", () => {
    expect(esDeTexasGoogle({ address_components: [{ short_name: "TX", types: ["administrative_area_level_1", "political"] }] })).toBe(true);
    expect(esDeTexasGoogle({ address_components: [{ short_name: "AR", types: ["administrative_area_level_1"] }, { short_name: "TX", types: ["route"] }] })).toBe(false);
    expect(esDeTexasGoogle({})).toBe(false);
    expect(esDeTexasMapbox({ id: "address.1", context: [{ id: "place.9", short_code: "US-TX" }, { id: "region.7", short_code: "US-AR" }] })).toBe(false);
    expect(esDeTexasMapbox({ id: "address.1", context: [{ id: "region.7", short_code: "us-tx" }] })).toBe(true);
    expect(esDeTexasMapbox({ id: "region.7", properties: { short_code: "US-TX" } })).toBe(true);
    expect(esDeTexasMapbox({ id: "address.1" })).toBe(false);
    expect(esDeTexasOSM({ address: { "ISO3166-2-lvl4": "US-TX" } })).toBe(true);
    expect(esDeTexasOSM({ address: { "ISO3166-2-lvl4": "US-AR", state: "Texas" } })).toBe(false);
    expect(esDeTexasOSM({})).toBe(false);
  });
  it("la ruta usa todo eso, y cada proveedor filtra SU respuesta: si no queda nada de Texas, no sale nada de otro estado", () => {
    const r = leer("src/app/api/geocode/route.ts");
    expect(r).toContain("body: JSON.stringify(cuerpoDePlaces(q)),");
    expect(r).toContain("!!t && esTextoDeTexas(t));");
    expect(r).toContain("fetch(urlDeGoogleGeocode(q, key))");
    expect(r).toContain("(data.results || []).filter(esDeTexasGoogle).map(");
    expect(r).toContain("fetch(urlDeMapbox(q, token))");
    expect(r).toContain("(data.features || []).filter(esDeTexasMapbox).map(");
    expect(r).toContain("fetch(urlDeOSM(q), {");
    expect(r).toContain("data.filter(esDeTexasOSM).map(");
    expect(r).not.toMatch(/https:\/\/(maps|places|api\.mapbox|nominatim)[^"`]*\$\{/);   // ninguna URL montada a mano en la ruta
  });
});

describe("8, 9 y 10 · textos y columnas", () => {
  it("8 · en una orden NUEVA el botón CREA; enviar un borrador que ya existe sigue siendo «enviar»", () => {
    expect(formulario).toContain('? t("Create (goes to approval)", "Crear (va a aprobación)")');
    expect(formulario).toContain('? t("Create order (approved)", "Crear orden (aprobada)")');
    expect(formulario).toContain('t("Submit for approval", "Enviar a aprobación")');                  // el borrador guardado
    expect(formulario.split('t("Submit for approval", "Enviar a aprobación")').length - 1).toBe(1);
  });
  it("9 · «Almacén de recolección», en el formulario, en lo que falta, en la vista de la orden y en el volante", () => {
    expect(formulario).toContain('nameLabel={t("Pickup warehouse", "Almacén de recolección")}');
    expect(leer("src/lib/required.ts")).toContain('{ key: "pickup_name", en: "Pickup warehouse", es: "Almacén de recolección" }');
    expect([colLabel("Pickup Name", "es"), colLabel("Pickup Name", "en")]).toEqual(["Almacén de recolección", "Pickup warehouse"]);
    expect(colLabel("Pickup Address", "en")).toBe("Pickup Address");
    expect(leer("src/lib/slip.ts")).toContain('row(T("Pickup warehouse", "Almacén"), d.pickup_name || "")');
    for (const f of ["src/components/OrderModal.tsx", "src/lib/required.ts", "src/lib/utils.ts", "src/lib/slip.ts"]) {
      expect(leer(f), f).not.toMatch(/Nombre de Recolección/i);
    }
    // La CABECERA del CSV no cambia: es el contrato de importar y exportar.
    expect(leer("src/lib/csv-import.ts")).toContain('"Pickup Name": "pickup_name",');
    expect(leer("src/lib/utils.ts")).toContain('["Pickup Name", d.pickup_name ?? ""],');
  });
  it("10 · ventas ve la dirección de entrega de partida; la columna ya existía y dice qué dirección es", () => {
    expect(ROLE_DEFAULT_COLUMNS.sales).toContain("address");
    expect(leer("src/components/OrdersTable.tsx")).toContain('{ key: "address", en: "Delivery Address", es: "Dirección de entrega",');
  });
});
