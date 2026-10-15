// projetos/clipstudio/api.js - rotas do projeto "ClipStudio".
// Chega aqui tudo que for /api/p/clipstudio/<resto>, ja com sessao conferida pela porta
// unica (functions/api/[[path]].js). Tabelas deste projeto levam o prefixo clipstudio_,
// para nunca se misturarem com as de outro projeto do hub.
// Autoria: Claude (Opus 5.5).

export async function rotas({ partes, metodo, json }) {
  // Exemplo: GET /api/p/clipstudio/ping
  if (partes[0] === 'ping' && metodo === 'GET') return json({ ok: true, projeto: 'clipstudio' });
  return json({ erro: 'rota nao encontrada', projeto: 'clipstudio' }, 404);
}
