// projetos/jean/contexto.js - o "JeanContextService": junta o que a Jean precisa saber
// a cada mensagem.
//   - cartao e resumo da ficha de cada projeto (contexto-gerado.js, gerado na publicacao)
//   - tarefas abertas e notas recentes de cada projeto (tabelas jean_tarefas / jean_notas)
//   - memorias do dono (jean_memorias)
//   - de qual projeto/tela a Jean foi chamada (quando vier)
// A Jean NAO le tabela de outro projeto: so ficha e cartao (ver PROJETO.md do hub).
//
// Autoria: Claude (Opus 5.5), Lab Hub, 13/11/2026.

import { db } from '../../lib/db.js';
import { PROJETOS, HUB } from './contexto-gerado.js';

const TAREFAS_POR_PROJETO = 8;
const NOTAS_POR_PROJETO = 3;
const MAX_MEMORIAS = 60;

/** slug -> projeto (inclui o "hub"). */
export function projetoPorSlug(slug) {
  if (slug === 'hub') return HUB;
  return PROJETOS.find((p) => p.slug === slug) || null;
}
export function todosOsProjetos() { return [...PROJETOS, HUB]; }

export async function dadosDoPainel(env, usuarioId) {
  const [tarefas, notas, memorias] = await Promise.all([
    db(env).all(
      `SELECT id, projeto_slug, titulo, detalhe, estado, criada_em, concluida_em FROM jean_tarefas
        WHERE usuario_id = ? ORDER BY estado = 'feita', id DESC LIMIT 500`, usuarioId),
    db(env).all('SELECT id, projeto_slug, texto, autor, criada_em FROM jean_notas WHERE usuario_id = ? ORDER BY id DESC LIMIT 300', usuarioId),
    db(env).all(`SELECT id, tipo, projeto_slug, texto, criada_em FROM jean_memorias WHERE usuario_id = ? ORDER BY id DESC LIMIT ${MAX_MEMORIAS}`, usuarioId),
  ]);
  const projetos = todosOsProjetos().map((p) => ({
    slug: p.slug, titulo: p.titulo, fase: p.fase, endereco: p.endereco, ideia: p.ideia, objetivo: p.objetivo,
    proximo: p.proximo,
    tarefas: tarefas.filter((t) => t.projeto_slug === p.slug),
    notas: notas.filter((n) => n.projeto_slug === p.slug),
  }));
  return { projetos, memorias };
}

/** Texto que vai junto da instrucao de sistema. */
export async function contextoParaJean(env, usuarioId, projetoAtual) {
  const { projetos, memorias } = await dadosDoPainel(env, usuarioId);
  const blocos = projetos.map((p) => {
    const g = projetoPorSlug(p.slug);
    const abertas = p.tarefas.filter((t) => t.estado === 'aberta');
    const linhas = [
      `### ${p.titulo} (projeto: "${p.slug}", fase: ${p.fase}${p.endereco ? ', no ar em ' + p.endereco : ''})`,
      p.ideia && `Ideia: ${p.ideia}`,
      p.objetivo && `Objetivo: ${p.objetivo}`,
      g.estado && `Começo da seção "Estado" da ficha:\n${g.estado}`,
      g.proximo && `Próximo passo segundo a ficha:\n${g.proximo}`,
      abertas.length
        ? `Tarefas abertas (${abertas.length}):\n` + abertas.slice(0, TAREFAS_POR_PROJETO).map((t) => `- [tarefa ${t.id}] ${t.titulo}`).join('\n') +
          (abertas.length > TAREFAS_POR_PROJETO ? '\n- ...' : '')
        : 'Tarefas abertas: nenhuma.',
      p.notas.length && 'Notas recentes:\n' + p.notas.slice(0, NOTAS_POR_PROJETO).map((n) => `- (${n.criada_em.slice(0, 10)}) ${n.texto}`).join('\n'),
    ];
    return linhas.filter(Boolean).join('\n');
  });

  const mem = memorias.length
    ? memorias.map((m) => `- [memória ${m.id}] (${m.tipo}${m.projeto_slug ? ', ' + m.projeto_slug : ''}) ${m.texto}`).join('\n')
    : '(nenhuma memória guardada ainda)';

  const atual = projetoAtual && projetoPorSlug(projetoAtual);
  const onde = atual
    ? `O dono abriu você de dentro do projeto "${atual.titulo}" (slug "${atual.slug}"). Quando ele disser "este projeto", "aqui" ou "esse módulo", é desse que ele fala.`
    : 'O dono está na página da própria Jean (não dentro de um projeto específico).';

  return `## Onde o dono está agora
${onde}

## Projetos do Lab Hub (retrato atual)
${blocos.join('\n\n')}

## Suas memórias sobre o dono (guardadas entre conversas)
${mem}`;
}
