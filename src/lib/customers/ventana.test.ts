import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FichaEnVentana } from "@/app/customers/FichaDeCliente";
import { almacenDemo, CLIENTES_DEMO } from "./demo";
import { filasDeLaEmpresa } from "./empresas";
import { estadoLabel, nombreDeTienda, TIENDAS, valorDeColumna, type Cliente } from "./reglas";

/**
 * D-654 (2026-10-23). El dueño: «cuando uno le da clic al cliente […] abre ese side window por al lado, y eso no me
 * sirve. Yo ocupo que, así como en el delivery app, se abra un window […] y ya me dé la ficha completa». Y: arriba dice
 * «RDC McAllen y después […] como un ID» en vez del nombre; abajo «Cuenta» vuelve a decir la tienda; y «añadido tanda,
 * número de house y tienda más cuenta» van en «Other».
 *
 * La ventana se pinta de verdad (React en el servidor) con los clientes INVENTADOS del demo. Lo que se cierra con un
 * clic fuera o con Escape lo decide `cierraLaFicha` (probada en reglas.test.ts) y se midió en el navegador.
 */
const t = (_en: string, es: string) => es;
const pinta = (cliente: Cliente | null, o: { puedeEditar?: boolean; editarAlAbrir?: boolean } = {}) =>
  renderToStaticMarkup(createElement(FichaEnVentana, {
    cliente,
    hermanas: cliente ? filasDeLaEmpresa(CLIENTES_DEMO, cliente) : [],
    lista: CLIENTES_DEMO,
    onCambia: () => {}, onClose: () => {}, onGuardado: () => {},
    puedeEditar: o.puedeEditar ?? true,
    almacen: almacenDemo(),
    editarAlAbrir: o.editarAlAbrir ?? false,
    t,
  }));
/** Lo de antes de las pastillas de tiendas: la cabecera de la ventana. */
const cabecera = (html: string) => html.slice(0, html.indexOf('role="tablist"'));
/** El trozo de una tarjeta, de su `data-grupo` a la siguiente. */
const tarjeta = (html: string, g: string) => {
  const i = html.indexOf(`data-grupo="${g}"`);
  expect(i, g).toBeGreaterThan(-1);
  const j = html.indexOf("data-grupo=", i + 1);
  return html.slice(i, j < 0 ? undefined : j);
};
const grupos = (html: string) => [...html.matchAll(/data-grupo="(\w+)"/g)].map((m) => m[1]);
/** D-660: la etiqueta de apertura del apartado «Campos ocultos», y el apartado entero (hasta su `</details>`). */
const etiquetaOculta = (html: string) => /<details[^>]*data-campos-ocultos="true"[^>]*>/.exec(html)?.[0] ?? "";
const ocultos = (html: string) => {
  const i = html.indexOf(etiquetaOculta(html));
  expect(etiquetaOculta(html)).not.toBe("");
  return html.slice(i, html.indexOf("</details>", i) + "</details>".length);
};

// Una empresa en dos tiendas (la 1 y la 2 del demo) y una sola (la 3).
const dosTiendas = CLIENTES_DEMO.find((c) => c.id === 1)!;
const unaTienda = CLIENTES_DEMO.find((c) => c.id === 3)!;

