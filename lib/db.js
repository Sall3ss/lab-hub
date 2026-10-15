// lib/db.js — acesso ao D1 do cliente. Binding padrao: env.DB.
// Toda query passa por aqui pra manter um ponto unico (facilita log, troca, teste).

export function db(env) {
  if (!env.DB) throw new Error('Binding D1 "DB" nao configurado no wrangler.toml deste cliente.');
  return {
    // Retorna todas as linhas
    async all(sql, ...params) {
      const r = await env.DB.prepare(sql).bind(...params).all();
      return r.results ?? [];
    },
    // Retorna a primeira linha (ou null)
    async first(sql, ...params) {
      return await env.DB.prepare(sql).bind(...params).first();
    },
    // Executa (INSERT/UPDATE/DELETE); retorna metadados (meta.last_row_id etc.)
    async run(sql, ...params) {
      return await env.DB.prepare(sql).bind(...params).run();
    },
    // Executa varias em lote (transacao implicita do D1)
    async batch(stmts) {
      return await env.DB.batch(stmts.map(([sql, params = []]) => env.DB.prepare(sql).bind(...params)));
    },
    raw: env.DB,
  };
}
