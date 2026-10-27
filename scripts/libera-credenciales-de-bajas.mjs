// Barrido de una vez (D-NEXT, 2026-10-26): las personas YA dadas de baja (profiles.left_at <= hoy) que aún pueden
// entrar o conservan su correo/usuario. A cada una: ban indefinido (el mismo de D-251) y correo liberado
// (alias archivado `<id>@baja.users.rdztilegroup.net`, usuario a null, lo que tenía en app_metadata.credenciales_liberadas).
// La cuenta y el perfil NO se borran.
//
// Sin `--escribe` solo enseña lo que haría. Con `--escribe`: primero guarda en D:/CLAUDE/respaldos-db el correo, usuario
// y ban de ANTES de cada cuenta, luego aplica.
//
//   node --env-file=.env.local scripts/libera-credenciales-de-bajas.mjs             (ver)
//   node --env-file=.env.local scripts/libera-credenciales-de-bajas.mjs --escribe   (hacer)
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { aliasDeBaja, credencialesAGuardar, hayQueLiberar } from "../src/lib/credenciales-liberadas.ts";

const escribe = process.argv.includes("--escribe");
const BAN_INDEFINIDO = "876000h"; // el mismo valor que src/app/recruiting/actions/hr.ts
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Hoy en Brownsville (America/Chicago), como `estaDadoDeBaja`.
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
const { data: perfiles, error } = await admin.from("profiles").select("id, full_name, username, left_at")
  .not("left_at", "is", null).lte("left_at", hoy);
if (error) throw error;
console.log(`dados de baja (left_at <= ${hoy}): ${perfiles.length}`);

const plan = [];
for (const p of perfiles) {
  const { data, error: e } = await admin.auth.admin.getUserById(p.id);
  if (e || !data?.user) { console.log(`  ${p.full_name}: sin cuenta en Auth (${e?.message ?? "no existe"}), se salta`); continue; }
  const u = data.user;
  const baneado = !!u.banned_until && new Date(u.banned_until) > new Date();
  const libera = hayQueLiberar({ email: u.email, username: p.username });
  if (baneado && !libera) continue;
  plan.push({ id: p.id, nombre: p.full_name, left_at: p.left_at, email: u.email ?? null, username: p.username ?? null,
    banned_until: u.banned_until ?? null, app_metadata: u.app_metadata ?? {}, banear: !baneado, liberar: libera });
}
console.log(`por tratar: ${plan.length}`);
for (const r of plan) {
  console.log(`  ${r.nombre} (baja ${r.left_at}): ${r.banear ? "ban" : "ya baneado"}${r.liberar ? ` · ${r.email ?? "-"} / ${r.username ?? "-"} → ${aliasDeBaja(r.id)}` : ""}`);
}

if (escribe && plan.length) {
  const sello = new Date().toISOString().replace(/[:.]/g, "-");
  const respaldo = `D:/CLAUDE/respaldos-db/credenciales-antes-de-liberar-bajas-${sello}.json`;
  writeFileSync(respaldo, JSON.stringify(plan, null, 2));
  console.log("respaldo:", respaldo);
  let ok = 0;
  for (const r of plan) {
    const cambio = {};
    if (r.banear) cambio.ban_duration = BAN_INDEFINIDO;
    if (r.liberar) {
      cambio.email = aliasDeBaja(r.id);
      cambio.email_confirm = true;
      cambio.app_metadata = { ...r.app_metadata, credenciales_liberadas: credencialesAGuardar({ email: r.email, username: r.username }) };
    }
    const { error: e1 } = await admin.auth.admin.updateUserById(r.id, cambio);
    if (e1) { console.log(`  FALLO ${r.nombre}: ${e1.message}`); continue; }
    if (r.liberar && r.username) {
      const { data: filas, error: e2 } = await admin.from("profiles").update({ username: null }).eq("id", r.id).select("id");
      if (e2 || !filas?.length) { console.log(`  FALLO usuario ${r.nombre}: ${e2?.message ?? "0 filas"}`); continue; }
    }
    ok++;
  }
  console.log(`tratadas: ${ok} de ${plan.length}`);
}
