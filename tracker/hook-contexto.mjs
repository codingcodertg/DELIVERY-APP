#!/usr/bin/env node
// Hook de `UserPromptSubmit`: busca en el tracker tareas parecidas a lo que el dueño acaba de
// escribir y las pone delante, antes de que nadie empiece a trabajar.
//
// Para qué: el dueño pidió seis veces en ocho días la misma cosa (T-0007), y ninguna sesión supo
// que ya se había pedido. Esto no decide nada — solo dice «esto ya se pidió el día X y quedó así».
//
// **Tres reglas, y las tres pesan más que ser útil:**
//
// 1. **No falla nunca en voz alta.** Cualquier error sale por código 0 y sin ruido. Un hook que se
//    queja rompe el mensaje del dueño, y el mensaje del dueño importa más que este aviso.
// 2. **No bloquea.** Si el tracker no está, si el JSON viene raro, si no hay carpeta de tareas:
//    calla y sale.
// 3. **Es rápido.** Lee los ficheros una vez y no llama a nada de fuera: ni red, ni git, ni modelo.
//
// Lo que recibe por la entrada estándar es el JSON del arnés, con `prompt` dentro. Medido contra la
// versión instalada (2.1.281) mirando un hook que ya funciona en esta máquina: el payload trae
// `session_id`, `hook_event_name` y los campos del evento.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = dirname(fileURLToPath(import.meta.url));
const LIMITE = 3;

const salSinDecirNada = () => process.exit(0);

function leeEntrada() {
  try {
    const bruto = readFileSync(0, "utf8");
    if (!bruto.trim()) return null;
    return JSON.parse(bruto);
  } catch { return null; }
}

const ACENTOS = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");
const VACIAS = new Set(("el la los las un una unos unas de del a al y o que en por para con sin sobre como mas pero si no "
  + "se su sus lo le les me mi mis te tu tus es son era ser estar esta este esto estos estas hay ha han "
  + "the a an of to in for on and or that this these with is are be was were it its i you we they "
  + "quiero quiere puedes puede hacer hace haz favor porfa ok gracias").split(" "));

const palabras = (t) => (t ?? "").normalize("NFD").replace(ACENTOS, "").toLowerCase()
  .split(/[^a-z0-9#-]+/).filter((p) => p.length > 2 && !VACIAS.has(p));

try {
  const entrada = leeEntrada();
  const prompt = String(entrada?.prompt ?? "").trim();
  if (!prompt) salSinDecirNada();

  const dir = join(RAIZ, "tareas");
  if (!existsSync(dir)) salSinDecirNada();

  const tareas = [];
  for (const f of readdirSync(dir)) {
    if (!/^T-\d+\.json$/.test(f)) continue;
    try { tareas.push(JSON.parse(readFileSync(join(dir, f), "utf8"))); } catch { /* una rota no tumba el resto */ }
  }
  if (!tareas.length) salSinDecirNada();

  const q = palabras(prompt);
  if (q.length < 2) salSinDecirNada();          // «ok» o «sigue» no se buscan

  // Palabras compartidas, pesadas por lo raras que son: que dos peticiones compartan «orden» no
  // dice nada; que compartan «intertienda» dice mucho.
  const docs = tareas.map((t) => ({
    t,
    bolsa: new Set(palabras([t.resumen, t.texto_original, (t.notas ?? []).map((n) => n.texto).join(" ")].join(" "))),
  }));
  const idf = (p) => Math.log((docs.length + 1) / (docs.filter((d) => d.bolsa.has(p)).length + 1)) + 1;
  const pesos = new Map(q.map((p) => [p, idf(p)]));
  const total = [...pesos.values()].reduce((a, b) => a + b, 0) || 1;

  const r = docs
    .map(({ t, bolsa }) => {
      const comunes = [...new Set(q.filter((p) => bolsa.has(p)))];
      return { t, puntos: comunes.reduce((a, p) => a + (pesos.get(p) ?? 0), 0) / total, comunes };
    })
    .filter((x) => x.puntos >= 0.3)
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, LIMITE);

  if (!r.length) salSinDecirNada();

  const l = ["Del tracker (`tracker/`), esto se parece a lo que se acaba de pedir:"];
  for (const { t, puntos, comunes } of r) {
    const v = t.verificacion?.estado ?? "sin verificar";
    l.push("- **" + t.id + "** (" + t.fecha + ") — " + t.estado + ", " + v + ". " + t.resumen);
    l.push("  parecido " + Math.round(puntos * 100) + "% por: " + comunes.join(", "));
  }
  l.push("");
  l.push("Si es lo mismo, dilo con su fecha y su estado y pregunta si rehacer, corregir o dejar."
    + " Si es otra cosa, sigue sin mencionarlo: esto es un aviso, no una orden.");
  process.stdout.write(l.join("\n") + "\n");
} catch {
  // A propósito: cualquier fallo se traga. Ver la regla 1 de arriba.
}
process.exit(0);
