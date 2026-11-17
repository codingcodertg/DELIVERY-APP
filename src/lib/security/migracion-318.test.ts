import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Migración 318 (auditoría de seguridad 2026-11-17): pins de su contenido, uno por hallazgo. Si alguien quita un
 * arreglo sin querer (una política vuelve con `using (true)`, un disparador desaparece), esta prueba lo dice.
 * Lee el cuerpo con saltos LF (el fichero puede venir con CRLF desde Windows) y sin la sección «Deshacer»,
 * que repite las políticas viejas a propósito y no es código que se aplique.
 */
const completo = readFileSync("supabase/migrations/318_seguridad_permisos.sql", "utf8").split("\r\n").join("\n");
const sql = completo.split("-- @ledger-below")[0].split("DESHACER.")[0];

describe("318 · 1. ERP: lectura por módulo", () => {
  it("quita las seis lecturas `using (true)` del ERP", () => {
    for (const n of [
      '"customers read" on erp.customers',
      '"customer files read" on erp.customer_files',
      '"customer suggestions read" on erp.customer_merge_suggestions',
      '"sales_invoices select authenticated" on erp.sales_invoices',
      '"sales_invoice_lines select authenticated" on erp.sales_invoice_lines',
      '"salespeople select authenticated" on erp.salespeople',
    ]) {
      expect(sql).toContain(`drop policy if exists ${n}`);
    }
  });

  it("Estimador y Leads leen clientes solo con su módulo y la regla de visibilidad", () => {
    expect(sql).toContain("public.has_estimator_access() or public.has_leads_access()");
    expect(sql).toContain("and erp.customers_ve_la_fila(rep_id, created_by, store)");
  });

  it("el vendedor deja de tener WITH CHECK `true` y solo entran admin, gerente o vendedor", () => {
    expect(sql).toContain('create policy "customers solo los suyos (vendedor)"');
    expect(sql).toContain("p.role in ('admin', 'manager', 'sales')");
    expect(sql).not.toMatch(/with check \(true\)/i);
  });
});

describe("318 · 2. clockin.employee_settings: guardia de columnas de privilegio", () => {
  it("define el disparador sobre insert o update con las seis columnas", () => {
    expect(sql).toContain("create or replace function clockin.guard_employee_settings_privilege_columns()");
    expect(sql).toContain("before insert or update on clockin.employee_settings");
    for (const c of ["active", "company_id", "store_id", "extra_store_ids", "is_runner", "position"]) {
      expect(sql).toContain(`if new.${c} is distinct from old.${c} then`);
    }
  });

  it("pasa sin JWT o con la llave de servicio, y a los gerentes de fichaje", () => {
    expect(sql).toContain("if coalesce(auth.role(), '') in ('', 'service_role') or clockin.auth_is_manager() then");
  });
});

describe("318 · 3. clockin.time_entries: el empleado solo cierra su fichaje abierto", () => {
  it("la política de update exige fichaje abierto propio", () => {
    expect(sql).toContain('create policy "entries_update_self_open" on clockin.time_entries');
    expect(sql).toMatch(/using \(\s*company_id = \(select clockin\.auth_company_id\(\)\)\s*and employee_id = \(select auth\.uid\(\)\)\s*and status = 'open'\s*\)/);
  });

  it("la política de insert limita la hora a una ventana alrededor de now()", () => {
    expect(sql).toContain('create policy "entries_insert_self" on clockin.time_entries');
    expect(sql).toContain("clock_in_at between now() - interval '10 minutes' and now() + interval '1 minute'");
    expect(sql).toContain("coalesce(manual, false) = false");
  });

  it("el disparador deja cambiar solo status y los campos de salida, y no toca un fichaje cerrado", () => {
    expect(sql).toContain("create or replace function clockin.guard_time_entries_employee_update()");
    expect(sql).toContain("before update on clockin.time_entries");
    expect(sql).toContain("if old.status <> 'open' then");
    expect(sql).toContain("new.clock_in_at is distinct from old.clock_in_at");
    expect(sql).toContain("new.edit_note is distinct from old.edit_note");
  });
});

describe("318 · 4. public.notifications: avisos solo propios o de quien avisa por trabajo", () => {
  it("quita «notif insert any» y pone una regla con user_id = auth.uid() o el permiso de avisar", () => {
    expect(sql).toContain('drop policy if exists "notif insert any" on public.notifications;');
    expect(sql).toContain("with check (user_id = (select auth.uid()) or (select public.notif_puede_avisar_a_otros()));");
    expect(sql).not.toMatch(/notifications[\s\S]{0,200}with check \(true\)/);
  });

  it("el permiso de avisar a otros es admin, gerente, chofer o módulo de Entregas", () => {
    expect(sql).toContain("p.role in ('admin', 'manager', 'driver') or 'deliveries' = any(coalesce(p.module_access, '{}'))");
  });
});

describe("318 · 5. public.chat_messages: el destinatario solo cambia read_at", () => {
  it("revoca el update de tabla y concede update(read_at)", () => {
    expect(sql).toContain("revoke update on public.chat_messages from anon, authenticated;");
    expect(sql).toContain("grant update (read_at) on public.chat_messages to authenticated;");
  });
});

describe("318 · 6. bucket resumes: el gerente de tienda solo ve los CVs de sus candidatos", () => {
  it("lectura, cambio y borrado exigen gerente de tienda con candidato o adjunto visible", () => {
    for (const p of ['"resumes read"', '"resumes update"', '"resumes delete"']) {
      expect(sql).toContain(`create policy ${p} on storage.objects`);
    }
    const veces = sql.split("not public.is_recruiting_store_manager()").length - 1;
    expect(veces).toBe(3);
    expect(sql).toContain("exists (select 1 from recruiting.candidates c where c.resume_path = storage.objects.name)");
    expect(sql).toContain("exists (select 1 from recruiting.attachments a where a.path = storage.objects.name)");
  });

  it("la subida nueva no cambia (no hay política de insert nueva)", () => {
    expect(sql).not.toContain('create policy "resumes insert"');
  });
});

describe("318 · 7. security_touch_device: solo el admin liga un dispositivo", () => {
  it("reescribe la función con v_bound = v_admin y coalesce(p_bound, false)", () => {
    expect(sql).toContain("create or replace function public.security_touch_device(");
    expect(sql).toContain("select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') into v_admin;");
    expect(sql).toContain("v_bound := v_admin and coalesce(p_bound, false);");
    expect(sql).not.toMatch(/bound\s*=\s*public\.security_devices\.bound or coalesce\(p_bound, false\)/);
  });
});

describe("318 · 8. TRUNCATE fuera de anon y authenticated", () => {
  it("revoca en los cinco esquemas y en los privilegios por defecto", () => {
    for (const s of ["public", "recruiting", "clockin", "timetracker", "erp"]) {
      expect(sql).toContain(`revoke truncate on all tables in schema ${s} from anon, authenticated;`);
    }
    expect(sql).toContain("alter default privileges for role postgres in schema public, recruiting, clockin, timetracker, erp");
    expect(sql).toContain("revoke truncate on tables from anon, authenticated;");
  });
});

describe("318 · cierre: deshacer y ledger", () => {
  it("trae la sección Deshacer", () => {
    expect(completo).toContain("DESHACER.");
  });

  it("termina con la línea de registro en el ledger", () => {

    expect(completo).toContain("-- @ledger-below\ninsert into public.schema_migrations (name, checksum) values ('318_seguridad_permisos.sql', '");
  });
});
