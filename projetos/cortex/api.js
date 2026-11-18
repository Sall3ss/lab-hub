// projetos/cortex/api.js - rotas do projeto "Cortex" (central de cortes).
// Chega aqui tudo que for /api/p/cortex/<resto>, ja com sessao conferida pela porta
// unica (functions/api/[[path]].js). Tabelas deste projeto levam o prefixo cortex_.
//
// Regra do projeto: a nuvem NUNCA baixa nem mexe em video. Ela guarda link, texto,
// roteiro e estado, e enfileira trabalho para o PC do dono (cortex_tarefas).
//
//   GET    /quadro                 videos + cortes do Kanban e se o PC esta online
//   POST   /videos                 { url, analisar_de_s?, analisar_ate_s? } -> cria o video e a tarefa "buscar texto" do PC
//   POST   /videos/:id/trecho      { analisar_de_s, analisar_ate_s, confirmado? } muda o trecho analisado (16/11)
//   POST   /videos/:id/continuar   "Puxar o resto" de uma live da Kick: so a parte nova (18/11)
//   GET    /videos/:id             video + todos os cortes (linha do tempo)
//   PATCH  /videos/:id             { titulo?, arquivado? }  arquivado = "Concluir video" (sai do quadro)
//   GET    /concluidos             videos concluidos (arquivados), para reabrir
//   DELETE /videos/:id             apaga video, transcricao, cortes e tarefas
//   POST   /cortes                 { video_id, tipo, inicio_s, fim_s, titulo, ... } corte manual
//   PATCH  /cortes/:id             { estado?, titulo?, descricao?, tags?, gancho?, gancho_inicio_s?, gancho_fim_s?, inicio_s?, fim_s? }
//   DELETE /cortes/:id
//   POST   /videos/:id/tentar | /cortes/:id/tentar   devolve a tarefa que falhou para a fila
//   GET    /agentes                lista os PCs conectados
//   POST   /agentes                { nome } -> gera a chave do PC (mostrada UMA vez)
//   PATCH  /agentes/:id            { baixa_cortes }
//   DELETE /agentes/:id            desconecta (revoga a chave)
//
// As rotas do proprio PC (sem sessao, com a chave dele) ficam em maquina.js.
//
// Etapa 2 (agente do PC) e etapa 3 (roteiro com o Gemini gratis, roteiro.js); ver a ficha.
// Autoria: Claude (Opus 5.5), Lab Hub, 14/11/2026.

import { db } from '../../lib/db.js';
import { auditar } from '../../lib/audit.js';
import { hashChave, AGENTE_VERSAO } from './maquina.js';

export { maquina } from './maquina.js';

const PC_ONLINE_MS = 2 * 60 * 1000;   // agente que falou nos ultimos 2 min = online
const DURACAO = { curto: [15, 180], longo: [5 * 60, 90 * 60] };   // limites aceitos (s)

// Mudancas de estado que o dono pode fazer pela tela. O resto e do agente.
// 15/11: triagem -> edicao = "Aprovar sem baixar" (o dono baixa por fora; baixar_fora = 1).
const TRANSICOES = {
  triagem: ['download', 'edicao', 'descartado'],
  descartado: ['triagem'],
  download: ['triagem'],                          // cancelar antes de o PC baixar
  edicao: ['publicado', 'download', 'triagem'],   // 'download' = baixar (de novo) pelo PC; 'triagem' so se baixado fora
  publicado: ['edicao'],
};

