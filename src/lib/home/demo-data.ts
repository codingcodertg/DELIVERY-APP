import { MODULE_ACCESS } from "@/lib/constants";
import { DEMO_USERS } from "@/lib/demo-data";
import type { MensajeDeAyuda } from "@/lib/help-thread";
import type { SolicitudDeAyuda } from "@/lib/help-requests";
import type { PersonaDirectorio } from "@/lib/phone-book";
import type { Profile, Tutorial } from "@/lib/types";

/**
 * La semilla del inicio del Hub en el demo (`NEXT_PUBLIC_LOCAL_MODE`, D-NEXT): sin base ni sesión, para capturar el manual.
 * Pura, con `ahora` por argumento. Las personas salen de `DEMO_USERS`; todo lo demás es inventado.
 */

/** Lo que contesta el demo a cualquier escritura, en vez de tocar la base. */
export const AVISO_DEL_DEMO = "Not available in the demo.";

const TODOS_LOS_MODULOS = MODULE_ACCESS.map((m) => m.key as string);

/** El admin del demo, con TODOS los módulos: el inicio enseña todas las tarjetas. */
export const PERFIL_DEMO: Profile = {
  ...DEMO_USERS.find((u) => u.id === "u-admin")!,
  username: "admin.demo",
  module_access: TODOS_LOS_MODULOS,
  recruiting_role: "admin",
  erp_role: "admin",
};

/** Con qué entra el admin del demo, lo que enseña «Mi perfil». */
export const CUENTA_DEMO = { correo: "admin@demo.example", usuario: "admin.demo" };

/** Roles y módulos que `DEMO_USERS` no trae: lo que la pantalla de Usuarios tiene que enseñar en el manual. */
const ACCESOS_DEMO: Record<string, Partial<Profile>> = {
  "u-admin": PERFIL_DEMO,
  "u-sales": { module_access: ["deliveries", "leads", "customers"] },
  "u-sales2": { module_access: ["deliveries", "customers"] },
  "u-mgr": { module_access: ["deliveries", "recruiting", "timetracker", "customers"], recruiting_role: "manager" },
  "u-log": { module_access: ["deliveries", "timetracker"] },
  "u-wh": { module_access: ["deliveries", "timetracker"] },
  "u-drv": { module_access: ["deliveries"] },
  "u-drv2": { module_access: ["deliveries"] },
  "u-drv3": { module_access: ["deliveries"] },
  "u-drv4": { module_access: ["deliveries"] },
};

/** Los usuarios tal como los tenga el proveedor local, con sus roles y módulos encima. */
export function usuariosDemoDelHub(base: readonly Profile[]): Profile[] {
  return base.map((u) => ({ ...u, ...ACCESOS_DEMO[u.id] }));
}

const persona = (
  full_name: string, title: string, store: string | null, store_rank: number | null, department: string | null,
  nn: string, ext: string, directory_group: PersonaDirectorio["directory_group"] = null,
): PersonaDirectorio => ({
  full_name, title, store, store_rank, department,
  phone: `(956) 555-01${nn}`,
  ringcentral_ext: ext,
  email: `${full_name.toLowerCase().split(" ")[0]}@demo.example`,
  directory_group,
  store_ext: store ? `2${String(store_rank).padStart(2, "0")}` : null,
});

export function directorioDemo(): PersonaDirectorio[] {
  return [
    persona("Sam Sales", "Sales Associate", "Edinburg", 1, "Ventas", "11", "311"),
    persona("Elena Rios", "Sales Associate", "Edinburg", 1, "Ventas", "12", "312"),
    persona("Wade Warehouse", "Warehouse Lead", "Pharr", 2, "Almacén", "21", "321"),
    persona("Miguel Soto", "Driver", "Pharr", 2, "Logística", "22", "322"),
    persona("Diego Driver", "Driver", "McAllen", 3, "Logística", "31", "331"),
    persona("Carla Mena", "Store Manager", "McAllen", 3, "Gerencia", "32", "332"),
    persona("Sofia Ventas", "Remote Sales", null, null, "Ventas", "41", "341", "remote"),
    persona("Laura Logistics", "Dispatcher", null, null, "Logística", "51", "351", "sin_tienda"),
  ];
}

export function tutorialesDemo(ahora: Date): Tutorial[] {
  const added_at = new Date(ahora.getTime() - 14 * 86_400_000).toISOString();
  const video = (id: string, title: string, description: string, app: Tutorial["app"]): Tutorial => ({
    id, title, description, app, url: `https://example.com/demo/${id}`, roles: [], added_by: "u-admin", added_at,
  });
  return [
    video("tut-entrar", "Cómo entrar al Hub", "La cuenta, la contraseña y el inicio.", null),
    video("tut-orden", "Crear una orden de entrega", "De la venta a la ruta del chofer.", "deliveries"),
    video("tut-expediente", "Abrir un expediente de empleado", "Alta, documentos y permisos.", "recruiting"),
    video("tut-horas", "Revisar las horas de la semana", "Fichajes, correcciones y aprobación.", "timetracker"),
    video("tut-catalogo", "Buscar en el catálogo", "Productos, existencias y costos.", "erp"),
  ];
}

const ID_1 = "00000000-0000-4000-8000-000000000001";
const ID_2 = "00000000-0000-4000-8000-000000000002";
const ID_3 = "00000000-0000-4000-8000-000000000003";

const haceHoras = (ahora: Date, h: number) => new Date(ahora.getTime() - h * 3_600_000).toISOString();

export function solicitudesDemo(ahora: Date): SolicitudDeAyuda[] {
  const base = {
    sender_email: null, location_en: null, location_es: null, device: null, app_version: "demo", lang: "es", files: [],
    email_to: null, email_ok: null, email_error: null, deleted_at: null, deleted_by: null, deleted_by_name: null,
  };
  return [
    { ...base, id: ID_1, created_at: haceHoras(ahora, 3), user_id: "u-admin", sender_name: "You (Admin)", role_label: "Admin", page: "/home/users",
      message: "¿Cómo le doy acceso a Time Tracker a una persona nueva?", status: "pendiente", attended_by: null, attended_at: null },
    { ...base, id: ID_2, created_at: haceHoras(ahora, 26), user_id: "u-sales", sender_name: "Sam Sales", role_label: "Sales", page: "/",
      message: "No encuentro la orden de ayer en mi lista.", status: "atendida", attended_by: "u-admin", attended_at: haceHoras(ahora, 24) },
    { ...base, id: ID_3, created_at: haceHoras(ahora, 50), user_id: "u-log", sender_name: "Laura Logistics", role_label: "Logistics", page: "/home/directory",
      message: "Falta la extensión de la tienda de Pharr en el directorio.", status: "pendiente", attended_by: null, attended_at: null },
  ];
}

export function mensajesDemo(ahora: Date): MensajeDeAyuda[] {
  const m = (id: string, request_id: string, author_id: string, author_name: string, body: string, h: number): MensajeDeAyuda => ({
    id, request_id, author_id, author_name, body, files: [], created_at: haceHoras(ahora, h),
  });
  return [
    m("msg-1", ID_1, "u-mgr", "Maria Manager", "En Usuarios ábrala y marque el módulo; el rol sale debajo.", 2),
    m("msg-2", ID_2, "u-admin", "You (Admin)", "Estaba en el filtro de la semana pasada. Ya la tiene a la vista.", 25),
    m("msg-3", ID_3, "u-admin", "You (Admin)", "La añadimos hoy en Ajustes. ¿Ya le aparece?", 40),
  ];
}
