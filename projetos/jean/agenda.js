// projetos/jean/agenda.js - a Jean lendo a Agenda Google do dono (SO LEITURA).
//
// Como funciona (pedido do dono em 16/11/2026):
//   - O dono liga a conta uma vez (Pulso › Agenda › Conectar): login do Google (OAuth),
//     escopo calendar.readonly. O Google devolve um token de renovacao, guardado CIFRADO
//     em jean_google.
//   - Nada roda em segundo plano no servidor. Quem pergunta pela agenda e a TELA da Jean,
//     enquanto esta aberta (a cada 5 min), e a propria Jean quando o dono pergunta
//     ("o que tenho hoje?", ferramenta ver_agenda).
//   - Os lembretes seguem as notificacoes de cada evento no Google (ex.: 10 min antes).
//
// Segredos (o dono grava no Pages; aqui so o NOME): JEAN_GOOGLE_CLIENT_ID e
// JEAN_GOOGLE_CLIENT_SECRET. Sem eles a agenda aparece como "falta configurar".
//
// Autoria: Claude (Opus 5.5), Lab Hub, 16/11/2026.

import { db } from '../../lib/db.js';
import { auditar } from '../../lib/audit.js';

const ESCOPO_AGENDA = 'https://www.googleapis.com/auth/calendar.readonly';
const ESCOPOS = ['openid', 'email', ESCOPO_AGENDA].join(' ');
const AUTORIZAR = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOGAR = 'https://oauth2.googleapis.com/revoke';
const CAL = 'https://www.googleapis.com/calendar/v3';
const TELA = '/projetos/jean/';
const MAX_CALENDARIOS = 12;

export class ErroAgenda extends Error {
  constructor(mensagem, codigo, status = 502) { super(mensagem); this.codigo = codigo; this.status = status; }
}

export function agendaConfigurada(env) { return !!(env.JEAN_GOOGLE_CLIENT_ID && env.JEAN_GOOGLE_CLIENT_SECRET); }
const enderecoDeVolta = (request) => new URL(request.url).origin + '/api/p/jean/agenda/volta';

