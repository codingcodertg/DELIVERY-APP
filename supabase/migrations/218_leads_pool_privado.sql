-- 218: Leads — el «Pool privado» (leads de una fuente privada, solo para el admin) y el cruce con Clientes (D-760, 2026-10-30).
--
-- El dueño: «te estoy dando otro Excel de leads […] el leads que ya esta es por parte del gobierno, y este […] es por parte
-- de una private company. […] Solo es para admin, nadie mas. […] Va a decir Pool General, Mi pool, Admin, y al lado
-- Pool privado. […] Quiero que hagas un cross-reference de esos leads con nuestra base de datos de customers […] con
-- un filtro que diga leads que hacen cross-reference con customers.»
--
-- Que hay:
--   1. `leads.source`: 'tdlr' (lo de siempre, los permisos del estado) o 'privado' (el Excel de permisos municipales que
--      compra la empresa). Defecto 'tdlr': las 566 filas de hoy no cambian.
--   2. Las politicas de lectura de `leads` y `lead_events`: lo 'privado' lo lee SOLO el admin (is_admin), tenga o no
--      tienda, y aunque alguien lo tuviera a su nombre; lo 'tdlr' sigue con la regla de la 163 (todas / su tienda /
--      lo suyo). Las escrituras siguen por las funciones de la 162 (no hay politicas de escritura).
--   3. El cruce con Clientes: `customer_match_id` (la fila de erp.customers que coincide; si se borra, null),
--      `customer_match_note` (por que: «Teléfono 956-… = Red Moon Builders (PHR)») y `customer_matched_at`. Los pone el
--      importador (scripts/leads/importa-leads-privado.mjs); la pantalla los filtra («Coinciden con clientes»).
-- Sin begin/commit propios.
-- Para deshacer: volver a crear las dos politicas como en la 163; alter table public.leads drop column source,
-- customer_match_id, customer_match_note, customer_matched_at; borrar la fila del registro.

alter table public.leads add column if not exists source text not null default 'tdlr';
alter table public.leads drop constraint if exists leads_source;
alter table public.leads add constraint leads_source check (source in ('tdlr', 'privado'));
create index if not exists leads_source_idx on public.leads (source);

alter table public.leads add column if not exists customer_match_id bigint references erp.customers(id) on delete set null;
alter table public.leads add column if not exists customer_match_note text;
alter table public.leads add column if not exists customer_matched_at timestamptz;
create index if not exists leads_customer_match_idx on public.leads (customer_match_id) where customer_match_id is not null;

drop policy if exists "leads select" on public.leads;
create policy "leads select" on public.leads for select to authenticated
  using (
    (select public.has_leads_access())
    and (
      case when source = 'privado' then (select public.is_admin())
      else (
        (select public.leads_scope_all())
        or holder = (select auth.uid())
        or pool = (select public.leads_my_store())
      ) end
    )
  );

drop policy if exists "lead_events select" on public.lead_events;
create policy "lead_events select" on public.lead_events for select to authenticated
  using (
    (select public.has_leads_access())
    and exists (
      select 1 from public.leads l
       where l.id = lead_events.lead_id
         and (
           case when l.source = 'privado' then (select public.is_admin())
           else (
             (select public.leads_scope_all())
             or l.holder = (select auth.uid())
             or l.pool = (select public.leads_my_store())
           ) end
         )
    )
  );

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
declare def text;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'source') then
    raise exception '218: falta leads.source';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'customer_match_id') then
    raise exception '218: falta leads.customer_match_id';
  end if;
  select pg_get_expr(polqual, polrelid) into def from pg_policy where polname = 'leads select' and polrelid = 'public.leads'::regclass;
  if def is null or position('is_admin' in def) = 0 or position('privado' in def) = 0 then
    raise exception '218: la politica de leads no separa lo privado: %', def;
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'leads') <> 1 then
    raise exception '218: leads debe seguir con UNA politica (select)';
  end if;
  if exists (select 1 from public.leads where source not in ('tdlr', 'privado')) then
    raise exception '218: hay leads con source fuera de la lista';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('218_leads_pool_privado.sql', 'b5026aff5e4996fb66522ffbab8a39fbe400b2ab4035f1693126575c087bf367') on conflict (name) do nothing;
