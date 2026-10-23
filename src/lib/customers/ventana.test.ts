import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FichaEnVentana } from "@/app/customers/FichaDeCliente";
import { almacenDemo, CLIENTES_DEMO } from "./demo";
import { filasDeLaEmpresa } from "./empresas";
import { estadoLabel, nombreDeTienda, valorDeColumna, type Cliente } from "./reglas";

/**
 * D-NEXT (2026-10-23). El dueño: «cuando uno le da clic al cliente […] abre ese side window por al lado, y eso no me
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

// Una empresa en dos tiendas (la 1 y la 2 del demo) y una sola (la 3).
const dosTiendas = CLIENTES_DEMO.find((c) => c.id === 1)!;
const unaTienda = CLIENTES_DEMO.find((c) => c.id === 3)!;

describe("la ficha en una ventana centrada (D-NEXT)", () => {
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
  it("la ficha COMPLETA abajo, sin tarjeta «Cuenta» y sin «Cuenta» ni «Tienda» repetidas", () => {
    const html = pinta(dosTiendas);
    expect(grupos(html)).toEqual(["contacto", "credito", "estado", "vendedores", "otros"]);
    expect(html).not.toContain('data-campo="account"');
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
  it("«Otros» lleva Añadido (tanda), N.º House y Tienda + cuenta (CONCATENATE), con su valor, antes de las notas", () => {
    const otros = tarjeta(pinta(dosTiendas), "otros");
    const orden = ["added_batch", "house_no", "concatenate", "notes"].map((k) => otros.indexOf(`data-campo="${k}"`));
    for (const i of orden) expect(i).toBeGreaterThan(-1);
    expect(orden).toEqual([...orden].sort((a, b) => a - b));
    expect(otros).toContain("Añadido (tanda)");
    expect(otros).toContain("N.º House");
    expect(otros).toContain(`>${dosTiendas.house_no}<`);
    expect(otros).toContain(`>${valorDeColumna(dosTiendas, "concatenate")}<`);
    // Y en ninguna otra tarjeta.
    for (const g of ["contacto", "credito", "estado", "vendedores"]) {
      for (const k of ["added_batch", "house_no", "concatenate"]) expect(tarjeta(pinta(dosTiendas), g), `${g}/${k}`).not.toContain(`data-campo="${k}"`);
    }
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
    expect(tarjeta(editando, "otros")).toContain(`>${valorDeColumna(dosTiendas, "concatenate")}<`);
    // Y sin «Cuenta» ni «Tienda» en las tarjetas también editando.
    expect(editando).not.toContain('data-campo="account"');
    expect(editando).not.toContain('data-campo="store"');
  });
  it("quien no edita: solo lectura, sin «Editar» ni controles aunque llegue con editar", () => {
    const html = pinta(dosTiendas, { puedeEditar: false, editarAlAbrir: true });
    expect(html).toContain("Solo lectura");
    expect(html).not.toContain("data-editar-en-la-ventana");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("data-guardar-ficha");
  });
  it("un alta abre editando: el nombre y la tienda arriba, obligatorios", () => {
    const html = pinta(null);
    expect(html).toContain('placeholder="Nombre de la cuenta *"');
    expect(html).toContain("Tienda *");
    expect(html).toContain(">Crear<");
    expect(html).not.toContain('data-campo="house_no"');
  });
});
