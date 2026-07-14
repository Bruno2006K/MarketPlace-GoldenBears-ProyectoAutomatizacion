/**
 * src/agents/core/graphs/resolutionChatGraph.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Chat de soporte conversacional (multi-turno) del ResolutionAgent. A
 * diferencia de resolutionGraph.js (análisis de un solo turno), este grafo
 * mantiene una conversación real con el cliente: recibe, empatiza, verifica
 * el pedido contra datos reales (tool `check_order_status` → OrderAgent),
 * ofrece opciones de compensación concretas y cierra o escala a un humano.
 *
 * Cada mensaje del usuario dispara un `invoke()` nuevo sobre el MISMO
 * thread_id (conversationId) — el checkpointer (MemorySaver) preserva el
 * estado entre turnos, así que el grafo "recuerda" la fase de la conversación
 * sin necesitar interrupt() (no disponible en navegadores, ver
 * resolutionGraph.js para el detalle de esa limitación).
 *
 * Fases (state.fase):
 *   inicio → esperando_orden → [esperando_evidencia] → esperando_decision → cerrado
 *                                                                          ↘ escalado_humano (en cualquier punto, si el sentimiento es muy_negativo)
 *
 * Anti-alucinación (guia_automatizacion.md, sección 6): la severidad, las
 * opciones de compensación y los montos/plazos SIEMPRE se deciden con reglas
 * deterministas en JS (definirOpciones, buscarOrden) — el LLM solo redacta,
 * nunca inventa una política ni un dato de pedido.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { StateGraph, StateSchema, START, END, MemorySaver, ReducedValue } from '@langchain/langgraph'
import { z } from 'zod'
import { complete, MODELOS } from '../llmClient.js'
import { alertHITL } from '../langsmithClient.js'
import { uuid } from '../uuid.js'
import { orderAgent } from '../../OrderAgent.js'
import { resolutionAgent } from '../../ResolutionAgent.js'

const SYSTEM_PROMPT_CHAT = `
Eres el agente de soporte conversacional del Marketplace Golden Bears, atendiendo un chat en vivo con un cliente.

Reglas estrictas:
- Nunca inventes políticas, montos, plazos ni datos de pedidos que no se te entreguen explícitamente en el prompt de cada turno.
- Sé empático pero conciso (máximo 2-3 frases por respuesta).
- Nunca prometas algo que no esté en las instrucciones del turno actual.
- Cuando se te pida responder en JSON, responde ÚNICAMENTE el JSON, sin texto adicional, sin markdown.
`.trim()

// ── Helpers deterministas (anti-alucinación) ──────────────────────────────

function extraerOrdenId(texto) {
  const m = (texto || '').match(/ORD-[A-Z0-9]{6,10}/i)
  return m ? m[0].toUpperCase() : null
}

function esMuyNegativo(texto) {
  const t = (texto || '').toLowerCase()
  return /estafa|denuncia|demanda|fiscal[ií]a|indecopi|abogado|nunca m[aá]s (les )?compro|p[eé]sim[oa] (atenci[oó]n|servicio)/.test(t)
}

function clasificarSentimientoBase(texto) {
  const t = (texto || '').toLowerCase()
  if (esMuyNegativo(t)) return 'muy_negativo'
  if (/rot[oa]s?\b|no (me )?(ha )?llegad|malogr|perdido|duplicad|equivocad|estafado/.test(t)) return 'negativo'
  return 'neutral'
}

const SEVERIDAD_SENTIMIENTO = { neutral: 0, negativo: 1, muy_negativo: 2 }
function combinarSentimiento(a, b) {
  return (SEVERIDAD_SENTIMIENTO[a] ?? 0) >= (SEVERIDAD_SENTIMIENTO[b] ?? 0) ? a : b
}

function detectarEleccion(texto, opciones) {
  const t = (texto || '').toLowerCase()
  if (opciones.includes('reembolso') && /reembols|devoluci[oó]n del dinero|devu[ée]lvanme|mi dinero/.test(t)) return 'reembolso'
  if (opciones.includes('reenvio') && /reenv[ií]|cambio|otro producto|env[ií]en (uno )?nuevo/.test(t)) return 'reenvio'
  return null
}

/** buscarOrden — tool real (check_order_status): consulta el store de OrderAgent, aislado por usuario. */
function buscarOrden(ordenId, usuarioId) {
  return orderAgent.getOrdersStore().find((o) => o.ordenId === ordenId && o.usuarioId === usuarioId) || null
}

