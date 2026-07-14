/**
 * tests/resolution-soporte.test.mjs
 * Prueba la funcionalidad del ResolutionAgent: clasificación de severidad,
 * detección de HITL (Human-in-the-loop) ante quejas graves y resolución manual.
 */
import assert from 'node:assert/strict'
import { orchestrator } from '../src/agents/core/AgentOrchestrator.js'
import { eventBus } from '../src/agents/core/EventBus.js'

export async function run() {
  // Test case 1: Queja común con baja severidad
  const ticketComun = await orchestrator.procesarReclamo({
    usuarioId: 'USR-SOPORTE-1',
    textoQueja: 'El color de las zapatillas es ligeramente diferente al de la foto.'
  })

  assert.equal(ticketComun.success, true)
  const t1 = ticketComun.result
  assert.equal(t1.severidad, 'media')
  assert.equal(t1.needsHumanReview, false, 'No debería requerir aprobación humana')

  // Test case 2: Queja crítica (debería requerir HITL)
  const ticketCritico = await orchestrator.procesarReclamo({
    usuarioId: 'USR-SOPORTE-2',
    ordenId: 'ORD-12345678',
    textoQueja: 'Las zapatillas llegaron con la suela completamente rota y el empaque dañado.'
  })

  assert.equal(ticketCritico.success, true)
  const t2 = ticketCritico.result
  assert.equal(t2.severidad, 'alta')
  assert.equal(t2.needsHumanReview, true, 'Debería requerir aprobación humana debido a la severidad alta')

  // Test case 3: Resolver ticket de manera manual (Human-in-the-loop)
  const resManual = orchestrator.resolverTicketManualmente(t2.ticketId, 'Resolución aprobada: Se emite reembolso del 100%')
  assert.equal(resManual.exito, true)

  const tickets = orchestrator.getTicketsStore()
  const ticketModificado = tickets.find((t) => t.ticketId === t2.ticketId)
  assert.ok(ticketModificado)
  assert.equal(ticketModificado.needsHumanReview, false, 'El ticket ya no debería requerir revisión humana')
  assert.equal(ticketModificado.estado, 'resuelto_humano')

  console.log('✅ resolution-soporte.test.mjs OK')
}
