"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { UsersManager, type UsersPrefill } from "@/components/UsersManager";
import { usePrefs } from "@/lib/prefs";
import { useData as useHubData } from "@/lib/data-provider";
import { precargaDeEmpleado } from "@/lib/recruiting/usuarios-rrhh";

/**
 * D-NEXT: «Crear usuarios» de RR. HH., dentro de RR. HH. (antes la pestaña llevaba a /home/users, D-702). Es la misma
 * pantalla del hub (UsersManager + UserDialog, la misma lógica de permisos y el mismo /api/invite), con la barra y el
 * tema de RR. HH. y dos cosas suyas:
 *  - `?employee=<id>` precarga el alta con los datos del expediente y, al crear, lo enlaza (por /api, no con
 *    `actions/hr`, que tumbaba el build: D-702);
 *  - arriba, cuántos empleados tienen ya usuario y cuántos no.
 */
/** Lo que devuelve /api/recruiting/usuario-de-empleado (D-702): sin importar `actions/hr`, que tumbaba el build. */
type Expediente = { id: string; profile_id: string | null; full_name: string | null; email: string | null; personal_email: string | null; store: string | null };

export default function RrhhUserCreationPage() {
  return <Suspense fallback={null}><Contenido /></Suspense>;
}

function Contenido() {
  const { t } = usePrefs();
  const { notify } = useHubData();
  const params = useSearchParams();
  const employeeId = params.get("employee");
  const [files, setFiles] = useState<Expediente[] | null>(null);

  const carga = () => fetch("/api/recruiting/usuario-de-empleado").then((r) => r.ok ? r.json() : { files: [] })
    .then((b: { files?: Expediente[] }) => setFiles(b.files ?? [])).catch(() => setFiles([]));
  useEffect(() => { void carga(); }, []);

  const empleado = useMemo(() => files?.find((f) => f.id === employeeId) ?? null, [files, employeeId]);
  const prefill: UsersPrefill | null = useMemo(() => {
    if (!empleado || empleado.profile_id) return null;
    const p = precargaDeEmpleado(empleado);
    return { key: p.fileId, full_name: p.full_name, email: p.email, store: p.store };
  }, [empleado]);

  const conUsuario = files?.filter((f) => f.profile_id).length ?? 0;

  async function alCrear(id: string | undefined, key: string | null) {
    if (!key) return;
    if (!id) { notify(t("User created, but its id did not come back: link the employee file by hand.", "Usuario creado, pero no volvió su id: enlaza el expediente a mano.")); return; }
    const res = await fetch("/api/recruiting/usuario-de-empleado", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: key, profileId: id }) });
    const b = await res.json().catch(() => ({}));
    const r = { ok: res.ok, message: b.error as string | undefined };
    notify(r.ok
      ? t("User created and linked to the employee ✓", "Usuario creado y enlazado al empleado ✓")
      : t("User created, but linking the employee file failed: ", "Usuario creado, pero falló el enlace con el expediente: ") + (r.message ?? ""));
    void carga();
  }

  return (
    <UsersManager
      prefill={prefill}
      onCreated={alCrear}
      header={
        <div className="card" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/recruiting/employees" className="hint" style={{ textDecoration: "none", marginTop: 0 }}>
            👤 {t("HR → Employees", "RR. HH. → Empleados")}
          </Link>
          <span className="sec-title">🔑 {t("User creation", "Crear usuarios")}</span>
          {files && (
            <span className="hint" style={{ marginTop: 0 }} data-resumen="cuentas">
              {t("Employees with a user", "Empleados con usuario")}: {conUsuario} · {t("without", "sin")}: {files.length - conUsuario}
            </span>
          )}
          {empleado?.profile_id && (
            <span className="hint" style={{ marginTop: 0, color: "var(--red)" }}>
              {t("This employee already has a user.", "Este empleado ya tiene usuario.")}
            </span>
          )}
        </div>
      }
    />
  );
}
