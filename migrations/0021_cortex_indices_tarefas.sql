-- 0021_cortex_indices_tarefas.sql - Cortex: índices da fila do PC por corte e por vídeo.
-- Motivo (19/11/2026): a página parou de carregar. O quadro (atualiza a cada 20 s) busca a última
-- tarefa de CADA corte e, sem índice em corte_id, o banco lia a fila inteira 4 vezes por corte:
-- com a live de 10 h (centenas de cortes), centenas de milhares de linhas por atualização - o
-- limite grátis do D1 (5 milhões de linhas lidas por dia) estourava em minutos e tudo parava.
-- Com o índice, cada busca lê 1 ou 2 linhas.
-- Autoria: Claude (Opus 5.5), Lab Hub, 19/11/2026.

CREATE INDEX IF NOT EXISTS idx_cortex_tarefas_corte ON cortex_tarefas(corte_id, tipo, id);
CREATE INDEX IF NOT EXISTS idx_cortex_tarefas_video ON cortex_tarefas(video_id, tipo, id);
