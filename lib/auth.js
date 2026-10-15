// lib/auth.js — BASE compartilhada: senha, sessão e primeiro acesso.
//
// ⚠️ MUDANÇA DE PADRÃO (decidida pelo gestor em 08/08/2026). Antes existia um
// `ADMIN_TOKEN`: um token só, igual para todo mundo, que servia de senha mestra e ainda
// abria uma tela de "primeiro acesso" pedindo esse token. Foi recusado, com razão:
//
//   - token não identifica ninguém, e prontuário exige saber QUEM fez cada registro
//   - é um conceito novo aparecendo justo no dia da entrega, para quem não é técnico
//   - obriga o gestor a estar no meio de toda implantação
//
// No lugar: **o sistema nasce com o administrador já criado**, com senha provisória
// aleatória (ver `scripts/admin-inicial.mjs`), e OBRIGA a troca no primeiro acesso. Nesse
// momento a pessoa também informa nome e e-mail, e é esse e-mail que passa a valer para
// login e auditoria. O gestor recebe usuário e senha uma vez e repassa.
//
// Senha: PBKDF2-SHA256, 100.000 iterações (o teto do Workers), sal de 16 bytes por senha. É o que o Web
// Crypto dos Workers oferece; não há bcrypt nem argon2 no runtime.
// Formato guardado:  pbkdf2$<iteracoes>$<sal em base64>$<hash em base64>
//
// ⚠️ Nada de montar `Response` fora de função neste arquivo. O runtime da Cloudflare
// proíbe isso no escopo global do módulo e o Worker não sobe - o erro aparece só como
// "Disallowed operation called within global scope".

import { db } from './db.js';

// ⚠️ 100.000 e NAO mais: o Workers em PRODUCAO recusa PBKDF2 acima disso e a chamada
// lanca excecao. O runtime local (workerd do `wrangler dev`) NAO aplica esse limite, entao
// com 210.000 tudo passa aqui e o login quebra so no ar, com erro generico. Custou um
// deploy para descobrir - nao aumente este numero.
const ITERACOES = 100000;
export const DURACAO_SESSAO_H = 12;
const COOKIE = 'sid';

// ---------------------------------------------------------------- senha

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derivar(senha, sal, iteracoes = ITERACOES) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  return await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: sal, iterations: iteracoes, hash: 'SHA-256' }, chave, 256);
}

export async function hashSenha(senha) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERACOES}$${b64(sal)}$${b64(await derivar(senha, sal))}`;
}

export async function conferirSenha(senha, guardado) {
  if (!guardado || !guardado.startsWith('pbkdf2$')) return false;
  const [, it, salB64, hashB64] = guardado.split('$');
  const a = new Uint8Array(await derivar(senha, deB64(salB64), Number(it)));
  const b = deB64(hashB64);
  if (a.length !== b.length) return false;
  // comparação de tempo constante: não vaza quanto do hash bateu
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function senhaFraca(senha) {
  const s = String(senha || '');
  if (s.length < 8) return 'A senha precisa de pelo menos 8 caracteres.';
  if (!/[a-zA-Z]/.test(s) || !/\d/.test(s)) return 'A senha precisa misturar letras e números.';
  return null;
}

// ---------------------------------------------------------------- sessão

export function lerCookie(request, nome) {
  const raw = request.headers.get('cookie') || '';
  const m = raw.match(new RegExp('(?:^|;\\s*)' + nome + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

export function cookieSessao(sid, maxAge) {
  return `${COOKIE}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function abrirSessao(env, usuario, ip) {
  const sid = crypto.randomUUID() + '.' + crypto.randomUUID();
  await db(env).run(
    'INSERT INTO sessoes (id, usuario_id, expira_em, criada_em, ip) VALUES (?, ?, ?, ?, ?)',
    sid, usuario.id, Date.now() + DURACAO_SESSAO_H * 3600 * 1000, new Date().toISOString(), ip || null,
  );
  await db(env).run('UPDATE usuarios SET ultimo_acesso = ? WHERE id = ?', new Date().toISOString(), usuario.id);
  return cookieSessao(sid, DURACAO_SESSAO_H * 3600);
}

export async function fecharSessao(env, request) {
  const sid = lerCookie(request, COOKIE);
  if (sid) await db(env).run('DELETE FROM sessoes WHERE id = ?', sid);
  return cookieSessao('', 0);
}

/** Usuário da requisição, ou null. Renova a validade da sessão a cada uso. */
export async function usuarioAtual(request, env) {
  const sid = lerCookie(request, COOKIE);
  if (!sid) return null;
  const u = await db(env).first(
    `SELECT u.id, u.email, u.nome, u.perfil, u.ativo, u.senha_provisoria
       FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.id = ? AND s.expira_em > ?`,
    sid, Date.now(),
  );
  if (!u || !u.ativo) return null;
  // sessão deslizante: quem está trabalhando não é deslogado no meio do atendimento
  await db(env).run('UPDATE sessoes SET expira_em = ? WHERE id = ?', Date.now() + DURACAO_SESSAO_H * 3600 * 1000, sid);
  return u;
}

/** Faxina de sessões vencidas. Barata, roda de carona no login. */
export async function limparSessoes(env) {
  try { await db(env).run('DELETE FROM sessoes WHERE expira_em < ?', Date.now()); } catch { /* não é crítico */ }
}

/** Derruba todas as sessões de uma pessoa (troca de senha, desativação). */
export async function encerrarSessoesDe(env, usuarioId) {
  await db(env).run('DELETE FROM sessoes WHERE usuario_id = ?', usuarioId);
}

// ---------------------------------------------------------------- perfil
//
// A BASE conhece um perfil só: `administrador`. Os demais perfis são do domínio de cada
// cliente e ficam na casca - clínica tem coordenação e recepção, oficina não tem.

export const administra = (u) => u?.perfil === 'administrador';

/**
 * Enquanto a senha for provisória, a pessoa só pode fazer uma coisa: definir o acesso
 * dela. Isso vale no SERVIDOR, e não só na tela - senão bastaria chamar a API direto.
 */
export const precisaDefinirAcesso = (u) => !!u && !!u.senha_provisoria;
