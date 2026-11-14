// projetos/jean/ferramentas.js - o que a Jean pode CONSULTAR e PROPOR no Lab Hub.
//
// Consultar roda na hora (ler ficha, pendencias, conversas antigas).
// Propor NUNCA grava direto: vira uma linha em jean_acoes com estado 'pendente' e aparece
// na tela como cartao "Confirmar / Recusar". So `decidirAcao` (o dono apertando Confirmar)
// executa. Fundamento da casa: nao gravar sem intencao.
//
// Autoria: Claude (Opus 5.5), Lab Hub, 13/11/2026.

import { db } from '../../lib/db.js';
import { auditar } from '../../lib/audit.js';
import { projetoPorSlug, todosOsProjetos, dadosDoPainel } from './contexto.js';

const FASES = ['beta', 'pronto', 'migrado'];
const TIPOS_MEMORIA = ['fato', 'preferencia', 'decisao', 'regra'];

const slugs = () => todosOsProjetos().map((p) => p.slug);
const txt = (descricao) => ({ type: 'string', description: descricao });

// Declaracoes no formato do Gemini (functionDeclarations).
export function declaracoes() {
  const projeto = { type: 'string', description: 'Slug do projeto: ' + slugs().map((s) => `"${s}"`).join(', '), enum: slugs() };
  return [
    { name: 'ler_ficha', description: 'Lê a ficha completa de um projeto do Lab Hub (estado detalhado, decisões, próximos passos). Use quando o resumo do contexto não bastar.',
      parameters: { type: 'object', properties: { projeto }, required: ['projeto'] } },
    { name: 'listar_pendencias', description: 'Lista tarefas (abertas e feitas) e notas de um projeto, ou de todos se projeto for omitido.',
      parameters: { type: 'object', properties: { projeto } } },
    { name: 'buscar_conversas', description: 'Procura nas conversas anteriores com o dono (título e texto). Use para "o que discutimos ontem", "aquela ideia de...".',
      parameters: { type: 'object', properties: { termo: txt('Palavra ou trecho a procurar. Vazio = conversas mais recentes.') } } },
    { name: 'ler_conversa', description: 'Lê as falas de uma conversa anterior (pelo id que buscar_conversas devolve).',
      parameters: { type: 'object', properties: { conversa_id: { type: 'integer', description: 'Id da conversa' } }, required: ['conversa_id'] } },
    { name: 'criar_nota', description: 'PROPÕE uma anotação num projeto. Só é gravada se o dono confirmar no cartão.',
      parameters: { type: 'object', properties: { projeto, texto: txt('Texto da nota, claro e autossuficiente') }, required: ['projeto', 'texto'] } },
    { name: 'criar_tarefa', description: 'PROPÕE uma tarefa (pendência) num projeto. Só é criada se o dono confirmar no cartão.',
      parameters: { type: 'object', properties: { projeto, titulo: txt('Título curto, começando por verbo'), detalhe: txt('Detalhe opcional') }, required: ['projeto', 'titulo'] } },
    { name: 'concluir_tarefa', description: 'PROPÕE marcar uma tarefa como feita (pelo número da tarefa). Só acontece se o dono confirmar.',
      parameters: { type: 'object', properties: { tarefa_id: { type: 'integer', description: 'Número da tarefa' } }, required: ['tarefa_id'] } },
    { name: 'lembrar', description: 'PROPÕE guardar uma memória de longo prazo sobre o dono (preferência, decisão, regra, fato). Só é guardada se ele confirmar.',
      parameters: { type: 'object', properties: { texto: txt('O que lembrar, em uma frase'), tipo: { type: 'string', enum: TIPOS_MEMORIA, description: 'fato, preferencia, decisao ou regra' }, projeto: { ...projeto, description: 'Projeto a que se refere (omitir se vale para tudo)' } }, required: ['texto', 'tipo'] } },
    { name: 'esquecer', description: 'PROPÕE apagar uma memória (pelo número da memória). Só acontece se o dono confirmar.',
      parameters: { type: 'object', properties: { memoria_id: { type: 'integer', description: 'Número da memória' } }, required: ['memoria_id'] } },
    { name: 'sugerir_fase', description: 'PROPÕE mudar a fase de um projeto (beta, pronto, migrado). Ao confirmar, vira uma tarefa no projeto: a fase muda por commit no repositório.',
      parameters: { type: 'object', properties: { projeto, fase: { type: 'string', enum: FASES }, motivo: txt('Por que mudar') }, required: ['projeto', 'fase', 'motivo'] } },
  ];
}

