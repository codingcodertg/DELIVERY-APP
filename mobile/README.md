# RTG Hub — app de Android para choferes

Cáscara nativa (Capacitor) que carga la app web en vivo y le agrega **GPS en
segundo plano**, que es lo único que un navegador no puede hacer con la
pantalla apagada.

## Cómo funciona

La app **no** trae el sitio dentro del APK: lo carga desde
`https://deliveries-app-seven.vercel.app`. Cuando despliegas a Vercel, los
choferes reciben el cambio **sin reinstalar nada**. Solo hay que recompilar el
APK si cambian los permisos, el ícono o el plugin de GPS.

## Rastreo de ubicación

- Solo reporta **entre marcar entrada y marcar salida**. Fuera del turno no se
  registra nada.
- Android muestra una **notificación permanente** mientras comparte. El chofer
  siempre ve que está activo.
- Los choferes fueron informados y lo aceptaron.


## ⚠️ El primer APK firmado NO puede actualizar al que está instalado

El APK que traen los teléfonos hoy está firmado con la llave de **depuración**
(`CN=Android Debug`). Android se niega a actualizar una app si la llave de
firma cambia — no es un error del build, es la protección que impide que
alguien reemplace tu app con otra.

Entonces, **una sola vez**:

1. Desinstalar RTG Hub (antes "RDZ Deliveries") del teléfono.
2. Instalar el APK **firmado de release**.

De ahí en adelante todas las actualizaciones se instalan encima sin desinstalar.

**Hazlo ahora que hay un chofer, no después con ocho.** La molestia es la misma
por teléfono; lo que cambia es cuántos teléfonos hay que tocar. Y si algún día
se pierde esta computadora, la llave de depuración se pierde con ella y
tendrías que desinstalar en TODOS los teléfonos para poder volver a actualizar.
La llave de release vive en un archivo que puedes respaldar.


## Notificaciones push (FCM) — pasos que solo puedes hacer tú

El código ya está listo y **funciona sin esto**: si falta cualquiera de las dos
piezas, no hay push, no hay error, y la campanita dentro de la app sigue
guardando todos los avisos. Estos pasos solo encienden el push.

### 1. Crear el proyecto en Firebase (tu cuenta de Google)

1. Entra a <https://console.firebase.google.com> y crea un proyecto
   (Analytics no hace falta).
2. **Agregar app → Android.**
3. Nombre del paquete, **exacto**: `net.rdztilegroup.deliveries`
   Si no coincide, el push no llega y no hay mensaje de error que lo explique.
4. Descarga `google-services.json` y ponlo en:
   `mobile/android/app/google-services.json`

Ese archivo **no es un secreto**: va dentro de cada APK, así que cualquiera con
el APK puede leerlo. Se puede versionar sin problema.

### 2. La llave del servidor (esta SÍ es secreta)

1. En Firebase: **⚙ Configuración del proyecto → Cuentas de servicio →
   Generar nueva clave privada.** Descarga el JSON.
2. En **Vercel → el proyecto → Settings → Environment Variables**, crea:
   - Nombre: `FIREBASE_SERVICE_ACCOUNT`
   - Valor: **todo el contenido del JSON**, tal cual, de `{` a `}`
3. Redeploy.

Esa llave permite enviar notificaciones en nombre de tu proyecto. **Nunca la
subas al repositorio** ni la pegues en un chat. Pégala directamente en Vercel.

### 3. APK nuevo

El push es código nativo, así que hay que recompilar y subir el APK
(ver los tres números más arriba: sube `versionCode` a 3, `RDZDeliveries/3` y
`LATEST_APK_VERSION_CODE`).

### Cómo saber si quedó

Asigna una orden a un chofer con su teléfono **bloqueado**. Si suena, quedó.
Si no, revisa en este orden: ¿el paquete del paso 1.3 coincide?, ¿el APK que
tiene el chofer es el nuevo?, ¿`FIREBASE_SERVICE_ACCOUNT` está en Vercel y se
hizo redeploy?

## Los tres números tienen que coincidir

Un APK nuevo se anuncia comparando tres valores. Si no coinciden, el aviso
miente (o nunca aparece):

| Dónde | Qué |
|---|---|
| `mobile/android/app/build.gradle` | `versionCode` |
| `mobile/capacitor.config.ts` | `appendUserAgent: "RDZDeliveries/<n>"` |
| `src/lib/app-update.ts` | `LATEST_APK_VERSION_CODE` |

Después de cambiar `capacitor.config.ts` hay que correr `npx cap sync android`,
o el APK sigue anunciándose con el número viejo.

## Compilar el APK

Requiere Android Studio (trae su propio JDK) y el SDK de Android.

```bash
cd mobile
npm install

# Ruta del SDK (una sola vez). Usa barras normales: los backslashes
# rompen el archivo .properties de Java.
echo 'sdk.dir=C:/Users/<tu-usuario>/AppData/Local/Android/Sdk' > android/local.properties

npx cap sync android

cd android
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew assembleDebug
```

El APK queda en:
`android/app/build/outputs/apk/debug/app-debug.apk`

## Instalar en un teléfono

Por cable, con depuración USB activada:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

O copia el `.apk` al teléfono y ábrelo (hay que permitir "instalar apps
desconocidas" para el explorador de archivos).

### Permisos que hay que conceder

Al marcar entrada por primera vez, Android pide la ubicación. Es importante
elegir **"Permitir todo el tiempo"** — con "Solo mientras se usa la app" el
rastreo se detiene al bloquear la pantalla. Android obliga a hacerlo en dos
pasos: primero se concede el uso normal y luego el sistema ofrece el permiso
de segundo plano.

## Firma (release)

El keystore ya existe en `C:/Users/andre/Documents/rdz-release.keystore`.
Para compilar firmado hay que crear **una sola vez** el archivo
`android/keystore.properties` con la contraseña:

```bash
cd mobile/android
cp keystore.properties.example keystore.properties
# edítalo y reemplaza PON_AQUI_TU_CONTRASEÑA por la real
```

Ese archivo está en `.gitignore` y nunca debe subirse. Si falta, la
compilación de release **no falla**: cae a firma debug (y avisa), pero ese
APK no puede actualizar una instalación existente.

```bash
cd mobile/android
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

> ⚠️ Un APK firmado con otra llave **no puede** actualizar al anterior. El APK
> debug que se instaló para probar hay que **desinstalarlo** antes de poner el
> firmado. A partir de ahí, todas las actualizaciones son directas.

## Actualizaciones

**Casi nunca hace falta un APK nuevo.** La cáscara carga el sitio en vivo, así
que pantallas, precios, reportes y rutas llegan solos al desplegar a Vercel.
Solo se recompila cuando cambia algo **nativo**: permisos, ícono, nombre o el
plugin de GPS.

Cuando sí toque publicar uno:

1. Sube `versionCode` (y `versionName`) en `android/app/build.gradle`.
2. Sube el mismo número en `appendUserAgent` de `capacitor.config.ts`.
3. Sube `LATEST_APK_VERSION_CODE` en `src/lib/app-update.ts`.
4. Compila el release y súbelo al bucket público `app` de Supabase, con el
   mismo nombre `RDZ-Deliveries.apk`.
5. Despliega la web.

Los tres números deben coincidir. Con eso, cada chofer con una versión vieja
ve un aviso azul arriba — "Hay una nueva versión de la app · Actualizar" —
que descarga e instala encima, conservando su sesión.
