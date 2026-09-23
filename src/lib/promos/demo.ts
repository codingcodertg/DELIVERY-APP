import type { DecisionDeGrupo, ProductoDeCatalogo } from "./tabla";

/**
 * Datos de RTG PROMOS para el **modo demo**, todos inventados aquí.
 *
 * Existen por una razón concreta: la queja del dueño fue **visual** —«it's horrible, first it
 * doesn't fit in 1 screen»— y una queja visual no se puede comprobar leyendo código. El modo demo
 * no tiene base, así que `/promos` no tenía nada que enseñar y no se podía mirar en un navegador.
 *
 * **Ni un dato del dueño.** Ni códigos de producto, ni nombres de tienda, ni proveedores, ni
 * precios reales. Lo que sí se copia es la **forma**, que es lo que hace que mirarlo sirva de algo:
 * seis claves de existencias por tienda —las mismas seis que trae su libro, así que la tabla se ve
 * igual de ancha—, descripciones largas de las que cortan, costos con toda su precisión de coma
 * flotante, y productos sin costo ni precio, como los de la hoja suelta.
 */

const GRUPOS_DEMO = ["NORTE", "SUR", "ESTE", "OESTE", "CENTRO"] as const;

/** Las seis columnas de existencias: el mismo número que el libro real, con nombres inventados. */
const TIENDAS_DEMO = ["N1", "N2", "S1", "S2", "E1", "O1"] as const;

export const RONDAS_DEMO = [
  { id: "demo-ronda-1", label: "Promoción de muestra", source_name: "muestra.xlsx", uploaded_at: "2026-09-20T15:00:00.000Z", closed_at: null },
  { id: "demo-ronda-0", label: "Promoción anterior (cerrada)", source_name: "anterior.xlsx", uploaded_at: "2026-08-14T15:00:00.000Z", closed_at: "2026-08-30T17:00:00.000Z" },
];

/** Las tiendas de demo, con su grupo, como si un admin las hubiera cruzado en Datos. */
export const TIENDAS_CON_GRUPO_DEMO = [
  { name: "Tienda Uno", address: "", promo_group: "NORTE" },
  { name: "Tienda Dos", address: "", promo_group: "SUR" },
  { name: "Tienda Tres", address: "", promo_group: "ESTE" },
  // Dos tiendas en un grupo: el caso de las que DECIDEN JUNTAS pero tienen existencias aparte.
  { name: "Tienda Cuatro", address: "", promo_group: "OESTE" },
  { name: "Tienda Cinco", address: "", promo_group: "OESTE" },
  { name: "Tienda Seis", address: "", promo_group: "CENTRO" },
];

const DESCRIPCIONES = [
  "PIEDRA CLARA MATE 24X48 15.5 SF",
  "MADERA NOGAL BRILLO 8X48 17.33 SF — descripción larga para ver dónde corta la celda",
  "MARMOL GRIS SUAVE (M) 24X24 15.5 SF",
  "CENEFA DECORATIVA 3X6",
  "PORCELANATO BLANCO PULIDO 60X60 21.5 SF",
  "MOSAICO HEXAGONAL NEGRO 12X12",
  "TRIM ALUMINIO MATE 8 FT",
  "PIEDRA ARENA TEXTURA (P) 16X48 15.5 SF",
  "MADERA ROBLE CLARO 8X48 12.91 SF",
  "PORCELANATO BEIGE MATE 24X48 15.5 SF",
  "LISTELO METALICO PLATA 1.11 SF",
  "PIEDRA VOLCANICA GRIS 10X30 18.08 SF",
];

const PROVEEDORES = ["PROVEEDOR UNO, S.A.", "PROVEEDOR DOS", "PROVEEDOR TRES, LLC"];
const TAMANOS = ["24X48", "8X48", "24X24", "3X6", "60X60", "12X12"];

/**
 * Doce productos, con las trampas del libro real: los dos últimos **sin costo ni precio** (la hoja
 * suelta trae nueve así) y costos con toda su precisión, para ver que la tabla los redondea.
 */
export const PRODUCTOS_DEMO: ProductoDeCatalogo[] = DESCRIPCIONES.map((description, i) => {
  const sinPrecio = i >= 10;
  const qohPorTienda: Record<string, number | null> = {};
  TIENDAS_DEMO.forEach((t, j) => { qohPorTienda[t] = (i * 37 + j * 91) % 900; });
  return {
    round_id: "demo-ronda-1",
    code: `DEM${String(1000 + i * 7)}`,
    supplier: PROVEEDORES[i % PROVEEDORES.length],
    size: TAMANOS[i % TAMANOS.length],
    description,
    qoh: Object.values(qohPorTienda).reduce((n: number, v) => n + (v ?? 0), 0),
    qoh_by_store: qohPorTienda,
    price: sinPrecio ? null : Number((1.09 + i * 0.1).toFixed(2)),
    source_sheet: sinPrecio ? "otra" : "TODO",
    row_no: i + 3,
    private: {
      notes: i % 4 === 0 ? "REVISAR" : i % 4 === 1 ? "DISTRIBUIR" : null,
      demand: Number(((i + 1) * 13.7).toFixed(4)),
      months_of_stock: Number(((i + 2) * 1.93).toFixed(6)),
      // Con toda su precisión, como llega de la base: la tabla tiene que enseñarlo redondeado.
      cost: sinPrecio ? null : 0.7948008849557523 + i * 0.13,
      diff: sinPrecio ? null : 0.2951991150442478 + i * 0.01,
    },
  };
});

/** Unas cuantas decididas, para que se vea la mezcla de estados y una nota. */
export const DECISIONES_DEMO: DecisionDeGrupo[] = [
  { round_id: "demo-ronda-1", code: PRODUCTOS_DEMO[0].code, group_code: "NORTE", status: "approved", note: null },
  { round_id: "demo-ronda-1", code: PRODUCTOS_DEMO[1].code, group_code: "NORTE", status: "rejected", note: "descontinuado" },
  { round_id: "demo-ronda-1", code: PRODUCTOS_DEMO[2].code, group_code: "NORTE", status: "approved", note: "solo mientras dure" },
  { round_id: "demo-ronda-1", code: PRODUCTOS_DEMO[0].code, group_code: "SUR", status: "rejected", note: null },
];

export const GRUPOS_DEMO_LISTA: string[] = [...GRUPOS_DEMO];
