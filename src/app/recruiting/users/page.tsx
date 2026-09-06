import { redirect } from "next/navigation";

// User management unified (D-053), then moved to the hub (D-056) — one
// screen where an admin sets both the deliveries role and recruiting access,
// reachable from either module instead of living inside one of them. This
// route stays, rather than disappearing outright, so an old bookmark or a
// stale link in someone's history still lands somewhere. The TABS entry
// that used to point here is gone (D-062) — this is bookmark-only now.
export default function RecruitingUsersPage() {
  redirect("/home/users");
}
