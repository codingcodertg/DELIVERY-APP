---
name: supabase-micro-y-tormenta-de-recargas
description: "La instancia de Supabase es Micro (2 vCPU compartidas); una descarga pesada × todos los clientes a la vez la tumba entera, login incluido, y Vercel da 504 en el middleware."
metadata:
  node_type: memory
  type: project
  originSessionId: c96cc13e-19b4-4252-b0bb-6bf99ab6bc92
  modified: 2026-10-15T23:30:28.690Z
---

Caída del 2026-10-15: Supabase (compute **Micro**, max_connections 60, shared_buffers 224 MB) se saturó
porque la lista de órdenes pesaba 6,4 MB (fotos base64 en `deliveries.photos`, duplicadas en `photo_meta`)
y cada bump de `APP_VERSIONS` recargaba a los 7 clientes en el mismo segundo (6 bumps ese día). Con la CPU
agotada **todo** iba 30–100× más lento: `auth/v1/health` 25–30 s, `set_config` de PostgREST 34 ms, y Vercel
cortaba con `504 MIDDLEWARE_INVOCATION_TIMEOUT` (el middleware espera a `auth.getUser()`). La base por dentro
estaba tranquila: 0 locks, 28/60 conexiones, WAL 0; eso despista si solo se mira `pg_stat_activity`.

**Why:** el síntoma («la app en blanco», «carga y nunca carga») parece de cliente o de red; la causa era CPU de
la VM compartida por Kong+GoTrue+PostgREST+Realtime. Se recuperaba sola en cuanto paraban las recargas.

**How to apply:** si vuelve «todo lento a la vez» (login incluido), medir `auth/v1/health` y una consulta
trivial con `curl -w %{time_total}` antes de buscar en Postgres; mirar `pg_stat_statements` diferencial
(60 s) y el peso de la lista (`select *` de deliveries en KB). Agrupar releases: cada bump de versión sigue
siendo una recarga de todos, aunque desde D-563 vaya escalonada 0–5 min. Las fotos siguen en base64 dentro de
la fila (pendiente: Storage) y `photo_meta` las duplica. Ver [[vercel-100-deploys-al-dia]] y
[[comprobar-la-capa-que-manda]].
