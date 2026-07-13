import { Activity, Zap, Database, GitBranch } from 'lucide-react'
import { useAgents } from '../../context/AgentContext.jsx'
import styles from './AgentStatusPanel.module.css'

export default function AgentStatusPanel() {
  const { systemStatus } = useAgents()
  const { orchestrator, agents, eventBus, sharedMemory } = systemStatus

  return (
    <div className={styles.panel}>
      <div className={styles.summaryRow}>
        <SummaryCard icon={<GitBranch size={16} />} label="Topología" value={orchestrator.topology} />
        <SummaryCard icon={<Activity size={16} />} label="Agentes activos" value={`${agents.filter((a) => a.isActive).length}/${agents.length}`} />
        <SummaryCard icon={<Zap size={16} />} label="Swarms ejecutados" value={orchestrator.swarmExecutions} />
        <SummaryCard icon={<Database size={16} />} label="Eventos publicados" value={eventBus.totalMessages} />
      </div>

      <div className={styles.agentsGrid}>
        {agents.map((a) => (
          <div key={a.agentName} className={styles.agentCard}>
            <div className={styles.agentHeader}>
              <span className={`${styles.dot} ${a.isActive ? styles.dotActive : ''}`} />
              <strong>{a.agentName}</strong>
            </div>
            <div className={styles.agentMetrics}>
              <span>{a.totalCalls} llamadas</span>
              <span>{a.successRate}% éxito</span>
              <span>{a.avgLatency}ms prom.</span>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.memoryRow}>
        <span>Memoria compartida: {sharedMemory.totalKeys} claves · {sharedMemory.totalWrites} escrituras · {sharedMemory.conflicts} conflictos ({sharedMemory.resolutionRate}% resueltos)</span>
      </div>
    </div>
  )
}

function SummaryCard({ icon, label, value }) {
  return (
    <div className={styles.summaryCard}>
      <div className={styles.summaryIcon}>{icon}</div>
      <div>
        <div className={styles.summaryLabel}>{label}</div>
        <div className={styles.summaryValue}>{value}</div>
      </div>
    </div>
  )
}
