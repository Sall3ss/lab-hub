// projetos/cortex/maquina.js - rotas do AGENTE DO PC (etapa 2 do Cortex).
// Chega aqui /api/p/cortex/maquina/<resto>, SEM sessao de pessoa (ver a porta unica,
// functions/api/[[path]].js). Quem prova identidade e a chave do agente, no cabecalho
// "Authorization: Bearer cx_...", que o dono gerou na tela "PCs" (o banco so tem o hash).
//
//   POST /oi                              { versao, ferramentas, pasta } -> config do agente (+ pasta escolhida no painel)
//   POST /proxima                         pega a proxima tarefa da fila (ou { tarefa: null })
//   POST /tarefas/:id/prorrogar           { progresso? } estende o prazo (download longo)
//   POST /tarefas/:id/meta                { titulo, canal, duracao_s, capturado_ate_s?, ao_vivo? }
//   POST /tarefas/:id/live                { uuid, fonte, titulo, ao_vivo } o PC achou o video da live da Kick (18/11)
//   POST /tarefas/:id/texto?parte&total&fonte=legenda   { segmentos: [{ i, f, t }] }
//   POST /tarefas/:id/audio?parte&total&inicio          corpo = audio cru (ogg/opus) -> Groq
//   POST /tarefas/:id/roteiro            um passo do roteiro com a IA (etapa 3); resposta chega aos poucos
//   POST /tarefas/:id/quadro?corte&s     corpo = foto JPEG crua do meio do curto -> R2 + cena pelo Gemini (19/11)
//   POST /tarefas/:id/palavras           corpo = audio cru do corte baixado -> Whisper (Groq) palavra a palavra,
//                                        para o PC gravar a legenda no vertical e o .srt (19/11, agente 2.2.0)
//   POST /tarefas/:id/concluir            { arquivo_local? }
//   POST /tarefas/:id/falhar              { erro, definitivo? }
//   POST /tarefas/:id/devolver            o dono desligou o PC no meio: volta para a fila sem contar falha
//   POST /tchau                           o PC foi desligado pelo atalho: aparece offline na hora
//
// O PC nunca recebe nada que nao seja dele: toda consulta filtra pelo dono da chave.
// Autoria: Claude (Opus 5.5), Lab Hub, 14/11/2026.

import { db } from '../../lib/db.js';
import { passoRoteiro } from './roteiro.js';
import { receberFoto, MAX_FOTO } from './cena.js';
import { arquivos, temDeposito } from '../../lib/arquivos.js';

export const AGENTE_VERSAO = '2.7.2';     // muda junto com public/projetos/cortex/agente/cortex-agente.mjs
const PRAZO_MIN = { texto: 30, baixar_corte: 60, roteiro: 20, quadros: 15, legenda: 15 };
const VERSAO_ROTEIRO = [1, 3, 0];       // agente mais velho nao sabe fazer 'roteiro': nao recebe
const VERSAO_TRECHO = [1, 7, 0];        // 16/11: so a 1.7.0+ respeita "analisar de/ate"; a velha buscaria a live inteira
const VERSAO_VERTICAL = [2, 0, 0];      // 19/11: curto com layout vertical 9:16 (o agente velho entregaria so o horizontal)
const VERSAO_FICHA = [1, 9, 0];         // 18/11: ficha .txt de corte "sem baixar"; o agente velho BAIXARIA o video
const VERSAO_QUADROS = [2, 1, 0];
const VERSAO_LEGENDA = [2, 4, 0];      // 19/11: legenda do curto revisada no painel antes de baixar      // 19/11: foto de cada curto (cena + previa do vertical)
const VERSAO_LIVE = [1, 8, 2];          // 18/11: live da Kick (link do canal, m3u8, "Puxar o resto" com "ate") so a 1.8.2+
const MAX_TENTATIVAS = 3;
const VISTO_A_CADA_MS = 60 * 1000;      // grava "visto_em" no maximo 1x por minuto (poupa escrita no D1)
const GROQ_MODELO = 'whisper-large-v3-turbo';
// 19/11 (legenda): o modelo completo erra menos palavra e tempo; o corte e curto, a cota gratis aguenta.
const GROQ_MODELO_LEGENDA = 'whisper-large-v3';
const MAX_AUDIO = 24 * 1024 * 1024;     // limite da Groq no plano gratis e 25 MB

