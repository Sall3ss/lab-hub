// projetos/jean/api.js - rotas do projeto "Jean".
// Chega aqui tudo que for /api/p/jean/<resto>, ja com sessao conferida pela porta
// unica (functions/api/[[path]].js). Tabelas deste projeto levam o prefixo jean_,
// para nunca se misturarem com as de outro projeto do hub.
//
//   GET    /conversas?q=...        lista (fixadas primeiro); q busca no titulo e nas falas
//   GET    /conversas/:id          conversa + mensagens
//   PATCH  /conversas/:id          { titulo?, fixada? }
//   DELETE /conversas/:id          apaga a conversa e as falas
//   POST   /mensagem               { conversa_id?, texto, de? } -> resposta em streaming (SSE)
//                                  de = slug do projeto de onde a Jean foi chamada
//   POST   /audio?conversa_id&de&pagina&voz&segundos   corpo = audio cru (Modo B, etapa 4)
//   POST   /falar                  { texto } -> voz da Jean em streaming (Modo C, etapa 4)
//   POST   /acoes/:id              { decisao: 'confirmar'|'recusar' } (cartao da proposta)
//   GET    /painel                 projetos (cartao, tarefas, notas) + memorias
//   PATCH  /tarefas/:id            { estado: 'aberta'|'feita' }
//   DELETE /tarefas/:id | /notas/:id | /memorias/:id
//
// A conversa so nasce no banco quando a primeira mensagem e enviada: "Nova conversa" na
// tela nao grava nada (fundamento: nao gravar sem intencao).
//
// Autoria: Claude (Opus 5.5), Lab Hub, 13/11/2026.

import { db } from '../../lib/db.js';
import { auditar } from '../../lib/audit.js';
import { responder, ErroMotor, transcrever, vozDoGemini } from './motor.js';
import { instrucaoDeSistema } from './personalidade.js';
import { contextoParaJean, dadosDoPainel, projetoPorSlug, todosOsProjetos } from './contexto.js';
import { declaracoes, executar, decidirAcao, publica, PROPOSTAS } from './ferramentas.js';

const MAX_TEXTO = 20000;         // caracteres por mensagem
const MAX_HISTORICO = 30;        // falas enviadas ao modelo (o plano gratis tem limite por minuto)

