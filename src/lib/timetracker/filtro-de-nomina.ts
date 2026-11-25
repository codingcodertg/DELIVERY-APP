/**
 * Los filtros de Nómina con varias opciones (2026-11-25): tienda y empleado aceptan una lista separada por comas en la URL
 * (`?tienda=a,b&empleado=x,y`). Un solo valor sigue valiendo. Lógica pura: sin base, sin React.
 */

/** Un id válido: letras, cifras, guion y guion bajo; hasta 64 caracteres. Lo demás no entra en la consulta ni en la pantalla. */
const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

/** Topes por defecto: tiendas (de sobra para la empresa) y empleados (la plantilla entera). */
export const MAX_TIENDAS_EN_URL = 50;
export const MAX_EMPLEADOS_EN_URL = 200;

/**
 * Lee `?tienda=` o `?empleado=` (una lista separada por comas) y devuelve los ids válidos, sin repetir y en su orden.
 * - `raw` vacío o que no es texto → []. Los huecos («a,,b») se descartan; los espacios se quitan.
 * - Un valor con caracteres raros se descarta (no se busca ni se pinta). El resto se corta al tope `maximo`.
 * - `permitidos` (opcional): si viene, solo se queda lo que está dentro (quien no ve una tienda no la puede abrir por la URL).
 */
export function parseaListaDeNomina(
  raw: string | null | undefined,
  maximo: number,
  permitidos?: ReadonlySet<string>,
): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const trozo of raw.split(",")) {
    const id = trozo.trim();
    if (!ID_VALIDO.test(id)) continue;
    if (permitidos && !permitidos.has(id)) continue;
    if (vistos.has(id)) continue;
    vistos.add(id);
    salida.push(id);
    if (salida.length >= maximo) break;
  }
  return salida;
}

/**
 * ¿Entra la persona con los filtros? Sin tiendas elegidas, todas las tiendas; sin empleados elegidos, todos.
 * Las dos condiciones se cumplen a la vez: tienda Y empleado.
 */
export function pasaFiltroDeNomina(
  persona: { id: string; store: string | null | undefined },
  tiendas: readonly string[],
  empleados: readonly string[],
  // 2026-11-25 (350): las tiendas en las que fichó la persona en el periodo (ids). Quien va en varias tiendas pasa si
  // ALGUNA de ellas está elegida; su tienda de perfil sigue valiendo. Sin este argumento, igual que antes.
  tiendasTrabajadas: readonly string[] = [],
): boolean {
  const enTienda = tiendas.length === 0
    || (persona.store != null && tiendas.includes(persona.store))
    || tiendasTrabajadas.some((t) => tiendas.includes(t));
  const enEmpleado = empleados.length === 0 || empleados.includes(persona.id);
  return enTienda && enEmpleado;
}

/** La lista como va en la URL: separada por comas, sin repetir ni valores raros. Vacía = sin parámetro. */
export function listaParaUrl(valores: readonly string[]): string | null {
  const limpia = parseaListaDeNomina(valores.join(","), Number.MAX_SAFE_INTEGER);
  return limpia.length ? limpia.join(",") : null;
}
