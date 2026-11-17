// ============================================================
// La IP del cliente, sin depender de Next ni de `Request` (lo comparten el limitador y el monitoreo de seguridad).
// Vive aparte de `rate-limit.ts` para que `seguridad/registro.ts` pueda usarla sin crear un ciclo de imports.
// ============================================================

/**
 * La IP del cliente. D-1070: la que pone Vercel y el cliente no puede falsear (`x-vercel-forwarded-for`, luego
 * `x-real-ip`); el PRIMER salto de `x-forwarded-for` lo escribe el cliente, así que cambiándolo se saltaba cualquier
 * límite. Si solo hay x-forwarded-for, se toma el ÚLTIMO salto (el que añadió el proxy).
 */
export function ipDeCabeceras(h: { get(nombre: string): string | null }): string {
  const vercel = h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) return vercel;
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = h.get("x-forwarded-for");
  const ultimo = xff?.split(",").map((x) => x.trim()).filter(Boolean).pop();
  return ultimo || "ip-desconocida";
}

export function ipDe(req: Request): string {
  return ipDeCabeceras(req.headers);
}
