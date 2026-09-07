# Cola de encargos tras la auditoría del 2026-09-05

Orquestador: qué se manda al worker, en qué orden y con qué decisión ya tomada.
El dueño dijo "haz lo tuyo" el 2026-09-06: los puntos de clase B que estaban
"a decisión del dueño" se deciden aquí y se anota el porqué en su `D-NEXT`.
Una rama cada vez.

| # | Rama | Qué | Decisión tomada | Estado |
|---|------|-----|-----------------|--------|
| 1 | `tt-textos-restantes` | "Admins only." ×8 → `common.adminsOnly`; `TimeOffRequests.tsx` y resto de TT en inglés a pelo | Solo i18n, sin comportamiento | **fusionado D-206** (PR #22) |
| 2 | `rutas-huerfanas` | G-5 `approvals/page.tsx` sin enlace desde 2026-07-17; G-4 `recruiting/(recruiting)/users/page.tsx` gateada antes de redirigir | **Borrar** approvals (el Board cubre las etapas; 7 semanas sin enlace; vuelve con `git revert`). Mover la redirección de HR fuera del route group | **fusionado D-207** (PR #23) |
| 3 | `guard-rutas-conectado` | G-29 `updateSession` escrito y sin llamar; cierra G-2 (`/login` sin `next`) | Conectar en `src/middleware.ts`, con prueba de las rutas públicas y del `next` | **fusionado D-208** (PR #24) |
| 4 | `carga-diferida` | G-20 `OrderModal.tsx` y `routes/page.tsx` con `dynamic()`; `/` pasa de 588 kB | Medir antes/después con `next build` en el commit | **fusionado D-209** (PR #25): / 590 → 297 kB |
| 5 | `erp-mensajes-servidor` | G-10b: 23 mensajes de `lib/erp` en inglés → códigos + pares en cliente (regla D-201) | Igual que `clock.ts` | **fusionado D-210** (PR #26) |
| 6 | `hr-tema-oscuro` | G-14 una sola regla dark en `recruiting.css`; G-13 colores a pelo en `style={{}}` (empezar por TopBar, ShiftClock, ModalHost) | Variables de `globals.css`; sin rediseño | **fusionado D-211** (PR #27); cola vacía |

Fuera de la cola (del dueño): Maps key, protección de rama, rename de repo y
carpeta, instalador "RTG Hub Setup", VAPID, seguridad diferida, teléfono con GPS
parado desde el 2026-09-02.

## Encargos posteriores a la cola

| # | Rama | Qué | Estado |
|---|------|-----|--------|
| 7 | `fotos-con-ubicacion` | Pedido del dueño 2026-09-06: ubicación GPS de cada foto en Auditoría → Fotos; salir/volver mandan posición | **fusionado D-212** (PR #28) |
