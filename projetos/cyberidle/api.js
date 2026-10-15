// projetos/cyberidle/api.js - rotas do projeto "Cyberidle".
// Chega aqui tudo que for /api/p/cyberidle/<resto>, ja com sessao conferida pela porta
// unica (functions/api/[[path]].js). Tabelas deste projeto levam o prefixo cyberidle_,
// para nunca se misturarem com as de outro projeto do hub.
// Autoria: Claude (Opus 5.5).

export async function rotas({ partes, metodo, json }) {
  // Exemplo: GET /api/p/cyberidle/ping
  if (partes[0] === 'ping' && metodo === 'GET') return json({ ok: true, projeto: 'cyberidle' });
  return json({ erro: 'rota nao encontrada', projeto: 'cyberidle' }, 404);
}
