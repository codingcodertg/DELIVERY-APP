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
 *
 * **Quién ve cada grupo NO se decide aquí.** «Remote» solo para manager y admin, «Sin tienda»
 * solo para admin: eso lo filtra `public.phone_book()` en la base (111), y a esta pantalla
 * solo le llegan las filas que ya se pueden ver. Aquí se agrupan y se ordenan, nada más.
 */

/**
 * Una fila tal como la devuelve `public.phone_book()`. La definición vigente es la de la
 * migración **111**: cada una redefine la función entera, así que la última que la toca es la
 * que manda. La 108 la creó, la 109 le puso la tienda del expediente, la 110 dejó fuera a quien
 * no tiene ningún dato de contacto, y la 111 deja solo a quien tiene extensión, añade los grupos
 * y el código de tienda.
 */
export type PersonaDirectorio = {
  full_name: string;
  title: string | null;
  /** El código de su tienda en Ajustes, o el nombre si no tiene código. Null en una fila de grupo. */
  store: string | null;
  /** El puesto de su tienda en el orden de Ajustes. Null = tienda desconocida o fila de grupo. */
  store_rank: number | null;
  department: string | null;
  phone: string | null;
  ringcentral_ext: string | null;
  email: string | null;
  /** Null = va por su tienda. Si no, el grupo que no es una tienda (111). */
  directory_group: "remote" | "sin_tienda" | null;
};

export type TipoGrupo = "tienda" | "remote" | "sin_tienda";

/**
 * Un grupo del primer nivel. `clave` es lo que lo identifica, y no es el nombre de la tienda
 * a propósito: las claves de grupo llevan un prefijo, así que una tienda cuyo código fuera
 * justo «remote» no se mezcla con el grupo Remote.
 */
export type GrupoTienda = { clave: string; tipo: TipoGrupo; tienda: string | null; personas: number };
export type GrupoDepartamento = { departamento: string | null; personas: number };

/** Sin acentos y en minúsculas: quien busca "nunez" tiene que encontrar a "Núñez". */
export function normaliza(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

const vacio = (s: string | null | undefined) => !s || !s.trim();

export const CLAVE_REMOTE = "grupo:remote";
export const CLAVE_SIN_TIENDA = "grupo:sin_tienda";
export const claveTienda = (tienda: string) => `tienda:${tienda}`;

/**
 * El grupo de una fila. El grupo marcado va PRIMERO: la base manda las filas de grupo sin
 * tienda, así que mirar antes la tienda vacía mandaría a todo Remote a «Sin tienda».
 *
 * Una fila sin grupo y sin tienda no debería llegar (la 111 la clasifica como «Sin tienda»),
 * pero si llega va ahí mismo y no desaparece.
 */
export function grupoDe(f: PersonaDirectorio): Omit<GrupoTienda, "personas"> {
  if (f.directory_group === "remote") return { clave: CLAVE_REMOTE, tipo: "remote", tienda: null };
  if (f.directory_group === "sin_tienda" || vacio(f.store)) {
    return { clave: CLAVE_SIN_TIENDA, tipo: "sin_tienda", tienda: null };
  }
  return { clave: claveTienda(f.store as string), tipo: "tienda", tienda: f.store };
}

/**
 * El primer nivel: las tiendas en el orden de Ajustes, luego «Remote», y «Sin tienda» al final.
 *
 * El orden lo pone `store_rank`, que viene de la posición en Ajustes; una tienda que ya no
 * está en esa lista llega sin rango y **no desaparece**: cae detrás de las que sí lo tienen,
 * en su propio grupo. Es la misma regla que D-247 fijó para «Switch usuario», y por la misma
 * razón: la gente no puede evaporarse de una lista porque alguien editó Ajustes.
 *
 * Las tiendas que comparten código ya llegan fundidas de la base (mismo `store`, el menor
 * rango); aquí se agrupan por ese valor y se toma el menor rango que aparezca.
 */
export function tiendasDelDirectorio(filas: PersonaDirectorio[]): GrupoTienda[] {
  const grupos = new Map<string, GrupoTienda>();
  const rango = new Map<string, number>();
  for (const f of filas) {
    const g = grupoDe(f);
    const previo = grupos.get(g.clave);
    grupos.set(g.clave, { ...g, personas: (previo?.personas ?? 0) + 1 });
    if (g.tipo === "tienda" && f.store_rank != null) {
      const r = rango.get(g.clave);
      if (r == null || f.store_rank < r) rango.set(g.clave, f.store_rank);
    }
  }
  const puesto: Record<TipoGrupo, number> = { tienda: 0, remote: 1, sin_tienda: 2 };
  return [...grupos.values()].sort((a, b) => {
    if (a.tipo !== b.tipo) return puesto[a.tipo] - puesto[b.tipo];
    if (a.tipo !== "tienda") return 0;
    const ra = rango.get(a.clave);
    const rb = rango.get(b.clave);
    if (ra != null && rb != null && ra !== rb) return ra - rb;
    // Una tienda sin rango (borrada de Ajustes) va detrás de las que sí lo tienen.
    if (ra != null && rb == null) return -1;
    if (ra == null && rb != null) return 1;
    return (a.tienda as string).localeCompare(b.tienda as string);
  });
}

function personasDelGrupo(filas: PersonaDirectorio[], clave: string): PersonaDirectorio[] {
  return filas.filter((f) => grupoDe(f).clave === clave);
}

/** Los departamentos de un grupo, alfabéticos y con «sin departamento» al final. */
export function departamentosDe(filas: PersonaDirectorio[], clave: string): GrupoDepartamento[] {
  const cuenta = new Map<string | null, number>();
  for (const f of personasDelGrupo(filas, clave)) {
    const d = vacio(f.department) ? null : (f.department as string);
    cuenta.set(d, (cuenta.get(d) ?? 0) + 1);
  }
  return [...cuenta.entries()]
    .map(([departamento, personas]) => ({ departamento, personas }))
    .sort((a, b) => {
      if (a.departamento === null) return 1;
      if (b.departamento === null) return -1;
      return a.departamento.localeCompare(b.departamento);
    });
}

/**
 * ¿Se salta el nivel de departamento? Sí cuando su única opción sería «Sin departamento».
 *
 * Un nivel con una sola fila que no dice nada es un clic que no decide nada: «Remote → Sin
 * departamento» era exactamente eso. La regla no es «Remote se salta el nivel», es «un nivel
 * vacío se salta», así que vale igual para «Sin tienda» o para una tienda donde nadie tiene
 * departamento; y en cuanto alguien de Remote tenga uno, el nivel vuelve solo.
 */
export function saltaDepartamentos(filas: PersonaDirectorio[], clave: string): boolean {
  const ds = departamentosDe(filas, clave);
  return ds.length === 1 && ds[0].departamento === null;
}

/** Las personas de un grupo y un departamento, por nombre. */
export function personasDe(
  filas: PersonaDirectorio[],
  clave: string,
  departamento: string | null,
): PersonaDirectorio[] {
  return personasDelGrupo(filas, clave)
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
