/**
 * src/agents/core/apiHeaders.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Cabeceras compartidas para las llamadas del navegador a los proxies
 * serverless (/api/llm, /api/notify, /api/trace).
 *
 * Adjunta el JWT del anon key de Supabase como Bearer token — es seguro
 * exponerlo (el anon key ya viaja en el bundle del navegador por diseño,
 * protegido por RLS, no por secreto) y permite que api/_guard.js verifique
 * su firma contra SUPABASE_JWT_SECRET (ver guia_automatizacion.md, sección 6:
 * "Validación de Token JWT"). Si no hay Supabase configurado, no se envía
 * cabecera y el servidor simplemente omite esa verificación (opcional).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {}
const SUPABASE_ANON_KEY = ENV.VITE_SUPABASE_ANON_KEY || ''

export function apiHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    ...(SUPABASE_ANON_KEY ? { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {}),
    ...extra,
  }
}

export default apiHeaders