export async function hashChave(chave) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(chave));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function maquina({ request, env, partes, metodo, json, waitUntil }) {
  const auth = request.headers.get('authorization') || '';
  const chave = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!/^cx_[A-Za-z0-9_-]{30,80}$/.test(chave)) return json({ erro: 'chave do agente ausente ou inválida' }, 401);
  const ag = await db(env).first(
    'SELECT id, usuario_id, nome, baixa_cortes, visto_em, versao, pasta FROM cortex_agentes WHERE chave_hash = ? AND revogado_em IS NULL',
    await hashChave(chave));
  if (!ag) return json({ erro: 'Este PC foi desconectado ou a chave não existe. Gere uma nova na tela "PCs".', revogado: true }, 401);
  if (metodo !== 'POST') return json({ erro: 'use POST' }, 405);

  const agora = new Date();
  const iso = agora.toISOString();
  const [rota, id, acao] = partes;

  if (rota === 'oi') {
    const corpo = await request.json().catch(() => ({}));
    // 18/11: o PC conta qual pasta usa (aparece na tela PCs) e recebe a escolhida no painel.
    await db(env).run('UPDATE cortex_agentes SET visto_em = ?, versao = ?, ferramentas = ?, pasta_atual = COALESCE(?, pasta_atual) WHERE id = ?',
      iso, String(corpo.versao || '').slice(0, 20), JSON.stringify(corpo.ferramentas || {}).slice(0, 500),
      corpo.pasta ? String(corpo.pasta).slice(0, 260) : null, ag.id);
    return json({ ok: true, nome: ag.nome, baixa_cortes: !!ag.baixa_cortes, versao_atual: AGENTE_VERSAO, intervalo_s: 20, pasta: ag.pasta || null });
  }

  if (rota === 'tchau') {
    // "visto" fica 3 min no passado: a tela mostra offline na hora, mas guarda quando saiu.
    await db(env).run('UPDATE cortex_agentes SET visto_em = ? WHERE id = ?', new Date(agora.getTime() - 3 * 60000).toISOString(), ag.id);
    return json({ ok: true });
  }

  // 19/11: a logo do canal (PNG do R2) para o PC gravar nos verticais.
  if (rota === 'logo') {
    const m = await db(env).first('SELECT logo_chave FROM cortex_marca WHERE usuario_id = ?', ag.usuario_id);
    if (!m || !temDeposito(env)) return json({ erro: 'sem logo' }, 404);
    const obj = await arquivos(env).ler(m.logo_chave);
    if (!obj) return json({ erro: 'sem logo' }, 404);
    return new Response(obj.body, { headers: { 'content-type': 'image/png' } });
  }

  if (!ag.visto_em || agora - Date.parse(ag.visto_em) > VISTO_A_CADA_MS) {
    await db(env).run('UPDATE cortex_agentes SET visto_em = ? WHERE id = ?', iso, ag.id);
  }

  if (rota === 'proxima') {
    // Tarefa pega por um PC que sumiu volta para a fila depois do prazo.
    await db(env).run(
      "UPDATE cortex_tarefas SET estado = 'pendente', agente_id = NULL, pega_ate = NULL, progresso = NULL WHERE usuario_id = ? AND estado = 'pega' AND pega_ate < ?",
      ag.usuario_id, iso);
    const lista = ['texto'];
    if (ag.baixa_cortes) lista.push('baixar_corte');
    if (versaoMin(ag.versao, VERSAO_ROTEIRO)) lista.push('roteiro');
    if (versaoMin(ag.versao, VERSAO_QUADROS)) lista.push('quadros');
    if (versaoMin(ag.versao, VERSAO_LEGENDA)) lista.push('legenda');
    const tipos = '(' + lista.map((x) => `'${x}'`).join(', ') + ')';
    // Agente antigo nao pega texto de video com trecho marcado (atualiza sozinho em ate 10 min).
    let semTrecho = versaoMin(ag.versao, VERSAO_TRECHO) ? '' :
      " AND NOT (tipo = 'texto' AND EXISTS (SELECT 1 FROM cortex_videos v WHERE v.id = video_id AND (v.analisar_de_s IS NOT NULL OR v.analisar_ate_s IS NOT NULL)))";
    // Agente < 1.8.0 nao sabe achar a live nem baixar pelo m3u8 (o link normal falha enquanto a live roda).
    if (!versaoMin(ag.versao, VERSAO_VERTICAL)) {
      semTrecho += ` AND NOT (tipo = 'baixar_corte' AND EXISTS (SELECT 1 FROM cortex_cortes c JOIN cortex_videos v ON v.id = c.video_id
        WHERE c.id = corte_id AND c.tipo = 'curto' AND c.baixar_fora = 0 AND COALESCE(c.layout_id, v.layout_id, 0) <> 0))`;
    }
    if (!versaoMin(ag.versao, VERSAO_FICHA)) {
      semTrecho += " AND NOT (tipo = 'baixar_corte' AND EXISTS (SELECT 1 FROM cortex_cortes c WHERE c.id = corte_id AND c.baixar_fora = 1))";
    }
    if (!versaoMin(ag.versao, VERSAO_LIVE)) {
      semTrecho += " AND NOT (tipo IN ('texto', 'baixar_corte') AND EXISTS (SELECT 1 FROM cortex_videos v WHERE v.id = video_id AND (v.ao_vivo_canal IS NOT NULL OR v.fonte_m3u8 IS NOT NULL)))";
    }
    // Duas tentativas: se outro PC pegar a mesma tarefa no mesmo instante, tenta a seguinte.
    for (let i = 0; i < 2; i++) {
      const t = await db(env).first(
        `SELECT id, tipo, video_id, corte_id, tentativas FROM cortex_tarefas
          WHERE usuario_id = ? AND estado = 'pendente' AND tipo IN ${tipos}${semTrecho} ORDER BY id LIMIT 1`, ag.usuario_id);
      if (!t) return json({ tarefa: null });
      const prazo = new Date(agora.getTime() + PRAZO_MIN[t.tipo] * 60000).toISOString();
      const r = await db(env).run(
        "UPDATE cortex_tarefas SET estado = 'pega', agente_id = ?, pega_ate = ?, progresso = NULL, atualizada_em = ? WHERE id = ? AND estado = 'pendente'",
        ag.id, prazo, iso, t.id);
      if (!r.meta.changes) continue;
      const video = await db(env).first(
        `SELECT id, url, plataforma, titulo, canal, duracao_s, analisar_de_s, analisar_ate_s, ao_vivo_canal, fonte_m3u8,
                capturado_ate_s, continuar_de_s, criado_em FROM cortex_videos WHERE id = ?`, t.video_id);
      let corte = null;
      if (t.corte_id) {
        corte = await db(env).first(
          `SELECT id, tipo, inicio_s, fim_s, titulo, descricao, tags, gancho, gancho_inicio_s, gancho_fim_s, baixar_fora, arquivo_local, layout_id, legenda, legenda_editada, titulos, titulo_porque, thumb
             FROM cortex_cortes WHERE id = ?`, t.corte_id);
        if (corte) {
          // 19/11: layout vertical do curto (o do corte; senao o do video; 0 = nenhum).
          const lid = corte.tipo !== 'curto' ? 0 : corte.layout_id !== null ? corte.layout_id
            : ((await db(env).first('SELECT layout_id FROM cortex_videos WHERE id = ?', t.video_id)) || {}).layout_id || 0;
          corte.layout = lid ? await db(env).first(
            `SELECT id, nome, tipo, cam_x, cam_y, cam_w, cam_h, cam_altura, jogo_x, jogo_y, jogo_w, jogo_h, proporcao,
                    logo_on, logo_x, logo_y, logo_w, logo_opac
               FROM cortex_layouts WHERE id = ? AND usuario_id = ?`, lid, ag.usuario_id) : null;
          // 19/11: logo do canal - o PC baixa uma vez (por "em") e grava no vertical
          if (corte.layout && corte.layout.logo_on) {
            const m = await db(env).first('SELECT largura, altura, atualizado_em FROM cortex_marca WHERE usuario_id = ?', ag.usuario_id);
            corte.logo = m ? { largura: m.largura, altura: m.altura, em: m.atualizado_em } : null;
          }
          delete corte.layout_id;
          // 19/11: legenda revisada no painel (o PC usa em vez de transcrever de novo)
          try { corte.legenda = corte.legenda ? JSON.parse(corte.legenda) : null; } catch { corte.legenda = null; }
          try { corte.titulos = corte.titulos ? JSON.parse(corte.titulos) : null; } catch { corte.titulos = null; }   // 19/11: vão para a ficha .txt
          try { corte.tags = JSON.parse(corte.tags || '[]'); } catch { corte.tags = []; }
          // numero do corte dentro do video (01, 02...) para o nome do arquivo seguir a ordem do tempo
          const n = await db(env).first(
            "SELECT COUNT(*) AS n FROM cortex_cortes WHERE video_id = ? AND tipo = ? AND estado <> 'descartado' AND inicio_s < ?",
            t.video_id, corte.tipo, corte.inicio_s);
          corte.numero = (n ? n.n : 0) + 1;
        }
      }
      if (t.tipo === 'texto' || t.tipo === 'roteiro') {
        await db(env).run("UPDATE cortex_videos SET erro = NULL, atualizado_em = ? WHERE id = ?", iso, t.video_id);
      }
      // 19/11: fotos - os curtos da Triagem ainda sem foto, com o segundo do meio de cada um.
      let cortes;
      if (t.tipo === 'quadros') {
        cortes = (await db(env).all(
          `SELECT id, inicio_s, fim_s FROM cortex_cortes WHERE video_id = ? AND tipo = 'curto' AND estado = 'triagem' AND quadro_em IS NULL
            ORDER BY inicio_s LIMIT 80`, t.video_id)).map((c) => ({ id: c.id, s: Math.round((c.inicio_s + c.fim_s) / 2) }));
      }
      // pasta: a escolhida no painel vale ja neste download (sem esperar o proximo "oi").
      return json({ tarefa: { id: t.id, tipo: t.tipo, tentativa: t.tentativas + 1, prazo, video, corte, cortes, pasta: ag.pasta || null } });
    }
    return json({ tarefa: null });
  }

  if (rota !== 'tarefas' || !id) return json({ erro: 'rota nao encontrada' }, 404);
  const tarefa = await db(env).first(
    "SELECT * FROM cortex_tarefas WHERE id = ? AND usuario_id = ? AND agente_id = ? AND estado = 'pega'",
    Number(id), ag.usuario_id, ag.id);
  if (!tarefa) return json({ erro: 'tarefa não está com este PC (venceu o prazo ou foi cancelada)', perdida: true }, 409);

  if (acao === 'prorrogar') {
    const corpo = await request.json().catch(() => ({}));
    const prazo = new Date(agora.getTime() + PRAZO_MIN[tarefa.tipo] * 60000).toISOString();
    await db(env).run('UPDATE cortex_tarefas SET pega_ate = ?, progresso = ?, atualizada_em = ? WHERE id = ?',
      prazo, corpo.progresso ? String(corpo.progresso).slice(0, 80) : tarefa.progresso, iso, tarefa.id);
    return json({ ok: true, prazo });
  }

  if (acao === 'meta') {
    const c = await request.json().catch(() => ({}));
    const dur = Math.round(Number(c.duracao_s)) || null;
    // 18/11: ate onde esta captura vai (live: o minuto em que o PC pediu) e se a live segue no ar.
    const cap = Math.round(Number(c.capturado_ate_s)) || null;
    const vivo = c.ao_vivo === undefined ? null : (c.ao_vivo ? 1 : 0);
    await db(env).run(
      `UPDATE cortex_videos SET titulo = COALESCE(titulo, ?), canal = COALESCE(?, canal), duracao_s = COALESCE(?, duracao_s),
              capturado_ate_s = COALESCE(?, capturado_ate_s), ao_vivo = COALESCE(?, ao_vivo), atualizado_em = ? WHERE id = ?`,
      c.titulo ? String(c.titulo).slice(0, 200) : null, c.canal ? String(c.canal).slice(0, 120) : null, dur, cap, vivo, iso, tarefa.video_id);
    await herdarLayout(env, tarefa.video_id);
    return json({ ok: true });
  }

  if (acao === 'live') {
    // O PC achou, na Kick, o video gravado da live do canal colado. Troca o id provisorio
    // (live:<canal>:<hora>) pelo de verdade e guarda o m3u8, que e por onde se baixa.
    const c = await request.json().catch(() => ({}));
    const uuid = String(c.uuid || '').toLowerCase();
    const fonte = String(c.fonte || '');
    if (!/^[0-9a-f-]{36}$/.test(uuid) || !/^https:\/\/[^\s]+\.m3u8(\?\S*)?$/.test(fonte)) return json({ erro: 'resposta da Kick fora do esperado (uuid/m3u8)', definitivo: true }, 400);
    const video = await db(env).first('SELECT id, id_externo, ao_vivo_canal FROM cortex_videos WHERE id = ?', tarefa.video_id);
    if (!video || !video.ao_vivo_canal) return json({ erro: 'este vídeo não veio de um link de live', definitivo: true }, 400);
    const idExt = 'v' + uuid;
    if (video.id_externo !== idExt) {
      const ja = await db(env).first(
        "SELECT id, titulo FROM cortex_videos WHERE usuario_id = ? AND plataforma = 'kick' AND id_externo = ? AND id <> ?",
        ag.usuario_id, idExt, video.id);
      if (ja) {
        return json({ erro: `Essa live já está no quadro ("${String(ja.titulo || 'sem título').slice(0, 60)}"). Abra ela e use "Puxar o resto"; este cartão pode ser excluído.`, definitivo: true }, 409);
      }
    }
    await db(env).run(
      `UPDATE cortex_videos SET id_externo = ?, url = ?, fonte_m3u8 = ?, titulo = COALESCE(titulo, ?), canal = COALESCE(canal, ?),
              ao_vivo = ?, atualizado_em = ? WHERE id = ?`,
      idExt, `https://kick.com/${video.ao_vivo_canal}/videos/${uuid}`, fonte.slice(0, 500),
      c.titulo ? String(c.titulo).slice(0, 200) : null, video.ao_vivo_canal, c.ao_vivo ? 1 : 0, iso, video.id);
    await herdarLayout(env, video.id);
    return json({ ok: true });
  }

  if (acao === 'texto' || acao === 'audio') {
    if (tarefa.tipo !== 'texto') return json({ erro: 'tarefa não é de texto' }, 400);
    const url = new URL(request.url);
    const parte = Math.max(0, Number(url.searchParams.get('parte')) || 0);
    const total = Math.max(1, Number(url.searchParams.get('total')) || 1);
    let segmentos, fonte;

    if (acao === 'texto') {
      const corpo = await request.json().catch(() => ({}));
      segmentos = Array.isArray(corpo.segmentos) ? corpo.segmentos : [];
      fonte = 'legenda';
    } else {
      if (!env.GROQ_API_KEY) {
        return json({ erro: 'Falta a chave GROQ_API_KEY no Cloudflare (o vídeo não tem legenda e precisa do Whisper).', definitivo: true }, 503);
      }
      const inicio = Math.max(0, Number(url.searchParams.get('inicio')) || 0);
      const audio = await request.arrayBuffer();
      if (!audio.byteLength) return json({ erro: 'áudio vazio' }, 400);
      if (audio.byteLength > MAX_AUDIO) return json({ erro: 'parte de áudio maior que 24 MB', definitivo: true }, 413);
      const r = await transcreverGroq(env, audio, request.headers.get('content-type') || 'audio/ogg');
      if (r.erro) return json({ erro: r.erro, esperar_s: r.esperar_s, definitivo: !!r.definitivo }, r.status || 502);
      segmentos = r.segmentos.map((s) => ({ i: s.i + inicio, f: s.f + inicio, t: s.t }));
      fonte = 'whisper';
    }

    const blocos = juntar(segmentos);
    const lotes = [];
    // 18/11: "Puxar o resto" (continuar_de_s): o texto antigo fica; sai so o que vier dali em diante.
    const vid = await db(env).first('SELECT continuar_de_s FROM cortex_videos WHERE id = ?', tarefa.video_id);
    const cont = vid ? vid.continuar_de_s : null;
    if (parte === 0) {
      if (cont !== null) lotes.push(['DELETE FROM cortex_transcricao WHERE video_id = ? AND inicio_s >= ?', [tarefa.video_id, cont]]);
      else lotes.push(['DELETE FROM cortex_transcricao WHERE video_id = ?', [tarefa.video_id]]);
      lotes.push(["UPDATE cortex_videos SET etapa = 'transcricao', atualizado_em = ? WHERE id = ? AND etapa = 'entrada'", [iso, tarefa.video_id]]);
    }
    // D1 aceita ate 100 parametros por consulta: 20 linhas x 4 por INSERT.
    for (let i = 0; i < blocos.length; i += 20) {
      const fatia = blocos.slice(i, i + 20);
      lotes.push([
        'INSERT INTO cortex_transcricao (video_id, inicio_s, fim_s, texto) VALUES ' + fatia.map(() => '(?, ?, ?, ?)').join(', '),
        fatia.flatMap((b) => [tarefa.video_id, b.i, b.f, b.t]),
      ]);
    }
    const ultima = parte >= total - 1;
    if (ultima) {
      // A IA le a partir de roteiro_de_s: no "Puxar o resto", so a parte nova (cortes antigos ficam).
      lotes.push(["UPDATE cortex_videos SET etapa = 'roteiro', fonte_texto = ?, roteiro_de_s = ?, continuar_de_s = NULL, erro = NULL, atualizado_em = ? WHERE id = ?",
        [fonte, cont, iso, tarefa.video_id]]);
      // Texto pronto: o roteiro com a IA entra na fila (refeito do zero se o texto foi refeito).
      lotes.push(['DELETE FROM cortex_roteiro_partes WHERE video_id = ?', [tarefa.video_id]]);
      lotes.push(["DELETE FROM cortex_tarefas WHERE video_id = ? AND tipo = 'roteiro' AND estado <> 'pega'", [tarefa.video_id]]);
      lotes.push(["INSERT INTO cortex_tarefas (usuario_id, tipo, video_id, criada_em, atualizada_em) VALUES (?, 'roteiro', ?, ?, ?)",
        [tarefa.usuario_id, tarefa.video_id, iso, iso]]);
      lotes.push(["UPDATE cortex_tarefas SET estado = 'feita', progresso = NULL, atualizada_em = ? WHERE id = ?", [iso, tarefa.id]]);
    } else {
      const prazo = new Date(agora.getTime() + PRAZO_MIN.texto * 60000).toISOString();
      lotes.push(['UPDATE cortex_tarefas SET pega_ate = ?, progresso = ?, atualizada_em = ? WHERE id = ?',
        [prazo, `transcrevendo ${parte + 1}/${total}`, iso, tarefa.id]]);
    }
    await db(env).batch(lotes);
    return json({ ok: true, blocos: blocos.length, concluido: ultima });
  }

  if (acao === 'roteiro') {
    if (tarefa.tipo !== 'roteiro') return json({ erro: 'tarefa não é de roteiro' }, 400);
    // O Gemini pode levar mais de um minuto num trecho grande; a Cloudflare corta conexao
    // muda por 100 s (lição da Jean, erro 524). Entao a resposta sai na hora e manda um
    // espaco a cada 15 s ate o JSON final (o agente le o texto todo e interpreta no fim).
    const { readable, writable } = new TransformStream();
    const w = writable.getWriter();
    const enc = new TextEncoder();
    const bate = setInterval(() => { w.write(enc.encode(' ')).catch(() => {}); }, 15000);
    const trabalho = (async () => {
      let res;
      try { res = { ok: true, ...(await passoRoteiro(env, tarefa)) }; }
      catch (e) { res = { erro: String(e.message || e).slice(0, 300), esperar_s: e.esperar_s, aviso: e.aviso, definitivo: !!e.definitivo }; }
      clearInterval(bate);
      try { await w.write(enc.encode(JSON.stringify(res))); await w.close(); } catch { /* o PC desligou no meio */ }
    })();
    if (waitUntil) waitUntil(trabalho);
    return new Response(readable, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }

  if (acao === 'quadro') {
    if (tarefa.tipo !== 'quadros') return json({ erro: 'tarefa não é de fotos' }, 400);
    const url = new URL(request.url);
    const corte = await db(env).first(
      "SELECT id, tipo, estado, layout_id, cena_auto, inicio_s, fim_s FROM cortex_cortes WHERE id = ? AND video_id = ? AND usuario_id = ?",
      Number(url.searchParams.get('corte')), tarefa.video_id, ag.usuario_id);
    if (!corte) return json({ erro: 'corte não existe mais (apagado no painel)', pular: true }, 404);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length < 500 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return json({ erro: 'a foto não é um JPEG', pular: true }, 400);
    if (bytes.length > MAX_FOTO) return json({ erro: 'foto maior que 1,5 MB', pular: true }, 413);
    const s = Math.round(Number(url.searchParams.get('s')));
    try {
      const r = await receberFoto(env, { usuarioId: ag.usuario_id, corte, segundo: Number.isFinite(s) ? s : null, bytes, agora: iso });
      const prog = url.searchParams.get('progresso');
      await db(env).run('UPDATE cortex_tarefas SET pega_ate = ?, progresso = ?, atualizada_em = ? WHERE id = ?',
        new Date(agora.getTime() + PRAZO_MIN.quadros * 60000).toISOString(), prog ? String(prog).slice(0, 80) : tarefa.progresso, iso, tarefa.id);
      return json({ ok: true, ...r });
    } catch (e) {
      if (e.esperar_s) return json({ erro: e.message, esperar_s: e.esperar_s }, 429);
      return json({ erro: String(e.message || e).slice(0, 200) }, 502);
    }
  }

  if (acao === 'palavras') {
    // 19/11: legenda. O texto guardado do video vem em blocos de ~30 s (grosso demais); o PC manda
    // o audio SO do corte e o Whisper devolve cada palavra com o tempo, contado do inicio do corte.
    if (tarefa.tipo !== 'baixar_corte' && tarefa.tipo !== 'legenda') return json({ erro: 'tarefa não é de corte' }, 400);
    if (!env.GROQ_API_KEY) return json({ erro: 'Falta a chave GROQ_API_KEY no Cloudflare (legenda).', definitivo: true }, 503);
    const audio = await request.arrayBuffer();
    if (!audio.byteLength) return json({ erro: 'áudio vazio' }, 400);
    if (audio.byteLength > MAX_AUDIO) return json({ erro: 'áudio do corte maior que 24 MB', definitivo: true }, 413);
    // 19/11: idioma FIXO (padrao pt). Sem ele o Whisper adivinhava e um trecho de jogo virou
    // legenda em ingles, com o tempo das palavras errado junto.
    const url = new URL(request.url);
    const idioma = /^[a-z]{2}$/.test(url.searchParams.get('idioma') || '') ? url.searchParams.get('idioma') : 'pt';
    // 19/11: o contexto da live (escrito pelo dono) vai como "prompt" do Whisper: os nomes saem certos.
    const vid = await db(env).first('SELECT contexto FROM cortex_videos WHERE id = ?', tarefa.video_id);
    const r = await transcreverGroq(env, audio, request.headers.get('content-type') || 'audio/ogg',
      { palavras: true, idioma, contexto: vid && vid.contexto, buraco: !!url.searchParams.get('buraco') });
    if (r.erro) return json({ erro: r.erro, esperar_s: r.esperar_s, definitivo: !!r.definitivo }, r.status || 502);
    // 19/11: guarda para o dono revisar. Pedido de revisao ('legenda') sobrescreve; o do download
    // so preenche se ainda nao ha legenda (nunca apaga uma correcao do dono).
    // 2.5.0: "parcial" = o PC ainda vai juntar pedaços (buracos transcritos de novo) e grava no fim (legenda_final).
    if (tarefa.corte_id && r.palavras && r.palavras.length && !url.searchParams.get('parcial')) {
      await db(env).run(
        `UPDATE cortex_cortes SET legenda = ?, legenda_em = ?, legenda_editada = 0, legenda_erro = NULL
          WHERE id = ?${tarefa.tipo === 'legenda' ? '' : ' AND legenda IS NULL'}`,
        JSON.stringify(r.palavras), iso, tarefa.corte_id);
    }
    // 20/11: os trechos descartados (fala inventada) voltam para o PC não pedir de novo esse pedaço
    return json({ ok: true, palavras: r.palavras, idioma: r.idioma || null, descartados: r.descartados || [] });
  }

  // 19/11 (2.5.0): o PC juntou a legenda (com os buracos transcritos de novo) e manda a versão final.
  if (acao === 'legenda_final') {
    if ((tarefa.tipo !== 'baixar_corte' && tarefa.tipo !== 'legenda') || !tarefa.corte_id) return json({ erro: 'tarefa não é de corte' }, 400);
    const corpo = await request.json().catch(() => ({}));
    const palavras = (Array.isArray(corpo.palavras) ? corpo.palavras : []).slice(0, 20000)
      .map((w) => ({ p: String((w && w.p) || '').trim().slice(0, 40), i: Math.round(Number(w && w.i) * 100) / 100, f: Math.round(Number(w && w.f) * 100) / 100 }))
      .filter((w) => w.p && Number.isFinite(w.i) && Number.isFinite(w.f) && w.f >= w.i && w.i >= 0);
    if (palavras.length) {
      await db(env).run(
        `UPDATE cortex_cortes SET legenda = ?, legenda_em = ?, legenda_editada = 0, legenda_erro = NULL
          WHERE id = ?${tarefa.tipo === 'legenda' ? '' : ' AND legenda IS NULL'}`,
        JSON.stringify(palavras), iso, tarefa.corte_id);
    }
    return json({ ok: true, palavras: palavras.length });
  }

  if (acao === 'concluir') {
    const corpo = await request.json().catch(() => ({}));
    const lotes = [["UPDATE cortex_tarefas SET estado = 'feita', progresso = NULL, erro = NULL, atualizada_em = ? WHERE id = ?", [iso, tarefa.id]]];
    if (tarefa.tipo === 'baixar_corte' && tarefa.corte_id && corpo.so_ficha) {
      // 18/11: so a ficha .txt (corte aprovado sem baixar): grava onde ficou, o estado nao muda.
      lotes.push(['UPDATE cortex_cortes SET arquivo_local = ?, erro = NULL, atualizado_em = ? WHERE id = ? AND baixar_fora = 1',
        [corpo.arquivo_local ? `${ag.nome}: ${String(corpo.arquivo_local).slice(0, 400)}` : null, iso, tarefa.corte_id]]);
    } else if (tarefa.tipo === 'baixar_corte' && tarefa.corte_id) {
      lotes.push([
        "UPDATE cortex_cortes SET estado = 'edicao', arquivo_local = ?, qualidade = ?, erro = NULL, atualizado_em = ? WHERE id = ? AND estado = 'download'",
        [corpo.arquivo_local ? `${ag.nome}: ${String(corpo.arquivo_local).slice(0, 400)}` : null,
         corpo.qualidade ? String(corpo.qualidade).slice(0, 200) : null, iso, tarefa.corte_id]]);
    }
    await db(env).batch(lotes);
    return json({ ok: true });
  }

  if (acao === 'devolver') {
    await db(env).run(
      "UPDATE cortex_tarefas SET estado = 'pendente', agente_id = NULL, pega_ate = NULL, progresso = NULL, atualizada_em = ? WHERE id = ?",
      iso, tarefa.id);
    return json({ ok: true });
  }

  if (acao === 'falhar') {
    const corpo = await request.json().catch(() => ({}));
    const erro = String(corpo.erro || 'falha sem detalhe').slice(0, 300);
    const tentativas = tarefa.tentativas + 1;
    const fim = corpo.definitivo || tentativas >= MAX_TENTATIVAS;
    const lotes = [[
      'UPDATE cortex_tarefas SET estado = ?, tentativas = ?, erro = ?, agente_id = NULL, pega_ate = NULL, progresso = NULL, atualizada_em = ? WHERE id = ?',
      [fim ? 'falhou' : 'pendente', tentativas, erro, iso, tarefa.id]]];
    if (fim) {
      const msg = `${ag.nome}: ${erro}`;
      // Foto que falhou nao e erro do video (o corte segue sem foto; "Tirar foto de novo" na gaveta).
      if (tarefa.tipo === 'legenda') lotes.push(['UPDATE cortex_cortes SET legenda_erro = ? WHERE id = ?', [msg.slice(0, 300), tarefa.corte_id]]);
      else if (tarefa.tipo !== 'baixar_corte' && tarefa.tipo !== 'quadros') lotes.push(['UPDATE cortex_videos SET erro = ?, atualizado_em = ? WHERE id = ?', [msg, iso, tarefa.video_id]]);
      else if (tarefa.corte_id) lotes.push(['UPDATE cortex_cortes SET erro = ?, atualizado_em = ? WHERE id = ?', [msg, iso, tarefa.corte_id]]);
    }
    await db(env).batch(lotes);
    return json({ ok: true, desistiu: fim, tentativas });
  }

  return json({ erro: 'rota nao encontrada' }, 404);
}

