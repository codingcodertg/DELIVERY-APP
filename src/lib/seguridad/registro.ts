import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ipDeCabeceras } from "@/lib/ip-de";

// ============================================================
// El rastro del monitoreo de seguridad (320): `public.sec_events`.
//
// Contrato: `registraEvento` NUNCA lanza ni bloquea a quien llama. Si la base falla, el evento se pierde y queda una
// línea en el log del servidor: el monitoreo no puede tumbar una petición del app. Por eso casi todos los sitios lo
// llaman con `void` (sin esperar). Es un trade-off conocido: en serverless, una escritura que sigue en vuelo después
// de responder puede no terminar; las rutas que devuelven un estado a la app la esperan (ver `seguridad/login-fallido`).
//
// Qué NUNCA entra aquí: contraseñas, correos, nombres o cualquier valor personal que venga del cuerpo de una petición.
// La IP y el país sí (son el dato del monitoreo); el agente se guarda como hash truncado; el identificador de un login
// fallido llega ya hasheado desde el navegador.
// ============================================================

export const CATEGORIAS_SEC = [
  "auth", "api_denied", "export", "admin", "device", "ratelimit", "upload", "cron", "impersonation",
] as const;
export type CategoriaSec = (typeof CATEGORIAS_SEC)[number];

export interface EventoSec {
  categoria: CategoriaSec;
  severidad?: number;
  usuario_id?: string | null;
  rol?: string | null;
  /** Si no se pasa, se deduce de `cabeceras`. Solo se guarda si es una IP válida. */
  ip?: string | null;
  ip_pais?: string | null;
  /** Texto del agente de usuario. Se guarda solo su hash. */
  ua?: string | null;
  device_id?: string | null;
  metodo?: string | null;
  ruta?: string | null;
  estado?: number | null;
  objetivo_tipo?: string | null;
  objetivo_id?: string | null;
  filas?: number | null;
  /** Datos técnicos pequeños (nunca valores personales). */
  meta?: Record<string, unknown> | null;
  /** Cabeceras de la petición: de aquí salen la IP, el país y el agente cuando no se pasan. */
  cabeceras?: { get(nombre: string): string | null } | null;
}

/** Lo mínimo que usa el registro de la base. Un stub de pruebas lo cumple sin Supabase de verdad. */
export type ClienteSec = SupabaseClient;

export interface DepsRegistro {
  cliente?: () => ClienteSec;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La IP si es una dirección real; si no (p. ej. el marcador «ip-desconocida»), null. La columna es `inet`. */
export function ipSegura(valor: string | null | undefined): string | null {
  const t = valor?.trim();
  return t && isIP(t) ? t : null;
}

/** El agente, hasheado y recortado: distingue navegadores sin guardar la cadena completa. */
export function hashUa(ua: string | null | undefined): string | null {
  const t = ua?.trim();
  if (!t) return null;
  return createHash("sha256").update(t).digest("hex").slice(0, 16);
}

/** La ruta sin query (la query puede llevar datos personales). Para el limitador, que ve la petición entera. */
export function rutaDe(req: Request): string | null {
  try {
    return new URL(req.url).pathname.slice(0, 200);
  } catch {
    return null;
  }
}

function acotaTexto(v: string | null | undefined, max: number): string | null {
  const t = v?.trim();
  return t ? t.slice(0, max) : null;
}

/** La fila que se escribe. Pura y sin efectos: lo que la base recibe sale de aquí, y aquí se puede probar. */
export function construyeFila(e: EventoSec): Record<string, unknown> {
  const c = e.cabeceras ?? null;
  const ipCruda = e.ip !== undefined ? e.ip : c ? ipDeCabeceras(c) : null;
  const pais = e.ip_pais ?? c?.get("x-vercel-ip-country") ?? null;
  const sev = Number.isInteger(e.severidad) ? Math.min(5, Math.max(1, e.severidad as number)) : 1;
  return {
    categoria: e.categoria,
    severidad: sev,
    usuario_id: e.usuario_id && UUID.test(e.usuario_id) ? e.usuario_id : null,
    rol: acotaTexto(e.rol, 30),
    ip: ipSegura(ipCruda),
    ip_pais: acotaTexto(pais, 2)?.toUpperCase() ?? null,
    ua_hash: hashUa(e.ua ?? c?.get("user-agent") ?? null),
    device_id: acotaTexto(e.device_id, 80),
    metodo: acotaTexto(e.metodo, 20),
    ruta: acotaTexto(e.ruta, 200),
    estado: Number.isInteger(e.estado) ? e.estado : null,
    objetivo_tipo: acotaTexto(e.objetivo_tipo, 40),
    objetivo_id: acotaTexto(e.objetivo_id, 200),
    filas: Number.isInteger(e.filas) ? Math.max(0, e.filas as number) : null,
    meta: e.meta ?? null,
  };
}

/** La llave de servicio: la moderna primero, la vieja como respaldo (igual que `adminKey()`, sin importar su cadena). */
function llaveDeServicio(): string {
  const llave = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!llave) throw new Error("Sin llave de servicio de Supabase en este entorno.");
  return llave;
}

