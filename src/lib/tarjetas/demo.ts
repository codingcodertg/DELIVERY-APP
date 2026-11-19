import type { FilaPublica } from "@/lib/tarjetas/tarjeta";

/**
 * Tarjetas inventadas para el modo demo (`NEXT_PUBLIC_LOCAL_MODE`): sin base, se pueden mirar todas las pantallas.
 * Nombres, teléfonos (555 de ficción) y correos (example.com) son falsos a propósito.
 */

export interface FilaDeTarjetaDemo extends FilaPublica {
  id: string;
  active: boolean;
  profile_id: string | null;
  edit_token: string;
  created_at: string;
  updated_at: string;
}

const AHORA = "2026-11-19T12:00:00.000Z";

export const TARJETAS_DEMO: readonly FilaDeTarjetaDemo[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "ana-demo",
    full_name: "Ana Demo",
    role_es: "Ventas",
    role_en: "Sales",
    store: "brownsville",
    phone: "+1 555 555 0101",
    whatsapp: "+1 555 555 0101",
    email: "ana.demo@example.com",
    photo_path: null,
    cover_path: null,
    active: true,
    profile_id: null,
    edit_token: "a".repeat(64),
    created_at: AHORA,
    updated_at: AHORA,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    slug: "luis-ejemplo",
    full_name: "Luis Ejemplo",
    role_es: "Representante de Ventas",
    role_en: "Sales Representative",
    store: "pharr",
    phone: "+1 555 555 0102",
    whatsapp: "+1 555 555 0103",
    email: "luis.ejemplo@example.com",
    photo_path: null,
    cover_path: null,
    active: true,
    profile_id: null,
    edit_token: "b".repeat(64),
    created_at: AHORA,
    updated_at: AHORA,
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    slug: "marta-prueba",
    full_name: "Marta Prueba",
    role_es: "Gerente",
    role_en: "Manager",
    store: null,
    phone: "+1 555 555 0104",
    whatsapp: "+1 555 555 0104",
    email: "marta.prueba@example.com",
    photo_path: null,
    cover_path: null,
    active: false,
    profile_id: null,
    edit_token: "c".repeat(64),
    created_at: AHORA,
    updated_at: AHORA,
  },
];

export function filaDemoPorSlug(slug: string): FilaDeTarjetaDemo | null {
  return TARJETAS_DEMO.find((f) => f.slug === slug && f.active) ?? null;
}

export function filaDemoPorToken(token: string): FilaDeTarjetaDemo | null {
  return TARJETAS_DEMO.find((f) => f.edit_token === token && f.active) ?? null;
}
