-- 0010_cortex_baixar_fora.sql - Cortex: corte aprovado SEM baixar pelo PC.
-- Pedido do dono (15/11/2026): corte longo baixado por fora (site de download do Kick, mais
-- rapido e com qualidade alta). O corte vai direto para C3 Edicao e o painel mostra o inicio
-- e o fim para copiar. 1 = baixado fora do Cortex (o PC nao recebe tarefa); 0 = normal.
-- Autoria: Claude (Opus 5.5), Lab Hub, 15/11/2026.
ALTER TABLE cortex_cortes ADD COLUMN baixar_fora INTEGER NOT NULL DEFAULT 0;

-- Pedido do dono (15/11/2026): o tempo do gancho, para achar o trecho na edicao.
-- Contado desde o comeco do video original (igual a inicio_s/fim_s); a tela e o .txt do PC
-- mostram tambem o tempo dentro do arquivo do corte. NULL = sem tempo (cortes antigos).
ALTER TABLE cortex_cortes ADD COLUMN gancho_inicio_s INTEGER;
ALTER TABLE cortex_cortes ADD COLUMN gancho_fim_s INTEGER;
