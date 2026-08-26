-- 076: the extensions clock-in's geofencing needs.
--
-- Its public schema carries 49 functions from `cube` and `earthdistance` —
-- earthdistance is how it decides whether a punch is inside a job site's radius.
-- They are extension code, not clock-in's, so 073 copies the eight functions
-- that ARE its own and the extensions are installed properly here instead.
--
-- Into Supabase's `extensions` schema, the convention on this project, with
-- earthdistance's dependency on cube satisfied first.

create extension if not exists cube          with schema extensions;
create extension if not exists earthdistance with schema extensions;
