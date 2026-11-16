// ============================================================
// Con qué app y qué versión entra cada dispositivo, leído de su agente de usuario (D-815).
//
// El dueño: «quiero ver que app version usan y si hace falta que actualicen». Lo que hay en el agente:
//   · la app de escritorio pone `RTGHub/x.y.z` (D-225); la mínima es `ESCRITORIO_MINIMO` (D-813).
//   · la app Android del Time Tracker pone `RDZDeliveries/<n>` (el versionCode); la última es `LATEST_APK_VERSION_CODE`.
//   · lo demás es un navegador: se dice cuál y qué versión mayor, para distinguir «Chrome 130» de un Safari viejo.
// ============================================================
import { ESCRITORIO_MINIMO, versionDeEscritorio, versionMenor } from "@/lib/desktop-version";
import { installedApkVersion, LATEST_APK_VERSION_CODE } from "@/lib/app-update";

export interface VersionDeApp {
  /** desktop = la app de escritorio; android = la app del Time Tracker; browser = cualquier navegador. */
  app: "desktop" | "android" | "browser";
  /** Lo que se enseña: «RTG Hub 1.1.1», «Time Tracker v6», «Chrome 130». */
  texto: string;
  /** La versión que lleva, tal cual. */
  version: string | null;
  /** true = es una de nuestras apps y va por detrás de la que toca. Un navegador nunca «necesita actualizar». */
  actualizar: boolean;
  /** La versión que debería tener, si va por detrás. */
  minima: string | null;
}

const NAVEGADORES: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\/(\d+)/, "Edge"],
  [/\bOPR\/(\d+)/, "Opera"],
  [/\bSamsungBrowser\/(\d+)/, "Samsung"],
  [/\bFirefox\/(\d+)/, "Firefox"],
  [/\bChrome\/(\d+)/, "Chrome"],
  [/\bCriOS\/(\d+)/, "Chrome"],
  [/\bVersion\/(\d+)[\d.]*.*\bSafari\//, "Safari"],
];

/**
 * D-824: qué tan «bien equipada» está una persona por un dispositivo suyo, para elegir el mejor entre varios. El dueño,
 * con Melecio y Roberto Contreras: «me aparece que siguen desde el browser pero abajo ya sale que actualizaron». Tenían
 * la app nueva Y un Chrome visto después (la pantalla de bloqueo también cuenta como «visto»); el último visto no es
 * la respuesta a «¿ya tiene la app?». Mayor = mejor.
 */
export function rangoDeApp(userAgent: string | null | undefined, kind?: string | null): number {
  const v = versionDeApp(userAgent);
  if (v.app === "desktop") return v.actualizar ? 4 : 5;
  if (v.app === "android") return v.actualizar ? 2 : 3;
  return kind === "phone" ? 1 : 0;
}

export function versionDeApp(userAgent: string | null | undefined): VersionDeApp {
  const ua = userAgent ?? "";
  const escritorio = versionDeEscritorio(ua);
  if (escritorio) {
    const atras = versionMenor(escritorio, ESCRITORIO_MINIMO);
    return { app: "desktop", texto: `RTG Hub ${escritorio}`, version: escritorio, actualizar: atras, minima: atras ? ESCRITORIO_MINIMO : null };
  }
  const apk = installedApkVersion(ua);
  if (apk !== null) {
    const atras = apk < LATEST_APK_VERSION_CODE;
    return { app: "android", texto: `Time Tracker v${apk}`, version: String(apk), actualizar: atras, minima: atras ? `v${LATEST_APK_VERSION_CODE}` : null };
  }
  for (const [re, nombre] of NAVEGADORES) {
    const m = re.exec(ua);
    if (m) return { app: "browser", texto: `${nombre} ${m[1]}`, version: m[1], actualizar: false, minima: null };
  }
  return { app: "browser", texto: ua ? "—" : "—", version: null, actualizar: false, minima: null };
}
