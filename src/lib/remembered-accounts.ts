/**
 * Las cuentas que este aparato recuerda para el login (D-193).
 *
 * Antes el login guardaba UN solo email (`rtg_remembered_email`) que se pisaba cada vez que
 * entraba otra persona en el mismo teléfono o PC de tienda: justo el fallo que el dueño
 * describió. Ahora es una lista, ordenada por uso reciente, con tope, y con migración del
 * valor viejo la primera vez que se lee.
 *
 * Solo guarda el identificador (email o usuario) y el nombre para pintar la tarjeta. **Nunca
 * una contraseña ni un token**: tocar una tarjeta prerrellena el identificador y pide la
 * contraseña igual. Por eso "si cambió la contraseña, deja de entrar" se cumple solo.
 *
 * Lógica pura, sin React ni `window`, para poder probarla sin dibujar. El acceso a
 * `localStorage` está aparte, abajo, y recibe el `Storage` por parámetro.
 */

export const ACCOUNTS_KEY = "rtg_accounts";
/** La clave de antes de D-193; se lee una vez para migrar y se borra. */
export const LEGACY_EMAIL_KEY = "rtg_remembered_email";
/** Tope de cuentas por aparato: un PC de tienda por el que pasa media plantilla no necesita más. */
export const MAX_ACCOUNTS = 8;

export type RememberedAccount = {
  /** Lo que la persona escribió para entrar: email o usuario, sin normalizar. */
  identifier: string;
  /** `full_name` de `profiles` la última vez que entró; vacío si no se pudo leer. */
  displayName: string;
  /** Epoch ms del último login con éxito. */
  lastUsedAt: number;
};

/** Dos identificadores son la misma cuenta si coinciden sin espacios ni mayúsculas. */
export const accountKey = (identifier: string) => identifier.trim().toLowerCase();

/** Más reciente primero. No muta. */
export function sortByRecent(list: RememberedAccount[]): RememberedAccount[] {
  return [...list].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

/**
 * Lee lo guardado con tolerancia: JSON roto o con forma rara devuelve lista vacía, no una
 * excepción en la pantalla de entrada. Si hay lista y además el email viejo, el viejo entra
 * como una cuenta más (la migración es idempotente porque `upsert` no duplica).
 */
export function parseAccounts(raw: string | null, legacyEmail: string | null, now: number): RememberedAccount[] {
  let list: RememberedAccount[] = [];
  if (raw) {
    try {
      const v: unknown = JSON.parse(raw);
      if (Array.isArray(v)) {
        list = v
          .filter((x): x is RememberedAccount =>
            !!x && typeof x === "object" && typeof (x as RememberedAccount).identifier === "string"
            && (x as RememberedAccount).identifier.trim() !== "")
          .map((x) => ({
            identifier: x.identifier.trim(),
            displayName: typeof x.displayName === "string" ? x.displayName : "",
            lastUsedAt: typeof x.lastUsedAt === "number" && Number.isFinite(x.lastUsedAt) ? x.lastUsedAt : 0,
          }));
      }
    } catch { list = []; }
  }
  if (legacyEmail && legacyEmail.trim()) {
    // Sin fecha real: se le da `now` para que salga primero si la lista está vacía, y se
    // deja detrás de cualquier entrada que sí tenga uso registrado.
    const exists = list.some((a) => accountKey(a.identifier) === accountKey(legacyEmail));
    if (!exists) list = [...list, { identifier: legacyEmail.trim(), displayName: "", lastUsedAt: list.length ? 0 : now }];
  }
  return sortByRecent(list);
}

/** Añade o actualiza una cuenta, la sube arriba y aplica el tope. No muta. */
export function upsertAccount(
  list: RememberedAccount[],
  entry: { identifier: string; displayName?: string },
  now: number,
): RememberedAccount[] {
  const key = accountKey(entry.identifier);
  const previous = list.find((a) => accountKey(a.identifier) === key);
  const rest = list.filter((a) => accountKey(a.identifier) !== key);
  const next: RememberedAccount = {
    identifier: entry.identifier.trim(),
    // Si esta vez no se pudo leer el nombre, se conserva el de la vez anterior.
    displayName: (entry.displayName ?? "").trim() || previous?.displayName || "",
    lastUsedAt: now,
  };
  return sortByRecent([next, ...rest]).slice(0, MAX_ACCOUNTS);
}

/** Quita una cuenta de la lista. No muta. */
export function removeAccount(list: RememberedAccount[], identifier: string): RememberedAccount[] {
  const key = accountKey(identifier);
  return list.filter((a) => accountKey(a.identifier) !== key);
}

// ---- Acceso a almacenamiento -------------------------------------------------------------

/** Lo mínimo de `Storage` que se usa, para poder pasar un objeto de prueba. */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** Lee la lista y migra el valor viejo (borrándolo) si lo hay. Nunca lanza. */
export function loadAccounts(storage: StorageLike, now: number = Date.now()): RememberedAccount[] {
  try {
    const legacy = storage.getItem(LEGACY_EMAIL_KEY);
    const list = parseAccounts(storage.getItem(ACCOUNTS_KEY), legacy, now);
    if (legacy !== null) {
      storage.removeItem(LEGACY_EMAIL_KEY);
      if (list.length) storage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
    }
    return list;
  } catch { return []; }
}

/** Guarda la lista; si queda vacía, quita la clave para no dejar `[]` colgando. Nunca lanza. */
export function saveAccounts(storage: StorageLike, list: RememberedAccount[]): void {
  try {
    if (list.length) storage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
    else storage.removeItem(ACCOUNTS_KEY);
  } catch { /* almacenamiento bloqueado o lleno: la lista es una comodidad, no un dato */ }
}
