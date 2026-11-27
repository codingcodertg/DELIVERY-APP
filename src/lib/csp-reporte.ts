// ============================================================
// Reportes de violación del CSP (D-1206, auditoría 2026-11-27). El CSP completo del hub va en Report-Only desde la
// auditoría de seguridad, pero NO tenía `report-uri`: el navegador no mandaba las violaciones a ningún lado, así que
// nunca se podía saber si era seguro pasarlo a modo de cumplimiento. Ahora llegan a /api/csp-report y quedan en
// Administración → «Fallas de la app» (app «csp»), agrupadas por directiva + host bloqueado.
//
// Puro: aquí solo se lee el cuerpo (los dos formatos que mandan los navegadores) y se arma el texto.
// ============================================================

/** Lo que importa de una violación. */
export type ViolacionCsp = { directiva: string; bloqueado: string; pagina: string };

/** Tamaño máximo del cuerpo que se acepta (un reporte real pesa ~1 KB). */
export const MAX_CUERPO_CSP = 16_000;

const texto = (v: unknown) => (typeof v === "string" ? v : "");

/** El host (o la palabra clave: inline, eval, data, blob) de lo bloqueado, sin rutas ni query (nada personal). */
export function soloHost(uri: string): string {
  const u = uri.trim();
  if (!u) return "desconocido";
  if (/^(inline|eval|wasm-eval|trusted-types-policy|trusted-types-sink)$/i.test(u)) return u.toLowerCase();
  if (/^(data|blob|about|chrome-extension|moz-extension|safari-extension)\b/i.test(u)) return u.split(":")[0].toLowerCase() + ":";
  try {
    return new URL(u).host || u.slice(0, 60);
  } catch {
    return u.slice(0, 60);
  }
}

/** Solo la ruta de la página (sin query ni hash), para saber dónde pasó sin guardar ids de URL con datos. */
export function soloRuta(uri: string): string {
  try {
    return new URL(uri).pathname.slice(0, 200) || "/";
  } catch {
    return "/";
  }
}

/** Saca las violaciones del cuerpo: formato viejo `{ "csp-report": {...} }` o Reporting API `[{ type, body }]`. */
export function violacionesDelCuerpo(cuerpo: unknown): ViolacionCsp[] {
  const crudos: Record<string, unknown>[] = [];
  if (Array.isArray(cuerpo)) {
    for (const r of cuerpo) {
      if (r && typeof r === "object" && (r as { type?: unknown }).type === "csp-violation" && (r as { body?: unknown }).body && typeof (r as { body: unknown }).body === "object") {
        crudos.push((r as { body: Record<string, unknown> }).body);
      }
    }
  } else if (cuerpo && typeof cuerpo === "object" && (cuerpo as Record<string, unknown>)["csp-report"]) {
    const r = (cuerpo as Record<string, unknown>)["csp-report"];
    if (r && typeof r === "object") crudos.push(r as Record<string, unknown>);
  }
  return crudos.slice(0, 20).map((r) => {
    const directiva = (texto(r["effective-directive"]) || texto(r.effectiveDirective) || texto(r["violated-directive"]) || texto(r.violatedDirective)).split(" ")[0] || "desconocida";
    const bloqueado = soloHost(texto(r["blocked-uri"]) || texto(r.blockedURL) || texto(r.blockedURI));
    const pagina = soloRuta(texto(r["document-uri"]) || texto(r.documentURL) || texto(r.documentURI));
    return { directiva: directiva.slice(0, 60), bloqueado, pagina };
  });
}

/** El mensaje que queda en «Fallas de la app». Misma directiva + host = misma falla (se cuentan las veces). */
export function mensajeDeViolacion(v: ViolacionCsp): string {
  return `CSP (solo reporte): ${v.directiva} bloquearía ${v.bloqueado}`;
}
