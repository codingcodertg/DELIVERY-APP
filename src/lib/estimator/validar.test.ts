import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { borradorSinTrabajo, trasComprobar, estadoDelEstimado, lineasCortas, loQueFalta, puedeGuardar, puedeTrabajar, TEXTO_DE_FALTA, type EstimadoHallado } from "./validar";
import { sePuedeGenerar, sePuedePedirLaCopia, POLITICA_PARRAFOS, POLITICA_CASILLA, POLITICA_TITULO } from "./politica";
import { borradorVacio, lineaSfVacia, lineaUnidadVacia, type QuoteDraft } from "./modelo";

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

const hallado = (patch: Partial<EstimadoHallado> = {}): EstimadoHallado => ({
  quote_id: "q1", estimate_num: "104582", owner_id: "otro", owner_name: "Otro Vendedor", owner_store: null,
  my_approval_id: null, my_approval: null, ...patch,
});
const base = { baseDisponible: true, buscado: true, meId: "yo", esAdmin: false };

describe("de quién es el estimado", () => {
  it("sin la 148 no se puede comprobar: sin-base, y se deja trabajar", () => {
    expect(estadoDelEstimado({ ...base, baseDisponible: false, hallado: null })).toBe("sin-base");
    expect(puedeTrabajar("sin-base")).toBe(true);
  });
  it("sin buscar no se sabe, y no se deja", () => {
    expect(estadoDelEstimado({ ...base, buscado: false, hallado: null })).toBe("sin-buscar");
    expect(puedeTrabajar("sin-buscar")).toBe(false);
  });
  it("nadie la tiene: nueva; es mía: propia", () => {
    expect(estadoDelEstimado({ ...base, hallado: null })).toBe("nueva");
    expect(estadoDelEstimado({ ...base, hallado: hallado({ owner_id: "yo" }) })).toBe("propia");
  });
  it("es de otro: hace falta su aprobación", () => {
    expect(estadoDelEstimado({ ...base, hallado: hallado() })).toBe("sin-pedir");
    expect(estadoDelEstimado({ ...base, hallado: hallado({ my_approval: "pending" }) })).toBe("pendiente");
    expect(estadoDelEstimado({ ...base, hallado: hallado({ my_approval: "denied" }) })).toBe("denegada");
    expect(estadoDelEstimado({ ...base, hallado: hallado({ my_approval: "approved" }) })).toBe("aprobada");
    for (const e of ["sin-pedir", "pendiente", "denegada"] as const) expect(puedeTrabajar(e)).toBe(false);
    expect(puedeTrabajar("aprobada")).toBe(true);
  });
  it("el admin no necesita permiso", () => {
    expect(estadoDelEstimado({ ...base, esAdmin: true, hallado: hallado() })).toBe("admin");
    expect(puedeTrabajar("admin")).toBe(true);
  });
  it("un estimado sin dueño (el dueño se borró) no es «mío» aunque mi id sea nulo", () => {
    expect(estadoDelEstimado({ ...base, meId: null, hallado: hallado({ owner_id: null }) })).toBe("sin-pedir");
  });
});

function completo(patch: Partial<QuoteDraft> = {}): QuoteDraft {
  return {
    ...borradorVacio("2026-09-08"),
    estimate_num: "104582",
    sales_ext: "214",
    customer: { salutation: "Ms.", full_name: "Ana Prueba", company: "", phone: "", address: "" },
    lines: [{ ...lineaSfVacia(), customer_category: "24x48 Tile", requested_sf: 100, sf_per_box: 10, price_per_sf: 2 }],
    ...patch,
  };
}

