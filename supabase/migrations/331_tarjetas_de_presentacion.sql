-- ===========================================================================
-- 331 - Tarjetas de presentación (NFC): una tarjeta digital por persona, dentro de RTG Hub
-- ===========================================================================
-- ESCRITA Y NO APLICADA: aplicarla es del dueño, con migrate-status antes y después. Sin la línea del ledger (la pone
-- quien aplica, al final del fichero, bajo «-- @ledger-below»).
--
-- QUE HACE. Sustituye la base del contratista (Axen) para las tarjetas NFC. Cada persona tiene una fila en
-- `public.business_cards`; la página pública `businesscard.rdztilegroup.com/<slug>` la lee SOLO por la función
-- `business_card_public`. La persona cambia su foto por un enlace privado (`/editar?token=…`) que usa
-- `business_card_by_token` y `business_card_set_media`.
--
-- DONDE VIVE. En `public` (como las demás apps: PostgREST ya lo expone) y en el bucket `business-cards`, PÚBLICO,
-- porque las fotos salen en una página sin login. Un bucket público se lee por URL, sin política de lectura.
--
-- SEGURIDAD.
--   - RLS en la tabla. Solo el admin (`public.is_admin()`) lee y escribe; anon y authenticated no tienen grants de
--     tabla más allá de lo que la RLS deja al admin. Un no admin no ve ni una fila.
--   - Lo público es una función `security definer` con `search_path` vacío: devuelve SOLO los campos públicos y solo
--     de una tarjeta ACTIVA. Nunca devuelve `edit_token`, `profile_id` ni quién la editó.
--   - El token de edición (64 hex) tiene su propio índice único, se compara exacto y nunca sale por una lectura pública.
--   - `business_card_set_media` valida que la ruta de la foto esté dentro de la carpeta de ESA tarjeta (su id) y con
--     el nombre que pone la app. Un token que no es de la tarjeta no escribe nada.
--   - El bucket solo deja escribir al admin (directo). Las fotos del editor las sube la ruta de servidor
--     (`/api/tarjetas/foto`) con la llave de servicio, después de validar el token, el tipo y el tamaño.
--   - El bucket fija su propio tope (5 MB) y los tipos (jpeg, png, webp).
--
-- LO QUE NO TOCA. Ninguna tabla, función, política ni dato existente.
--
-- Sin begin/commit propios: quien aplica envuelve el fichero en una transacción.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. La tarjeta de cada persona.
-- ---------------------------------------------------------------------------
create table if not exists public.business_cards (
  id            uuid primary key default gen_random_uuid(),
  -- Lo que va después del dominio. Minúsculas, números y guiones; sin guion al principio, al final ni doble.
  slug          text not null,
  full_name     text not null,
  role_es       text not null default '',
  role_en       text not null default '',
  -- La tienda de base, una de las seis claves de la app (o ninguna: una persona «floater»).
  store         text,
  -- El teléfono de la tienda (línea de la tienda) y el celular, tal como los escribe el admin.
  phone         text not null default '',
  whatsapp      text not null default '',
  email         text not null default '',
  -- Rutas dentro del bucket `business-cards` (`<id>/foto-<ms>.jpg`). Null = sin foto / sin portada.
  photo_path    text,
  cover_path    text,
  active        boolean not null default true,
  -- Vínculo opcional con la persona en el hub (su perfil). No da acceso a nada.
  profile_id    uuid references public.profiles(id) on delete set null,
  -- El enlace privado para cambiar la foto. 64 caracteres hex, único.
  edit_token    text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  created_by    uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint business_cards_slug_key unique (slug),
  constraint business_cards_token_key unique (edit_token),
  constraint business_cards_slug_chk check (
    char_length(slug) between 2 and 60
    and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and slug not in ('editar', 'api', 'tarjeta', 'tarjetas', 'track', 'login', 'auth', 'unsubscribe', 'reset-password',
                     'change-password', 'no-access', 'device-blocked', 'web-blocked', 'monitoring', 'no-encontrada', '_next')
  ),
  constraint business_cards_name_chk check (char_length(btrim(full_name)) between 1 and 120),
  constraint business_cards_store_chk check (
    store is null or store in ('brownsville', 'pharr', 'mcallen', 'edinburg', 'mission', 'weslaco')
  ),
  constraint business_cards_token_chk check (edit_token ~ '^[a-f0-9]{64}$')
);

