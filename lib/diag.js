// lib/diag.js — endpoint de diagnóstico. Deixa conferir coisas por HTTP sem publicar de
// novo. Uso: GET /api/diag?fn=ping
//
// Protegido por SESSÃO DE ADMINISTRADOR, e não mais por token compartilhado (ver a nota
// em lib/auth.js sobre a mudança de padrão de 08/08/2026). Efeito colateral bom: o acesso
// ao diagnóstico passa a ter dono, e aparece na auditoria como qualquer outra ação.

import { usuarioAtual, administra } from './auth.js';
import { db } from './db.js';
import { arquivos, temDeposito } from './arquivos.js';

const FUNCS = {
  async ping() { return { pong: true, ts: new Date().toISOString() }; },
  async schema(env) {
    return await db(env).all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  },
  async contarAuditoria(env) {
    const r = await db(env).first('SELECT COUNT(*) AS n FROM auditoria');
    return { total: r?.n ?? 0 };
  },
  async usuarios(env) {
    // Sem hash de senha, nunca. Diagnóstico não é lugar de credencial.
    return await db(env).all('SELECT id, email, nome, perfil, ativo, senha_provisoria, ultimo_acesso FROM usuarios ORDER BY id');
  },

  /**
   * Ida e volta no depósito de arquivos, para provar que ele funciona AQUI - no ambiente
   * de verdade, não no runtime local. Existe porque já aconteceu de o código passar em
   * 150 checagens locais e quebrar só em produção (ver a nota sobre PBKDF2 em auth.js).
   *
   * Grava, lê, confere e apaga um objeto próprio, sob o prefixo reservado `_diag/`.
   * Não toca em nenhum dado de cliente e não deixa rastro no depósito.
   */
  async arquivos(env) {
    if (!temDeposito(env)) {
      return { ligado: false, aviso: 'binding ARQUIVOS ausente. Binding novo só vale no deploy seguinte ao da ligação.' };
    }
    const dep = arquivos(env);
    const chave = `_diag/${crypto.randomUUID()}.txt`;
    const conteudo = `checagem ${new Date().toISOString()}`;
    try {
      await dep.guardar(chave, conteudo, { tipo: 'text/plain', nome: 'checagem.txt' });
      const lido = await dep.ler(chave);
      const devolta = lido ? await lido.text() : null;
      await dep.apagar(chave);
      const sumiu = !(await dep.ler(chave));
      return {
        ligado: true,
        gravou: true,
        leu_igual: devolta === conteudo,
        apagou: sumiu,
        ok: devolta === conteudo && sumiu,
      };
    } catch (e) {
      // Melhor esforço para não deixar lixo se algo falhou no meio.
      try { await dep.apagar(chave); } catch { /* já era */ }
      return { ligado: true, ok: false, erro: e.message };
    }
  },
};

export async function diag(request, env) {
  const u = await usuarioAtual(request, env);
  if (!administra(u)) return json({ erro: 'só o administrador acessa o diagnóstico' }, 403);

  const fn = new URL(request.url).searchParams.get('fn');
  if (!fn || !FUNCS[fn]) {
    return json({ erro: 'fn invalida', disponiveis: Object.keys(FUNCS) }, 400);
  }
  try {
    return json({ ok: true, fn, resultado: await FUNCS[fn](env) });
  } catch (e) {
    return json({ ok: false, fn, erro: e.message }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}
