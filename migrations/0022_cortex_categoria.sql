-- 0022_cortex_categoria.sql - Cortex: categoria e avaliação por critérios de cada corte.
-- Pedido do dono (21/11/2026, "evolução do painel de cortes"): cada corte ganha UMA categoria
-- principal (etiqueta no cartão), o motivo da classificação, o acontecimento principal, a nota
-- de 0 a 10 em cada critério (A-H) e o que a leitura só do texto não consegue avaliar. A nota de
-- 0 a 100 passa a ser CALCULADA pelo código a partir dos critérios (roteiro.js, notaDosCriterios).
-- Só colunas novas, todas vazias nos cortes antigos: nada é apagado nem refeito.
-- Autoria: Claude (Opus 5.5), Lab Hub, 21/11/2026.

ALTER TABLE cortex_cortes ADD COLUMN categoria TEXT;        -- hype, engracado, epico, curiosidade, reacao, polemica, historia, bastidores, outro
ALTER TABLE cortex_cortes ADD COLUMN categoria_porque TEXT; -- por que essa categoria
ALTER TABLE cortex_cortes ADD COLUMN acontecimento TEXT;    -- o acontecimento principal do corte, numa frase
ALTER TABLE cortex_cortes ADD COLUMN criterios TEXT;        -- JSON {forca, contexto, desenvolvimento, desfecho, retencao, compartilhamento, autonomia, diferencial} de 0 a 10
ALTER TABLE cortex_cortes ADD COLUMN limitacao TEXT;        -- o que não dá para avaliar só pela transcrição
ALTER TABLE cortex_cortes ADD COLUMN nota_antiga INTEGER;   -- nota "no olho" de antes, guardada quando o corte antigo é classificado
