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
import { pedirFotos } from './cena.js';

const URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const TRECHO_S = 45 * 60;          // tamanho alvo do trecho lido por chamada
const MIN_LONGOS_S = 35 * 60;      // video menor que isso nao ganha corte longo
const PRAZO_GEMINI_MS = 150000;

// 19/11/2026: padrão de títulos, descrições e tags do canal, escrito pelo dono (resumido aqui sem
// perder regra). Vale para o roteiro (cortes novos) e para "Refazer textos" de um corte.
const PADRAO = `PADRÃO DE TÍTULOS, DESCRIÇÕES E TAGS DO CANAL (siga à risca):
Público: quem encontra o vídeo na página inicial e nas recomendações do YouTube. A pessoa clica
porque reconhece o criador ou se interessa pela situação. O objetivo é despertar curiosidade
suficiente para ela querer assistir, sem distorcer o conteúdo.

ANTES DE ESCREVER, analise: quem é a personalidade principal; quem mais participa; qual é o
acontecimento central; qual é o momento mais interessante; o que desperta curiosidade; se é Short
ou longo; que contexto da live importa; se algum título sugeriria algo que NÃO acontece.

TÍTULOS ("titulos": exatamente 3 opções, em MAIÚSCULAS):
- Comece pelo nome da personalidade ou do assunto principal (ex.: "CORINGA COMPROU UM CARRO NOVO
  E MOSTROU TUDO NA LIVE IRL", "TAINÁ NÃO ACEITOU A OPINIÃO DO CORINGA SOBRE OS SALGADOS").
- Curiosidade vinda do acontecimento REAL: reação inesperada, situação engraçada, momento
  inusitado, discussão/opinião, descoberta no jogo, jogada impressionante, tensão ou surpresa.
- NUNCA invente: conversa sobre aposta não é aposta cumprida; discussão não é briga; jogada boa não
  é vitória; "primeira vez" só se for confirmado no trecho.
- Curto e fácil de entender no celular: sem explicação desnecessária, sem repetir informação, sem
  vários assuntos no mesmo título, sem palavra que não acrescenta. Até 70 caracteres.
- As 3 opções exploram ÂNGULOS DIFERENTES (a reação de alguém, o inesperado, o resultado, uma fala
  engraçada ou polêmica, uma jogada/descoberta, a interação entre duas pessoas).
- "melhor" (1, 2 ou 3) = a mais forte; "porque_titulo" = o motivo em uma frase. Não escolha a mais
  exagerada: priorize clique COM fidelidade ao vídeo.
- Short: um acontecimento específico; o título funciona sozinho para quem não viu a live, nada
  genérico. Longo: pode apresentar a experiência/atividade principal sem listar tudo.
- Cortes da mesma live: cada um destaca o PRÓPRIO acontecimento; não repita a estrutura de título
  dos outros cortes desta live (a lista vem no pedido, quando houver).

DESCRIÇÃO ("descricao"):
- As 2 primeiras linhas são as mais importantes e explicam com naturalidade: quem participa, o
  jogo (se houver), a situação/assunto e o contexto da live original.
- Depois, um complemento breve (contextualiza, não conta tudo). Nada de texto longo, palavra-chave
  repetida, informação que não está no corte ou frase genérica que serviria para qualquer vídeo.
- Termine com uma linha de 3 a 6 hashtags relevantes (ex.: #Coringa #GTA6 #Loud). Nada aleatório.

TAGS ("tags"): de 8 a 15, cada uma um item da lista, sem #, na grafia normal (ex.: "Coringa",
"Loud Coringa", "GTA 6", "GTA VI", "Coringa GTA 6", "GTA 6 gameplay", "cortes Coringa",
"melhores momentos Coringa", "Shorts GTA 6"). Priorize: criador principal, quem aparece, o jogo,
o evento/atividade, o assunto do corte, termos do acontecimento e o formato (Shorts, cortes de
live). Só o que tem relação com o conteúdo.

THUMBNAIL ("thumbnail"): direção curta que COMPLEMENTA o título (não repete a frase): expressão
facial forte e natural, rosto do criador principal em destaque (os outros visíveis quando forem
importantes), elementos do acontecimento, poucos elementos, contraste, no máximo 2 ou 3 pontos
focais. Texto opcional com poucas palavras, complementar ao título.

TOM: português do Brasil natural, direto; chamativo sem exagero; sem frase artificial ou de
enchimento. NENHUM emoji em título, descrição, tags ou thumbnail.

"analise": em uma ou duas frases, qual é o acontecimento principal e o melhor gancho para o
público. "duvida": se faltar algo essencial (ex.: não dá para saber quem é o convidado), diga o
que falta em vez de inventar; se não faltar nada, deixe vazio.`;

