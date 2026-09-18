# PLAN 132 — La caché de tiempos de viaje

> Plan en papel antes de crear una tabla con RLS, como pide `CLAUDE.md`. La migración está escrita y **no
> aplicada**: la ensaya y la aplica el orquestador. Fecha: 2026-09-18.
> Diseño: `docs/route-algorithm-design.md`, §3 y §5. Es el incremento 3. **Nada visible cambia.**

## 1. Qué es y por qué

El motor de rutas necesita saber cuánto se tarda de un sitio a otro, y preguntárselo a Google cuesta. Hoy la
única caché es la de `/api/optimize-route`: memoria del proceso, 10 minutos, de nadie más
(`optimize-route/route.ts:47`). `travel_time_cache` es una tabla: la comparten todas las corridas y todas las
personas, y re-planificar el mismo día cuesta **cero llamadas**.

## 2. Inventario

| | |
|---|---|
| Tabla | `public.travel_time_cache` — **nueva**; no toca ninguna existente |
| Clave primaria | `(origin_key, dest_key, weekday, block, traffic)` |
| Qué guarda | dos coordenadas redondeadas a 5 decimales, minutos, millas, proveedor y cuándo se pidió. **Nada de nadie:** ni la orden, ni el cliente, ni el chofer |
| Sin tráfico | una fila por par, con `weekday = -1` y `block = -1`; el código la da por caducada a los 90 días |
| Con tráfico | una fila por par, día de la semana (0 = domingo) y media hora de salida (0–47); caduca a los 28 días |
| Quién la lee y la escribe | **solo el servidor**, con la llave de servicio |
| Índice | `(fetched_at) where provider = 'google'` — es lo que cuenta el tope de gasto diario |

## 3. Políticas, literales: **ninguna**

```sql
alter table public.travel_time_cache enable row level security;
revoke all on public.travel_time_cache from anon, authenticated;
grant select, insert, update, delete on public.travel_time_cache to service_role;
```

RLS activada y cero políticas = ningún navegador lee ni escribe, tampoco el admin. La razón no es la
privacidad: quien pudiera **escribir** aquí podría falsear los tiempos con los que se planifican las rutas, y
quien pudiera **llenarla**, hacer gastar. El `grant` a `service_role` va explícito en vez de fiarlo a los
privilegios por defecto: si le faltara, la caché fallaría **en silencio** —el código trata una caché que falla
como una caché vacía, a propósito, para que un fallo de caché no tumbe un plan— y se pagaría todo cada vez.
La autocomprobación lo mira.

## 4. Qué NO debe romperse

Nada existente la usa: es una tabla nueva y este incremento no añade ninguna ruta ni pantalla que la llame. El
código que la usará (`src/lib/route-times/`) llega a producción sin que nadie lo invoque todavía.

## 5. Matriz de ensayo, con `ROLLBACK`

Comentada al final del `.sql`.

| | Caso | Resultado |
|---|---|---|
| A1–A3 | `authenticated` (aunque sea admin) y `anon`: leer, insertar | BLOQUEADO (*permission denied*) |
| B1 | `service_role` inserta una fila sin tráfico | PERMITIDO |
| B2 | la misma clave con `on conflict … do update` | PERMITIDO, sigue habiendo una fila |
| B3 | con tráfico, con día y bloque | PERMITIDO |
| B4–B5 | con tráfico y sin día; sin tráfico y con bloque | BLOQUEADO (`check` de forma) |
| B6 | `block = 48`, `minutes = -1`, `provider = 'otro'` | BLOQUEADO (`check`) |
| B7 | contar las de pago de hoy | el número que usa el tope |

## 6. Reversión

`drop table` y borrar la fila del ledger. No se pierde nada que no se pueda volver a preguntar.

## 7. Lo no verificado

- **Nada de esto se ha corrido.** Una rama no toca producción.
- Que en esta base `set local role service_role` sirva para ensayar B (si no, con la llave de servicio por
  PostgREST en un entorno de pruebas — **no contra Google**).
- **Ninguna llamada real a Google ni a OSRM se ha hecho**, ni se hará en pruebas: los formatos de respuesta
  (`duration: "600s"`, `condition: "ROUTE_EXISTS"`, las matrices de OSRM) están escritos según su documentación
  y la investigación de la Fase 1, no contra una respuesta de verdad. La primera corrida real hay que mirarla.