const CONSULTAS = new Set(['ler_ficha', 'listar_pendencias', 'buscar_conversas', 'ler_conversa']);
const corta = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + ' [...]' : s; };
const limpo = (s, n) => String(s == null ? '' : s).trim().slice(0, n);

/**
 * Executa uma chamada do modelo. Devolve { resposta, acao? }:
 *   resposta  -> o que volta para o modelo (functionResponse)
 *   acao      -> cartao para a tela, quando for uma proposta
 */
export async function executar(env, u, conversaId, nome, args) {
  args = args || {};
  try {
    if (CONSULTAS.has(nome)) return { resposta: await consultar(env, u, nome, args) };
    const proposta = await validarProposta(env, u, nome, args);
    if (proposta.erro) return { resposta: { erro: proposta.erro } };
    const r = await db(env).run(
      "INSERT INTO jean_acoes (usuario_id, conversa_id, ferramenta, argumentos, estado, criada_em) VALUES (?, ?, ?, ?, 'pendente', ?)",
      u.id, conversaId, nome, JSON.stringify({ ...proposta.args, _resumo: proposta.resumo }), new Date().toISOString(),
    );
    const acao = { id: r.meta.last_row_id, ferramenta: nome, estado: 'pendente', resumo: proposta.resumo };
    return {
      resposta: { situacao: 'aguardando_confirmacao_do_dono', acao_id: acao.id, resumo: proposta.resumo },
      acao,
    };
  } catch (e) {
    console.error('[jean/ferramenta]', nome, e && e.message);
    return { resposta: { erro: 'falha ao executar ' + nome } };
  }
}

async function consultar(env, u, nome, args) {
  if (nome === 'ler_ficha') {
    const p = projetoPorSlug(args.projeto);
    if (!p) return { erro: 'projeto desconhecido' };
    // 12 mil caracteres: a ficha inteira do Cyberidle (~30 mil) deixava o modelo lento demais.
    return { projeto: p.slug, ficha: corta(p.ficha, 12000), cortada: p.ficha.length > 12000 };
  }
  if (nome === 'listar_pendencias') {
    const { projetos } = await dadosDoPainel(env, u.id);
    const alvo = args.projeto ? projetos.filter((p) => p.slug === args.projeto) : projetos;
    return {
      projetos: alvo.map((p) => ({
        projeto: p.slug,
        tarefas: p.tarefas.slice(0, 40).map((t) => ({ numero: t.id, titulo: t.titulo, detalhe: t.detalhe, estado: t.estado, criada: t.criada_em.slice(0, 10) })),
        notas: p.notas.slice(0, 20).map((n) => ({ texto: n.texto, criada: n.criada_em.slice(0, 10) })),
      })),
    };
  }
  if (nome === 'buscar_conversas') {
    const termo = limpo(args.termo, 100);
    const like = '%' + termo.replace(/[%_\\]/g, (c) => '\\' + c) + '%';
    const linhas = await db(env).all(
      `SELECT c.id, c.titulo, c.atualizada_em,
              (SELECT m.conteudo FROM jean_mensagens m WHERE m.conversa_id = c.id ${termo ? "AND m.conteudo LIKE ?2 ESCAPE '\\'" : ''} ORDER BY m.id DESC LIMIT 1) AS trecho
         FROM jean_conversas c
        WHERE c.usuario_id = ?1 ${termo ? `AND (c.titulo LIKE ?2 ESCAPE '\\' OR EXISTS (SELECT 1 FROM jean_mensagens m WHERE m.conversa_id = c.id AND m.conteudo LIKE ?2 ESCAPE '\\'))` : ''}
        ORDER BY c.atualizada_em DESC LIMIT 8`,
      ...(termo ? [u.id, like] : [u.id]),
    );
    return { conversas: linhas.map((c) => ({ conversa_id: c.id, titulo: c.titulo, atualizada: c.atualizada_em.slice(0, 16).replace('T', ' '), trecho: corta(c.trecho, 300) })) };
  }
  if (nome === 'ler_conversa') {
    const c = await db(env).first('SELECT id, titulo FROM jean_conversas WHERE id = ? AND usuario_id = ?', Number(args.conversa_id), u.id);
    if (!c) return { erro: 'conversa não encontrada' };
    const falas = (await db(env).all('SELECT papel, conteudo, criada_em FROM jean_mensagens WHERE conversa_id = ? ORDER BY id DESC LIMIT 30', c.id)).reverse();
    return { titulo: c.titulo, falas: falas.map((f) => ({ quem: f.papel === 'jean' ? 'Jean' : 'dono', quando: f.criada_em.slice(0, 16).replace('T', ' '), texto: corta(f.conteudo, 1500) })) };
  }
  return { erro: 'ferramenta desconhecida' };
}

