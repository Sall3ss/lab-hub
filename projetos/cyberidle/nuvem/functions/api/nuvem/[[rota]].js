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
//   GET  /api/nuvem/ranking?tipo=level|skill|gold|bestiary   (público)
//   POST /api/nuvem/ranking    { personagens: [...] }    -> { ok, suspeitos }
//   GET  /api/nuvem/mercado                              -> { anuncios }
//   POST /api/nuvem/mercado/anunciar  { personagem, itemId, qtd, preco }
//   POST /api/nuvem/mercado/comprar   { personagem, anuncioId }
//   POST /api/nuvem/mercado/cancelar  { anuncioId }
//   GET  /api/nuvem/entregas  |  POST /api/nuvem/entregas/confirmar { ids }
//
// Tabelas: migrations/0002_cyberidle_nuvem.sql e 0003_cyberidle_mundo.sql (prefixo cyberidle_).
// Autoria: Claude (Opus 5.5), 26/10/2026.

import { ITENS_MERCADO } from '../../../lib/itens.js';

const USUARIO = /^[a-zA-Z0-9_-]{3,20}$/;
const NOME = /^[a-zA-Z][a-zA-Z ']{2,19}$/;

// Travas do mercado geral (o combate roda no navegador, então a nuvem limita o estrago de
// quem mexer nos próprios dados): só itens do jogo, sem moedas; preço com teto; poucos
// anúncios e compras por dia; o item fica guardado na nuvem até vender ou ser cancelado.
const MERCADO = {
  qtdMax: 100,
  precoMin: 1,
  precoTetoMinimo: 5_000,       // teto para itens de valor baixo
  precoVezesValor: 100,         // até 100x o valor de NPC do lote
  precoMax: 1_000_000_000,
  abertosPorConta: 10,
  anunciosPorDia: 30,
  comprasPorDia: 50,
  taxa: 0.02,                   // 2% fica com o mercado (como no original)
  diasAberto: 14,
};
const DIA = 86_400_000;

/** XP para chegar ao nível (mesma fórmula do jogo, packages/sim/src/formulas.ts). */
function xpDoNivel(nivel) {
  const l = Math.max(1, Math.floor(nivel));
  return Math.floor((((l - 6) * l + 17) * l - 12) / 6) * 100;
}
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

    // Ranking é público (aparece até para convidado).
    if (rota === 'ranking' && metodo === 'GET') return await lerRanking(request, env);

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

    if (rota === 'ranking' && metodo === 'POST') return await gravarRanking(request, env, contaId);
    if (rota === 'mercado' && metodo === 'GET') return await listarMercado(env, contaId);
    if (rota === 'mercado/anunciar' && metodo === 'POST') return await anunciar(request, env, contaId);
    if (rota === 'mercado/comprar' && metodo === 'POST') return await comprar(request, env, contaId);
    if (rota === 'mercado/cancelar' && metodo === 'POST') return await cancelar(request, env, contaId);
    if (rota === 'entregas' && metodo === 'GET') {
      const r = await env.DB.prepare('SELECT id, personagem, item_id, qtd, gold, motivo FROM cyberidle_entregas WHERE conta_id = ? AND entregue_em IS NULL ORDER BY id LIMIT 100')
        .bind(contaId).all();
      return json({ entregas: r.results ?? [] });
    }
    if (rota === 'entregas/confirmar' && metodo === 'POST') {
      const { ids } = await corpo(request);
      const lista = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
      if (lista.length) {
        await env.DB.prepare(`UPDATE cyberidle_entregas SET entregue_em = ? WHERE conta_id = ? AND id IN (${lista.map(() => '?').join(',')})`)
          .bind(Date.now(), contaId, ...lista).run();
      }
      return json({ ok: true });
    }

    return json({ error: 'Rota não encontrada.' }, 404);
  } catch (erro) {
    console.error('cyberidle nuvem', erro);
    return json({ error: 'Falha na nuvem. Tente de novo.' }, 500);
  }
}

// ------------------------------------------------------------------ ranking
const ORDEM = {
  level: 'nivel DESC, experiencia DESC',
  skill: 'skill DESC, nivel DESC',
  gold: 'gold DESC',
  bestiary: 'bestiario DESC',
};

async function lerRanking(request, env) {
  const tipo = new URL(request.url).searchParams.get('tipo') || 'level';
  const ordem = ORDEM[tipo] || ORDEM.level;
  const r = await env.DB.prepare(
    `SELECT nome, vocacao, nivel, experiencia, skill, gold, bestiario FROM cyberidle_ranking
     WHERE suspeito = 0 ORDER BY ${ordem} LIMIT 20`,
  ).all();
  return json({ tipo, linhas: r.results ?? [] });
}