export async function rotas({ request, env, data, u, partes, metodo, json }) {
  const [rota, id] = partes;
  const agora = new Date().toISOString();

  if (rota === 'ping' && metodo === 'GET') return json({ ok: true, projeto: 'cortex' });

  if (rota === 'quadro' && metodo === 'GET') {
    const [videos, cortes, pc] = await Promise.all([
      db(env).all(
        `SELECT v.id, v.url, v.plataforma, v.titulo, v.canal, v.duracao_s, v.etapa, v.erro, v.criado_em, v.atualizado_em,
                v.analisar_de_s, v.analisar_ate_s, v.ao_vivo_canal, v.ao_vivo, v.capturado_ate_s, v.continuar_de_s,
                (SELECT COUNT(*) FROM cortex_cortes c WHERE c.video_id = v.id AND c.estado <> 'descartado') AS cortes,
                ${TAREFA_SQL('t.video_id = v.id AND t.tipo IN (\'texto\', \'roteiro\')')}
           FROM cortex_videos v WHERE v.usuario_id = ? AND v.arquivado = 0
          ORDER BY v.atualizado_em DESC LIMIT 300`, u.id),
      db(env).all(
        `SELECT c.id, c.video_id, c.tipo, c.origem, c.inicio_s, c.fim_s, c.titulo, c.gancho, c.nota, c.estado,
                c.erro, c.qualidade, c.baixar_fora, c.atualizado_em, v.titulo AS video_titulo, v.plataforma,
                ${TAREFA_SQL('t.corte_id = c.id')}
           FROM cortex_cortes c JOIN cortex_videos v ON v.id = c.video_id
          WHERE c.usuario_id = ? AND c.estado <> 'descartado' AND v.arquivado = 0
          ORDER BY c.atualizado_em DESC LIMIT 500`, u.id),
      listarAgentes(env, u.id),
    ]);
    const online = pc.filter((a) => a.online);
    return json({ videos, cortes, pc: {
      total: pc.length, online: online.length, nomes_online: online.map((a) => a.nome),
      baixam: pc.filter((a) => a.baixa_cortes).length,
    } });
  }

  // Videos concluidos (arquivados): saem do quadro e da linha do tempo, mas nada e apagado.
  if (rota === 'concluidos' && metodo === 'GET') {
    const videos = await db(env).all(
      `SELECT v.id, v.url, v.plataforma, v.titulo, v.canal, v.duracao_s, v.atualizado_em,
              (SELECT COUNT(*) FROM cortex_cortes c WHERE c.video_id = v.id AND c.estado = 'publicado') AS publicados,
              (SELECT COUNT(*) FROM cortex_cortes c WHERE c.video_id = v.id AND c.estado <> 'descartado') AS cortes
         FROM cortex_videos v WHERE v.usuario_id = ? AND v.arquivado = 1
        ORDER BY v.atualizado_em DESC LIMIT 200`, u.id);
    return json({ videos });
  }

  if (rota === 'videos' && !id && metodo === 'POST') {
    const corpo = await request.json().catch(() => ({}));
    const link = lerLink(corpo.url);
    if (link.erro) return json({ erro: link.erro }, 400);
    const tr = lerTrecho(corpo.analisar_de_s, corpo.analisar_ate_s, null);
    if (tr.erro) return json({ erro: tr.erro }, 400);
    // Live colada de novo (o mesmo canal, ainda no ar ou ainda sendo descoberta pelo PC):
    // o caminho certo e "Puxar o resto" no video que ja existe.
    if (link.ao_vivo_canal) {
      const live = await db(env).first(
        `SELECT id, titulo FROM cortex_videos WHERE usuario_id = ? AND ao_vivo_canal = ? AND arquivado = 0
            AND (ao_vivo = 1 OR id_externo LIKE 'live:%') ORDER BY id DESC LIMIT 1`, u.id, link.ao_vivo_canal);
      if (live) return json({ erro: 'Essa live já está no quadro. Abra o vídeo e use "⟳ Puxar o resto" para pegar a parte nova.', video_id: live.id }, 409);
    }
    const ja = await db(env).first(
      'SELECT id, arquivado FROM cortex_videos WHERE usuario_id = ? AND plataforma = ? AND id_externo = ?',
      u.id, link.plataforma, link.id_externo);
    if (ja) return json({ erro: ja.arquivado ? 'Esse vídeo já foi importado e está arquivado.' : 'Esse vídeo já está no quadro.', video_id: ja.id }, 409);

    const r = await db(env).run(
      `INSERT INTO cortex_videos (usuario_id, url, plataforma, id_externo, etapa, analisar_de_s, analisar_ate_s, ao_vivo_canal, ao_vivo, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, 'entrada', ?, ?, ?, ?, ?, ?)`, u.id, link.url, link.plataforma, link.id_externo, tr.de, tr.ate,
      link.ao_vivo_canal || null, link.ao_vivo_canal ? 1 : 0, agora, agora);
    const videoId = r.meta.last_row_id;
    await db(env).run(
      `INSERT INTO cortex_tarefas (usuario_id, tipo, video_id, criada_em, atualizada_em) VALUES (?, 'texto', ?, ?, ?)`,
      u.id, videoId, agora, agora);
    await auditar(env, { quem: u.email, acao: 'criar', entidade: 'cortex_videos', entidade_id: videoId, depois: { ...link, analisar_de_s: tr.de, analisar_ate_s: tr.ate }, ip: data.ip });
    return json({ ok: true, id: videoId, ...link }, 201);
  }

  if (rota === 'agentes') return await rotasAgentes({ request, env, data, u, id, metodo, json, agora });

  if ((rota === 'videos' || rota === 'cortes') && id && partes[2] === 'tentar' && metodo === 'POST') {
    const campo = rota === 'videos' ? 'video_id' : 'corte_id';
    const tabela = rota === 'videos' ? 'cortex_videos' : 'cortex_cortes';
    const dono = await db(env).first(`SELECT id FROM ${tabela} WHERE id = ? AND usuario_id = ?`, Number(id), u.id);
    if (!dono) return json({ erro: 'não encontrado' }, 404);
    const filtroTipo = rota === 'videos' ? " AND tipo IN ('texto', 'roteiro')" : '';
    const r = await db(env).run(
      `UPDATE cortex_tarefas SET estado = 'pendente', tentativas = 0, erro = NULL, atualizada_em = ?
        WHERE ${campo} = ? AND estado = 'falhou'${filtroTipo}`, agora, dono.id);
    if (!r.meta.changes) return json({ erro: 'Não há falha para tentar de novo.' }, 409);
    await db(env).run(`UPDATE ${tabela} SET erro = NULL, atualizado_em = ? WHERE id = ?`, agora, dono.id);
    await auditar(env, { quem: u.email, acao: 'tentar-de-novo', entidade: tabela, entidade_id: dono.id, ip: data.ip });
    return json({ ok: true });
  }

  if (rota === 'videos' && id && partes[2] === 'continuar' && metodo === 'POST') {
    return await puxarResto({ env, data, u, id, json, agora });
  }

  if (rota === 'videos' && id && partes[2] === 'trecho' && metodo === 'POST') {
    return await mudarTrecho({ request, env, data, u, id, json, agora });
  }

  if (rota === 'videos' && id) {
    const video = await db(env).first('SELECT * FROM cortex_videos WHERE id = ? AND usuario_id = ?', Number(id), u.id);
    if (!video) return json({ erro: 'vídeo não encontrado' }, 404);

    if (metodo === 'GET') {
      const cortes = await db(env).all(
        'SELECT * FROM cortex_cortes WHERE video_id = ? ORDER BY inicio_s', video.id);
      for (const c of cortes) c.tags = lerTags(c.tags);
      return json({ video, cortes });
    }

    if (metodo === 'PATCH') {
      const corpo = await request.json().catch(() => ({}));
      const titulo = corpo.titulo !== undefined ? String(corpo.titulo).trim().slice(0, 200) || null : video.titulo;
      const arquivado = corpo.arquivado !== undefined ? (corpo.arquivado ? 1 : 0) : video.arquivado;
      // Concluir com corte na fila do PC deixaria um download orfao, fora do quadro.
      if (arquivado && !video.arquivado) {
        const fila = await db(env).first(
          "SELECT COUNT(*) AS n FROM cortex_cortes WHERE video_id = ? AND estado = 'download'", video.id);
        if (fila.n) return json({ erro: `Tem ${fila.n} corte(s) na fila do PC. Espere baixar ou cancele antes de concluir.` }, 409);
      }
      await db(env).run('UPDATE cortex_videos SET titulo = ?, arquivado = ?, atualizado_em = ? WHERE id = ?',
        titulo, arquivado, agora, video.id);
      await auditar(env, { quem: u.email, acao: 'editar', entidade: 'cortex_videos', entidade_id: video.id,
        antes: { titulo: video.titulo, arquivado: video.arquivado }, depois: { titulo, arquivado }, ip: data.ip });
      return json({ ok: true });
    }

    if (metodo === 'DELETE') {
      await db(env).batch([
        ['DELETE FROM cortex_tarefas WHERE video_id = ?', [video.id]],
        ['DELETE FROM cortex_transcricao WHERE video_id = ?', [video.id]],
        ['DELETE FROM cortex_cortes WHERE video_id = ?', [video.id]],
        ['DELETE FROM cortex_videos WHERE id = ?', [video.id]],
      ]);
      await auditar(env, { quem: u.email, acao: 'excluir', entidade: 'cortex_videos', entidade_id: video.id,
        antes: { url: video.url, titulo: video.titulo }, ip: data.ip });
      return json({ ok: true });
    }
  }

  if (rota === 'cortes' && !id && metodo === 'POST') {
    const corpo = await request.json().catch(() => ({}));
    const video = await db(env).first('SELECT id, duracao_s FROM cortex_videos WHERE id = ? AND usuario_id = ?',
      Number(corpo.video_id), u.id);
    if (!video) return json({ erro: 'vídeo não encontrado' }, 404);
    const c = validarCorte(corpo, video);
    if (c.erro) return json({ erro: c.erro }, 400);
    const r = await db(env).run(
      `INSERT INTO cortex_cortes (video_id, usuario_id, tipo, origem, inicio_s, fim_s, titulo, descricao, tags, gancho,
                                  gancho_inicio_s, gancho_fim_s, estado, criado_em, atualizado_em)
       VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, 'triagem', ?, ?)`,
      video.id, u.id, c.tipo, c.inicio_s, c.fim_s, c.titulo, c.descricao, JSON.stringify(c.tags), c.gancho,
      c.gancho_inicio_s, c.gancho_fim_s, agora, agora);
    await auditar(env, { quem: u.email, acao: 'criar', entidade: 'cortex_cortes', entidade_id: r.meta.last_row_id, depois: c, ip: data.ip });
    return json({ ok: true, id: r.meta.last_row_id }, 201);
  }

  if (rota === 'cortes' && id) {
    const corte = await db(env).first(
      `SELECT c.*, v.duracao_s FROM cortex_cortes c JOIN cortex_videos v ON v.id = c.video_id
        WHERE c.id = ? AND c.usuario_id = ?`, Number(id), u.id);
    if (!corte) return json({ erro: 'corte não encontrado' }, 404);

    if (metodo === 'PATCH') {
      const corpo = await request.json().catch(() => ({}));
      const novo = validarCorte({ ...corte, tags: lerTags(corte.tags), ...corpo }, { duracao_s: corte.duracao_s });
      if (novo.erro) return json({ erro: novo.erro }, 400);

      let estado = corte.estado;
      const extras = [];
      if (corpo.estado !== undefined && corpo.estado !== corte.estado) {
        if (!(TRANSICOES[corte.estado] || []).includes(corpo.estado)) {
          return json({ erro: `não dá para passar de "${corte.estado}" para "${corpo.estado}"` }, 400);
        }
        estado = corpo.estado;
        if (corte.estado === 'edicao' && estado === 'triagem' && !corte.baixar_fora) {
          return json({ erro: 'Esse corte já foi baixado pelo PC: para refazer, use "Baixar de novo".' }, 400);
        }
        // Entrou na fila do PC: nasce a tarefa. Saiu dela: a tarefa pendente some.
        if (estado === 'download') {
          extras.push([`INSERT INTO cortex_tarefas (usuario_id, tipo, video_id, corte_id, criada_em, atualizada_em)
                        VALUES (?, 'baixar_corte', ?, ?, ?, ?)`, [u.id, corte.video_id, corte.id, agora, agora]]);
        } else if (corte.estado === 'download') {
          const pega = await db(env).first(
            "SELECT id FROM cortex_tarefas WHERE corte_id = ? AND estado = 'pega'", corte.id);
          if (pega) return json({ erro: 'O PC já está baixando esse corte. Espere terminar.' }, 409);
          extras.push(["DELETE FROM cortex_tarefas WHERE corte_id = ? AND estado IN ('pendente', 'falhou')", [corte.id]]);
        }
      }
      // baixar_fora: aprovado sem o PC (triagem -> edicao). Volta a 0 quando o PC passa a baixar.
      const baixarFora = estado === 'edicao' && corte.estado === 'triagem' ? 1
        : estado === 'download' || estado === 'triagem' ? 0 : corte.baixar_fora;
      // Corte ja baixado nao muda de tempo: o arquivo no PC deixaria de bater.
      // Excecoes: "Baixar de novo" (edicao -> download) leva o tempo novo; corte baixado fora
      // nao tem arquivo no PC, entao o tempo segue livre na edicao.
      if ((novo.inicio_s !== corte.inicio_s || novo.fim_s !== corte.fim_s) && !['triagem', 'descartado'].includes(corte.estado)
          && !(corte.estado === 'edicao' && (estado === 'download' || corte.baixar_fora))) {
        return json({ erro: 'Para mudar o tempo de um corte já baixado, use "Baixar de novo".' }, 400);
      }
      await db(env).batch([
        [`UPDATE cortex_cortes SET estado = ?, tipo = ?, inicio_s = ?, fim_s = ?, titulo = ?, descricao = ?, tags = ?,
                 gancho = ?, gancho_inicio_s = ?, gancho_fim_s = ?, baixar_fora = ?, erro = NULL, atualizado_em = ? WHERE id = ?`,
          [estado, novo.tipo, novo.inicio_s, novo.fim_s, novo.titulo, novo.descricao, JSON.stringify(novo.tags), novo.gancho,
           novo.gancho_inicio_s, novo.gancho_fim_s, baixarFora, agora, corte.id]],
        ...extras,
      ]);
      await auditar(env, { quem: u.email, acao: 'editar', entidade: 'cortex_cortes', entidade_id: corte.id,
        antes: { estado: corte.estado, titulo: corte.titulo }, depois: { estado, titulo: novo.titulo, baixar_fora: baixarFora }, ip: data.ip });
      return json({ ok: true, estado });
    }

    if (metodo === 'DELETE') {
      await db(env).batch([
        ['DELETE FROM cortex_tarefas WHERE corte_id = ?', [corte.id]],
        ['DELETE FROM cortex_cortes WHERE id = ?', [corte.id]],
      ]);
      await auditar(env, { quem: u.email, acao: 'excluir', entidade: 'cortex_cortes', entidade_id: corte.id,
        antes: { titulo: corte.titulo, inicio_s: corte.inicio_s, fim_s: corte.fim_s }, ip: data.ip });
      return json({ ok: true });
    }
  }

  return json({ erro: 'rota nao encontrada', projeto: 'cortex' }, 404);
}