describe("lo que falta antes de generar la copia", () => {
  it("completo y con permiso: nada", () => {
    expect(loQueFalta(completo(), "nueva", "2026-09-08")).toEqual([]);
  });
  it("sin buscar el estimado, no", () => {
    expect(loQueFalta(completo(), "sin-buscar", "2026-09-08")).toEqual(["buscar"]);
  });
  it("de otro vendedor sin su aprobación, no", () => {
    expect(loQueFalta(completo(), "pendiente", "2026-09-08")).toEqual(["permiso"]);
  });
  it("si es entrega, la dirección es obligatoria (una línea, como en la ficha de Entregas: D-NEXT)", () => {
    const d = completo({ delivery: { ...borradorVacio().delivery, mode: "delivery", address: "  " } });
    expect(loQueFalta(d, "nueva", "2026-09-08")).toEqual(["direccion"]);
    const bien = completo({ delivery: { ...d.delivery, address: "1 Main St, McAllen, TX 78501" } });
    expect(loQueFalta(bien, "nueva", "2026-09-08")).toEqual([]);
    // Recogiendo, la dirección no se pide.
    expect(loQueFalta(completo({ delivery: { ...d.delivery, mode: "pickup" } }), "nueva", "2026-09-08")).toEqual([]);
  });
  it("extensión, nombre, categoría y línea completa (sin «apellido»: sale del nombre, D-432)", () => {
    const q = completo({ sales_ext: " ", lines: [{ ...lineaSfVacia(), requested_sf: 100 }] });
    q.customer = { ...q.customer, full_name: "" };
    expect(loQueFalta(q, "nueva", "2026-09-08")).toEqual(["extension", "nombre", "linea-incompleta", "categoria"]);
    expect(Object.keys(TEXTO_DE_FALTA)).not.toContain("apellido");
    expect(loQueFalta(completo({ lines: [] }), "nueva", "2026-09-08")).toEqual(["lineas"]);
  });
  it("una validez ya pasada no se imprime; la de hoy sí", () => {
    expect(loQueFalta(completo({ valid_through: "2026-09-07" }), "nueva", "2026-09-08")).toEqual(["validez-pasada"]);
    expect(loQueFalta(completo({ valid_through: "" }), "nueva", "2026-09-08")).toEqual(["validez"]);
  });
  it("guardar pide menos: número y permiso, y con base", () => {
    expect(puedeGuardar(completo({ lines: [] }), "nueva")).toBe(true);
    expect(puedeGuardar(completo(), "sin-base")).toBe(false);
    // Sin comprobar aún se puede PULSAR (D-432): el guardado comprueba antes de escribir.
    expect(puedeGuardar(completo(), "sin-buscar")).toBe(true);
    expect(puedeGuardar(completo(), "pendiente")).toBe(false);
    expect(puedeGuardar(completo(), "sin-pedir")).toBe(false);
    expect(puedeGuardar(completo({ estimate_num: "" }), "nueva")).toBe(false);
  });
  it("aviso: cajas escritas que no cubren lo pedido", () => {
    const l = { ...lineaSfVacia(), id: "corta", customer_category: "x", requested_sf: 100, sf_per_box: 10, price_per_sf: 2, boxes: 9 };
    expect(lineasCortas(completo({ lines: [l] }))).toEqual(["corta"]);
    expect(lineasCortas(completo({ lines: [{ ...l, boxes: 10 }] }))).toEqual([]);
  });
});

describe("un nombre de una palabra basta (D-432)", () => {
  it("con nombre, nada que ver con el apellido", () => {
    const q = completo();
    q.customer = { ...q.customer, full_name: "Gonzalez" };
    expect(loQueFalta(q, "nueva", "2026-09-08")).toEqual([]);
  });
});

describe("la guardada se abre sola solo sobre un borrador en blanco (D-432)", () => {
  const blanco = () => ({ ...borradorVacio("2026-09-08"), estimate_num: "E-9", sales_ext: "214" });
  it("en blanco (número, extensión y fecha no cuentan como trabajo)", () => {
    expect(borradorSinTrabajo(borradorVacio("2026-09-08"))).toBe(true);
    expect(borradorSinTrabajo(blanco())).toBe(true);
    expect(borradorSinTrabajo({ ...blanco(), valid_through: "2026-12-01" })).toBe(true);
  });
  it("con cualquier dato del cliente, de la entrega o de una línea, ya hay trabajo", () => {
    const b = blanco();
    expect(borradorSinTrabajo({ ...b, customer: { ...b.customer, full_name: "Ana" } })).toBe(false);
    expect(borradorSinTrabajo({ ...b, customer: { ...b.customer, phone: "956" } })).toBe(false);
    expect(borradorSinTrabajo({ ...b, delivery: { ...b.delivery, mode: "delivery" } })).toBe(false);
    expect(borradorSinTrabajo({ ...b, delivery: { ...b.delivery, address: "1 Main St" } })).toBe(false);
    expect(borradorSinTrabajo({ ...b, delivery: { ...b.delivery, lat: 26.2, lng: -98.2 } })).toBe(false);
    // La tienda de salida la pone la pantalla sola (la del perfil): no es trabajo del vendedor.
    expect(borradorSinTrabajo({ ...b, delivery: { ...b.delivery, store: "Pharr" } })).toBe(true);
    expect(borradorSinTrabajo({ ...b, lines: [{ ...lineaSfVacia(), customer_category: "x" }] })).toBe(false);
    expect(borradorSinTrabajo({ ...b, lines: [{ ...lineaSfVacia(), requested_sf: 100 }] })).toBe(false);
    expect(borradorSinTrabajo({ ...b, lines: [{ ...lineaUnidadVacia(), unit_price: 385 }] })).toBe(false);
    expect(borradorSinTrabajo({ ...b, project_summary: "Kitchen" })).toBe(false);
    expect(borradorSinTrabajo({ ...b, display_level: "detailed" })).toBe(false);
  });
});

