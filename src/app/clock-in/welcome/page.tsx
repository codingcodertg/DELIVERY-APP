import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { type Lang } from "@/lib/clockin/i18n";
import WelcomeConsent from "./WelcomeConsent";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  if (!isSupabaseConfigured) redirect("/clock-in/clock");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("language, location_consent_at")
    .eq("id", user.id)
    .single();

  // Already consented → straight to the clock.
  if (profile?.location_consent_at) redirect("/clock-in/clock");

  const lang = (profile?.language === "es" ? "es" : "en") as Lang;
  return <WelcomeConsent lang={lang} />;
}
