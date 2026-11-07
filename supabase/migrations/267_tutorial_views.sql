-- 267: Tutoriales: quien vio cada video (public.tutorial_views) y el conteo para el admin (2026-11-06).
--
-- El pedido (el dueno y Roberto): «Implement tutorial link: add pop-up notifications or a help menu entry for
-- accessing training resources» y «require users to view new videos upon signing in». La rama
-- `tutoriales-aviso-al-entrar` pone el aviso al entrar al hub, la entrada en el menu de Ayuda y las etiquetas
-- «Nuevo» / «Visto» en Tutoriales. Para eso hace falta saber, por persona, que video ya vio. Eso es esto.
--
-- Que hace:
--   1. public.tutorial_views (user_id, tutorial_id, watched_at): una fila por persona y video visto. El video es el
--      `id` del jsonb de settings.tutorials (037/113), texto, sin clave foranea: si el admin quita el video, la fila
--      queda huerfana y no molesta a nadie (las pantallas cruzan contra lo que devuelve public.tutorials()).
--   2. RLS: cada persona lee y escribe SOLO sus filas; el admin del hub (is_admin(), 099) las lee todas. Nadie borra
--      por REST salvo lo propio (para «desmarcar» si hiciera falta). anon no toca nada.
--   3. public.tutorial_view_stats(): para el admin, por video: cuantos de su publico lo vieron y cuantos son. El
--      publico de un video es la MISMA regla que public.tutorials() (115) pero mirada desde cada perfil con cuenta
--      (left_at is null) y SIN los admins del hub: ellos lo ven todo y el aviso se lo pueden quitar; contarlos
--      inflaria el total de todos los videos. Un video sin audiencia cuenta a todo el que tiene acceso a su app.
--
-- ORDEN: se puede aplicar antes o despues de desplegar.
--   - Pantalla nueva sin esta migracion: lee tutorial_views con tolerancia (tabla ausente = nadie ha visto nada y NO
--     se avisa a nadie: el aviso solo sale cuando la base contesta), «Marcar como visto» dice que no se pudo guardar,
--     el conteo del admin no sale. Nada se rompe.
--   - Esta migracion sin la pantalla nueva: una tabla vacia que nadie lee.
--   Lo corto: aplicarla justo despues del merge, como siempre; hasta entonces el aviso no sale.
--
-- Sin begin/commit propios. Para deshacer:
--   drop function if exists public.tutorial_view_stats();
--   drop table if exists public.tutorial_views;
--   delete from public.schema_migrations where name = '267_tutorial_views.sql';

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
create table if not exists public.tutorial_views (
  user_id     uuid        not null references public.profiles (id) on delete cascade,
  tutorial_id text        not null,
  watched_at  timestamptz not null default now(),
  primary key (user_id, tutorial_id)
);
comment on table public.tutorial_views is
  'Que video de tutorial (settings.tutorials[].id) ya vio cada persona. Una fila por persona y video (267).';

create index if not exists tutorial_views_tutorial_idx on public.tutorial_views (tutorial_id);

-- ---------------------------------------------------------------------------
-- 2. RLS: lo propio; el admin lee todo
-- ---------------------------------------------------------------------------
alter table public.tutorial_views enable row level security;

drop policy if exists "tutorial_views: leer lo propio o admin" on public.tutorial_views;
create policy "tutorial_views: leer lo propio o admin" on public.tutorial_views
  for select to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()));

drop policy if exists "tutorial_views: marcar lo propio" on public.tutorial_views;
create policy "tutorial_views: marcar lo propio" on public.tutorial_views
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "tutorial_views: actualizar lo propio" on public.tutorial_views;
create policy "tutorial_views: actualizar lo propio" on public.tutorial_views
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "tutorial_views: desmarcar lo propio" on public.tutorial_views;
create policy "tutorial_views: desmarcar lo propio" on public.tutorial_views
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.tutorial_views from public, anon;
grant select, insert, update, delete on public.tutorial_views to authenticated;

