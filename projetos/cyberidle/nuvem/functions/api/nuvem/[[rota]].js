// Cyberidle - salvamento na nuvem (Cloudflare Pages Functions + D1 do Lab Hub).
//
// Publicado junto com o jogo no projeto Pages `cyberidle-game` (ver deploy.yml). Roda na
// Cloudflare, nunca na VPS. Cada requisição é pequena (uma consulta e um SHA-256) para caber
// no limite de CPU do plano grátis: a parte pesada da senha (PBKDF2) é feita no navegador.
//
// Rotas (todas JSON):
//   POST /api/nuvem/registrar  { usuario, chave }        -> { token, usuario }
//   POST /api/nuvem/entrar     { usuario, chave }        -> { token, usuario }
//   POST /api/nuvem/sair                                 -> { ok }
//   GET  /api/nuvem/save                                 -> { versao, atualizadoEm, dados }
//   PUT  /api/nuvem/save       { versaoBase, dados }     -> { versao } | 409 { versao }
//
// Tabelas: migrations/0002_cyberidle_nuvem.sql (prefixo cyberidle_).
// Autoria: Claude (Opus 5.5), 26/10/2026.

const USUARIO = /^[a-zA-Z0-9_-]{3,20}$/;
const CHAVE = /^[0-9a-f]{64}$/;
const SESSAO_DIAS = 60;
const SAVE_MAX = 1_800_000; // D1 aceita até ~2 MB por valor

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(texto) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
}

function aleatorio(bytes = 32) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return hex(b);
}

function iguais(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function corpo(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function abrirSessao(env, contaId, usuario) {
  const token = aleatorio(32);
  const agora = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM cyberidle_sessoes WHERE conta_id = ? AND expira_em < ?').bind(contaId, agora),
    env.DB.prepare('INSERT INTO cyberidle_sessoes (token_hash, conta_id, expira_em) VALUES (?, ?, ?)')
      .bind(await sha256(token), contaId, agora + SESSAO_DIAS * 86_400_000),
  ]);
  return json({ token, usuario });
}

async function contaDaSessao(request, env) {
  const h = request.headers.get('authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  const linha = await env.DB.prepare('SELECT conta_id, expira_em FROM cyberidle_sessoes WHERE token_hash = ?')
    .bind(await sha256(h.slice(7).trim())).first();
  if (!linha || linha.expira_em < Date.now()) return null;
  return linha.conta_id;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const rota = (params.rota || []).join('/');
  const metodo = request.method;
  if (!env.DB) return json({ error: 'Banco da nuvem não configurado.' }, 503);

  try {
    if (rota === 'registrar' && metodo === 'POST') {
      const { usuario, chave } = await corpo(request);
      if (typeof usuario !== 'string' || !USUARIO.test(usuario) || /^guest_/i.test(usuario)) {
        return json({ error: 'Usuário: 3 a 20 letras, números, hífen ou sublinhado.' }, 400);
      }
      if (typeof chave !== 'string' || !CHAVE.test(chave)) return json({ error: 'Chave inválida.' }, 400);
      const existe = await env.DB.prepare('SELECT id FROM cyberidle_contas WHERE usuario = ?').bind(usuario).first();
      if (existe) return json({ error: 'Esse usuário já existe.' }, 409);
      const sal = aleatorio(16);
      const r = await env.DB.prepare('INSERT INTO cyberidle_contas (usuario, chave_hash, sal, criado_em) VALUES (?, ?, ?, ?)')
        .bind(usuario, await sha256(chave + sal), sal, Date.now()).run();
      return abrirSessao(env, r.meta.last_row_id, usuario);
    }

    if (rota === 'entrar' && metodo === 'POST') {
      const { usuario, chave } = await corpo(request);
      if (typeof usuario !== 'string' || typeof chave !== 'string' || !CHAVE.test(chave)) {
        return json({ error: 'Usuário ou senha incorretos.' }, 401);
      }
      const conta = await env.DB.prepare('SELECT id, usuario, chave_hash, sal FROM cyberidle_contas WHERE usuario = ?')
        .bind(usuario).first();
      // Mesmo custo com ou sem conta, para não revelar quem existe.
      const esperado = conta ? conta.chave_hash : await sha256('x' + chave);
      const calculado = await sha256(chave + (conta ? conta.sal : 'x'));
      if (!conta || !iguais(esperado, calculado)) return json({ error: 'Usuário ou senha incorretos.' }, 401);
      return abrirSessao(env, conta.id, conta.usuario);
    }

    const contaId = await contaDaSessao(request, env);
    if (contaId === null) return json({ error: 'Entre na sua conta de novo.' }, 401);

    if (rota === 'sair' && metodo === 'POST') {
      const h = request.headers.get('authorization') || '';
      await env.DB.prepare('DELETE FROM cyberidle_sessoes WHERE token_hash = ?').bind(await sha256(h.slice(7).trim())).run();
      return json({ ok: true });
    }

    if (rota === 'save' && metodo === 'GET') {
      const s = await env.DB.prepare('SELECT versao, dados, atualizado_em FROM cyberidle_saves WHERE conta_id = ?')
        .bind(contaId).first();
      return json(s ? { versao: s.versao, atualizadoEm: s.atualizado_em, dados: s.dados } : { versao: 0, atualizadoEm: 0, dados: null });
    }

    if (rota === 'save' && metodo === 'PUT') {
      const { versaoBase, dados } = await corpo(request);
      if (typeof dados !== 'string' || !dados.length) return json({ error: 'Save vazio.' }, 400);
      if (dados.length > SAVE_MAX) return json({ error: 'Save grande demais.' }, 413);
      const base = Number(versaoBase) || 0;
      const atual = await env.DB.prepare('SELECT versao FROM cyberidle_saves WHERE conta_id = ?').bind(contaId).first();
      const versaoAtual = atual ? atual.versao : 0;
      // Outro aparelho gravou depois: não sobrescreve sem querer.
      if (versaoAtual !== base) return json({ error: 'Há um progresso mais novo em outro aparelho.', versao: versaoAtual }, 409);
      const nova = versaoAtual + 1;
      const agora = Date.now();
      const r = await env.DB.prepare(
        `INSERT INTO cyberidle_saves (conta_id, versao, dados, tamanho, atualizado_em) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(conta_id) DO UPDATE SET versao = excluded.versao, dados = excluded.dados,
           tamanho = excluded.tamanho, atualizado_em = excluded.atualizado_em
         WHERE cyberidle_saves.versao = ?`,
      ).bind(contaId, nova, dados, dados.length, agora, versaoAtual).run();
      if (!r.meta.changes) return json({ error: 'Há um progresso mais novo em outro aparelho.', versao: versaoAtual + 1 }, 409);
      return json({ versao: nova, atualizadoEm: agora });
    }

    return json({ error: 'Rota não encontrada.' }, 404);
  } catch (erro) {
    console.error('cyberidle nuvem', erro);
    return json({ error: 'Falha na nuvem. Tente de novo.' }, 500);
  }
}
