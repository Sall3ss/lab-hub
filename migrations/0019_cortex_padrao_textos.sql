-- 0019_cortex_padrao_textos.sql - Cortex: padrão de títulos, descrições e tags do canal.
-- Pedido do dono (19/11/2026): a IA entrega 3 opções de título com ângulos diferentes, diz qual é
-- a melhor e por quê, descrição com contexto nas 2 primeiras linhas + hashtags, tags prontas
-- para o YouTube Studio e uma direção para a thumbnail. O "contexto da live" (quem participa, o
-- que está rolando) é escrito pelo dono e entra no roteiro e na legenda (nomes certos).
-- Autoria: Claude (Opus 5.5), Lab Hub, 19/11/2026.

ALTER TABLE cortex_cortes ADD COLUMN titulos TEXT;         -- JSON: as 3 opções de título da IA
ALTER TABLE cortex_cortes ADD COLUMN titulo_porque TEXT;   -- por que a melhor opção é a melhor
ALTER TABLE cortex_cortes ADD COLUMN thumb TEXT;           -- direção para a thumbnail
ALTER TABLE cortex_cortes ADD COLUMN duvida TEXT;          -- o que faltou a IA saber (ex.: quem é o convidado)
ALTER TABLE cortex_videos ADD COLUMN contexto TEXT;        -- contexto da live escrito pelo dono
