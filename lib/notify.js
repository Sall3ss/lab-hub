// lib/notify.js — adapters de notificacao. Liga so o que o cliente usa (secrets no wrangler).
//   - E-mail: Resend (RESEND_API_KEY, EMAIL_REMETENTE)
//   - WhatsApp: Cloud API OFICIAL da Meta (WHATSAPP_TOKEN, WHATSAPP_PHONE_ID)
//     Oficial de proposito: nao expoe o numero do cliente a banimento (ver CLAUDE.md).

export async function enviarEmail(env, { para, assunto, html, texto }) {
  if (!env.RESEND_API_KEY) return { ok: false, motivo: 'Resend nao configurado' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_REMETENTE, to: para, subject: assunto, html, text: texto }),
  });
  return { ok: r.ok, status: r.status, corpo: await r.text() };
}

export async function enviarWhatsApp(env, { para, texto }) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) return { ok: false, motivo: 'WhatsApp nao configurado' };
  const url = `https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_ID}/messages`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'text', text: { body: texto } }),
  });
  return { ok: r.ok, status: r.status, corpo: await r.text() };
}
