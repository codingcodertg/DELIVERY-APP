/**
 * App Draft: la lista de prototipos («drafts»). Cada draft nuevo es UNA entrada aquí más su carpeta en
 * `src/app/app-draft/<ruta>`. `listo: false` lo enseña como «próximamente» sin enlace.
 */
export interface Draft {
  ruta: string;
  emoji: string;
  nombre_en: string;
  nombre_es: string;
  desc_en: string;
  desc_es: string;
  listo: boolean;
}

export const DRAFTS: readonly Draft[] = [
  {
    ruta: "quickbooks-online",
    emoji: "📒",
    nombre_en: "QuickBooks Online",
    nombre_es: "QuickBooks Online",
    desc_en: "Bookkeeping the hub lacks today: invoices and payments (A/R), vendor bills (A/P), credit memos, purchasing, bank reconciliation and reports.",
    desc_es: "La contabilidad que el hub no tiene hoy: facturas y cobros (por cobrar), facturas de proveedores (por pagar), notas de crédito, compras, conciliación bancaria e informes.",
    listo: true,
  },
  {
    ruta: "comp-floor",
    emoji: "🧩",
    nombre_en: "Comp Floor",
    nombre_es: "Comp Floor",
    desc_en: "Flooring-distributor tools on sample data, with far fewer fields: stock by lot and shade, boxes ↔ sq ft, quotes → orders with backorders, counter sales on account, special orders, price levels, bins and transfers, remnants and QR shelf labels.",
    desc_es: "Herramientas de distribuidor de piso con datos de ejemplo y muchos menos campos: stock por lote y tono, cajas ↔ pies², cotizaciones → pedidos con backorder, mostrador a cuenta, pedidos especiales, niveles de precio, bins y traslados, remanentes y etiquetas QR.",
    listo: true,
  },
  {
    ruta: "quickbooks-desktop",
    emoji: "🖥️",
    nombre_en: "QuickBooks Desktop",
    nombre_es: "QuickBooks Desktop",
    desc_en: "What the desktop edition adds: stock across stores with transfers, bins, lots and expiration, box/sq ft units, sales orders with backorders and pick-pack-ship, kits, price rules, freight and alternate vendors.",
    desc_es: "Lo que agrega la versión de escritorio: existencia entre tiendas con traspasos, ubicaciones, lotes y caducidad, unidades caja/ft², órdenes de venta con pendientes y surtir-empacar-enviar, kits, reglas de precio, flete y proveedores alternos.",
    listo: true,
  },
];
