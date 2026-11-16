-- 0011_cortex_trecho.sql - Cortex: analisar so um trecho do video.
-- Pedido do dono (16/11/2026): live de 7 h em que o interessante comeca depois de 3 h. O PC
-- busca so o audio/legenda desse trecho, a Groq transcreve so ele e a IA so le dali, sem
-- gastar tempo nem cota com o resto. Tempos contados desde o comeco do video original.
-- NULL = sem limite (do comeco / ate o fim), que e o comportamento de antes.
-- Autoria: Claude (Opus 5.5), Lab Hub, 16/11/2026.
ALTER TABLE cortex_videos ADD COLUMN analisar_de_s INTEGER;
ALTER TABLE cortex_videos ADD COLUMN analisar_ate_s INTEGER;
