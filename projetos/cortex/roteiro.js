// projetos/cortex/roteiro.js - etapa 3 do Cortex: a IA le a transcricao e propoe os cortes.
//
// GRATIS na fase beta (pedido do dono, 14/11/2026): usa o Gemini no plano gratuito, com a
// mesma chave da Jean (GEMINI_API_KEY, secret do Pages). Trocar para o Claude depois e
// trocar so a funcao `perguntar` (o resto - trechos, validacao, gravacao - fica igual).
//
// Como anda (um PASSO por chamada do agente do PC, para cada chamada caber no tempo):
//   passos 0..n-1  um trecho de ~45 min da transcricao -> cortes CURTOS (45-90 s) + resumo
//                  dos assuntos do trecho com os tempos
//   passo n        so se o video tiver 35 min ou mais: le os resumos de todos os trechos e
//                  escolhe os cortes LONGOS (30-40 min)
// Cada passo grava uma linha em cortex_roteiro_partes; se cair no meio, recomeca de onde
// parou. Os cortes vao aparecendo na Triagem enquanto o roteiro anda.
//
// Autoria: Claude (Opus 5.5), Lab Hub, 14/11/2026.

import { db } from '../../lib/db.js';

const URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const TRECHO_S = 45 * 60;          // tamanho alvo do trecho lido por chamada
const MIN_LONGOS_S = 35 * 60;      // video menor que isso nao ganha corte longo
const PRAZO_GEMINI_MS = 150000;

const SISTEMA = `Você é editor-chefe de um canal brasileiro de CORTES de lives e vídeos de games
(YouTube, TikTok, Shorts, Reels), com foco no lançamento do GTA 6 e no que bomba na comunidade.
Seu trabalho: ler a transcrição com tempos e marcar os trechos que viram cortes com alto CTR e
alta retenção.

Regras:
- Use só o que está na transcrição. Os tempos que você devolve têm que existir nela.
- Um corte precisa se sustentar sozinho: quem não viu a live entende.
- Prefira: momentos engraçados, reações fortes, revelações, polêmicas, jogadas épicas, falhas,
  histórias com começo/meio/fim, opiniões fortes, informação nova sobre GTA 6.
- Evite: silêncio, leitura de chat sem contexto, propaganda, pausas, papo arrastado.
- Qualidade acima de quantidade. Se o trecho não tem nada bom, devolva lista vazia.
- Título em português do Brasil, chamativo e honesto (sem prometer o que o corte não entrega),
  até 90 caracteres, sem ser tudo em maiúsculas.
- Gancho: a frase falada ou situação dos primeiros 3 segundos que segura quem está rolando o feed.
  "gancho_inicio" e "gancho_fim" = onde essa frase é dita no vídeo (HH:MM:SS, dentro do corte,
  de 2 a 20 segundos), tirados da transcrição.
- Descrição: 1 a 3 frases para a plataforma. Tags: 5 a 12, minúsculas, sem #.
- Nota de 0 a 100 = potencial real do corte. Seja exigente: 80+ só para o que é muito forte.
- Tempos no formato HH:MM:SS, contados desde o começo do vídeo.`;

const CORTE = {
  type: 'OBJECT',
  properties: {
    inicio: { type: 'STRING', description: 'HH:MM:SS' },
    fim: { type: 'STRING', description: 'HH:MM:SS' },
    titulo: { type: 'STRING' },
    gancho: { type: 'STRING' },
    gancho_inicio: { type: 'STRING', description: 'HH:MM:SS em que o gancho começa a ser dito' },
    gancho_fim: { type: 'STRING', description: 'HH:MM:SS em que o gancho termina' },
    descricao: { type: 'STRING' },
    tags: { type: 'ARRAY', items: { type: 'STRING' } },
    motivo: { type: 'STRING', description: 'por que vale cortar, em uma frase' },
    nota: { type: 'INTEGER' },
  },
  // 17/11: gancho_inicio/gancho_fim passaram a ser obrigatorios: opcionais, o Gemini quase
  // sempre deixava de fora (cortes chegavam sem o tempo do gancho).
  required: ['inicio', 'fim', 'titulo', 'gancho', 'gancho_inicio', 'gancho_fim', 'descricao', 'tags', 'motivo', 'nota'],
};
const ESQ_TRECHO = {
  type: 'OBJECT',
  properties: {
    assuntos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { inicio: { type: 'STRING' }, fim: { type: 'STRING' }, assunto: { type: 'STRING' }, forca: { type: 'INTEGER' } },
        required: ['inicio', 'fim', 'assunto', 'forca'],
      },
    },
    curtos: { type: 'ARRAY', items: CORTE },
  },
  required: ['assuntos', 'curtos'],
};
const ESQ_LONGOS = { type: 'OBJECT', properties: { longos: { type: 'ARRAY', items: CORTE } }, required: ['longos'] };

