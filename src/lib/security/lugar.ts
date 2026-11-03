/**
 * D-822: desde dónde llega una petición. La IP la pone el proxy de Vercel en `x-forwarded-for` (la primera es la del
 * cliente); el lugar lo deduce Vercel de esa IP y lo deja en `x-vercel-ip-city` / `-country-region` / `-country`
 * (la ciudad viene codificada como URL: «San%20Antonio»). No es GPS: es la ciudad de la conexión, que para «¿está en
 * la tienda o en su casa?» es lo que el dueño necesita. Sin cabeceras (local, pruebas) → nulos.
 */
export function lugarDeLaPeticion(h: { get(nombre: string): string | null }): { ip: string | null; lugar: string | null } {
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || null;
  const decodifica = (v: string | null) => { if (!v) return null; try { return decodeURIComponent(v); } catch { return v; } };
  const ciudad = decodifica(h.get("x-vercel-ip-city"));
  const region = decodifica(h.get("x-vercel-ip-country-region"));
  const pais = decodifica(h.get("x-vercel-ip-country"));
  const partes = [ciudad, region, pais].filter((x): x is string => !!x);
  return { ip, lugar: partes.length ? partes.join(", ") : null };
}

/**
 * D-822: «avísame si ellos quieren ingresar desde otro lado». Una entrada es «desde un sitio nuevo» cuando la pareja
 * persona-dispositivo nació hace poco Y esa persona ya tenía otro dispositivo antes: alguien que entra por primera
 * vez con su primer dispositivo no es una alarma; alguien que ya entraba desde la tienda y aparece en otro aparato, sí.
 */
export function entradasDesdeSitioNuevo<U extends { user_id: string; device_id: string; first_seen_at: string }>(
  usos: readonly U[], ahoraMs: number, dias = 7,
): U[] {
  const desde = ahoraMs - dias * 24 * 3600 * 1000;
  const primeraPorPersona = new Map<string, number>();
  for (const u of usos) {
    const t = Date.parse(u.first_seen_at);
    const p = primeraPorPersona.get(u.user_id);
    if (p === undefined || t < p) primeraPorPersona.set(u.user_id, t);
  }
  return usos.filter((u) => {
    const t = Date.parse(u.first_seen_at);
    return t >= desde && t > (primeraPorPersona.get(u.user_id) ?? t);
  });
}
