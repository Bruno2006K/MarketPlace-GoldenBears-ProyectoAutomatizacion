/**
 * api/_guard.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Controles de acceso compartidos para el proxy serverless (/api/llm).
 * Migrado 1:1 desde Pardos Chicken. El prefijo "_" hace que Vercel NO lo trate
 * como endpoint público.
 *
 * Protege:
 *   1. Allowlist de origen — solo el propio front (mismo host) o dominios
 *      declarados en ALLOWED_ORIGINS pueden usar el proxy.
 *   2. Rate-limit por IP — ventana deslizante en memoria (por instancia
 *      serverless; para límites duros globales se necesitaría un store
 *      compartido tipo Redis — mejora futura documentada).
 * ─────────────────────────────────────────────────────────────────────────────
 */

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
  if (!rateLimit(req, rateOpts)) {
    res.setHeader('Retry-After', '60')
    res.status(429).json({ error: 'Demasiadas solicitudes. Intenta de nuevo en un minuto.' })
    return false
  }
  return true
}
