import { useState } from 'react'
import { AlertTriangle, CheckCircle, ShieldAlert, Edit, User, Package, Calendar } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAgents } from '../../context/AgentContext.jsx'
import Card from '../../components/ui/Card.jsx'
import Button from '../../components/ui/Button.jsx'
import styles from './SellerTicketsPage.module.css'

export default function SellerTicketsPage() {
  const { ticketsStore, resolverTicketManualmente } = useAgents()
  const [selectedTicket, setSelectedTicket] = useState(null)
  const [nuevaResolucion, setNuevaResolucion] = useState('')
  const [editando, setEditando] = useState(false)

  const handleSelect = (t) => {
    setSelectedTicket(t)
    setNuevaResolucion(t.resolucionPropuesta)
    setEditando(false)
  }

  const handleAprobar = (ticketId) => {
    const res = resolverTicketManualmente(ticketId, selectedTicket.resolucionPropuesta, 'resuelto_humano')
    if (res.exito) {
      toast.success('Resolución aprobada y registrada en el sistema')
      setSelectedTicket((prev) => ({ ...prev, estado: 'resuelto_humano', needsHumanReview: false }))
    } else {
      toast.error(res.error)
    }
  }

  const handleGuardarModificado = (ticketId) => {
    if (!nuevaResolucion.trim()) {
      toast.error('La resolución no puede estar vacía')
      return
    }
    const res = resolverTicketManualmente(ticketId, nuevaResolucion, 'resuelto_humano_modificado')
    if (res.exito) {
      toast.success('Resolución modificada y aprobada')
      setSelectedTicket((prev) => ({
        ...prev,
        resolucionPropuesta: nuevaResolucion,
        estado: 'resuelto_humano_modificado',
        needsHumanReview: false
      }))
      setEditando(false)
    } else {
      toast.error(res.error)
    }
  }

  const pendientes = ticketsStore.filter((t) => t.needsHumanReview)
  const resueltos = ticketsStore.filter((t) => !t.needsHumanReview)

  return (
    <div className="container">
      <h1 className={styles.title}>Tablero de Soporte y HITL</h1>
      <p className={styles.subtitle}>
        Revisa, edita y aprueba las resoluciones propuestas por el **ResolutionAgent** para casos de severidad crítica.
      </p>

      <div className={styles.grid}>
        {/* Lista de tickets */}
        <div className={styles.listCol}>
          <div className={styles.sectionHeader}>
            <ShieldAlert size={18} className={styles.alertIcon} />
            <h2>Pendientes de Aprobación Humana ({pendientes.length})</h2>
          </div>
          <div className={styles.list}>
            {pendientes.map((t) => (
              <TicketItem key={t.ticketId} ticket={t} active={selectedTicket?.ticketId === t.ticketId} onClick={() => handleSelect(t)} />
            ))}
            {!pendientes.length && <p className={styles.empty}>No hay reclamos pendientes de aprobación humana.</p>}
          </div>

          <div className={`${styles.sectionHeader} ${styles.sectionHeaderResueltos}`}>
            <CheckCircle size={18} className={styles.checkIcon} />
            <h2>Resueltos / Cerrados ({resueltos.length})</h2>
          </div>
          <div className={styles.list}>
            {resueltos.map((t) => (
              <TicketItem key={t.ticketId} ticket={t} active={selectedTicket?.ticketId === t.ticketId} onClick={() => handleSelect(t)} />
            ))}
            {!resueltos.length && <p className={styles.empty}>No hay tickets resueltos aún.</p>}
          </div>
        </div>

        {/* Detalle y control de ticket */}
        <div className={styles.detailCol}>
          {selectedTicket ? (
            <Card className={styles.detailCard}>
              <div className={styles.detailHeader}>
                <span className={styles.ticketId}>{selectedTicket.ticketId}</span>
                <span className={`${styles.badge} ${styles['badge-' + selectedTicket.severidad]}`}>
                  Severidad: {selectedTicket.severidad.toUpperCase()}
                </span>
              </div>

              <div className={styles.metaRow}>
                <div className={styles.metaItem}>
                  <User size={14} /> <span>{selectedTicket.usuarioId}</span>
                </div>
                {selectedTicket.ordenId && (
                  <div className={styles.metaItem}>
                    <Package size={14} /> <span>{selectedTicket.ordenId}</span>
                  </div>
                )}
                <div className={styles.metaItem}>
                  <Calendar size={14} /> <span>{new Date(selectedTicket.fechaCreacion).toLocaleDateString()}</span>
                </div>
              </div>

              <div className={styles.quejaSection}>
                <h3>Detalle de la Queja:</h3>
                <blockquote className={styles.blockquote}>"{selectedTicket.textoQueja}"</blockquote>
              </div>

              <div className={styles.resolucionSection}>
                <div className={styles.resolucionTitleRow}>
                  <h3>Resolución Propuesta por el Agente:</h3>
                  {selectedTicket.needsHumanReview && !editando && (
                    <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
                      <Edit size={12} /> Editar
                    </Button>
                  )}
                </div>

                {editando ? (
                  <div className={styles.editArea}>
                    <textarea
                      value={nuevaResolucion}
                      onChange={(e) => setNuevaResolucion(e.target.value)}
                      className={styles.textarea}
                    />
                    <div className={styles.editActions}>
                      <Button size="sm" variant="gold" onClick={() => handleGuardarModificado(selectedTicket.ticketId)}>
                        Aprobar Modificado
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditando(false)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className={styles.resolucionText}>"{selectedTicket.resolucionPropuesta}"</p>
                )}
              </div>

              {selectedTicket.needsHumanReview && !editando && (
                <div className={styles.actionRow}>
                  <Button variant="primary" onClick={() => handleAprobar(selectedTicket.ticketId)}>
                    Aprobar y Aplicar (HITL)
                  </Button>
                </div>
              )}

              {!selectedTicket.needsHumanReview && (
                <div className={styles.statusBox}>
                  <CheckCircle size={16} />
                  <span>Cerrado como: <strong>{selectedTicket.estado}</strong></span>
                </div>
              )}
            </Card>
          ) : (
            <div className={styles.emptyDetail}>
              <AlertTriangle size={32} />
              <p>Selecciona un reclamo de la lista para gestionar su resolución en este panel.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TicketItem({ ticket, active, onClick }) {
  return (
    <div className={`${styles.ticketItem} ${active ? styles.ticketActive : ''}`} onClick={onClick}>
      <div className={styles.itemHeader}>
        <span className={styles.itemCode}>{ticket.ticketId}</span>
        <span className={`${styles.badge} ${styles['badge-' + ticket.severidad]} ${styles.itemBadge}`}>
          {ticket.severidad}
        </span>
      </div>
      <p className={styles.itemText}>{ticket.textoQueja.slice(0, 50)}...</p>
      <div className={styles.itemFooter}>
        <span>{ticket.usuarioId}</span>
        <span className={styles.itemStatus}>
          {ticket.needsHumanReview ? '⚠️ Esperando Aprobación' : '✅ Resuelto'}
        </span>
      </div>
    </div>
  )
}
