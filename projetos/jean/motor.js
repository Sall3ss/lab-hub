// projetos/jean/motor.js - o "cerebro" da Jean. Hoje: Gemini no plano GRATUITO.
//
// A tela e as rotas nao sabem qual modelo responde: falam com `responder()`, que devolve
// pedacos de texto conforme chegam. Trocar de Gemini para Claude (se um dia valer pagar)
// e trocar este arquivo, sem mexer em mais nada.
//
// Modelos (conferidos na tabela de precos do Google em 13/11/2026, ambos com plano gratis):
//   principal  gemini-3.8-flash        (estavel)
//   reserva    gemini-3.5-flash-lite   (usado se o principal bater limite ou sair do ar)
// Podem ser trocados sem codigo pelas variaveis JEAN_MODELO e JEAN_MODELO_RESERVA no Pages.
//
// Ferramentas (etapa 3): o modelo pode pedir uma consulta ou propor uma acao
// (functionCall). O motor chama `executar`, devolve o resultado (functionResponse) e o
// modelo continua, em ate MAX_RODADAS. As partes que o modelo mandou voltam EXATAMENTE como
// vieram: o Gemini 3 assina as chamadas (thoughtSignature) e recusa historico alterado.
//
// Tempo (14/11/2026, erro 524 no ar): o modelo pensava em silencio antes da 1a palavra e
// a chamada passava de 100 s sem resposta, quando a Cloudflare corta. Por isso: pensamento
// curto (JEAN_PENSAMENTO, padrao "low") e includeThoughts, para o resumo do pensamento ir
// chegando e a conexao nao ficar parada. 524/504 tambem caem para o modelo reserva.
//
// ⚠️ Plano gratis: o Google pode usar o conteudo para melhorar os produtos dele, e ha
// limite de pedidos por minuto e por dia. Ver projetos/jean/PROJETO.md.
//
// Modo simulado (JEAN_SIMULADO=1): responde sem chamar ninguem. Existe para testar a tela
// nesta maquina, onde a chave NAO pode morar (regra da casa).
//
// Autoria: Claude (Opus 5.5), Lab Hub, 13/11/2026.

const URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const MAX_RODADAS = 6;
const PRAZO_INICIO_MS = 90000;   // para o Google comecar a responder
const PRAZO_SILENCIO_MS = 60000; // sem nenhum byte no meio da resposta

export class ErroMotor extends Error {
  constructor(mensagem, status) { super(mensagem); this.status = status; }
}

/**
 * Gera { texto } a cada pedaco, { acao } quando uma proposta vira cartao e, no fim,
 * { fim: true, motor, entrada, saida, ferramentas }.
 * historico: [{ papel: 'usuario'|'jean', conteudo }] terminando na fala do usuario.
 * ferramentas: declaracoes (functionDeclarations); executar(nome, args) -> { resposta, acao? }
 */
