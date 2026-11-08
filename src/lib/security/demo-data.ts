import { DEMO_USERS } from "@/lib/demo-data";

// ============================================================
// Seguridad en el DEMO (`NEXT_PUBLIC_LOCAL_MODE`, D-NEXT). El dueño, 2026-11-08, al no poder grabar el tutorial de
// Seguridad porque el demo mandaba al login: «daselo al demo entonces para que lo haga».
//
// Las mismas filas que lee `app/security/page.tsx` de la base (`security_policy`, `security_devices`,
// `security_device_users`, `security_web_blocks`, `profiles`), inventadas y calculadas a partir de `ahora`: nunca
// `new Date()` aquí dentro, para que una prueba con fecha fija no dependa del día en que corre.
// ============================================================

export interface PoliticaCruda { enforced: boolean; changed_at: string | null; changed_by: string | null; web_blocked: boolean; web_exempt: string[] | null }
export interface DispositivoCrudo {
  id: string; label: string | null; kind: string; status: string; user_agent: string | null;
  first_seen_at: string; last_seen_at: string; first_user_id: string | null; last_user_id: string | null;
  approved_at: string | null; revoked_at: string | null; notes: string | null;
  bound: boolean; requested_at: string | null; requested_by: string | null; request_note: string | null;
  last_ip: string | null; last_place: string | null;
}
export interface UsoCrudo { device_id: string; user_id: string; first_seen_at: string; last_seen_at: string; seen_count: number; last_ip: string | null; last_place: string | null }
export interface BloqueoCrudo { id: number; user_id: string; device_id: string | null; user_agent: string | null; path: string | null; at: string; ip: string | null; place: string | null }
export interface PerfilCrudo { id: string; full_name: string; role: string; store: string | null; username: string | null; left_at: string | null }

export interface DatosDeSeguridad {
  policy: PoliticaCruda | null;
  devices: DispositivoCrudo[];
  usos: UsoCrudo[];
  bloqueos: BloqueoCrudo[];
  /** Todos los perfiles (la tabla de usuarios) más los que faltaran por id: en el demo son los mismos. */
  todos: PerfilCrudo[];
  perfiles: PerfilCrudo[];
}

const UA_ESCRITORIO = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) RTGHub/1.2.1 Chrome/130.0.0.0 Electron/33.0.0 Safari/537.36";
const UA_ESCRITORIO_VIEJO = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) RTGHub/1.1.0 Chrome/128.0.0.0 Electron/32.0.0 Safari/537.36";
const UA_CHOFER = "Mozilla/5.0 (Linux; Android 14; SM-A546E) RDZDeliveries/0.45.0 Chrome/130.0.0.0 Mobile Safari/537.36";
const UA_NAVEGADOR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36";
const UA_TABLET = "Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36";

