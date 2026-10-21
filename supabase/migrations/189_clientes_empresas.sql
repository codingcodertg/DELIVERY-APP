-- ===========================================================================
-- 189 · Clientes: EMPRESAS (las filas de una misma compania en varias tiendas), juntar duplicados y la cola
--       «Decidir si se juntan / Decide to merge» (D-633)
-- ===========================================================================
-- ESCRITA Y NO APLICADA: aplicarla es del orquestador, despues del merge, con migrate-status antes y despues.
--
-- PEDIDO. El dueno, 2026-10-21: «analices toda la lista otra vez y ver los que son obviamente duplicados, hacerle un
-- merge [...] hay uno en Far [Pharr], uno en Browser [Brownsville] [...] en la misma aplicacion vas a tener uno en
-- Browser, uno en Far [...] puedes cambiar las tiendas y va a display otro content information y otro rep. [...] los
-- que no son, obviamente, pero que tienen sospecha de ser la misma compania, tiene que irse a un site que dice Decide
-- to Merge».
--
-- LO QUE HABIA (medido en produccion el 2026-10-21, solo lectura): erp.customers tiene UNA fila por (tienda, cuenta):
-- 1.348 filas, 1.199 vivas (sin archived_at). La misma compania sale una vez por tienda (CANO HOME BUILDERS en BRO, PHR,
-- WES y MCA) y a veces dos veces en la misma tienda («MORAM CONSTRUCTION LLC» / «Moram Construction, LLC» en PHR).
-- NADA referencia erp.customers(id): ni claves foraneas (pg_constraint), ni vistas, ni funciones fuera de las dos de
-- la 180; erp.exemption_certificates.customer_id existe sin clave foranea y tiene 0 filas.
--
-- QUE TRAE:
--   1. erp.customers.company_id uuid NOT NULL default gen_random_uuid(): la EMPRESA de la fila. Al anadirla cada fila
--      es su propia empresa (un uuid distinto por fila); juntar es poner el mismo uuid. Un uuid y no «el id de la
--      primera fila» para que SEPARAR una fila de su empresa sea darle otro uuid sin tocar a las demas (con el id de
--      la primera, separar justo esa obligaria a renombrar la empresa entera).
--   2. erp.customer_merge_suggestions: la cola. Un par de filas (a_id < b_id, unico), el motivo (codigos separados
--      por coma: cuenta_unificada, nombre_parecido, nombre_contenido, telefono, correo), la similitud del nombre, y el
--      estado: pending, merged, rejected, o superseded (el par apuntaba a una fila que se junto en otra y se reapunto
--      a la superviviente). Un par rechazado NO se vuelve a proponer: el guion inserta con `on conflict do nothing`.
--      Lee quien tiene el modulo; NADIE escribe directo: solo las dos funciones de abajo y el guion (postgres).
--   3. erp.junta_clientes(a, b): UNA llamada, atomica. Junta las empresas de a y b (se queda el company_id de la fila
--      mas vieja de las dos) y, en cada tienda donde la empresa quede con mas de una fila VIVA, sobrevive la de id
--      menor y las otras se le juntan: un campo vacio se rellena con el de la otra; si los dos tienen valor y no dicen
--      lo mismo, se queda el de la superviviente y el otro se APUNTA en notes («Del duplicado #id: telefono «...»»); las
--      notas de la otra van debajo. La otra se ARCHIVA (archived_reason «duplicado: unido a #id»), nunca se borra.
--      Marca la sugerencia del par como merged, reapunta las pendientes de las filas archivadas y cierra las que ya
--      quedan dentro de una misma empresa. Devuelve el company_id.
--      La lista de campos es LA MISMA que `CAMPOS_DE_UNION` de src/lib/customers/duplicados.ts (lo comprueba
--      modulo.test.ts) y el ensayo del guion compara el resultado de esta funcion con el de esa, fila por fila.
--   4. erp.rechaza_sugerencia_de_clientes(id): la marca rejected. Solo una pendiente.
--   Las dos funciones: SECURITY DEFINER, y solo para quien hoy puede editar clientes (erp.customers_can_write(), 180:
--   admin, o manager del hub con la casilla; D-570 deja la pantalla solo a admins). Sin sesion (auth.uid() null:
--   postgres o service-role) pasan, como el guard de entregas: es el guion de una vez. anon no las puede ejecutar.
--
-- QUE NO HACE: no junta nada ni llena la cola. Eso es scripts/junta-clientes-duplicados.mts, en seco por defecto, que
-- se corre DESPUES de aplicar esta migracion (respaldo JSON primero, una transaccion, y vuelve a medir).
-- No toca las politicas de erp.customers (las de la 180 son por fila: quien actualiza puede cambiar company_id, que es
-- lo que hace «Separar de la empresa» en la ficha).
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion.
--
-- Reversion (en este orden):
--   drop function if exists erp.rechaza_sugerencia_de_clientes(bigint);
--   drop function if exists erp.junta_clientes(bigint, bigint);
--   drop table if exists erp.customer_merge_suggestions;
--   drop index if exists erp.customers_company_idx;
--   alter table erp.customers drop column if exists company_id;
--   delete from public.schema_migrations where name = '189_clientes_empresas.sql';
-- (Quitar company_id pierde que filas son la misma empresa. Las filas que el guion o la pantalla archivaron como
--  duplicado siguen archivadas y con sus datos: se desarchivan con
--  `update erp.customers set archived_at = null, archived_reason = null where archived_reason like 'duplicado: unido a #%'`;
--  las notas que se anadieron a la superviviente estan, antes de tocarlas, en el respaldo JSON del guion.)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. La empresa de cada fila
-- ---------------------------------------------------------------------------
alter table erp.customers add column if not exists company_id uuid not null default gen_random_uuid();
create index if not exists customers_company_idx on erp.customers (company_id);

-- ---------------------------------------------------------------------------
-- 2. La cola «Decidir si se juntan»
-- ---------------------------------------------------------------------------
create table if not exists erp.customer_merge_suggestions (
  id          bigint generated always as identity primary key,
  a_id        bigint not null references erp.customers (id) on delete cascade,
  b_id        bigint not null references erp.customers (id) on delete cascade,
  reason      text not null,
  score       numeric(4,3),
  status      text not null default 'pending',
  created_at  timestamptz not null default now(),
  decided_by  uuid,
  decided_at  timestamptz,
  constraint customer_merge_suggestions_par_ordenado check (a_id < b_id),
  constraint customer_merge_suggestions_status check (status in ('pending', 'merged', 'rejected', 'superseded')),
  constraint customer_merge_suggestions_par_unico unique (a_id, b_id)
);
create index if not exists customer_merge_suggestions_pendientes_idx
  on erp.customer_merge_suggestions (id) where status = 'pending';

revoke all on erp.customer_merge_suggestions from public, anon, authenticated;
grant select on erp.customer_merge_suggestions to authenticated;
alter table erp.customer_merge_suggestions enable row level security;

drop policy if exists "customer suggestions module gate" on erp.customer_merge_suggestions;
create policy "customer suggestions module gate" on erp.customer_merge_suggestions as restrictive for all to authenticated
  using ((select public.has_customers_access())) with check ((select public.has_customers_access()));
drop policy if exists "customer suggestions read" on erp.customer_merge_suggestions;
create policy "customer suggestions read" on erp.customer_merge_suggestions as permissive for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 3. Juntar
-- ---------------------------------------------------------------------------
create or replace function erp.junta_clientes(p_a bigint, p_b bigint)
  returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  -- (campo, etiqueta en la nota, como se compara): t texto, p telefono por digitos, e correo, m numero,
  -- s se rellena pero un choque no se apunta, n no se rellena y un choque si se apunta. = CAMPOS_DE_UNION.
  campos constant text[] := array[
    'account', 'cuenta', 'n',
    'unified_account', 'cuenta unificada', 't',
    'house_no', 'House #', 's',
    'added_batch', 'tanda', 's',
    'qb_status', 'QuickBooks', 't',
    'activity_status', 'actividad', 't',
    'status_store', 'estado (tienda)', 't',
    'status_group', 'estado (grupo)', 't',
    'history_store', 'historial (tienda)', 't',
    'history_group', 'historial (grupo)', 't',
    'crm_type_store', 'tipo CRM (tienda)', 't',
    'crm_type_group', 'tipo CRM (grupo)', 't',
    'associated_with', 'asociado con', 't',
    'rep_history', 'vendedor grupo (historial)', 't',
    'rep_qb', 'vendedor grupo (QB)', 't',
    'rep_store', 'vendedor tienda (QB)', 't',
    'contact_name', 'contacto', 't',
    'contact_title', 'cargo', 't',
    'address', 'dirección', 't',
    'phone', 'teléfono', 'p',
    'email', 'correo', 'e',
    'credit_limit', 'límite de crédito', 'm',
    'euler_limit', 'límite Euler', 'm',
    'terms', 'términos', 't',
    'account_no', 'cuenta/crédito', 't'
  ];
  a erp.customers;
  b erp.customers;
  s erp.customers;
  o erp.customers;
  destino uuid;
  tienda text;
  sj jsonb;
  oj jsonb;
  nuevo jsonb;
  partes text[];
  linea text;
  k text;
  etiqueta text;
  como text;
  va text;
  vb text;
  igual boolean;
  i int;
  yo uuid := auth.uid();
begin
  if yo is not null and not erp.customers_can_write() then
    raise exception 'Not allowed: only who can edit customers can merge them' using errcode = '42501';
  end if;
  if p_a is null or p_b is null or p_a = p_b then
    raise exception 'Two different customers are needed' using errcode = '22023';
  end if;
  select * into a from erp.customers where id = p_a for update;
  select * into b from erp.customers where id = p_b for update;
  if a.id is null or b.id is null then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;
  if a.archived_at is not null or b.archived_at is not null then
    raise exception 'An archived customer is not merged' using errcode = '22023';
  end if;

  -- La sugerencia de ESTE par queda decidida.
  update erp.customer_merge_suggestions set status = 'merged', decided_by = yo, decided_at = now()
   where a_id = least(p_a, p_b) and b_id = greatest(p_a, p_b) and status = 'pending';

  -- 1. Una sola empresa: la de la fila mas vieja de las dos empresas.
  select c.company_id into destino from erp.customers c
   where c.company_id in (a.company_id, b.company_id) order by c.id limit 1;
  update erp.customers set company_id = destino
   where company_id in (a.company_id, b.company_id) and company_id <> destino;

  -- 2. Una fila viva por tienda: sobrevive la de id menor; las demas se le juntan y se archivan.
  for tienda in
    select upper(btrim(store)) from erp.customers
     where company_id = destino and archived_at is null
     group by 1 having count(*) > 1 order by 1
  loop
    select * into s from erp.customers
     where company_id = destino and archived_at is null and upper(btrim(store)) = tienda order by id limit 1;
    for o in
      select * from erp.customers
       where company_id = destino and archived_at is null and upper(btrim(store)) = tienda and id <> s.id order by id
    loop
      sj := to_jsonb(s);
      oj := to_jsonb(o);
      nuevo := '{}'::jsonb;
      partes := '{}'::text[];
      for i in 1 .. array_length(campos, 1) / 3 loop
        k := campos[3 * i - 2];
        etiqueta := campos[3 * i - 1];
        como := campos[3 * i];
        va := regexp_replace(sj ->> k, '^\s+|\s+$', '', 'g');
        vb := regexp_replace(oj ->> k, '^\s+|\s+$', '', 'g');
        continue when vb is null or vb = '';
        if va is null or va = '' then
          if como <> 'n' then nuevo := nuevo || jsonb_build_object(k, oj -> k); end if;
          continue;
        end if;
        continue when como = 's';
        igual := case como
          when 'p' then case
            when regexp_replace(va, '\D', '', 'g') <> '' or regexp_replace(vb, '\D', '', 'g') <> ''
              then regexp_replace(va, '\D', '', 'g') = regexp_replace(vb, '\D', '', 'g')
            else lower(va) = lower(vb) end
          when 'e' then lower(va) = lower(vb)
          when 'm' then va::numeric = vb::numeric
          else regexp_replace(lower(va), '\s+', ' ', 'g') = regexp_replace(lower(vb), '\s+', ' ', 'g')
        end;
        if not igual then partes := partes || (etiqueta || ' «' || vb || '»'); end if;
      end loop;
      linea := 'Del duplicado #' || o.id || ': '
               || coalesce(nullif(array_to_string(partes, '; '), ''), 'sin datos distintos');
      nuevo := nuevo || jsonb_build_object('notes', concat_ws(E'\n',
                 nullif(regexp_replace(s.notes, '^\s+|\s+$', '', 'g'), ''),
                 linea,
                 case when nullif(regexp_replace(o.notes, '^\s+|\s+$', '', 'g'), '') is not null
                      then 'Del duplicado #' || o.id || ' (notas): ' || regexp_replace(o.notes, '^\s+|\s+$', '', 'g') end));

      update erp.customers c set
        unified_account = r.unified_account, house_no = r.house_no, added_batch = r.added_batch,
        qb_status = r.qb_status, activity_status = r.activity_status,
        status_store = r.status_store, status_group = r.status_group,
        history_store = r.history_store, history_group = r.history_group,
        crm_type_store = r.crm_type_store, crm_type_group = r.crm_type_group, associated_with = r.associated_with,
        rep_history = r.rep_history, rep_qb = r.rep_qb, rep_store = r.rep_store,
        contact_name = r.contact_name, contact_title = r.contact_title, address = r.address,
        phone = r.phone, email = r.email, credit_limit = r.credit_limit, euler_limit = r.euler_limit,
        terms = r.terms, account_no = r.account_no, notes = r.notes
      from jsonb_populate_record(s, nuevo) r
      where c.id = s.id
      returning c.* into s;

      update erp.customers set archived_at = now(), archived_reason = 'duplicado: unido a #' || s.id where id = o.id;

      -- Lo pendiente de la archivada pasa a la superviviente (si el par ya existe, se queda el que habia).
      insert into erp.customer_merge_suggestions (a_id, b_id, reason, score)
        select least(s.id, x.otro), greatest(s.id, x.otro), x.reason, x.score
          from (select case when g.a_id = o.id then g.b_id else g.a_id end as otro, g.reason, g.score
                  from erp.customer_merge_suggestions g
                 where g.status = 'pending' and o.id in (g.a_id, g.b_id)) x
         where x.otro <> s.id
        on conflict (a_id, b_id) do nothing;
      update erp.customer_merge_suggestions set status = 'superseded', decided_by = yo, decided_at = now()
       where status = 'pending' and o.id in (a_id, b_id);
    end loop;
  end loop;

  -- Lo pendiente que ya queda dentro de una misma empresa, decidido.
  update erp.customer_merge_suggestions g set status = 'merged', decided_by = yo, decided_at = now()
   where g.status = 'pending'
     and exists (select 1 from erp.customers x join erp.customers y on y.id = g.b_id
                  where x.id = g.a_id and x.company_id = y.company_id);

  return destino;
end $$;

revoke execute on function erp.junta_clientes(bigint, bigint) from public, anon;
grant execute on function erp.junta_clientes(bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. «No son la misma»
-- ---------------------------------------------------------------------------
create or replace function erp.rechaza_sugerencia_de_clientes(p_id bigint)
  returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not erp.customers_can_write() then
    raise exception 'Not allowed: only who can edit customers can decide' using errcode = '42501';
  end if;
  update erp.customer_merge_suggestions set status = 'rejected', decided_by = auth.uid(), decided_at = now()
   where id = p_id and status = 'pending';
  if not found then
    raise exception 'That suggestion is not pending' using errcode = 'P0002';
  end if;
end $$;

revoke execute on function erp.rechaza_sugerencia_de_clientes(bigint) from public, anon;
grant execute on function erp.rechaza_sugerencia_de_clientes(bigint) to authenticated;

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
begin
  if exists (select 1 from erp.customers where company_id is null) then
    raise exception '189: hay filas sin empresa';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'erp.customers'::regclass and attname = 'company_id' and attnotnull) then
    raise exception '189: company_id no es not null';
  end if;
  if position('erp.customers_can_write()' in pg_get_functiondef('erp.junta_clientes(bigint, bigint)'::regprocedure)) = 0
     or position('erp.customers_can_write()' in pg_get_functiondef('erp.rechaza_sugerencia_de_clientes(bigint)'::regprocedure)) = 0 then
    raise exception '189: una funcion no mira quien puede escribir';
  end if;
  if has_function_privilege('anon', 'erp.junta_clientes(bigint, bigint)', 'execute') then
    raise exception '189: anon puede juntar';
  end if;
  if has_table_privilege('authenticated', 'erp.customer_merge_suggestions', 'insert')
     or has_table_privilege('authenticated', 'erp.customer_merge_suggestions', 'update') then
    raise exception '189: la cola se puede escribir directo';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('189_clientes_empresas.sql', 'ba5bf355c803f71df427dd2100269ea3109a88a85933edd63c4d676cacc1bfed') on conflict (name) do nothing;
