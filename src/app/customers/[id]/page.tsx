import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createClient as createErpClient } from "@/lib/erp/supabase/server";
import { leeConRespaldo } from "@/lib/customers/almacen";
import { CLIENTES_DEMO } from "@/lib/customers/demo";
import { filasDeLaEmpresa } from "@/lib/customers/empresas";
import { clienteDeLaBase, puedeEditar, type Cliente } from "@/lib/customers/reglas";
import type { UserRole } from "@/lib/types";
import { BarraDeClientes } from "@/components/customers/barra";
import { FichaCompleta } from "./FichaCompleta";

export const dynamic = "force-dynamic";
const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/**
 * La ficha completa de un cliente (`/customers/[id]`). El dueño (2026-10-18): «when pressing a cutomer show all details
 * and i mean all details that were giving the intiial excel have the buttom of the fuull detail like the erp has with
 * every item». Es la página propia, como `/erp/product/[id]` para un artículo: TODOS los campos del Excel (las 27
 * cabeceras con nombre, incluidas las tres de CRM de la 182 y la CONCATENATE recompuesta), agrupados y con etiqueta.
 *
 * La puerta es la misma que la de la lista: `customers/layout.tsx` envuelve esta ruta (D-570, solo admins por ahora),
 * y la fila se lee con la sesión de quien mira: la RLS de la 180 decide. Un id que no existe —o que la política no
 * deja ver— es un 404, no una ficha vacía.
 */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();

  if (SIN_BASE) {
    const c = CLIENTES_DEMO.find((x) => x.id === n);
    if (!c) notFound();
    return (
      <>
        <BarraDeClientes role="admin" fullName="Demo" email="demo@example.com" moduleAccess={null} />
        <FichaCompleta cliente={c} hermanas={filasDeLaEmpresa(CLIENTES_DEMO, c)} puedeEditar />
      </>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let role: UserRole = "sales";
  let fullName: string | null = null;
  let moduleAccess: string[] | null = null;
  if (user) {
    const { data } = await supabase.from("profiles").select("full_name, role, module_access").eq("id", user.id).maybeSingle();
    role = (data?.role as UserRole | undefined) ?? "sales";
    fullName = data?.full_name?.trim() || null;
    moduleAccess = (data?.module_access as string[] | null) ?? null;
  }

  const erp = await createErpClient();
  const { data, error } = await leeConRespaldo((cols) => erp.from("customers").select(cols).eq("id", n).maybeSingle());
  if (error) throw new Error(`customers: ${error.message}`);
  if (!data) notFound();
  const cliente: Cliente = clienteDeLaBase(data as unknown as Record<string, unknown>);
  // D-NEXT (198): el nombre de su vendedor, que la ficha enseña en vez del id.
  if (cliente.rep_id) {
    const { data: rep } = await supabase.from("profiles").select("full_name").eq("id", cliente.rep_id).maybeSingle();
    cliente.rep_name = rep?.full_name ?? null;
  }
  // Las otras tiendas de la misma empresa (189): las pestañas de la ficha. Sin la 189 no hay company_id y es ella sola.
  let hermanas: Cliente[] = [cliente];
  if (cliente.company_id) {
    const { data: filas } = await leeConRespaldo((cols) => erp.from("customers").select(cols).eq("company_id", cliente.company_id!).order("id"));
    hermanas = filasDeLaEmpresa(((filas ?? []) as unknown as Record<string, unknown>[]).map(clienteDeLaBase), cliente);
  }

  return (
    <>
      <BarraDeClientes role={role} fullName={fullName} email={user?.email ?? ""} moduleAccess={moduleAccess} />
      <FichaCompleta cliente={cliente} hermanas={hermanas} puedeEditar={puedeEditar(role)} />
    </>
  );
}