describe("la ficha en una ventana centrada (D-654)", () => {
  it("es una ventana como la de una orden de Entregas (`.overlay` + `.modal`), no el cajón lateral, y lleva su ✕", () => {
    const html = pinta(dosTiendas);
    expect(html.startsWith('<div class="overlay" data-ficha-de-cliente="true">')).toBe(true);
    expect(html).toMatch(/<div class="modal[^"]*" style="max-width:1100px" role="dialog" aria-modal="true"/);
    // El cajón era `fixed inset-0 … justify-end` con un panel `h-full max-w-md` pegado a la derecha.
    expect(html).not.toContain("fixed inset-0");
    expect(html).not.toContain("max-w-md");
    expect(html).toMatch(/<button type="button"[^>]*aria-label="Cerrar" data-cerrar-ficha="true">✕<\/button>/);
  });
  it("arriba, el NOMBRE de la cuenta y su estado; ni la tienda ni la tienda+cuenta (la CONCATENATE)", () => {
    for (const c of [dosTiendas, unaTienda]) {
      const arriba = cabecera(pinta(c));
      expect(arriba).toContain(`data-nombre-de-la-cuenta="true">${c.account}</h2>`);
      expect(arriba).toContain(`>${estadoLabel(c.status_store, t)}<`);
      expect(arriba).not.toContain(nombreDeTienda(c.store));
      expect(arriba).not.toContain(String(valorDeColumna(c, "concatenate")));
    }
  });
  it("la ficha COMPLETA abajo: «Cuenta» primero (D-662), con el nombre una sola vez y sin «Tienda»", () => {
    const html = pinta(dosTiendas);
    // D-766: tres columnas fijas, por orden de aparición: Cuenta + Estado / Contacto / Crédito + Otros + ocultos + archivos.
    // D-786: al ver, «Otros» va debajo de «Contacto».
    expect(grupos(html)).toEqual(["cuenta", "estado", "contacto", "otros", "credito", "ocultos", "archivos"]);
    const cuenta = tarjeta(html, "cuenta");
    expect(cuenta).toContain('data-campo="account"');
    expect(cuenta).toContain('data-campo="unified_account"');
    expect(html.split('data-campo="account"')).toHaveLength(2);
    expect(html).not.toContain('data-campo="store"');
    // Y todo lo demás sí: contacto, crédito, estado, vendedores.
    for (const k of ["contact_name", "phone", "terms", "credit_limit", "status_store", "history_group", "rep_store", "crm_type_store", "notes"]) {
      expect(html, k).toContain(`data-campo="${k}"`);
    }
    // La tienda se ve UNA vez, en su pastilla (con dos tiendas, las dos pastillas).
    expect(html.split(nombreDeTienda(dosTiendas.store)).length - 1).toBe(1);
    expect(html).toContain('data-tiendas="2"');
  });
  it("con una sola tienda, la tienda sigue a la vista: su pastilla", () => {
    const html = pinta(unaTienda);
    expect(html).toContain('data-tiendas="1"');
    expect(html.split(nombreDeTienda(unaTienda.store)).length - 1).toBe(1);
  });
  it("D-660: Añadido (tanda), N.º House y Tienda + cuenta (CONCATENATE) van en «🔒 Campos ocultos», PLEGADO, con su valor, y no en «Otros»", () => {
    const html = pinta(dosTiendas);
    // Plegado al abrir: un <details> sin `open`.
    expect(etiquetaOculta(html)).not.toMatch(/\sopen[\s=>]/);
    const oculto = ocultos(html);
    expect(oculto).toMatch(/<summary[^>]*>🔒 Campos ocultos<\/summary>/);
    const orden = ["added_batch", "house_no", "concatenate"].map((k) => oculto.indexOf(`data-campo="${k}"`));
    for (const i of orden) expect(i).toBeGreaterThan(-1);
    expect(orden).toEqual([...orden].sort((a, b) => a - b));
    expect(oculto).toContain("Añadido (tanda)");
    expect(oculto).toContain(`>${dosTiendas.house_no}<`);
    expect(oculto).toContain(`>${valorDeColumna(dosTiendas, "concatenate")}<`);
    // Al final de la ficha: detrás de «Otros».
    expect(html.indexOf(etiquetaOculta(html))).toBeGreaterThan(html.indexOf('data-grupo="otros"'));
    // «Otros» se queda con el CRM y las notas (la cuenta unificada volvió a «Cuenta», D-662).
    const otros = tarjeta(html, "otros");
    for (const k of ["crm_type_store", "crm_type_group", "associated_with", "notes"]) expect(otros, k).toContain(`data-campo="${k}"`);
    expect(otros).not.toContain('data-campo="unified_account"');
    // Y fuera del apartado no salen en ninguna tarjeta.
    const fuera = html.replace(oculto, "");
    for (const k of ["added_batch", "house_no", "concatenate"]) expect(fuera, k).not.toContain(`data-campo="${k}"`);
    expect(fuera).not.toContain(String(valorDeColumna(dosTiendas, "concatenate")));
  });
  it("quien edita: «✏️ Editar» en la cabecera; abierta desde «Editar» (D-648), ya editando: el nombre arriba y la tienda en su pastilla", () => {
    const leyendo = pinta(dosTiendas);
    expect(leyendo).toContain("data-editar-en-la-ventana");
    expect(leyendo).not.toContain("data-guardar-ficha");
    const editando = pinta(dosTiendas, { editarAlAbrir: true });
    expect(editando).not.toContain("data-editar-en-la-ventana");
    const nombre = /<input[^>]*data-nombre-editable[^>]*>/.exec(cabecera(editando))?.[0] ?? "";
    expect(nombre).toContain(`value="${dosTiendas.account}"`);
    expect(editando).toMatch(/<select[^>]*aria-label="Tienda de esta fila" data-tienda-de-la-fila="true">/);
    expect(editando).toContain("data-guardar-ficha");
    // Los campos de las tarjetas son controles; House # y la CONCATENATE se siguen leyendo.
    expect(tarjeta(editando, "contacto")).toContain("<input");
    // D-660: dentro de «Campos ocultos», que sigue plegado: Añadido (tanda) es su control, y las otras dos se leen.
    expect(etiquetaOculta(editando)).not.toMatch(/\sopen[\s=>]/);
    const oculto = ocultos(editando);
    expect(oculto).toMatch(/data-campo="added_batch"><span[^>]*>Añadido \(tanda\)<\/span><input/);
    expect(oculto).toContain(`value="${dosTiendas.added_batch}"`);
    expect(oculto).toContain(`>${valorDeColumna(dosTiendas, "concatenate")}<`);
    expect(oculto).toContain(`>${dosTiendas.house_no}<`);
    // Editando, el nombre se corrige arriba: en la tarjeta «Cuenta» se lee (sin control), y la tienda no sale.
    expect(tarjeta(editando, "cuenta")).toMatch(/data-campo="account"><span[^>]*>Cuenta<\/span><span/);
    expect(editando).not.toContain('data-campo="store"');
  });
  it("quien no edita: solo lectura, sin «Editar» ni controles aunque llegue con editar", () => {
    const html = pinta(dosTiendas, { puedeEditar: false, editarAlAbrir: true });
    expect(html).toContain("Solo lectura");
    expect(ocultos(html)).toContain(`>${dosTiendas.added_batch}<`);
    expect(html).not.toContain("data-editar-en-la-ventana");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("data-guardar-ficha");
  });
  it("un alta abre editando: el nombre y la tienda arriba, obligatorios", () => {
    const html = pinta(null);
    expect(html).toContain('placeholder="Nombre de la cuenta *"');
    expect(html).toContain("Tiendas *");
    expect(html).toContain(">Crear<");
    expect(html).not.toContain('data-campo="house_no"');
    // D-660: en el alta, «Campos ocultos» solo lleva lo que se escribe: Añadido (tanda).
    expect(ocultos(html)).toContain('data-campo="added_batch"');
  });
  it("D-664: en el alta la tienda son casillas (una por tienda y «Todas»), sin desplegable; al editar, el desplegable de siempre", () => {
    const alta = pinta(null);
    const grupo = /<div role="group"[^>]*data-tiendas-del-alta="true">[\s\S]*?<\/div>/.exec(alta)?.[0] ?? "";
    expect(grupo).not.toBe("");
    for (const x of TIENDAS) expect(grupo, x.code).toMatch(new RegExp(`data-casilla-tienda="${x.code}"><input type="checkbox"/>${x.nombre}</label>`));
    expect(grupo).toMatch(/data-casilla-todas="true"><input type="checkbox"\/>Todas<\/label>/);
    expect([...grupo.matchAll(/type="checkbox"/g)]).toHaveLength(TIENDAS.length + 1);
    expect(alta).not.toContain("data-tienda-de-la-fila");
    // Editando un cliente que ya existe: ni una casilla; su tienda, en su desplegable.
    const editando = pinta(dosTiendas, { editarAlAbrir: true });
    expect(editando).not.toContain("data-tiendas-del-alta");
    expect(editando).not.toContain('type="checkbox"');
    expect(editando).toContain("data-tienda-de-la-fila");
  });
  it("D-665: editando, el aviso ámbar de duplicado con el enlace a la otra cuenta; leyendo, o sin nada escrito, no sale", () => {
    // La 9 del demo («Demo Drywal Inc») comparte teléfono con la 3 («Demo Drywall Inc»), de otra empresa y otra tienda.
    const nueve = CLIENTES_DEMO.find((c) => c.id === 9)!;
    const tres = CLIENTES_DEMO.find((c) => c.id === 3)!;
    const editando = pinta(nueve, { editarAlAbrir: true });
    const aviso = /<div[^>]*data-aviso-duplicado="true">[\s\S]*?<\/div>/.exec(editando)?.[0] ?? "";
    expect(aviso).toContain("⚠ Esto coincide con otra cuenta: ");
    // Una sola: la propia ficha (su empresa) no cuenta.
    expect([...aviso.matchAll(/data-coincidencia="/g)]).toHaveLength(1);
    expect(aviso).toMatch(new RegExp(`data-abre-coincidencia="${tres.id}">${tres.account}</button> \\(${nombreDeTienda(tres.store)}\\) — mismo teléfono / nombre parecido`));
    // El aviso va antes de las tarjetas, y «Guardar» todavía no pide nada.
    expect(editando.indexOf("data-aviso-duplicado")).toBeLessThan(editando.indexOf('data-grupo="cuenta"'));
    expect(editando).toMatch(/data-guardar-ficha="true">Guardar<\/button>/);
    expect(pinta(nueve)).not.toContain("data-aviso-duplicado");
    expect(pinta(null)).not.toContain("data-aviso-duplicado");
  });
});

// D-668 (193): los contactos en la tarjeta «Contacto», como las pastillas de tiendas.
describe("los contactos de la ficha (D-668)", () => {
  const contacto = (html: string) => tarjeta(html, "contacto");
  it("leyendo: una pastilla por contacto, tres a la vista y «+2» con los demás; el elegido con su teléfono (RingCentral) y su correo, cada uno con «📋»", () => {
    const html = contacto(pinta(dosTiendas));
    expect(html).toContain('data-contactos="5"');
    expect(html.match(/data-pastilla-de-contacto="\d"/g)).toEqual(['data-pastilla-de-contacto="0"', 'data-pastilla-de-contacto="1"', 'data-pastilla-de-contacto="2"']);
    expect(html).toMatch(/<button[^>]*role="tab" aria-selected="true"[^>]*data-pastilla-de-contacto="0">ANA DEMO<\/button>/);
    expect(html).toMatch(/data-mas-contactos="2">\+2 ▾<\/button>/);
    expect(html).toContain('href="rcapp://r/call?number=9565550101"');
    expect(html).toContain('href="mailto:ana@example.com"');
    expect(html).toContain('data-copiar="(956) 555-0101"');
    expect(html).toContain('data-copiar="ana@example.com"');
    // Solo el elegido: el teléfono de Luis (el 2.º) no se pinta hasta pulsar su pastilla.
    expect(html).not.toContain("555-0121");
  });
  it("el teléfono con su persona ya no va suelto arriba, junto a las tiendas («956-… Omar»)", () => {
    const html = pinta(dosTiendas);
    const arriba = html.slice(0, html.indexOf('data-grupo="cuenta"'));
    expect(arriba).not.toContain("tel:");
    expect(arriba).not.toContain("mailto:");
    expect(arriba).not.toContain("📞");
  });
  it("una fila con el contacto escrito junto en el teléfono sale separada: LUIS, A/P, y su número", () => {
    const html = contacto(pinta(CLIENTES_DEMO.find((c) => c.id === 4)!));
    expect(html).toContain('data-contactos="1"');
    expect(html).not.toContain("data-pastilla-de-contacto");
    expect(html).toMatch(/data-campo="contact_name"><span[^>]*>Nombre<\/span><span[^>]*>LUIS<\/span>/);
    expect(html).toMatch(/data-campo="contact_title"><span[^>]*>Cargo<\/span><span[^>]*>A\/P<\/span>/);
    expect(html).toContain('href="rcapp://r/call?number=9565550104"');
  });
  it("editando: cada contacto con su nombre, cargo, teléfonos, correos y nota; «+ Teléfono», «+ Correo» y «+ Agregar contacto»", () => {
    const html = contacto(pinta(dosTiendas, { editarAlAbrir: true }));
    expect(html.match(/data-contacto-editable="\d"/g)).toHaveLength(5);
    // D-708: en pestañas, uno a la vista; los demás en el árbol pero ocultos, y «+ Agregar contacto» al final de la tira.
    expect(html.match(/data-pestana-de-contacto="\d"/g)).toHaveLength(3);
    expect(html).toContain('data-mas-contactos-editando="2"');
    expect(html.match(/<fieldset hidden=""[^>]*data-contacto-editable/g)).toHaveLength(4);
    expect(html).toMatch(/<fieldset class="[^"]*" data-contacto-editable="0"/);
    expect(html.indexOf("data-agregar-contacto")).toBeGreaterThan(html.indexOf('data-mas-contactos-editando'));
    expect(html.indexOf("data-agregar-contacto")).toBeLessThan(html.indexOf('data-contacto-editable="0"'));
    const entrada = (k: string) => new RegExp(`<input[^>]*${k}[^>]*>`).exec(html)?.[0] ?? "";
    expect(entrada('data-telefono-de-contacto="0.1"')).toContain('value="(956) 555-0111"');
    expect(entrada('data-correo-de-contacto="0.1"')).toContain('value="pagos@example.com"');
    for (const k of ["data-agregar-telefono=\"0\"", "data-agregar-correo=\"0\"", "data-agregar-contacto", "data-quitar-contacto=\"4\"", "data-nota-de-contacto=\"1\""]) expect(html, k).toContain(k);
    // En un alta, un contacto en blanco para escribir.
    expect(contacto(pinta(null)).match(/data-contacto-editable="\d"/g)).toHaveLength(1);
  });
});
