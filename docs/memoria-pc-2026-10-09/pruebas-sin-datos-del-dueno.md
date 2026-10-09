---
name: pruebas-sin-datos-del-dueno
description: "Las pruebas no afirman datos que el dueño edita desde Ajustes (nombres de tienda, etc.)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-08T21:18:15.583Z
---

Corrección del orquestador el 2026-09-08, sobre el encargo de las tiendas en el mapa: yo había
clavado en una prueba los cuatro nombres de tienda medidos en producción, para que un renombrado
saltara. **Fuera.**

**Why:** renombrar una tienda desde Ajustes es algo que el dueño tiene todo el derecho a hacer y
que no rompe nada. Una prueba que afirma esos nombres pone el CI en rojo ante un cambio legítimo
de datos, y entonces el CI está señalando como fallo algo que no lo es. Acopla el repo a datos que
viven en la base y que el usuario controla.

**How to apply:** en las pruebas, nombres y valores **inventados**. Lo que se prueba es la lógica
—que la comparación normalizada empareja, que no empareja cosas distintas— más el caso del cambio
de datos: p. ej. un pedido cuya tienda ya no está en Ajustes no destaca ninguna y no revienta. Una
medición de producción sirve para **decidir el diseño** y para citarla con fecha en la decisión,
no para clavarla en el repo.

Relacionado: [[regla-prueba-espejo]]