export async function* responder(env, { sistema, historico, ferramentas, executar, propostas = [], pensamento }) {
  if (env.JEAN_SIMULADO === '1') { yield* simulado(historico, executar); return; }
  if (!env.GEMINI_API_KEY) throw new ErroMotor('A chave do Gemini (GEMINI_API_KEY) não está configurada no Pages.', 503);

  const contents = historico.map((m) => ({ role: m.papel === 'jean' ? 'model' : 'user', parts: [{ text: m.conteudo }] }));
  // Configuracoes de pensamento, da preferida para a mais simples: se o Google recusar uma
  // (nome de nivel diferente num modelo), cai para a seguinte em vez de falhar.
  const pensamentos = [
    // Resposta que vai ser FALADA: pensamento minimo (14/11, conversa por voz lenta no PC).
    { thinkingConfig: { thinkingLevel: pensamento || env.JEAN_PENSAMENTO || 'LOW', includeThoughts: true } },
    { thinkingConfig: { includeThoughts: true } },
    null,
  ];
  const base = { systemInstruction: { parts: [{ text: sistema }] }, generationConfig: pensamentos.shift() };
  if (ferramentas && ferramentas.length) base.tools = [{ functionDeclarations: ferramentas }];

  let modelos = [env.JEAN_MODELO || 'gemini-3.8-flash', env.JEAN_MODELO_RESERVA || 'gemini-3.5-flash-lite'];
  let entrada = 0, saida = 0;
  const usadas = [];
  let textoTurno = '';

  for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
    let r;
    for (;;) {
      try {
        const corpo = { ...base, contents };
        if (!corpo.generationConfig) delete corpo.generationConfig;
        r = await chamar(env, modelos, JSON.stringify(corpo), rodada);
        break;
      } catch (e) {
        if (!e.recusouPensamento || !base.generationConfig) throw e;
        base.generationConfig = pensamentos.shift();
      }
    }
    // Depois da primeira resposta, fica no mesmo modelo: as assinaturas sao dele. Sem
    // modelo reserva nessas rodadas, o plano B e tentar o mesmo de novo (14/11: o 524 veio
    // justamente na 2a rodada, com a ficha dentro).
    modelos = [r.modelo, r.modelo];
    let fimLeitura = null;
    for await (const p of lerSSE(r.resposta)) {
      if (p.texto) { textoTurno += p.texto; yield { texto: p.texto }; }
      else fimLeitura = p;
    }
    entrada += fimLeitura.entrada || 0;
    saida += fimLeitura.saida || 0;

    const chamadas = fimLeitura.partes.filter((p) => p.functionCall);
    if (!chamadas.length && executar && propostas.length && anunciouSemChamar(textoTurno, usadas, propostas)) {
      // 14/11 no ar: a Jean escreveu "preparei uma tarefa, confirme no cartao" sem chamar a
      // ferramenta, e o cartao nao existia. Aqui o servidor cobra a chamada, com o modo
      // ANY (o Gemini e obrigado a chamar uma das ferramentas de proposta).
      contents.push({ role: 'model', parts: fimLeitura.partes });
      yield* cobrarProposta(env, r.modelo, base, contents, propostas, executar, usadas);
      yield { fim: true, motor: r.modelo, entrada, saida, ferramentas: usadas };
      return;
    }

    if (!chamadas.length || !executar) {
      if (fimLeitura.bloqueio) yield { texto: `\n\n_(O Gemini interrompeu esta resposta: ${fimLeitura.bloqueio}.)_` };
      yield { fim: true, motor: r.modelo, entrada, saida, ferramentas: usadas };
      return;
    }

    contents.push({ role: 'model', parts: fimLeitura.partes });
    const respostas = [];
    for (const c of chamadas) {
      const { name, args } = c.functionCall;
      usadas.push(name);
      const feito = await executar(name, args || {});
      if (feito.acao) yield { acao: feito.acao };
      respostas.push({ functionResponse: { name, response: feito.resposta } });
    }
    contents.push({ role: 'user', parts: respostas });
  }
  yield { texto: '\n\n_(Parei aqui: foram consultas demais para uma mensagem só.)_' };
  yield { fim: true, motor: modelos[0], entrada, saida, ferramentas: usadas };
}

// O texto diz que ha uma proposta/cartao esperando, mas nenhuma ferramenta de proposta
// foi chamada neste turno.
function anunciouSemChamar(texto, usadas, propostas) {
  if (usadas.some((n) => propostas.includes(n))) return false;
  return /(no cart[aã]o|confirm(e|ar) (a|o|no|na|abaixo)|preparei (uma|a|o)|propus|deixei (pronta|pronto)|aguardando (a )?(sua )?confirma)/i.test(texto);
}

async function* cobrarProposta(env, modelo, base, contents, propostas, executar, usadas) {
  const corpo = {
    ...base,
    contents: [...contents, { role: 'user', parts: [{ text: '[Aviso do sistema, não do dono] Você anunciou uma proposta, mas não chamou a ferramenta, então o cartão não apareceu. Chame AGORA a ferramenta da proposta que você anunciou, com os mesmos dados. Não escreva texto.' }] }],
    toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: propostas } },
  };
  if (!corpo.generationConfig) delete corpo.generationConfig;
  const falhou = '\n\n_(A proposta não chegou a virar cartão. Peça de novo: "crie o cartão dessa tarefa".)_';
  let fim = null;
  try {
    const r = await chamar(env, [modelo, modelo], JSON.stringify(corpo), 99);
    for await (const p of lerSSE(r.resposta)) if (!p.texto) fim = p;
  } catch (e) {
    console.error('[jean/motor] cobrar proposta', e && e.message);
    yield { texto: falhou };
    return;
  }
  const chamadas = (fim ? fim.partes : []).filter((p) => p.functionCall && propostas.includes(p.functionCall.name));
  let cartoes = 0;
  for (const c of chamadas) {
    usadas.push(c.functionCall.name);
    const feito = await executar(c.functionCall.name, c.functionCall.args || {});
    if (feito.acao) { cartoes++; yield { acao: feito.acao }; }
  }
  if (!cartoes) yield { texto: falhou };
}

