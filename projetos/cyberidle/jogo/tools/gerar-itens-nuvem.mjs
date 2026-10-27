// Gera nuvem/lib/itens.js: itens que podem ir ao mercado geral do Cyberidle e o valor de
// referência de cada um (para limitar preço). Moedas ficam fora (evita lavar ouro falso).
// Uso: node tools/gerar-itens-nuvem.mjs   (a partir de projetos/cyberidle/jogo)
// Lab Hub, Claude (Opus 5.5), 26/10/2026.
import fs from 'node:fs';
const itens = JSON.parse(fs.readFileSync('packages/data/generated/items.json', 'utf8'));
const lista = Array.isArray(itens) ? itens : Object.values(itens);
const MOEDAS = new Set([3031, 3035, 3043]);
// Só itens que algum monstro deixa cair (pedido do dono, 27/10): nada de item só de NPC.
const monstros = JSON.parse(fs.readFileSync('packages/data/generated/monsters.json', 'utf8'));
const dropaveis = new Set((Array.isArray(monstros) ? monstros : Object.values(monstros))
  .flatMap((m) => (m.loot ?? []).map((l) => l.itemId)));
const ok = {};
for (const i of lista) {
  if (!dropaveis.has(i.id) || MOEDAS.has(i.id) || i.type === 'valuables' && /coin/i.test(i.name)) continue;
  ok[i.id] = Math.max(i.sellPrice ?? 0, Math.floor((i.buyPrice ?? 0) / 2), 0);
}
const saida = `// GERADO por jogo/tools/gerar-itens-nuvem.mjs - não edite à mão.
// id do item -> valor de referência (gp) para o limite de preço do mercado geral.
export const ITENS_MERCADO = ${JSON.stringify(ok)};
`;
fs.writeFileSync('../nuvem/lib/itens.js', saida);
console.log('itens no mercado:', Object.keys(ok).length, 'tamanho', saida.length);
