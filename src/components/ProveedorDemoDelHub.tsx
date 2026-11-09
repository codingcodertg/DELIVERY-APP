"use client";

import { useMemo } from "react";
import { Ctx, useData } from "@/lib/data-provider";
import { LocalDataProvider } from "@/lib/local-data-provider";
import { PERFIL_DEMO, usuariosDemoDelHub } from "@/lib/home/demo-data";

/** Encima del proveedor local: los usuarios llevan sus roles y módulos, que `DEMO_USERS` no trae. */
function ConAccesos({ children }: { children: React.ReactNode }) {
  const datos = useData();
  const valor = useMemo(() => ({ ...datos, users: usuariosDemoDelHub(datos.users) }), [datos]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

/** El proveedor de Usuarios y «Cambiar de usuario» en el demo (D-NEXT): el local, sin base ni sesión. */
export function ProveedorDemoDelHub({ children }: { children: React.ReactNode }) {
  return <LocalDataProvider me={PERFIL_DEMO}><ConAccesos>{children}</ConAccesos></LocalDataProvider>;
}
