import { createClient } from "@/lib/supabase/server";
import { esVendedor, puedeArchivar, puedeAsignarVendedores, puedeEditar } from "@/lib/customers/reglas";
import { puedePedirVendedor } from "@/lib/customers/pedir-vendedor";
import { altaEsSolicitud, puedeDarDeAlta } from "@/lib/customers/solicitud-de-cliente";
import { edicionEsSolicitud } from "@/lib/customers/edicion-como-solicitud";
import type { UserRole } from "@/lib/types";
import { rolEnClientes } from "@/lib/customers/admin-de-clientes";
import { BarraDeClientes } from "@/components/customers/barra";
import { Clientes } from "./Clientes";

export const dynamic = "force-dynamic";
const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/**
 * «Clientes» (migración 180): la lista maestra de clientes, con el tema del ERP.
 *
 * El servidor solo dice QUIÉN mira (su rol del hub, para saber si edita, y lo que la barra pinta): los clientes los
 * lee la pantalla con la sesión de quien mira, para que la RLS de la 180 sea la que decide; y que pueda editar aquí
 * solo enseña botones: `erp.customers_can_write()` lo vuelve a comprobar en cada escritura. La puerta (quién entra)
 * está en `layout.tsx`.
 */
export default async function CustomersPage() {
  if (SIN_BASE) {
    return (
      <>
        <BarraDeClientes role="admin" fullName="Demo" email="demo@example.com" moduleAccess={null} />
        <Clientes demo puedeEditar esAdmin puedeDecidirSolicitudes puedeArchivar userId="demo" />
      </>
    );
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let role: UserRole = "sales";
  let rolDelHub: UserRole = "sales";
  let fullName: string | null = null;
  let moduleAccess: string[] | null = null;
  // D-767: la tienda de quien mira, para dejarla marcada en el alta.
  let miTienda: string | null = null;
  if (user) {
    const { data } = await supabase.from("profiles").select("full_name, role, module_access, store, customers_role").eq("id", user.id).maybeSingle();
    miTienda = (data?.store as string | null | undefined) ?? null;
    role = (data?.role as UserRole | undefined) ?? "sales";
    // 241: admin SOLO de Clientes (`customers_role`). Las reglas de aquí se leen con el rol de Clientes; la barra, con el del hub.
    rolDelHub = role;
    role = rolEnClientes(data);
    fullName = data?.full_name?.trim() || null;
    moduleAccess = (data?.module_access as string[] | null) ?? null;
  }
  return (
    <>
      <BarraDeClientes
        role={rolDelHub}
        esAdminDeClientes={role === "admin"}
        fullName={fullName}
        email={user?.email ?? ""}
        // ¿Hay hub al que volver? Lo decide la casa de la barra con `canReachHub`, como en todas las apps (D-643).
        moduleAccess={moduleAccess}
      />
      {/* El id va a la clave de las columnas elegidas (por persona, en el navegador). Sin sesión no se llega aquí (layout). */}
      {/* D-728: asignan vendedores admin y gerente; el vendedor no ve crédito, campos ocultos ni archivos. */}
      {/* D-742: asigna solo el admin; el gerente pide el vendedor al admin y, como el vendedor, ve solo su tienda. */}
      <Clientes demo={false} puedeEditar={puedeEditar(role)} puedeDarDeAlta={puedeDarDeAlta(role)} esAdmin={puedeAsignarVendedores(role)} puedeDecidirSolicitudes={role === "admin"} puedeArchivar={puedeArchivar(role)} esVendedor={esVendedor(role)} puedePedirVendedor={puedePedirVendedor(role)} altaComoSolicitud={altaEsSolicitud(role)} edicionComoSolicitud={edicionEsSolicitud(role)} userId={user?.id ?? "anon"} miTienda={miTienda} />
    </>
  );
}
