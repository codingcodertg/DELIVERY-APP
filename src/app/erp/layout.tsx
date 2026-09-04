import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import { ErpNavProvider } from "@/components/erp/nav-state";
import "./erp.css";

export const metadata: Metadata = {
  title: "RTG ERP",
};

/**
 * The ERP section's shell (D-090).
 *
 * `data-app="erp"` is load-bearing, not decoration: erp.css deliberately does NOT import Tailwind's
 * preflight, because that is a global reset and every other screen in this app was built without
 * it. The stand-in reset is scoped to this attribute, so it applies here and stops here.
 *
 * The access check is the same shape recruiting's layout uses (D-051): reaching this layout is not,
 * by itself, proof of anything, so a direct URL is checked here rather than trusted. Without it the
 * database still refused every row — the restrictive module gate in migration 066 sees to that —
 * but a driver who typed /erp/catalog would have got an empty catalog instead of being told no,
 * which reads as a broken page rather than a closed door.
 *
 * Admins are always in, matching public.has_erp_access(): the person who grants module access
 * should not be able to lock themselves out of the module they administer.
 */
export default async function ErpLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient(); // deliveries' client — public schema, shared identity
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/erp/catalog");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, module_access")
    .eq("id", user.id)
    .maybeSingle();

  const role = profile?.role ?? "sales";
  const hasErp = role === "admin" || !!profile?.module_access?.includes("erp");
  if (!hasErp) {
    redirect(landingRoute({ role, module_access: profile?.module_access }));
  }

  // ErpNavProvider owns the sidebar's collapsed state AND the padding that keeps content clear of
  // it. The sidebar is `fixed`, so without that offset it sits on top of the page — rtg-erp applies
  // the same lg:pl-56 from its own root layout and the port had dropped it.
  return (
    <div data-app="erp">
      <ErpNavProvider>{children}</ErpNavProvider>
    </div>
  );
}