function nomeDo(slug) { const p = projetoPorSlug(slug); return p ? p.titulo : slug; }

async function validarProposta(env, u, nome, a) {
  if (nome === 'criar_nota') {
    if (!projetoPorSlug(a.projeto)) return { erro: 'projeto desconhecido' };
    const texto = limpo(a.texto, 2000);
    if (!texto) return { erro: 'nota vazia' };
    return { args: { projeto: a.projeto, texto }, resumo: `Anotar em ${nomeDo(a.projeto)}: "${corta(texto, 200)}"` };
  }
  if (nome === 'criar_tarefa') {
    if (!projetoPorSlug(a.projeto)) return { erro: 'projeto desconhecido' };
    const titulo = limpo(a.titulo, 200), detalhe = limpo(a.detalhe, 2000);
    if (!titulo) return { erro: 'tarefa sem título' };
    return { args: { projeto: a.projeto, titulo, detalhe }, resumo: `Criar tarefa em ${nomeDo(a.projeto)}: ${titulo}` };
  }
  if (nome === 'concluir_tarefa') {
    const t = await db(env).first("SELECT id, titulo, projeto_slug, estado FROM jean_tarefas WHERE id = ? AND usuario_id = ?", Number(a.tarefa_id), u.id);
    if (!t) return { erro: 'tarefa não encontrada' };
    if (t.estado === 'feita') return { erro: 'essa tarefa já está feita' };
    return { args: { tarefa_id: t.id }, resumo: `Concluir a tarefa de ${nomeDo(t.projeto_slug)}: ${t.titulo}` };
  }
  if (nome === 'lembrar') {
    const texto = limpo(a.texto, 500);
    const tipo = TIPOS_MEMORIA.includes(a.tipo) ? a.tipo : 'fato';
    const projeto = a.projeto && projetoPorSlug(a.projeto) ? a.projeto : null;
    if (!texto) return { erro: 'memória vazia' };
    return { args: { texto, tipo, projeto }, resumo: `Lembrar (${tipo}${projeto ? ', ' + nomeDo(projeto) : ''}): ${texto}` };
  }
  if (nome === 'esquecer') {
    const m = await db(env).first('SELECT id, texto FROM jean_memorias WHERE id = ? AND usuario_id = ?', Number(a.memoria_id), u.id);
    if (!m) return { erro: 'memória não encontrada' };
    return { args: { memoria_id: m.id }, resumo: `Esquecer: ${corta(m.texto, 200)}` };
  }
  if (nome === 'sugerir_fase') {
    if (!projetoPorSlug(a.projeto) || a.projeto === 'hub') return { erro: 'projeto desconhecido' };
    if (!FASES.includes(a.fase)) return { erro: 'fase inválida' };
    const motivo = limpo(a.motivo, 1000);
    return { args: { projeto: a.projeto, fase: a.fase, motivo }, resumo: `Mudar a fase de ${nomeDo(a.projeto)} para "${a.fase}" (vira tarefa; a fase muda por commit)` };
  }
  return { erro: 'ferramenta desconhecida' };
}