export class ErroRoteiro extends Error {
  constructor(msg, { esperar_s, definitivo } = {}) { super(msg); this.esperar_s = esperar_s; this.definitivo = definitivo; }
}

// Faz o proximo passo do roteiro deste video. Devolve { concluido, progresso }.
export async function passoRoteiro(env, tarefa) {
  if (!env.GEMINI_API_KEY) throw new ErroRoteiro('Falta a chave GEMINI_API_KEY no Cloudflare (a mesma da Jean).', { definitivo: true });
  const base = db(env);
  const video = await base.first('SELECT id, usuario_id, titulo, canal, plataforma, duracao_s, analisar_de_s, roteiro_de_s FROM cortex_videos WHERE id = ?', tarefa.video_id);
  if (!video) throw new ErroRoteiro('vídeo não existe mais', { definitivo: true });
  const ext = await base.first('SELECT MAX(fim_s) AS fim, COUNT(*) AS n FROM cortex_transcricao WHERE video_id = ?', video.id);
  if (!ext || !ext.n) throw new ErroRoteiro('o vídeo não tem transcrição; use "Tentar de novo" na etapa de texto', { definitivo: true });

  // 16/11: com "analisar de" marcado, a transcricao comeca no meio do video; os trechos da IA
  // partem dali (nada de passos lendo horas vazias). `dur` = onde o texto termina.
  // 18/11: depois de "Puxar o resto", roteiro_de_s = onde comeca a parte nova (so ela e lida).
  const base0 = Math.max(0, Number(video.roteiro_de_s ?? video.analisar_de_s) || 0);
  video.base0 = base0;
  const dur = Math.max(Number(ext.fim) || 0, base0 + 60);
  const span = dur - base0;
  const n = Math.max(1, Math.round(span / TRECHO_S));
  const passo = span / n;
  const comLongos = span >= MIN_LONGOS_S;
  const totalPassos = n + (comLongos ? 1 : 0);
  const feitas = await base.all('SELECT parte, resumo, cortes FROM cortex_roteiro_partes WHERE video_id = ? ORDER BY parte', video.id);
  const proxima = feitas.length ? Math.max(...feitas.map((f) => f.parte)) + 1 : 0;
  const agora = new Date().toISOString();
  let cortesAte = feitas.reduce((s, f) => s + (f.cortes || 0), 0);

  if (proxima < totalPassos) {
    let r;
    if (proxima < n) {
      const ini = Math.floor(base0 + proxima * passo), fim = proxima === n - 1 ? Math.ceil(dur) + 1 : Math.floor(base0 + (proxima + 1) * passo);
      // 30 s de folga antes do trecho: um momento que comeca na divisa nao se perde.
      const linhas = await base.all(
        'SELECT inicio_s, fim_s, texto FROM cortex_transcricao WHERE video_id = ? AND inicio_s >= ? AND inicio_s < ? ORDER BY inicio_s',
        video.id, Math.max(base0, ini - 30), fim);
      r = await lerTrecho(env, video, linhas, ini, fim, proxima, n);
      await gravar(env, video, proxima, ini, fim, r, agora);
    } else {
      const assuntos = feitas.flatMap((f) => { try { return JSON.parse(f.resumo || '[]'); } catch { return []; } });
      r = await escolherLongos(env, video, assuntos, base0, dur);
      await gravar(env, video, proxima, base0, Math.ceil(dur), r, agora);
    }
    cortesAte += r.cortes.length;
  }

  const feitos = Math.min(proxima + 1, totalPassos);
  if (feitos >= totalPassos) {
    await base.batch([
      ["UPDATE cortex_videos SET etapa = 'cortado', erro = NULL, atualizado_em = ? WHERE id = ? AND etapa = 'roteiro'", [agora, video.id]],
      ["UPDATE cortex_tarefas SET estado = 'feita', progresso = NULL, erro = NULL, atualizada_em = ? WHERE id = ?", [agora, tarefa.id]],
    ]);
    return { concluido: true, cortes: cortesAte, progresso: `roteiro pronto: ${cortesAte} cortes` };
  }
  const prox = feitos < n ? `IA lendo trecho ${feitos + 1} de ${n}` : 'IA escolhendo os cortes longos';
  const progresso = `${prox} · ${cortesAte} ${cortesAte === 1 ? 'corte' : 'cortes'} até agora`;
  const prazo = new Date(Date.now() + 20 * 60000).toISOString();
  await base.run('UPDATE cortex_tarefas SET progresso = ?, pega_ate = ?, atualizada_em = ? WHERE id = ?', progresso, prazo, agora, tarefa.id);
  return { concluido: false, cortes: cortesAte, progresso };
}

