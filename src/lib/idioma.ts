/**
 * El idioma es uno solo, y sigue a la persona (D-266).
 *
 * Hasta ahora había tres, independientes, y D-122 lo dejó escrito como «decisión aparte»:
 *   · hub, Entregas, RR. HH. y ERP → `localStorage` `rtg_prefs.lang`, por equipo;
 *   · Time Tracker → `localStorage` `tt_lang`, por equipo (D-206);
 *   · avisos de fichaje → `clockin.employee_settings.language`, por persona, en la base (D-106).
 *
 * Ahora la fuente es **`public.profiles.language`**, por persona (migración 112). Las dos claves
 * de `localStorage` se quedan como caché, para pintar antes de que responda la red, y la vista
 * `clockin.profiles` lee primero la columna nueva, así que los avisos también la siguen.
 *
 * Aquí vive lo que se decide sin red, para poder probarlo con datos.
 */

export type Idioma = "en" | "es";

export const esIdioma = (v: unknown): v is Idioma => v === "en" || v === "es";

/** La caché de Time Tracker. La escribe el proveedor del hub; Time Tracker la lee al arrancar. */
export const CLAVE_TT = "tt_lang";

/** Aviso en la ventana cuando cambia el idioma, para que Time Tracker lo siga sin recargar. */
export const EVENTO_IDIOMA = "rtg:idioma";

/**
 * Qué idioma usar al cargar, y si hay que guardarlo en la base por primera vez.
 *
 * **La regla, para que nadie vea cambiar nada —ni su app ni sus avisos— solo por desplegar:**
 *   1. Si la base ya tiene idioma, manda la base. Esa persona ya eligió con el sistema nuevo.
 *   2. Si no lo tiene, se miran las dos copias de pantalla de ESTE equipo. Si dicen lo mismo, o solo
 *      hay una, ese es su idioma: se usa y se guarda en la base. No cambia nada de lo que ve.
 *   3. Si no coinciden entre sí, **no se elige por la persona**: cada app sigue con el suyo y no se
 *      guarda nada, hasta que elija un idioma en cualquier sitio.
 *   4. **Los avisos en español cuentan como una copia más, pero solo para no coincidir.** Si alguien
 *      tiene los avisos de fichaje en `'es'` y la pantalla de este equipo dice `'en'` —un PC de
 *      tienda compartido, por ejemplo—, sembrar `'en'` le pasaría los SMS a inglés sin que nadie lo
 *      viera. Así que no se siembra. `'en'` en los avisos no cuenta: es el valor por defecto de esa
 *      columna y no se distingue de no haber elegido. Y los avisos solos no deciden: sin copias de
 *      pantalla, se seguiría viendo inglés, y sembrar `'es'` cambiaría la pantalla por desplegar.
 *   5. Sin copias de pantalla, no se decide ni se guarda: sale el inglés de siempre.
 *
 * (La regla 4 se añadió en la revisión: la primera versión dejaba fuera los avisos, y medido en
 * producción había 6 personas con los avisos en español.)
 */
export function idiomaAlCargar(a: { servidor: unknown; hub: unknown; tt: unknown; avisos?: unknown }): {
  unificado: Idioma | null;
  sembrar: Idioma | null;
} {
  if (esIdioma(a.servidor)) return { unificado: a.servidor, sembrar: null };
  const locales = [a.hub, a.tt].filter(esIdioma);
  if (locales.length === 0) return { unificado: null, sembrar: null };
  const copias = a.avisos === "es" ? [...locales, "es" as const] : locales;
  if (copias.some((l) => l !== copias[0])) return { unificado: null, sembrar: null };
  return { unificado: locales[0], sembrar: locales[0] };
}

/** Lee `rtg_prefs.lang` de un texto guardado, con tolerancia: cualquier duda es `null`. */
export function idiomaDeRtgPrefs(raw: string | null | undefined): Idioma | null {
  if (!raw) return null;
  try {
    const v = (JSON.parse(raw) as { lang?: unknown } | null)?.lang;
    return esIdioma(v) ? v : null;
  } catch {
    return null;
  }
}

type Lectura = { data: { language?: unknown } | null; error: unknown };

/**
 * La carga, entera: pregunta a la base, decide con `idiomaAlCargar`, aplica y siembra.
 *
 * Con sus dependencias por argumento, para probarla con datos y sin red. El proveedor (`prefs.tsx`)
 * le pasa Supabase de verdad.
 *
 * **Si una lectura falla, no hace nada**: se queda la copia local, como antes. Decidir con un error
 * sería sembrar en la base un idioma que no se sabe si la persona tenía.
 *
 * Los avisos se leen solo cuando hacen falta: con idioma en la base, manda la base y no se pregunta
 * más. Se leen de la vista `clockin.profiles`, que con `profiles.language` vacía devuelve el de
 * `employee_settings`. Quien no tiene fila ahí, o no puede leerla (la RLS exige acceso a fichaje),
 * no tiene avisos que contar.
 */
export async function sincronizaIdiomaAlCargar(a: {
  uid: string | null;
  hub: unknown;
  tt: unknown;
  leerDeLaBase: (uid: string) => Promise<Lectura>;
  leerAvisos: (uid: string) => Promise<Lectura>;
  guardarEnLaBase: (uid: string, idioma: Idioma) => Promise<unknown>;
  aplicar: (idioma: Idioma) => void;
}): Promise<void> {
  if (!a.uid) return;
  const { data, error } = await a.leerDeLaBase(a.uid);
  if (error) return;
  let avisos: unknown = null;
  if (!esIdioma(data?.language)) {
    const lectura = await a.leerAvisos(a.uid);
    if (lectura.error) return;
    avisos = lectura.data?.language;
  }
  const plan = idiomaAlCargar({ servidor: data?.language, hub: a.hub, tt: a.tt, avisos });
  if (plan.unificado) a.aplicar(plan.unificado);
  if (plan.sembrar) await a.guardarEnLaBase(a.uid, plan.sembrar);
}