/** O dono apertou Confirmar ou Recusar no cartao. */
export async function decidirAcao(env, u, ip, acaoId, decisao) {
  const a = await db(env).first('SELECT * FROM jean_acoes WHERE id = ? AND usuario_id = ?', acaoId, u.id);
  if (!a) return { status: 404, corpo: { erro: 'ação não encontrada' } };
  if (a.estado !== 'pendente') return { status: 409, corpo: { erro: 'essa ação já foi decidida', acao: publica(a) } };
  const agora = new Date().toISOString();

  if (decisao === 'recusar') {
    await db(env).run("UPDATE jean_acoes SET estado = 'recusada', decidida_em = ? WHERE id = ?", agora, a.id);
    return { status: 200, corpo: { acao: publica({ ...a, estado: 'recusada' }) } };
  }

  const args = JSON.parse(a.argumentos);
  let resultado, entidade, entidadeId;
  if (a.ferramenta === 'criar_nota') {
    const r = await db(env).run("INSERT INTO jean_notas (usuario_id, projeto_slug, texto, autor, criada_em) VALUES (?, ?, ?, 'jean', ?)", u.id, args.projeto, args.texto, agora);
    entidade = 'jean_notas'; entidadeId = r.meta.last_row_id; resultado = { nota_id: entidadeId };
  } else if (a.ferramenta === 'criar_tarefa' || a.ferramenta === 'sugerir_fase') {
    const titulo = a.ferramenta === 'sugerir_fase' ? `Mudar a fase para "${args.fase}" (projetos.json)` : args.titulo;
    const detalhe = a.ferramenta === 'sugerir_fase' ? args.motivo : (args.detalhe || null);
    const r = await db(env).run(
      "INSERT INTO jean_tarefas (usuario_id, projeto_slug, titulo, detalhe, estado, conversa_id, criada_em) VALUES (?, ?, ?, ?, 'aberta', ?, ?)",
      u.id, args.projeto, titulo, detalhe, a.conversa_id, agora,
    );
    entidade = 'jean_tarefas'; entidadeId = r.meta.last_row_id; resultado = { tarefa_id: entidadeId };
  } else if (a.ferramenta === 'concluir_tarefa') {
    await db(env).run("UPDATE jean_tarefas SET estado = 'feita', concluida_em = ? WHERE id = ? AND usuario_id = ?", agora, args.tarefa_id, u.id);
    entidade = 'jean_tarefas'; entidadeId = args.tarefa_id; resultado = { tarefa_id: entidadeId };
  } else if (a.ferramenta === 'lembrar') {
    const r = await db(env).run(
      'INSERT INTO jean_memorias (usuario_id, tipo, projeto_slug, texto, conversa_id, criada_em) VALUES (?, ?, ?, ?, ?, ?)',
      u.id, args.tipo, args.projeto, args.texto, a.conversa_id, agora,
    );
    entidade = 'jean_memorias'; entidadeId = r.meta.last_row_id; resultado = { memoria_id: entidadeId };
  } else if (a.ferramenta === 'esquecer') {
    await db(env).run('DELETE FROM jean_memorias WHERE id = ? AND usuario_id = ?', args.memoria_id, u.id);
    entidade = 'jean_memorias'; entidadeId = args.memoria_id; resultado = { apagada: true };
  } else {
    return { status: 400, corpo: { erro: 'ação desconhecida' } };
  }

  await db(env).run("UPDATE jean_acoes SET estado = 'confirmada', resultado = ?, decidida_em = ? WHERE id = ?", JSON.stringify(resultado), agora, a.id);
  await auditar(env, { quem: u.email, acao: 'jean:' + a.ferramenta, entidade, entidade_id: entidadeId, depois: args, ip });
  return { status: 200, corpo: { acao: publica({ ...a, estado: 'confirmada', resultado: JSON.stringify(resultado) }) } };
}

/** Como a acao aparece na tela (sem dados internos). */
export function publica(a) {
  let args = {};
  try { args = JSON.parse(a.argumentos); } catch { /* nada */ }
  return { id: a.id, ferramenta: a.ferramenta, estado: a.estado, resumo: args._resumo || resumoDe(a.ferramenta, args) };
}

function resumoDe(nome, args) {
  if (nome === 'criar_nota') return `Anotar em ${nomeDo(args.projeto)}: "${corta(args.texto, 200)}"`;
  if (nome === 'criar_tarefa') return `Criar tarefa em ${nomeDo(args.projeto)}: ${args.titulo}`;
  if (nome === 'concluir_tarefa') return `Concluir a tarefa nº ${args.tarefa_id}`;
  if (nome === 'lembrar') return `Lembrar (${args.tipo}${args.projeto ? ', ' + nomeDo(args.projeto) : ''}): ${args.texto}`;
  if (nome === 'esquecer') return `Esquecer a memória nº ${args.memoria_id}`;
  if (nome === 'sugerir_fase') return `Mudar a fase de ${nomeDo(args.projeto)} para "${args.fase}" (vira tarefa; a fase muda por commit)`;
  return nome;
}
