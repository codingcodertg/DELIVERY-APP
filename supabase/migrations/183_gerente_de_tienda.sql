-- 183: RR. HH. — rol «Gerente de tienda» (store_manager): ve y resuelve solo los candidatos de SU tienda
-- que se mandaron a entrevista presencial (D-NEXT, 2026-10-19).
--
-- Qué había: en RR. HH. hay tres niveles (admin | manager = Office Manager | recruiter) y los tres ven TODOS
-- los candidatos: cada política de `recruiting.*` es `has_recruiting_access()`. El dueño pide que el gerente
-- de cada tienda vea «solo los de su tienda, los que yo mando a la tienda de ellos», y pueda decir
-- contratar / no contratar con razón.
--
-- Qué hace (aditivo; admin, Office Manager y reclutador NO cambian):
--   1. `profiles.recruiting_role` admite 'store_manager'. Su tienda es `profiles.store`, la misma del hub
--      que usa Entregas (D-405). Sin tienda, no ve ningún candidato.
--   2. `public.recruiting_candidate_visible(location, status)`: para quien NO es store_manager, true (como
--      hoy). Para el store_manager: el candidato está en 'inperson', 'hired' o 'discarded' Y su `location`
--      («Edinburg», como lo escribe RR. HH.) es una palabra entera del `store` del perfil («RDZ Edinburg»).
--   3. candidates: leer y escribir solo lo visible (USING y WITH CHECK: no puede mover un candidato a otra
--      tienda ni a una etapa fuera de esas tres).
--   4. contacts, attachments, stage_history: el store_manager solo las filas de candidatos que puede ver.
--      El `exists` sobre candidates corre con la RLS del propio usuario, así que hereda el punto 3.
--   5. jobs, question_sets, questions, stages, templates, custom_fields: el store_manager solo LEE
--      (son los catálogos que la app carga para pintar); escribir sigue siendo de los otros tres roles.
--   6. settings, employee_files, employee_docs: ya listan roles ('admin','manager'); el nuevo rol queda fuera
--      de escribir/leer expedientes sin tocar nada. `settings select` sigue abierto (nombre de la app).
--
-- Reversible: volver a poner las políticas a `has_recruiting_access()` y quitar el valor del check (abajo).

-- 1. El rol -------------------------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_recruiting_role_check;
alter table public.profiles add constraint profiles_recruiting_role_check
  check (recruiting_role is null or recruiting_role in ('admin', 'manager', 'recruiter', 'store_manager'));

-- 2. Qué candidato ve cada cual -------------------------------------------------------------------------
create or replace function public.recruiting_candidate_visible(p_location text, p_status text)
  returns boolean language sql stable security definer set search_path = public as $$
  select case
    when coalesce((select recruiting_role from public.profiles where id = auth.uid()), '') <> 'store_manager' then true
    else coalesce(p_status, '') in ('inperson', 'hired', 'discarded')
      and coalesce(btrim(p_location), '') <> ''
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and coalesce(btrim(p.store), '') <> ''
          and (' ' || lower(p.store) || ' ') like ('% ' || lower(btrim(p_location)) || ' %')
      )
  end
$$;
revoke execute on function public.recruiting_candidate_visible(text, text) from public, anon;
grant  execute on function public.recruiting_candidate_visible(text, text) to authenticated;
comment on function public.recruiting_candidate_visible(text, text) is
  'RR. HH. (183): true para admin/manager/recruiter; para store_manager, solo candidatos de su tienda (profiles.store, por palabra entera) en inperson/hired/discarded.';

create or replace function public.is_recruiting_store_manager()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select recruiting_role from public.profiles where id = auth.uid()), '') = 'store_manager'
$$;
revoke execute on function public.is_recruiting_store_manager() from public, anon;
grant  execute on function public.is_recruiting_store_manager() to authenticated;

-- 3. candidates ----------------------------------------------------------------------------------------
alter policy "recruiting read candidates" on recruiting.candidates
  using ((select has_recruiting_access()) and public.recruiting_candidate_visible(location, status));
