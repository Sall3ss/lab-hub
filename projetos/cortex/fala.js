// projetos/cortex/fala.js - corte colado na fala (27/11/2026, pedido do dono).
// A IA marca o curto pelos blocos de ~10 s da transcrição, então ele pode começar ou terminar no
// meio de uma frase. Na tarefa de fotos, o PC (agente 3.1.0+) manda ~8 s de áudio em volta do
// começo e ~9 s em volta do fim; o Whisper devolve cada palavra com o tempo e aqui se decide:
//   - começo no meio da fala: volta até o início da frase (pausa de 0,45 s ou pontuação), no
//     máximo 4 s, e começa ~0,3 s antes da primeira palavra;
//   - fim no meio da fala: anda até o fim da frase, no máximo 5 s, e termina ~0,5 s depois.
// Só ESTICA, nunca encurta: um silêncio no texto pode ser a reação (risada, grito, susto), que o
// Whisper não escreve. Os tempos são segundos inteiros (como todo o Cortex).
// Autoria: Claude (Opus 5.5), Lab Hub, 27/11/2026.

const PAUSA = 0.45, VOLTA_MAX = 4, AVANCA_MAX = 5;
const fimDeFrase = (p) => /[.?!…]["'”»)]*$/.test(String(p || '').trim());

// palavras = [{ p, i, f }] com tempo ABSOLUTO (segundos do vídeo), ordenadas.
export function colarNaFala({ inicio, fim }, palIni, palFim) {
  let novoIni = inicio, novoFim = fim;
  const A = (palIni || []).filter((w) => w.f > w.i).sort((x, y) => x.i - y.i);
  const B = (palFim || []).filter((w) => w.f > w.i).sort((x, y) => x.i - y.i);

  // Começo: a palavra que está sendo dita em `inicio` (ou que acabou de ser, sem pausa).
  let k = A.findIndex((w) => w.i < inicio - 0.05 && w.f > inicio - PAUSA && !fimDeFrase(w.p));
  if (k >= 0 && !(A[k].f <= inicio && A[k + 1] && A[k + 1].i - A[k].f >= PAUSA)) {
    while (k > 0 && A[k].i - A[k - 1].f < PAUSA && !fimDeFrase(A[k - 1].p) && inicio - A[k - 1].i <= VOLTA_MAX) k--;
    if (inicio - A[k].i <= VOLTA_MAX + 0.5) novoIni = Math.max(0, Math.floor(A[k].i - 0.3));
  }

  // Fim: a palavra dita em `fim` (ou que começa logo depois, sem pausa e sem fim de frase antes).
  const antes = [...B].reverse().find((w) => w.i < fim);
  let j = B.findIndex((w) => w.i < fim + 0.05 && w.f > fim + 0.05);
  if (j < 0 && antes && !fimDeFrase(antes.p)) {
    const prox = B.find((w) => w.i >= fim);
    if (prox && prox.i - Math.max(antes.f, fim) < PAUSA && fim - antes.f < PAUSA) j = B.indexOf(prox);
  }
  if (j >= 0) {
    while (j < B.length - 1 && !fimDeFrase(B[j].p) && B[j + 1].i - B[j].f < PAUSA && B[j + 1].f - fim <= AVANCA_MAX) j++;
    if (B[j].f - fim <= AVANCA_MAX + 0.5) novoFim = Math.ceil(B[j].f + 0.5);
  }

  novoIni = Math.min(novoIni, inicio);      // só estica
  novoFim = Math.max(novoFim, fim);
  return { inicio: novoIni, fim: novoFim, mudou: novoIni !== inicio || novoFim !== fim };
}

// Palavras do áudio juntado pelo PC: parte A (la s) + 1 s de silêncio + parte B. Devolve os tempos
// absolutos de cada parte (o que cai no silêncio do meio é descartado).
export function separarPartes(palavras, a0, la, b0) {
  const A = [], B = [];
  for (const w of palavras || []) {
    if (w.f <= la + 0.1) A.push({ p: w.p, i: a0 + w.i, f: a0 + Math.min(w.f, la) });
    else if (w.i >= la + 0.9) B.push({ p: w.p, i: b0 + (w.i - la - 1), f: b0 + (w.f - la - 1) });
  }
  return { A, B };
}
