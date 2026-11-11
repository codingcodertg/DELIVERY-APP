import { NextResponse } from "next/server";

/**
 * Error de una ruta `/api` para el cliente, SIN filtrar el detalle de la base (D-969, revisión de seguridad). El
 * `error.message` de Supabase trae nombres de columnas/constraints y detalle interno: se registra en el SERVIDOR
 * (`console.error`, lo ve quien lee los logs) y al cliente le llega solo un mensaje genérico. Se conserva el campo
 * `error` que el cliente ya lee; solo deja de ser el texto crudo de la base.
 */
export function errorAlCliente(
  etiqueta: string,
  detalle: unknown,
  status = 500,
  mensaje = "Something went wrong. Please try again.",
): NextResponse {
  const texto = detalle instanceof Error ? detalle.message : typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.error(`[${etiqueta}]`, texto);
  return NextResponse.json({ error: mensaje }, { status });
}