-- ---------------------------------------------------------------------------
-- 3. El conteo para el admin
-- ---------------------------------------------------------------------------
-- Por video: `watched` = personas de su publico con fila en tutorial_views; `total` = su publico. Solo el admin del
-- hub; a cualquier otro le levanta excepcion (no devuelve una lista vacia, que se leeria como «nadie lo vio»).
create or replace function public.tutorial_view_stats()
returns table (
  tutorial_id text,
  watched     integer,
  total       integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only an admin can see who watched the tutorials' using errcode = '42501';
  end if;
  return query
  with videos as (
    select (t.value->>'id')::text as id,
           (t.value->>'app')::text as app,
           array(
             select jsonb_array_elements_text(
                      case when jsonb_typeof(t.value->'roles') = 'array' then t.value->'roles' else '[]'::jsonb end
                    )
           ) as roles,
           t.ordinality
      from public.settings cfg
     cross join lateral jsonb_array_elements(
             case when jsonb_typeof(cfg.tutorials) = 'array' then cfg.tutorials else '[]'::jsonb end
           ) with ordinality as t(value, ordinality)
     where cfg.id = 1
       and nullif(btrim(coalesce(t.value->>'id', '')), '') is not null
  ),
  gente as (
    -- Con cuenta y sin baja, y sin los admins del hub (ver cabecera).
    select p.id,
           p.role                                                   as rol_entregas,
           p.recruiting_role                                        as rol_rrhh,
           p.timetracker_role                                       as rol_tt,
           (select c.role from clockin.profiles c where c.id = p.id) as rol_fichaje,
           p.erp_role                                               as rol_erp,
           ('deliveries' = any(coalesce(p.module_access, '{}')))    as con_entregas,
           (p.recruiting_role is not null)                          as con_rrhh,
           (p.timetracker_role is not null)                         as con_tt,
           (p.timetracker_role is not null)                         as con_fichaje,
           ('erp' = any(coalesce(p.module_access, '{}')))           as con_erp
      from public.profiles p
     where p.left_at is null
       and coalesce(p.role, '') <> 'admin'
  ),
  publico as (
    select v.id as tutorial_id, v.ordinality, g.id as user_id
      from videos v
     cross join gente g
     where case v.app
             when 'recruiting'  then g.con_rrhh    and (cardinality(v.roles) = 0 or g.rol_rrhh    = any(v.roles))
             when 'timetracker' then g.con_tt      and (cardinality(v.roles) = 0 or g.rol_tt      = any(v.roles))
             when 'clockin'     then g.con_fichaje and (cardinality(v.roles) = 0 or g.rol_fichaje = any(v.roles))
             when 'erp'         then g.con_erp     and (cardinality(v.roles) = 0 or g.rol_erp     = any(v.roles))
             else                    g.con_entregas and (cardinality(v.roles) = 0 or g.rol_entregas = any(v.roles))
           end
  )
  select pb.tutorial_id,
         count(tv.user_id)::integer as watched,
         count(*)::integer          as total
    from publico pb
    left join public.tutorial_views tv on tv.tutorial_id = pb.tutorial_id and tv.user_id = pb.user_id
   group by pb.tutorial_id, pb.ordinality
   order by pb.ordinality;
end;
$$;

comment on function public.tutorial_view_stats() is
  'Para el admin del hub: por video de tutorial, cuantas personas de su publico lo vieron (tutorial_views) y cuantas son. El publico es la regla de public.tutorials() (115) vista desde cada perfil sin baja, sin los admins (267).';

revoke execute on function public.tutorial_view_stats() from public, anon;
grant  execute on function public.tutorial_view_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- Comprobacion (lee pg_catalog; no escribe)
-- ---------------------------------------------------------------------------
do $chk$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'tutorial_views' and rowsecurity) then
    raise exception '267: tutorial_views sin RLS';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'tutorial_views') <> 4 then
    raise exception '267: tutorial_views no tiene sus 4 politicas';
  end if;
  if has_table_privilege('anon', 'public.tutorial_views', 'select') then
    raise exception '267: anon lee tutorial_views';
  end if;
  if has_function_privilege('anon', 'public.tutorial_view_stats()', 'execute') then
    raise exception '267: anon ejecuta tutorial_view_stats';
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = 'public.tutorial_view_stats()'::regprocedure) then
    raise exception '267: tutorial_view_stats dejo de ser security definer';
  end if;
end $chk$;

-- Ensayo por rol, con ROLLBACK:
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid de un vendedor>","role":"authenticated"}';
--   insert into public.tutorial_views (user_id, tutorial_id) values ('<ese uuid>', 'v1');         -> 1 fila
--   insert into public.tutorial_views (user_id, tutorial_id) values ('<otro uuid>', 'v1');        -> RLS: rechazado
--   select * from public.tutorial_views;                                                          -> solo las suyas
--   select * from public.tutorial_view_stats();                                                   -> 42501
--   set local request.jwt.claims = '{"sub":"<uuid de un admin>","role":"authenticated"}';
--   select * from public.tutorial_views;                                                          -> todas
--   select * from public.tutorial_view_stats();                                                   -> una fila por video
--   reset role;
--   rollback;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('267_tutorial_views.sql', '2cab3e5108de88b0a3a3f2ba648623259a5081fb6c4356461708f254a793e0dc') on conflict (name) do nothing;