describe("qué se hace con la comprobación automática (D-432)", () => {
  const blanco = { ...borradorVacio("2026-09-08"), estimate_num: "104582" };
  const conTrabajo = { ...blanco, customer: { ...blanco.customer, full_name: "Ana Prueba" } };
  const args = { meId: "yo", esAdmin: false, quoteIdAbierto: null, borrador: blanco, abrirSola: true };
  it("sin cotización: nueva (quien prepara será el dueño)", () => {
    expect(trasComprobar({ ...args, hallado: null })).toBe("nueva");
  });
  it("de otro y sin permiso: ajena, aunque el borrador esté en blanco", () => {
    expect(trasComprobar({ ...args, hallado: hallado() })).toBe("ajena");
    expect(trasComprobar({ ...args, hallado: hallado({ my_approval: "pending" }) })).toBe("ajena");
    expect(trasComprobar({ ...args, meId: null, hallado: hallado({ owner_id: null }) })).toBe("ajena");
  });
  it("mía (o aprobada, o admin) sobre un borrador en blanco: se abre sola", () => {
    expect(trasComprobar({ ...args, hallado: hallado({ owner_id: "yo" }) })).toBe("abrir");
    expect(trasComprobar({ ...args, hallado: hallado({ my_approval: "approved" }) })).toBe("abrir");
    expect(trasComprobar({ ...args, esAdmin: true, hallado: hallado() })).toBe("abrir");
  });
  it("con trabajo tecleado, o si la lanzó Guardar, se ofrece y no se pisa", () => {
    expect(trasComprobar({ ...args, borrador: conTrabajo, hallado: hallado({ owner_id: "yo" }) })).toBe("ofrecer");
    expect(trasComprobar({ ...args, abrirSola: false, hallado: hallado({ owner_id: "yo" }) })).toBe("ofrecer");
  });
  it("la que ya está abierta no se vuelve a abrir", () => {
    expect(trasComprobar({ ...args, quoteIdAbierto: "q1", borrador: conTrabajo, hallado: hallado({ owner_id: "yo" }) })).toBe("ya-abierta");
  });
});

describe("la política del vendedor: casilla obligatoria", () => {
  it("sin nada pendiente se abre; generar exige además la casilla", () => {
    expect(sePuedePedirLaCopia([])).toBe(true);
    expect(sePuedePedirLaCopia(["buscar"])).toBe(false);
    expect(sePuedeGenerar([], false)).toBe(false);
    expect(sePuedeGenerar([], true)).toBe(true);
    expect(sePuedeGenerar(["permiso"], true)).toBe(false);
  });
  it("el texto es el del documento del dueño", () => {
    expect(POLITICA_TITULO).toBe("CUSTOMER QUOTE POLICY");
    expect(POLITICA_PARRAFOS).toHaveLength(4);
    expect(POLITICA_PARRAFOS[0]).toMatch(/^Do not print by default\./);
    expect(POLITICA_PARRAFOS[3]).toContain("Search the estimate number first.");
    expect(POLITICA_CASILLA).toMatch(/^I have reviewed and will follow the Customer Quote Policy/);
  });
});

