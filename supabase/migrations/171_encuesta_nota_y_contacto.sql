-- ===========================================================================
-- 171 - Encuestas: una nota libre opcional al final, y el nombre del contacto pasa a opcional
-- ===========================================================================
-- ESCRITA Y NO APLICADA: aplicarla es del orquestador, despues del merge, con migrate-status antes y
-- despues. Va ANTES de desplegar el sitio publico (rtg-encuesta) y el hub de esta rama: el sitio nuevo
-- manda la clave `note`, que la 155 rechaza como «unknown field»; el hub nuevo la lee en el select.
--
-- El dueno (2026-10-13), dos mensajes: «add an additional or optional note for the encuestas,» y
-- «when asking do you want somebody from the team to contact you the name is optional, phone or email
-- either one but one».
--
-- QUE TRAE:
--   1. survey_responses.note (text, nula). CHECK: nula, o entre 1 y 1000 caracteres tras btrim (la
--      funcion la guarda recortada y en blanco -> null, como other_text).
--   2. survey_responses_contact, reescrita: con wants_contact, el nombre es OPCIONAL (si viene, 1-120)
--      y sigue haciendo falta telefono O correo; sin wants_contact, los tres nulos (igual que la 155).
--   3. submit_survey_response(jsonb): la definicion VIGENTE es la de la 155 (ninguna migracion
--      posterior la toca; grep de submit_survey_response en supabase/migrations, 2026-10-13). Se copia
--      su cuerpo y se cambia solo: 'note' en la lista de campos admitidos; el nombre deja de exigirse;
--      la nota se lee, se limita a 1000 y se inserta. `create or replace` con la misma firma conserva
--      los privilegios (encuesta_web y service_role ejecutan; anon y authenticated no): la
--      autocomprobacion lo mira.
--
-- LO QUE NO TOCA: ninguna fila (no hay UPDATE ni INSERT). Ninguna politica, ningun rol, ningun grant.
-- Las filas que ya existen siguen pasando: todas tienen nombre si pidieron contacto (la 155 lo exigia),
-- y la regla nueva es mas floja que la vieja; `note` nace nula en todas.
--
-- COMPATIBLE HACIA ATRAS: el sitio viejo (sin la clave `note`) sigue funcionando con la 171, porque
-- survey_payload_text trata la clave ausente como null. Por eso la 171 puede ir primero sin cortar nada.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. La columna y su CHECK.
-- ---------------------------------------------------------------------------
alter table public.survey_responses add column if not exists note text;

alter table public.survey_responses drop constraint if exists survey_responses_note;
alter table public.survey_responses add constraint survey_responses_note check (
  note is null or length(btrim(note)) between 1 and 1000
);

-- ---------------------------------------------------------------------------
-- 2. La regla de contacto. La 155 decia: nombre obligatorio (1-120) y telefono o correo.
-- ---------------------------------------------------------------------------
alter table public.survey_responses drop constraint if exists survey_responses_contact;
alter table public.survey_responses add constraint survey_responses_contact check (
  case when wants_contact
       then (contact_name is null or length(btrim(contact_name)) between 1 and 120)
            and (contact_phone is not null or contact_email is not null)
       else contact_name is null and contact_phone is null and contact_email is null end
);