export async function rotas({ request, env, data, u, partes, metodo, json, waitUntil }) {
  const [rota, id] = partes;

  if (rota === 'ping' && metodo === 'GET') return json({ ok: true, projeto: 'jean' });

  if (rota === 'conversas' && !id && metodo === 'GET') {
    const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 100);
    const base = 'SELECT c.id, c.titulo, c.fixada, c.atualizada_em FROM jean_conversas c WHERE c.usuario_id = ?1';
    const ordem = ' ORDER BY c.fixada DESC, c.atualizada_em DESC LIMIT 200';
    if (!q) return json({ conversas: await db(env).all(base + ordem, u.id) });
    const termo = '%' + q.replace(/[%_\\]/g, (c) => '\\' + c) + '%';
    const filtro = ` AND (c.titulo LIKE ?2 ESCAPE '\\' OR EXISTS (SELECT 1 FROM jean_mensagens m
      WHERE m.conversa_id = c.id AND m.conteudo LIKE ?2 ESCAPE '\\'))`;
    return json({ conversas: await db(env).all(base + filtro + ordem, u.id, termo) });
  }

  if (rota === 'conversas' && id) {
    const conversa = await db(env).first(
      'SELECT id, titulo, fixada, criada_em, atualizada_em FROM jean_conversas WHERE id = ? AND usuario_id = ?',
      Number(id), u.id,
    );
    if (!conversa) return json({ erro: 'conversa não encontrada' }, 404);

    if (metodo === 'GET') {
      const mensagens = await db(env).all(
        'SELECT id, papel, conteudo, entrada, motor, extras, criada_em FROM jean_mensagens WHERE conversa_id = ? ORDER BY id',
        conversa.id,
      );
      const acoes = await db(env).all('SELECT id, ferramenta, argumentos, estado FROM jean_acoes WHERE conversa_id = ? AND usuario_id = ?', conversa.id, u.id);
      const porId = new Map(acoes.map((a) => [a.id, publica(a)]));
      for (const m of mensagens) {
        let ex = null;
        try { ex = m.extras ? JSON.parse(m.extras) : null; } catch { /* ignora */ }
        m.acoes = ((ex && ex.acoes) || []).map((id) => porId.get(id)).filter(Boolean);
        delete m.extras;
      }
      return json({ conversa, mensagens });
    }

    if (metodo === 'PATCH') {
      const corpo = await request.json().catch(() => ({}));
      const titulo = corpo.titulo !== undefined ? String(corpo.titulo).trim().slice(0, 120) : conversa.titulo;
      if (!titulo) return json({ erro: 'O título não pode ficar vazio.' }, 400);
      const fixada = corpo.fixada !== undefined ? (corpo.fixada ? 1 : 0) : conversa.fixada;
      await db(env).run('UPDATE jean_conversas SET titulo = ?, fixada = ? WHERE id = ?', titulo, fixada, conversa.id);
      return json({ ok: true, conversa: { ...conversa, titulo, fixada } });
    }

    if (metodo === 'DELETE') {
      await db(env).batch([
        ['DELETE FROM jean_mensagens WHERE conversa_id = ?', [conversa.id]],
        ["DELETE FROM jean_acoes WHERE conversa_id = ? AND estado = 'pendente'", [conversa.id]],
        ['DELETE FROM jean_conversas WHERE id = ?', [conversa.id]],
      ]);
      await auditar(env, {
        quem: u.email, acao: 'excluir', entidade: 'jean_conversas', entidade_id: conversa.id,
        antes: { titulo: conversa.titulo }, ip: data.ip,
      });
      return json({ ok: true });
    }
  }

  if (rota === 'mensagem' && metodo === 'POST') return await mensagem({ request, env, u, json, waitUntil });
  if (rota === 'audio' && metodo === 'POST') return await mensagemDeAudio({ request, env, u, json, waitUntil });
  if (rota === 'falar' && metodo === 'POST') return await falar({ request, env, json });

  if (rota === 'acoes' && id && metodo === 'POST') {
    const corpo = await request.json().catch(() => ({}));
    if (!['confirmar', 'recusar'].includes(corpo.decisao)) return json({ erro: 'decisão inválida' }, 400);
    const r = await decidirAcao(env, u, data.ip, Number(id), corpo.decisao);
    return json(r.corpo, r.status);
  }

  if (rota === 'painel' && metodo === 'GET') return json(await dadosDoPainel(env, u.id));

  if (rota === 'tarefas' && id && metodo === 'PATCH') {
    const corpo = await request.json().catch(() => ({}));
    if (!['aberta', 'feita'].includes(corpo.estado)) return json({ erro: 'estado inválido' }, 400);
    const r = await db(env).run(
      'UPDATE jean_tarefas SET estado = ?, concluida_em = ? WHERE id = ? AND usuario_id = ?',
      corpo.estado, corpo.estado === 'feita' ? new Date().toISOString() : null, Number(id), u.id,
    );
    if (!r.meta.changes) return json({ erro: 'tarefa não encontrada' }, 404);
    await auditar(env, { quem: u.email, acao: 'tarefa-' + corpo.estado, entidade: 'jean_tarefas', entidade_id: Number(id), ip: data.ip });
    return json({ ok: true });
  }

  const APAGAVEIS = { tarefas: 'jean_tarefas', notas: 'jean_notas', memorias: 'jean_memorias' };
  if (APAGAVEIS[rota] && id && metodo === 'DELETE') {
    const tabela = APAGAVEIS[rota];
    const antes = await db(env).first(`SELECT * FROM ${tabela} WHERE id = ? AND usuario_id = ?`, Number(id), u.id);
    if (!antes) return json({ erro: 'não encontrado' }, 404);
    await db(env).run(`DELETE FROM ${tabela} WHERE id = ? AND usuario_id = ?`, Number(id), u.id);
    await auditar(env, { quem: u.email, acao: 'excluir', entidade: tabela, entidade_id: Number(id), antes, ip: data.ip });
    return json({ ok: true });
  }

  return json({ erro: 'rota nao encontrada', projeto: 'jean' }, 404);
}

