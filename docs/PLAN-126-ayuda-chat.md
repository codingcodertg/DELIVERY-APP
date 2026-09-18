# PLAN 126 — Una solicitud de ayuda es una conversación

> Plan en papel **antes** de tocar RLS y disparadores, como pide `CLAUDE.md`. La migración
> `126_ayuda_chat.sql` está escrita y **no aplicada**: la ensaya y la aplica el orquestador, con el OK
> del dueño y respaldo. Fecha: 2026-09-18.

## 1. El pedido

El dueño: *«work on a help chat feature so i can chat with the people and be back and forth»*.

Hoy es de un solo sentido: la persona escribe (`help_requests`, 120), el admin la atiende y se le avisa
(D-301), fin.

## 2. Lo medido

- **`help_requests`: la 120 es la única migración que la toca** (`grep help_requests
  supabase/migrations`: 119 —solo el cubo— y 120). Tres políticas: select = `is_admin()` o
  `user_id = auth.uid()`; insert = `user_id = auth.uid()`; update = solo admin. Sin DELETE. El
  disparador `guard_help_request_immutable` deja cambiar solo el estado y el resultado del correo,
  también a la llave de servicio.
- **Cubo `help-files` (119):** privado, carpeta = uid. Lee el dueño de la carpeta y el admin. Un
  fichero que suba un admin queda en **su** carpeta y la persona no puede abrirlo.
- **El botón de ayuda solo está en Entregas** (`src/app/(app)/layout.tsx` y `LocalApp.tsx`). Medido por
  el orquestador (2026-09-18): 1 de 37 perfiles no tiene acceso a Entregas.
- **Nadie ve sus solicitudes pasadas:** la RLS lo permite, ninguna pantalla las lista.
- **`notifications` (001):** leer = las propias; insertar = cualquiera con sesión. La lee solo el
  `DataProvider` de Entregas; el hub no tiene campana. **4 admins**, los 4 con Entregas (orquestador).
- **Tiempo real:** `help_requests` no está en `supabase_realtime` (orquestador). `profiles select` es
  `using (true)`.
- `is_admin()` vigente: 099 (`current_user_role() = 'admin'`, `security definer`).

## 3. Inventario: qué se crea, y quién lee y escribe qué

| Objeto | Lee | Escribe | Nota |
|---|---|---|---|
| `help_messages` | quien abrió la solicitud · admin | los mismos, **en su propio nombre** | sin UPDATE ni DELETE: ni política, ni permiso, y un disparador que lo rechaza también a service role |
| `help_reads` | cada uno **su** fila | cada uno **su** fila, solo de hilos en los que participa | la hora la pone la base |
| `can_see_help_request(uuid)` | — | — | `security definer`; la única pregunta «¿participa?»; sin `execute` para `anon`/`public` |
| `help_message_before_insert` | `profiles`, `help_requests` | `NEW` | nombre y hora de la base; adjuntos solo de quien la abrió y de su carpeta |
| `help_message_after_insert` | `help_requests`, `help_messages`, `profiles` | `help_requests` (reabrir) · `notifications` (avisar) | `security definer` |
| `guard_help_message_immutable` | `help_requests` | — | deja pasar solo el `set null` del autor y la cascada |
| publicación `supabase_realtime` | — | + `help_messages` | un canal por hilo abierto |

**No se toca:** `help_requests` (ni tabla, ni políticas, ni su guardia), `notifications` (ni esquema ni
políticas), `storage.objects`, `profiles`.

## 4. Políticas, literales

```sql
create policy "help_messages select" on public.help_messages for select to authenticated
  using ((select public.can_see_help_request(request_id)));
create policy "help_messages insert" on public.help_messages for insert to authenticated
  with check (author_id = (select auth.uid()) and (select public.can_see_help_request(request_id)));

create policy "help_reads select own" on public.help_reads for select to authenticated
  using (user_id = (select auth.uid()));
create policy "help_reads insert own" on public.help_reads for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.can_see_help_request(request_id)));
create policy "help_reads update own" on public.help_reads for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.can_see_help_request(request_id)));
```

**Una por comando, ninguna `FOR ALL`.** Las permisivas se suman con OR y una `ALL` también lee: una de
más abre lo que las otras cierran (lección de la 124). La autocomprobación cuenta políticas (2 y 3) y
revienta si alguna es `ALL`.

**Permisos:** `revoke all … from anon, authenticated` **antes** del `grant`. En Supabase los
privilegios por defecto de `public` dan todo a esos dos roles sobre cada tabla nueva; un `grant` a
secas no quita nada. *No medido desde la rama*; si los defaults no estuvieran, el `revoke` es inocuo.

## 5. Las reglas que decide el disparador

Son las mismas que `src/lib/help-thread.ts`, y una prueba las compara contra el `.sql`.

- **Reabrir:** solo cuando escribe **quien abrió** la solicitud y estaba `atendida` → `pendiente`,
  `attended_by/at` a null (el check de la 120 lo permite; su guardia no mira esas columnas). Que
  escriba el admin no reabre.
