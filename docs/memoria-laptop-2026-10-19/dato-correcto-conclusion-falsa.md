---
name: dato-correcto-conclusion-falsa
description: "Recontar comprueba el número, no la afirmación que se construye encima."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-10T04:58:38.837Z
---

Un dato correcto puede sostener una conclusión falsa, y **eso no lo caza
recontar**. Comprobar el número solo valida el número; la afirmación que se
apoya en él hay que ir a mirarla al código.

**Why:** el 2026-09-09, con el desglose correcto delante —«Phone» en 10 sitios y
«Phone \*» en uno—, salté de «once sitios» a «once formas de llamar al campo» y
construí encima un precedente que no existía: el asterisco era el marcador de
campo obligatorio, como «Name \*» en el mismo formulario. El número estaba bien;
la conclusión, no. Iba camino de `DECISIONS.md` como una afirmación falsa sobre
el repo. Los otros cuatro números cruzados ese día cayeron con un segundo
conteo; este solo cayó porque el auditor fue a mirar qué significaba.

**Otra vez, con un grep correcto (2026-09-23).** Busqué sumas crudas de dinero y millas y encontré
ocho: `totalFees += …`, `reduce((s,d)=>s+d.route_miles)`. De ahí encargué el trabajo diciendo que
«asoma la cola binaria en pantalla». Falso: los ocho **redondean al devolver**, quince o veinte
líneas más abajo (`analytics.ts:65-67`, `:232-234`, `export.ts:90`). El worker lo midió y me
corrigió. El grep estaba bien; lo que no estaba medido era **qué llega a la pantalla**. Dónde se
calcula un número no dice qué se ve: entre el acumulador y el ojo hay un `return`, un formateador y
un componente. Se sigue el valor hasta donde se pinta, o se abre la app. El encargo se sostuvo por
otra razón, que sí era cierta —27 copias de la misma regla en tres grafías—, y de paso apareció el
fallo de verdad: pallets redondeados a ENTERO en el Panel, que sí se ve y no deja cola.

**How to apply:** cuando una conclusión se apoye en un dato, comprobar la
conclusión con su propio comando, no dar por buena la cadena porque el dato lo
esté. Disparador útil: **si el argumento explica demasiado bien** —un precedente
que aparece justo cuando hace falta y encaja sin ninguna esquina suelta— hay que
ir a contarlo. Y lo mismo vale para una autoacusación: asumir una culpa sin
comprobarla mete un dato falso en el registro, y es el que nadie revisa. Ver
[[auditoria-no-es-medicion]] y [[comprobar-la-capa-que-manda]].
