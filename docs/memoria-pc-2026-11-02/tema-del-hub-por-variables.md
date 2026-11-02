---
name: tema-del-hub-por-variables
description: "cómo se viste un módulo con el tema de Entregas sin tocar sus pantallas: Tailwind 4 compila cada color como variable y erp.css las apunta a globals.css; Time Tracker igual con sus --tt-*; qué no abre el demo"
metadata:
  node_type: memory
  type: project
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-10-21T15:52:24.871Z
---

**Desde D-622 (2026-10-21)** el hub tiene UN tema: Inventario (antes ERP), Clientes y Time Tracker se pintan con las
variables de `src/app/globals.css` (`--paper`, `--card`, `--line`, `--gray`, `--ink-soft`, `--text`, `--accent`,
`--accent-soft`, y los tintes de estado de D-226) y con la barra `.topbar` de Entregas.

- **Inventario/Clientes (Tailwind):** `src/app/erp/erp.css` lleva un `@theme` que apunta la rampa (`--color-slate-500:
  var(--gray)`, `--color-clay-500: var(--accent)`, `--color-red-50: var(--red-soft)`…), `--font-sans: 'Inter'`,
  `--radius-md: 8px`, `--radius-lg: 12px`. Claro y oscuro salen solos de `data-theme`. `bg-white` es la única
  excepción por utilidad (`[data-app="erp"] .bg-white { background-color: var(--card) }`), porque `text-white` va
  sobre botones de acento. La barra es `src/components/erp/side-nav.tsx` (mismo nombre y firma, pinta `.topbar`).
- **Time Tracker:** `src/app/timetracker/timetracker.css` define `--tt-bg:var(--paper)` etc.; 370 líneas siguen
  usando `--tt-*`. Sin bloque claro propio.
- RR. HH., Quote Builder, Promos, Leads y Encuestas **no** se tocaron (no se pidió).

**Why:** el dueño pidió «que toda la app se mire igual como deliveries app […] estandarizado e igual». Reescribir
61 ficheros de utilidades era mil ocasiones de dejarse una; apuntar los tokens los viste todos de golpe.

**How to apply:** un color nuevo en un módulo Tailwind se escribe con la rampa `slate`/`clay` (que ya apunta al hub),
no con un hex. Para medir en el demo: Clientes sí abre (`/customers`, barra Demo); **Inventario y Time Tracker no**
(piden sesión): se miran en producción tras publicar. Ver [[revision-visual-en-navegador]].