function tituloDe(texto) {
  const t = texto.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 57).trimEnd() + '...' : t;
}

async function mensagem({ request, env, u, json, waitUntil }) {
  const corpo = await request.json().catch(() => ({}));
  const texto = String(corpo.texto || '').trim();
  const op = opcoesDaFala(corpo);
  // "Tentar de novo" depois de um erro: a fala do usuario ja esta gravada, so falta a resposta.
  if (corpo.repetir && corpo.conversa_id) return await repetir({ env, u, json, conversaId: Number(corpo.conversa_id), waitUntil, ...op });
  if (!texto) return json({ erro: 'Escreva uma mensagem.' }, 400);
  if (texto.length > MAX_TEXTO) return json({ erro: `Mensagem longa demais (máximo ${MAX_TEXTO} caracteres).` }, 400);
  const conversa = await registrarFala(env, u, Number(corpo.conversa_id) || null, op.de, texto, 'texto', null);
  if (!conversa) return json({ erro: 'conversa não encontrada' }, 404);
  return responderEmStreaming({ env, u, conversa, waitUntil, ...op });
}

// de: projeto de onde a Jean foi chamada; pagina: tela aberta; voz: a resposta vai ser
// falada em voz alta (a Jean responde mais curto e sem lista/codigo).
function opcoesDaFala(o) {
  return {
    de: o.de && projetoPorSlug(String(o.de)) ? String(o.de) : null,
    pagina: o.pagina ? String(o.pagina).replace(/[\r\n]+/g, ' ').slice(0, 200) : null,
    voz: o.voz === true || o.voz === '1',
  };
}

async function registrarFala(env, u, conversaId, de, texto, entrada, extras) {
  const agora = () => new Date().toISOString();
  let conversa;
  if (conversaId) {
    conversa = await db(env).first('SELECT id, titulo FROM jean_conversas WHERE id = ? AND usuario_id = ?', conversaId, u.id);
    if (!conversa) return null;
  } else {
    const r = await db(env).run(
      'INSERT INTO jean_conversas (usuario_id, titulo, projeto_slug, criada_em, atualizada_em) VALUES (?, ?, ?, ?, ?)',
      u.id, tituloDe(texto), de, agora(), agora(),
    );
    conversa = { id: r.meta.last_row_id, titulo: tituloDe(texto), nova: true };
  }
  await db(env).run(
    "INSERT INTO jean_mensagens (conversa_id, papel, conteudo, entrada, extras, criada_em) VALUES (?, 'usuario', ?, ?, ?, ?)",
    conversa.id, texto, entrada, extras ? JSON.stringify(extras) : null, agora(),
  );
  await db(env).run('UPDATE jean_conversas SET atualizada_em = ? WHERE id = ?', agora(), conversa.id);
  return conversa;
}

// Modo B (etapa 4): audio gravado. O arquivo vem CRU no corpo (regra da casa: nada de
// base64 em JSON) e os dados na URL. O Gemini ouve, transcreve e percebe o tom; a
// transcricao entra na conversa como fala do dono e o audio NAO e guardado.
const MAX_AUDIO = 8 * 1024 * 1024;
const MIMES_AUDIO = { 'audio/webm': 'audio/webm', 'audio/ogg': 'audio/ogg', 'audio/mp4': 'audio/m4a', 'audio/m4a': 'audio/m4a', 'audio/x-m4a': 'audio/m4a', 'audio/aac': 'audio/aac', 'audio/mpeg': 'audio/mpeg', 'audio/mp3': 'audio/mp3', 'audio/wav': 'audio/wav', 'audio/x-wav': 'audio/wav', 'audio/flac': 'audio/flac', 'audio/opus': 'audio/opus' };

