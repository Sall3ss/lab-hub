// projetos/jean/api.js - rotas do projeto "Jean".
// Chega aqui tudo que for /api/p/jean/<resto>, ja com sessao conferida pela porta
// unica (functions/api/[[path]].js). Tabelas deste projeto levam o prefixo jean_,
// para nunca se misturarem com as de outro projeto do hub.
// Autoria: Claude (Opus 5.5).

export async function rotas({ partes, metodo, json }) {
  // Exemplo: GET /api/p/jean/ping
  if (partes[0] === 'ping' && metodo === 'GET') return json({ ok: true, projeto: 'jean' });
  return json({ erro: 'rota nao encontrada', projeto: 'jean' }, 404);
}