// 19/11: video novo de um canal ja cortado antes herda o layout vertical do ultimo video desse
// canal (o streamer costuma manter a webcam no mesmo lugar). So se o video ainda nao tem layout.
// 19/11 (tarde): canal novo (sem historico) fica com o layout COM WEBCAM salvo por ultimo pelo
// dono - antes ficava "Nenhum" e o curto saia so horizontal, sem o vertical legendado.
// Autoria: Claude (Opus 5.5), Lab Hub, 19/11/2026.
async function herdarLayout(env, videoId) {
  await db(env).run(
    `UPDATE cortex_videos SET layout_id = COALESCE(
        (SELECT o.layout_id FROM cortex_videos o
          WHERE o.usuario_id = cortex_videos.usuario_id AND o.canal = cortex_videos.canal AND o.id <> cortex_videos.id
            AND o.layout_id IS NOT NULL ORDER BY o.id DESC LIMIT 1),
        (SELECT l.id FROM cortex_layouts l WHERE l.usuario_id = cortex_videos.usuario_id AND l.tipo = 'webcam'
          ORDER BY l.atualizado_em DESC, l.id DESC LIMIT 1))
      WHERE id = ? AND layout_id IS NULL`, videoId);
}

function versaoMin(v, min) {
  const p = String(v || '0').split('.').map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i++) { if ((p[i] || 0) !== min[i]) return (p[i] || 0) > min[i]; }
  return true;
}

