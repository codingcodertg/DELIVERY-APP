-- 096 · Dónde viven los papeles del expediente (D-158)
--
-- El expediente (D-145) guarda `file_path` desde el primer día y la pantalla ya sabe abrir un
-- documento con enlace firmado. Lo que no había era **dónde ponerlos**, y por eso el botón de
-- subir se quedó fuera a propósito.
--
-- ---------------------------------------------------------------------------
-- Un cubo aparte, y no `resumes`
-- ---------------------------------------------------------------------------
-- Lo fácil era reutilizar `resumes`, que ya existe y ya está bajo `has_recruiting_access()`.
-- Se descarta por dos razones, y la segunda pesa más:
--
--   1. `resumes` guarda currículums de **candidatos** — gente de fuera que se apuntó a una
--      oferta. Aquí van antidopings, amonestaciones y licencias de la **plantilla**. Mezclar
--      los dos hace imposible responder "bórrame lo mío" de un candidato sin mirar uno a uno.
--   2. `has_recruiting_access()` incluye al **reclutador**, y la 094 acaba de decidir
--      justamente que el reclutador no ve expedientes. Meter los ficheros en `resumes`
--      reabriría por la puerta de atrás lo que se cerró por la de delante: las filas
--      protegidas y los PDF a la vista.
--
-- El cubo es privado. Nada de aquí se sirve por URL pública; se firma un enlace de una hora
-- cuando alguien pulsa "Ver".

insert into storage.buckets (id, name, public, file_size_limit)
values ('hr-docs', 'hr-docs', false, 26214400)   -- 25 MB: un PDF escaneado cabe de sobra
on conflict (id) do update set public = false, file_size_limit = 26214400;

-- ---------------------------------------------------------------------------
-- Quién puede, con la MISMA regla que las tablas
-- ---------------------------------------------------------------------------
-- Admin y gerente de RR. HH., igual que en la 094. Que las dos mitades del expediente —las
-- filas y los ficheros— se rijan por la misma condición no es elegancia: es que si se
-- escriben distinto, un día se cambia una y la otra se queda, y nadie se entera hasta que
-- alguien ve un PDF que no debía.

drop policy if exists "hr docs read"   on storage.objects;
drop policy if exists "hr docs insert" on storage.objects;
drop policy if exists "hr docs update" on storage.objects;
drop policy if exists "hr docs delete" on storage.objects;

create policy "hr docs read" on storage.objects for select to authenticated
  using (bucket_id = 'hr-docs' and (select public.current_recruiting_role()) in ('admin','manager'));

create policy "hr docs insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-docs' and (select public.current_recruiting_role()) in ('admin','manager'));

create policy "hr docs update" on storage.objects for update to authenticated
  using (bucket_id = 'hr-docs' and (select public.current_recruiting_role()) in ('admin','manager'));

create policy "hr docs delete" on storage.objects for delete to authenticated
  using (bucket_id = 'hr-docs' and (select public.current_recruiting_role()) in ('admin','manager'));