describe("la pantalla usa estas reglas, no una copia", () => {
  const p = leer("src/app/estimator/Estimador.tsx");
  it("el estado del estimado y lo que falta salen de validar", () => {
    expect(p).toMatch(/const estado = estadoDelEstimado\(\{/);
    expect(p).toContain("const faltas = loQueFalta(draft, estado);");
    // Los totales de la pantalla salen del mismo resumen que la hoja (D-NEXT): subtotal, ahorro, impuesto y total.
    expect(p).toContain("const totales = resumenDeTotales(draft.lines);");
    for (const campo of ["subtotal", "ahorro", "impuesto", "total"]) expect(p).toContain(`dinero(totales.${campo})`);
  });
  it("el botón de generar y el Continuar de la política pasan por politica.ts", () => {
    expect(p).toContain("disabled={ocupado || !sePuedePedirLaCopia(faltas)} onClick={abrirPolitica}");
    expect(p).toContain("disabled={!sePuedeGenerar(faltas, politicaMarcada)} onClick={() => void generar()}");
    expect(p).toContain("if (!sePuedeGenerar(faltas, politicaMarcada)) return;");
    // La casilla nace desmarcada cada vez que se abre.
    expect(p).toMatch(/const abrirPolitica = \(\) => \{\s*if \(!sePuedePedirLaCopia\(faltas\)\) return;\s*setPoliticaMarcada\(false\);/);
  });
  it("guardar pasa por puedeGuardar", () => {
    expect(p).toContain("if (!me || !puedeGuardar(draft, estado)) return null;");
  });
  it("sin botón «Search» (D-432): se comprueba solo, al salir del campo y antes de guardar", () => {
    expect(p).not.toContain("data-buscar");
    expect(p).not.toContain('t("Search", "Buscar")');
    expect(p).toContain("onBlur={comprobarYa}");
    expect(p).toContain("void comprobarRef.current(n); }, ESPERA_COMPROBACION_MS);");
    // Guardar sin comprobar: comprueba él, y se para si el estimado es de otro.
    expect(p).toMatch(/if \(estado === "sin-buscar"\) \{[\s\S]*?const c = await comprobar\(draft\.estimate_num, false\);[\s\S]*?if \(!puedeTrabajar\(est\)\) return null;/);
    // Y una guardada que no es la abierta no se pisa.
    expect(p).toContain("if (h && h.quote_id !== quoteIdRef.current) {");
  });
  it("la comprobación decide con trasComprobar, sobre el borrador de AHORA, y descarta respuestas viejas", () => {
    expect(p).toContain("quoteIdAbierto: quoteIdRef.current, borrador: draftRef.current, abrirSola,");
    expect(p).toContain("if (claveDeEstimado(draftRef.current.estimate_num) !== clave) return { ok: false };");
    expect(p).toContain('} else if (que === "abrir" && h) {\n      await abrirGuardada(h.quote_id);');
  });
  it("«Original sales rep» sin comprobar dice quién prepara, no «Search the estimate first»", () => {
    expect(p).not.toContain("Search the estimate first");
    expect(p).toContain(': buscado || !draft.estimate_num.trim() ? `${me.name} (${t("you", "tú")})`');
  });
  it("sin campo de apellido; la línea «Customer sees only» sale del nombre", () => {
    expect(p).not.toContain("est-apellido");
    expect(p).not.toContain("last_name");
    expect(p).toContain("<b>{paraQuienSeImprime(draft.customer) || \"—\"}</b>");
  });
  it("el teléfono se limpia al escribir y al salir", () => {
    expect(p).toContain("onChange={(e) => setCliente({ phone: telefonoAlEscribir(e.target.value) })}");
    expect(p).toContain("onBlur={(e) => setCliente({ phone: telefonoAlEscribir(e.target.value) })} />");
  });
  it("la dirección ocupa la fila entera: en el móvil no fabrica columnas que estrujen Título y Teléfono", () => {
    expect(p).toMatch(/gridColumn: "1 \/ -1" \}\}>\s*<label htmlFor="est-dir">/);
  });
  it("la sección de la competencia ya no pide «buscar» el estimado", () => {
    const comp = leer("src/app/estimator/Competencia.tsx");
    expect(comp).not.toContain("Search and save");
    expect(comp).toContain("Save this estimate's quote first");
  });
  it("la extensión nace de extensionDePartida: la del servidor, o la del demo", () => {
    expect(p).toContain("const p = extensionDePartida(demo ? extensionDemo(me.id) : extensionServidor, recordada);");
  });
});

describe("la extensión del expediente la lee el servidor, solo la de quien entra (D-432)", () => {
  const page = leer("src/app/estimator/page.tsx");
  it("una columna, filtrada por el id de la sesión y activa", () => {
    expect(page).toContain('.select("ringcentral_ext")');
    expect(page).toContain('.eq("profile_id", userId)');
    expect(page).toContain('.is("date_left", null)');
    expect(page).toContain("me ? extensionDelExpediente(me.id) : null");
    expect(page).toContain("<Estimador me={me} demo={false} extension={extension} ajustes={ajustes} />");
  });
});
