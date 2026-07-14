/**
 * api/_guard.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Controles de acceso compartidos para los proxies serverless (/api/llm,
 * /api/notify, /api/trace). Migrado 1:1 desde Pardos Chicken. El prefijo "_"
 * hace que Vercel NO lo trate como endpoint público.
 *
 * Protege:
 *   1. Allowlist de origen — solo el propio front (mismo host) o dominios
 *      declarados en ALLOWED_ORIGINS pueden usar el proxy.
 *   2. Validación de Token JWT (opcional, ver guia_automatizacion.md sección
 *      6) — este proyecto no tiene login de usuarios (RLS pública, ver
 *      01_golden_bears_schema.sql), así que el JWT verificado es el propio
 *      anon key de Supabase que el cliente ya expone en el bundle: si
 *      SUPABASE_JWT_SECRET está configurado, se exige un Bearer token con
 *      firma HS256 válida (evita que terceros ajenos al front invoquen los
 *      proxies directamente). Sin esa variable, el chequeo se omite —
 *      compatible con el modo demo sin romper nada.
 *   3. Rate-limit por IP — ventana deslizante en memoria (por instancia
 *      serverless; para límites duros globales se necesitaría un store
 *      compartido tipo Redis — mejora futura documentada).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

function origenesPermitidos(req) {
  const extra = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const host = String(req.headers.host || '').toLowerCase()
  const propios = host ? [host] : []
  const locales = ['localhost:5173', '127.0.0.1:5173', 'localhost:3000']
  return new Set([...propios, ...locales, ...extra])
}

function hostDe(url) {
  if (!url) return ''
  try { return new URL(url).host.toLowerCase() } catch { return '' }
}

export function verificarOrigen(req) {
  const permitidos = origenesPermitidos(req)
  const origen = hostDe(req.headers.origin) || hostDe(req.headers.referer)
  if (!origen) return false
  return permitidos.has(origen)
}

function base64UrlDecode(str) {
  const normalizado = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=')
  return Buffer.from(normalizado, 'base64')
}

/** verificarJWT — valida firma HS256 y expiración de un JWT (sin dependencias externas). */
function verificarJWT(token, secret) {
  if (!token) return false
  const partes = token.split('.')
  if (partes.length !== 3) return false
  const [headerB64, payloadB64, firmaB64] = partes

  let firmaRecibida, firmaEsperada
  try {
    firmaRecibida = base64UrlDecode(firmaB64)
    firmaEsperada = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest()
  } catch {
    return false
  }
  if (firmaRecibida.length !== firmaEsperada.length || !timingSafeEqual(firmaRecibida, firmaEsperada)) {
    return false
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'))
    if (payload.exp && Date.now() / 1000 > payload.exp) return false
    return true
  } catch {
    return false
  }
}

function verificarAuthHeader(req) {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) return true // Validación opcional: sin secreto configurado, se omite.

  const auth = String(req.headers.authorization || '')
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  return verificarJWT(token, secret)
}

const _hits = new Map()

function ipDe(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return fwd || req.socket?.remoteAddress || 'desconocida'
}

export function rateLimit(req, { max = 30, windowMs = 60_000 } = {}) {
  const ip = ipDe(req)
  const ahora = Date.now()
  const desde = ahora - windowMs
  const previos = (_hits.get(ip) || []).filter((t) => t > desde)
  previos.push(ahora)
  _hits.set(ip, previos)

  if (_hits.size > 5000) {
    for (const [k, v] of _hits) {
      if (v.every((t) => t <= desde)) _hits.delete(k)
    }
  }
  return previos.length <= max
}

export function aplicarGuard(req, res, rateOpts) {
  if (!verificarOrigen(req)) {
    res.status(403).json({ error: 'Origen no autorizado.' })
    return false
  }
  if (!verificarAuthHeader(req)) {
    res.status(401).json({ error: 'Token JWT inválido, expirado o ausente.' })
    return false
  }
  if (!rateLimit(req, rateOpts)) {
    res.setHeader('Retry-After', '60')
    res.status(429).json({ error: 'Demasiadas solicitudes. Intenta de nuevo en un minuto.' })
    return false
  }
  return true
}