-- ---------------------------------------------------------------------------
-- 3. La puerta del sitio publico. Cuerpo de la 155 con los tres cambios de arriba.
-- ---------------------------------------------------------------------------
create or replace function public.submit_survey_response(payload jsonb)
  returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_key     text;
  v_area    text;
  v_el      jsonb;
  v_nothing boolean;
  v_areas   text[] := '{}';
  v_other   text;
  v_ratings jsonb;
  v_wants   boolean;
  v_name    text;
  v_phone   text;
  v_email   text;
  v_note    text;
  v_id      uuid;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'survey: the payload must be a JSON object' using errcode = '22023';
  end if;
  if length(payload::text) > 8000 then
    raise exception 'survey: the payload is too large' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(payload) loop
    if v_key not in ('nothing_to_improve', 'selected_areas', 'other_text', 'ratings', 'wants_contact',
                     'contact_name', 'contact_phone', 'contact_email', 'note') then
      raise exception 'survey: unknown field "%"', v_key using errcode = '22023';
    end if;
  end loop;

  -- Tipos.
  if jsonb_typeof(payload -> 'nothing_to_improve') is distinct from 'boolean' then
    raise exception 'survey: nothing_to_improve must be true or false' using errcode = '22023';
  end if;
  v_nothing := (payload ->> 'nothing_to_improve')::boolean;
  if jsonb_typeof(payload -> 'wants_contact') is distinct from 'boolean' then
    raise exception 'survey: wants_contact must be true or false' using errcode = '22023';
  end if;
  v_wants := (payload ->> 'wants_contact')::boolean;
  if jsonb_typeof(payload -> 'selected_areas') is distinct from 'array' then
    raise exception 'survey: selected_areas must be a list' using errcode = '22023';
  end if;
  if jsonb_typeof(payload -> 'ratings') is distinct from 'object' then
    raise exception 'survey: ratings must be an object' using errcode = '22023';
  end if;
  v_ratings := payload -> 'ratings';

  -- Areas: claves conocidas y sin repetir.
  for v_el in select value from jsonb_array_elements(payload -> 'selected_areas') loop
    if jsonb_typeof(v_el) <> 'string' then
      raise exception 'survey: every selected area must be a text key' using errcode = '22023';
    end if;
    v_area := v_el #>> '{}';
    if v_area not in ('staff_service', 'wait_time', 'product_availability', 'product_quality',
                      'pricing', 'delivery_pickup', 'returns_exchanges', 'other') then
      raise exception 'survey: unknown area "%"', v_area using errcode = '22023';
    end if;
    if v_area = any(v_areas) then
      raise exception 'survey: area "%" is repeated', v_area using errcode = '22023';
    end if;
    v_areas := v_areas || v_area;
  end loop;

  v_other := public.survey_payload_text(payload, 'other_text');
  v_name  := public.survey_payload_text(payload, 'contact_name');
  v_phone := public.survey_payload_text(payload, 'contact_phone');
  v_email := public.survey_payload_text(payload, 'contact_email');
  v_note  := public.survey_payload_text(payload, 'note');

  -- «Nada, todo estuvo bien» es exclusiva.
  if v_nothing then
    if cardinality(v_areas) > 0 then
      raise exception 'survey: "nothing to improve" cannot be combined with other areas' using errcode = '22023';
    end if;
  elsif cardinality(v_areas) = 0 then
    raise exception 'survey: choose at least one area, or "nothing to improve"' using errcode = '22023';
  end if;

  -- «Other» exige su texto; sin «Other», no hay texto.
  if 'other' = any(v_areas) then
    if v_other is null then
      raise exception 'survey: "other" needs its text' using errcode = '22023';
    end if;
    if length(v_other) > 500 then
      raise exception 'survey: other_text is longer than 500 characters' using errcode = '22023';
    end if;
  elsif v_other is not null then
    raise exception 'survey: other_text is only for the "other" area' using errcode = '22023';
  end if;

  -- Calificaciones: exactamente las areas elegidas, cada una un entero del 1 al 5.
  for v_key in select jsonb_object_keys(v_ratings) loop
    if not (v_key = any(v_areas)) then
      raise exception 'survey: rating for "%", which was not selected', v_key using errcode = '22023';
    end if;
  end loop;
  foreach v_area in array v_areas loop
    if not (v_ratings ? v_area) then
      raise exception 'survey: missing rating for "%"', v_area using errcode = '22023';
    end if;
    if jsonb_typeof(v_ratings -> v_area) <> 'number' or (v_ratings -> v_area)::text !~ '^[1-5]$' then
      raise exception 'survey: the rating for "%" must be a whole number from 1 to 5', v_area using errcode = '22023';
    end if;
  end loop;

  -- Contacto. El nombre es opcional (171); telefono o correo, al menos uno.
  if v_wants then
    if v_name is not null and length(v_name) > 120 then
      raise exception 'survey: the name is longer than 120 characters' using errcode = '22023';
    end if;
    if v_phone is null and v_email is null then
      raise exception 'survey: a phone or an email is required to be contacted' using errcode = '22023';
    end if;
    if v_phone is not null and (length(v_phone) > 30 or v_phone !~ '^[0-9+().[:space:]-]+$') then
      raise exception 'survey: the phone number is not valid' using errcode = '22023';
    end if;
    if v_phone is not null and length(regexp_replace(v_phone, '[^0-9]', '', 'g')) not between 7 and 15 then
      raise exception 'survey: the phone number must have 7 to 15 digits' using errcode = '22023';
    end if;
    if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
      raise exception 'survey: the email is not valid' using errcode = '22023';
    end if;
  elsif v_name is not null or v_phone is not null or v_email is not null then
    raise exception 'survey: contact details are only kept when wants_contact is true' using errcode = '22023';
  end if;

  -- Nota libre (171): opcional, con o sin contacto.
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'survey: the note is longer than 1000 characters' using errcode = '22023';
  end if;

  insert into public.survey_responses
    (nothing_to_improve, selected_areas, other_text, ratings, wants_contact, contact_name, contact_phone, contact_email, note)
  values
    (v_nothing, v_areas, v_other, v_ratings, v_wants, v_name, v_phone, v_email, v_note)
  returning id into v_id;
  return v_id;
