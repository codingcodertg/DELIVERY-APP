-- 145 - Un cubo para la pagina del tracker, con URL fija
-- ===========================================================================
-- El dueno quiere abrirlo «en la nube», y sin una URL fija no lo tiene: hoy la pagina es un fichero
-- que hay que mandarle cada vez. Con esto vive en una direccion que abre desde el celular.
--
-- **Publico de solo lectura, y eso es una decision, no un descuido.** Lo que se sube es la PAGINA,
-- que no lleva ni una tarea dentro: las pide al abrirse con la sesion de quien mira, y la RLS de la
-- 144 decide que ve. Asi que publicar el fichero no publica nada del dueno.
--
-- La consecuencia, dicha: **el dia que alguien meta los datos dentro de la pagina «para que cargue
-- mas rapido», los estara publicando**. Por eso la prueba de `nube.test.mjs` afirma que la pagina no
-- lleva ninguna tarea, y por eso esta migracion va aparte de la 144: revertir una no obliga a
-- revertir la otra.
--
-- Sin begin/commit propios, a proposito (lo envuelve quien aplica).
-- ===========================================================================

insert into storage.buckets (id, name, public)
  values ('tracker', 'tracker', true)
  on conflict (id) do update set public = true;

-- Lectura publica, SOLO de este cubo. Se escribe explicita aunque el cubo sea `public`, para que la
-- regla se lea en `pg_policies` y no dependa de un ajuste que alguien puede voltear desde el panel.
drop policy if exists "tracker bucket lectura publica" on storage.objects;
create policy "tracker bucket lectura publica" on storage.objects
  for select to public using (bucket_id = 'tracker');

-- Escribir, solo service-role (el script de subida). Ni el admin con su sesion: la pagina se genera
-- desde el repo, no se edita en la nube, y dejar que alguien la sustituya desde el navegador seria
-- dejar que sustituya lo que el dueno ve.
do $srv$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'drop policy if exists "tracker bucket escribe service_role" on storage.objects';
    execute 'create policy "tracker bucket escribe service_role" on storage.objects '
         || 'for all to service_role using (bucket_id = ''tracker'') with check (bucket_id = ''tracker'')';
  end if;
end $srv$;

do $chk$
begin
  if not exists (select 1 from storage.buckets where id = 'tracker' and public) then
    raise exception '145: el cubo tracker no existe o no es publico';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'tracker bucket lectura publica') then
    raise exception '145: falta la politica de lectura publica del cubo tracker';
  end if;
end $chk$;

-- Reversion (a mano):
--   drop policy if exists "tracker bucket lectura publica" on storage.objects;
--   drop policy if exists "tracker bucket escribe service_role" on storage.objects;
--   delete from storage.objects where bucket_id = 'tracker';
--   delete from storage.buckets where id = 'tracker';
--   delete from public.schema_migrations where name = '145_tracker_bucket.sql';

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('145_tracker_bucket.sql', 'a101638057adf05e3f59b39cf94d3cd87fde0e72601910c52f601310267d3777') on conflict (name) do nothing;
