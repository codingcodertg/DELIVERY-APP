// ============================================================
// Quién tomó cada foto de una orden (`photo_meta`), en un solo sitio (D-527).
//
// Vivía dentro de `updateDelivery` (data-provider): toda foto que se subía pasaba por esa escritura y allí se firmaba.
// Desde D-527 las fotos que el chofer toma al pulsar «Entregado» viajan en la MISMA escritura que la entrega
// (`setStage(…, "delivered", …, { photos, photo_meta })`) —el guard le deja al chofer cambiar columnas al pasar de
// `picked_up` a `delivered`, y NO tocar las fotos sin cambiar de etapa (157)—, así que la firma tiene que poder hacerse
// también ahí. Una regla, dos llamadas: no pueden firmar distinto.
//
// Puro: sin React, sin red.
// ============================================================

export type AutoresDeFotos = Record<string, { by: string; at: string }>;

/**
 * El `photo_meta` de una lista de fotos: las que ya tenían autor lo conservan; las nuevas, quien escribe y ahora. Por
 * URL, así que quitar una foto quita su entrada y las demás no cambian.
 */
export function autoresDeFotos(
  fotos: readonly string[],
  antes: AutoresDeFotos | null | undefined,
  quien: string,
  ahora: string,
): AutoresDeFotos {
  const previo = antes ?? {};
  const meta: AutoresDeFotos = {};
  for (const url of fotos) meta[url] = previo[url] ?? { by: quien, at: ahora };
  return meta;
}

/** Las fotos de la orden más las que se tomaron al entregar, sin repetir ninguna. */
export function fotosAlEntregar(deLaOrden: readonly string[] | null | undefined, nuevas: readonly string[]): string[] {
  const todas = [...(deLaOrden ?? [])];
  for (const f of nuevas) if (!todas.includes(f)) todas.push(f);
  return todas;
}