// ---------- trecho analisado (16/11) ----------
// "Analisar de/ate": a live de 7 h em que o bom comeca depois de 3 h. NULL = sem limite.
// Devolve { de, ate } (ja normalizados) ou { erro }.
export function lerTrecho(deBruto, ateBruto, duracao) {
  const vazio = (x) => x === undefined || x === null || x === '';
  let de = vazio(deBruto) ? null : Math.round(Number(deBruto));
  let ate = vazio(ateBruto) ? null : Math.round(Number(ateBruto));
  if ((de !== null && (!Number.isFinite(de) || de < 0)) || (ate !== null && (!Number.isFinite(ate) || ate <= 0))) {
    return { erro: 'Tempo do trecho inválido. Use HH:MM:SS.' };
  }
  if (de === 0) de = null;
  if (duracao && de !== null && de >= duracao) return { erro: `O início do trecho passa da duração do vídeo (${fmt(duracao)}).` };
  if (duracao && ate !== null && ate >= duracao) ate = null;          // "ate" no fim ou depois = ate o fim
  if (ate !== null && ate - (de || 0) < 120) return { erro: 'O trecho precisa ter pelo menos 2 min (o "até" vem depois do "de").' };
  return { de, ate };
}

// Mudar o trecho de um video ja importado. Se o PC ainda nao comecou, so grava. Se ja tem
// texto, refaz: quando o texto atual cobre o trecho novo, aproveita (corta o que sobra e so
// a IA le de novo, sem gastar a Groq); senao, busca o texto de novo. Cortes da IA ainda na
// triagem (ou descartados) saem; aprovados e manuais ficam.
async function mudarTrecho({ request, env, data, u, id, json, agora }) {
  const video = await db(env).first('SELECT * FROM cortex_videos WHERE id = ? AND usuario_id = ?', Number(id), u.id);
  if (!video) return json({ erro: 'vídeo não encontrado' }, 404);
  const corpo = await request.json().catch(() => ({}));
  const tr = lerTrecho(corpo.analisar_de_s, corpo.analisar_ate_s, video.duracao_s);
  if (tr.erro) return json({ erro: tr.erro }, 400);
  if (tr.de === video.analisar_de_s && tr.ate === video.analisar_ate_s) return json({ ok: true, refez: null });

  const tarefas = await db(env).all(
    "SELECT id, tipo, estado FROM cortex_tarefas WHERE video_id = ? AND tipo IN ('texto', 'roteiro')", video.id);
  if (video.continuar_de_s !== null) return json({ erro: 'O "Puxar o resto" ainda está buscando a parte nova. Espere terminar para mudar o trecho.' }, 409);
  if (tarefas.some((t) => t.estado === 'pega')) {
    return json({ erro: 'O PC está trabalhando neste vídeo agora. Espere terminar, ou desligue o PC pelo atalho (ele devolve a tarefa) e tente de novo.' }, 409);
  }
  const auditoria = () => auditar(env, { quem: u.email, acao: 'mudar-trecho', entidade: 'cortex_videos', entidade_id: video.id,
    antes: { analisar_de_s: video.analisar_de_s, analisar_ate_s: video.analisar_ate_s }, depois: { analisar_de_s: tr.de, analisar_ate_s: tr.ate }, ip: data.ip });

  // Nada transcrito ainda: so grava (e uma falha da busca de texto volta para a fila).
  if (video.etapa === 'entrada') {
    await db(env).batch([
      ['UPDATE cortex_videos SET analisar_de_s = ?, analisar_ate_s = ?, erro = NULL, atualizado_em = ? WHERE id = ?', [tr.de, tr.ate, agora, video.id]],
      ["UPDATE cortex_tarefas SET estado = 'pendente', tentativas = 0, erro = NULL, atualizada_em = ? WHERE video_id = ? AND tipo = 'texto' AND estado = 'falhou'", [agora, video.id]],
    ]);
    await auditoria();
    return json({ ok: true, refez: null });
  }

  // O texto atual cobre o trecho novo? (texto completo e o trecho novo dentro do antigo)
  const textoFeito = tarefas.some((t) => t.tipo === 'texto' && t.estado === 'feita') && !tarefas.some((t) => t.tipo === 'texto' && t.estado !== 'feita');
  const cobreIni = (video.analisar_de_s || 0) <= (tr.de || 0);
  const cobreFim = video.analisar_ate_s === null || (tr.ate !== null && tr.ate <= video.analisar_ate_s);
  const so = textoFeito && cobreIni && cobreFim ? 'roteiro' : 'texto';

  if (!corpo.confirmado) {
    const ia = await db(env).first(
      "SELECT COUNT(*) AS n FROM cortex_cortes WHERE video_id = ? AND origem = 'ia' AND estado IN ('triagem', 'descartado')", video.id);
    const txt = (so === 'roteiro'
      ? 'O texto que já existe cobre esse trecho: só a IA lê de novo (a transcrição não é refeita).'
      : 'O PC busca o texto desse trecho de novo e a IA lê depois.') +
      (ia.n ? ` ${ia.n} corte(s) da IA ainda na triagem ou descartados saem; aprovados e manuais ficam.` : '');
    return json({ erro: 'confirmar', confirmar: txt, refaz: so }, 409);
  }

  const lotes = [
    ['UPDATE cortex_videos SET analisar_de_s = ?, analisar_ate_s = ?, etapa = ?, roteiro_de_s = NULL, erro = NULL, atualizado_em = ? WHERE id = ?',
      [tr.de, tr.ate, so === 'roteiro' ? 'roteiro' : 'entrada', agora, video.id]],
    ["DELETE FROM cortex_tarefas WHERE video_id = ? AND tipo IN ('texto', 'roteiro')", [video.id]],
    ['DELETE FROM cortex_roteiro_partes WHERE video_id = ?', [video.id]],
    ["DELETE FROM cortex_cortes WHERE video_id = ? AND origem = 'ia' AND estado IN ('triagem', 'descartado')", [video.id]],
  ];
  if (so === 'roteiro') {
    lotes.push(['DELETE FROM cortex_transcricao WHERE video_id = ? AND (fim_s <= ? OR inicio_s >= ?)',
      [video.id, tr.de || 0, tr.ate === null ? 1e9 : tr.ate]]);
  } else {
    lotes.push(['DELETE FROM cortex_transcricao WHERE video_id = ?', [video.id]]);
  }
  lotes.push([`INSERT INTO cortex_tarefas (usuario_id, tipo, video_id, criada_em, atualizada_em) VALUES (?, ?, ?, ?, ?)`,
    [u.id, so, video.id, agora, agora]]);
  await db(env).batch(lotes);
  await auditoria();
  return json({ ok: true, refez: so });
}

