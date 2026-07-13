/**
 * src/domain/emailTemplates.js
 * Plantillas HTML de correo. Migradas de _build_email_html y
 * _build_seller_email_html en agents/notificaciones.py (backend Python original).
 */
import { formatSoles } from './pricing.js'

export function buildBuyerEmailHtml({ ordenId, facturaId, items, total, fechaEntrega }) {
  const itemsHtml = items.map((i) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333">${i.nombre || 'Producto'}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;text-align:center">x${i.cantidad || 1}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;text-align:right">${formatSoles(i.subtotal || 0)}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f8f9fc;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fc;padding:30px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)">
  <tr><td style="background:linear-gradient(135deg,#1A1A2E,#0F3460);padding:32px 40px;text-align:center">
    <div style="font-size:36px;margin-bottom:8px">🐻</div>
    <h1 style="color:#C9A84C;margin:0;font-size:24px;font-weight:800;letter-spacing:-0.5px">Golden Bears</h1>
    <p style="color:#aaa;margin:4px 0 0;font-size:13px">Marketplace · Confirmación de pedido</p>
  </td></tr>
  <tr><td style="padding:24px 40px 0;text-align:center">
    <div style="display:inline-block;background:#d1fae5;color:#065f46;padding:8px 20px;border-radius:999px;font-size:13px;font-weight:700">✅ Pedido confirmado</div>
    <h2 style="color:#1a1a2e;font-size:20px;margin:16px 0 4px">¡Gracias por tu compra!</h2>
    <p style="color:#6b7280;font-size:14px;margin:0">Tu pedido ha sido procesado exitosamente.</p>
  </td></tr>
  <tr><td style="padding:24px 40px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fc;border-radius:12px;padding:20px">
      <tr><td style="font-size:13px;color:#6b7280;padding-bottom:4px">Número de orden</td>
          <td style="font-size:13px;color:#6b7280;padding-bottom:4px;text-align:right">Factura electrónica</td></tr>
      <tr><td style="font-size:18px;font-weight:800;color:#C9A84C">${ordenId}</td>
          <td style="font-size:16px;font-weight:700;color:#1a1a2e;text-align:right">${facturaId}</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:0 40px">
    <h3 style="color:#1a1a2e;font-size:15px;margin:0 0 12px;font-weight:700">Detalle del pedido</h3>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr style="background:#f8f9fc">
        <th style="padding:8px 0;font-size:12px;color:#6b7280;text-align:left;font-weight:600">Producto</th>
        <th style="padding:8px 0;font-size:12px;color:#6b7280;text-align:center;font-weight:600">Cant.</th>
        <th style="padding:8px 0;font-size:12px;color:#6b7280;text-align:right;font-weight:600">Subtotal</th>
      </tr>
      ${itemsHtml}
    </table>
    <table width="100%" style="margin-top:12px">
      <tr><td style="font-size:18px;font-weight:800;color:#1a1a2e;padding-top:12px;border-top:2px solid #f0f0f0">Total pagado</td>
          <td style="font-size:18px;font-weight:800;color:#C9A84C;padding-top:12px;border-top:2px solid #f0f0f0;text-align:right">${formatSoles(total)}</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:24px 40px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef3c7;border-radius:12px;padding:16px">
      <tr><td style="font-size:24px;width:40px">📦</td>
        <td><p style="margin:0;font-size:13px;color:#92400e;font-weight:700">Entrega estimada</p>
            <p style="margin:4px 0 0;font-size:16px;color:#78350f;font-weight:800">${fechaEntrega}</p></td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:0 40px 24px;text-align:center">
    <p style="font-size:13px;color:#9ca3af;margin:0">En 24 horas recibirás una encuesta de satisfacción.<br/>Tu opinión nos ayuda a mejorar 💪</p>
  </td></tr>
  <tr><td style="background:#f8f9fc;padding:20px 40px;text-align:center;border-top:1px solid #f0f0f0">
    <p style="font-size:12px;color:#9ca3af;margin:0">Golden Bears Marketplace · Trujillo, Perú<br/>Este correo fue generado automáticamente por el Sistema Multiagente</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`
}

export function buildSellerEmailHtml({ ordenId, items, total }) {
  const itemsText = items.map((i) => `${i.nombre || '?'} x${i.cantidad || 1}`).join(', ')
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f8f9fc;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fc;padding:30px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)">
  <tr><td style="background:linear-gradient(135deg,#1A1A2E,#0F3460);padding:28px 40px;text-align:center">
    <div style="font-size:32px;margin-bottom:6px">🏪</div>
    <h1 style="color:#C9A84C;margin:0;font-size:22px;font-weight:800">Panel Vendedor — Golden Bears</h1>
    <p style="color:#aaa;margin:4px 0 0;font-size:13px">Nueva orden recibida</p>
  </td></tr>
  <tr><td style="padding:32px 40px">
    <div style="background:#fef3c7;border-left:4px solid #C9A84C;border-radius:8px;padding:16px;margin-bottom:24px">
      <p style="margin:0;font-size:13px;color:#92400e;font-weight:700">📦 Acción requerida: preparar despacho</p>
    </div>
    <table width="100%" style="border-collapse:collapse">
      <tr style="background:#f8f9fc"><td style="padding:12px;font-size:13px;font-weight:700;color:#374151">Orden ID</td>
          <td style="padding:12px;font-size:15px;font-weight:800;color:#C9A84C">${ordenId}</td></tr>
      <tr><td style="padding:12px;font-size:13px;font-weight:700;color:#374151">Productos</td>
          <td style="padding:12px;font-size:13px;color:#374151">${itemsText}</td></tr>
      <tr style="background:#f8f9fc"><td style="padding:12px;font-size:13px;font-weight:700;color:#374151">Total</td>
          <td style="padding:12px;font-size:16px;font-weight:800;color:#059669">${formatSoles(total)}</td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:13px;color:#6b7280;text-align:center">Ingresa al panel vendedor para generar la etiqueta de despacho.</p>
  </td></tr>
  <tr><td style="background:#f8f9fc;padding:16px 40px;text-align:center;border-top:1px solid #f0f0f0">
    <p style="font-size:12px;color:#9ca3af;margin:0">Golden Bears Marketplace · Sistema Multiagente</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`
}

export function buildStockAlertEmailHtml(alertas) {
  const items = alertas.map((a) => `<li><b>${a.productoId}</b>: ${a.nivel}</li>`).join('')
  return `<html><body style="font-family:Arial,sans-serif;padding:20px">
    <h2 style="color:#92400e">Alerta de inventario — Golden Bears</h2>
    <p>Los siguientes productos tienen stock bajo o agotado:</p>
    <ul>${items}</ul>
  </body></html>`
}