async function gravar(env, video, parte, ini, fim, r, agora) {
  const lotes = [[
    `INSERT INTO cortex_roteiro_partes (video_id, parte, inicio_s, fim_s, resumo, cortes, modelo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (video_id, parte) DO NOTHING`,
    [video.id, parte, ini, fim, JSON.stringify(r.assuntos || []), r.cortes.length, r.modelo, agora]]];
  for (const c of r.cortes) {
    lotes.push([
      `INSERT INTO cortex_cortes (video_id, usuario_id, tipo, origem, inicio_s, fim_s, titulo, descricao, tags, gancho, gancho_inicio_s, gancho_fim_s, motivo, nota, estado, criado_em, atualizado_em)
       VALUES (?, ?, ?, 'ia', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'triagem', ?, ?)`,
      [video.id, video.usuario_id, c.tipo, c.inicio_s, c.fim_s, c.titulo, c.descricao, JSON.stringify(c.tags), c.gancho,
       c.gancho_inicio_s, c.gancho_fim_s, c.motivo, c.nota, agora, agora]]);
  }
  await db(env).batch(lotes);
}

async function lerTrecho(env, video, linhas, ini, fim, i, n) {
  const texto = linhas.map((l) => `[${hms(l.inicio_s)}] ${l.texto}`).join('\n');
  const pedido = `${cabecalho(video)}
Trecho ${i + 1} de ${n}: de ${hms(ini)} a ${hms(fim)}.

Tarefa:
1. "assuntos": divida o trecho em assuntos/momentos de 2 a 10 minutos (inicio, fim, assunto em
   até 15 palavras, forca de 0 a 100 = quanto aquilo prende quem assiste). Cubra o trecho todo.
2. "curtos": de 0 a 4 cortes CURTOS de 45 a 90 segundos (vertical, Shorts/TikTok/Reels), só os
   que valem de verdade. O corte começa já no gancho, sem introdução.

Transcrição (cada linha começa com o tempo em que a fala começa):
${texto || '(trecho sem fala)'}`;
  const { dados, modelo } = await perguntar(env, pedido, ESQ_TRECHO);
  const assuntos = (Array.isArray(dados.assuntos) ? dados.assuntos : []).map((a) => ({
    i: seg(a.inicio), f: seg(a.fim), a: String(a.assunto || '').slice(0, 160), forca: limitar(a.forca),
  })).filter((a) => a.i !== null && a.f !== null && a.f > a.i && a.a).slice(0, 40);
  const cortes = limpar(dados.curtos, 'curto', Math.max(video.base0 || 0, ini - 30), fim + 90)
    .filter((c, k, todos) => !todos.slice(0, k).some((o) => sobrepoe(o, c)));
  // Nao repetir um curto que ja saiu no trecho anterior (folga de 30 s na divisa).
  const ja = await db(env).all("SELECT inicio_s, fim_s FROM cortex_cortes WHERE video_id = ? AND tipo = 'curto' AND origem = 'ia'", video.id);
  return { assuntos, cortes: cortes.filter((c) => !ja.some((o) => sobrepoe(o, c))), modelo };
}

