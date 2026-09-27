"use client";

import { useState, type InputHTMLAttributes } from "react";
import { aTexto, leeDecimal, limpiaDecimal, textoAPintar } from "@/lib/campo-decimal";

/** Campo de número que deja teclear «23.8» sin comerse el punto (ver `lib/campo-decimal.ts`). */
export function CampoDecimal({ value, onValor, inputMode = "decimal", ...resto }: {
  value: number | null | undefined;
  onValor: (n: number | null) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "inputMode"> & { inputMode?: "decimal" | "numeric" }) {
  const [tecleado, setTecleado] = useState(() => aTexto(value));
  return (
    <input {...resto} type="text" inputMode={inputMode} value={textoAPintar(tecleado, value)}
      onChange={(e) => { const t = limpiaDecimal(e.target.value); setTecleado(t); onValor(leeDecimal(t)); }} />
  );
}