// ---------- "Puxar o resto" (18/11) ----------
// Live da Kick colada enquanto rolava: o texto foi ate capturado_ate_s. Aqui o PC busca so dali
// em diante (com 30 s de folga para nao cortar uma frase na divisa), o texto antigo fica, e a IA
// le so a parte nova. Os cortes que ja existem ficam como estao.
async function puxarResto({ env, data, u, id, json, agora }) {
  const video = await db(env).first('SELECT * FROM cortex_videos WHERE id = ? AND usuario_id = ?', Number(id), u.id);
  if (!video) return json({ erro: 'vídeo não encontrado' }, 404);
  if (!video.ao_vivo_canal) return json({ erro: 'Só vídeos importados pelo link da live (kick.com/canal) têm "Puxar o resto".' }, 400);
  if (video.continuar_de_s !== null) return json({ erro: 'Já está puxando o resto deste vídeo. Espere o texto novo chegar.' }, 409);
  if (!video.capturado_ate_s || !['roteiro', 'cortado'].includes(video.etapa)) {
    return json({ erro: 'Espere a primeira captura terminar (o texto chegar) antes de puxar o resto.' }, 409);
  }
  const ocupado = await db(env).first(
    "SELECT COUNT(*) AS n FROM cortex_tarefas WHERE video_id = ? AND tipo IN ('texto', 'roteiro') AND estado IN ('pega', 'pendente')", video.id);
  if (ocupado.n) return json({ erro: 'Este vídeo ainda tem trabalho na fila do PC (texto ou IA). Espere terminar e puxe o resto depois.' }, 409);
  const de = Math.max(0, video.capturado_ate_s - 30);
  await db(env).batch([
    ["UPDATE cortex_videos SET continuar_de_s = ?, analisar_ate_s = NULL, etapa = 'entrada', erro = NULL, arquivado = 0, atualizado_em = ? WHERE id = ?",
      [de, agora, video.id]],
    ["DELETE FROM cortex_tarefas WHERE video_id = ? AND tipo IN ('texto', 'roteiro') AND estado = 'falhou'", [video.id]],
    ["INSERT INTO cortex_tarefas (usuario_id, tipo, video_id, criada_em, atualizada_em) VALUES (?, 'texto', ?, ?, ?)", [u.id, video.id, agora, agora]],
  ]);
  await auditar(env, { quem: u.email, acao: 'puxar-resto', entidade: 'cortex_videos', entidade_id: video.id,
    antes: { capturado_ate_s: video.capturado_ate_s }, depois: { continuar_de_s: de }, ip: data.ip });
  return json({ ok: true, de });
}