/** Cliente de servicio para el rastro. Salta la RLS: sec_events solo lo escribe el servidor. */
export function clienteDeServicio(): ClienteSec {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL.");
  return createClient(url, llaveDeServicio(), { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * Escribe un evento. Devuelve `true` si la base lo aceptó. NUNCA lanza.
 * Quien no necesita saber el resultado lo llama con `void`.
 */
export async function registraEvento(e: EventoSec, deps: DepsRegistro = {}): Promise<boolean> {
  try {
    const fila = construyeFila(e);
    const { error } = await (deps.cliente ?? clienteDeServicio)().from("sec_events").insert(fila);
    if (error) {
      console.error(`[seguridad] no se pudo registrar "${e.categoria}":`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[seguridad] registro "${e.categoria}" fallido:`, (err as Error)?.message ?? err);
    return false;
  }
}

/** Ventana en la que no se repite el «sesión activa» de la misma persona, desde el mismo país. */
export const VENTANA_SESION_MS = 60 * 60 * 1000;

/**
 * «Esta persona tiene sesión activa aquí» (para el detector de país nuevo y el de admin activo). Se llama desde el
 * latido del dispositivo (cada 5 min), así que NO escribe cada vez: escribe si cambió el país o si la última fila de
 * sesión es de hace más de una hora. Así el rastro crece como mucho una fila por hora y persona.
 *
 * Lee el rol para poder decir después «este admin entró desde esta IP» (el bloqueo automático no toca esas IP).
 */
export async function registraSesionActiva(
  args: { usuario_id: string; cabeceras: { get(nombre: string): string | null } },
  deps: DepsRegistro = {},
): Promise<boolean> {
  try {
    const cliente = (deps.cliente ?? clienteDeServicio)();
    const pais = args.cabeceras.get("x-vercel-ip-country")?.trim().toUpperCase().slice(0, 2) || null;
    const { data: ultima } = (await cliente
      .from("sec_events")
      .select("ts, ip_pais")
      .eq("usuario_id", args.usuario_id)
      .eq("categoria", "auth")
      .eq("metodo", "sesion")
      .order("ts", { ascending: false })
      .limit(1)) as { data: { ts: string; ip_pais: string | null }[] | null };
    const previa = ultima?.[0];
    if (previa && (previa.ip_pais ?? null) === pais && Date.now() - Date.parse(previa.ts) < VENTANA_SESION_MS) return false;

    const { data: perfil } = (await cliente.from("profiles").select("role").eq("id", args.usuario_id).maybeSingle()) as {
      data: { role: string | null } | null;
    };
    return await registraEvento(
      {
        categoria: "auth",
        severidad: 1,
        usuario_id: args.usuario_id,
        rol: perfil?.role ?? null,
        ip: ipDeCabeceras(args.cabeceras),
        ip_pais: pais,
        metodo: "sesion",
        estado: 200,
        ruta: null,
      },
      deps,
    );
  } catch (err) {
    console.error("[seguridad] sesión activa no registrada:", (err as Error)?.message ?? err);
    return false;
  }
}
