/**
 * src/agents/SearchAgent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Agente de Búsqueda e IA — busca productos y genera recomendaciones.
 * Migrado de agents/busqueda_ia.py (backend Python original).
 *
 * Búsqueda vectorial (RAG, ver guia_automatizacion.md 5.2): cuando Supabase
 * está configurado y el catálogo tiene embeddings (ver seedSupabase.js), la
 * consulta se traduce a un embedding (api/embed.js → Gemini) y se compara
 * por similitud de coseno vía la función `match_productos` (pgvector). Si
 * Supabase/embeddings no están disponibles, cae automáticamente a la
 * búsqueda por texto original — el modo demo sigue funcionando sin cambios.
 *
 * Escucha (vía Orquestador):  busqueda.iniciada
 * Publica:                    busqueda.completada, resultado.agente
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { AgentBase } from './core/AgentBase.js'
import { eventBus, EVENT_TYPES } from './core/EventBus.js'
import { sharedMemory, MEMORY_KEYS } from './core/SharedMemory.js'
import { complete, MODELOS } from './core/llmClient.js'
import { apiHeaders } from './core/apiHeaders.js'
import { supabase, isSupabaseConfigured } from '../domain/supabase.js'

const SYSTEM_PROMPT = `
Eres el Agente de Búsqueda e Inteligencia Artificial del Marketplace Golden Bears.

Especialidades:
- Búsqueda semántica en el catálogo de productos usando filtros (precio, categoría, marca).
- Generación de recomendaciones personalizadas basadas en la búsqueda actual.
- Detección de intención de compra.

Sé preciso y conciso. No inventes productos que no existen en el catálogo.
`.trim()

class SearchAgentClass extends AgentBase {
  constructor() {
    super('SearchAgent', SYSTEM_PROMPT, ['api_catalogo_productos', 'filtros_avanzados', 'motor_recomendaciones'])
    this._catalog = []

    this.registerTool('buscar_productos', 'Busca productos en el catálogo por texto y filtros', this._buscarProductos)
  }

  /** setCatalog — inyecta el catálogo actual (desde CatalogContext). */
  setCatalog(catalog) {
    this._catalog = catalog || []
  }

  async _buscarProductos({ query = '', usuarioId = 'anon', filtros = {} }, correlationId) {
    const q = (query || '').toLowerCase().trim()

    let productos = await this._busquedaVectorial(q, filtros)
    const metodoBusqueda = productos ? 'vectorial_rag' : 'texto'

    if (!productos) {
      productos = this._catalog.filter((p) => {
        const haystack = `${p.nombre} ${p.categoria} ${p.marca}`.toLowerCase()
        const matchQuery = !q || q.split(' ').some((term) => haystack.includes(term))
        const minP = filtros.precioMin ?? 0
        const maxP = filtros.precioMax ?? 999999
        const matchPrecio = p.precio >= minP && p.precio <= maxP
        const matchCategoria = !filtros.categoria || filtros.categoria.toLowerCase() === p.categoria.toLowerCase()
        return matchQuery && matchPrecio && matchCategoria
      }).slice(0, 12)
    }

    const recomendaciones = this._generarRecomendaciones(productos)

    const razonamiento = await complete({
      system: this.systemPrompt,
      prompt: `El usuario buscó "${query}". Se encontraron ${productos.length} productos. Genera una descripción de búsqueda exitosa en 1 frase.`,
      mockFallback: () => `Se encontraron ${productos.length} resultados para "${query || 'todos los productos'}". Mostrando los más relevantes por rating y precio.`,
      model: MODELOS.GEMINI_FLASH,
      agente: this.name,
      correlationId,
    })

    sharedMemory.set(MEMORY_KEYS.LAST_QUERY, query, this.name)
    sharedMemory.set(MEMORY_KEYS.SEARCH_RESULTS, productos, this.name)
    sharedMemory.set(MEMORY_KEYS.RECOMMENDATIONS, recomendaciones, this.name)

    const resultPayload = { productos, recomendaciones, totalResultados: productos.length, query, razonamientoIA: razonamiento, usuarioId, metodoBusqueda }

    eventBus.publish(EVENT_TYPES.SEARCH_COMPLETED, resultPayload, this.name, correlationId)
    eventBus.publish(EVENT_TYPES.AGENT_RESULT, { agente: this.name, resultado: resultPayload, exito: true }, this.name, correlationId)

    return resultPayload
  }

  /** _obtenerEmbeddingConsulta — traduce la consulta a vector vía api/embed.js (Gemini). */
  async _obtenerEmbeddingConsulta(texto) {
    try {
      const res = await fetch('/api/embed', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ text: texto, taskType: 'RETRIEVAL_QUERY' }),
      })
      if (!res.ok) return null
      const body = await res.json().catch(() => ({}))
      return Array.isArray(body.embedding) && body.embedding.length ? body.embedding : null
    } catch {
      return null
    }
  }

  /**
   * _busquedaVectorial — RAG real vía pgvector (función match_productos).
   * Devuelve `null` (no `[]`) si no puede completar la búsqueda vectorial
   * por cualquier motivo, señal para que _buscarProductos caiga al fallback
   * de texto — nunca lanza ni bloquea el flujo de búsqueda.
   */
  async _busquedaVectorial(query, filtros) {
    if (!isSupabaseConfigured || !query) return null

    const embedding = await this._obtenerEmbeddingConsulta(query)
    if (!embedding) return null

    const { data, error } = await supabase.rpc('match_productos', {
      query_embedding: embedding,
      match_count: 12,
      filtro_categoria: filtros.categoria || null,
      precio_max: filtros.precioMax ?? null,
    })
    if (error || !data || data.length === 0) return null

    const minP = filtros.precioMin ?? 0
    return data.filter((p) => p.precio >= minP)
  }

  _generarRecomendaciones(productosEncontrados) {
    const encontradosIds = new Set(productosEncontrados.map((p) => p.id))
    const otros = this._catalog.filter((p) => !encontradosIds.has(p.id))
    const shuffled = [...otros].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, 4).map((p) => ({ producto: p, razon: 'Comprado frecuentemente con tu selección' }))
  }
}

export const searchAgent = new SearchAgentClass()
export default searchAgent
