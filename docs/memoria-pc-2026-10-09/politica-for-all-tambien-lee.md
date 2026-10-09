---
name: politica-for-all-tambien-lee
description: "Una política RLS FOR ALL permisiva concede SELECT; con otra de lectura al lado, las dos se suman con OR y la de lectura nunca decide. Medido en public.deliveries el 2026-09-17."
metadata: 
  node_type: memory
  type: project
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-18T03:18:57.881Z
---

El 2026-09-17, al ensayar la migración 124 (visibilidad por tienda) con ROLLBACK: el filtro nuevo en
`auth read deliveries` no filtraba nada, y el chofer veía 153 de 153 órdenes *ya antes* aunque su rama
de la 083 debía limitarlo. Causa: `auth write deliveries` (083:69) es `FOR ALL` y permisiva con
`using (has_deliveries_access())`. `FOR ALL` cubre SELECT, y las permisivas se suman con OR.

**Why:** una prueba de texto sobre el `.sql` y una lectura de la política de SELECT no lo ven; solo lo
ve `pg_policies` de la base viva (`cmd = ALL`) o un ensayo que cuente filas con un usuario que debería
ver menos. Ver [[auditoria-no-es-medicion]] y [[verificar-contra-el-codigo-que-ejecuta]].

**How to apply:** antes de tocar o confiar en una política de lectura, listar TODAS las políticas de
la tabla (`select policyname, permissive, cmd, qual from pg_policies where tablename = …`) y comprobar
que ninguna `ALL` permisiva la anula. Para cerrar lectura, la de escritura se parte en
insert/update/delete (Postgres no tiene «ALL menos SELECT»). Y el ensayo con ROLLBACK debe incluir un
caso cuyo número esperado sea **menor** que el total — un caso que espera «todas» pasa con el agujero.
