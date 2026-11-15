-- 0009_cortex_qualidade.sql - Cortex: qualidade do arquivo baixado (pedido do dono, 15/11/2026:
-- "como faço para saber qual a qualidade baixada?"). O agente mede o arquivo pronto com o
-- ffprobe e manda junto com o "concluir". Ex.: "1080p60 · H.264 · 1920x1080 · 412 MB".
-- Autoria: Claude (Opus 5.5), Lab Hub, 15/11/2026.

ALTER TABLE cortex_cortes ADD COLUMN qualidade TEXT;
