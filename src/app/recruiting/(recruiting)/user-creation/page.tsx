"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { UsersManager, type UsersPrefill } from "@/components/UsersManager";
import { usePrefs } from "@/lib/prefs";
import { useData as useHubData } from "@/lib/data-provider";
import { listEmployeeFiles, type EmployeeFile } from "@/app/recruiting/actions/hr";
import { linkEmployeeToAccount } from "@/app/recruiting/actions/cuentas";
import { precargaDeEmpleado } from "@/lib/recruiting/usuarios-rrhh";

/**
 * «User creation» en RR. HH. (D-688). El dueño: «la opción de users donde le damos los permisos…
 * eso se va a pasar al HR app». Es la pantalla del hub tal cual (UsersManager + UserDialog, la misma
 * lógica de permisos y el mismo /api/invite), con dos cosas de RR. HH.:
 *  - `?employee=<id>` precarga el alta con los datos del expediente y, al crear, lo enlaza;
 *  - arriba, cuántos empleados tienen ya usuario y cuántos no.
 */
export default function UserCreationPage() {
  return <Suspense fallback={null}><Contenido /></Suspense>;
}

function Contenido() {
  const { t } = usePrefs();
  const { notify } = useHubData();
  const params = useSearchParams();
  const employeeId = params.get("employee");
  const [files, setFiles] = useState<EmployeeFile[] | null>(null);

  const carga = () => listEmployeeFiles().then((r) => setFiles(r.ok ? r.rows : []));
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
    const r = await linkEmployeeToAccount(key, id);
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
            ← {t("Employees", "Empleados")}
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
