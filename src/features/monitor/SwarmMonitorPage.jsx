import { useAgents } from '../../context/AgentContext.jsx'
import AgentStatusPanel from '../../components/ui/AgentStatusPanel.jsx'
import styles from './SwarmMonitorPage.module.css'

export default function SwarmMonitorPage() {
  const { eventLog } = useAgents()

  return (
    <div className="container">
      <h1 className={styles.title}>Monitor del Sistema Multiagente</h1>
      <p className={styles.subtitle}>Topología híbrida (Estrella + Cadena) · Event Bus con validación de JSON Schema (MCP)</p>

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
