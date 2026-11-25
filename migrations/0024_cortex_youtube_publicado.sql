-- 0024_cortex_youtube_publicado.sql - Cortex: curto enviado ao YouTube conta como publicado.
-- Pedido do dono (25/11/2026): "uma vez upado pro youtube ele já foi publicado". A partir de agora
-- o painel move sozinho da Edição para Publicado quando o PC confirma o envio; isto acerta os que
-- já tinham sido enviados antes da mudança.
-- Autoria: Claude (Opus 5.5), Lab Hub, 25/11/2026.
UPDATE cortex_cortes SET estado = 'publicado', atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE youtube_id IS NOT NULL AND estado = 'edicao';