async function escolherLongos(env, video, assuntos, ini, dur) {
  if (!assuntos.length) return { assuntos: [], cortes: [], modelo: null };
  const max = Math.max(1, Math.min(6, Math.floor((dur - ini) / (40 * 60))));
  const linhas = assuntos.map((a) => `[${hms(a.i)} - ${hms(a.f)}] (força ${a.forca}) ${a.a}`).join('\n');
  const pedido = `${cabecalho(video)}
${ini > 0 ? `Parte analisada: de ${hms(ini)} a ${hms(dur)} (o começo do vídeo ficou de fora, de propósito).` : `Duração total: ${hms(dur)}.`}

Abaixo está o mapa de assuntos ${ini > 0 ? 'dessa parte' : 'do vídeo inteiro'} (já resumido por trechos).
Tarefa: "longos" = de 1 a ${max} cortes LONGOS de 30 a 40 minutos (vídeo horizontal no YouTube),
sem se sobrepor, cada um com um fio condutor (um tema, uma sequência, uma história). Comece e
termine em divisas de assunto. Prefira os blocos com mais força.

Mapa de assuntos:
${linhas}`;
  const { dados, modelo } = await perguntar(env, pedido, ESQ_LONGOS);
  const cortes = limpar(dados.longos, 'longo', ini, Math.ceil(dur) + 1)
    .filter((c, k, todos) => !todos.slice(0, k).some((o) => sobrepoe(o, c))).slice(0, max);
  return { assuntos: [], cortes, modelo };
}

function cabecalho(v) {
  return `Vídeo: ${v.titulo || '(sem título)'}
Canal: ${v.canal || '(desconhecido)'} · Plataforma: ${v.plataforma}`;
}