/** Las filas del panel de Seguridad del demo, fechadas respecto a `ahora`. */
export function datosDemoDeSeguridad(ahora: Date): DatosDeSeguridad {
  const ms = ahora.getTime();
  const hace = (dias: number, horas = 0) => new Date(ms - dias * 86400000 - horas * 3600000).toISOString();
  const perfiles: PerfilCrudo[] = DEMO_USERS.map((u) => ({
    id: u.id, full_name: u.full_name, role: u.role, store: u.store ?? null,
    username: u.full_name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, ""), left_at: null,
  }));
  const devices: DispositivoCrudo[] = [
    { id: "dev-pc-oficina", label: "PC Oficina McAllen", kind: "desktop", status: "approved", user_agent: UA_ESCRITORIO,
      first_seen_at: hace(40), last_seen_at: hace(0, 1), first_user_id: "u-admin", last_user_id: "u-mgr", approved_at: hace(40), revoked_at: null,
      notes: "Escritorio de la oficina, app RTG Hub instalada.", bound: true, requested_at: null, requested_by: null, request_note: null, last_ip: "10.0.0.21", last_place: "McAllen, TX" },
    { id: "dev-tel-carlos", label: "Teléfono de Carlos", kind: "phone", status: "approved", user_agent: UA_CHOFER,
      first_seen_at: hace(25), last_seen_at: hace(0, 3), first_user_id: "u-drv2", last_user_id: "u-drv2", approved_at: hace(25), revoked_at: null,
      notes: null, bound: true, requested_at: null, requested_by: null, request_note: null, last_ip: "172.58.10.4", last_place: "Weslaco, TX" },
    { id: "dev-tel-diego", label: "Teléfono de Diego", kind: "phone", status: "approved", user_agent: UA_CHOFER,
      first_seen_at: hace(30), last_seen_at: hace(1, 2), first_user_id: "u-drv", last_user_id: "u-drv", approved_at: hace(30), revoked_at: null,
      notes: null, bound: true, requested_at: null, requested_by: null, request_note: null, last_ip: "172.58.11.9", last_place: "McAllen, TX" },
    { id: "dev-laptop-sam", label: null, kind: "browser", status: "pending", user_agent: UA_NAVEGADOR,
      first_seen_at: hace(0, 5), last_seen_at: hace(0, 5), first_user_id: "u-sales", last_user_id: "u-sales", approved_at: null, revoked_at: null,
      notes: null, bound: false, requested_at: hace(0, 5), requested_by: "u-sales", request_note: "Laptop nueva de ventas, Edinburg.", last_ip: "70.121.44.8", last_place: "Edinburg, TX" },
    { id: "dev-tablet-almacen", label: "Tablet almacén Pharr", kind: "browser", status: "revoked", user_agent: UA_TABLET,
      first_seen_at: hace(90), last_seen_at: hace(12), first_user_id: "u-wh", last_user_id: "u-wh", approved_at: hace(90), revoked_at: hace(12),
      notes: "Se quedó sin batería definitiva; reemplazada.", bound: false, requested_at: null, requested_by: null, request_note: null, last_ip: "10.0.1.7", last_place: "Pharr, TX" },
    { id: "dev-pc-vieja", label: "PC Brownsville (vieja)", kind: "desktop", status: "approved", user_agent: UA_ESCRITORIO_VIEJO,
      first_seen_at: hace(120), last_seen_at: hace(2), first_user_id: "u-drv4", last_user_id: "u-drv4", approved_at: hace(120), revoked_at: null,
      notes: null, bound: true, requested_at: null, requested_by: null, request_note: null, last_ip: "10.0.2.3", last_place: "Brownsville, TX" },
  ];
  const usos: UsoCrudo[] = [
    { device_id: "dev-pc-oficina", user_id: "u-admin", first_seen_at: hace(40), last_seen_at: hace(0, 1), seen_count: 212, last_ip: "10.0.0.21", last_place: "McAllen, TX" },
    { device_id: "dev-pc-oficina", user_id: "u-mgr", first_seen_at: hace(38), last_seen_at: hace(0, 2), seen_count: 97, last_ip: "10.0.0.21", last_place: "McAllen, TX" },
    { device_id: "dev-pc-oficina", user_id: "u-log", first_seen_at: hace(20), last_seen_at: hace(1), seen_count: 31, last_ip: "10.0.0.21", last_place: "McAllen, TX" },
    { device_id: "dev-tel-carlos", user_id: "u-drv2", first_seen_at: hace(25), last_seen_at: hace(0, 3), seen_count: 140, last_ip: "172.58.10.4", last_place: "Weslaco, TX" },
    { device_id: "dev-tel-diego", user_id: "u-drv", first_seen_at: hace(30), last_seen_at: hace(1, 2), seen_count: 165, last_ip: "172.58.11.9", last_place: "McAllen, TX" },
    { device_id: "dev-laptop-sam", user_id: "u-sales", first_seen_at: hace(0, 5), last_seen_at: hace(0, 5), seen_count: 1, last_ip: "70.121.44.8", last_place: "Edinburg, TX" },
    { device_id: "dev-tablet-almacen", user_id: "u-wh", first_seen_at: hace(90), last_seen_at: hace(12), seen_count: 58, last_ip: "10.0.1.7", last_place: "Pharr, TX" },
    { device_id: "dev-pc-vieja", user_id: "u-drv4", first_seen_at: hace(120), last_seen_at: hace(2), seen_count: 44, last_ip: "10.0.2.3", last_place: "Brownsville, TX" },
  ];
  const bloqueos: BloqueoCrudo[] = [
    { id: 1, user_id: "u-sales", device_id: "dev-laptop-sam", user_agent: UA_NAVEGADOR, path: "/", at: hace(0, 5), ip: "70.121.44.8", place: "Edinburg, TX" },
    { id: 2, user_id: "u-mgr", device_id: null, user_agent: UA_NAVEGADOR, path: "/routes", at: hace(3), ip: "70.121.50.2", place: "Mission, TX" },
  ];
  const policy: PoliticaCruda = { enforced: true, changed_at: hace(10), changed_by: "u-admin", web_blocked: false, web_exempt: ["u-admin"] };
  return { policy, devices, usos, bloqueos, todos: perfiles, perfiles: [] };
}