async function mensagemDeAudio({ request, env, u, json, waitUntil }) {
  const url = new URL(request.url);
  const op = opcoesDaFala(Object.fromEntries(url.searchParams));
  const tipo = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const mime = MIMES_AUDIO[tipo];
  if (!mime) return json({ erro: `Formato de áudio não aceito (${tipo || 'desconhecido'}).` }, 415);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return json({ erro: 'O áudio chegou vazio. Grave de novo.' }, 400);
  if (bytes.length > MAX_AUDIO) return json({ erro: 'Áudio grande demais (máximo de uns 8 MB, perto de 10 minutos).' }, 413);

  let ouvido;
  try { ouvido = await transcrever(env, bytes, mime, ['Jean', 'Lab Hub', 'Pulso', ...todosOsProjetos().map((p) => p.titulo)]); }
  catch (e) { return json({ erro: e instanceof ErroMotor ? e.message : 'Não foi possível ouvir o áudio agora. Tente de novo.' }, 502); }
  if (!ouvido.transcricao) return json({ erro: 'Não consegui entender o áudio. Fale mais perto do microfone e tente de novo.' }, 422);

  const conversa = await registrarFala(env, u, Number(url.searchParams.get('conversa_id')) || null, op.de,
    ouvido.transcricao.slice(0, MAX_TEXTO), 'audio', { tom: ouvido.tom || null, segundos: Number(url.searchParams.get('segundos')) || null });
  if (!conversa) return json({ erro: 'conversa não encontrada' }, 404);
  return responderEmStreaming({ env, u, conversa, waitUntil, ...op, ouvido });
}

// Modo C: a voz da Jean. Repassa o streaming do Google direto para a tela.
async function falar({ request, env, json }) {
  const corpo = await request.json().catch(() => ({}));
  const texto = limparParaVoz(String(corpo.texto || ''));
  if (!texto) return json({ erro: 'nada para falar' }, 400);
  if (env.JEAN_SIMULADO === '1') return json({ erro: 'modo simulado: use a voz do navegador', reserva: true }, 503);
  try {
    const { resposta, modelo } = await vozDoGemini(env, texto);
    return new Response(resposta.body, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-jean-voz': modelo },
    });
  } catch (e) {
    return json({ erro: e instanceof ErroMotor ? e.message : 'A voz do Gemini não respondeu.', reserva: true }, e && e.status === 429 ? 429 : 502);
  }
}