end $$;

-- ===========================================================================
-- Se comprueba a si misma
-- ===========================================================================
do $comprueba$
declare
  def text;
  src text;
begin
  -- La columna, nula y de texto.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'survey_responses'
                    and column_name = 'note' and data_type = 'text' and is_nullable = 'YES') then
    raise exception '171: falta survey_responses.note (text, nula)';
  end if;

  -- Su CHECK.
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conrelid = 'public.survey_responses'::regclass and conname = 'survey_responses_note';
  if def is null or def !~ '1000' then
    raise exception '171: survey_responses_note falta o no limita a 1000: %', def;
  end if;

  -- La regla de contacto: ya no exige el nombre, y sigue exigiendo telefono o correo.
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conrelid = 'public.survey_responses'::regclass and conname = 'survey_responses_contact';
  if def is null then
    raise exception '171: falta survey_responses_contact';
  end if;
  if def !~ 'contact_name IS NULL\) OR' then
    raise exception '171: survey_responses_contact sigue exigiendo el nombre: %', def;
  end if;
  if def !~ 'contact_phone IS NOT NULL\) OR \(contact_email IS NOT NULL' then
    raise exception '171: survey_responses_contact ya no exige telefono o correo: %', def;
  end if;

  -- La funcion: admite 'note', no exige nombre, inserta la nota.
  select prosrc into src from pg_proc where oid = 'public.submit_survey_response(jsonb)'::regprocedure;
  if src !~ '''contact_email'', ''note''\)' then
    raise exception '171: submit_survey_response no admite el campo note';
  end if;
  if src ~ 'a name is required' then
    raise exception '171: submit_survey_response sigue exigiendo el nombre';
  end if;
  if src !~ 'contact_email, note\)' then
    raise exception '171: submit_survey_response no inserta la nota';
  end if;

  -- Los privilegios de la 155 siguen igual tras el create or replace.
  if not has_function_privilege('encuesta_web', 'public.submit_survey_response(jsonb)', 'execute') then
    raise exception '171: encuesta_web ya no puede ejecutar submit_survey_response';
  end if;
  if has_function_privilege('anon', 'public.submit_survey_response(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.submit_survey_response(jsonb)', 'execute') then
    raise exception '171: anon o authenticated pueden ejecutar submit_survey_response';
  end if;
  if has_table_privilege('encuesta_web', 'public.survey_responses', 'select')
     or has_table_privilege('anon', 'public.survey_responses', 'select') then
    raise exception '171: encuesta_web o anon leen survey_responses';
  end if;
end $comprueba$;

-- ===========================================================================
-- Reversion (para pegar A MANO, en una transaccion propia; por eso lleva begin/commit y el fichero no)
-- ---------------------------------------------------------------------------
-- AVISO: volver a la regla de la 155 FALLA si ya hay filas con contacto sin nombre (la restriccion se
-- valida al anadirla). Antes de revertir: select count(*) from public.survey_responses
-- where wants_contact and contact_name is null; -- tiene que dar 0, o decidir que hacer con ellas.
-- El drop de la columna BORRA las notas guardadas.
-- La funcion vuelve a la de la 155: copiar su seccion 5 tal cual (create or replace ... end $$;).
--
--   begin;
--   -- (aqui, la seccion 5 de 155_encuestas.sql, copiada tal cual)
--   alter table public.survey_responses drop constraint if exists survey_responses_contact;
--   alter table public.survey_responses add constraint survey_responses_contact check (
--     case when wants_contact
--          then contact_name is not null and length(btrim(contact_name)) between 1 and 120
--               and (contact_phone is not null or contact_email is not null)
--          else contact_name is null and contact_phone is null and contact_email is null end
--   );
--   alter table public.survey_responses drop constraint if exists survey_responses_note;
--   alter table public.survey_responses drop column if exists note;
--   delete from public.schema_migrations where name = '171_encuesta_nota_y_contacto.sql';
--   commit;
-- El sitio nuevo deja de poder enviar (manda `note`): revertir el sitio ANTES que la base.
-- ===========================================================================

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('171_encuesta_nota_y_contacto.sql', '307794adcbe2753f4fd4df650f1bee5aa76f5d71c3f4b29adb7b1116f4e373e0') on conflict (name) do nothing;