// Situacao da tarefa mais recente de um video/corte, para o cartao dizer o que o PC esta fazendo.
function TAREFA_SQL(filtro) {
  const ult = `FROM cortex_tarefas t WHERE ${filtro} ORDER BY t.id DESC LIMIT 1`;
  return `(SELECT t.estado ${ult}) AS tarefa_estado,
          (SELECT t.progresso ${ult}) AS tarefa_progresso,
          (SELECT t.atualizada_em ${ult}) AS tarefa_atualizada,
          (SELECT a.nome FROM cortex_tarefas t JOIN cortex_agentes a ON a.id = t.agente_id WHERE ${filtro} AND t.estado = 'pega' ORDER BY t.id DESC LIMIT 1) AS tarefa_pc`;
}

async function listarAgentes(env, usuarioId) {
  const lista = await db(env).all(
    `SELECT id, nome, baixa_cortes, visto_em, versao, ferramentas, criado_em FROM cortex_agentes
      WHERE usuario_id = ? AND revogado_em IS NULL ORDER BY id`, usuarioId);
  for (const a of lista) {
    a.online = !!a.visto_em && Date.now() - Date.parse(a.visto_em) < PC_ONLINE_MS;
    a.desatualizado = !!a.versao && a.versao !== AGENTE_VERSAO;
    try { a.ferramentas = JSON.parse(a.ferramentas || '{}'); } catch { a.ferramentas = {}; }
  }
  return lista;
}