/** definirOpciones — regla de negocio determinista: no se puede "reenviar" lo que no se ha despachado aún. */
function definirOpciones(ordenInfo) {
  return ordenInfo.estado === 'despachado' ? ['reembolso', 'reenvio'] : ['reembolso']
}

function describirOpcion(o) {
  return o === 'reembolso' ? 'reembolso del 100% del monto pagado' : 'reenvío inmediato de un producto nuevo sin costo adicional'
}

/** hayContradiccionEntrega — replica el paso "no alucinar" del ejemplo: si dice que no llegó pero figura despachado, pedir evidencia antes de resolver. */
function hayContradiccionEntrega(ordenInfo, texto) {
  const diceNoLlego = /no (me )?(ha |han )?llegad|nunca (me )?lleg|no (lo |la )?(he |ha )?recib/i.test(texto || '')
  return diceNoLlego && ordenInfo?.estado === 'despachado'
}

function parseRespuestaJSON(texto, schema) {
  try {
    const match = (texto || '').match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = schema.safeParse(JSON.parse(match[0]))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const ClasificacionSchema = z.object({
  sentimiento: z.enum(['neutral', 'negativo', 'muy_negativo']),
  respuesta: z.string().min(1),
})

function mensajeAgente(content) {
  return { role: 'agente', content, timestamp: new Date().toISOString() }
}
function mensajeUsuario(content) {
  return { role: 'usuario', content, timestamp: new Date().toISOString() }
}

// ── Estado del grafo ───────────────────────────────────────────────────────

const ChatState = new StateSchema({
  conversationId: z.string(),
  usuarioId: z.string(),
  ordenIdHint: z.string().nullable().default(null),
  ultimoMensaje: z.string().default(''),
  quejaOriginal: z.string().default(''),
  fase: z.string().default('inicio'),
  sentimiento: z.string().nullable().default(null),
  ordenId: z.string().nullable().default(null),
  ordenInfo: z.any().nullable().default(null),
  opciones: z.array(z.string()).default(() => []),
  opcionElegida: z.string().nullable().default(null),
  evidenciaSolicitada: z.boolean().default(false),
  needsHumanReview: z.boolean().default(false),
  ticketId: z.string().nullable().default(null),
  resolucionFinal: z.string().nullable().default(null),
  historial: new ReducedValue(z.array(z.any()).default(() => []), { reducer: (a, b) => [...a, ...b] }),
})

// ── Nodos ────────────────────────────────────────────────────────────────

async function registrarMensajeUsuario(state) {
  return { historial: [mensajeUsuario(state.ultimoMensaje)] }
}

async function saludarYClasificar(state) {
  const mensaje = state.ultimoMensaje
  const ordenIdDetectada = extraerOrdenId(mensaje) || state.ordenIdHint || null
  const sentimientoDeterminista = clasificarSentimientoBase(mensaje)

  const raw = await complete({
    system: SYSTEM_PROMPT_CHAT,
    prompt: `Primer mensaje del cliente: "${mensaje}".
${ordenIdDetectada
      ? `Ya identificaste el número de orden: ${ordenIdDetectada}. Responde SOLO con un breve reconocimiento empático (1 frase) de que vas a revisar su pedido — NO pidas el número de orden porque ya lo tienes, NO ofrezcas soluciones todavía.`
      : 'No mencionó ningún número de orden. Responde con empatía por su situación y pídele el número de orden (formato ORD-XXXXXXXX) para poder ayudarlo.'}
Responde ÚNICAMENTE en JSON con este formato exacto: {"sentimiento": "neutral"|"negativo"|"muy_negativo", "respuesta": "..."}`,
    mockFallback: () => JSON.stringify({
      sentimiento: sentimientoDeterminista,
      respuesta: ordenIdDetectada
        ? 'Lamento el inconveniente. Dame un momento para revisar tu pedido...'
        : 'Lamento mucho leer que has tenido problemas con tu pedido. Para ayudarte, ¿podrías darme tu número de orden (formato ORD-XXXXXXXX)?',
    }),
    model: MODELOS.GROQ_LLAMA,
    agente: 'ResolutionAgent',
    correlationId: state.conversationId,
  })

  const parsed = parseRespuestaJSON(raw, ClasificacionSchema)
  const sentimiento = combinarSentimiento(parsed?.sentimiento || sentimientoDeterminista, sentimientoDeterminista)
  const respuesta = parsed?.respuesta || (ordenIdDetectada ? 'Dame un momento para revisar tu pedido...' : '¿Podrías darme tu número de orden para ayudarte?')

  return {
    quejaOriginal: mensaje,
    ordenId: ordenIdDetectada,
    sentimiento,
    ...(ordenIdDetectada ? {} : { fase: 'esperando_orden' }),
    historial: [mensajeAgente(respuesta)],
  }
}

async function recibirOrden(state) {
  const ordenIdDetectada = extraerOrdenId(state.ultimoMensaje)
  if (!ordenIdDetectada) {
    return { historial: [mensajeAgente('No logré identificar un número de orden válido (formato ORD-XXXXXXXX). ¿Podrías copiarlo tal como aparece en tu comprobante?')] }
  }
  const orden = buscarOrden(ordenIdDetectada, state.usuarioId)
  if (!orden) {
    return { historial: [mensajeAgente(`No encontré ninguna orden ${ordenIdDetectada} asociada a tu cuenta. ¿Puedes verificar el número?`)] }
  }
  return { ordenId: ordenIdDetectada, ordenInfo: orden }
}

async function analizarPedido(state) {
  let ordenInfo = state.ordenInfo
  if (!ordenInfo && state.ordenId) ordenInfo = buscarOrden(state.ordenId, state.usuarioId)
  if (!ordenInfo) {
    return { fase: 'esperando_orden', historial: [mensajeAgente(`No encontré ninguna orden ${state.ordenId || ''} asociada a tu cuenta. ¿Puedes verificar el número?`)] }
  }

  if (!state.evidenciaSolicitada && hayContradiccionEntrega(ordenInfo, state.quejaOriginal)) {
    return {
      ordenInfo, fase: 'esperando_evidencia', evidenciaSolicitada: true,
      historial: [mensajeAgente(`Veo que tu pedido ${state.ordenId} figura como despachado, pero me indicas que no te ha llegado. ¿Alguien más en tu domicilio pudo haberlo recibido, o tienes alguna referencia del envío? Cuéntame y seguimos con la solución.`)],
    }
  }

  const opciones = definirOpciones(ordenInfo)
  const opcionesTexto = opciones.map(describirOpcion).join(' o ')

  const respuesta = await complete({
    system: SYSTEM_PROMPT_CHAT,
    prompt: `Queja del cliente: "${state.quejaOriginal}". Orden ${state.ordenId} verificada (estado: ${ordenInfo.estado}).
Opciones EXACTAS a ofrecer (no agregues, cambies ni quites ninguna): ${opcionesTexto}.
Redacta el mensaje ofreciendo estas opciones y pregunta cuál prefiere. Máximo 3 frases.`,
    mockFallback: () => `Gracias por la información. Para tu pedido ${state.ordenId} puedo ofrecerte ${opcionesTexto}. ¿Cuál prefieres?`,
    model: MODELOS.GROQ_LLAMA,
    agente: 'ResolutionAgent',
    correlationId: state.conversationId,
  })

  return { ordenInfo, opciones, fase: 'esperando_decision', historial: [mensajeAgente(respuesta)] }
}

async function procesarDecision(state) {
  const eleccion = detectarEleccion(state.ultimoMensaje, state.opciones)
  if (!eleccion) {
    const opcionesTexto = state.opciones.map(describirOpcion).join(' o ')
    return { historial: [mensajeAgente(`No logré identificar tu elección. Por favor dime si prefieres ${opcionesTexto}.`)] }
  }

  // Acción determinista (no LLM): folio y plazo son datos reales del sistema, no los redacta la IA.
  const folio = eleccion === 'reembolso' ? `REEM-${uuid().slice(0, 8).toUpperCase()}` : `GUIA-${uuid().slice(0, 8).toUpperCase()}`
  const plazo = eleccion === 'reembolso' ? '3 días hábiles a tu método de pago original' : '2 días hábiles con envío express sin costo'

  const respuesta = await complete({
    system: SYSTEM_PROMPT_CHAT,
    prompt: `El cliente eligió: ${eleccion}. Folio generado: ${folio}. Plazo EXACTO: ${plazo}.
Redacta la confirmación final, cordial y breve (máximo 3 frases), incluyendo el folio y el plazo tal cual. Cierra preguntando si necesita algo más.`,
    mockFallback: () => `¡Listo! He procesado tu ${eleccion} con folio ${folio}. Lo recibirás en ${plazo}. ¿Necesitas algo más?`,
    model: MODELOS.GROQ_LLAMA,
    agente: 'ResolutionAgent',
    correlationId: state.conversationId,
  })

  return {
    fase: 'cerrado',
    opcionElegida: eleccion,
    resolucionFinal: `${eleccion === 'reembolso' ? 'Reembolso' : 'Reenvío'} procesado (folio ${folio}), ${plazo}.`,
    historial: [mensajeAgente(respuesta)],
  }
}

async function cerrarTicket(state) {
  const ticketId = `TKT-${uuid().slice(0, 8).toUpperCase()}`
  resolutionAgent.registrarTicketChat({
    ticketId,
    usuarioId: state.usuarioId,
    ordenId: state.ordenId,
    textoQueja: state.quejaOriginal,
    severidad: state.sentimiento === 'muy_negativo' ? 'alta' : state.sentimiento === 'negativo' ? 'media' : 'baja',
    resolucionPropuesta: state.resolucionFinal,
    razonamientoReAct: state.historial.map((m) => `[${m.role}] ${m.content}`).join('\n'),
    confianza: 0.95,
    needsHumanReview: false,
    estado: 'resuelto_autonomo',
    fechaCreacion: new Date().toISOString(),
  }, state.conversationId)
  return { ticketId }
}

async function escalarHumano(state) {
  const ticketId = `TKT-${uuid().slice(0, 8).toUpperCase()}`
  const textoQueja = state.quejaOriginal || state.ultimoMensaje
  const respuesta = 'Entiendo tu frustración y quiero asegurarme de que esto se resuelva de la mejor forma posible. Voy a derivar tu caso de inmediato a un miembro de nuestro equipo humano, que se pondrá en contacto contigo a la brevedad.'

  resolutionAgent.registrarTicketChat({
    ticketId,
    usuarioId: state.usuarioId,
    ordenId: state.ordenId,
    textoQueja,
    severidad: 'alta',
    resolucionPropuesta: 'Caso derivado a revisión humana por severidad crítica.',
    razonamientoReAct: state.historial.map((m) => `[${m.role}] ${m.content}`).join('\n'),
    confianza: 0.4,
    needsHumanReview: true,
    estado: 'revision_pendiente',
    fechaCreacion: new Date().toISOString(),
  }, state.conversationId)

  alertHITL({ ticketId, usuarioId: state.usuarioId, textoQueja, severidad: 'alta', confianza: 0.4, correlationId: state.conversationId })

  return { fase: 'escalado_humano', needsHumanReview: true, ticketId, historial: [mensajeAgente(respuesta)] }
}

async function turnoPostCierre(state) {
  const mensaje = state.fase === 'escalado_humano'
    ? 'Tu caso ya fue derivado a un asesor humano, se pondrá en contacto contigo pronto. Gracias por tu paciencia.'
    : 'Este caso ya fue resuelto. Si tienes un problema nuevo, cuéntame los detalles y con gusto te ayudo.'
  return { historial: [mensajeAgente(mensaje)] }
}

// ── Grafo ────────────────────────────────────────────────────────────────

function enrutarPorFase(state) {
  switch (state.fase) {
    case 'esperando_orden': return 'recibirOrden'
    case 'esperando_evidencia': return 'analizarPedido'
    case 'esperando_decision': return 'procesarDecision'
    case 'cerrado':
    case 'escalado_humano':
      return 'turnoPostCierre'
    default: return 'saludarYClasificar'
  }
}

const builder = new StateGraph(ChatState)
  .addNode('registrarMensajeUsuario', registrarMensajeUsuario)
  .addNode('saludarYClasificar', saludarYClasificar)
  .addNode('recibirOrden', recibirOrden)
  .addNode('analizarPedido', analizarPedido)
  .addNode('procesarDecision', procesarDecision)
  .addNode('cerrarTicket', cerrarTicket)
  .addNode('escalarHumano', escalarHumano)
  .addNode('turnoPostCierre', turnoPostCierre)
  .addEdge(START, 'registrarMensajeUsuario')
  .addConditionalEdges('registrarMensajeUsuario', enrutarPorFase)
  .addConditionalEdges('saludarYClasificar', (state) => {
    if (state.sentimiento === 'muy_negativo') return 'escalarHumano'
    if (state.ordenId) return 'analizarPedido'
    return END
  })
  .addConditionalEdges('recibirOrden', (state) => (state.ordenInfo ? 'analizarPedido' : END))
  .addEdge('analizarPedido', END)
  .addConditionalEdges('procesarDecision', (state) => (state.fase === 'cerrado' ? 'cerrarTicket' : END))
  .addEdge('cerrarTicket', END)
  .addEdge('escalarHumano', END)
  .addEdge('turnoPostCierre', END)

export const resolutionChatGraph = builder.compile({ checkpointer: new MemorySaver() })

export default resolutionChatGraph