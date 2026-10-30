"use client";

import { useState } from "react";
import { AddressInput } from "@/components/AddressInput";
import type { NamedLocation } from "@/lib/types";

// ============================================================
// A named place + its address, as one control.
//
//  • Pick a saved name from the dropdown → the address fills in automatically.
//  • Or choose "Type a new one…" and enter the name/address by hand.
//  • If it's worth reusing, "Save for next time" adds it to the saved list so
//    it appears in the dropdown from then on.
//
// The address stays editable either way — a saved site can still be overridden
// for a one-off delivery without changing the saved record.
// ============================================================

const NEW = "__new__";

export function LocationCombo({
  nameLabel,
  addressLabel,
  name,
  address,
  options,
  onName,
  onAddress,
  onSave,
  disabled,
  escribirPorDefecto = false,
  namePlaceholder,
  addressPlaceholder,
  nameInvalid,
  addressInvalid,
  t,
}: {
  nameLabel: string;
  addressLabel: string;
  name: string | null | undefined;
  address: string | null | undefined;
  options: NamedLocation[];
  onName: (v: string) => void;
  onAddress: (v: string) => void;
  /** Persist a new named location for reuse (omit to hide the save button). */
  onSave?: (loc: NamedLocation) => void;
  disabled?: boolean;
  namePlaceholder?: string;
  addressPlaceholder?: string;
  /** Highlight the name / address as missing required fields. */
  nameInvalid?: boolean;
  addressInvalid?: boolean;
  /** D-NEXT: abrir en modo escribir (nombre tecleado + dirección buscada) salvo que el nombre ya sea uno guardado. Para la
   *  recogida libre de «Otro» y «Proveedor»; «Elegir guardado» sigue ahí para quien quiera uno de la lista. */
  escribirPorDefecto?: boolean;
  t: (en: string, es: string) => string;
}) {
  const known = options.some((o) => o.name && o.name === name);
  // Free-typing mode: on for a name that isn't in the saved list.
  const [manual, setManual] = useState(escribirPorDefecto ? !known : !!name && !known);

  const pick = (v: string) => {
    if (v === NEW) { setManual(true); onName(""); return; }
    setManual(false);
    onName(v);
    const found = options.find((o) => o.name === v);
    if (found?.address) onAddress(found.address);
  };

  // Worth saving only if it's a new name+address pair we don't already hold.
  const canSave =
    !!onSave && !disabled && !!name?.trim() && !!address?.trim() &&
    !options.some((o) => o.name.toLowerCase() === name.trim().toLowerCase());

  return (
    <>
      <div className="field">
        <label>{nameLabel}{nameInvalid && <span className="req-star"> *</span>}</label>
        {manual ? (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className={nameInvalid ? "invalid" : ""}
              value={name ?? ""}
              disabled={disabled}
              placeholder={namePlaceholder}
              onChange={(e) => onName(e.target.value)}
            />
            {options.length > 0 && (
              <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => { setManual(false); onName(""); }}>
                {t("Pick saved", "Elegir guardado")}
              </button>
            )}
          </div>
        ) : (
          <select className={nameInvalid ? "invalid" : ""} value={known ? (name as string) : ""} disabled={disabled} onChange={(e) => pick(e.target.value)}>
            <option value="">{namePlaceholder ?? t("Select…", "Seleccione…")}</option>
            {options.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
            <option value={NEW}>➕ {t("Type a new one…", "Escribir uno nuevo…")}</option>
          </select>
        )}
      </div>

      <div className="field">
        <AddressInput
          label={addressLabel}
          value={address}
          onChange={onAddress}
          disabled={disabled}
          placeholder={addressPlaceholder}
          invalid={addressInvalid}
        />
        {canSave && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 6 }}
            onClick={() => onSave!({ name: name!.trim(), address: address!.trim() })}
          >
            💾 {t("Save for next time", "Guardar para la próxima")}
          </button>
        )}
      </div>
    </>
  );
}
