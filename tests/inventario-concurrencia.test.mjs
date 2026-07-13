/**
 * tests/inventario-concurrencia.test.mjs
 * Verifica el descuento de stock, alertas de STOCK_BAJO/AGOTADO y detección
 * de conflictos (stock insuficiente). Migrado de agents/inventario.py.
 */
import assert from 'node:assert/strict'
import { inventoryAgent } from '../src/agents/InventoryAgent.js'

export async function run() {
  inventoryAgent.setCatalog([
    { id: 'PROD-100', stock: 6 },
    { id: 'PROD-101', stock: 1 },
  ])

  // 1. Descuento normal, sin alertas (queda en 5 → todavía no es "bajo", umbral es <5)
  const r1 = await inventoryAgent.execute('actualizar_stock', {
    ordenId: 'ORD-TEST-1',
    items: [{ producto_id: 'PROD-100', cantidad: 1, nombre: 'Producto 100' }],
  })
  assert.equal(r1.success, true)
  assert.equal(inventoryAgent.getStock('PROD-100'), 5)

  // 2. Descuento que deja el stock en 0 → alerta AGOTADO
  const r2 = await inventoryAgent.execute('actualizar_stock', {
    ordenId: 'ORD-TEST-2',
    items: [{ producto_id: 'PROD-101', cantidad: 1, nombre: 'Producto 101' }],
  })
  assert.equal(inventoryAgent.getStock('PROD-101'), 0)
  assert.ok(r2.result.alertasStock.some((a) => a.nivel === 'AGOTADO'))

  // 3. Pedir más stock del disponible → conflicto, exito=false
  const r3 = await inventoryAgent.execute('actualizar_stock', {
    ordenId: 'ORD-TEST-3',
    items: [{ producto_id: 'PROD-101', cantidad: 5, nombre: 'Producto 101' }],
  })
  assert.equal(r3.result.exito, false)
  assert.ok(r3.result.conflictos.length > 0)
  assert.equal(inventoryAgent.getStock('PROD-101'), 0, 'El stock no debe quedar negativo')

  console.log('✅ inventario-concurrencia.test.mjs OK')
}