// ------------------------------------------------------------------ cifra e assinatura
const enc = new TextEncoder();
function b64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function deB64u(t) {
  const s = atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
async function chaveCifra(env) {
  const bruto = await crypto.subtle.digest('SHA-256', enc.encode('jean-agenda|' + env.JEAN_GOOGLE_CLIENT_SECRET));
  return crypto.subtle.importKey('raw', bruto, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function cifrar(env, texto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chaveCifra(env), enc.encode(texto));
  return b64u(iv) + '.' + b64u(c);
}
async function decifrar(env, guardado) {
  const [iv, c] = String(guardado || '').split('.');
  const p = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64u(iv) }, await chaveCifra(env), deB64u(c));
  return new TextDecoder().decode(p);
}
async function chaveAssinatura(env) {
  return crypto.subtle.importKey('raw', enc.encode('jean-estado|' + env.JEAN_GOOGLE_CLIENT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
// "state" do OAuth: amarra a volta do Google ao usuario logado que pediu (contra CSRF).
async function estadoAssinado(env, u) {
  const corpo = b64u(enc.encode(JSON.stringify({ u: u.id, n: b64u(crypto.getRandomValues(new Uint8Array(12))), exp: Date.now() + 10 * 60 * 1000 })));
  const sig = await crypto.subtle.sign('HMAC', await chaveAssinatura(env), enc.encode(corpo));
  return corpo + '.' + b64u(sig);
}
async function estadoValido(env, u, estado) {
  const [corpo, sig] = String(estado || '').split('.');
  if (!corpo || !sig) return false;
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', await chaveAssinatura(env), deB64u(sig), enc.encode(corpo)); } catch { return false; }
  if (!ok) return false;
  try {
    const d = JSON.parse(new TextDecoder().decode(deB64u(corpo)));
    return d.u === u.id && d.exp > Date.now();
  } catch { return false; }
}

// ------------------------------------------------------------------ conectar
export async function urlParaConectar(env, request, u) {
  const q = new URLSearchParams({
    client_id: env.JEAN_GOOGLE_CLIENT_ID,
    redirect_uri: enderecoDeVolta(request),
    response_type: 'code',
    scope: ESCOPOS,
    access_type: 'offline',            // devolve o token de renovacao
    prompt: 'consent',                 // sempre devolve um novo (ao reconectar tambem)
    include_granted_scopes: 'true',
    state: await estadoAssinado(env, u),
  });
  return AUTORIZAR + '?' + q;
}

// Volta do Google. Sempre termina mandando o navegador de volta para a tela da Jean.
export async function voltaDoGoogle(env, request, u, ip) {
  const url = new URL(request.url);
  const voltar = (r) => Response.redirect(new URL(TELA + '?agenda=' + r, url.origin).toString(), 302);
  if (url.searchParams.get('error')) return voltar('recusado');
  if (!(await estadoValido(env, u, url.searchParams.get('state')))) return voltar('expirou');
  const code = url.searchParams.get('code');
  if (!code) return voltar('falhou');

  const r = await fetch(TOKEN, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.JEAN_GOOGLE_CLIENT_ID, client_secret: env.JEAN_GOOGLE_CLIENT_SECRET, redirect_uri: enderecoDeVolta(request), grant_type: 'authorization_code' }),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) { console.error('[jean/agenda] troca do codigo', r.status, t.error); return voltar('falhou'); }
  // O Google deixa desmarcar a permissao da agenda na tela de consentimento.
  if (!String(t.scope || '').split(' ').includes(ESCOPO_AGENDA)) return voltar('sem-permissao');
  if (!t.refresh_token) return voltar('falhou');

  let email = null;
  try { email = JSON.parse(new TextDecoder().decode(deB64u(String(t.id_token).split('.')[1]))).email || null; } catch { /* sem e-mail: segue */ }
  const agora = new Date().toISOString();
  await db(env).run(
    `INSERT INTO jean_google (usuario_id, email, refresh_cifrado, acesso_cifrado, acesso_expira, escopos, precisa_reconectar, conectada_em, atualizada_em)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?7)
     ON CONFLICT(usuario_id) DO UPDATE SET email = ?2, refresh_cifrado = ?3, acesso_cifrado = ?4, acesso_expira = ?5, escopos = ?6, precisa_reconectar = 0, atualizada_em = ?7`,
    u.id, email, await cifrar(env, t.refresh_token), await cifrar(env, t.access_token), Date.now() + (Number(t.expires_in) || 3600) * 1000, t.scope || '', agora,
  );
  await auditar(env, { quem: u.email, acao: 'conectar-google', entidade: 'jean_google', entidade_id: u.id, depois: { email, escopos: t.scope }, ip });
  return voltar('ok');
}

export async function estadoDaAgenda(env, u) {
  if (!agendaConfigurada(env)) return { configurada: false, conectada: false };
  const l = await db(env).first('SELECT email, precisa_reconectar, conectada_em FROM jean_google WHERE usuario_id = ?', u.id);
  return { configurada: true, conectada: !!l, email: l?.email || null, precisa_reconectar: !!l?.precisa_reconectar, conectada_em: l?.conectada_em || null };
}

export async function desconectar(env, u, ip) {
  const l = await db(env).first('SELECT email, refresh_cifrado FROM jean_google WHERE usuario_id = ?', u.id);
  if (!l) return false;
  // Revoga no Google tambem (o acesso some da lista de apps da conta). Falhar aqui nao
  // impede apagar: sem a linha, a Jean ja nao tem como usar o token.
  try {
    const token = await decifrar(env, l.refresh_cifrado);
    await fetch(REVOGAR, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
  } catch (e) { console.error('[jean/agenda] revogar', e && e.message); }
  await db(env).run('DELETE FROM jean_google WHERE usuario_id = ?', u.id);
  await auditar(env, { quem: u.email, acao: 'desconectar-google', entidade: 'jean_google', entidade_id: u.id, antes: { email: l.email }, ip });
  return true;
}

// ------------------------------------------------------------------ token de acesso
async function tokenDeAcesso(env, u, forcar = false) {
  const l = await db(env).first('SELECT refresh_cifrado, acesso_cifrado, acesso_expira, precisa_reconectar FROM jean_google WHERE usuario_id = ?', u.id);
  if (!l) throw new ErroAgenda('A agenda não está conectada. Conecte em Pulso › Agenda.', 'desconectada', 409);
  if (l.precisa_reconectar) throw new ErroAgenda('O Google pediu para conectar a agenda de novo (Pulso › Agenda › Reconectar).', 'reconectar', 409);
  if (!forcar && l.acesso_cifrado && l.acesso_expira > Date.now() + 60000) {
    try { return await decifrar(env, l.acesso_cifrado); } catch { /* chave trocada: renova abaixo */ }
  }
  let refresh;
  try { refresh = await decifrar(env, l.refresh_cifrado); }
  catch { await marcarReconectar(env, u); throw new ErroAgenda('O segredo do Google mudou: conecte a agenda de novo.', 'reconectar', 409); }
  const r = await fetch(TOKEN, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.JEAN_GOOGLE_CLIENT_ID, client_secret: env.JEAN_GOOGLE_CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) {
    // invalid_grant = acesso revogado ou vencido (app do Google em modo "Teste": vence em 7 dias).
    if (t.error === 'invalid_grant') { await marcarReconectar(env, u); throw new ErroAgenda('O Google encerrou o acesso à agenda. Conecte de novo em Pulso › Agenda.', 'reconectar', 409); }
    throw new ErroAgenda('O Google não respondeu agora. Tento de novo daqui a pouco.', 'google', 502);
  }
  await db(env).run('UPDATE jean_google SET acesso_cifrado = ?, acesso_expira = ?, atualizada_em = ? WHERE usuario_id = ?',
    await cifrar(env, t.access_token), Date.now() + (Number(t.expires_in) || 3600) * 1000, new Date().toISOString(), u.id);
  return t.access_token;
}
async function marcarReconectar(env, u) {
  await db(env).run('UPDATE jean_google SET precisa_reconectar = 1, acesso_cifrado = NULL WHERE usuario_id = ?', u.id);
}

async function google(env, u, caminho) {
  let token = await tokenDeAcesso(env, u);
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const r = await fetch(CAL + caminho, { headers: { authorization: 'Bearer ' + token } });
    if (r.status === 401 && tentativa === 0) { token = await tokenDeAcesso(env, u, true); continue; }
    const d = await r.json().catch(() => ({}));
    if (r.ok) return d;
    const motivo = d?.error?.errors?.[0]?.reason || d?.error?.status || '';
    if (r.status === 403 && /accessNotConfigured|SERVICE_DISABLED/i.test(motivo + ' ' + (d?.error?.message || ''))) {
      throw new ErroAgenda('A Google Calendar API não está ativada no projeto do Google Cloud. Ative e tente de novo.', 'api-desligada', 502);
    }
    if (r.status === 429 || /rateLimit/i.test(motivo)) throw new ErroAgenda('O Google pediu para esperar um pouco (limite). Tento de novo em instantes.', 'limite', 429);
    console.error('[jean/agenda] google', r.status, motivo);
    throw new ErroAgenda('O Google não devolveu a agenda agora.', 'google', 502);
  }
  throw new ErroAgenda('O Google não aceitou o acesso. Conecte a agenda de novo.', 'reconectar', 409);
}

// ------------------------------------------------------------------ eventos
/**
 * Eventos das agendas marcadas como visíveis no Google Agenda do dono, de agora-1h até
 * agora + `dias`. Cada um vem com `lembretes` (minutos antes, como configurado no Google).
 */
export async function eventosDaAgenda(env, u, { dias = 2 } = {}) {
  dias = Math.min(Math.max(Number(dias) || 2, 1), 14);
  const lista = await google(env, u, '/users/me/calendarList?minAccessRole=reader&maxResults=50&fields=' +
    encodeURIComponent('items(id,summary,summaryOverride,selected,primary,defaultReminders,backgroundColor)'));
  const cals = (lista.items || []).filter((c) => c.selected || c.primary).slice(0, MAX_CALENDARIOS);
  const de = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const ate = new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();
  const campos = encodeURIComponent('items(id,status,summary,location,start,end,reminders,hangoutLink,eventType,attendees(self,responseStatus))');
  const porCal = await Promise.all(cals.map(async (c) => {
    try {
      const d = await google(env, u, `/calendars/${encodeURIComponent(c.id)}/events?singleEvents=true&orderBy=startTime&maxResults=100` +
        `&timeMin=${encodeURIComponent(de)}&timeMax=${encodeURIComponent(ate)}&fields=${campos}`);
      return (d.items || []).map((e) => normalizar(e, c)).filter(Boolean);
    } catch (e) {
      if (e instanceof ErroAgenda && e.codigo !== 'google') throw e;
      return []; // uma agenda com problema nao derruba as outras
    }
  }));
  const eventos = porCal.flat().sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0));
  return { eventos, calendarios: cals.length, de, ate };
}