async function rotasAgentes({ request, env, data, u, id, metodo, json, agora }) {
  if (!id && metodo === 'GET') return json({ agentes: await listarAgentes(env, u.id), versao_atual: AGENTE_VERSAO });

  if (!id && metodo === 'POST') {
    const corpo = await request.json().catch(() => ({}));
    const nome = String(corpo.nome || '').trim().toUpperCase().slice(0, 40);
    if (!nome) return json({ erro: 'Dê um nome ao PC (ex.: CASA, TRABALHO).' }, 400);
    const repetido = await db(env).first(
      'SELECT id FROM cortex_agentes WHERE usuario_id = ? AND nome = ? AND revogado_em IS NULL', u.id, nome);
    if (repetido) return json({ erro: 'Já existe um PC com esse nome. Desconecte o antigo ou use outro nome.' }, 409);
    // A chave nasce aqui, vai UMA vez para a tela do dono e o banco guarda so o hash.
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const chave = 'cx_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const r = await db(env).run(
      'INSERT INTO cortex_agentes (usuario_id, nome, chave_hash, criado_em) VALUES (?, ?, ?, ?)',
      u.id, nome, await hashChave(chave), agora);
    await auditar(env, { quem: u.email, acao: 'conectar-pc', entidade: 'cortex_agentes', entidade_id: r.meta.last_row_id, depois: { nome }, ip: data.ip });
    return json({ ok: true, id: r.meta.last_row_id, nome, chave }, 201);
  }

  const ag = id && await db(env).first(
    'SELECT id, nome, baixa_cortes FROM cortex_agentes WHERE id = ? AND usuario_id = ? AND revogado_em IS NULL', Number(id), u.id);
  if (!ag) return json({ erro: 'PC não encontrado' }, 404);

  if (metodo === 'PATCH') {
    const corpo = await request.json().catch(() => ({}));
    const baixa = corpo.baixa_cortes ? 1 : 0;
    await db(env).run('UPDATE cortex_agentes SET baixa_cortes = ? WHERE id = ?', baixa, ag.id);
    await auditar(env, { quem: u.email, acao: 'editar', entidade: 'cortex_agentes', entidade_id: ag.id,
      antes: { baixa_cortes: ag.baixa_cortes }, depois: { baixa_cortes: baixa }, ip: data.ip });
    return json({ ok: true });
  }

  if (metodo === 'DELETE') {
    // Revoga (nao apaga): a linha fica para o historico das tarefas que esse PC fez.
    await db(env).batch([
      ['UPDATE cortex_agentes SET revogado_em = ? WHERE id = ?', [agora, ag.id]],
      ["UPDATE cortex_tarefas SET estado = 'pendente', agente_id = NULL, pega_ate = NULL, progresso = NULL WHERE agente_id = ? AND estado = 'pega'", [ag.id]],
    ]);
    await auditar(env, { quem: u.email, acao: 'desconectar-pc', entidade: 'cortex_agentes', entidade_id: ag.id, antes: { nome: ag.nome }, ip: data.ip });
    return json({ ok: true });
  }
  return json({ erro: 'rota nao encontrada' }, 404);
}

