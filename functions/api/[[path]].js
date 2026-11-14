// functions/api/[[path]].js — porta única da API. Cada cliente escreve as rotas dele
// aqui, consumindo a BASE (lib/). Isto é o esqueleto demonstrativo.
//
// O desenho é de propósito: um roteador só, com as travas de acesso aplicadas UMA vez,
// antes de qualquer rota. Rota nova que alguém esqueça de proteger é o erro mais fácil de
// cometer, e este formato não deixa acontecer por esquecimento.
//
// Duas travas:
//   1. SESSÃO — quem não está logado não passa. Só `/api/sessao` dispensa.
//   2. SENHA PROVISÓRIA — enquanto a pessoa não definir o acesso dela (nome, e-mail e
//      senha nova), a única coisa que ela consegue fazer é isso. Vale no servidor, não só
//      na tela: esconder um botão não é controle de acesso.
//
// Autoria: Claude (Opus 5).

import { diag } from '../../lib/diag.js';
import { usuarioAtual, precisaDefinirAcesso, administra } from '../../lib/auth.js';
import { auditar } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import { PROJETOS } from '../../projetos/registro.js';
import { rotasSessao } from '../../app/rotas/sessao.js';

export async function onRequest(context) {
  const { request, env, params, data } = context;
  const partes = params.path || [];
  const rota = partes[0] || '';
  const metodo = request.method;

  try {
    // Diagnóstico: protegido por sessão de administrador (ver lib/diag.js).
    if (rota === 'diag') return await diag(request, env);

    // Entrar, sair e definir o acesso: antes das travas, porque é por aqui que se entra.
    // Lab Hub, 13/11/2026 (nasceu com a Jean). Claude (Opus 5.5).
    if (rota === 'sessao') return await rotasSessao({ request, env, data, partes, metodo, json });

    // Rotas de MÁQUINA de um projeto: /api/p/<slug>/maquina/... (ex.: o agente que roda no
    // PC do dono, no Cortex). Não há pessoa logada, então não passam pela sessão: só chegam
    // ao projeto que exporta `maquina`, e é ele que confere a credencial da máquina (chave
    // própria, guardada como hash). Projeto que não exporta `maquina` responde 404 aqui.
    // Lab Hub, 14/11/2026. Claude (Opus 5.5).
    if (rota === 'p' && partes[2] === 'maquina') {
      const projeto = PROJETOS[partes[1]];
      if (!projeto || typeof projeto.maquina !== 'function') return json({ erro: 'rota nao encontrada' }, 404);
      const waitUntil = context.waitUntil ? context.waitUntil.bind(context) : null;
      return await projeto.maquina({ request, env, data, partes: partes.slice(3), metodo, json, waitUntil });
    }

    const u = await usuarioAtual(request, env);
    if (!u) return json({ erro: 'sessão expirada', reautenticar: true }, 401);
    if (precisaDefinirAcesso(u)) {
      return json({ erro: 'defina o seu acesso antes de usar o sistema', definir_acesso: true }, 403);
    }

    // Lab Hub: cada projeto responde em /api/p/<slug>/... com o modulo dele
    // (projetos/<slug>/api.js). Passa por aqui, depois das travas, para nenhum projeto
    // ficar sem protecao por esquecimento. Autoria: Claude (Opus 5.5).
    if (rota === 'p') {
      const projeto = PROJETOS[partes[1]];
      if (!projeto) return json({ erro: 'projeto nao encontrado', projeto: partes[1] || '' }, 404);
      // waitUntil: deixa o projeto terminar um trabalho (ex.: gravar a resposta de uma IA
      // em streaming) mesmo que a tela feche antes. Lab Hub, 13/11/2026.
      const waitUntil = context.waitUntil ? context.waitUntil.bind(context) : null;
      return await projeto.rotas({ request, env, data, u, partes: partes.slice(2), metodo, json, waitUntil });
    }

    // Exemplo de rota da casca: listar/criar "itens" (troque pelo domínio do cliente).
    if (rota === 'itens' && metodo === 'GET') {
      return json({ itens: await db(env).all('SELECT * FROM itens ORDER BY id DESC LIMIT 100') });
    }
    if (rota === 'itens' && metodo === 'POST') {
      if (!administra(u)) return json({ erro: 'sem permissão' }, 403);
      const corpo = await request.json();
      const r = await db(env).run('INSERT INTO itens (nome, criado_em) VALUES (?, ?)', corpo.nome, new Date().toISOString());
      await auditar(env, {
        quem: u.email, acao: 'criar', entidade: 'itens',
        entidade_id: r.meta?.last_row_id, depois: corpo, ip: data.ip,
      });
      return json({ ok: true, id: r.meta?.last_row_id }, 201);
    }

    return json({ erro: 'rota nao encontrada', rota }, 404);
  } catch (e) {
    // Erro de banco ou de código nunca deve vazar SQL nem caminho de arquivo para a tela.
    console.error('[api]', rota, metodo, e?.message);
    return json({ erro: 'nao foi possivel concluir' }, 500);
  }
}

function json(obj, status = 200, extras = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...extras } });
}
