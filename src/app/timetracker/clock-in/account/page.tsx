import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { t, type Lang } from "@/lib/clockin/i18n";
import AppHeader from "@/components/clockin/AppHeader";
import ChangePassword from "./ChangePassword";
import LanguageSetting from "./LanguageSetting";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  if (!isSupabaseConfigured) redirect("/timetracker/clock-in/clock");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("full_name, language").eq("id", user.id).single();
  const lang = (profile?.language === "es" ? "es" : "en") as Lang;
  const tr = t(lang);

  return (
    <main className="flex-1 w-full max-w-md mx-auto p-5 flex flex-col gap-5">
      <AppHeader
        title={tr.account}
        subtitle={
          <>
            {profile?.full_name ?? user.email}
            {profile?.full_name ? <span className="text-zinc-400"> · {user.email}</span> : null}
          </>
        }
      />

      <LanguageSetting lang={lang} />
      <ChangePassword lang={lang} />
    </main>
  );
}
