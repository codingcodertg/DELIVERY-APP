import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FichaEnVentana } from "@/app/customers/FichaDeCliente";
import { almacenDemo, CLIENTES_DEMO } from "./demo";
import { TIENDAS } from "./reglas";

/**
 * D-797: quien pide el alta (vendedor, gerente: `altaComoSolicitud`) no elige tienda, va la suya (D-767). El dueño, con
 * captura del alta como Roberto Contreras: «quita esto de las stores porque ya automáticamente se va a poner la store de
 * él, no need to see that». El admin sigue eligiendo; y sin tienda en el perfil, las casillas vuelven a salir.
 */
const t = (_en: string, es: string) => es;
const alta = (o: { altaComoSolicitud?: boolean; miTienda?: string | null }) =>
  renderToStaticMarkup(createElement(FichaEnVentana, {
    cliente: null, hermanas: [], lista: CLIENTES_DEMO,
    onCambia: () => {}, onClose: () => {}, onGuardado: () => {},
    puedeEditar: true, almacen: almacenDemo(), t,
    altaComoSolicitud: o.altaComoSolicitud ?? false,
    miTienda: o.miTienda === undefined ? TIENDAS[0].nombre : o.miTienda,
  }));

describe("el alta sin casillas de tienda para quien pide", () => {
  it("vendedor con tienda: sin casillas; el admin las sigue viendo", () => {
    expect(alta({ altaComoSolicitud: true })).not.toContain("data-tiendas-del-alta");
    expect(alta({ altaComoSolicitud: false })).toContain("data-tiendas-del-alta");
  });
  it("vendedor SIN tienda en el perfil: las casillas vuelven, que si no no podría crear nada", () => {
    expect(alta({ altaComoSolicitud: true, miTienda: null })).toContain("data-tiendas-del-alta");
  });
});
