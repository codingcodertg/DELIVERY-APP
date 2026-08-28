"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/clockin/supabase/client";

export default function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }
  return (
    <button onClick={signOut} className="text-xs text-zinc-400 hover:text-zinc-600 underline">
      Sign out
    </button>
  );
}
