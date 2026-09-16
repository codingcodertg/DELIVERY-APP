/**
 * El directorio de la compañía: la cascada, y quién sale en cada nivel (D-256).
 *
 * El dueño lo pidió con la navegación por delante: **tienda → departamento → personas →
 * la persona**, y dijo por qué — que sea «un poquito más difícil que solo buscar». Así que
 * eso no es una decisión de pantalla que se pueda simplificar más tarde: es el encargo.
 *
 * Aquí vive el orden y el agrupado, sin React y sin Supabase, por lo de siempre: lo que
 * decide qué ve la gente se prueba con datos, no abriendo el navegador.
 *
 * **Y el buscador salta la cascada**, que es lo que la hace soportable: quien ya sabe el
 * nombre escribe y lo tiene, y quien no, baja por tiendas.
 */

/**
 * Una fila tal como la devuelve `public.phone_book()`. La definición vigente es la de la
 * migración **110**: cada una redefine la función entera, así que la última que la toca es la
 * que manda. La 108 la creó, la 109 le puso la tienda del expediente y la 110 dejó fuera a
 * quien no tiene ningún dato de contacto.
 */
export type PersonaDirectorio = {
  full_name: string;
  title: string | null;
  store: string | null;
  /** El puesto de su tienda en el orden de Ajustes. Null = tienda desconocida o sin tienda. */
  store_rank: number | null;
  department: string | null;
  phone: string | null;
  ringcentral_ext: string | null;
  email: string | null;
};

export type GrupoTienda = { tienda: string | null; personas: number };
export type GrupoDepartamento = { departamento: string | null; personas: number };

/** Sin acentos y en minúsculas: quien busca "nunez" tiene que encontrar a "Núñez". */
export function normaliza(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const vacio = (s: string | null | undefined) => !s || !s.trim();

/**
 * Las tiendas, en el orden de Ajustes y con «sin tienda» al final.
 *
 * El orden lo pone `store_rank`, que viene de la posición en Ajustes; una tienda que ya no
 * está en esa lista llega sin rango y **no desaparece**: cae al final junto a quien no tiene
 * tienda, en su propio grupo. Es la misma regla que D-247 fijó para «Switch usuario», y por
 * la misma razón: la gente no puede evaporarse de una lista porque alguien editó Ajustes.
 */
export function tiendasDelDirectorio(filas: PersonaDirectorio[]): GrupoTienda[] {
  const cuenta = new Map<string | null, number>();
  const rango = new Map<string | null, number>();
  for (const f of filas) {
    const clave = vacio(f.store) ? null : (f.store as string);
    cuenta.set(clave, (cuenta.get(clave) ?? 0) + 1);
    if (clave !== null && f.store_rank != null) {
      const previo = rango.get(clave);
      if (previo == null || f.store_rank < previo) rango.set(clave, f.store_rank);
    }
  }
  return [...cuenta.entries()]
    .map(([tienda, personas]) => ({ tienda, personas }))
    .sort((a, b) => {
      if (a.tienda === null) return 1;
      if (b.tienda === null) return -1;
      const ra = rango.get(a.tienda);
      const rb = rango.get(b.tienda);
      if (ra != null && rb != null && ra !== rb) return ra - rb;
      // Una tienda sin rango (borrada de Ajustes) va detrás de las que sí lo tienen.
      if (ra != null && rb == null) return -1;
      if (ra == null && rb != null) return 1;
      return a.tienda.localeCompare(b.tienda);
    });
}

/** Los departamentos de una tienda, alfabéticos y con «sin departamento» al final. */
export function departamentosDe(filas: PersonaDirectorio[], tienda: string | null): GrupoDepartamento[] {
  const cuenta = new Map<string | null, number>();
  for (const f of personasDeTienda(filas, tienda)) {
    const clave = vacio(f.department) ? null : (f.department as string);
    cuenta.set(clave, (cuenta.get(clave) ?? 0) + 1);
  }
  return [...cuenta.entries()]
    .map(([departamento, personas]) => ({ departamento, personas }))
    .sort((a, b) => {
      if (a.departamento === null) return 1;
      if (b.departamento === null) return -1;
      return a.departamento.localeCompare(b.departamento);
    });
}

function personasDeTienda(filas: PersonaDirectorio[], tienda: string | null): PersonaDirectorio[] {
  return filas.filter((f) => (vacio(f.store) ? null : f.store) === tienda);
}

/** Las personas de una tienda y un departamento, por nombre. */
export function personasDe(
  filas: PersonaDirectorio[],
  tienda: string | null,
  departamento: string | null,
): PersonaDirectorio[] {
  return personasDeTienda(filas, tienda)
    .filter((f) => (vacio(f.department) ? null : f.department) === departamento)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

/**
 * El buscador, que salta la cascada. Busca **por nombre**, que es lo que se pidió.
 *
 * Sin texto devuelve la lista vacía y no la entera: aquí «nada escrito» significa «sigo
 * navegando por tiendas», no «enséñamelo todo de golpe» — eso último sería precisamente el
 * directorio plano que el dueño no quiso.
 */
export function buscaPersonas(filas: PersonaDirectorio[], filtro: string): PersonaDirectorio[] {
  const q = normaliza(filtro);
  if (!q) return [];
  return filas
    .filter((f) => normaliza(f.full_name).includes(q))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

/**
 * El enlace de llamar. En un móvil marca; en un escritorio lo recoge la app que haya.
 *
 * Se quitan espacios, guiones y paréntesis porque `tel:` no los necesita y algunos marcadores
 * se atragantan con ellos; el `+` inicial se conserva, que es lo único que distingue un
 * número internacional. Sin teléfono devuelve null y la tarjeta no pinta enlace: un `tel:`
 * vacío es un botón que no hace nada.
 */
export function telHref(phone: string | null | undefined): string | null {
  if (vacio(phone)) return null;
  const limpio = (phone as string).trim().replace(/[^\d+]/g, "");
  const nucleo = limpio.startsWith("+") ? "+" + limpio.slice(1).replace(/\+/g, "") : limpio.replace(/\+/g, "");
  return /\d/.test(nucleo) ? `tel:${nucleo}` : null;
}

/** El enlace de escribir. Mismo criterio: sin correo, sin enlace. */
export function mailtoHref(email: string | null | undefined): string | null {
  if (vacio(email)) return null;
  const limpio = (email as string).trim();
  return limpio.includes("@") ? `mailto:${limpio}` : null;
}