const SISTEMA = `Você é editor-chefe de um canal brasileiro de CORTES de lives e vídeos de criadores
(YouTube, Shorts, TikTok, Reels). Seu trabalho: ler a transcrição com tempos, marcar os trechos
que viram cortes com alto CTR e alta retenção e escrever os textos de publicação de cada um.

Regras dos cortes:
- Use só o que está na transcrição. Os tempos que você devolve têm que existir nela.
- Um corte precisa se sustentar sozinho: quem não viu a live entende.
- Prefira: momentos engraçados, reações fortes, revelações, polêmicas, jogadas épicas, falhas,
  histórias com começo/meio/fim, opiniões fortes, interações entre as pessoas.
- Evite: silêncio, leitura de chat sem contexto, propaganda, pausas, papo arrastado.
- Qualidade acima de quantidade. Se o trecho não tem nada bom, devolva lista vazia.
- Gancho: a frase falada ou situação dos primeiros 3 segundos que segura quem está rolando o feed.
  "gancho_inicio" e "gancho_fim" = onde essa frase é dita no vídeo (HH:MM:SS, dentro do corte,
  de 2 a 20 segundos), tirados da transcrição.
- Nota de 0 a 100 = potencial real do corte. Seja exigente: 80+ só para o que é muito forte.
- Tempos no formato HH:MM:SS, contados desde o começo do vídeo.
- Personalidade principal: o dono do canal, salvo se o contexto/transcrição mostrar outra.

${PADRAO}`;

// Campos de texto de publicação (iguais no roteiro e no "Refazer textos").
const TEXTOS = {
  analise: { type: 'STRING', description: 'acontecimento principal e melhor gancho, 1-2 frases' },
  titulos: { type: 'ARRAY', items: { type: 'STRING' }, description: 'exatamente 3 títulos em MAIÚSCULAS, ângulos diferentes' },
  melhor: { type: 'INTEGER', description: '1, 2 ou 3' },
  porque_titulo: { type: 'STRING' },
  descricao: { type: 'STRING' },
  tags: { type: 'ARRAY', items: { type: 'STRING' } },
  thumbnail: { type: 'STRING' },
  duvida: { type: 'STRING' },
};
const REQ_TEXTOS = ['analise', 'titulos', 'melhor', 'porque_titulo', 'descricao', 'tags', 'thumbnail'];
const CORTE = {
  type: 'OBJECT',
  properties: {
    inicio: { type: 'STRING', description: 'HH:MM:SS' },
    fim: { type: 'STRING', description: 'HH:MM:SS' },
    gancho: { type: 'STRING' },
    gancho_inicio: { type: 'STRING', description: 'HH:MM:SS em que o gancho começa a ser dito' },
    gancho_fim: { type: 'STRING', description: 'HH:MM:SS em que o gancho termina' },
    ...TEXTOS,
    nota: { type: 'INTEGER' },
  },
  // 17/11: gancho_inicio/gancho_fim passaram a ser obrigatorios: opcionais, o Gemini quase
  // sempre deixava de fora (cortes chegavam sem o tempo do gancho).
  required: ['inicio', 'fim', 'gancho', 'gancho_inicio', 'gancho_fim', ...REQ_TEXTOS, 'nota'],
};
const ESQ_TEXTOS = { type: 'OBJECT', properties: TEXTOS, required: REQ_TEXTOS };
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
  constructor(msg, { esperar_s, definitivo, aviso } = {}) { super(msg); this.esperar_s = esperar_s; this.definitivo = definitivo; this.aviso = aviso; }
}

// Faz o proximo passo do roteiro deste video. Devolve { concluido, progresso }.
export async function passoRoteiro(env, tarefa) {
  if (!env.GEMINI_API_KEY) throw new ErroRoteiro('Falta a chave GEMINI_API_KEY no Cloudflare (a mesma da Jean).', { definitivo: true });
  const base = db(env);
  const video = await base.first('SELECT id, usuario_id, titulo, canal, plataforma, duracao_s, analisar_de_s, roteiro_de_s, contexto FROM cortex_videos WHERE id = ?', tarefa.video_id);
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
      // 19/11: roteiro pronto -> o PC tira a foto de cada curto (cena + previa do vertical)
      pedirFotos(video.usuario_id, video.id, agora),
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
      `INSERT INTO cortex_cortes (video_id, usuario_id, tipo, origem, inicio_s, fim_s, titulo, descricao, tags, gancho, gancho_inicio_s, gancho_fim_s, motivo, nota,
                                  titulos, titulo_porque, thumb, duvida, estado, criado_em, atualizado_em)
       VALUES (?, ?, ?, 'ia', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'triagem', ?, ?)`,
      [video.id, video.usuario_id, c.tipo, c.inicio_s, c.fim_s, c.titulo, c.descricao, JSON.stringify(c.tags), c.gancho,
       c.gancho_inicio_s, c.gancho_fim_s, c.motivo, c.nota, JSON.stringify(c.titulos), c.titulo_porque, c.thumb, c.duvida, agora, agora]]);
  }
  await db(env).batch(lotes);
}

