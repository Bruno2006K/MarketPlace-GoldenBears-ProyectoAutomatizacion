import { useState, useRef, useEffect } from 'react'
import { LifeBuoy, Send, ShieldAlert, CheckCircle, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAgents } from '../../context/AgentContext.jsx'
import { uuid } from '../../agents/core/uuid.js'
import Card from '../../components/ui/Card.jsx'
import Button from '../../components/ui/Button.jsx'
import styles from './CustomerSupportPage.module.css'

const SALUDO_INICIAL = {
  role: 'agente',
  content: 'Hola, soy el asistente de soporte de Golden Bears. Cuéntame qué pasó con tu pedido y te ayudo a resolverlo.',
  timestamp: new Date().toISOString(),
}

export default function CustomerSupportPage() {
  const { enviarMensajeChatSoporte, ordersStore } = useAgents()
  const [usuarioId, setUsuarioId] = useState('USR-001')
  const [ordenId, setOrdenId] = useState('')
  const [conversationId, setConversationId] = useState(() => uuid())
  const [mensajes, setMensajes] = useState([SALUDO_INICIAL])
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [fase, setFase] = useState('inicio')
  const [ticketId, setTicketId] = useState(null)
  const scrollRef = useRef(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [mensajes])

  const cerrado = fase === 'cerrado' || fase === 'escalado_humano'

  const handleEnviar = async (e) => {
    e.preventDefault()
    const contenido = texto.trim()
    if (!contenido) return

    setMensajes((prev) => [...prev, { role: 'usuario', content: contenido, timestamp: new Date().toISOString() }])
    setTexto('')
    setEnviando(true)

    try {
      const res = await enviarMensajeChatSoporte({
        conversationId,
        usuarioId,
        ordenIdHint: ordenId || null,
        mensaje: contenido,
      })
      setMensajes((prev) => [...prev, { role: 'agente', content: res.respuesta, timestamp: new Date().toISOString() }])
      setFase(res.fase)
      setTicketId(res.ticketId)
    } catch (err) {
      console.error('[CustomerSupportPage] enviarMensajeChatSoporte falló:', err)
      toast.error('Error en el sistema de soporte')
      setMensajes((prev) => [...prev, { role: 'agente', content: 'Tuve un problema técnico procesando tu mensaje. ¿Puedes intentarlo de nuevo?', timestamp: new Date().toISOString() }])
    } finally {
      setEnviando(false)
    }
  }

  const handleReiniciar = () => {
    setConversationId(uuid())
    setMensajes([SALUDO_INICIAL])
    setFase('inicio')
    setTicketId(null)
    setOrdenId('')
  }

  return (
    <div className="container">
      <h1 className={styles.title}>
        <LifeBuoy size={28} className={styles.titleIcon} />
        Centro de Soporte y Reclamos
      </h1>
      <p className={styles.subtitle}>
        Chatea con nuestro <strong>ResolutionAgent</strong>: entiende el contexto de tu reclamo, verifica tu pedido y te ofrece una solución real, no una respuesta genérica.
      </p>

      <Card className={styles.chatCard}>
        <div className={styles.chatHeader}>
          <div className={styles.chatHeaderInfo}>
            <label>
              Tu usuario
              <input className={styles.userIdInput} value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)} disabled={mensajes.length > 1} />
            </label>
            <label>
              Orden (opcional, si ya la tienes a mano)
              <select className={styles.userIdInput} value={ordenId} onChange={(e) => setOrdenId(e.target.value)} disabled={mensajes.length > 1}>
                <option value="">-- El agente te la pedirá --</option>
                {ordersStore.map((o) => (
                  <option key={o.ordenId} value={o.ordenId}>{o.ordenId} (S/{o.total})</option>
                ))}
              </select>
            </label>
          </div>

          {fase === 'escalado_humano' && (
            <span className={`${styles.faseBadge} ${styles.faseBadgeHitl}`}>
              <ShieldAlert size={14} /> Derivado a soporte humano
            </span>
          )}
          {fase === 'cerrado' && (
            <span className={`${styles.faseBadge} ${styles.faseBadgeCerrado}`}>
              <CheckCircle size={14} /> Caso resuelto {ticketId && `· ${ticketId}`}
            </span>
          )}

          <Button size="sm" variant="outline" onClick={handleReiniciar} title="Iniciar una conversación nueva">
            <RotateCcw size={14} /> Nueva conversación
          </Button>
        </div>

        <div className={styles.chatBody} ref={scrollRef}>
          {mensajes.map((m, i) => (
            <div key={i} className={`${styles.bubbleRow} ${m.role === 'usuario' ? styles.bubbleRowUser : ''}`}>
              <div className={`${styles.bubble} ${m.role === 'usuario' ? styles.bubbleUser : styles.bubbleAgente}`}>
                {m.content}
              </div>
            </div>
          ))}
          {enviando && (
            <div className={styles.bubbleRow}>
              <div className={`${styles.bubble} ${styles.bubbleAgente} ${styles.bubbleTyping}`}>
                <span className={styles.typingDot} /><span className={styles.typingDot} /><span className={styles.typingDot} />
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleEnviar} className={styles.chatInputRow}>
          <input
            className={styles.chatInput}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={cerrado ? 'La conversación terminó — puedes escribir para abrir un caso nuevo' : 'Escribe tu mensaje...'}
            disabled={enviando}
          />
          <Button type="submit" variant="primary" loading={enviando} disabled={!texto.trim()}>
            <Send size={16} />
          </Button>
        </form>
      </Card>
    </div>
  )
}