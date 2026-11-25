// projetos/cortex/youtube.js - envio dos Shorts ao canal do dono (24/11/2026).
//
// Divisão (pedido do dono): o painel guarda a fila, os textos e o ID do vídeo enviado; o ARQUIVO e
// o TOKEN do YouTube ficam só no PC (o agente faz o envio pela YouTube Data API v3). Nenhum
// segredo passa por aqui. Só curto (Short); longo nunca entra nesta fila.
//
//   GET  /youtube                 configuração (privacidade padrão, modelo da descrição) + PCs conectados ao YouTube
//   PUT  /youtube                 { privacidade, modelo_descricao } (null = volta ao modelo padrão)
//   POST /youtube/previa          { corte_id?, modelo? } o texto exato que vai para o YouTube
//   POST /youtube/enviar          { ids, privacidade? } põe curtos na fila de envio do PC que tem o arquivo
//   POST /youtube/cancelar        { id } tira da fila (antes de o PC começar)
//   POST /youtube/desvincular     { id } esquece o ID enviado (o vídeo no YouTube fica); só assim envia de novo
//
// Autoria: Claude (Opus 5.5), Lab Hub, 24/11/2026.

import { db } from '../../lib/db.js';
import { auditar } from '../../lib/audit.js';

export const MARCADORES = ['descricao', 'hashtags', 'titulo', 'criador', 'link_live'];
export const MODELO_PADRAO = '{{descricao}}\n\n{{hashtags}}';
const PRIVACIDADES = ['private', 'unlisted', 'public'];
const MAX_HASHTAGS = 5;    // padrão editorial (21/11): poucas; o YouTube mostra as 3 primeiras acima do título