async function chamar(env, modelos, corpo, rodada) {
  let ultimoErro = null;
  for (const modelo of modelos) {
    const inicio = Date.now();
    // 14/11 no ar: a conversa por voz ficou "pensando" para sempre. Nada aqui pode esperar
    // sem prazo: 90 s para o Google comecar a responder.
    let r;
    try {
      r = await fetch(`${URL_BASE}${encodeURIComponent(modelo)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: corpo,
        signal: AbortSignal.timeout(PRAZO_INICIO_MS),
      });
    } catch (e) {
      console.error('[jean/motor]', modelo, 'sem resposta', e && e.name);
      ultimoErro = new ErroMotor(`O Gemini não começou a responder em ${PRAZO_INICIO_MS / 1000} s (${modelo}, rodada ${rodada + 1}). Tente de novo.`, 504);
      continue;
    }
    if (r.ok) return { modelo, resposta: r };
    ultimoErro = await erroDoGoogle(r, modelo, Math.round((Date.now() - inicio) / 1000), rodada + 1);
    // Limite, modelo inexistente, fora do ar ou demorado demais: tenta a reserva.
    // Chave errada ou pedido recusado: nao adianta.
    if (![404, 429, 500, 502, 503, 504, 524].includes(r.status)) break;
  }
  throw ultimoErro;
}

async function erroDoGoogle(r, modelo, segundos, rodada) {
  const corpo = await r.text().catch(() => '');
  console.error('[jean/motor]', modelo, r.status, `${segundos}s rodada ${rodada}`, corpo.slice(0, 500));
  if (r.status === 429) return new ErroMotor('O limite gratuito do Gemini foi atingido. Espere um minuto e tente de novo (se persistir, o limite do dia acabou e volta amanhã).', 429);
  if (r.status === 400 && /API key/i.test(corpo)) return new ErroMotor('A chave do Gemini foi recusada pelo Google. Confira o secret GEMINI_API_KEY no Pages.', 502);
  if (r.status === 403) return new ErroMotor('O Google recusou o acesso com esta chave (403). Confira se a chave é do Google AI Studio e está ativa.', 502);
  if (r.status === 400 && /thinking/i.test(corpo)) { const e = new ErroMotor('O modelo recusou a configuração de pensamento.', 502); e.recusouPensamento = true; return e; }
  if (r.status === 524 || r.status === 504) return new ErroMotor(`O Gemini demorou demais para responder (erro ${r.status}, ${modelo}, rodada ${rodada}, ${segundos} s). Tente de novo; se repetir, peça algo mais curto.`, 504);
  return new ErroMotor(`O Gemini não respondeu (erro ${r.status}, ${modelo}). Tente de novo em instantes.`, 502);
}

// Le o streaming do Google. Gera { texto } e termina com { partes, entrada, saida, bloqueio },
// onde `partes` sao TODAS as partes recebidas, intactas (para devolver ao modelo).
async function* lerSSE(r) {
  const leitor = r.body.getReader();
  const dec = new TextDecoder();
  let resto = '';
  const partes = [];
  let entrada = 0, saida = 0, bloqueio = null;
  for (;;) {
    // Leitura com prazo: se o Google parar de mandar no meio, desiste em vez de esperar
    // para sempre (era o que deixava a tela "pensando" sem fim).
    let prazo;
    const { value, done } = await Promise.race([
      leitor.read(),
      new Promise((_, falha) => { prazo = setTimeout(() => falha(new ErroMotor(`O Gemini parou de mandar a resposta no meio (${PRAZO_SILENCIO_MS / 1000} s sem nada). Tente de novo.`, 504)), PRAZO_SILENCIO_MS); }),
    ]).catch((e) => { leitor.cancel().catch(() => {}); throw e; }).finally(() => clearTimeout(prazo));
    if (done) break;
    resto += dec.decode(value, { stream: true });
    let i;
    while ((i = resto.indexOf('\n')) >= 0) {
      const linha = resto.slice(0, i).trim();
      resto = resto.slice(i + 1);
      if (!linha.startsWith('data:')) continue;
      let ev;
      try { ev = JSON.parse(linha.slice(5)); } catch { continue; }
      const cand = ev.candidates && ev.candidates[0];
      for (const p of (cand && cand.content && cand.content.parts) || []) {
        partes.push(p);
        if (p.text && !p.thought) yield { texto: p.text };
      }
      if (cand && cand.finishReason && !['STOP', 'MAX_TOKENS'].includes(cand.finishReason)) bloqueio = cand.finishReason;
      if (ev.promptFeedback && ev.promptFeedback.blockReason) bloqueio = ev.promptFeedback.blockReason;
      if (ev.usageMetadata) {
        entrada = ev.usageMetadata.promptTokenCount ?? entrada;
        saida = (ev.usageMetadata.candidatesTokenCount ?? 0) + (ev.usageMetadata.thoughtsTokenCount ?? 0);
      }
    }
  }
  yield { partes, entrada, saida, bloqueio };
}

// Sem chamar ninguem. Se a mensagem pedir "tarefa" ou "lembre", simula a proposta (cartao)
// para testar o fluxo de confirmacao na tela.
async function* simulado(historico, executar) {
  const ultima = historico[historico.length - 1]?.conteudo || '';
  const usadas = [];
  if (executar && /tarefa/i.test(ultima)) {
    usadas.push('criar_tarefa');
    const f = await executar('criar_tarefa', { projeto: 'jean', titulo: 'Testar a tarefa simulada', detalhe: ultima.slice(0, 200) });
    if (f.acao) yield { acao: f.acao };
  }
  if (executar && /lembr/i.test(ultima)) {
    usadas.push('lembrar');
    const f = await executar('lembrar', { texto: 'Prefere respostas curtas (teste simulado)', tipo: 'preferencia' });
    if (f.acao) yield { acao: f.acao };
  }
  const texto = `**Modo simulado** (sem chamar o Gemini).\n\nVocê disse: "${ultima.slice(0, 200)}"\n\n` +
    (usadas.length ? 'Preparei a proposta abaixo; confirme no cartão.\n\n' : '') +
    'Exemplo de lista:\n\n- item um\n- item `dois`\n\n```js\nconsole.log("Jean");\n```\n\nFim do teste.';
  for (const pedaco of texto.match(/[\s\S]{1,12}/g)) {
    await new Promise((ok) => setTimeout(ok, 25));
    yield { texto: pedaco };
  }
  yield { fim: true, motor: 'simulado', entrada: 0, saida: 0, ferramentas: usadas };
}

// ======================================================================= VOZ (etapa 4)
// Decidido em 14/11/2026. O dono pediu edge-tts (voz do "Ler em voz alta" do Edge). Nao
// foi usado: nao e API oficial (imita o navegador Edge e contorna a trava Sec-MS-GEC que
// a Microsoft criou para barrar esse uso), quebra quando a Microsoft muda a trava, a
// biblioteca e AGPL e exige Node (nao roda no Pages). No lugar: a voz OFICIAL do Gemini,
// mesma chave, plano gratis. Reserva: a voz do proprio navegador (na tela).

/**
 * Modo B: o Gemini OUVE o audio gravado e devolve { transcricao, tom }. O audio nao fica
 * guardado em lugar nenhum: so a transcricao vai para a conversa.
 */
export async function transcrever(env, bytes, mime, nomes = []) {
  if (env.JEAN_SIMULADO === '1') return { transcricao: 'Mensagem de voz simulada: crie uma tarefa de teste', tom: 'calmo (simulado)' };
  if (!env.GEMINI_API_KEY) throw new ErroMotor('A chave do Gemini (GEMINI_API_KEY) não está configurada no Pages.', 503);
  const corpo = JSON.stringify({
    contents: [{ role: 'user', parts: [
      { inlineData: { mimeType: mime, data: paraBase64(bytes) } },
      { text: `Transcreva fielmente este áudio em português do Brasil, com pontuação. A assistente se chama Jean, pronunciado em inglês "Djin" (/dʒiːn/): quando ouvir "Djin", "Gin", "Jin" ou "Jim" chamando a assistente, escreva "Jean".${nomes.length ? ' Nomes próprios que podem aparecer (escreva assim): ' + nomes.join(', ') + '.' : ''} Não repita palavras nem trechos. Em "tom", descreva em poucas palavras o tom de voz e a intenção (ex.: "animado, com pressa"). Se não houver fala compreensível, devolva transcricao vazia.` },
    ] }],
    generationConfig: {
      // Transcrever nao precisa raciocinar: pensamento minimo deixa bem mais rapido.
      thinkingConfig: { thinkingLevel: 'MINIMAL' },
      responseMimeType: 'application/json',
      responseSchema: { type: 'object', properties: { transcricao: { type: 'string' }, tom: { type: 'string' } }, required: ['transcricao'] },
    },
  });
  // Modelo leve primeiro (mais rapido para so transcrever); o principal fica de reserva.
  const modelos = [env.JEAN_MODELO_TRANSCRICAO || 'gemini-3.5-flash-lite', env.JEAN_MODELO || 'gemini-3.8-flash'];
  let ultimoErro = null, semPensamento = null;
  for (let k = 0; k < modelos.length; k++) {
    const modelo = modelos[k];
    const inicio = Date.now();
    let r;
    try {
      r = await fetch(`${URL_BASE}${encodeURIComponent(modelo)}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: semPensamento || corpo,
        signal: AbortSignal.timeout(PRAZO_INICIO_MS),
      });
    } catch (e) {
      ultimoErro = new ErroMotor(`O Gemini não ouviu o áudio em ${PRAZO_INICIO_MS / 1000} s (${modelo}). Tente de novo.`, 504);
      continue;
    }
    if (r.ok) {
      const j = await r.json();
      const texto = (j.candidates?.[0]?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
      let saida = {};
      try { saida = JSON.parse(texto); } catch { saida = { transcricao: texto }; }
      return { transcricao: String(saida.transcricao || '').trim(), tom: String(saida.tom || '').trim(), motor: modelo, ms: Date.now() - inicio };
    }
    ultimoErro = await erroDoGoogle(r, modelo, Math.round((Date.now() - inicio) / 1000), 1);
    // Modelo que nao aceita o nivel de pensamento: repete o mesmo sem ele.
    if (ultimoErro.recusouPensamento && !semPensamento) {
      const c = JSON.parse(corpo); delete c.generationConfig.thinkingConfig; semPensamento = JSON.stringify(c); k--; continue;
    }
    if (![404, 429, 500, 502, 503, 504, 524].includes(r.status)) break;
  }
  throw ultimoErro;
}