/** Confere se os números do personagem são possíveis. Devolve o motivo ou null. */
function motivoSuspeito(p, antes, agora) {
  if (!Number.isInteger(p.nivel) || p.nivel < 1 || p.nivel > 3000) return 'nível fora do jogo';
  if (p.experiencia < xpDoNivel(p.nivel) || p.experiencia >= xpDoNivel(p.nivel + 1)) return 'XP não bate com o nível';
  if (p.skill < 0 || p.skill > 200) return 'skill fora do jogo';
  if (p.gold < 0 || p.gold > 10_000_000_000) return 'gold fora do jogo';
  if (p.bestiario < 0 || p.bestiario > 1_000_000) return 'bestiário fora do jogo';
  if (!antes) return p.nivel > 150 ? 'primeiro registro já em nível alto' : null;
  const horas = Math.max((agora - antes.atualizado_em) / 3_600_000, 1 / 60);
  const tetoPorHora = Math.max(500_000, p.nivel * p.nivel * 2_000);
  if (p.experiencia - antes.experiencia > tetoPorHora * horas) return 'XP demais para o tempo passado';
  if (p.nivel < antes.nivel - 5) return null; // morte perde nível: normal
  return null;
}

async function gravarRanking(request, env, contaId) {
  const { personagens } = await corpo(request);
  const lista = (Array.isArray(personagens) ? personagens : []).slice(0, 10);
  const agora = Date.now();
  let suspeitos = 0;
  const comandos = [];
  for (const bruto of lista) {
    const p = {
      nome: String(bruto?.nome ?? ''),
      vocacao: Math.floor(Number(bruto?.vocacao) || 0),
      nivel: Math.floor(Number(bruto?.nivel) || 0),
      experiencia: Math.floor(Number(bruto?.experiencia) || 0),
      skill: Math.floor(Number(bruto?.skill) || 0),
      gold: Math.floor(Number(bruto?.gold) || 0),
      bestiario: Math.floor(Number(bruto?.bestiario) || 0),
    };
    if (!NOME.test(p.nome)) continue;
    const antes = await env.DB.prepare('SELECT nivel, experiencia, suspeito, atualizado_em FROM cyberidle_ranking WHERE conta_id = ? AND nome = ?')
      .bind(contaId, p.nome).first();
    // Uma vez suspeito, continua fora do placar (não dá para "limpar" mandando outro número).
    const motivo = antes?.suspeito ? 'já marcado' : motivoSuspeito(p, antes, agora);
    if (motivo) suspeitos += 1;
    comandos.push(env.DB.prepare(
      `INSERT INTO cyberidle_ranking (conta_id, nome, vocacao, nivel, experiencia, skill, gold, bestiario, suspeito, motivo, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conta_id, nome) DO UPDATE SET vocacao = excluded.vocacao, nivel = excluded.nivel,
         experiencia = excluded.experiencia, skill = excluded.skill, gold = excluded.gold, bestiario = excluded.bestiario,
         suspeito = excluded.suspeito, motivo = excluded.motivo, atualizado_em = excluded.atualizado_em`,
    ).bind(contaId, p.nome, p.vocacao, p.nivel, p.experiencia, p.skill, p.gold, p.bestiario, motivo ? 1 : 0, motivo, agora));
  }
  if (comandos.length) await env.DB.batch(comandos);
  return json({ ok: true, suspeitos });
}

// ------------------------------------------------------------------ mercado
async function listarMercado(env, contaId) {
  const limite = Date.now() - MERCADO.diasAberto * DIA;
  // Anúncios vencidos voltam para o vendedor.
  const vencidos = await env.DB.prepare("SELECT id, conta_id, vendedor, item_id, qtd FROM cyberidle_mercado WHERE status = 'aberto' AND criado_em < ? LIMIT 50")
    .bind(limite).all();
  for (const v of vencidos.results ?? []) await devolver(env, v, 'anúncio vencido');
  const r = await env.DB.prepare(
    "SELECT id, conta_id, vendedor, item_id, qtd, preco, criado_em FROM cyberidle_mercado WHERE status = 'aberto' ORDER BY criado_em DESC LIMIT 100",
  ).all();
  return json({
    anuncios: (r.results ?? []).map((a) => ({
      id: a.id, vendedor: a.vendedor, itemId: a.item_id, qtd: a.qtd, preco: a.preco, criadoEm: a.criado_em, meu: a.conta_id === contaId,
    })),
  });
}

async function contar(env, sql, ...valores) {
  const r = await env.DB.prepare(sql).bind(...valores).first();
  return Number(r?.n ?? 0);
}

