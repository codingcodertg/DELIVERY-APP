---
name: apk-publicado-es-lo-que-corre
description: Un cambio en mobile/ no está hecho hasta que hay un APK publicado con él; el repo describe la intención y Supabase Storage lo que corre en los teléfonos.
metadata: 
  node_type: memory
  type: project
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-09-15T05:22:55.889Z
---

La cáscara Android (Capacitor, `mobile/`) **no trae el sitio dentro**: carga
`server.url` en vivo. Pero `appName`, `server.url`, `versionCode` y el token de
UA (`RDZDeliveries/<n>`) viajan **dentro del APK** (`assets/capacitor.config.json`),
y el APK que corre en los teléfonos es el que está en Supabase Storage,
`app/RDZ-Deliveries.apk` (`APK_DOWNLOAD_URL` en `src/lib/app-update.ts`).

**Why:** el 2026-09-14 el dueño dijo «el apk no me funciona, se quedó con rdz
deliveries». El repo llevaba «RTG Hub» y `rtg-hub.vercel.app` desde el
2026-09-04, pero el APK publicado era el del 2026-08-18 (sha256 idéntico al
`app-release.apk` local de esa fecha): «RDZ Deliveries», dominio viejo,
`versionCode` 4 = `LATEST_APK_VERSION_CODE` → ningún aviso, y el 307 del dominio
viejo deja a la cáscara fuera de su origen (el D-225 en versión Android).

**How to apply:**
- Para saber qué corre, **descargar el APK publicado y leer
  `assets/capacitor.config.json`** (`unzip`), no el repo.
- Publicar = `versionCode`+1 y UA `/<n>` en `build.gradle` y
  `capacitor.config.ts`, `npx cap sync android`, `gradlew assembleRelease` con
  `JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"` (no hay `java` en
  PATH) y la llave de `mobile/android/keystore.properties`
  (`C:/Users/andre/Documents/rdz-release.keystore`, alias `rdz`); comprobar
  con `keytool -printcert` que la huella del certificado es la misma que la del
  publicado (si no, los teléfonos no actualizan sin desinstalar); subir con
  `x-upsert` a la **misma ruta** (renombrar rompe la URL de los instalados);
  verificar tras subir (bytes, config embebida, sha256); y solo entonces subir
  `LATEST_APK_VERSION_CODE`, que es lo que dispara el aviso.
- El token de UA se llama `RDZDeliveries` aunque la app sea «RTG Hub»:
  `installedApkVersion()` lo busca por ese nombre. No renombrarlo sin cambiar
  las dos puntas a la vez.
