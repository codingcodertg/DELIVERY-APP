import { redirect } from "next/navigation";

// D-720: «Crear usuarios» ya no es una página. La cuenta del hub y sus permisos se dan desde el expediente de cada
// empleado («🔑 Permisos»). La ruta se queda solo para los marcadores viejos (D-704 la creó) y manda a Empleados.
export default function RrhhUserCreationPage() {
  redirect("/recruiting/employees");
}