// Junta frases curtas em blocos de ~30 s: menos linhas no banco e o roteiro da IA continua
// com o minuto exato de cada trecho.
function juntar(segs) {
  const limpos = segs
    .map((s) => ({ i: Number(s.i), f: Number(s.f), t: String(s.t || '').replace(/\s+/g, ' ').trim() }))
    .filter((s) => Number.isFinite(s.i) && Number.isFinite(s.f) && s.t)
    .sort((a, b) => a.i - b.i);
  const blocos = [];
  let atual = null;
  for (const s of limpos) {
    if (atual && s.i - atual.i < 30 && atual.t.length < 1200) {
      atual.f = Math.max(atual.f, s.f);
      atual.t += ' ' + s.t;
    } else {
      atual = { i: Math.round(s.i * 10) / 10, f: s.f, t: s.t };
      blocos.push(atual);
    }
  }
  for (const b of blocos) { b.f = Math.round(Math.max(b.f, b.i) * 10) / 10; b.t = b.t.slice(0, 4000); }
  return blocos;
}

// Groq (API compativel com a da OpenAI): Whisper na nuvem, segundos por hora de audio.
// opc.palavras (19/11, legenda): pede tambem o tempo de CADA palavra. Se a Groq recusar o pedido
// (400), refaz sem e reparte o tempo de cada frase entre as palavras dela.
// ---- 20/11: filtro de frase inventada pelo Whisper ----
const FANTASMA = /amara\.org|legendas? (pela|por) comunidade|legendado por|transcri[çc][ãa]o (por|de) |subt[ií]tulos? (por|realizados)|obrigad[oa] por assistir|inscreva-se no canal|portugu[eê]s do brasil de um trecho|trecho de live,? com pontua|contexto e nomes:/i;
// o prompt que ia até a 2.6 ("Transcrição em português do Brasil de um trecho de live, com pontuação.")
const PROMPT_ANTIGO = 'transcrição português brasil trecho live pontuação contexto nomes';
const sem = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function palavrasChave(t) { return new Set(sem(t).split(/[^a-z0-9]+/).filter((w) => w.length > 2)); }
function trechoRuim(s, eco, buraco) {
  const lp = Number(s.avg_logprob), ns = Number(s.no_speech_prob), cr = Number(s.compression_ratio);
  const txt = String(s.text || '');
  if (FANTASMA.test(txt)) return true;
  if (cr > 2.4) return true;                               // texto em loop ("GTA de GTA 6, GTA de GTA 6...")
  if (lp < -1) return true;                                // o próprio Whisper sem confiança
  if (ns > 0.5 && lp < -0.5) return true;                  // provável trecho sem fala
  if (buraco && (lp < -0.6 || ns > 0.35)) return true;     // buraco refeito: só fala clara entra
  // eco do prompt/contexto: quase todas as palavras do trecho estão no contexto
  const ws = sem(txt).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  if (ws.length >= 2 && ws.filter((w) => eco.has(w)).length / ws.length >= 0.85) return true;
  return false;
}
const NAO_NOME = new Set(['convidado', 'convidados', 'convidada', 'live', 'ex', 'eles', 'ela', 'ele', 'hoje', 'depois', 'durante', 'numa', 'num']);
// Só os NOMES do contexto escrito pelo dono (palavras com maiúscula e números: "Coringa, Tainá Costa, GTA 6").
function nomesDoContexto(ctx) {
  const vistos = new Set(), out = [];
  for (const m of String(ctx || '').matchAll(/\b[\p{Lu}][\p{L}'’]+(?:\s+(?:[\p{Lu}][\p{L}'’]+|\d+))*|\b[A-Z]{2,}\s?\d+\b/gu)) {
    const n = m[0].trim(); const k = n.toLowerCase();
    if (n.length > 2 && !vistos.has(k) && !NAO_NOME.has(k)) { vistos.add(k); out.push(n); }
  }
  return out.join(', ').slice(0, 160);
}