async function anunciar(request, env, contaId) {
  const { personagem, itemId, qtd, preco } = await corpo(request);
  const id = Math.floor(Number(itemId));
  const quantos = Math.floor(Number(qtd));
  const valor = Math.floor(Number(preco));
  if (typeof personagem !== 'string' || !NOME.test(personagem)) return json({ error: 'Personagem inválido.' }, 400);
  if (!(id in ITENS_MERCADO)) return json({ error: 'Esse item não pode ir ao mercado.' }, 400);
  if (!Number.isInteger(quantos) || quantos < 1 || quantos > MERCADO.qtdMax) return json({ error: `Quantidade de 1 a ${MERCADO.qtdMax}.` }, 400);
  const teto = Math.min(MERCADO.precoMax, Math.max(MERCADO.precoTetoMinimo, ITENS_MERCADO[id] * quantos * MERCADO.precoVezesValor));
  if (!Number.isInteger(valor) || valor < MERCADO.precoMin || valor > teto) return json({ error: `Preço de 1 a ${teto.toLocaleString('pt-BR')} gp para esse lote.` }, 400);
  const agora = Date.now();
  if (await contar(env, "SELECT COUNT(*) AS n FROM cyberidle_mercado WHERE conta_id = ? AND status = 'aberto'", contaId) >= MERCADO.abertosPorConta) {
    return json({ error: `Limite de ${MERCADO.abertosPorConta} anúncios abertos por conta.` }, 429);
  }
  if (await contar(env, 'SELECT COUNT(*) AS n FROM cyberidle_mercado WHERE conta_id = ? AND criado_em > ?', contaId, agora - DIA) >= MERCADO.anunciosPorDia) {
    return json({ error: `Limite de ${MERCADO.anunciosPorDia} anúncios por dia.` }, 429);
  }
  const r = await env.DB.prepare('INSERT INTO cyberidle_mercado (conta_id, vendedor, item_id, qtd, preco, criado_em) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(contaId, personagem, id, quantos, valor, agora).run();
  return json({ anuncioId: r.meta.last_row_id });
}

async function comprar(request, env, contaId) {
  const { personagem, anuncioId } = await corpo(request);
  if (typeof personagem !== 'string' || !NOME.test(personagem)) return json({ error: 'Personagem inválido.' }, 400);
  const a = await env.DB.prepare("SELECT id, conta_id, vendedor, item_id, qtd, preco FROM cyberidle_mercado WHERE id = ? AND status = 'aberto'")
    .bind(Math.floor(Number(anuncioId))).first();
  if (!a) return json({ error: 'Esse anúncio não está mais à venda.' }, 404);
  if (a.conta_id === contaId) return json({ error: 'Esse anúncio é seu.' }, 400);
  const agora = Date.now();
  if (await contar(env, 'SELECT COUNT(*) AS n FROM cyberidle_mercado WHERE comprador_conta = ? AND fechado_em > ?', contaId, agora - DIA) >= MERCADO.comprasPorDia) {
    return json({ error: `Limite de ${MERCADO.comprasPorDia} compras por dia.` }, 429);
  }
  // Fecha só se ainda estiver aberto: duas compras ao mesmo tempo não levam o mesmo item.
  const fechou = await env.DB.prepare("UPDATE cyberidle_mercado SET status = 'vendido', comprador_conta = ?, comprador = ?, fechado_em = ? WHERE id = ? AND status = 'aberto'")
    .bind(contaId, personagem, agora, a.id).run();
  if (!fechou.meta.changes) return json({ error: 'Esse anúncio não está mais à venda.' }, 404);
  const liquido = Math.floor(a.preco * (1 - MERCADO.taxa));
  await env.DB.batch([
    env.DB.prepare('INSERT INTO cyberidle_entregas (conta_id, personagem, item_id, qtd, motivo, anuncio_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(contaId, personagem, a.item_id, a.qtd, 'compra no mercado', a.id, agora),
    env.DB.prepare('INSERT INTO cyberidle_entregas (conta_id, personagem, gold, motivo, anuncio_id, criado_em) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(a.conta_id, a.vendedor, liquido, 'venda no mercado', a.id, agora),
  ]);
  return json({ ok: true, preco: a.preco });
}

async function devolver(env, a, motivo) {
  const mudou = await env.DB.prepare("UPDATE cyberidle_mercado SET status = 'cancelado', fechado_em = ? WHERE id = ? AND status = 'aberto'")
    .bind(Date.now(), a.id).run();
  if (!mudou.meta.changes) return false;
  await env.DB.prepare('INSERT INTO cyberidle_entregas (conta_id, personagem, item_id, qtd, motivo, anuncio_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(a.conta_id, a.vendedor, a.item_id, a.qtd, motivo, a.id, Date.now()).run();
  return true;
}

async function cancelar(request, env, contaId) {
  const { anuncioId } = await corpo(request);
  const a = await env.DB.prepare("SELECT id, conta_id, vendedor, item_id, qtd FROM cyberidle_mercado WHERE id = ? AND status = 'aberto'")
    .bind(Math.floor(Number(anuncioId))).first();
  if (!a || a.conta_id !== contaId) return json({ error: 'Anúncio não encontrado.' }, 404);
  if (!(await devolver(env, a, 'anúncio cancelado'))) return json({ error: 'Esse anúncio não está mais à venda.' }, 404);
  return json({ ok: true });
}
