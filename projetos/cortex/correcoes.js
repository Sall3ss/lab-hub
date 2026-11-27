// projetos/cortex/correcoes.js - correções de nomes por canal (27/11/2026, pedido do dono).
// A transcrição erra sempre os mesmos nomes ("GT6" em vez de "GTA 6", o nome do streamer). O dono
// cadastra "errado -> certo" uma vez por canal (ou para todos) e vale para:
//   - o texto que a IA lê (cortex_transcricao, quando o PC manda o texto);
//   - a legenda palavra por palavra (rota 'palavras' do agente);
//   - a lista de nomes que vai para o Whisper (acerta já na transcrição).
// Autoria: Claude (Opus 5.5), Lab Hub, 27/11/2026.

import { db } from '../../lib/db.js';

export const normCanal = (c) => String(c || '').trim().toLowerCase().slice(0, 120) || null;

// Regras do canal + as que valem para todos. As do canal vêm primeiro (vencem num conflito).
export async function correcoesDoCanal(env, usuarioId, canal) {
  const c = normCanal(canal);
  const l = await db(env).all(
    'SELECT errado, certo, canal FROM cortex_correcoes WHERE usuario_id = ? AND (canal IS NULL OR canal = ?) ORDER BY canal IS NULL, LENGTH(errado) DESC',
    usuarioId, c || '');
  return l.map((x) => ({ errado: x.errado, certo: x.certo }));
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Fronteira de palavra que entende acento (\b do JavaScript só conhece a-z).
const regra = (errado) => new RegExp(`(?<![\\p{L}\\p{N}])${escapar(errado.trim()).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu');

export function corrigirTexto(txt, lista) {
  if (!txt || !lista || !lista.length) return txt;
  let t = String(txt);
  for (const c of lista) t = t.replace(regra(c.errado), c.certo);
  return t;
}

// Legenda [{ p, i, f }]: "errado" pode ter várias palavras ("tai na" -> "Tainá"); viram UMA palavra
// com o tempo da primeira à última. A pontuação grudada na última fica.
const nucleo = (p) => String(p || '').toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
export function corrigirPalavras(palavras, lista) {
  if (!Array.isArray(palavras) || !palavras.length || !lista || !lista.length) return palavras;
  const regras = lista.map((c) => ({ partes: c.errado.trim().toLowerCase().split(/\s+/).map(nucleo).filter(Boolean), certo: c.certo }))
    .filter((r) => r.partes.length).sort((a, b) => b.partes.length - a.partes.length);
  const saida = [];
  for (let k = 0; k < palavras.length;) {
    const r = regras.find((x) => x.partes.every((p, j) => palavras[k + j] && nucleo(palavras[k + j].p) === p));
    if (!r) { saida.push(palavras[k]); k++; continue; }
    const ult = palavras[k + r.partes.length - 1];
    const resto = (String(ult.p).match(/[^\p{L}\p{N}]+$/u) || [''])[0];
    const antes = (String(palavras[k].p).match(/^[^\p{L}\p{N}]+/u) || [''])[0];
    saida.push({ ...palavras[k], p: antes + r.certo + resto, f: ult.f });
    k += r.partes.length;
  }
  return saida;
}

// Os nomes certos entram na lista curta que vai como "prompt" do Whisper.
export const nomesCertos = (lista) => [...new Set((lista || []).map((c) => c.certo))].join(', ');