// "GTA 6" -> #GTA6 (sem espaço nem pontuação; acento fica). Igual à do agente e à da tela.
function hashtag(t) { return '#' + String(t).replace(/^#/, '').replace(/[^\p{L}\p{N}_]+/gu, ''); }

// O texto da IA traz as hashtags na última linha: separa o corpo das hashtags.
export function separarHashtags(desc) {
  const linhas = String(desc || '').replace(/\r/g, '').split('\n');
  const tags = [];
  while (linhas.length && (!linhas[linhas.length - 1].trim() || /^(#[\p{L}\p{N}_]+[\s,]*)+$/u.test(linhas[linhas.length - 1].trim()))) {
    const l = linhas.pop().trim(); if (l) tags.unshift(...l.split(/[\s,]+/).filter(Boolean));
  }
  return { corpo: linhas.join('\n').trim(), tags };
}

// Hashtags do Short: as da descrição da IA (ou, sem elas, as tags), sem repetir, até 5, e o
// #Shorts sempre presente (é Short; ajuda o YouTube a classificar).
export function hashtagsDoCorte(desc, tags) {
  const daDesc = separarHashtags(desc).tags;
  const fonte = daDesc.length ? daDesc : (tags || []).map(hashtag);
  const vistas = new Set(), out = [];
  for (const h of fonte) {
    const k = h.toLowerCase();
    if (h.length > 1 && !vistas.has(k) && out.length < MAX_HASHTAGS) { vistas.add(k); out.push(h); }
  }
  if (!vistas.has('#shorts')) { if (out.length >= MAX_HASHTAGS) out.pop(); out.push('#Shorts'); }
  return out.join(' ');
}

// Tags do YouTube: até 500 caracteres no total (tag com espaço conta 2 a mais, pelas aspas).
export function tagsYoutube(tags) {
  const out = []; let n = 0;
  for (const t0 of tags || []) {
    const t = String(t0).replace(/[<>,]/g, '').trim().slice(0, 100);
    if (!t) continue;
    const custo = t.length + (/\s/.test(t) ? 2 : 0) + (out.length ? 1 : 0);
    if (n + custo > 500) break;
    out.push(t); n += custo;
  }
  return out;
}

// O YouTube recusa < e > no título e na descrição.
const limpo = (s) => String(s || '').replace(/[<>]/g, '');

function cortarBytes(s, max) {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= max) return s;
  let fim = s.length;
  while (fim > 0 && enc.encode(s.slice(0, fim)).length > max) fim -= 50;
  return s.slice(0, fim).trimEnd();
}

// Título, descrição (pelo modelo do dono) e tags exatamente como vão para o YouTube.
export function textosYoutube(corte, video, modelo) {
  let tags = corte.tags;
  if (typeof tags === 'string') { try { tags = JSON.parse(tags); } catch { tags = []; } }
  if (!Array.isArray(tags)) tags = [];
  let titulo = limpo(corte.titulo).replace(/\s+/g, ' ').trim();
  if (titulo.length > 100) titulo = titulo.slice(0, 100).replace(/\s+\S*$/, '').trim();
  const valores = {
    descricao: separarHashtags(corte.descricao).corpo,
    hashtags: hashtagsDoCorte(corte.descricao, tags),
    titulo,
    criador: (video && video.canal) || '',
    link_live: (video && video.url) || '',
  };
  const desc = String(modelo || MODELO_PADRAO).replace(/\r/g, '')
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (k in valores ? valores[k] : m))
    .replace(/\n{3,}/g, '\n\n').trim();
  return { titulo: titulo || 'Short', descricao: cortarBytes(limpo(desc), 4900), tags: tagsYoutube(tags) };
}

export async function configYoutube(env, usuarioId) {
  const c = await db(env).first('SELECT privacidade, modelo_descricao, atualizado_em FROM cortex_youtube WHERE usuario_id = ?', usuarioId);
  return { privacidade: (c && c.privacidade) || 'private', modelo_descricao: (c && c.modelo_descricao) || null, atualizado_em: c ? c.atualizado_em : null };
}

// Nome do PC que baixou o corte: o agente grava "NOME: caminho" em arquivo_local.
export function pcDoArquivo(arquivoLocal) {
  const m = String(arquivoLocal || '').match(/^([^:]{1,40}): (.+)$/);
  return m ? { nome: m[1], caminho: m[2] } : null;
}

export async function rotasYoutube({ request, env, data, u, id, metodo, json, agora }) {
  if (!id && metodo === 'GET') {
    const [cfg, pcs] = await Promise.all([
      configYoutube(env, u.id),
      db(env).all(`SELECT id, nome, versao, visto_em, youtube_canal, youtube_aviso FROM cortex_agentes
                    WHERE usuario_id = ? AND revogado_em IS NULL ORDER BY id`, u.id),
    ]);
    for (const p of pcs) p.online = !!p.visto_em && Date.now() - Date.parse(p.visto_em) < 2 * 60000;
    return json({ ...cfg, modelo_padrao: MODELO_PADRAO, marcadores: MARCADORES, pcs });
  }

  if (!id && metodo === 'PUT') {
    const corpo = await request.json().catch(() => ({}));
    const priv = String(corpo.privacidade || 'private');
    if (!PRIVACIDADES.includes(priv)) return json({ erro: 'Privacidade inválida.' }, 400);
    let modelo = corpo.modelo_descricao == null ? null : String(corpo.modelo_descricao).replace(/\r/g, '').trim();
    if (modelo === '' || modelo === MODELO_PADRAO) modelo = null;
    if (modelo && modelo.length > 4000) return json({ erro: 'O modelo passou de 4.000 caracteres (o YouTube aceita 5.000 com o texto da IA).' }, 400);
    const desconhecidos = modelo ? [...modelo.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1]).filter((k) => !MARCADORES.includes(k)) : [];
    if (desconhecidos.length) return json({ erro: `Marcador desconhecido: {{${desconhecidos[0]}}}. Use ${MARCADORES.map((k) => '{{' + k + '}}').join(', ')}.` }, 400);
    const antes = await configYoutube(env, u.id);
    await db(env).run(
      `INSERT INTO cortex_youtube (usuario_id, privacidade, modelo_descricao, atualizado_em) VALUES (?, ?, ?, ?)
       ON CONFLICT (usuario_id) DO UPDATE SET privacidade = excluded.privacidade, modelo_descricao = excluded.modelo_descricao, atualizado_em = excluded.atualizado_em`,
      u.id, priv, modelo, agora);
    await auditar(env, { quem: u.email, acao: 'config-youtube', entidade: 'cortex_youtube', entidade_id: u.id,
      antes, depois: { privacidade: priv, modelo_descricao: modelo }, ip: data.ip });
    return json({ ok: true });
  }

  if (metodo !== 'POST') return json({ erro: 'rota nao encontrada' }, 404);
  const corpo = await request.json().catch(() => ({}));

  if (id === 'previa') {
    const cid = Number(corpo.corte_id) || 0;
    const corte = await db(env).first(
      `SELECT c.id, c.titulo, c.descricao, c.tags, c.video_id FROM cortex_cortes c
        WHERE c.usuario_id = ? AND c.tipo = 'curto' AND (? = 0 OR c.id = ?)
        ORDER BY (c.estado = 'edicao') DESC, c.atualizado_em DESC LIMIT 1`, u.id, cid, cid);
    if (!corte) return json({ erro: 'Nenhum curto para mostrar a prévia ainda.' }, 404);
    const video = await db(env).first('SELECT canal, url FROM cortex_videos WHERE id = ?', corte.video_id);
    const modelo = corpo.modelo !== undefined ? String(corpo.modelo || '') || null : (await configYoutube(env, u.id)).modelo_descricao;
    return json({ corte_id: corte.id, ...textosYoutube(corte, video, modelo) });
  }

  if (id === 'enviar') {
    const ids = [...new Set((Array.isArray(corpo.ids) ? corpo.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (!ids.length || ids.length > 100) return json({ erro: 'Escolha de 1 a 100 Shorts.' }, 400);
    const cfg = await configYoutube(env, u.id);
    const priv = corpo.privacidade == null ? cfg.privacidade : String(corpo.privacidade);
    if (!PRIVACIDADES.includes(priv)) return json({ erro: 'Privacidade inválida.' }, 400);
    const marcas = ids.map(() => '?').join(',');
    const [cortes, pcs] = await Promise.all([
      db(env).all(
        `SELECT c.id, c.video_id, c.tipo, c.estado, c.baixar_fora, c.arquivo_local, c.youtube_id, c.qualidade,
                (SELECT t.estado FROM cortex_tarefas t WHERE t.corte_id = c.id AND t.tipo = 'enviar_youtube' AND t.estado IN ('pendente', 'pega') LIMIT 1) AS na_fila
           FROM cortex_cortes c WHERE c.usuario_id = ? AND c.id IN (${marcas})`, u.id, ...ids),
      db(env).all('SELECT id, nome FROM cortex_agentes WHERE usuario_id = ? AND revogado_em IS NULL', u.id),
    ]);
    const ok = [], ficaram = [];
    for (const c of cortes) {
      const pc = pcDoArquivo(c.arquivo_local);
      const ag = pc && pcs.find((a) => a.nome === pc.nome);
      const motivo = c.tipo !== 'curto' ? 'só Shorts (curtos) vão por aqui'
        : c.youtube_id ? 'já foi enviado (ID ' + c.youtube_id + ')'
        : c.na_fila ? 'já está na fila de envio'
        : c.estado !== 'edicao' ? 'só cortes da coluna Edição (já baixados)'
        : c.baixar_fora || !pc ? 'o PC não tem o arquivo deste corte (baixado fora)'
        : /vertical FALHOU/.test(c.qualidade || '') ? 'o vertical falhou: só existe o horizontal'
        : !ag ? `o PC "${pc.nome}", que tem o arquivo, não está mais conectado`
        : null;
      if (motivo) ficaram.push({ id: c.id, motivo }); else ok.push({ c, ag });
    }
    for (const n of ids) if (!cortes.some((c) => c.id === n)) ficaram.push({ id: n, motivo: 'corte não encontrado' });
    if (ok.length) {
      await db(env).batch(ok.flatMap(({ c, ag }) => [
        [`DELETE FROM cortex_tarefas WHERE corte_id = ? AND tipo = 'enviar_youtube' AND estado IN ('falhou', 'feita')`, [c.id]],
        [`INSERT INTO cortex_tarefas (usuario_id, tipo, video_id, corte_id, agente_alvo, criada_em, atualizada_em)
          VALUES (?, 'enviar_youtube', ?, ?, ?, ?, ?)`, [u.id, c.video_id, c.id, ag.id, agora, agora]],
        [`UPDATE cortex_cortes SET youtube_estado = 'fila', youtube_privacidade = ?, youtube_erro = NULL WHERE id = ?`, [priv, c.id]],
      ]));
      await auditar(env, { quem: u.email, acao: 'enviar-youtube', entidade: 'cortex_cortes', entidade_id: ok.map((x) => x.c.id).join(',').slice(0, 200),
        depois: { privacidade: priv, pcs: [...new Set(ok.map((x) => x.ag.nome))] }, ip: data.ip });
    }
    return json({ ok: true, na_fila: ok.length, ficaram });
  }

  if (id === 'cancelar' || id === 'desvincular') {
    const c = await db(env).first('SELECT id, youtube_id, youtube_estado FROM cortex_cortes WHERE id = ? AND usuario_id = ?', Number(corpo.id), u.id);
    if (!c) return json({ erro: 'corte não encontrado' }, 404);
    if (id === 'cancelar') {
      const pega = await db(env).first("SELECT id FROM cortex_tarefas WHERE corte_id = ? AND tipo = 'enviar_youtube' AND estado = 'pega' AND pega_ate >= ?", c.id, agora);
      if (pega) return json({ erro: 'O PC já está enviando este Short. Espere terminar (depois, se quiser, apague no YouTube Studio).' }, 409);
      await db(env).batch([
        ["DELETE FROM cortex_tarefas WHERE corte_id = ? AND tipo = 'enviar_youtube' AND estado IN ('pendente', 'pega', 'falhou')", [c.id]],
        ['UPDATE cortex_cortes SET youtube_estado = CASE WHEN youtube_id IS NULL THEN NULL ELSE \'enviado\' END, youtube_erro = NULL WHERE id = ?', [c.id]],
      ]);
      await auditar(env, { quem: u.email, acao: 'cancelar-youtube', entidade: 'cortex_cortes', entidade_id: c.id, antes: { youtube_estado: c.youtube_estado }, ip: data.ip });
      return json({ ok: true });
    }
    if (!c.youtube_id) return json({ erro: 'Este corte não tem envio registrado.' }, 400);
    // O ID antigo vai para youtube_antigos: o registro local do PC ainda o tem, e sem isso o PC
    // responderia "já enviado" em vez de enviar de novo.
    const antigos = await db(env).first('SELECT youtube_antigos FROM cortex_cortes WHERE id = ?', c.id);
    let lista = []; try { lista = JSON.parse(antigos.youtube_antigos || '[]'); } catch { lista = []; }
    lista = [...new Set([...lista, c.youtube_id])].slice(-20);
    // 25/11: desvincular é para enviar de novo, então o corte volta de Publicado para a Edição.
    const est = await db(env).first('SELECT estado FROM cortex_cortes WHERE id = ?', c.id);
    await db(env).run(`UPDATE cortex_cortes SET youtube_id = NULL, youtube_estado = NULL, youtube_erro = NULL, youtube_em = NULL, youtube_antigos = ?,
                        estado = CASE WHEN estado = 'publicado' THEN 'edicao' ELSE estado END, atualizado_em = ? WHERE id = ?`,
      JSON.stringify(lista), new Date().toISOString(), c.id);
    await auditar(env, { quem: u.email, acao: 'desvincular-youtube', entidade: 'cortex_cortes', entidade_id: c.id,
      antes: { youtube_id: c.youtube_id, estado: est && est.estado }, depois: { estado: est && est.estado === 'publicado' ? 'edicao' : est && est.estado }, ip: data.ip });
    return json({ ok: true });
  }

  return json({ erro: 'rota nao encontrada' }, 404);
}
