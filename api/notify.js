/**
 * api/notify.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Envío real de emails vía Gmail SMTP (nodemailer), server-side.
 * Migrado de la función `_send_gmail` en agents/notificaciones.py (backend
 * Python original, que usaba smtplib). Aquí se usa nodemailer porque el envío
 * SMTP no puede hacerse desde el navegador — necesita correr en el servidor,
 * igual que el proxy de LLM.
 *
 * Si GMAIL_USER/GMAIL_APP_PASSWORD no están configurados, responde `sent:false`
 * sin fallar — el NotificationAgent lo interpreta como "email simulado" y el
 * flujo de checkout continúa con normalidad (modo demo, sin infraestructura).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import nodemailer from 'nodemailer'
import { aplicarGuard } from './_guard.js'

let _transporter = null
function getTransporter() {
  if (_transporter) return _transporter
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return null
  _transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  })
  return _transporter
}

const MAX_BODY_CHARS = 200000

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' })
    return
  }

  if (!aplicarGuard(req, res, { max: 30, windowMs: 60_000 })) return

  const { to, subject, html } = req.body || {}
  if (!to || !subject || !html) {
    res.status(400).json({ error: 'to, subject y html son requeridos' })
    return
  }
  if (JSON.stringify(req.body).length > MAX_BODY_CHARS) {
    res.status(413).json({ error: 'Payload demasiado grande' })
    return
  }

  const transporter = getTransporter()
  if (!transporter) {
    // Gmail no configurado — modo demo: se simula el envío sin error.
    res.status(200).json({ sent: false, simulated: true });
    return
  }

  try {
    const gmailUser = process.env.GMAIL_USER
    await transporter.sendMail({
      from: `Golden Bears Marketplace <${gmailUser}>`,
      to,
      subject,
      html,
    })
    res.status(200).json({ sent: true, simulated: false })
  } catch (err) {
    console.error('[api/notify] Error enviando email:', err)
    res.status(200).json({ sent: false, simulated: true, error: err.message })
  }
}