alter policy "recruiting write candidates" on recruiting.candidates
  using ((select has_recruiting_access()) and public.recruiting_candidate_visible(location, status))
  with check ((select has_recruiting_access()) and public.recruiting_candidate_visible(location, status));

-- 4. Lo que cuelga de un candidato ----------------------------------------------------------------------
alter policy "recruiting read contacts" on recruiting.contacts
  using ((select has_recruiting_access())
    and (not (select public.is_recruiting_store_manager()) or exists (select 1 from recruiting.candidates c where c.id = candidate_id)));
alter policy "recruiting write contacts" on recruiting.contacts
  using ((select has_recruiting_access())
    and (not (select public.is_recruiting_store_manager()) or exists (select 1 from recruiting.candidates c where c.id = candidate_id)))
  with check ((select has_recruiting_access())
    and (not (select public.is_recruiting_store_manager()) or exists (select 1 from recruiting.candidates c where c.id = candidate_id)));

alter policy "recruiting read attachments" on recruiting.attachments
  using ((select has_recruiting_access())
    and (not (select public.is_recruiting_store_manager()) or exists (select 1 from recruiting.candidates c where c.id = candidate_id)));
alter policy "recruiting write attachments" on recruiting.attachments
  using ((select has_recruiting_access())
    and (not (select public.is_recruiting_store_manager()) or exists (select 1 from recruiting.candidates c where c.id = candidate_id)))
  with check ((select has_recruiting_access())
    and (not (select public.is_recruiting_store_manager()) or exists (select 1 from recruiting.candidates c where c.id = candidate_id)));

alter policy "stage_history select" on recruiting.stage_history
  using (has_recruiting_access()
    and (not (select public.is_recruiting_store_manager()) or exists (select 1 from recruiting.candidates c where c.id = candidate_id)));

-- 5. Catálogos: el store_manager solo lee -------------------------------------------------------------------
alter policy "recruiting write jobs" on recruiting.jobs
  using ((select has_recruiting_access()) and not (select public.is_recruiting_store_manager()))
  with check ((select has_recruiting_access()) and not (select public.is_recruiting_store_manager()));
alter policy "recruiting write question_sets" on recruiting.question_sets
  using ((select has_recruiting_access()) and not (select public.is_recruiting_store_manager()))
  with check ((select has_recruiting_access()) and not (select public.is_recruiting_store_manager()));
alter policy "recruiting write questions" on recruiting.questions
  using ((select has_recruiting_access()) and not (select public.is_recruiting_store_manager()))
  with check ((select has_recruiting_access()) and not (select public.is_recruiting_store_manager()));
alter policy "recruiting write stages" on recruiting.stages
  using ((select has_recruiting_access()) and not (select public.is_recruiting_store_manager()))
  with check ((select has_recruiting_access()) and not (select public.is_recruiting_store_manager()));
alter policy "recruiting write templates" on recruiting.templates
  using ((select has_recruiting_access()) and not (select public.is_recruiting_store_manager()))
  with check ((select has_recruiting_access()) and not (select public.is_recruiting_store_manager()));
alter policy "recruiting write custom_fields" on recruiting.custom_fields
  using ((select has_recruiting_access()) and not (select public.is_recruiting_store_manager()))
  with check ((select has_recruiting_access()) and not (select public.is_recruiting_store_manager()));

-- Para deshacer:
--   alter policy "recruiting read candidates" on recruiting.candidates using ((select has_recruiting_access()));
--   (ídem las demás políticas de arriba, a `(select has_recruiting_access())` / `has_recruiting_access()`)
--   drop function if exists public.recruiting_candidate_visible(text, text);
--   drop function if exists public.is_recruiting_store_manager();
--   alter table public.profiles drop constraint profiles_recruiting_role_check;
--   alter table public.profiles add constraint profiles_recruiting_role_check
--     check (recruiting_role is null or recruiting_role in ('admin','manager','recruiter'));
--   (antes, poner a null el recruiting_role de quien tenga 'store_manager')

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('183_gerente_de_tienda.sql', '3da4bd8fb180ae4f7bef17a0921ff4014e89981374e771f4ae381d4ee354459b') on conflict (name) do nothing;