async function transcreverGroq(env, audio, tipo, opc = {}) {
  const pedir = (comPalavras) => {
    const form = new FormData();
    const ext = tipo.includes('ogg') ? 'ogg' : tipo.includes('mpeg') ? 'mp3' : tipo.includes('mp4') ? 'm4a' : 'webm';
    form.append('file', new Blob([audio], { type: tipo }), 'parte.' + ext);
    form.append('model', opc.palavras ? GROQ_MODELO_LEGENDA : GROQ_MODELO);
    if (opc.idioma) form.append('language', opc.idioma);
    // 20/11: NADA de frase de instrução no prompt - em gameplay (barulho, música) o Whisper não acha
    // fala e REPETE o prompt como se fosse fala ("...em português do Brasil de um trecho de live").
    // Vai só uma lista curta de nomes (do contexto da live), e nunca no buraco refeito.
    const vocab = !opc.buraco ? nomesDoContexto(opc.contexto) : '';
    if (vocab) form.append('prompt', vocab);
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    if (comPalavras) { form.append('timestamp_granularities[]', 'word'); form.append('timestamp_granularities[]', 'segment'); }
    return fetch(env.CORTEX_GROQ_URL || 'https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { authorization: 'Bearer ' + env.GROQ_API_KEY }, body: form,
    });
  };
  let r;
  try {
    r = await pedir(!!opc.palavras);
    if (opc.palavras && r.status === 400) r = await pedir(false);
  } catch {
    return { erro: 'Groq fora do ar (rede). O PC tenta de novo.', status: 502 };
  }
  if (r.status === 429) {
    return { erro: 'Limite da Groq atingido; o PC espera e tenta de novo.', status: 429, esperar_s: Number(r.headers.get('retry-after')) || 120 };
  }
  if (!r.ok) {
    const txt = (await r.text().catch(() => '')).slice(0, 200);
    if (r.status === 401) return { erro: 'A Groq recusou a chave GROQ_API_KEY. Confira a chave no Cloudflare.', status: 503, definitivo: true };
    return { erro: `Groq respondeu ${r.status}: ${txt}`, status: 502 };
  }
  const j = await r.json();
  const segmentos = (j.segments || []).map((s) => ({ i: s.start, f: s.end, t: s.text }));
  if (!opc.palavras) return { segmentos };
  let palavras = (j.words || []).map((w) => ({ p: String(w.word || '').trim(), i: Number(w.start), f: Number(w.end) }))
    .filter((w) => w.p && Number.isFinite(w.i) && Number.isFinite(w.f));
  // 19/11 + 20/11: o Whisper "inventa" frase em trecho sem fala (gameplay, música): tira as palavras
  // dos trechos que ele mesmo marca como duvidosos (nota baixa, "sem fala", texto em loop), dos que
  // repetem o prompt/contexto e das frases-fantasma conhecidas. No buraco refeito, régua mais dura.
  const eco = palavrasChave(nomesDoContexto(opc.contexto) + ' ' + PROMPT_ANTIGO);
  const ruins = (j.segments || []).filter((s) => trechoRuim(s, eco, !!opc.buraco)).map((s) => [Number(s.start), Number(s.end)]);
  if (ruins.length) palavras = palavras.filter((w) => !ruins.some(([a, b]) => w.i >= a - 0.05 && w.f <= b + 0.05));
  if (!palavras.length) {
    // sem tempo por palavra: reparte o tempo da frase pelo tamanho de cada palavra
    for (const s of segmentos) {
      const ps = String(s.t || '').trim().split(/\s+/).filter(Boolean);
      const total = ps.reduce((n, x) => n + x.length, 0) || 1;
      let t = Number(s.i);
      for (const x of ps) { const d = (Number(s.f) - Number(s.i)) * (x.length / total); palavras.push({ p: x, i: t, f: t + d }); t += d; }
    }
  }
  palavras = palavras.slice(0, 20000).map((w) => ({ p: w.p.slice(0, 40), i: Math.round(w.i * 100) / 100, f: Math.round(Math.max(w.f, w.i) * 100) / 100 }));
  return { segmentos, palavras, idioma: j.language || null, descartados: ruins.slice(0, 200) };
}
