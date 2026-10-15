// projetos/{{SLUG}}/api.js - rotas do projeto "{{TITULO}}".
// Chega aqui tudo que for /api/p/{{SLUG}}/<resto>, ja com sessao conferida pela porta
// unica (functions/api/[[path]].js). Tabelas deste projeto levam o prefixo {{PREFIXO}}_,
// para nunca se misturarem com as de outro projeto do hub.
// Autoria: Claude (Opus 5.5).

export async function rotas({ partes, metodo, json }) {
  // Exemplo: GET /api/p/{{SLUG}}/ping
  if (partes[0] === 'ping' && metodo === 'GET') return json({ ok: true, projeto: '{{SLUG}}' });
  return json({ erro: 'rota nao encontrada', projeto: '{{SLUG}}' }, 404);
}
