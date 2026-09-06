import { redirect } from "next/navigation";

// User management unified (D-053), then moved to the hub (D-056) — one
// screen where an admin sets both the deliveries role and recruiting access,
// reachable from either module instead of living inside one of them. This
// route stays, rather than disappearing outright, so an old bookmark or a
// stale link in someone's history still lands somewhere. The TABS entry
// that used to point here is gone (D-062) — this is bookmark-only now.
//
// D-NEXT (G-4): vivía dentro del route group (recruiting), cuyo layout comprueba sesión y
// recruiting_role ANTES de que corra este redirect: sin sesión, /recruiting/users mandaba a
// /login?next=/recruiting en vez de a /home/users. Fuera del grupo redirige siempre, como hace
// src/app/(app)/users/page.tsx. No hay layout en src/app/recruiting que la vuelva a gatear.
export default function RecruitingUsersPage() {
  redirect("/home/users");
}
