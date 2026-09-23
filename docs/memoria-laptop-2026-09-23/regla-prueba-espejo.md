---
name: regla-prueba-espejo
description: Cuándo una prueba puede reproducir la lógica en el propio test y cuándo tiene que importar la función de verdad
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-08T18:51:27.306Z
---

Regla que formulé en el flujo paralelo del RTG Hub y que el orquestador (`deliveries-app-01`)
respaldó: **si lo que decide acaba en la base, se prueba de verdad —importando la función—; si
decide cómo se pinta, la prueba espejo basta.**

**Why:** una "prueba espejo" (el test reescribe la regla en vez de importarla) no puede fallar
cuando el código de producción cambia: comprueba su propia copia. Para presentación el coste de eso
es bajo. Para una regla cuyo resultado se escribe en Postgres —coordenadas, `delivery_pin_source`—
una copia que se desincroniza deja pasar exactamente el fallo que la prueba decía cubrir.

**How to apply:** al escribir una prueba, preguntar dónde acaba el valor que la regla decide. Si
acaba en un `insert`/`update`, sacar la regla a un módulo puro (`src/lib/*.ts`) e importarla desde
el test. Cuidado también con la variante sutil: pasarle al módulo las piezas sueltas para que
reconstruya por su cuenta una noción que la pantalla ya calculó (p. ej. "el pin visible"). Eso son
dos definiciones que coinciden hoy sin nada que las ate mañana — mejor pasar el valor ya resuelto y
que la divergencia sea imposible, no improbable.

**Desempate** (lo añadió el orquestador al adoptarla): cuando dude, preguntarse si un cambio
silencioso podría hacer que **la pantalla y la base cuenten cosas distintas**. Si puede, prueba de
verdad. También me pidió que se lo diga si veo una prueba espejo donde tocaba una de verdad en un
encargo suyo, aunque no lo pregunte.

Relacionado: [[auditoria-no-es-medicion]]
