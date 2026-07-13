/**
 * src/agents/core/uuid.js
 * Genera IDs únicos usando crypto.randomUUID() cuando está disponible
 * (navegadores modernos y Node 19+), con un fallback simple para entornos
 * más antiguos (p. ej. Node 18 al correr `npm run test:agents`).
 */
export function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback RFC4122 v4 aproximado (suficiente para IDs internos, no criptográfico).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export default uuid