// ---------- link: qual plataforma, qual video ----------
// So aceita o que da para cortar: video gravado (VOD) ou clipe. Live em andamento entra
// depois que terminar, pelo link do VOD - antes disso nao existe minuto para baixar.
export function lerLink(bruto) {
  const txt = String(bruto || '').trim();
  if (!txt) return { erro: 'Cole o link do vídeo.' };
  let url;
  try { url = new URL(/^https?:\/\//i.test(txt) ? txt : 'https://' + txt); } catch { return { erro: 'Isso não parece um link.' }; }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
  const caminho = url.pathname.split('/').filter(Boolean);

  if (host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com') {
    let vid = null;
    if (host === 'youtu.be') vid = caminho[0];
    else if (caminho[0] === 'watch') vid = url.searchParams.get('v');
    else if (['live', 'shorts', 'embed'].includes(caminho[0])) vid = caminho[1];
    if (!vid || !/^[A-Za-z0-9_-]{11}$/.test(vid)) return { erro: 'Não achei o vídeo nesse link do YouTube. Use o link do vídeo (watch, youtu.be, live ou shorts).' };
    return { plataforma: 'youtube', id_externo: vid, url: 'https://www.youtube.com/watch?v=' + vid };
  }

  if (host === 'twitch.tv' || host === 'clips.twitch.tv') {
    if (caminho[0] === 'videos' && /^\d+$/.test(caminho[1] || '')) {
      return { plataforma: 'twitch', id_externo: 'v' + caminho[1], url: 'https://www.twitch.tv/videos/' + caminho[1] };
    }
    const clipe = host === 'clips.twitch.tv' ? caminho[0] : (caminho[1] === 'clip' ? caminho[2] : null);
    if (clipe && /^[A-Za-z0-9_-]+$/.test(clipe)) {
      return { plataforma: 'twitch', id_externo: 'c' + clipe, url: 'https://clips.twitch.tv/' + clipe };
    }
    return { erro: 'Na Twitch, cole o link do vídeo gravado (twitch.tv/videos/...) ou de um clipe. Live em andamento entra depois que terminar.' };
  }

  if (host === 'kick.com') {
    // kick.com/<canal>/videos/<uuid> ou kick.com/video/<uuid>; clipe: ?clip=clip_...
    const iv = caminho.indexOf('videos') >= 0 ? caminho.indexOf('videos') : caminho.indexOf('video');
    const uuid = iv >= 0 ? caminho[iv + 1] : null;
    if (uuid && /^[0-9a-f-]{36}$/i.test(uuid)) {
      return { plataforma: 'kick', id_externo: 'v' + uuid.toLowerCase(), url: 'https://kick.com/' + caminho.slice(0, iv + 2).join('/') };
    }
    const clipe = url.searchParams.get('clip') || (caminho[1] === 'clips' ? caminho[2] : null);
    if (clipe && /^clip_[A-Za-z0-9]+$/.test(clipe)) {
      return { plataforma: 'kick', id_externo: 'c' + clipe, url: 'https://kick.com/' + caminho[0] + '/clips/' + clipe };
    }
    // 18/11: link do canal (kick.com/<canal>) = a live que esta rolando agora. O id de verdade
    // (uuid do video gravado da live) quem descobre e o PC; ate la fica um id provisorio.
    const RESERVADOS = ['video', 'videos', 'categories', 'category', 'browse', 'following', 'search', 'dashboard', 'clips', 'settings', 'login', 'signup', 'about', 'privacy-policy', 'terms-of-service'];
    if (caminho.length === 1 && /^[A-Za-z0-9_-]{2,40}$/.test(caminho[0]) && !RESERVADOS.includes(caminho[0].toLowerCase())) {
      const canal = caminho[0].toLowerCase();
      return { plataforma: 'kick', id_externo: `live:${canal}:${Date.now()}`, url: 'https://kick.com/' + canal, ao_vivo_canal: canal };
    }
    return { erro: 'No Kick, cole o link da live (kick.com/canal), do vídeo gravado (kick.com/canal/videos/...) ou de um clipe.' };
  }

  return { erro: 'Por enquanto só YouTube, Twitch e Kick.' };
}

function validarCorte(c, video) {
  const tipo = c.tipo === 'longo' ? 'longo' : c.tipo === 'curto' ? 'curto' : null;
  if (!tipo) return { erro: 'Escolha o tipo: longo ou curto.' };
  const inicio = Math.round(Number(c.inicio_s));
  const fim = Math.round(Number(c.fim_s));
  if (!Number.isFinite(inicio) || !Number.isFinite(fim) || inicio < 0) return { erro: 'Início e fim inválidos.' };
  if (fim <= inicio) return { erro: 'O fim tem que vir depois do início.' };
  if (video.duracao_s && fim > video.duracao_s) return { erro: 'O fim passa da duração do vídeo.' };
  const [min, max] = DURACAO[tipo];
  const dur = fim - inicio;
  if (dur < min || dur > max) return { erro: `Corte ${tipo} precisa ter entre ${fmt(min)} e ${fmt(max)} (este tem ${fmt(dur)}).` };
  const titulo = String(c.titulo || '').trim().slice(0, 150);
  if (!titulo) return { erro: 'Dê um título ao corte.' };
  const tags = (Array.isArray(c.tags) ? c.tags : String(c.tags || '').split(','))
    .map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 30);
  // Tempo do gancho (15/11): opcional; se vier, os dois juntos e dentro do corte.
  const vazio = (x) => x === undefined || x === null || x === '';
  let gi = null, gf = null;
  if (!vazio(c.gancho_inicio_s) || !vazio(c.gancho_fim_s)) {
    gi = Math.round(Number(c.gancho_inicio_s)); gf = Math.round(Number(c.gancho_fim_s));
    if (vazio(c.gancho_inicio_s) || vazio(c.gancho_fim_s) || !Number.isFinite(gi) || !Number.isFinite(gf)) return { erro: 'Preencha os dois tempos do gancho (ou deixe os dois vazios).' };
    if (gf <= gi) return { erro: 'O fim do gancho tem que vir depois do início dele.' };
    if (gi < inicio || gf > fim) return { erro: 'O gancho tem que ficar dentro do corte.' };
  }
  return {
    gancho_inicio_s: gi, gancho_fim_s: gf,
    tipo, inicio_s: inicio, fim_s: fim, titulo, tags,
    descricao: c.descricao ? String(c.descricao).slice(0, 5000) : null,
    gancho: c.gancho ? String(c.gancho).slice(0, 300) : null,
  };
}

function lerTags(t) { try { const a = JSON.parse(t || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }

function fmt(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + 'h' : '') + (m ? m + 'min' : '') + (x || (!h && !m) ? x + 's' : '');
}
