// Baja por despido de Anthony Hernandez (ventas, RDZ Pharr), 2026-10-01. El dueño, 2026-10-18: «disbale anthony in the hub
// and update his fule he was fired, anthony hernandez, fired on october 1st». Misma forma que baja-angel.mjs. Una vez y se borra.
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
const ID = "faf218e9-a1d7-48f5-b8ac-59446223d3e5";
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL }); await c.connect();
const r = await c.query("update recruiting.employee_files set date_left = '2026-10-01', left_reason = 'termination' where profile_id = $1 and date_left is null returning date_left", [ID]);
console.log("expediente:", r.rowCount === 1 ? "baja registrada (2026-10-01, termination)" : "sin cambio (" + r.rowCount + " filas)");
const t = await c.query("update clockin.profiles set active = false where id = $1 and active returning id", [ID]);
console.log("time tracker:", t.rowCount === 1 ? "desactivado" : "sin cambio");
await c.end();
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await s.auth.admin.updateUserById(ID, { ban_duration: "876000h" });
console.log("cuenta del hub:", error ? "ERROR " + error.message : "deshabilitada (banned_until " + data.user.banned_until + ")");
