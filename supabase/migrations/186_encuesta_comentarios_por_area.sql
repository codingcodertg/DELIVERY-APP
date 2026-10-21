-- 186: Encuesta de clientes — un comentario opcional debajo de cada calificacion (D-620, 2026-10-20).
--
-- El dueño, con la captura del paso 2 del sitio publico: «This step needs an optional box below each for if they want to
-- explain further». El sitio (rtg-encuesta, Vercel) manda la clave nueva `rating_notes` = {"staff": "texto", ...}; la
-- funcion la valida y la guarda en la columna nueva. Compatible hacia atras: sin la clave, '{}'.
--
--   1. survey_responses.rating_notes jsonb not null default '{}'. CHECK: objeto, claves solo de areas elegidas, cada
--      valor texto de 1 a 300 letras (`survey_rating_notes_valid`).
--   2. submit_survey_response: la definicion viva (171) con la clave admitida, la validacion y la columna en el insert.
-- Para deshacer: volver a crear la funcion con la definicion de la 171 y
--   alter table public.survey_responses drop column rating_notes;

alter table public.survey_responses add column if not exists rating_notes jsonb not null default '{}'::jsonb;

create or replace function public.survey_rating_notes_valid(notes jsonb, areas text[])
  returns boolean language sql immutable as $$
  select notes is not null and jsonb_typeof(notes) = 'object'
     and not exists (
       select 1 from jsonb_each(notes) e
        where not (e.key = any(areas))
           or jsonb_typeof(e.value) <> 'string'
           or length(btrim(e.value #>> '{}')) not between 1 and 300
     );
$$;

alter table public.survey_responses drop constraint if exists survey_responses_rating_notes;
alter table public.survey_responses add constraint survey_responses_rating_notes
  check (public.survey_rating_notes_valid(rating_notes, selected_areas));

CREATE OR REPLACE FUNCTION public.submit_survey_response(payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_notes   jsonb;
  v_txt     text;
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
                     'contact_name', 'contact_phone', 'contact_email', 'note', 'rating_notes') then
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
  -- Comentario opcional por area (186): {"staff": "texto", ...}; sin la clave, vacio. Compatible con el sitio viejo.
  v_notes := coalesce(payload -> 'rating_notes', '{}'::jsonb);
  if jsonb_typeof(v_notes) <> 'object' then
    raise exception 'survey: rating_notes must be an object' using errcode = '22023';
  end if;

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

  -- Comentarios por area (186): solo de areas elegidas; texto de 1 a 300 letras recortado; vacio se quita.
  for v_key in select jsonb_object_keys(v_notes) loop
    if v_nothing or not (v_key = any(v_areas)) then
      raise exception 'survey: comment for "%", which was not selected', v_key using errcode = '22023';
    end if;
    if jsonb_typeof(v_notes -> v_key) <> 'string' then
      raise exception 'survey: the comment for "%" must be text', v_key using errcode = '22023';
    end if;
    v_txt := btrim(v_notes ->> v_key);
    if v_txt = '' then
      v_notes := v_notes - v_key;
    elsif length(v_txt) > 300 then
      raise exception 'survey: the comment for "%" is longer than 300 characters', v_key using errcode = '22023';
    else
      v_notes := jsonb_set(v_notes, array[v_key], to_jsonb(v_txt));
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
    (nothing_to_improve, selected_areas, other_text, ratings, wants_contact, contact_name, contact_phone, contact_email, note, rating_notes)
  values
    (v_nothing, v_areas, v_other, v_ratings, v_wants, v_name, v_phone, v_email, v_note, v_notes)
  returning id into v_id;
  return v_id;
end $function$
;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_name = 'survey_responses' and column_name = 'rating_notes') then
    raise exception '186: falta la columna rating_notes';
  end if;
  if position('rating_notes' in pg_get_functiondef('public.submit_survey_response(jsonb)'::regprocedure)) = 0 then
    raise exception '186: submit_survey_response no admite rating_notes';
  end if;
  if not public.survey_rating_notes_valid('{"staff": "ok"}'::jsonb, array['staff']) then raise exception '186: valid falla con un caso bueno'; end if;
  if public.survey_rating_notes_valid('{"staff": "ok"}'::jsonb, array['pricing']) then raise exception '186: valid acepta un area no elegida'; end if;
  if public.survey_rating_notes_valid('{"staff": ""}'::jsonb, array['staff']) then raise exception '186: valid acepta un texto vacio'; end if;
end $$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('186_encuesta_comentarios_por_area.sql', '1389f6e4c51234f78fe9d76b88de19c972c676a42062e65201e604e49f54b2f0') on conflict (name) do nothing;
