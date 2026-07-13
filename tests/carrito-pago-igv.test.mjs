/**
 * tests/carrito-pago-igv.test.mjs
 * Verifica el cálculo de IGV (18%) y las reglas de validación del carrito
 * (máx. 10 unidades/producto, monto mínimo S/10.00, stock insuficiente).
 * Migrado de la lógica de agents/carrito_pago.py.
 */
import assert from 'node:assert/strict'
import { validarItemsCarrito, MAX_UNITS_PER_PRODUCT, MIN_ORDER_AMOUNT } from '../src/domain/pricing.js'

const CATALOGO_TEST = [
  { id: 'PROD-001', nombre: 'Producto A', precio: 100, stock: 20 },
  { id: 'PROD-002', nombre: 'Producto B', precio: 5, stock: 2 },
]

export async function run() {
  // 1. Cálculo correcto de IGV 18%
  const r1 = validarItemsCarrito([{ producto_id: 'PROD-001', cantidad: 2 }], CATALOGO_TEST)
  assert.equal(r1.subtotal, 200)
  assert.equal(r1.igv, 36) // 200 * 0.18
  assert.equal(r1.total, 236)
  assert.equal(r1.valido, true)

  // 2. Cantidad excede el límite por producto
  const r2 = validarItemsCarrito([{ producto_id: 'PROD-001', cantidad: MAX_UNITS_PER_PRODUCT + 1 }], CATALOGO_TEST)
  assert.equal(r2.valido, false)
  assert.ok(r2.errores.length > 0)

  // 3. Stock insuficiente
  const r3 = validarItemsCarrito([{ producto_id: 'PROD-002', cantidad: 5 }], CATALOGO_TEST)
  assert.equal(r3.valido, false)

  // 4. Monto mínimo de orden no alcanzado (subtotal < S/10)
  const r4 = validarItemsCarrito([{ producto_id: 'PROD-002', cantidad: 1 }], CATALOGO_TEST)
  assert.ok(r4.subtotal < MIN_ORDER_AMOUNT)
  assert.equal(r4.valido, false)

  // 5. Producto inexistente
  const r5 = validarItemsCarrito([{ producto_id: 'PROD-999', cantidad: 1 }], CATALOGO_TEST)
  assert.equal(r5.valido, false)
  assert.ok(r5.errores.some((e) => e.includes('no encontrado')))

  console.log('✅ carrito-pago-igv.test.mjs OK')
}
