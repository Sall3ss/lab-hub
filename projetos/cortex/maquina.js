// projetos/cortex/maquina.js - rotas do AGENTE DO PC (etapa 2 do Cortex).
// Chega aqui /api/p/cortex/maquina/<resto>, SEM sessao de pessoa (ver a porta unica,
// functions/api/[[path]].js). Quem prova identidade e a chave do agente, no cabecalho
// "Authorization: Bearer cx_...", que o dono gerou na tela "PCs" (o banco so tem o hash).
//
//   POST /oi                              { versao, ferramentas } -> config do agente
//   POST /proxima                         pega a proxima tarefa da fila (ou { tarefa: null })
//   POST /tarefas/:id/prorrogar           { progresso? } estende o prazo (download longo)
//   POST /tarefas/:id/meta                { titulo, canal, duracao_s }
//   POST /tarefas/:id/texto?parte&total&fonte=legenda   { segmentos: [{ i, f, t }] }
//   POST /tarefas/:id/audio?parte&total&inicio          corpo = audio cru (ogg/opus) -> Groq
//   POST /tarefas/:id/roteiro            um passo do roteiro com a IA (etapa 3); resposta chega aos poucos
//   POST /tarefas/:id/concluir            { arquivo_local? }
//   POST /tarefas/:id/falhar              { erro, definitivo? }
//   POST /tarefas/:id/devolver            o dono desligou o PC no meio: volta para a fila sem contar falha
//   POST /tchau                           o PC foi desligado pelo atalho: aparece offline na hora
//
// O PC nunca recebe nada que nao seja dele: toda consulta filtra pelo dono da chave.
// Autoria: Claude (Opus 5.5), Lab Hub, 14/11/2026.

import { db } from '../../lib/db.js';
import { passoRoteiro } from './roteiro.js';