- **Avisar** (solo campana; sin SMS ni correo):
  - escribe un admin → a quien la abrió, si su cuenta existe, en el idioma de la solicitud. **El id
    del aviso es el id del mensaje**, que generó el cliente: así puede pedir el push sin que nadie le
    devuelva una fila de `notifications` que no puede leer (D-308).
  - escribe quien la abrió → **al último admin que escribió en ese hilo**; si ninguno, a **quien la
    atendió**; si tampoco, a **todos** los admins. Siempre admins *de ahora* y nunca el autor. El id lo
    genera la base (pueden ser varias filas).
- **El lado lo decide quién abrió, no el rol:** un admin que pide ayuda es, en su hilo, la persona.

Se descartó avisar desde el cliente: el aviso se podría omitir o falsear, y obligaba a insertar en
`notifications` filas ajenas desde el navegador.

## 6. Qué NO debe romperse

- La 120 entera: la autocomprobación vuelve a contar sus 3 políticas.
- **Borrar un usuario.** `author_id` es `on delete set null`, y eso es un UPDATE sobre `help_messages`:
  el guardia lo deja pasar **solo** si es lo único que cambia y queda a null. Sin esa excepción, borrar
  a alguien que escribió en un hilo fallaría.
- El barrido de D-308 (ningún insert en `notifications` con `.select(`): ninguna pantalla de ayuda
  inserta ahí; lo prueba `help-thread.test.ts`.
- `/api/help` y el correo del primer mensaje: sin cambios. Los mensajes del hilo no mandan correo.

## 7. Matriz de ensayo por rol, con `ROLLBACK`

Completa y comentada al final del `.sql`. Resumen de lo esperado con la 126 aplicada dentro de la
transacción:

| # | Quién | Qué intenta | Resultado |
|---|---|---|---|
| A1 | persona | escribir en su hilo | **PERMITIDO**; si estaba atendida → pendiente; **una** campana, a quien la atendió; `author_name` = el del perfil |
| A2 | persona | escribir con `author_id` de otro | BLOQUEADO (RLS) |
| A3 | persona | escribir en la solicitud de otra persona | BLOQUEADO (RLS) |
| A4/A5 | persona | editar / borrar un mensaje | BLOQUEADO (permiso) |
| A6 | persona | adjuntar un fichero de la carpeta de otro | BLOQUEADO (disparador) |
| A7/A8 | persona | marcar leído lo suyo / lo de otro | PERMITIDO / BLOQUEADO |
| B1–B3 | otra persona | leer, escribir, marcar leído en ese hilo | 0 filas / BLOQUEADO / BLOQUEADO |
| C1 | admin | leer cualquier hilo | todas |
| C2 | admin | contestar con id fijo | **PERMITIDO**; aviso con **ese mismo id** para la persona; **no reabre** |
| C3 | admin | contestar con adjuntos | BLOQUEADO (solo adjunta quien la abrió) |
| C4 | admin | editar / borrar | BLOQUEADO |
| — | persona | vuelve a escribir tras C2 | campana **solo** al admin de C2 |
| D1/D2 | service role | editar / borrar un mensaje | BLOQUEADO (guardia) |
| D3 | service role | borrar la solicitud | PERMITIDO, y se lleva sus mensajes |

## 8. Orden de despliegue

**Migración primero, código después.** Con la 126 aplicada y el código viejo no cambia nada (tablas
vacías que nadie usa). Con el código nuevo y sin la 126, abrir un hilo daría error al leer
`help_messages`. El contador del lobby está escrito para quedarse en cero si esas tablas no existen.

## 9. Reversión

Al final del `.sql`: sacar la tabla de la publicación, `drop` de las dos tablas y de las cinco
funciones, y borrar la fila del ledger. **Borra las conversaciones** (el `.sql` dice cómo guardarlas
antes). `help_requests` no se toca: las solicitudes originales sobreviven. Los avisos ya escritos se
quedan en `notifications`.

## 10. Límites conocidos

- **El admin no adjunta.** Haría falta una política de lectura en `storage.objects` del tipo «puedo
  leer un objeto de `help-files` citado en `files` de un mensaje de un hilo en el que participo».
- **Push solo admin → persona.** Persona → admins es solo campana: son varias filas y no hay un id
  único que el cliente conozca. El hub no tiene campana; allí la señal es el contador de la tarjeta.
- **El botón de ayuda sigue solo en Entregas.** «Mis solicitudes» del hub permite abrir una solicitud
  nueva, que cubre a quien no entra a Entregas.
- El aviso a los admins va en inglés: la base no sabe el idioma de quien lo lee.

## 11. Lo no verificado

- **Nada de esto se ha corrido.** Una rama no toca producción.
- **D3:** que durante un borrado en cascada el disparador del hijo ya no vea la fila del padre. Si no
  fuera así saldría BLOQUEADO; hoy nadie borra solicitudes.
- **Tiempo real:** que `postgres_changes` con filtro por `request_id` respete la política de lectura y
  llegue. Por eso hay red de seguridad (recarga al abrir, al enviar y al volver a la pestaña).
- Los privilegios por defecto de Supabase sobre tablas nuevas (apartado 4).
- Que el `upsert` de `help_reads` por PostgREST pase con estas tres políticas (necesita las tres).
- Nadie ha visto las pantallas en un navegador: en el worktree no hay `.env.local`.