// Valida o que veio da IA: tempo dentro do trecho, duracao dentro da faixa, campos aparados.
function limpar(lista, tipo, min, max) {
  const [dMin, dMax] = tipo === 'curto' ? [15, 180] : [5 * 60, 90 * 60];
  return (Array.isArray(lista) ? lista : []).map((c) => {
    let i = seg(c.inicio), f = seg(c.fim);
    if (i === null || f === null) return null;
    i = Math.max(min, Math.round(i)); f = Math.min(max, Math.round(f));
    if (f - i < dMin || f - i > dMax) return null;
    const titulo = String(c.titulo || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!titulo) return null;
    const { gi, gf } = tempoGancho(c, tipo, i, f);
    return {
      gancho_inicio_s: gi, gancho_fim_s: gf,
      tipo, inicio_s: i, fim_s: f, titulo,
      gancho: String(c.gancho || '').trim().slice(0, 300) || null,
      descricao: String(c.descricao || '').trim().slice(0, 1500) || null,
      tags: (Array.isArray(c.tags) ? c.tags : []).map((t) => String(t).replace(/^#/, '').trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 15),
      motivo: String(c.motivo || '').trim().slice(0, 400) || null,
      nota: limitar(c.nota),
    };
  }).filter(Boolean);
}

// Tempo do gancho. 15/11 descartava qualquer tempo fora do corte, e quase todos caiam fora:
// a transcricao vem em blocos de ~30 s, entao a IA aponta o comeco do BLOCO (alguns segundos
// antes do corte). 17/11: tempo perto do corte (ate 30 s fora) e trazido para dentro; sem
// tempo nenhum, o CURTO usa o proprio comeco (a regra do roteiro e "o corte comeca no gancho")
// e a duracao estimada pela frase (~2,5 palavras/s). Longo sem tempo continua vazio.
export function tempoGancho(c, tipo, i, f) {
  const fala = Math.min(15, Math.max(2, Math.round(String(c.gancho || '').split(/\s+/).filter(Boolean).length / 2.5)));
  let gi = seg(c.gancho_inicio), gf = seg(c.gancho_fim);
  if (gi !== null && (gi < i - 30 || gi >= f)) gi = null;
  if (gi === null) {
    if (tipo !== 'curto') return { gi: null, gf: null };
    gi = i; gf = null;
  }
  gi = Math.max(i, Math.round(gi));
  if (gf === null || gf <= gi || gf - gi > 60) gf = gi + fala;
  gf = Math.min(f, Math.round(gf));
  if (gf - gi < 1) return { gi: null, gf: null };
  return { gi, gf };
}

function sobrepoe(a, b) {
  const ai = a.inicio_s, af = a.fim_s, bi = b.inicio_s, bf = b.fim_s;
  const comum = Math.min(af, bf) - Math.max(ai, bi);
  return comum > 0.5 * Math.min(af - ai, bf - bi);
}
function limitar(n) { const v = Math.round(Number(n)); return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null; }
export function hms(s) {
  s = Math.max(0, Math.floor(Number(s) || 0));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, '0')).join(':');
}
export function seg(t) {
  if (typeof t === 'number' && Number.isFinite(t)) return t;
  const m = String(t || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,]\d+)?$/);
  if (!m) return null;
  return (Number(m[1]) || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// ---------------------------------------------------------------- Gemini (plano gratis)
// Modelos trocaveis sem codigo: CORTEX_MODELO e CORTEX_MODELO_RESERVA no Pages.
// CORTEX_GEMINI_URL so existe para o teste local com um Google de mentira.
// Configuracoes da mais completa para a mais simples: se o Google recusar uma (400), cai
// para a seguinte em vez de falhar.
async function perguntar(env, pedido, esquema) {
  const modelos = [env.CORTEX_MODELO || 'gemini-3.8-flash', env.CORTEX_MODELO_RESERVA || 'gemini-3.5-flash-lite'];
  const configs = [
    { responseMimeType: 'application/json', responseSchema: esquema, maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'LOW' } },
    { responseMimeType: 'application/json', responseSchema: esquema, maxOutputTokens: 8192 },
    { responseMimeType: 'application/json', maxOutputTokens: 8192 },
  ];
  let esperar = 0, ultimoErro = '';
  for (const modelo of modelos) {
    for (let c = 0; c < configs.length; c++) {
      const corpo = {
        systemInstruction: { parts: [{ text: SISTEMA }] },
        contents: [{ role: 'user', parts: [{ text: pedido + (c === 2 ? '\n\nResponda SÓ com o JSON, no formato: ' + JSON.stringify(esquema) : '') }] }],
        generationConfig: configs[c],
      };
      let r;
      try {
        r = await fetch((env.CORTEX_GEMINI_URL || URL_BASE) + encodeURIComponent(modelo) + ':generateContent', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
          body: JSON.stringify(corpo),
          signal: AbortSignal.timeout(PRAZO_GEMINI_MS),
        });
      } catch (e) {
        ultimoErro = `${modelo}: ${e.name === 'TimeoutError' ? 'demorou demais' : 'falha de rede'}`;
        break;   // proximo modelo
      }
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const cand = (j.candidates || [])[0] || {};
        const texto = ((cand.content || {}).parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join('');
        const dados = lerJson(texto);
        if (dados) return { dados, modelo };
        ultimoErro = `${modelo}: resposta fora do formato (${cand.finishReason || 'sem motivo'})`;
        break;
      }
      const msg = String((j.error && j.error.message) || r.status).slice(0, 160);
      if (r.status === 400 && c < configs.length - 1) continue;          // tenta a config mais simples
      if (r.status === 401 || r.status === 403) throw new ErroRoteiro('O Google recusou a chave GEMINI_API_KEY. Confira no Cloudflare.', { definitivo: true });
      if (r.status === 429) { esperar = Math.max(esperar, atrasoPedido(j) || 60); ultimoErro = `${modelo}: limite do plano grátis`; break; }
      ultimoErro = `${modelo}: ${r.status} ${msg}`;
      break;
    }
  }
  if (esperar) throw new ErroRoteiro('Limite do plano grátis do Gemini; o PC espera e tenta de novo.', { esperar_s: esperar });
  throw new ErroRoteiro('Gemini não respondeu: ' + ultimoErro);
}

function atrasoPedido(j) {
  const det = ((j.error || {}).details || []).find((d) => String(d['@type'] || '').includes('RetryInfo'));
  const m = det && String(det.retryDelay || '').match(/([\d.]+)s/);
  return m ? Math.ceil(Number(m[1])) + 2 : 0;
}

function lerJson(t) {
  try { return JSON.parse(t); } catch { /* tenta recortar */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* */ } }
  return null;
}
