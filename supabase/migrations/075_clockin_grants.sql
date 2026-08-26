-- 075: GRANTs on the clockin schema.
--
-- RLS decides which rows; Postgres checks plain GRANTs first, and `create schema`
-- grants nothing to anyone but the owner. Same reasoning as 061 and 067.
--
-- anon gets nothing: clock-in has no public surface.

grant usage on schema clockin to authenticated, service_role;

grant all on all tables    in schema clockin to authenticated, service_role;
grant all on all sequences in schema clockin to authenticated, service_role;
grant all on all functions in schema clockin to authenticated, service_role;

alter default privileges in schema clockin grant all on tables    to authenticated, service_role;
alter default privileges in schema clockin grant all on sequences to authenticated, service_role;
alter default privileges in schema clockin grant all on functions to authenticated, service_role;
