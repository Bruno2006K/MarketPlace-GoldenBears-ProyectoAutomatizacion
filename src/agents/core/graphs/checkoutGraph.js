/**
 * src/agents/core/graphs/checkoutGraph.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Grafo de checkout implementado con LangGraph.js real (ver guia_automatizacion.md
 * sección 2: Nodos, Aristas Condicionales, Estado, Checkpointing).
 *
 *   START → pago ─┬─(rechazado)→ END
 *                 └─(aprobado)→ pedido ─┬─(fallo)→ END
 *                                       └─(creado)→ [inventario, notificaciones]  (fan-out paralelo)
 *                                                          ↓ (ambos convergen)
 *                                                       finalizar → END
 *
 * Cada nodo delega en el `agent.execute(tool, params, correlationId)` ya
 * existente, así que los efectos observables (eventBus.publish, sharedMemory,
 * métricas por agente) no cambian — el grafo solo reemplaza el control de
 * flujo manual (if/Promise.all) por un StateGraph real con checkpointer, lo
 * que habilita persistencia de estado por hilo (thread_id = correlationId).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { StateGraph, StateSchema, START, END, MemorySaver } from '@langchain/langgraph'
import { z } from 'zod'
import { cartPaymentAgent } from '../../CartPaymentAgent.js'
import { orderAgent } from '../../OrderAgent.js'
import { inventoryAgent } from '../../InventoryAgent.js'
import { notificationAgent } from '../../NotificationAgent.js'

const CheckoutState = new StateSchema({
  usuarioId:      z.string(),
  total:          z.number(),
  items:          z.array(z.any()).default(() => []),
  metodoPago:     z.string().default('tarjeta'),
  correlationId:  z.string(),
  pago:           z.any().nullable().default(null),
  orden:          z.any().nullable().default(null),
  inventario:     z.any().nullable().default(null),
  notificaciones: z.any().nullable().default(null),
  exito:          z.boolean().default(false),
  etapa:          z.string().nullable().default(null),
  mensaje:        z.string().nullable().default(null),
})

async function nodoPago(state) {
  const r = await cartPaymentAgent.execute('procesar_pago', {
    usuarioId: state.usuarioId, total: state.total, metodoPago: state.metodoPago, items: state.items,
  }, state.correlationId)
  const pago = r.result
  if (!pago?.exitoso) {
    return { pago, exito: false, etapa: 'pago', mensaje: 'El pago fue rechazado. Intenta nuevamente.' }
  }
  return { pago }
}

async function nodoPedido(state) {
  const r = await orderAgent.execute('crear_orden', {
    usuarioId: state.usuarioId, total: state.pago.total, items: state.pago.items || state.items,
    transaccionId: state.pago.transaccionId, exitoso: state.pago.exitoso,
  }, state.correlationId)
  const orden = r.result
  if (!orden?.creado) {
    return { orden, exito: false, etapa: 'pedido', mensaje: 'No se pudo confirmar el pedido.' }
  }
  return { orden }
}

async function nodoInventario(state) {
  const r = await inventoryAgent.execute('actualizar_stock', {
    ordenId: state.orden.ordenId, items: state.orden.items,
  }, state.correlationId)
  return { inventario: r.result }
}

async function nodoNotificaciones(state) {
  const r = await notificationAgent.execute('notificar_pedido', {
    ordenId: state.orden.ordenId, usuarioId: state.usuarioId, total: state.orden.total,
    facturaId: state.orden.facturaId, fechaEntregaEstimada: state.orden.fechaEntregaEstimada, items: state.orden.items,
  }, state.correlationId)
  return { notificaciones: r.result }
}

/** finalizar — converge tras el fan-out; dispara alertas de stock bajo si las hubo. */
async function nodoFinalizar(state) {
  const alertas = state.inventario?.alertasStock || []
  if (alertas.length > 0) {
    notificationAgent.execute('notificar_alertas_stock', { alertasStock: alertas }, state.correlationId)
  }
  return {
    exito: true,
    mensaje: `Pedido #${state.orden.ordenId} confirmado! Factura ${state.orden.facturaId}.`,
  }
}

// Nota: los nombres de nodo no pueden coincidir con las claves del estado
// (StateGraph lo prohíbe), de ahí "procesarPago" en vez de "pago", etc.
const builder = new StateGraph(CheckoutState)
  .addNode('procesarPago', nodoPago)
  .addNode('crearPedido', nodoPedido)
  .addNode('actualizarInventario', nodoInventario)
  .addNode('enviarNotificaciones', nodoNotificaciones)
  .addNode('finalizar', nodoFinalizar)
  .addEdge(START, 'procesarPago')
  .addConditionalEdges('procesarPago', (state) => (state.pago?.exitoso ? 'crearPedido' : END))
  .addConditionalEdges('crearPedido', (state) => (state.orden?.creado ? ['actualizarInventario', 'enviarNotificaciones'] : END))
  .addEdge('actualizarInventario', 'finalizar')
  .addEdge('enviarNotificaciones', 'finalizar')
  .addEdge('finalizar', END)

// Checkpointer en memoria: cada checkout es un hilo (thread_id = correlationId)
// con su propio historial de estado, resumible dentro de la misma sesión.
export const checkoutGraph = builder.compile({ checkpointer: new MemorySaver() })

export default checkoutGraph
