"use client";

/** El botón de imprimir la hoja de aprobación (D-NEXT, 270): `window.print()`; el CSS de impresión deja solo la hoja. */
export function BotonImprimir({ etiqueta }: { etiqueta: string }) {
  return <button type="button" className="btn btn-primary" onClick={() => window.print()} data-accion="imprimir">🖨 {etiqueta}</button>;
}