async function lerTrecho(env, video, linhas, ini, fim, i, n) {
  const texto = linhas.map((l) => `[${hms(l.inicio_s)}] ${l.texto}`).join('\n');
  const usados = await titulosDaLive(env, video.id);
  const pedido = `${cabecalho(video)}${usados}
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
  const usados = await titulosDaLive(env, video.id);
  const linhas = assuntos.map((a) => `[${hms(a.i)} - ${hms(a.f)}] (força ${a.forca}) ${a.a}`).join('\n');
  const pedido = `${cabecalho(video)}${usados}
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
Canal: ${v.canal || '(desconhecido)'} · Plataforma: ${v.plataforma}` +
    (v.contexto ? `\nContexto da live (escrito pelo dono do canal, confie nele para nomes e situação): ${v.contexto}` : '');
}
// 19/11: títulos já usados nesta live, para a IA não repetir a mesma estrutura (padrão do dono).
async function titulosDaLive(env, videoId, menos) {
  const l = await db(env).all("SELECT titulo FROM cortex_cortes WHERE video_id = ? AND estado <> 'descartado' AND id <> ? ORDER BY inicio_s LIMIT 40", videoId, menos || 0);
  return l.length ? '\nTítulos já usados em outros cortes desta live (não repita a estrutura):\n' + l.map((x) => '- ' + x.titulo).join('\n') : '';
}

// Textos de publicação vindos da IA -> campos do corte (sem emoji, título da opção "melhor").
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
function semEmoji(t) { return String(t || '').replace(EMOJI, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim(); }
export function lerTextos(c) {
  const titulos = (Array.isArray(c.titulos) ? c.titulos : []).map((t) => semEmoji(t).replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR').slice(0, 120)).filter(Boolean).slice(0, 3);
  const k = Math.min(titulos.length, Math.max(1, Math.round(Number(c.melhor)) || 1)) - 1;
  return {
    titulo: titulos[k] || semEmoji(c.titulo).slice(0, 120) || null,
    titulos: titulos.length ? titulos : null,
    titulo_porque: semEmoji(c.porque_titulo).slice(0, 400) || null,
    descricao: semEmoji(c.descricao).slice(0, 3000) || null,
    tags: (Array.isArray(c.tags) ? c.tags : []).map((t) => semEmoji(t).replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean)
      .filter((t, i, a) => a.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i).slice(0, 15),
    thumb: semEmoji(c.thumbnail).slice(0, 800) || null,
    duvida: semEmoji(c.duvida).slice(0, 300) || null,
    motivo: semEmoji(c.analise || c.motivo).slice(0, 400) || null,
  };
}

// 19/11: "Refazer textos" de UM corte (botão na gaveta): lê a fala do trecho e devolve título(s),
// descrição, tags e thumbnail no padrão do canal. NÃO grava: o dono revisa e aperta Salvar.
export async function refazerTextos(env, corte, video) {
  if (!env.GEMINI_API_KEY) throw new ErroRoteiro('Falta a chave GEMINI_API_KEY no Cloudflare (a mesma da Jean).', { definitivo: true });
  let fala = '';
  try {
    const ps = corte.legenda ? JSON.parse(corte.legenda) : null;
    if (Array.isArray(ps) && ps.length) {
      // legenda do corte (palavra a palavra): frases com o tempo do vídeo original
      let linha = [], ini = null; const out = [];
      for (const w of ps) {
        if (ini === null) ini = w.i;
        linha.push(w.p);
        if (linha.length >= 14 || /[.!?…]$/.test(w.p)) { out.push(`[${hms(corte.inicio_s + ini)}] ${linha.join(' ')}`); linha = []; ini = null; }
      }
      if (linha.length) out.push(`[${hms(corte.inicio_s + ini)}] ${linha.join(' ')}`);
      fala = out.join('\n');
    }
  } catch { fala = ''; }
  if (!fala) {
    const linhas = await db(env).all(
      'SELECT inicio_s, texto FROM cortex_transcricao WHERE video_id = ? AND fim_s > ? AND inicio_s < ? ORDER BY inicio_s',
      video.id, corte.inicio_s, corte.fim_s);
    fala = linhas.map((l) => `[${hms(l.inicio_s)}] ${l.texto}`).join('\n');
  }
  if (!fala) throw new ErroRoteiro('Não há texto deste trecho para a IA ler (use "Transcrever para revisar" na legenda).');
  const usados = await titulosDaLive(env, video.id, corte.id);
  const pedido = `${cabecalho(video)}${usados}

Corte ${corte.tipo === 'longo' ? 'LONGO (vídeo horizontal no YouTube)' : 'CURTO (Short vertical)'} de ${hms(corte.inicio_s)} a ${hms(corte.fim_s)}.
Título atual (sugestão inicial; não troque à toa um título que já é bom): ${corte.titulo}
${corte.gancho ? 'Gancho: ' + corte.gancho + '\n' : ''}
Escreva os textos de publicação deste corte seguindo o padrão do canal.

Fala do trecho (cada linha começa com o tempo):
${fala.slice(0, 60000)}`;
  const { dados } = await perguntar(env, pedido, ESQ_TEXTOS);
  return lerTextos(dados);
}

// Valida o que veio da IA: tempo dentro do trecho, duracao dentro da faixa, campos aparados.
function limpar(lista, tipo, min, max) {
  const [dMin, dMax] = tipo === 'curto' ? [15, 180] : [5 * 60, 90 * 60];
  return (Array.isArray(lista) ? lista : []).map((c) => {
    let i = seg(c.inicio), f = seg(c.fim);
    if (i === null || f === null) return null;
    i = Math.max(min, Math.round(i)); f = Math.min(max, Math.round(f));
    if (f - i < dMin || f - i > dMax) return null;
    const tx = lerTextos(c);
    if (!tx.titulo) return null;
    const { gi, gf } = tempoGancho(c, tipo, i, f);
    return {
      gancho_inicio_s: gi, gancho_fim_s: gf,
      tipo, inicio_s: i, fim_s: f, ...tx,
      gancho: semEmoji(c.gancho).slice(0, 300) || null,
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
// 19/11: `opc.sistema` troca o papel da IA e `opc.imagem` ({ tipo, base64 }) manda uma foto
// junto (cena.js: qual e a cena do corte). Sem `opc`, e o roteiro de sempre.
export async function perguntar(env, pedido, esquema, opc = {}) {
  const modelos = [env.CORTEX_MODELO || 'gemini-3.8-flash', env.CORTEX_MODELO_RESERVA || 'gemini-3.5-flash-lite'];
  const configs = [
    { responseMimeType: 'application/json', responseSchema: esquema, maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'LOW' } },
    { responseMimeType: 'application/json', responseSchema: esquema, maxOutputTokens: 8192 },
    { responseMimeType: 'application/json', maxOutputTokens: 8192 },
  ];
  // 18/11: "ocupado" = falha passageira do Google (503 alta demanda, 500/502/504, rede, demora).
  // Antes contava como falha e, depois de 3, o video parava com erro; agora o PC espera e repete.
  let esperar = 0, ultimoErro = '', ocupado = false;
  for (const modelo of modelos) {
    for (let c = 0; c < configs.length; c++) {
      const corpo = {
        systemInstruction: { parts: [{ text: opc.sistema || SISTEMA }] },
        contents: [{ role: 'user', parts: [
          ...(opc.imagem ? [{ inlineData: { mimeType: opc.imagem.tipo, data: opc.imagem.base64 } }] : []),
          { text: pedido + (c === 2 ? '\n\nResponda SÓ com o JSON, no formato: ' + JSON.stringify(esquema) : '') }] }],
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
        ocupado = true;
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
      if ([500, 502, 503, 504].includes(r.status)) ocupado = true;
      ultimoErro = `${modelo}: ${r.status} ${msg}`;
      break;
    }
  }
  if (esperar) throw new ErroRoteiro('Limite do plano grátis do Gemini; o PC espera e tenta de novo.', { esperar_s: esperar, aviso: 'limite do Gemini grátis' });
  if (ocupado) throw new ErroRoteiro('Gemini sobrecarregado agora (' + ultimoErro.slice(0, 120) + '); o PC espera e tenta de novo.', { esperar_s: 90, aviso: 'Gemini sobrecarregado' });
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