export const AGENTE_VERSAO = '1.5.0';     // muda junto com public/projetos/cortex/agente/cortex-agente.mjs
const PRAZO_MIN = { texto: 30, baixar_corte: 60, roteiro: 20 };
const VERSAO_ROTEIRO = [1, 3, 0];       // agente mais velho nao sabe fazer 'roteiro': nao recebe
const MAX_TENTATIVAS = 3;
const VISTO_A_CADA_MS = 60 * 1000;      // grava "visto_em" no maximo 1x por minuto (poupa escrita no D1)
const GROQ_MODELO = 'whisper-large-v3-turbo';
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
    'SELECT id, usuario_id, nome, baixa_cortes, visto_em, versao FROM cortex_agentes WHERE chave_hash = ? AND revogado_em IS NULL',
    await hashChave(chave));
  if (!ag) return json({ erro: 'Este PC foi desconectado ou a chave não existe. Gere uma nova na tela "PCs".', revogado: true }, 401);
  if (metodo !== 'POST') return json({ erro: 'use POST' }, 405);

  const agora = new Date();
  const iso = agora.toISOString();
  const [rota, id, acao] = partes;

  if (rota === 'oi') {
    const corpo = await request.json().catch(() => ({}));
    await db(env).run('UPDATE cortex_agentes SET visto_em = ?, versao = ?, ferramentas = ? WHERE id = ?',
      iso, String(corpo.versao || '').slice(0, 20), JSON.stringify(corpo.ferramentas || {}).slice(0, 500), ag.id);
    return json({ ok: true, nome: ag.nome, baixa_cortes: !!ag.baixa_cortes, versao_atual: AGENTE_VERSAO, intervalo_s: 20 });
  }

  if (rota === 'tchau') {
    // "visto" fica 3 min no passado: a tela mostra offline na hora, mas guarda quando saiu.
    await db(env).run('UPDATE cortex_agentes SET visto_em = ? WHERE id = ?', new Date(agora.getTime() - 3 * 60000).toISOString(), ag.id);
    return json({ ok: true });
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
    const tipos = '(' + lista.map((x) => `'${x}'`).join(', ') + ')';
    // Duas tentativas: se outro PC pegar a mesma tarefa no mesmo instante, tenta a seguinte.
    for (let i = 0; i < 2; i++) {
      const t = await db(env).first(
        `SELECT id, tipo, video_id, corte_id, tentativas FROM cortex_tarefas
          WHERE usuario_id = ? AND estado = 'pendente' AND tipo IN ${tipos} ORDER BY id LIMIT 1`, ag.usuario_id);
      if (!t) return json({ tarefa: null });
      const prazo = new Date(agora.getTime() + PRAZO_MIN[t.tipo] * 60000).toISOString();
      const r = await db(env).run(
        "UPDATE cortex_tarefas SET estado = 'pega', agente_id = ?, pega_ate = ?, progresso = NULL, atualizada_em = ? WHERE id = ? AND estado = 'pendente'",
        ag.id, prazo, iso, t.id);
      if (!r.meta.changes) continue;
      const video = await db(env).first(
        'SELECT id, url, plataforma, titulo, canal, duracao_s, criado_em FROM cortex_videos WHERE id = ?', t.video_id);
      let corte = null;
      if (t.corte_id) {
        corte = await db(env).first(
          'SELECT id, tipo, inicio_s, fim_s, titulo, descricao, tags, gancho FROM cortex_cortes WHERE id = ?', t.corte_id);
        if (corte) {
          try { corte.tags = JSON.parse(corte.tags || '[]'); } catch { corte.tags = []; }
          // numero do corte dentro do video (01, 02...) para o nome do arquivo seguir a ordem do tempo
          const n = await db(env).first(
            "SELECT COUNT(*) AS n FROM cortex_cortes WHERE video_id = ? AND tipo = ? AND estado <> 'descartado' AND inicio_s < ?",
            t.video_id, corte.tipo, corte.inicio_s);
          corte.numero = (n ? n.n : 0) + 1;
        }
      }
      if (t.tipo !== 'baixar_corte') {
        await db(env).run("UPDATE cortex_videos SET erro = NULL, atualizado_em = ? WHERE id = ?", iso, t.video_id);
      }
      return json({ tarefa: { id: t.id, tipo: t.tipo, tentativa: t.tentativas + 1, prazo, video, corte } });
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
    await db(env).run(
      `UPDATE cortex_videos SET titulo = COALESCE(titulo, ?), canal = COALESCE(?, canal), duracao_s = COALESCE(?, duracao_s),
              atualizado_em = ? WHERE id = ?`,
      c.titulo ? String(c.titulo).slice(0, 200) : null, c.canal ? String(c.canal).slice(0, 120) : null, dur, iso, tarefa.video_id);
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
    if (parte === 0) {
      lotes.push(['DELETE FROM cortex_transcricao WHERE video_id = ?', [tarefa.video_id]]);
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
      lotes.push(["UPDATE cortex_videos SET etapa = 'roteiro', fonte_texto = ?, erro = NULL, atualizado_em = ? WHERE id = ?", [fonte, iso, tarefa.video_id]]);
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
      catch (e) { res = { erro: String(e.message || e).slice(0, 300), esperar_s: e.esperar_s, definitivo: !!e.definitivo }; }
      clearInterval(bate);
      try { await w.write(enc.encode(JSON.stringify(res))); await w.close(); } catch { /* o PC desligou no meio */ }
    })();
    if (waitUntil) waitUntil(trabalho);
    return new Response(readable, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }

  if (acao === 'concluir') {
    const corpo = await request.json().catch(() => ({}));
    const lotes = [["UPDATE cortex_tarefas SET estado = 'feita', progresso = NULL, erro = NULL, atualizada_em = ? WHERE id = ?", [iso, tarefa.id]]];
    if (tarefa.tipo === 'baixar_corte' && tarefa.corte_id) {
      lotes.push([
        "UPDATE cortex_cortes SET estado = 'edicao', arquivo_local = ?, qualidade = ?, erro = NULL, atualizado_em = ? WHERE id = ? AND estado = 'download'",
        [corpo.arquivo_local ? `${ag.nome}: ${String(corpo.arquivo_local).slice(0, 400)}` : null,
         corpo.qualidade ? String(corpo.qualidade).slice(0, 80) : null, iso, tarefa.corte_id]]);
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
      if (tarefa.tipo !== 'baixar_corte') lotes.push(['UPDATE cortex_videos SET erro = ?, atualizado_em = ? WHERE id = ?', [msg, iso, tarefa.video_id]]);
      else if (tarefa.corte_id) lotes.push(['UPDATE cortex_cortes SET erro = ?, atualizado_em = ? WHERE id = ?', [msg, iso, tarefa.corte_id]]);
    }
    await db(env).batch(lotes);
    return json({ ok: true, desistiu: fim, tentativas });
  }

  return json({ erro: 'rota nao encontrada' }, 404);
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
async function transcreverGroq(env, audio, tipo) {
  const form = new FormData();
  const ext = tipo.includes('ogg') ? 'ogg' : tipo.includes('mpeg') ? 'mp3' : tipo.includes('mp4') ? 'm4a' : 'webm';
  form.append('file', new Blob([audio], { type: tipo }), 'parte.' + ext);
  form.append('model', GROQ_MODELO);
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  let r;
  try {
    r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { authorization: 'Bearer ' + env.GROQ_API_KEY }, body: form,
    });
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
  return { segmentos: (j.segments || []).map((s) => ({ i: s.start, f: s.end, t: s.text })) };
}
