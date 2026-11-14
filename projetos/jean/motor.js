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

export class ErroMotor extends Error {
  constructor(mensagem, status) { super(mensagem); this.status = status; }
}

/**
 * Gera { texto } a cada pedaco, { acao } quando uma proposta vira cartao e, no fim,
 * { fim: true, motor, entrada, saida, ferramentas }.
 * historico: [{ papel: 'usuario'|'jean', conteudo }] terminando na fala do usuario.
 * ferramentas: declaracoes (functionDeclarations); executar(nome, args) -> { resposta, acao? }
 */
export async function* responder(env, { sistema, historico, ferramentas, executar }) {
  if (env.JEAN_SIMULADO === '1') { yield* simulado(historico, executar); return; }
  if (!env.GEMINI_API_KEY) throw new ErroMotor('A chave do Gemini (GEMINI_API_KEY) não está configurada no Pages.', 503);

  const contents = historico.map((m) => ({ role: m.papel === 'jean' ? 'model' : 'user', parts: [{ text: m.conteudo }] }));
  // Configuracoes de pensamento, da preferida para a mais simples: se o Google recusar uma
  // (nome de nivel diferente num modelo), cai para a seguinte em vez de falhar.
  const pensamentos = [
    { thinkingConfig: { thinkingLevel: env.JEAN_PENSAMENTO || 'LOW', includeThoughts: true } },
    { thinkingConfig: { includeThoughts: true } },
    null,
  ];
  const base = { systemInstruction: { parts: [{ text: sistema }] }, generationConfig: pensamentos.shift() };
  if (ferramentas && ferramentas.length) base.tools = [{ functionDeclarations: ferramentas }];

  let modelos = [env.JEAN_MODELO || 'gemini-3.8-flash', env.JEAN_MODELO_RESERVA || 'gemini-3.5-flash-lite'];
  let entrada = 0, saida = 0;
  const usadas = [];

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
      if (p.texto) yield { texto: p.texto };
      else fimLeitura = p;
    }
    entrada += fimLeitura.entrada || 0;
    saida += fimLeitura.saida || 0;

    const chamadas = fimLeitura.partes.filter((p) => p.functionCall);
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

async function chamar(env, modelos, corpo, rodada) {
  let ultimoErro = null;
  for (const modelo of modelos) {
    const inicio = Date.now();
    const r = await fetch(`${URL_BASE}${encodeURIComponent(modelo)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: corpo,
    });
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
    const { value, done } = await leitor.read();
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
