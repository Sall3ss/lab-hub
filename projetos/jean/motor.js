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
// ⚠️ Plano gratis: o Google pode usar o conteudo para melhorar os produtos dele, e ha
// limite de pedidos por minuto e por dia. Ver projetos/jean/PROJETO.md.
//
// Modo simulado (JEAN_SIMULADO=1): responde sem chamar ninguem. Existe para testar a tela
// nesta maquina, onde a chave NAO pode morar (regra da casa).
//
// Autoria: Claude (Opus 5.5), Lab Hub, 13/11/2026.

const URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

export class ErroMotor extends Error {
  constructor(mensagem, status) { super(mensagem); this.status = status; }
}

/**
 * Gera { texto } a cada pedaco e, no fim, { fim: true, motor, entrada, saida }.
 * historico: [{ papel: 'usuario'|'jean', conteudo }] terminando na fala do usuario.
 */
export async function* responder(env, { sistema, historico, sinal }) {
  if (env.JEAN_SIMULADO === '1') { yield* simulado(historico, sinal); return; }
  if (!env.GEMINI_API_KEY) throw new ErroMotor('A chave do Gemini (GEMINI_API_KEY) não está configurada no Pages.', 503);

  const modelos = [env.JEAN_MODELO || 'gemini-3.8-flash', env.JEAN_MODELO_RESERVA || 'gemini-3.5-flash-lite'];
  const corpo = JSON.stringify({
    systemInstruction: { parts: [{ text: sistema }] },
    contents: historico.map((m) => ({ role: m.papel === 'jean' ? 'model' : 'user', parts: [{ text: m.conteudo }] })),
  });

  let ultimoErro = null;
  for (const modelo of modelos) {
    const r = await fetch(`${URL_BASE}${encodeURIComponent(modelo)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: corpo,
      signal: sinal,
    });
    if (!r.ok) {
      ultimoErro = await erroDoGoogle(r, modelo);
      // Limite, modelo inexistente ou fora do ar: tenta a reserva. Chave errada: nao adianta.
      if ([404, 429, 500, 503].includes(r.status)) continue;
      throw ultimoErro;
    }
    yield* lerSSE(r, modelo);
    return;
  }
  throw ultimoErro;
}

async function erroDoGoogle(r, modelo) {
  const corpo = await r.text().catch(() => '');
  console.error('[jean/motor]', modelo, r.status, corpo.slice(0, 500));
  if (r.status === 429) return new ErroMotor('O limite gratuito do Gemini foi atingido. Espere um minuto e tente de novo (se persistir, o limite do dia acabou e volta amanhã).', 429);
  if (r.status === 400 && /API key/i.test(corpo)) return new ErroMotor('A chave do Gemini foi recusada pelo Google. Confira o secret GEMINI_API_KEY no Pages.', 502);
  if (r.status === 403) return new ErroMotor('O Google recusou o acesso com esta chave (403). Confira se a chave é do Google AI Studio e está ativa.', 502);
  return new ErroMotor(`O Gemini não respondeu (erro ${r.status}). Tente de novo em instantes.`, 502);
}

async function* lerSSE(r, modelo) {
  const leitor = r.body.getReader();
  const dec = new TextDecoder();
  let resto = '';
  let entrada = null, saida = null, bloqueio = null;
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
  if (bloqueio) yield { texto: `\n\n_(O Gemini interrompeu esta resposta: ${bloqueio}.)_` };
  yield { fim: true, motor: modelo, entrada, saida };
}

async function* simulado(historico, sinal) {
  const ultima = historico[historico.length - 1]?.conteudo || '';
  const texto = `**Modo simulado** (sem chamar o Gemini).\n\nVocê disse: "${ultima.slice(0, 200)}"\n\n` +
    'Exemplo de lista:\n\n- item um\n- item `dois`\n\n```js\nconsole.log("Jean");\n```\n\nFim do teste.';
  for (const pedaco of texto.match(/[\s\S]{1,12}/g)) {
    if (sinal && sinal.aborted) break;
    await new Promise((ok) => setTimeout(ok, 25));
    yield { texto: pedaco };
  }
  yield { fim: true, motor: 'simulado', entrada: 0, saida: 0 };
}
