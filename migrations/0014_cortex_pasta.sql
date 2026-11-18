-- 0014_cortex_pasta.sql - Cortex: pasta dos cortes escolhida pelo painel, por PC.
-- Pedido do dono (18/11/2026): no PC do trabalho os cortes caiam em C:\Users\...\Videos\Cortex
-- (a pasta padrao do agente) e nao na pasta combinada. Antes so dava para mudar por comando no
-- PC (config.json); agora a tela PCs grava aqui e o agente adota (e mostra a que esta usando).
-- Autoria: Claude (Opus 5.5), Lab Hub, 18/11/2026.
ALTER TABLE cortex_agentes ADD COLUMN pasta TEXT;        -- escolhida no painel (NULL = a do config.json do PC)
ALTER TABLE cortex_agentes ADD COLUMN pasta_atual TEXT;  -- a que o PC disse que usa, no ultimo "oi"