alter table public.business_cards enable row level security;

drop policy if exists "admin read business_cards" on public.business_cards;
create policy "admin read business_cards" on public.business_cards
  for select to authenticated using (public.is_admin());

drop policy if exists "admin insert business_cards" on public.business_cards;
create policy "admin insert business_cards" on public.business_cards
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admin update business_cards" on public.business_cards;
create policy "admin update business_cards" on public.business_cards
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin delete business_cards" on public.business_cards;
create policy "admin delete business_cards" on public.business_cards
  for delete to authenticated using (public.is_admin());

revoke all on public.business_cards from anon, authenticated;
grant select, insert, update, delete on public.business_cards to authenticated;

create index if not exists business_cards_active_idx on public.business_cards (active);

-- ---------------------------------------------------------------------------
-- 2. Lo público: la tarjeta activa, solo con sus campos públicos.
-- ---------------------------------------------------------------------------
create or replace function public.business_card_public(p_slug text)
  returns table (
    slug text, full_name text, role_es text, role_en text, store text,
    phone text, whatsapp text, email text, photo_path text, cover_path text
  )
  language sql stable security definer set search_path = ''
as $$
  select c.slug, c.full_name, c.role_es, c.role_en, c.store,
         c.phone, c.whatsapp, c.email, c.photo_path, c.cover_path
  from public.business_cards c
  where c.slug = p_slug and c.active
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 3. El editor por enlace: leer la propia tarjeta y cambiar su foto o su portada.
-- ---------------------------------------------------------------------------
create or replace function public.business_card_by_token(p_token text)
  returns table (
    slug text, full_name text, role_es text, role_en text, store text,
    phone text, whatsapp text, email text, photo_path text, cover_path text
  )
  language sql stable security definer set search_path = ''
as $$
  select c.slug, c.full_name, c.role_es, c.role_en, c.store,
         c.phone, c.whatsapp, c.email, c.photo_path, c.cover_path
  from public.business_cards c
  where length(p_token) = 64 and c.edit_token = p_token and c.active
  limit 1;
$$;

-- Devuelve true si cambió la tarjeta; false si el token no es de una tarjeta activa. Una ruta fuera de la carpeta de
-- la tarjeta es un error (22023), no un false: quien la manda no está usando la app.
create or replace function public.business_card_set_media(p_token text, p_photo_path text, p_cover_path text)
  returns boolean
  language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  select c.id into v_id
  from public.business_cards c
  where length(p_token) = 64 and c.edit_token = p_token and c.active
  limit 1;
  if v_id is null then
    return false;
  end if;
  if p_photo_path is not null and p_photo_path !~ ('^' || v_id::text || '/(foto|portada)-[0-9]{1,15}\.(jpg|png|webp)$') then
    raise exception 'ruta de foto fuera de la tarjeta' using errcode = '22023';
  end if;
  if p_cover_path is not null and p_cover_path !~ ('^' || v_id::text || '/(foto|portada)-[0-9]{1,15}\.(jpg|png|webp)$') then
    raise exception 'ruta de portada fuera de la tarjeta' using errcode = '22023';
  end if;
  update public.business_cards
     set photo_path = coalesce(p_photo_path, photo_path),
         cover_path = coalesce(p_cover_path, cover_path),
         updated_at = now()
   where id = v_id;
  return true;
end;
$$;

revoke all on function public.business_card_public(text) from public;
revoke all on function public.business_card_by_token(text) from public;
revoke all on function public.business_card_set_media(text, text, text) from public;
grant execute on function public.business_card_public(text) to anon, authenticated;
grant execute on function public.business_card_by_token(text) to anon, authenticated;
grant execute on function public.business_card_set_media(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Las fotos: bucket PÚBLICO (salen en una página sin login), solo el admin escribe directo.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-cards', 'business-cards', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "admin write business-cards" on storage.objects;
create policy "admin write business-cards" on storage.objects
  for all to authenticated
  using (bucket_id = 'business-cards' and public.is_admin())
  with check (bucket_id = 'business-cards' and public.is_admin());

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('331_tarjetas_de_presentacion.sql', '3e21de382b6857cb659a2faba47a77b8a13394f916263918e47d91cf4e6b96b8') on conflict (name) do nothing;
