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
//   POST   /videos/:id/continuar   { ate_s? } "Puxar o resto" de uma live da Kick (18/11) ou de video gravado analisado em parte (19/11): so a parte nova,
//                                   ate ate_s (vazio = ate o fim; 18/11: puxar de 2 em 2 h)
//   GET    /videos/:id             video + todos os cortes (linha do tempo)
//   PATCH  /videos/:id             { titulo?, arquivado?, layout_id? }  layout_id = padrao dos curtos do video  arquivado = "Concluir video" (sai do quadro)
//   GET    /concluidos             videos concluidos (arquivados), para reabrir
//   DELETE /videos/:id             apaga video, transcricao, cortes e tarefas
//   POST   /cortes                 { video_id, tipo, inicio_s, fim_s, titulo, ... } corte manual
//   PATCH  /cortes/:id             { layout_id? (so curto; null = o do video, 0 = nenhum), estado?, titulo?, descricao?, tags?, gancho?, gancho_inicio_s?, gancho_fim_s?, inicio_s?, fim_s? }
//   DELETE /cortes/:id
//   POST   /videos/:id/tentar | /cortes/:id/tentar   devolve a tarefa que falhou para a fila
//   POST   /cortes/:id/ficha       corte aprovado sem baixar: o PC grava (de novo) a ficha .txt (18/11)
//   POST   /cortes/:id/foto        tirar de novo a foto do curto (cena + previa do vertical) (19/11)
//   GET    /quadros/:corte_id      a foto do curto (JPEG do R2), para a gaveta
//   GET    /cortes/:id/legenda     palavras da legenda do curto (para revisar) + se esta na fila do PC (19/11)
//   POST   /cortes/:id/legenda     pede ao PC a transcricao do trecho (so o audio) para revisar antes de baixar
//   PUT    /cortes/:id/legenda     { palavras: [{ p, i, f }] } grava o texto corrigido pelo dono
//   POST   /cortes/:id/textos      a IA refaz título (3 opções), descrição, tags e thumbnail (não grava)
//   GET/PUT/DELETE /logo  (+ GET /logo/info)  logo do canal no R2, gravada nos verticais (19/11)
//   GET    /layouts                layouts verticais (9:16) dos curtos; cria os 4 iniciais na 1a vez (19/11)
//   POST   /layouts  PATCH/DELETE /layouts/:id    o editor de layout (tela "Layouts")
//   GET    /agentes                lista os PCs conectados
//   POST   /agentes                { nome } -> gera a chave do PC (mostrada UMA vez)
//   PATCH  /agentes/:id            { baixa_cortes?, pasta? }  pasta dos cortes desse PC (18/11)
//   DELETE /agentes/:id            desconecta (revoga a chave)
//
// As rotas do proprio PC (sem sessao, com a chave dele) ficam em maquina.js.
//
// Etapa 2 (agente do PC) e etapa 3 (roteiro com o Gemini gratis, roteiro.js); ver a ficha.
// Autoria: Claude (Opus 5.5), Lab Hub, 14/11/2026.

