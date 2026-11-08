/**
 * Modo demo de RR. HH. (sin base ni sesión), para grabar los tutoriales (D-NEXT).
 *
 * El dueño, 2026-11-08: «daselo al demo entonces para que lo haga». Entregas, Clientes y Leads ya arrancan con
 * `NEXT_PUBLIC_LOCAL_MODE=true` sin Supabase; RR. HH. mandaba a /login. La misma bandera, leída en UN sitio, para que
 * cada componente que toque el servidor (acciones de servidor, /api, Storage) ramifique con el mismo nombre.
 *
 * La regla es sencilla: en demo, nada sale del navegador. Lo que vive en el proveedor (`useData()`) funciona igual con
 * el proveedor del demo; lo que depende del servidor (expedientes, activos, crear usuarios, enlace corto del CV) o se
 * resuelve en memoria o enseña el aviso de «no disponible en el demo».
 */
export const MODO_DEMO = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/** La clave de localStorage del demo de RR. HH. Súbele el sufijo si cambia la forma de la semilla. */
export const CLAVE_DEMO_RRHH = "rtg_recruiting_local_v1";

/** El texto del aviso, en los dos idiomas, para que todos digan lo mismo. */
export const AVISO_DEMO = {
  en: "Not available in the demo: this part needs the server (employee files, company assets, hub accounts).",
  es: "No disponible en el demo: esta parte necesita el servidor (expedientes, activos de la empresa, cuentas del hub).",
} as const;
