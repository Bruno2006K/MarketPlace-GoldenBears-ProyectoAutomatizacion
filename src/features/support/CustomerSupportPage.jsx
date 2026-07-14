import { useState } from 'react'
import { LifeBuoy, AlertCircle, CheckCircle, Clock, ShieldAlert } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAgents } from '../../context/AgentContext.jsx'
import Card from '../../components/ui/Card.jsx'
import Button from '../../components/ui/Button.jsx'
import Input from '../../components/ui/Input.jsx'
import styles from './CustomerSupportPage.module.css'

export default function CustomerSupportPage() {
  const { procesarReclamo, ordersStore } = useAgents()
  const [usuarioId, setUsuarioId] = useState('USR-001')
  const [ordenId, setOrdenId] = useState('')
  const [textoQueja, setTextoQueja] = useState('')
  const [procesando, setProcesando] = useState(false)
  const [ultimoTicket, setUltimoTicket] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!textoQueja.trim()) {
      toast.error('Por favor escribe el detalle de tu reclamo')
      return
    }

    setProcesando(true)
    try {
      const res = await procesarReclamo({
        usuarioId,
        ordenId: ordenId || null,
        textoQueja
      })
      if (res.success) {
        setUltimoTicket(res.result)
        toast.success('Tu reclamo ha sido procesado por el ResolutionAgent')
      } else {
        toast.error('Error al procesar el reclamo: ' + res.error)
      }
    } catch (err) {
      console.error('[CustomerSupportPage] procesarReclamo falló:', err)
      toast.error('Error en el sistema de soporte')
    } finally {
      setProcesando(false)
    }
  }

  return (
    <div className="container">
      <h1 className={styles.title}>
        <LifeBuoy size={28} className={styles.titleIcon} />
        Centro de Soporte y Reclamos
      </h1>
      <p className={styles.subtitle}>
        Nuestro **ResolutionAgent** evalúa la severidad de tu problema usando el patrón ReAct y propone una solución inmediata.
      </p>

      <div className={styles.grid}>
        {/* Formulario */}
        <Card className={styles.card}>
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.formGroup}>
              <label>ID de Usuario</label>
              <Input value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)} required />
            </div>

            <div className={styles.formGroup}>
              <label>ID de Orden (Opcional)</label>
              <select value={ordenId} onChange={(e) => setOrdenId(e.target.value)} className={styles.select}>
                <option value="">-- No relacionar con orden --</option>
                {ordersStore.map((o) => (
                  <option key={o.ordenId} value={o.ordenId}>
                    {o.ordenId} (S/{o.total})
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label>Detalle de tu Queja / Reclamo</label>
              <textarea
                className={styles.textarea}
                placeholder="Ejemplo: Recibí el calzado PROD-001 pero tiene la suela rota / Mi pedido ORD-12345 no ha llegado y pagué con tarjeta..."
                value={textoQueja}
                onChange={(e) => setTextoQueja(e.target.value)}
                required
              />
            </div>

            <Button type="submit" variant="primary" loading={procesando} className={styles.submitBtn}>
              Enviar Reclamo a la IA
            </Button>
          </form>
        </Card>

        {/* Resultado del Agente */}
        <Card className={`${styles.card} ${styles.resultCard}`}>
          <h2>Resultado del Agente de IA</h2>
          {ultimoTicket ? (
            <div className={styles.resultDetails}>
              <div className={styles.badgeRow}>
                <span className={`${styles.badge} ${styles['badge-' + ultimoTicket.severidad]}`}>
                  Severidad: {ultimoTicket.severidad.toUpperCase()}
                </span>
                {ultimoTicket.needsHumanReview ? (
                  <span className={`${styles.badge} ${styles.badgeHitl}`}>
                    <ShieldAlert size={14} /> HITL: Pendiente de Aprobación Manual
                  </span>
                ) : (
                  <span className={`${styles.badge} ${styles.badgeAuto}`}>
                    <CheckCircle size={14} /> Resuelto Autónomamente
                  </span>
                )}
              </div>

              <div className={styles.resultItem}>
                <h3>Ticket Generado:</h3>
                <span className={styles.code}>{ultimoTicket.ticketId}</span>
              </div>

              <div className={styles.resultItem}>
                <h3>Razonamiento ReAct (Thought → Action → Observation):</h3>
                <pre className={styles.pre}>{ultimoTicket.razonamientoReAct}</pre>
              </div>

              <div className={styles.resultItem}>
                <h3>Propuesta de Resolución de la IA:</h3>
                <p className={styles.proposalText}>"{ultimoTicket.resolucionPropuesta}"</p>
              </div>

              {ultimoTicket.needsHumanReview && (
                <div className={styles.alertBox}>
                  <AlertCircle size={18} />
                  <span>
                    Debido a la severidad o criticidad del caso (Confianza: {Math.round(ultimoTicket.confianza * 100)}%), este ticket se ha pausado y enviado al panel de soporte para aprobación humana antes de liquidarse.
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className={styles.emptyResult}>
              <Clock size={40} />
              <p>Envía tu queja para ver el flujo de razonamiento ReAct del ResolutionAgent aquí.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
