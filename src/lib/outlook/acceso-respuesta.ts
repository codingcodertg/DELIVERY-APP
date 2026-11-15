import { NextResponse } from "next/server";
import type { AccesoOutlook } from "./acceso";

/** La respuesta JSON de una ruta de Outlook cuando la persona no es admin o no tiene sesión. */
export function respuestaSinAcceso(a: Extract<AccesoOutlook, { ok: false }>): NextResponse {
  if (a.codigo === "sin-sesion") return NextResponse.json({ error: "Tu sesión caducó." }, { status: 401 });
  if (a.codigo === "no-admin") return NextResponse.json({ error: "Solo un administrador puede hacer esto." }, { status: 403 });
  return NextResponse.json({ error: "No se pudo comprobar tu acceso." }, { status: 503 });
}
