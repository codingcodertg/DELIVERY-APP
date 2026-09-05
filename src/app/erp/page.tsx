import { redirect } from "next/navigation";

// /erp daba 404 (G-1, D-NEXT): el módulo tenía puerta (`erp/layout.tsx` manda al no
// autenticado a `/login?next=/erp/catalog`) pero no raíz. Mismo patrón que
// `erp/analytics/page.tsx`: la raíz del módulo es su catálogo.
export default function ErpIndex() {
  redirect("/erp/catalog");
}
