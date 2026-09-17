-- 119 · Donde viven los adjuntos de la solicitud de ayuda (rama ayuda-adjuntos)
--
-- El dueño: «en la solicitud de ayuda, que se puedan anadir documentos o fotos». El correo de ayuda ya
-- sale (medido por el orquestador el 2026-09-17: los seis ultimos «Help request from ...» estan
-- entregados, con el remitente de pruebas de Resend). Lo que falta es donde poner los ficheros.
--
-- ---------------------------------------------------------------------------
-- Un cubo aparte, privado
-- ---------------------------------------------------------------------------
-- No se reutiliza ninguno de los que hay. `hr-docs` es de expedientes de la plantilla y solo lo ven
-- admin y gerente de RR. HH. (096); `resumes` es de candidatos; `exception-photos` es de fichaje.
-- Una solicitud de ayuda la manda CUALQUIERA con sesion, y lo que adjunta puede ser una captura de su
-- pantalla con datos de cualquier modulo: mezclarlo con esos tres ampliaria quien ve que.
--
-- 10 MB por fichero, el mismo numero que comprueba la pantalla antes de subir
-- (`lib/help-attachments.ts`). Los tipos tambien se fijan aqui: la pantalla avisa, pero quien manda es
-- el cubo, porque una subida se puede hacer sin pasar por la pantalla.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'help-files', 'help-files', false, 10485760,
  array[
    'image/jpeg','image/png','image/webp','image/heic','image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv','text/plain'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Cada uno, lo suyo
-- ---------------------------------------------------------------------------
-- La primera carpeta de la ruta es el `id` de quien sube (`rutaDeAdjunto`), y de eso vive todo: la
-- politica deja escribir y leer solo dentro de la carpeta propia. El correo no depende de esto —lo
-- firma el servidor con la llave de servicio, que se salta RLS—, pero si de que nadie pueda leer los
-- ficheros de otra persona entrando por la API.
--
-- El admin de Entregas lee todo el cubo: es quien atiende la solicitud si el enlace del correo ya
-- caduco.

drop policy if exists "help files insert own" on storage.objects;
drop policy if exists "help files read own"   on storage.objects;
drop policy if exists "help files read admin" on storage.objects;
drop policy if exists "help files delete own" on storage.objects;

create policy "help files insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'help-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "help files read own" on storage.objects for select to authenticated
  using (bucket_id = 'help-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "help files read admin" on storage.objects for select to authenticated
  using (bucket_id = 'help-files' and (select public.is_admin()));

create policy "help files delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'help-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- Comprobar antes de darla por buena
-- ---------------------------------------------------------------------------
-- El cubo existe, es privado y con sus limites; y hay cuatro politicas suyas, ni una mas.
do $$
declare
  n_privado int;
  n_politicas int;
begin
  select count(*) into n_privado from storage.buckets
   where id = 'help-files' and public = false and file_size_limit = 10485760;
  if n_privado <> 1 then
    raise exception 'el cubo help-files no quedo privado con su limite';
  end if;

  select count(*) into n_politicas from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'help files %';
  if n_politicas <> 4 then
    raise exception 'help-files tiene % politicas, se esperaban 4', n_politicas;
  end if;
end $$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('119_help_files_bucket.sql', 'a10714d6411b23e8f7ac4731f8dda5be60defcacbd6347677714da151c5b2d06') on conflict (name) do nothing;