// Segunda limpeza (a tela ja limpa): nada de simbolo de Markdown ou endereco sendo lido.
function limparParaVoz(t) {
  return t
    .replace(/```[\s\S]*?```/g, ' Enviei o código na tela. ')
    .replace(/https?:\/\/\S+/g, 'o link na tela')
    .replace(/[*_#`>|~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000);
}

async function repetir({ env, u, json, conversaId, waitUntil, de, pagina, voz }) {
  const conversa = await db(env).first('SELECT id, titulo FROM jean_conversas WHERE id = ? AND usuario_id = ?', conversaId, u.id);
  if (!conversa) return json({ erro: 'conversa não encontrada' }, 404);
  const ultima = await db(env).first('SELECT papel FROM jean_mensagens WHERE conversa_id = ? ORDER BY id DESC LIMIT 1', conversa.id);
  if (!ultima || ultima.papel !== 'usuario') return json({ erro: 'Não há pergunta sem resposta nesta conversa.' }, 409);
  return responderEmStreaming({ env, u, conversa, waitUntil, de, pagina, voz });
}

function responderEmStreaming({ env, u, conversa, waitUntil, de, pagina, voz, ouvido }) {
  const agora = () => new Date().toISOString();
  const sistemaBase = instrucaoDeSistema({
    nomeDono: nomeBonito(u.nome),
    hoje: new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }),
  });

  const { readable, writable } = new TransformStream();
  const escritor = writable.getWriter();
  const enc = new TextEncoder();
  // A escrita NAO e aguardada: se a tela fechou e ninguem le, esperar a escrita trava o
  // trabalho para sempre e a resposta nao e gravada (visto no teste de 13/11). Quando a
  // tela cancela a leitura ("Parar" ou aba fechada), o fluxo da erro e clienteFoi liga.
  let clienteFoi = false;
  escritor.closed.catch(() => { clienteFoi = true; });
  const enviar = async (obj) => {
    if (clienteFoi) return;
    escritor.write(enc.encode('data: ' + JSON.stringify(obj) + '\n\n')).catch(() => { clienteFoi = true; });
  };

  // Sinal de vida a cada 15 s enquanto o modelo pensa: conexao parada e cortada no caminho.
  const pulso = setInterval(() => {
    if (!clienteFoi) escritor.write(enc.encode(': pulso\n\n')).catch(() => { clienteFoi = true; });
  }, 15000);
  const trabalho = (async () => {
    let resposta = '', fim = null, erro = null;
    const acoes = [];
    await enviar({ tipo: 'conversa', id: conversa.id, titulo: conversa.titulo, nova: !!conversa.nova });
    if (ouvido) await enviar({ tipo: 'transcricao', texto: ouvido.transcricao, tom: ouvido.tom || null });
    try {
      // Ultimas falas, em ordem. O modelo exige comecar pelo usuario.
      const falas = (await db(env).all(
        'SELECT papel, conteudo FROM jean_mensagens WHERE conversa_id = ? ORDER BY id DESC LIMIT ?',
        conversa.id, MAX_HISTORICO,
      )).reverse();
      while (falas.length && falas[0].papel !== 'usuario') falas.shift();
      // Fala que veio por audio: a Jean sabe disso e do tom percebido (so neste turno).
      if (ouvido && falas.length) {
        const ult = falas[falas.length - 1];
        ult.conteudo += `\n\n[Mensagem enviada por áudio${ouvido.tom ? '. Tom percebido na voz: ' + ouvido.tom : ''}.]`;
      }
      let sistema = sistemaBase + '\n\n' + await contextoParaJean(env, u.id, de, pagina);
      if (voz) sistema += '\n\n## Esta resposta vai ser FALADA em voz alta\nResponda como numa conversa falada: curto (até umas 4 frases), sem listas longas, sem tabela e sem código, a menos que o dono peça. Se precisar de código ou lista longa, diga que deixou na tela.';
      const exec = (nome, args) => executar(env, u, conversa.id, nome, args);
      for await (const p of responder(env, { sistema, historico: falas, ferramentas: declaracoes(), executar: exec, propostas: PROPOSTAS })) {
        if (p.fim) { fim = p; break; }
        if (p.acao) { acoes.push(p.acao.id); await enviar({ tipo: 'acao', acao: p.acao }); continue; }
        resposta += p.texto;
        await enviar({ tipo: 'texto', t: p.texto });
        if (clienteFoi) break; // apertou "Parar" ou fechou a tela: nao gasta cota a toa
      }
    } catch (e) {
      erro = e instanceof ErroMotor ? e.message : 'Não foi possível falar com o Gemini agora. Tente de novo.';
      if (!(e instanceof ErroMotor)) console.error('[jean/mensagem]', e && e.message);
    }
    // Grava o que chegou, mesmo que a pessoa tenha fechado a tela no meio.
    let mensagemId = null;
    if (resposta.trim() || acoes.length) {
      const extras = (acoes.length || fim?.ferramentas?.length) ? JSON.stringify({ acoes, ferramentas: fim?.ferramentas || [] }) : null;
      const r = await db(env).run(
        `INSERT INTO jean_mensagens (conversa_id, papel, conteudo, entrada, extras, motor, tokens_entrada, tokens_saida, criada_em)
         VALUES (?, 'jean', ?, 'texto', ?, ?, ?, ?, ?)`,
        conversa.id, resposta.trim() ? resposta : '(proposta abaixo)', extras, fim?.motor || null, fim?.entrada ?? null, fim?.saida ?? null, agora(),
      );
      mensagemId = r.meta.last_row_id;
      await db(env).run('UPDATE jean_conversas SET atualizada_em = ? WHERE id = ?', agora(), conversa.id);
    }
    if (erro) await enviar({ tipo: 'erro', erro });
    else await enviar({ tipo: 'fim', mensagem_id: mensagemId, motor: fim?.motor || null });
    escritor.close().catch(() => { /* cliente ja saiu */ });
  })();
  trabalho.finally(() => clearInterval(pulso)).catch(() => {});
  if (waitUntil) waitUntil(trabalho);

  return new Response(readable, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform' },
  });
}

function nomeBonito(nome) {
  return String(nome || '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()).trim();
}
