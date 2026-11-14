-- 0007_cortex_agentes.sql - Cortex, etapa 2: mais de um PC (casa e trabalho).
-- Cada PC escolhe se recebe download de corte. Buscar texto (legenda/audio leve) qualquer
-- PC online faz; o video do corte cai so no PC marcado aqui, para o arquivo nascer onde o
-- dono edita.
-- Autoria: Claude (Opus 5.5), Lab Hub, 14/11/2026.

ALTER TABLE cortex_agentes ADD COLUMN baixa_cortes INTEGER NOT NULL DEFAULT 1;
ALTER TABLE cortex_agentes ADD COLUMN versao TEXT;          -- versao do agente que falou por ultimo
ALTER TABLE cortex_agentes ADD COLUMN ferramentas TEXT;     -- JSON: versoes de yt-dlp e ffmpeg no PC
ALTER TABLE cortex_tarefas ADD COLUMN progresso TEXT;       -- ex.: "baixando 42%" (a tela mostra)