// Base64 em pedacos (String.fromCharCode com lista grande estoura a pilha).
function paraBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Modo C: pede ao Gemini a voz da Jean (TTS oficial, plano gratis) EM STREAMING e devolve
 * a resposta do Google como veio, sem abrir no servidor: quem le o audio e a tela
 * (public/projetos/jean/voz.js). Assim o servidor quase nao gasta processamento.
 * O texto ja chega limpo da tela; aqui so a pronuncia ("Jean" -> "Djin") e o tamanho.
 */
export async function vozDoGemini(env, texto) {
  if (!env.GEMINI_API_KEY) throw new ErroMotor('A chave do Gemini (GEMINI_API_KEY) não está configurada no Pages.', 503);
  const fala = pronunciaDaJean(texto).slice(0, 5000);
  const modelos = [env.JEAN_MODELO_VOZ || 'gemini-3.8-flash-tts', env.JEAN_MODELO_VOZ_RESERVA || 'gemini-3.8-flash-lite-tts'];
  let ultimoErro = null;
  for (const modelo of modelos) {
    const inicio = Date.now();
    let r;
    try { r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse', {
      signal: AbortSignal.timeout(45000),
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY, 'Api-Revision': '2026-05-20' },
      body: JSON.stringify({
        model: modelo,
        stream: true,
        input: [{ type: 'user_input', content: [{
          type: 'text', text: fala,
          annotations: [{ type: 'speech_metadata', style: 'Português do Brasil. Voz feminina, calma, inteligente e acolhedora; ritmo natural de conversa, sem pressa.' }],
        }] }],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: env.JEAN_VOZ || 'Kore' }] },
      }),
    }); } catch (e) {
      ultimoErro = new ErroMotor(`A voz do Gemini não respondeu em 45 s (${modelo}).`, 504);
      continue;
    }
    if (r.ok) return { resposta: r, modelo };
    ultimoErro = await erroDoGoogle(r, modelo, Math.round((Date.now() - inicio) / 1000), 1);
    if (![404, 429, 500, 502, 503, 504, 524].includes(r.status)) break;
  }
  throw ultimoErro;
}

/** "Jean" vira "Djin" SO no que vai ser falado; na tela continua "Jean". */
export function pronunciaDaJean(texto) {
  return String(texto || '').replace(/\bJean\b/g, 'Djin').replace(/\bJEAN\b/g, 'DJIN');
}
