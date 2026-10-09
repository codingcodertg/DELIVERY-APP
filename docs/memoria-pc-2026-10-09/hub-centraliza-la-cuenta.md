---
name: hub-centraliza-la-cuenta
description: "El RTG Hub es un hub de usuario centralizado; todo lo de la cuenta (contraseña, idioma, perfil) se ajusta una vez en el hub y vale para todas las apps."
metadata: 
  node_type: memory
  type: project
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-16T17:26:45.956Z
---

El dueño lo dijo el 2026-09-16: «es un solo usuario y password», «el idioma debe ser general
para todo», «por eso es un centralize user hub». Lo que pertenece a la **persona** y no a una app
—contraseña, idioma, datos de perfil— se ajusta en «Mi perfil» del lobby (`/home/profile`) y cada
app lo lee de ahí; las apps no llevan su propio formulario ni su propia preferencia.

**Why:** ese día había tres formularios de contraseña (Entregas, RR. HH., Time Tracker) y el idioma
vivía por separado (`rtg_prefs` frente a `tt_lang` de D-206). El dueño lo vio como incoherente con
una sola cuenta.

**How to apply:** ante un encargo que añade un ajuste de cuenta dentro de una app, proponer que
viva en «Mi perfil» del hub. Al repartir trabajo, tratar un ajuste por app que duplique uno de
cuenta como deuda que hay que unificar, no como diseño. Ver [[apk-publicado-es-lo-que-corre]] para
la otra superficie (la cáscara) que también carga el hub.