import { db } from '../../lib/db.js';
import { auditar } from '../../lib/audit.js';
import { hashChave, AGENTE_VERSAO } from './maquina.js';
import { refazerTextos, classificarCorte } from './roteiro.js';
import { pedirFotos, apagarFotos } from './cena.js';
import { arquivos, temDeposito, chaveDe } from '../../lib/arquivos.js';

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
    const [videos, cortes, pc, fila] = await Promise.all([
      db(env).all(
        `SELECT v.id, v.url, v.plataforma, v.titulo, v.canal, v.duracao_s, v.etapa, v.erro, v.criado_em, v.atualizado_em,
                v.analisar_de_s, v.analisar_ate_s, v.ao_vivo_canal, v.ao_vivo, v.capturado_ate_s, v.continuar_de_s, v.layout_id,
                (SELECT COUNT(*) FROM cortex_cortes c WHERE c.video_id = v.id AND c.estado <> 'descartado') AS cortes,
                ${TAREFA_SQL('t.video_id = v.id AND t.tipo IN (\'texto\', \'roteiro\')')}
           FROM cortex_videos v WHERE v.usuario_id = ? AND v.arquivado = 0
          ORDER BY v.atualizado_em DESC LIMIT 300`, u.id),
      db(env).all(
        `SELECT c.id, c.video_id, c.tipo, c.origem, c.inicio_s, c.fim_s, c.titulo, c.gancho, c.gancho_inicio_s, c.nota, c.categoria, c.estado,
                c.erro, c.qualidade, c.baixar_fora, c.cena, c.cena_conf, c.cena_auto, c.quadro_em, c.layout_id, c.legenda IS NOT NULL AS tem_legenda, c.legenda_editada, v.layout_id AS video_layout_id, c.atualizado_em, v.titulo AS video_titulo, v.plataforma,
                ${TAREFA_SQL('t.corte_id = c.id AND t.tipo = \'baixar_corte\'')}
           FROM cortex_cortes c JOIN cortex_videos v ON v.id = c.video_id
          WHERE c.usuario_id = ? AND c.estado <> 'descartado' AND v.arquivado = 0
          ORDER BY c.atualizado_em DESC LIMIT 500`, u.id),
      listarAgentes(env, u.id),
      // 22/11: a fila do PC (só o que está pendente ou em andamento), para o cartão dizer quantas
      // tarefas estão na frente. Usa o índice idx_cortex_tarefas_fila (usuario_id, estado, id).
      db(env).all(
        `SELECT id, tipo, video_id, corte_id, estado FROM cortex_tarefas
          WHERE usuario_id = ? AND estado IN ('pendente', 'pega') ORDER BY id LIMIT 500`, u.id),
    ]);
    const online = pc.filter((a) => a.online);
    return json({ videos, cortes, fila, pc: {
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

  // 19/11: foto do curto (guardada no R2 pelo /maquina/.../quadro). Só o dono vê.
  if (rota === 'quadros' && id && metodo === 'GET') {
    const c = await db(env).first('SELECT quadro_chave FROM cortex_cortes WHERE id = ? AND usuario_id = ?', Number(id), u.id);
    if (!c || !c.quadro_chave || !temDeposito(env)) return json({ erro: 'sem foto' }, 404);
    const obj = await arquivos(env).ler(c.quadro_chave);
    if (!obj) return json({ erro: 'sem foto' }, 404);
    return new Response(obj.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' } });
  }

  if (rota === 'cortes' && id && partes[2] === 'foto' && metodo === 'POST') {
    const c = await db(env).first('SELECT id, video_id, tipo, estado FROM cortex_cortes WHERE id = ? AND usuario_id = ?', Number(id), u.id);
    if (!c) return json({ erro: 'corte não encontrado' }, 404);
    if (c.tipo !== 'curto' || c.estado !== 'triagem') return json({ erro: 'A foto é só para corte curto na Triagem (é lá que se escolhe o layout).' }, 400);
    await db(env).batch([
      ['UPDATE cortex_cortes SET quadro_em = NULL WHERE id = ?', [c.id]],
      pedirFotos(u.id, c.video_id, agora),
    ]);
    await auditar(env, { quem: u.email, acao: 'foto-de-novo', entidade: 'cortex_cortes', entidade_id: c.id, ip: data.ip });
    return json({ ok: true });
  }

  // 19/11: logo do canal (uma por conta), no R2. O corpo é a imagem CRUA (PNG já reduzido na tela),
  // com largura/altura na URL - nada de base64 em JSON (regra da base).
  if (rota === 'logo') {
    const atual = await db(env).first('SELECT logo_chave, largura, altura, atualizado_em FROM cortex_marca WHERE usuario_id = ?', u.id);
    if (metodo === 'GET' && !id) {
      if (!atual || !temDeposito(env)) return json({ erro: 'sem logo' }, 404);
      const obj = await arquivos(env).ler(atual.logo_chave);
      if (!obj) return json({ erro: 'sem logo' }, 404);
      return new Response(obj.body, { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=600' } });
    }
    if (metodo === 'GET' && id === 'info') return json({ logo: atual ? { largura: atual.largura, altura: atual.altura, em: atual.atualizado_em } : null });
    if (metodo === 'PUT') {
      if (!temDeposito(env)) return json({ erro: 'O depósito de arquivos (R2) não está ligado.' }, 503);
      const url = new URL(request.url);
      const largura = Math.round(Number(url.searchParams.get('largura'))), altura = Math.round(Number(url.searchParams.get('altura')));
      if (!(largura >= 16 && largura <= 2000 && altura >= 16 && altura <= 2000)) return json({ erro: 'Tamanho da imagem inválido.' }, 400);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (!bytes.length || bytes.length > 2 * 1024 * 1024) return json({ erro: 'A logo precisa ter até 2 MB.' }, 413);
      if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) return json({ erro: 'Mande a logo em PNG.' }, 400);
      const chave = chaveDe(u.id, 0, 'cortex-logo.png');
      await arquivos(env).guardar(chave, bytes, { tipo: 'image/png' });
      await db(env).run(
        `INSERT INTO cortex_marca (usuario_id, logo_chave, largura, altura, atualizado_em) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (usuario_id) DO UPDATE SET logo_chave = excluded.logo_chave, largura = excluded.largura, altura = excluded.altura, atualizado_em = excluded.atualizado_em`,
        u.id, chave, largura, altura, agora);
      await auditar(env, { quem: u.email, acao: atual ? 'trocar-logo' : 'enviar-logo', entidade: 'cortex_marca', entidade_id: u.id, depois: { largura, altura, bytes: bytes.length }, ip: data.ip });
      return json({ ok: true, logo: { largura, altura, em: agora } });
    }
    if (metodo === 'DELETE') {
      if (!atual) return json({ ok: true });
      // apagou a linha, apaga o objeto na mesma ação (regra da base); os layouts deixam de usar
      if (temDeposito(env)) await arquivos(env).apagar(atual.logo_chave);
      await db(env).batch([
        ['DELETE FROM cortex_marca WHERE usuario_id = ?', [u.id]],
        ['UPDATE cortex_layouts SET logo_on = 0 WHERE usuario_id = ?', [u.id]],
      ]);
      await auditar(env, { quem: u.email, acao: 'excluir-logo', entidade: 'cortex_marca', entidade_id: u.id, ip: data.ip });
      return json({ ok: true });
    }
    return json({ erro: 'método não permitido' }, 405);
  }

  if (rota === 'layouts') return await rotasLayouts({ request, env, data, u, id, metodo, json, agora });

  if (rota === 'agentes') return await rotasAgentes({ request, env, data, u, id, metodo, json, agora });

  if ((rota === 'videos' || rota === 'cortes') && id && partes[2] === 'tentar' && metodo === 'POST') {
    const campo = rota === 'videos' ? 'video_id' : 'corte_id';
    const tabela = rota === 'videos' ? 'cortex_videos' : 'cortex_cortes';
    const dono = await db(env).first(`SELECT id FROM ${tabela} WHERE id = ? AND usuario_id = ?`, Number(id), u.id);
    if (!dono) return json({ erro: 'não encontrado' }, 404);
    const filtroTipo = rota === 'videos' ? " AND tipo IN ('texto', 'roteiro')" : " AND tipo = 'baixar_corte'";
    const r = await db(env).run(
      `UPDATE cortex_tarefas SET estado = 'pendente', tentativas = 0, erro = NULL, atualizada_em = ?
        WHERE ${campo} = ? AND estado = 'falhou'${filtroTipo}`, agora, dono.id);
    if (!r.meta.changes) return json({ erro: 'Não há falha para tentar de novo.' }, 409);
    await db(env).run(`UPDATE ${tabela} SET erro = NULL, atualizado_em = ? WHERE id = ?`, agora, dono.id);
    await auditar(env, { quem: u.email, acao: 'tentar-de-novo', entidade: tabela, entidade_id: dono.id, ip: data.ip });
    return json({ ok: true });
  }

  if (rota === 'videos' && id && partes[2] === 'continuar' && metodo === 'POST') {
    return await puxarResto({ request, env, data, u, id, json, agora });
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
      // 19/11: a legenda (palavra a palavra, ~10 KB por corte) não vem aqui: numa live de 10 h com
      // muitos cortes isso pesava a resposta. A gaveta busca a de UM corte em /cortes/:id/legenda.
      for (const c of cortes) { c.tags = lerTags(c.tags); c.tem_legenda = c.legenda ? 1 : 0; delete c.legenda; }
      return json({ video, cortes });
    }

    if (metodo === 'PATCH') {
      const corpo = await request.json().catch(() => ({}));
      const titulo = corpo.titulo !== undefined ? String(corpo.titulo).trim().slice(0, 200) || null : video.titulo;
      const arquivado = corpo.arquivado !== undefined ? (corpo.arquivado ? 1 : 0) : video.arquivado;
      // 19/11: contexto da live (quem participa, o que está rolando) - vai para a IA e para a legenda
      const contexto = corpo.contexto !== undefined ? String(corpo.contexto || '').replace(/\s+\n/g, '\n').trim().slice(0, 1500) || null : video.contexto;
      let layoutId = video.layout_id;
      if (corpo.layout_id !== undefined) {
        layoutId = corpo.layout_id === null || corpo.layout_id === '' ? null : Number(corpo.layout_id);
        if (layoutId !== null && !(await layoutDoDono(env, u.id, layoutId))) return json({ erro: 'layout não encontrado' }, 404);
      }
      // Concluir com corte na fila do PC deixaria um download orfao, fora do quadro.
      if (arquivado && !video.arquivado) {
        const fila = await db(env).first(
          "SELECT COUNT(*) AS n FROM cortex_cortes WHERE video_id = ? AND estado = 'download'", video.id);
        if (fila.n) return json({ erro: `Tem ${fila.n} corte(s) na fila do PC. Espere baixar ou cancele antes de concluir.` }, 409);
        // 19/11: concluido nao precisa mais das fotos (reabrindo, "Tirar foto de novo" refaz).
        await apagarFotos(env, 'video_id = ?', [video.id]);
        await db(env).run('UPDATE cortex_cortes SET quadro_chave = NULL, quadro_em = NULL WHERE video_id = ?', video.id);
      }
      await db(env).run('UPDATE cortex_videos SET titulo = ?, arquivado = ?, layout_id = ?, contexto = ?, atualizado_em = ? WHERE id = ?',
        titulo, arquivado, layoutId, contexto, agora, video.id);
      // Reaberto: as fotos tinham saido ao concluir; o PC tira de novo as dos curtos na Triagem.
      if (!arquivado && video.arquivado) await db(env).batch([pedirFotos(u.id, video.id, agora)]);
      await auditar(env, { quem: u.email, acao: 'editar', entidade: 'cortex_videos', entidade_id: video.id,
        antes: { titulo: video.titulo, arquivado: video.arquivado, layout_id: video.layout_id }, depois: { titulo, arquivado, layout_id: layoutId, contexto: contexto !== video.contexto ? 'alterado' : undefined }, ip: data.ip });
      return json({ ok: true });
    }

    if (metodo === 'DELETE') {
      await apagarFotos(env, 'video_id = ?', [video.id]);
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
    // 19/11: layout vertical (so curto): null = o do video, 0 = nenhum
    let layoutId = c.tipo === 'curto' && corpo.layout_id !== undefined && corpo.layout_id !== '' ? corpo.layout_id : null;
    if (layoutId !== null) {
      layoutId = Number(layoutId);
      if (layoutId !== 0 && !(await layoutDoDono(env, u.id, layoutId))) return json({ erro: 'layout não encontrado' }, 404);
    }
    const r = await db(env).run(
      `INSERT INTO cortex_cortes (video_id, usuario_id, tipo, origem, inicio_s, fim_s, titulo, descricao, tags, gancho,
                                  gancho_inicio_s, gancho_fim_s, layout_id, estado, criado_em, atualizado_em)
       VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'triagem', ?, ?)`,
      video.id, u.id, c.tipo, c.inicio_s, c.fim_s, c.titulo, c.descricao, JSON.stringify(c.tags), c.gancho,
      c.gancho_inicio_s, c.gancho_fim_s, layoutId, agora, agora);
    if (c.tipo === 'curto') await db(env).batch([pedirFotos(u.id, video.id, agora)]);   // 19/11: foto + cena
    await auditar(env, { quem: u.email, acao: 'criar', entidade: 'cortex_cortes', entidade_id: r.meta.last_row_id, depois: c, ip: data.ip });
    return json({ ok: true, id: r.meta.last_row_id }, 201);
  }

  // 19/11: "Refazer textos" - a IA reescreve título (3 opções), descrição, tags e thumbnail deste
  // corte no padrão do canal. Só DEVOLVE: o dono revisa na gaveta e decide se salva.
  if (rota === 'cortes' && id && partes[2] === 'textos' && metodo === 'POST') {
    const c = await db(env).first('SELECT * FROM cortex_cortes WHERE id = ? AND usuario_id = ?', Number(id), u.id);
    if (!c) return json({ erro: 'corte não encontrado' }, 404);
    const v = await db(env).first('SELECT id, titulo, canal, plataforma, contexto FROM cortex_videos WHERE id = ?', c.video_id);
    try {
      const tx = await refazerTextos(env, c, v);
      await auditar(env, { quem: u.email, acao: 'refazer-textos', entidade: 'cortex_cortes', entidade_id: c.id, ip: data.ip });
      return json({ ok: true, ...tx });
    } catch (e) {
      return json({ erro: e.esperar_s ? 'O Gemini grátis está no limite agora. Tente de novo em ' + Math.ceil(e.esperar_s / 60) + ' min.' : String(e.message || e).slice(0, 300) }, e.esperar_s ? 429 : 502);
    }
  }

  // 21/11: "Classificar com a IA" - corte de antes da categoria existir ganha categoria, motivo,
  // acontecimento, critérios e a nota calculada. Não mexe em título, tempo, legenda nem arquivo.
  // A nota "no olho" de antes fica guardada em nota_antiga (só na 1ª classificação).
  if (rota === 'cortes' && id && partes[2] === 'classificar' && metodo === 'POST') {
    const c = await db(env).first('SELECT * FROM cortex_cortes WHERE id = ? AND usuario_id = ?', Number(id), u.id);
    if (!c) return json({ erro: 'corte não encontrado' }, 404);
    const v = await db(env).first('SELECT id, titulo, canal, plataforma, contexto FROM cortex_videos WHERE id = ?', c.video_id);
    let cl;
    try {
      cl = await classificarCorte(env, c, v);
    } catch (e) {
      return json({ erro: e.esperar_s ? 'O Gemini grátis está no limite agora. Tente de novo em ' + Math.ceil(e.esperar_s / 60) + ' min.' : String(e.message || e).slice(0, 300) }, e.esperar_s ? 429 : 502);
    }
    const agora = new Date().toISOString();
    await db(env).run(
      `UPDATE cortex_cortes SET categoria = ?, categoria_porque = ?, acontecimento = ?, criterios = ?, limitacao = ?,
              nota_antiga = CASE WHEN criterios IS NULL AND nota_antiga IS NULL THEN nota ELSE nota_antiga END, nota = ?, atualizado_em = ?
        WHERE id = ?`,
      cl.categoria, cl.categoria_porque, cl.acontecimento, cl.criterios, cl.limitacao, cl.nota, agora, c.id);
    await auditar(env, { quem: u.email, acao: 'classificar', entidade: 'cortex_cortes', entidade_id: c.id,
      antes: { categoria: c.categoria, nota: c.nota }, depois: { categoria: cl.categoria, nota: cl.nota }, ip: data.ip });
    return json({ ok: true, ...cl });
  }

  // 19/11: legenda do curto revisada no painel antes de baixar (pedido do dono: o Whisper erra nomes).
  if (rota === 'cortes' && id && partes[2] === 'legenda') {
    const c = await db(env).first(
      `SELECT c.id, c.video_id, c.tipo, c.estado, c.baixar_fora, c.inicio_s, c.fim_s, c.legenda, c.legenda_em, c.legenda_editada, c.legenda_erro
         FROM cortex_cortes c WHERE c.id = ? AND c.usuario_id = ?`, Number(id), u.id);
    if (!c) return json({ erro: 'corte não encontrado' }, 404);
    const naFila = async () => (await db(env).first(
      "SELECT estado, progresso FROM cortex_tarefas WHERE corte_id = ? AND tipo = 'legenda' AND estado IN ('pendente', 'pega') ORDER BY id DESC LIMIT 1", c.id)) || null;
    if (metodo === 'GET') {
      let palavras = null;
      try { palavras = c.legenda ? JSON.parse(c.legenda) : null; } catch { palavras = null; }
      return json({ palavras, editada: !!c.legenda_editada, em: c.legenda_em, erro: c.legenda_erro, tarefa: await naFila() });
    }
    if (c.tipo !== 'curto' || c.baixar_fora || !['triagem', 'edicao'].includes(c.estado)) {
      return json({ erro: 'A legenda é do corte curto, na Triagem ou na Edição (antes de publicar).' }, 400);
    }
    if (metodo === 'POST') {
      if (await naFila()) return json({ ok: true, ja: true });
      await db(env).batch([
        ['UPDATE cortex_cortes SET legenda_erro = NULL WHERE id = ?', [c.id]],
        [`INSERT INTO cortex_tarefas (usuario_id, tipo, video_id, corte_id, criada_em, atualizada_em) VALUES (?, 'legenda', ?, ?, ?, ?)`,
          [u.id, c.video_id, c.id, agora, agora]],
      ]);
      await auditar(env, { quem: u.email, acao: 'pedir-legenda', entidade: 'cortex_cortes', entidade_id: c.id, ip: data.ip });
      return json({ ok: true });
    }
    if (metodo === 'PUT') {
      const corpo = await request.json().catch(() => ({}));
      const lim = c.fim_s - c.inicio_s + 5;
      const lista = Array.isArray(corpo.palavras) ? corpo.palavras : null;
      if (!lista || !lista.length || lista.length > 3000) return json({ erro: 'Legenda vazia ou grande demais.' }, 400);
      const palavras = [];
      for (const w of lista) {
        const p = String((w && w.p) || '').replace(/[{}\\]/g, '').trim().slice(0, 40);
        const i = Math.round(Number(w && w.i) * 100) / 100, f = Math.round(Number(w && w.f) * 100) / 100;
        if (!p) continue;
        if (!Number.isFinite(i) || !Number.isFinite(f) || i < 0 || f < i || f > lim) return json({ erro: 'Tempo de palavra fora do corte.' }, 400);
        palavras.push({ p, i, f });
      }
      if (!palavras.length) return json({ erro: 'Legenda vazia.' }, 400);
      await db(env).run('UPDATE cortex_cortes SET legenda = ?, legenda_em = ?, legenda_editada = 1, legenda_erro = NULL WHERE id = ?',
        JSON.stringify(palavras), agora, c.id);
      await auditar(env, { quem: u.email, acao: 'corrigir-legenda', entidade: 'cortex_cortes', entidade_id: c.id,
        depois: { palavras: palavras.length }, ip: data.ip });
      return json({ ok: true, palavras: palavras.length });
    }
    return json({ erro: 'método não permitido' }, 405);
  }

  if (rota === 'cortes' && id && partes[2] === 'ficha' && metodo === 'POST') {
    const corte = await db(env).first('SELECT id, video_id, estado, baixar_fora FROM cortex_cortes WHERE id = ? AND usuario_id = ?', Number(id), u.id);
    if (!corte) return json({ erro: 'corte não encontrado' }, 404);
    if (!corte.baixar_fora || !['edicao', 'publicado'].includes(corte.estado)) return json({ erro: 'A ficha avulsa é só para corte aprovado sem baixar (quem baixa pelo PC já ganha o .txt junto).' }, 400);
    const pega = await db(env).first("SELECT id FROM cortex_tarefas WHERE corte_id = ? AND tipo = 'baixar_corte' AND estado = 'pega'", corte.id);
    if (pega) return json({ erro: 'O PC já está gravando a ficha desse corte.' }, 409);
    await db(env).batch(fichaNaFila(u.id, corte, agora));
    await auditar(env, { quem: u.email, acao: 'ficha-no-pc', entidade: 'cortex_cortes', entidade_id: corte.id, ip: data.ip });
    return json({ ok: true });
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
      // 19/11: layout vertical, so para CURTO (null = o do video, 0 = nenhum, n = um layout).
      let layoutId = corte.layout_id;
      if (corpo.layout_id !== undefined) {
        layoutId = corpo.layout_id === null || corpo.layout_id === '' ? null : Number(corpo.layout_id);
        if (layoutId !== null && layoutId !== 0 && !(await layoutDoDono(env, u.id, layoutId))) return json({ erro: 'layout não encontrado' }, 404);
      }
      if (novo.tipo !== 'curto') layoutId = null;           // longo nao tem vertical
      // 19/11: escolha a mao vence a cena detectada (cena_auto = 0: a proxima foto nao troca mais).
      if (layoutId !== corte.layout_id) extras.push(['UPDATE cortex_cortes SET layout_id = ?, cena_auto = 0 WHERE id = ?', [layoutId, corte.id]]);
      // Curto na Triagem com tempo novo: a foto antiga pode ser de outra cena; o PC tira outra.
      // 19/11: opções de título / porquê / thumbnail vindas do "Refazer textos" (o dono salvou)
      if (corpo.titulos !== undefined) {
        const ts = Array.isArray(corpo.titulos) ? corpo.titulos.map((t) => String(t).trim().slice(0, 120)).filter(Boolean).slice(0, 3) : [];
        extras.push(['UPDATE cortex_cortes SET titulos = ?, titulo_porque = ?, thumb = ?, duvida = ? WHERE id = ?',
          [ts.length ? JSON.stringify(ts) : null, corpo.titulo_porque ? String(corpo.titulo_porque).slice(0, 400) : null,
           corpo.thumb ? String(corpo.thumb).slice(0, 800) : null, corpo.duvida ? String(corpo.duvida).slice(0, 300) : null, corte.id]]);
        if (corpo.motivo) extras.push(['UPDATE cortex_cortes SET motivo = ? WHERE id = ?', [String(corpo.motivo).slice(0, 400), corte.id]]);
      }
      // 21/11: o dono troca a categoria à mão (a escolha dele vence a da IA; motivo fica o da IA).
      if (corpo.categoria !== undefined && corpo.categoria !== corte.categoria) {
        const CATS = ['hype', 'engracado', 'epico', 'curiosidade', 'reacao', 'polemica', 'historia', 'bastidores', 'outro'];
        if (corpo.categoria !== null && !CATS.includes(corpo.categoria)) return json({ erro: 'categoria inválida' }, 400);
        extras.push(['UPDATE cortex_cortes SET categoria = ? WHERE id = ?', [corpo.categoria, corte.id]]);
      }
      // 19/11: tempo novo = a legenda revisada deixa de bater (as palavras contam do início do corte).
      // 23/11: só o começo andou para a frente ("Começar no gancho"): a legenda é deslocada em vez de
      // apagada, para não perder as correções do dono (palavras que ficaram antes do novo começo saem).
      const corta = novo.tipo === 'curto' && novo.fim_s === corte.fim_s && novo.inicio_s > corte.inicio_s;
      if (corte.legenda && corta) {
        let lista = [];
        try { lista = JSON.parse(corte.legenda) || []; } catch { lista = []; }
        const d = novo.inicio_s - corte.inicio_s;
        const desloc = lista.filter((w) => Number(w.f) > d).map((w) => ({
          p: w.p, i: Math.max(0, Math.round((Number(w.i) - d) * 100) / 100), f: Math.round((Number(w.f) - d) * 100) / 100 }));
        extras.push(desloc.length
          ? ['UPDATE cortex_cortes SET legenda = ? WHERE id = ?', [JSON.stringify(desloc), corte.id]]
          : ['UPDATE cortex_cortes SET legenda = NULL, legenda_em = NULL, legenda_editada = 0 WHERE id = ?', [corte.id]]);
      } else if (corte.legenda && (novo.inicio_s !== corte.inicio_s || novo.fim_s !== corte.fim_s || novo.tipo !== 'curto')) {
        extras.push(['UPDATE cortex_cortes SET legenda = NULL, legenda_em = NULL, legenda_editada = 0 WHERE id = ?', [corte.id]]);
      }
      if (novo.tipo === 'curto' && corte.estado === 'triagem' && (novo.inicio_s !== corte.inicio_s || novo.fim_s !== corte.fim_s)) {
        extras.push(['UPDATE cortex_cortes SET quadro_em = NULL WHERE id = ?', [corte.id]], pedirFotos(u.id, corte.video_id, agora));
      }
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
          // (uma ficha de "sem baixar" ainda na fila sai: o download grava o .txt junto)
          extras.push(["DELETE FROM cortex_tarefas WHERE corte_id = ? AND estado IN ('pendente', 'falhou')", [corte.id]]);
          extras.push([`INSERT INTO cortex_tarefas (usuario_id, tipo, video_id, corte_id, criada_em, atualizada_em)
                        VALUES (?, 'baixar_corte', ?, ?, ?, ?)`, [u.id, corte.video_id, corte.id, agora, agora]]);
        } else if (corte.estado === 'download') {
          const pega = await db(env).first(
            "SELECT id FROM cortex_tarefas WHERE corte_id = ? AND tipo = 'baixar_corte' AND estado = 'pega'", corte.id);
          if (pega) return json({ erro: 'O PC já está baixando esse corte. Espere terminar.' }, 409);
          extras.push(["DELETE FROM cortex_tarefas WHERE corte_id = ? AND estado IN ('pendente', 'falhou')", [corte.id]]);
        }
      }
      // baixar_fora: aprovado sem o PC (triagem -> edicao). Volta a 0 quando o PC passa a baixar.
      const baixarFora = estado === 'edicao' && corte.estado === 'triagem' ? 1
        : estado === 'download' || estado === 'triagem' ? 0 : corte.baixar_fora;
      // 18/11: aprovado sem baixar ganha a FICHA no PC (.txt com título, gancho, descrição, tags e
      // os tempos para baixar por fora), na mesma pasta dos cortes. Nasce na aprovação e é refeita
      // quando o que está nela muda. Tarefa 'baixar_corte' de corte com baixar_fora = 1 = o PC grava
      // só o .txt (agente 1.9.0+; o mais velho nem recebe).
      const tagsAntes = JSON.stringify(lerTags(corte.tags));
      const mudouFicha = ['tipo', 'inicio_s', 'fim_s', 'titulo', 'descricao', 'gancho', 'gancho_inicio_s', 'gancho_fim_s']
        .some((k) => (novo[k] ?? null) !== (corte[k] ?? null)) || JSON.stringify(novo.tags) !== tagsAntes;
      if (baixarFora && estado === 'edicao' && (corte.estado === 'triagem' || mudouFicha)) {
        extras.push(...fichaNaFila(u.id, corte, agora));
      } else if (corte.baixar_fora && estado !== corte.estado && !['edicao', 'download'].includes(estado)) {
        extras.push(["DELETE FROM cortex_tarefas WHERE corte_id = ? AND estado IN ('pendente', 'falhou')", [corte.id]]);
      }
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
      await apagarFotos(env, 'id = ?', [corte.id]);
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

  await apagarFotos(env, "video_id = ? AND origem = 'ia' AND estado IN ('triagem', 'descartado')", [video.id]);
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
async function puxarResto({ request, env, data, u, id, json, agora }) {
  const video = await db(env).first('SELECT * FROM cortex_videos WHERE id = ? AND usuario_id = ?', Number(id), u.id);
  if (!video) return json({ erro: 'vídeo não encontrado' }, 404);
  // 19/11: vale também para vídeo GRAVADO analisado só em parte (live de 10 h: 2 h, depois mais 2 h...).
  // Onde parou: a captura (live) ou o "até" do trecho analisado.
  const cap = video.capturado_ate_s || video.analisar_ate_s || null;
  if (!video.ao_vivo_canal && (!cap || (video.duracao_s && cap >= video.duracao_s - 60))) {
    return json({ erro: 'Esse vídeo já foi analisado até o fim. Para ler outro pedaço, mude o trecho ("Analisar a partir de").' }, 409);
  }
  if (video.continuar_de_s !== null) return json({ erro: 'Já está puxando o resto deste vídeo. Espere o texto novo chegar.' }, 409);
  // So depois do roteiro pronto: puxar com a IA parada no meio faria a parte antiga ficar sem
  // leitura (a IA passa a ler so a parte nova). 18/11, achado no 1o teste do dono (Gemini 503).
  if (!cap || video.etapa !== 'cortado') {
    return json({ erro: video.etapa === 'roteiro'
      ? 'A IA ainda não terminou de ler a parte já capturada. Termine o roteiro (ou use "Tentar de novo" se falhou) e depois puxe o resto.'
      : 'Espere a primeira captura terminar (o texto chegar) antes de puxar o resto.' }, 409);
  }
  const ocupado = await db(env).first(
    "SELECT COUNT(*) AS n FROM cortex_tarefas WHERE video_id = ? AND tipo IN ('texto', 'roteiro') AND estado IN ('pega', 'pendente')", video.id);
  if (ocupado.n) return json({ erro: 'Este vídeo ainda tem trabalho na fila do PC (texto ou IA). Espere terminar e puxe o resto depois.' }, 409);
  if (!video.ao_vivo && video.duracao_s && cap >= video.duracao_s - 60) {
    return json({ erro: 'Esse vídeo já foi puxado até o fim (a live tinha terminado na última captura).' }, 409);
  }
  // 18/11: "ate" opcional (puxar mais 2 h, depois mais 2 h...). Vazio = ate o fim.
  const corpo = await request.json().catch(() => ({}));
  let ate = corpo.ate_s === undefined || corpo.ate_s === null || corpo.ate_s === '' ? null : Math.round(Number(corpo.ate_s));
  if (ate !== null && (!Number.isFinite(ate) || ate - cap < 120)) {
    return json({ erro: `O "até" precisa ser pelo menos 2 min depois de ${fmt(cap)} (onde a última captura parou).` }, 400);
  }
  if (ate !== null && !video.ao_vivo && video.duracao_s && ate >= video.duracao_s) ate = null;   // passou do fim = ate o fim
  const de = Math.max(0, cap - 30);
  await db(env).batch([
    ["UPDATE cortex_videos SET continuar_de_s = ?, analisar_ate_s = ?, etapa = 'entrada', erro = NULL, arquivado = 0, atualizado_em = ? WHERE id = ?",
      [de, ate, agora, video.id]],
    ["DELETE FROM cortex_tarefas WHERE video_id = ? AND tipo IN ('texto', 'roteiro') AND estado = 'falhou'", [video.id]],
    ["INSERT INTO cortex_tarefas (usuario_id, tipo, video_id, criada_em, atualizada_em) VALUES (?, 'texto', ?, ?, ?)", [u.id, video.id, agora, agora]],
  ]);
  await auditar(env, { quem: u.email, acao: 'puxar-resto', entidade: 'cortex_videos', entidade_id: video.id,
    antes: { capturado_ate_s: cap }, depois: { continuar_de_s: de, analisar_ate_s: ate }, ip: data.ip });
  return json({ ok: true, de, ate });
}

// ---------- layouts verticais dos curtos (19/11) ----------
// Coordenadas em fracao do quadro (0 a 1). Saida 1080x1920: webcam em cima (cam_altura da tela)
// e gameplay embaixo, ou so a gameplay ('sem_webcam'). O editor trava a proporcao de cada
// recorte na do espaco que ele ocupa no vertical, entao o que se ve la e o que sai no video.
// Os 4 iniciais seguem o pedido do dono; ele ajusta no editor com um print da live.
function layoutsIniciais() {
  const P = 16 / 9, alt = 0.35;
  const camW = 0.22, camH = camW / ((1080 / Math.round(1920 * alt)) / P);        // proporcao travada
  const jogoComCam = (1080 / (1920 - Math.round(1920 * alt))) / P;               // largura/altura em fracao
  const jogoSem = (1080 / 1920) / P;
  const comCam = (nome, cx, cy) => ({ nome, tipo: 'webcam', cam_x: cx, cam_y: cy, cam_w: camW, cam_h: +camH.toFixed(4), cam_altura: alt,
    jogo_x: +((1 - jogoComCam) / 2).toFixed(4), jogo_y: 0, jogo_w: +jogoComCam.toFixed(4), jogo_h: 1, proporcao: +P.toFixed(4) });
  return [
    comCam('Webcam topo-direita', +(0.99 - camW).toFixed(4), 0.02),
    comCam('Webcam topo-esquerda', 0.01, 0.02),
    comCam('Webcam baixo-esquerda', 0.01, +(0.98 - camH).toFixed(4)),
    { nome: 'Sem webcam', tipo: 'sem_webcam', cam_x: null, cam_y: null, cam_w: null, cam_h: null, cam_altura: null,
      jogo_x: +((1 - jogoSem) / 2).toFixed(4), jogo_y: 0, jogo_w: +jogoSem.toFixed(4), jogo_h: 1, proporcao: +P.toFixed(4), cena: 'jogo' },
    // 19/11: só a câmera (a live em "full cam"): recorte 9:16 no centro; a IA escolhe sozinha
    { nome: 'Full cam', tipo: 'sem_webcam', cam_x: null, cam_y: null, cam_w: null, cam_h: null, cam_altura: null,
      jogo_x: +((1 - jogoSem) / 2).toFixed(4), jogo_y: 0, jogo_w: +jogoSem.toFixed(4), jogo_h: 1, proporcao: +P.toFixed(4), cena: 'fullcam' },
  ].map((L) => ({ cena: null, logo_on: 0, logo_x: null, logo_y: null, logo_w: null, logo_opac: null, ...L }));
}

// cena (19/11): 'fullcam' | 'jogo' | null = o layout que entra sozinho quando a IA vê essa cena na foto do corte
const CAMPOS_LAYOUT = ['nome', 'tipo', 'cam_x', 'cam_y', 'cam_w', 'cam_h', 'cam_altura', 'jogo_x', 'jogo_y', 'jogo_w', 'jogo_h', 'proporcao', 'cena',
  'logo_on', 'logo_x', 'logo_y', 'logo_w', 'logo_opac'];   // 19/11: logo do canal no vertical
function lerLayout(c) {
  const nome = String(c.nome || '').trim().slice(0, 60);
  if (!nome) return { erro: 'Dê um nome ao layout.' };
  const tipo = c.tipo === 'sem_webcam' ? 'sem_webcam' : c.tipo === 'webcam' ? 'webcam' : null;
  if (!tipo) return { erro: 'Tipo de layout inválido.' };
  const n = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const caixa = (x, y, w, h) => [x, y, w, h].every(Number.isFinite) && x >= -0.001 && y >= -0.001 && w > 0.02 && h > 0.02
    && x + w <= 1.001 && y + h <= 1.001;
  const L = { nome, tipo, proporcao: Number(c.proporcao) > 0.5 && Number(c.proporcao) < 4 ? +Number(c.proporcao).toFixed(4) : 1.7778,
    cena: c.cena === 'fullcam' || c.cena === 'jogo' ? c.cena : null };
  for (const k of ['jogo_x', 'jogo_y', 'jogo_w', 'jogo_h']) L[k] = +n(c[k]).toFixed(4);
  if (!caixa(L.jogo_x, L.jogo_y, L.jogo_w, L.jogo_h)) return { erro: 'O recorte da gameplay saiu do quadro.' };
  // 19/11: logo do canal (posição em fração da tela 1080x1920). Desligada = campos vazios.
  L.logo_on = c.logo_on ? 1 : 0;
  if (L.logo_on) {
    L.logo_x = +n(c.logo_x).toFixed(4); L.logo_y = +n(c.logo_y).toFixed(4); L.logo_w = +n(c.logo_w).toFixed(4);
    L.logo_opac = Number.isFinite(n(c.logo_opac)) ? +Math.min(1, Math.max(0.2, n(c.logo_opac))).toFixed(2) : 1;
    if (![L.logo_x, L.logo_y, L.logo_w].every(Number.isFinite) || L.logo_w < 0.05 || L.logo_w > 0.8 || L.logo_x < -0.001 || L.logo_y < -0.001
        || L.logo_x + L.logo_w > 1.001 || L.logo_y > 0.98) return { erro: 'A logo saiu da tela do vertical.' };
  } else { L.logo_x = L.logo_y = L.logo_w = L.logo_opac = null; }
  if (tipo === 'webcam') {
    for (const k of ['cam_x', 'cam_y', 'cam_w', 'cam_h', 'cam_altura']) L[k] = +n(c[k]).toFixed(4);
    if (!caixa(L.cam_x, L.cam_y, L.cam_w, L.cam_h)) return { erro: 'O recorte da webcam saiu do quadro.' };
    if (!(L.cam_altura >= 0.2 && L.cam_altura <= 0.6)) return { erro: 'A webcam deve ocupar de 20% a 60% da altura do vertical.' };
  } else {
    for (const k of ['cam_x', 'cam_y', 'cam_w', 'cam_h', 'cam_altura']) L[k] = null;
  }
  return L;
}
async function layoutDoDono(env, usuarioId, id) {
  return await db(env).first('SELECT * FROM cortex_layouts WHERE id = ? AND usuario_id = ?', Number(id), usuarioId);
}
async function rotasLayouts({ request, env, data, u, id, metodo, json, agora }) {
  if (!id && metodo === 'GET') {
    let lista = await db(env).all('SELECT * FROM cortex_layouts WHERE usuario_id = ? ORDER BY id', u.id);
    if (!lista.length) {
      await db(env).batch(layoutsIniciais().map((L) => [
        `INSERT INTO cortex_layouts (usuario_id, ${CAMPOS_LAYOUT.join(', ')}, criado_em, atualizado_em)
         VALUES (?, ${CAMPOS_LAYOUT.map(() => '?').join(', ')}, ?, ?)`, [u.id, ...CAMPOS_LAYOUT.map((k) => L[k]), agora, agora]]));
      lista = await db(env).all('SELECT * FROM cortex_layouts WHERE usuario_id = ? ORDER BY id', u.id);
    }
    return json({ layouts: lista });
  }
  if (!id && metodo === 'POST') {
    const L = lerLayout(await request.json().catch(() => ({})));
    if (L.erro) return json({ erro: L.erro }, 400);
    if (L.cena) await db(env).run('UPDATE cortex_layouts SET cena = NULL WHERE usuario_id = ? AND cena = ?', u.id, L.cena);   // uma cena, um layout
    const r = await db(env).run(
      `INSERT INTO cortex_layouts (usuario_id, ${CAMPOS_LAYOUT.join(', ')}, criado_em, atualizado_em)
       VALUES (?, ${CAMPOS_LAYOUT.map(() => '?').join(', ')}, ?, ?)`, u.id, ...CAMPOS_LAYOUT.map((k) => L[k]), agora, agora);
    await auditar(env, { quem: u.email, acao: 'criar', entidade: 'cortex_layouts', entidade_id: r.meta.last_row_id, depois: L, ip: data.ip });
    return json({ ok: true, id: r.meta.last_row_id }, 201);
  }
  const atual = id && await layoutDoDono(env, u.id, id);
  if (!atual) return json({ erro: 'layout não encontrado' }, 404);
  if (metodo === 'PATCH') {
    const L = lerLayout({ ...atual, ...(await request.json().catch(() => ({}))) });
    if (L.erro) return json({ erro: L.erro }, 400);
    if (L.cena) await db(env).run('UPDATE cortex_layouts SET cena = NULL WHERE usuario_id = ? AND cena = ? AND id <> ?', u.id, L.cena, atual.id);
    await db(env).run(`UPDATE cortex_layouts SET ${CAMPOS_LAYOUT.map((k) => k + ' = ?').join(', ')}, atualizado_em = ? WHERE id = ?`,
      ...CAMPOS_LAYOUT.map((k) => L[k]), agora, atual.id);
    await auditar(env, { quem: u.email, acao: 'editar', entidade: 'cortex_layouts', entidade_id: atual.id, antes: atual, depois: L, ip: data.ip });
    return json({ ok: true });
  }
  if (metodo === 'DELETE') {
    // Cortes e videos que usavam esse layout voltam ao padrao (o do video / nenhum).
    await db(env).batch([
      ['UPDATE cortex_cortes SET layout_id = NULL WHERE layout_id = ? AND usuario_id = ?', [atual.id, u.id]],
      ['UPDATE cortex_videos SET layout_id = NULL WHERE layout_id = ? AND usuario_id = ?', [atual.id, u.id]],
      ['DELETE FROM cortex_layouts WHERE id = ?', [atual.id]],
    ]);
    await auditar(env, { quem: u.email, acao: 'excluir', entidade: 'cortex_layouts', entidade_id: atual.id, antes: atual, ip: data.ip });
    return json({ ok: true });
  }
  return json({ erro: 'rota nao encontrada' }, 404);
}

// Ficha .txt do corte aprovado sem baixar: troca a da fila (pendente/falhou) por uma nova.
function fichaNaFila(usuarioId, corte, agora) {
  return [
    ["DELETE FROM cortex_tarefas WHERE corte_id = ? AND estado IN ('pendente', 'falhou')", [corte.id]],
    [`INSERT INTO cortex_tarefas (usuario_id, tipo, video_id, corte_id, criada_em, atualizada_em)
      VALUES (?, 'baixar_corte', ?, ?, ?, ?)`, [usuarioId, corte.video_id, corte.id, agora, agora]],
  ];
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
    `SELECT id, nome, baixa_cortes, visto_em, versao, ferramentas, pasta, pasta_atual, criado_em FROM cortex_agentes
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
    'SELECT id, nome, baixa_cortes, pasta FROM cortex_agentes WHERE id = ? AND usuario_id = ? AND revogado_em IS NULL', Number(id), u.id);
  if (!ag) return json({ erro: 'PC não encontrado' }, 404);

  if (metodo === 'PATCH') {
    const corpo = await request.json().catch(() => ({}));
    const baixa = corpo.baixa_cortes === undefined ? ag.baixa_cortes : (corpo.baixa_cortes ? 1 : 0);
    let pasta = ag.pasta;
    if (corpo.pasta !== undefined) {
      pasta = String(corpo.pasta || '').trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '') || null;
      // Caminho completo: D:\..., \\servidor\..., ou /... (Linux/Mac). Sem os caracteres que o Windows recusa.
      if (pasta && (!/^([A-Za-z]:[\\/]|\\\\[^\\]+\\|\/)/.test(pasta) || /[<>"|?*]/.test(pasta.slice(2)) || pasta.length > 240)) {
        return json({ erro: 'Use o caminho completo da pasta, por exemplo D:\\Meus Documentos\\Vídeos\\Cortex.' }, 400);
      }
    }
    await db(env).run('UPDATE cortex_agentes SET baixa_cortes = ?, pasta = ? WHERE id = ?', baixa, pasta, ag.id);
    await auditar(env, { quem: u.email, acao: 'editar', entidade: 'cortex_agentes', entidade_id: ag.id,
      antes: { baixa_cortes: ag.baixa_cortes, pasta: ag.pasta }, depois: { baixa_cortes: baixa, pasta }, ip: data.ip });
    return json({ ok: true, pasta });
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
    .map((t) => String(t).replace(/^#/, '').trim().slice(0, 40)).filter(Boolean).slice(0, 30);   // 19/11: grafia normal ("GTA 6"), pronta para o Studio
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
