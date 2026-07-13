/**
 * src/domain/pricing.js
 * Reglas de negocio de precios/carrito. Migrado de agents/carrito_pago.py
 * (backend Python original): IGV 18%, máximo 10 unidades por producto,
 * monto mínimo de orden S/10.00, métodos de pago válidos.
 */

export const IGV_RATE = 0.18
export const MAX_UNITS_PER_PRODUCT = 10
export const MIN_ORDER_AMOUNT = 10.0
export const MAX_PAYMENT_ATTEMPTS = 3

export const PAYMENT_METHODS = ['tarjeta', 'transferencia', 'yape', 'plin', 'contra_entrega']

export const PAYMENT_METHOD_LABELS = {
  tarjeta: 'Tarjeta de crédito/débito',
  transferencia: 'Transferencia bancaria',
  yape: 'Yape',
  plin: 'Plin',
  contra_entrega: 'Contra entrega',
}

/**
 * validarItemsCarrito — Valida disponibilidad de stock y límites por producto.
 * @param {Array<{producto_id, cantidad}>} items
 * @param {Array} catalogo - lista completa de productos
 * @returns {{ itemsValidados, subtotal, igv, total, valido, errores }}
 */
export function validarItemsCarrito(items, catalogo) {
  const catalogById = Object.fromEntries(catalogo.map((p) => [p.id, p]))
  const itemsValidados = []
  const errores = []
  let subtotal = 0
  let valido = true

  for (const item of items) {
    const prod = catalogById[item.producto_id]
    const cantidad = item.cantidad || 1

    if (!prod) {
      valido = false
      errores.push(`Producto no encontrado: ${item.producto_id}`)
      continue
    }
    if (cantidad > MAX_UNITS_PER_PRODUCT) {
      valido = false
      errores.push(`Cantidad excede el límite (${MAX_UNITS_PER_PRODUCT}): ${prod.nombre}`)
      continue
    }
    if ((prod.stock ?? 0) < cantidad) {
      valido = false
      errores.push(`Stock insuficiente: ${prod.nombre} (stock=${prod.stock ?? 0})`)
      continue
    }

    const precioSubtotal = round2(prod.precio * cantidad)
    subtotal += precioSubtotal
    itemsValidados.push({
      producto_id: prod.id,
      nombre: prod.nombre,
      cantidad,
      precio_unitario: prod.precio,
      subtotal: precioSubtotal,
    })
  }

  const igv = round2(subtotal * IGV_RATE)
  const total = round2(subtotal + igv)

  return {
    itemsValidados,
    subtotal: round2(subtotal),
    igv,
    total,
    valido: valido && subtotal >= MIN_ORDER_AMOUNT,
    errores,
  }
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

export function formatSoles(n) {
  return `S/ ${round2(n).toFixed(2)}`
}
