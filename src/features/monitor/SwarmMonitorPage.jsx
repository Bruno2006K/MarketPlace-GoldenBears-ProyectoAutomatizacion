import { useAgents } from '../../context/AgentContext.jsx'
import AgentStatusPanel from '../../components/ui/AgentStatusPanel.jsx'
import { llmMode, MODELOS } from '../../agents/core/llmClient.js'
import styles from './SwarmMonitorPage.module.css'

export default function SwarmMonitorPage() {
  const { eventLog } = useAgents()

  return (
    <div className="container">
      <h1 className={styles.title}>Monitor del Sistema Multiagente</h1>
      <p className={styles.subtitle}>Topología híbrida (Estrella + Cadena) · Event Bus con validación de JSON Schema (MCP)</p>

      <div className={`${styles.llmModeBadge} ${llmMode === 'proxy' ? styles.llmModeProxy : styles.llmModeMock}`}>
        {llmMode === 'proxy'
          ? `🟢 LLM en modo PROXY — llamando de verdad a ${MODELOS.GROQ_LLAMA.model} (Groq) y ${MODELOS.GEMINI_FLASH.model} (Gemini) vía /api/llm`
          : '🟡 LLM en modo MOCK — respuestas simuladas, sin llamadas reales a Groq/Gemini (VITE_USE_PROXY no está en "true" en este build)'}
      </div>

      <AgentStatusPanel />

      <section className={styles.eventsSection}>
        <h2>Últimos eventos publicados</h2>
        <div className={styles.eventsTable}>
          {[...eventLog].reverse().slice(0, 40).map((e) => (
            <div key={e.messageId} className={styles.eventRow}>
              <span className={styles.eventType}>{e.type}</span>
              <span className={styles.eventSource}>{e.source}</span>
              <span className={styles.eventLatency}>{e.latencyMs}ms</span>
              <span className={styles.eventTime}>{new Date(e.timestamp).toLocaleTimeString('es-PE')}</span>
            </div>
          ))}
          {!eventLog.length && <p className={styles.empty}>Aún no se han publicado eventos. Realiza una búsqueda o compra para verlos aquí.</p>}
        </div>
      </section>
    </div>
  )
}
