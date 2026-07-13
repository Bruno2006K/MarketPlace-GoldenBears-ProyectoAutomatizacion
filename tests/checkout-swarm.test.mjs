/**
 * tests/checkout-swarm.test.mjs
 * Prueba end-to-end del flujo de compra completo a través del Orquestador:
 * pago → pedido → SWARM (InventoryAgent + NotificationAgent en paralelo).
 * Verifica que ambos agentes del swarm comparten el mismo correlationId
 * (trazabilidad), igual que asyncio.gather en el backend Python original.
 */
import assert from 'node:assert/strict'
import { orchestrator } from '../src/agents/core/AgentOrchestrator.js'
import { eventBus } from '../src/agents/core/EventBus.js'

export async function run() {
  const catalogoTest = [
    { id: 'PROD-200', nombre: 'Producto Swarm', categoria: 'test', marca: 'Test', precio: 50, stock: 10 },
  ]
  orchestrator.setCatalog(catalogoTest)

  // Forzamos que el pago siempre sea aprobado (Math.random() > 0.08) para un test determinista.
  const randomOriginal = Math.random
  Math.random = () => 0.5

  let resultado
  try {
    resultado = await orchestrator.procesarCheckout({
      usuarioId: 'USR-TEST',
      items: [{ producto_id: 'PROD-200', nombre: 'Producto Swarm', cantidad: 2, precio_unitario: 50, subtotal: 100 }],
      total: 118, // 100 + 18% IGV
      metodoPago: 'tarjeta',
    })
  } finally {
    Math.random = randomOriginal
  }

  assert.equal(resultado.exito, true, 'El checkout debería completarse exitosamente')
  assert.ok(resultado.pedido?.ordenId?.startsWith('ORD-'))
  assert.ok(resultado.pago?.exitoso)
  assert.ok(resultado.inventario, 'El resultado del swarm debe incluir inventario')
  assert.ok(resultado.notificaciones, 'El resultado del swarm debe incluir notificaciones')

  // Verifica trazabilidad: ambos eventos del swarm comparten correlationId
  const historial = eventBus.getHistory(50)
  const eventosDelSwarm = historial.filter((e) => e.correlationId === resultado.correlationId)
  const tiposPublicados = eventosDelSwarm.map((e) => e.type)
  assert.ok(tiposPublicados.includes('inventario.actualizado'), 'Debe publicarse inventario.actualizado con el mismo correlationId')
  assert.ok(tiposPublicados.includes('notificacion.enviada'), 'Debe publicarse notificacion.enviada con el mismo correlationId')

  // Verifica que el stock se descontó (2 unidades)
  assert.equal(orchestrator.getStock('PROD-200'), 8)

  // Verifica que la orden quedó registrada en el store del vendedor
  const ordenes = orchestrator.getOrdersStore()
  assert.ok(ordenes.some((o) => o.ordenId === resultado.pedido.ordenId))

  console.log('✅ checkout-swarm.test.mjs OK')
}