function normalizar(e, cal) {
  if (e.status === 'cancelled' || e.eventType === 'workingLocation') return null;
  if ((e.attendees || []).some((a) => a.self && a.responseStatus === 'declined')) return null;
  const diaInteiro = !!(e.start && e.start.date && !e.start.dateTime);
  const r = e.reminders || {};
  const lista = r.useDefault ? (cal.defaultReminders || []) : (r.overrides || []);
  const lembretes = [...new Set(lista.map((x) => Number(x.minutes)).filter((m) => m >= 0))].sort((a, b) => b - a);
  return {
    id: e.id,
    titulo: String(e.summary || '(sem título)').slice(0, 200),
    inicio: diaInteiro ? e.start.date : e.start.dateTime,
    fim: e.end ? (e.end.dateTime || e.end.date) : null,
    dia_inteiro: diaInteiro,
    local: e.location ? String(e.location).slice(0, 200) : null,
    link: e.hangoutLink || null,
    lembretes,
    calendario: cal.summaryOverride || cal.summary || '',
    cor: cal.backgroundColor || null,
  };
}

// Versao curta para a Jean (ferramenta ver_agenda), com horario de Brasilia por extenso.
export async function agendaParaJean(env, u, dias) {
  if (!agendaConfigurada(env)) return { erro: 'A agenda Google ainda não foi configurada (falta o dono criar o acesso no Google Cloud).' };
  try {
    const { eventos } = await eventosDaAgenda(env, u, { dias: dias || 1 });
    const fmt = (iso, so) => new Date(iso).toLocaleString('pt-BR', so === 'dia'
      ? { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' }
      : { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    return {
      agora: fmt(new Date().toISOString()),
      eventos: eventos.slice(0, 40).map((e) => ({
        titulo: e.titulo,
        quando: e.dia_inteiro ? 'dia inteiro, ' + fmt(e.inicio + 'T12:00:00Z', 'dia') : fmt(e.inicio),
        ate: e.fim && !e.dia_inteiro ? fmt(e.fim) : undefined,
        local: e.local || undefined,
        agenda: e.calendario,
        lembrete_minutos_antes: e.lembretes.length ? e.lembretes : undefined,
      })),
      dica: eventos.length ? undefined : 'Nenhum compromisso no período.',
    };
  } catch (e) {
    return { erro: e instanceof ErroAgenda ? e.message : 'Não foi possível ler a agenda agora.' };
  }
}
