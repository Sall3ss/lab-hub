/**
 * Nome original de um item/monstro do jogo base. O Cyberidle troca os nomes exibidos
 * (tema cyberpunk) e guarda o antigo em `nomeOriginal`; toda regra que reconhece algo PELO
 * NOME (moeda, arco, varinha, cogumelo, poção...) usa este nome, nunca o exibido.
 * Lab Hub, Claude (Opus 5.5).
 */
export function nomeBase(x: { name: string } | null | undefined): string {
  if (!x) return '';
  return (x as { nomeOriginal?: string }).nomeOriginal ?? x.name;
}
