// ============================================================
// Corte de mediodía de ventas — HISTÓRICO. La regla viva de "mismo día" (por defecto mañana, y preguntar al poner hoy a
// todo el que no asigna) vive ahora en `@/lib/same-day`, y REEMPLAZÓ a este corte de las 12 de D-845.
//
// MIGRACIÓN 237 (`237_corte_mediodia_ventas.sql`, el disparador que BLOQUEABA en la base): EN ESPERA por decisión del
// dueño. NO se aplica hasta que él lo diga. No se edita tampoco: su checksum está congelado en el libro de migraciones.
// Su mensaje de error es `MENSAJE_DE_LA_237`, que no sale en ninguna pantalla.
// ============================================================

/** El mensaje con el que BLOQUEA la migración 237 (en espera, sin aplicar). Solo para que la prueba lo compare con el .sql. */
export const MENSAJE_DE_LA_237 = {
  en: "After 12:00 noon, sales orders start tomorrow. Pick tomorrow or a later day.",
  es: "Después de las 12:00 del mediodía, las órdenes de ventas son para mañana. Elige mañana o un día posterior.",
} as const;
