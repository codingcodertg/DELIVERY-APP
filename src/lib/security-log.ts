// ============================================================
// Wording for the security log.
//
// The value of an audit line is whether a person reading it months later can
// tell what happened without opening the code. "role_changed" is a key; "Role:
// driver -> logistics" is an answer.
//
// Nothing here ever carries a password. The record is that a reset HAPPENED,
// never what it produced.
// ============================================================

export type SecurityKind =
  | "user_created"
  | "user_removed"
  | "role_changed"
  | "store_changed"
  | "permissions_changed"
  | "username_changed"
  | "email_changed"
  | "password_reset"
  | "recruiting_access_changed"
  | "timetracker_access_changed"
  | "erp_access_changed"
  | "deliveries_access_changed"
  | "clockin_access_changed";

export interface SecurityEventSeed {
  target_id: string | null;
  target_name: string | null;
  kind: SecurityKind;
  detail: string | null;
}

/** How each kind reads in the log. */
export function securityLabel(kind: string, lang: "en" | "es"): string {
  const en: Record<string, string> = {
    user_created: "User created",
    user_removed: "User removed",
    role_changed: "Role changed",
    store_changed: "Store changed",
    permissions_changed: "Permissions changed",
    username_changed: "Username changed",
    email_changed: "Email changed",
    password_reset: "Password reset",
    recruiting_access_changed: "Recruiting access changed",
    timetracker_access_changed: "Timetracker access changed",
    erp_access_changed: "ERP access changed",
    deliveries_access_changed: "Deliveries access changed",
    clockin_access_changed: "Clock-in access changed",
  };
  const es: Record<string, string> = {
    user_created: "Usuario creado",
    user_removed: "Usuario eliminado",
    role_changed: "Rol cambiado",
    store_changed: "Tienda cambiada",
    permissions_changed: "Permisos cambiados",
    username_changed: "Usuario cambiado",
    email_changed: "Correo cambiado",
    password_reset: "Contraseña restablecida",
    recruiting_access_changed: "Acceso a Recruiting cambiado",
    timetracker_access_changed: "Acceso a Timetracker cambiado",
  };
  return (lang === "es" ? es : en)[kind] ?? kind;
}

/** Which kinds deserve to stand out in a list. */
export function isSensitive(kind: string): boolean {
  return kind === "password_reset" || kind === "user_removed" || kind === "email_changed"
    || kind === "recruiting_access_changed" || kind === "timetracker_access_changed";
}

/** "driver → logistics", with a readable stand-in for an empty value. */
export function change(before: unknown, after: unknown): string {
  const show = (v: unknown) => {
    if (v == null || v === "") return "—";
    if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
    return String(v);
  };
  return `${show(before)} → ${show(after)}`;
}
