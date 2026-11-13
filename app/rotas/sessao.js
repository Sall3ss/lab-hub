// app/rotas/sessao.js - entrar, sair e definir o proprio acesso no Lab Hub.
//
// Chega aqui tudo que for /api/sessao/..., ANTES das travas da porta unica
// (functions/api/[[path]].js): quem ainda nao entrou precisa destas rotas para entrar.
// Por isso cada rota que exige sessao confere a sua aqui dentro.
//
//   GET  /api/sessao          quem esta logado (ou {logado:false})
//   POST /api/sessao/entrar   {email, senha}            -> cookie de sessao
//   POST /api/sessao/sair                               -> apaga a sessao
//   POST /api/sessao/acesso   {nome, email, senha}      -> troca a senha provisoria
//
// Nasceu com a Jean (13/11/2026): primeiro projeto do hub que precisa de login, porque
// guarda conversa pessoal e chama API de IA em nome do dono.
//
// Trava contra adivinhacao de senha: 5 erros em 15 minutos para o mesmo usuario = espera.
// Contado pela trilha de auditoria (sem coluna nova): o hub tem um usuario so e ninguem
// para destravar conta a mao, entao a trava se desfaz sozinha com o tempo.
//
// Autoria: Claude (Opus 5.5), Lab Hub.

import { db } from '../../lib/db.js';
import { auditar } from '../../lib/audit.js';
import {
  conferirSenha, hashSenha, senhaFraca, abrirSessao, fecharSessao, usuarioAtual,
  limparSessoes, encerrarSessoesDe,
} from '../../lib/auth.js';

const ERROS_ATE_ESPERAR = 5;
const JANELA_MIN = 15;

export async function rotasSessao({ request, env, data, partes, metodo, json }) {
  const acao = partes[1] || '';

  if (acao === '' && metodo === 'GET') {
    const u = await usuarioAtual(request, env);
    if (!u) return json({ logado: false });
    return json({ logado: true, definir_acesso: !!u.senha_provisoria, usuario: { nome: u.nome, email: u.email } });
  }

  if (acao === 'entrar' && metodo === 'POST') return await entrar(request, env, data, json);

  if (acao === 'sair' && metodo === 'POST') {
    const u = await usuarioAtual(request, env);
    const cookie = await fecharSessao(env, request);
    if (u) await auditar(env, { quem: u.email, acao: 'logout', entidade: 'usuarios', entidade_id: u.id, ip: data.ip });
    return json({ ok: true }, 200, { 'set-cookie': cookie });
  }

  if (acao === 'acesso' && metodo === 'POST') return await definirAcesso(request, env, data, json);

  return json({ erro: 'rota nao encontrada' }, 404);
}

async function entrar(request, env, data, json) {
  const corpo = await request.json().catch(() => ({}));
  const email = String(corpo.email || '').trim().toLowerCase();
  const senha = String(corpo.senha || '');
  if (!email || !senha) return json({ erro: 'Informe o usuário e a senha.' }, 400);

  const desde = new Date(Date.now() - JANELA_MIN * 60 * 1000).toISOString();
  const erros = await db(env).first(
    "SELECT COUNT(*) AS n FROM auditoria WHERE quem = ? AND acao = 'login-negado' AND quando > ?",
    email, desde,
  );
  if ((erros?.n || 0) >= ERROS_ATE_ESPERAR) {
    return json({ erro: `Muitas tentativas erradas. Espere ${JANELA_MIN} minutos e tente de novo.` }, 429);
  }

  const u = await db(env).first('SELECT id, email, senha_hash, ativo FROM usuarios WHERE email = ?', email);
  const ok = !!u && u.ativo === 1 && await conferirSenha(senha, u.senha_hash);
  if (!ok) {
    // Mesma mensagem para usuario inexistente e senha errada: nao confirma quem existe.
    await auditar(env, { quem: email, acao: 'login-negado', entidade: 'usuarios', ip: data.ip });
    return json({ erro: 'Usuário ou senha incorretos.' }, 401);
  }

  await limparSessoes(env);
  const cookie = await abrirSessao(env, u, data.ip);
  await auditar(env, { quem: email, acao: 'login', entidade: 'usuarios', entidade_id: u.id, ip: data.ip });
  const atual = await db(env).first('SELECT nome, email, senha_provisoria FROM usuarios WHERE id = ?', u.id);
  return json(
    { ok: true, definir_acesso: !!atual.senha_provisoria, usuario: { nome: atual.nome, email: atual.email } },
    200, { 'set-cookie': cookie },
  );
}

async function definirAcesso(request, env, data, json) {
  const u = await usuarioAtual(request, env);
  if (!u) return json({ erro: 'sessão expirada', reautenticar: true }, 401);

  const corpo = await request.json().catch(() => ({}));
  const nome = String(corpo.nome || '').trim().toUpperCase();
  const email = String(corpo.email || '').trim().toLowerCase();
  const senha = String(corpo.senha || '');
  if (!nome) return json({ erro: 'Informe o seu nome.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ erro: 'Informe um e-mail válido.' }, 400);
  const fraca = senhaFraca(senha);
  if (fraca) return json({ erro: fraca }, 400);

  const outro = await db(env).first('SELECT id FROM usuarios WHERE email = ? AND id <> ?', email, u.id);
  if (outro) return json({ erro: 'Este e-mail já é usado por outro acesso.' }, 409);

  await db(env).run(
    'UPDATE usuarios SET nome = ?, email = ?, senha_hash = ?, senha_provisoria = 0, atualizado_em = ? WHERE id = ?',
    nome, email, await hashSenha(senha), new Date().toISOString(), u.id,
  );
  // Senha nova derruba toda sessao antiga (inclusive a desta tela) e abre uma limpa.
  await encerrarSessoesDe(env, u.id);
  const cookie = await abrirSessao(env, u, data.ip);
  await auditar(env, {
    quem: email, acao: 'definir-acesso', entidade: 'usuarios', entidade_id: u.id,
    antes: { email: u.email, nome: u.nome }, depois: { email, nome }, ip: data.ip,
  });
  return json({ ok: true, usuario: { nome, email } }, 200, { 'set-cookie': cookie });
}
