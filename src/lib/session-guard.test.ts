import { describe, it, expect } from "vitest";
import { checkSession, isAuthDenied, isSessionExpired, SESSION_EXPIRED } from "./session-guard";

// La distinción que estas pruebas fijan es la que faltaba y por la que el fallo volvió tres
// veces: "ahora no se pudo" (reintentar) contra "ya no hay sesión" (avisar). Confundirlas deja
// la app reintentando en vano contra una pantalla vacía y muda.

const seg = (n: number) => Math.floor(Date.now() / 1000) + n;

function client(get: unknown, refresh?: unknown) {
  return {
    auth: {
      getSession: async () => get as never,
      refreshSession: async () => (refresh ?? { data: { session: null }, error: null }) as never,
    },
  };
}

describe("checkSession", () => {
  it("da ok con un token que aún vive", async () => {
    expect(await checkSession(client({ data: { session: { expires_at: seg(3600) } } }))).toBe("ok");
  });

  it("refresca un token a punto de caducar, y da ok si el refresco funciona", async () => {
    // 30 s de vida es menos que el margen: a mitad de petición ya habría caducado.
    const c = client({ data: { session: { expires_at: seg(30) } } }, { data: { session: { id: "nueva" } }, error: null });
    expect(await checkSession(c)).toBe("ok");
  });

  it("da gone cuando no hay ninguna sesión guardada", async () => {
    // Cerrar sesión, otra pestaña que la cerró, almacenamiento limpiado. No hay nada que
    // refrescar: reintentar es perder el tiempo.
    expect(await checkSession(client({ data: { session: null } }))).toBe("gone");
  });

  it("da gone cuando el servidor rechaza el refresco", async () => {
    // El caso de despertar el ordenador: el token de refresco caducó o ya se usó. El servidor
    // CONTESTÓ que no — es definitivo, y hay que volver a entrar.
    const c = client({ data: { session: { expires_at: seg(-10) } } }, { data: { session: null }, error: { status: 400 } });
    expect(await checkSession(c)).toBe("gone");
  });

  it("da offline cuando el refresco falla sin respuesta del servidor", async () => {
    // Wifi caído. Aquí NO se echa a nadie de la app: la sesión probablemente siga viva.
    const c = client({ data: { session: { expires_at: seg(-10) } } }, { data: { session: null }, error: {} });
    expect(await checkSession(c)).toBe("offline");
  });

  it("da offline cuando la petición revienta", async () => {
    // Un fetch cancelado a media navegación (D-088). Abrir la app ES una navegación.
    const c = { auth: { getSession: async () => { throw new Error("cancelado"); }, refreshSession: async () => ({ data: { session: null }, error: null }) as never } };
    expect(await checkSession(c)).toBe("offline");
  });

  it("un 5xx es offline, no gone", async () => {
    // El servidor tuvo un mal momento; eso no dice nada sobre la sesión de nadie.
    const c = client({ data: { session: { expires_at: seg(-10) } } }, { data: { session: null }, error: { status: 503 } });
    expect(await checkSession(c)).toBe("offline");
  });
});

describe("isAuthDenied", () => {
  it("reconoce el error que salía al fichar tras suspender", () => {
    // El que no reconocía la versión vieja: no menciona "row-level security" por ningún lado,
    // porque Postgres corta en el esquema antes de mirar una sola política.
    expect(isAuthDenied({ message: "permission denied for schema timetracker" })).toBe(true);
  });
  it("sigue reconociendo los rechazos de RLS", () => {
    expect(isAuthDenied({ message: 'new row violates row-level security policy for table "sessions"' })).toBe(true);
    expect(isAuthDenied({ code: "42501" })).toBe(true);
  });
  it("no confunde un error normal con uno de permisos", () => {
    expect(isAuthDenied({ message: "duplicate key value violates unique constraint" })).toBe(false);
    expect(isAuthDenied(null)).toBe(false);
  });
});

describe("isSessionExpired", () => {
  it("solo reconoce el suyo", () => {
    expect(isSessionExpired(new Error(SESSION_EXPIRED))).toBe(true);
    expect(isSessionExpired(new Error("otra cosa"))).toBe(false);
  });
});

// D-138. Desde 092 la base garantiza una sola sesión viva por persona, así que un doble clic en
// Empezar ya no crea dos filas: la segunda la rechaza Postgres. Ese rechazo hay que traducirlo,
// no enseñarlo — para quien pulsó dos veces, lo correcto es "ya está corriendo".
describe("isAlreadyRunning", () => {
  it("reconoce el choque del índice de sesión viva", async () => {
    const { isAlreadyRunning } = await import("./session-guard");
    expect(isAlreadyRunning({ code: "23505" })).toBe(true);
    expect(isAlreadyRunning({ message: 'duplicate key value violates unique constraint "sessions_one_live_per_employee"' })).toBe(true);
  });

  it("y no confunde otros errores con eso", async () => {
    const { isAlreadyRunning } = await import("./session-guard");
    // Este es el de solapamiento (082), que sí tiene que llegar al usuario con su propio aviso.
    expect(isAlreadyRunning({ code: "23P01", message: "conflicting key value violates exclusion constraint" })).toBe(false);
    expect(isAlreadyRunning({ message: "permission denied for schema timetracker" })).toBe(false);
    expect(isAlreadyRunning(null)).toBe(false);
  });
});
