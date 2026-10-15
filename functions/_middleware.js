// functions/_middleware.js — roda antes de toda rota. Injeta contexto compartilhado para
// a casca usar. É o ponto onde a BASE se pluga na CASCA.
//
// Só carrega o que é barato e serve a todas as rotas. Quem precisa saber QUEM está
// falando chama `usuarioAtual` (lib/auth.js) dentro do handler - resolver a sessão aqui
// custaria uma consulta ao banco até em requisição que não precisa dela.

export async function onRequest(context) {
  const { request, next } = context;
  context.data.ip = request.headers.get('cf-connecting-ip') || null;
  return await next();
}
