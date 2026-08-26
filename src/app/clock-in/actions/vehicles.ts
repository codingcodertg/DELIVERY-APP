"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";

export type VehicleResult = { ok: true } | { ok: false; message: string };

async function managerCtx() {
  if (!isSupabaseConfigured) return { ok: false as const, message: "Not configured." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Not signed in." };
  const { data: me } = await supabase.from("profiles").select("role, company_id").eq("id", user.id).single();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return { ok: false as const, message: "Managers only." };
  return { ok: true as const, supabase, companyId: me.company_id as string };
}

export async function addVehicle(input: { name: string; plate?: string }): Promise<VehicleResult> {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Vehicle name is required." };
  const { error } = await ctx.supabase.from("vehicles").insert({
    company_id: ctx.companyId,
    name,
    plate: input.plate?.trim() || null,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function setVehicleActive(id: string, active: boolean): Promise<VehicleResult> {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;
  const { error } = await ctx.supabase.from("vehicles").update({ active }).eq("id", id).eq("company_id", ctx.companyId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
