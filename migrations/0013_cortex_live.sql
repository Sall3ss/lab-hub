-- 0013_cortex_live.sql - Cortex: live da Kick ainda rolando + "Puxar o resto".
-- Pedido do dono (18/11/2026): colar kick.com/<canal> com a live no ar e o Cortex pegar o
-- video gravado ate aquele minuto (como o kick-video.download); depois, puxar so a parte nova.
-- Autoria: Claude (Opus 5.5), Lab Hub, 18/11/2026.

-- Canal colado como link de live (kick.com/<canal>). O PC descobre o video gravado da live.
ALTER TABLE cortex_videos ADD COLUMN ao_vivo_canal TEXT;
-- Endereco HLS (master.m3u8) do video da live: o yt-dlp nao abre o link normal enquanto a
-- live roda (Kick responde NOT_FOUND), mas abre o m3u8, que sempre devolve ate o minuto atual.
ALTER TABLE cortex_videos ADD COLUMN fonte_m3u8 TEXT;
-- 1 = a live ainda estava no ar na ultima captura.
ALTER TABLE cortex_videos ADD COLUMN ao_vivo INTEGER NOT NULL DEFAULT 0;
-- Ate onde (s, desde o comeco do video) o texto ja foi capturado. "Puxar o resto" parte daqui.
ALTER TABLE cortex_videos ADD COLUMN capturado_ate_s INTEGER;
-- Preenchido enquanto um "Puxar o resto" busca texto: o PC comeca daqui e o texto antigo fica.
ALTER TABLE cortex_videos ADD COLUMN continuar_de_s INTEGER;
-- De onde a IA le no proximo roteiro (NULL = desde analisar_de_s). Depois de "Puxar o resto",
-- a IA le so a parte nova; os cortes antigos ficam.
ALTER TABLE cortex_videos ADD COLUMN roteiro_de_s INTEGER;
