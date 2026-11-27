# Cortex

Projeto do Lab Hub (slug `cortex`), criado em 14/11/2026. Sucessor da ideia do ClipStudio
(arquivado em 15/10, tag `arquivo/clipstudio`), refeito de outro jeito.

## Ideia

Central de cortes de lives e vídeos (YouTube, Twitch, Kick): o painel na nuvem transcreve,
a IA marca os cortes longos e os virais com título, descrição e tags, e um agente no PC baixa
só os minutos marcados, prontos para o Movavi Video Editor 25.

## Objetivo

Ter o fluxo inteiro (link → transcrição → roteiro da IA → trecho baixado no PC) funcionando
antes do lançamento do GTA 6, sem nenhuma carga na VPS.

## Fase

Beta.

## Onde mora (e só aqui)

| O quê | Onde |
| --- | --- |
| Tela | `public/projetos/cortex/` (atalho `/cortex`) |
| Servidor (rotas `/api/p/cortex/...`) | `projetos/cortex/api.js` |
| Tabelas | prefixo `cortex_`, `migrations/0006_cortex_base.sql` |
| Rotas do PC (sem sessão, com chave do PC) | `projetos/cortex/maquina.js` |
| Agente do PC | `public/projetos/cortex/agente/cortex-agente.mjs` (servido pelo site para o PC baixar; roda no Windows do dono, nunca na nuvem) |
| Envio dos Shorts ao YouTube (24/11) | `projetos/cortex/youtube.js` (fila, modelo da descrição, prévia) + seção YouTube do agente; migration `0023_cortex_youtube.sql` |
| Sinais da live, corte colado na fala, correções de nomes (27/11) | `projetos/cortex/fala.js`, `projetos/cortex/correcoes.js`, rotas `sinais`/`fala` no `maquina.js`, seção "sinais da live" do agente; migration `0025_cortex_sinais.sql` |
| Esta ficha | `projetos/cortex/PROJETO.md` |

## Arquitetura: quem faz o quê

O pedido falava em "VPS corporativa" para o painel. **Não vai para a VPS**: pela regra do dono
(26/10, nada do hub roda na VPS) e pela regra de infraestrutura (projeto pessoal só nas contas
pessoais), o lado leve fica na **Cloudflare pessoal** (Pages + Functions + D1 do hub). O efeito
pedido é o mesmo, só que mais forte: a VPS fica com carga zero, e não "carga leve".

```
 NAVEGADOR (PC/celular)          CLOUDFLARE (conta pessoal)              PC WINDOWS DO DONO
 ───────────────────────         ─────────────────────────────           ──────────────────────────
 cola o link  ─────────────────► POST /videos → cortex_videos
                                 + tarefa "texto" na fila  ◄──────────── agente pergunta a cada 15 s
                                                                         yt-dlp: legenda nativa?
                                 ◄── legenda (texto, KB) ─────────────── sim: manda a legenda
                                 ◄── áudio leve em partes (opus 24k) ─── não: extrai áudio comprimido
                                 Function → Groq Whisper → texto
                                 tarefa "roteiro" ◄──────────────────── agente pede "próximo passo"
                                 Function → Gemini (grátis) → cortes JSON
 triagem: aprova/descarta ◄────► cortex_cortes (estado)
                                 tarefa "baixar_corte" na fila ────────► yt-dlp --download-sections
                                                                         "*início-fim" → pasta do Movavi
                                 ◄── "baixado em C:\...\01 - título.mp4" ─
 marca "publicado"
```

Por que esse desenho:

- **Quem baixa é sempre o PC.** A Cloudflare não roda yt-dlp/FFmpeg, e YouTube/Twitch/Kick
  bloqueiam com frequência download vindo de datacenter. O PC tem IP residencial e disco.
- **O PC é só braço, não cérebro.** No ClipStudio o motor inteiro (transcrição incluída) morava
  no PC e o painel dependia dele ligado. Aqui transcrição e roteiro são da nuvem; o PC só busca
  texto/áudio leve e baixa os trechos. Com o PC desligado o painel funciona (triagem, edição de
  título, marcar corte à mão) e o trabalho espera na fila.
- **Fila no banco, não conexão aberta.** O PC pergunta ("tem tarefa?"), pega uma com prazo
  (`pega_ate`) e devolve o resultado. Se a rede cair ou o PC desligar no meio, a tarefa volta
  sozinha para a fila depois do prazo. Nada fica preso e nenhuma falha do PC chega ao servidor.
- **Áudio cru no corpo, não base64.** O áudio vai em partes de ~30 min (opus mono 24 kbps,
  ~5 MB cada, abaixo do limite de 25 MB da Groq), cada uma com o seu tempo inicial na URL.

## Modelo de dados (`0006_cortex_base.sql`)

| Tabela | O que é |
| --- | --- |
| `cortex_videos` | link colado: plataforma, id na plataforma (único por dono), título, canal, duração, `etapa` (entrada → transcricao → roteiro → cortado), erro, arquivado |
| `cortex_transcricao` | o texto em pedaços com `inicio_s`/`fim_s` (live de 6 h passa de 400 KB; em pedaços cabe no D1 e a IA aponta o minuto) |
| `cortex_cortes` | o corte: `tipo` longo/curto, `origem` ia/manual, início/fim, título, descrição, tags (JSON), gancho e o tempo dele (`gancho_inicio_s`/`gancho_fim_s`, 0010), motivo e nota da IA, `estado` (triagem → download → edicao → publicado, ou descartado), `baixar_fora` (0010: aprovado sem o PC baixar), `qualidade` (0009), caminho do arquivo no PC |
| `cortex_tarefas` | fila do PC: `texto` (buscar legenda/áudio), `baixar_corte` ou `roteiro` (0008: o PC só puxa os passos da IA); pendente → pega (com prazo) → feita/falhou, tentativas |
| `cortex_roteiro_partes` | (0008) um passo do roteiro já feito: trecho, resumo dos assuntos (JSON), quantos cortes criou, qual modelo respondeu. Permite retomar de onde parou |
| `cortex_agentes` | o PC (ou PCs) do dono: chave guardada só como hash, `visto_em` (mostra "PC online"), revogação, `baixa_cortes` (0007), versão do agente e das ferramentas |

O **Kanban não tem tabela**: as colunas saem do estado. V1 Entrada, V2 Transcrição, V3 Roteiro
IA (cartão = vídeo) e C1 Triagem, C2 Download no PC, C3 Edição (Movavi), C4 Publicado
(cartão = corte). Transições que o dono pode fazer estão em `TRANSICOES` no `api.js`; o resto
é do agente.

## O roteiro da IA (etapa 3, 14/11)

- **Grátis na beta (pedido do dono, 14/11):** Gemini no plano gratuito, com a MESMA chave da
  Jean (`GEMINI_API_KEY`), em `roteiro.js`. Modelos `gemini-3.8-flash`, reserva
  `gemini-3.5-flash-lite` (trocáveis por `CORTEX_MODELO` / `CORTEX_MODELO_RESERVA` no Pages).
  Trocar para o Claude depois = trocar só a função `perguntar` (a ideia original: Claude API,
  SDK oficial, ≈ US$ 0,50 por live de 6 h).
- **Em passos, puxados pelo agente do PC** (tarefa `roteiro`, agente 1.3.0+; agente mais velho
  não recebe): passos 0..n-1 = trechos de ~45 min da transcrição → até 4 cortes CURTOS (45-90 s)
  por trecho + mapa de assuntos com tempos e "força"; passo n (só vídeo com 35 min ou mais) =
  lê o mapa de assuntos inteiro e escolhe de 1 a 6 cortes LONGOS (30-40 min). Cada passo cabe
  numa chamada; a resposta da Function manda um espaço a cada 15 s até o JSON (evita o 524 da
  Cloudflare, lição da Jean). Os cortes vão aparecendo na Triagem enquanto anda; o cartão do
  vídeo mostra "IA lendo trecho 2 de 8 · 5 cortes até agora".
- O servidor valida tudo antes de gravar: tempo dentro do trecho, curto 15-180 s, longo 5-90
  min, título obrigatório, tags minúsculas sem #, nota 0-100, sem repetir corte sobreposto.
- Limite do plano grátis (429): tenta o modelo reserva; se os dois estiverem no limite, o PC
  espera o tempo que o Google pede e repete o MESMO passo. A cota é dividida com a Jean.
- ⚠️ No plano grátis o Google pode usar o conteúdo para melhorar os produtos dele (a
  transcrição de live pública não é sensível).
- Precisão: a transcrição está em blocos de ~30 s, então o início/fim dos curtos sai nessa
  precisão; ajuste fino na Triagem (os tempos são editáveis).
- Segredos (o dono grava no Pages, nunca nesta máquina): `GEMINI_API_KEY` (já existia, da
  Jean), `GROQ_API_KEY` (gravada em 14/11). `ANTHROPIC_API_KEY` só se um dia trocar para o Claude.

## O agente do PC (etapa 2, no ar em 14/11)

- **Node.js 20+ sem dependência nenhuma** (fetch nativo): `cortex-agente.mjs` + `config.json`
  (endereço do painel, chave, pasta) em `C:\Cortex`. Usa `yt-dlp` e `ffmpeg` (winget).
- **Mais de um PC (casa e trabalho):** cada um com nome e chave próprios, gerados na tela
  Cortex › PCs (botão no canto superior direito). A chave aparece uma vez na tela do dono; o
  banco guarda só o hash; "Desconectar" revoga na hora. Buscar texto qualquer PC online faz; o
  download do corte só vai para PC com "Recebe os downloads de corte? Sim".
- **Liga e desliga quando o dono quiser** (pedido de 14/11: não ligar sozinho com o Windows,
  para não consumir a máquina sem uso). `criar-atalho` põe **"Cortex - ligar e desligar"** na
  área de trabalho (ícone da tesoura, `cortex.ico`) e já liga. O atalho roda `alternar`:
  desligado → abre a janela minimizada (`cortex-laco.cmd`, que religa em 30 s se o agente
  cair); ligado → cria `agente.parar`, o agente interrompe o yt-dlp/ffmpeg, **devolve** a tarefa
  para a fila sem contar falha, avisa o painel (`/tchau`, aparece offline na hora) e sai com 2.
- Outros comandos: `conectar <painel> <chave>` (só grava a config e testa; NÃO deixa rodando),
  (vazio) roda nesta janela, `pasta "<caminho>"`, e os opcionais `iniciar-com-windows` /
  `parar-de-iniciar`.
- Atualiza sozinho: o painel informa `versao_atual` (`AGENTE_VERSAO` em `maquina.js`); se for
  diferente, o agente baixa o arquivo novo do site e reinicia. **Ao mudar o agente, suba a
  versão nos dois lugares.**
- Rotas de máquina em `/api/p/cortex/maquina/...` (`maquina.js`), autenticadas pela chave e não
  pela sessão. A porta única da API (`functions/api/[[path]].js`) ganhou a regra genérica:
  `/api/p/<slug>/maquina/...` vai para o `maquina()` exportado pelo projeto, que confere a
  própria credencial; projeto sem `maquina` responde 404.
- Texto: legenda nativa (manual, depois automática `<língua>-orig`) → enviada em lotes; sem
  legenda → áudio `ba/w`, partes de 30 min em opus mono 16 kHz 24 kbps → painel → Groq.
  Sem `GROQ_API_KEY`, a tarefa falha com mensagem clara no cartão.
- Limite do plano grátis da Groq (horas de áudio por hora e por dia): com 429 o agente espera
  o tempo pedido e reenvia a mesma parte (não recomeça a live), mostrando "limite da Groq:
  retoma em N min" no cartão; desiste só depois de 8 h de espera (1.2.0). Live longa no plano
  grátis pode levar algumas horas para transcrever; no plano pago da Groq não espera.
- Download cirúrgico: `yt-dlp --download-sections "*HH:MM:SS-HH:MM:SS" --force-keyframes-at-cuts
  -f "bv*[height<=1080]+ba/b" --merge-output-format mp4`, saída em
  `Cortex\<data> - <canal> - <vídeo>\curtos|longos\NN - <título>.mp4`, com um `.txt` ao lado
  (título, descrição, tags, gancho) para colar na hora de publicar.
- Resiliência: pergunta a cada 15 s, espera crescente quando a rede falha (até 5 min), tarefa
  com prazo, 3 tentativas antes de marcar falha, log em arquivo.

## Etapas

1. 🟢 **Base (14/11):** projeto, cartão no hub, banco completo, tela de editor (quadro de 7
   colunas, linha do tempo com faixas L/C, gaveta de vídeo e de corte, marcar corte à mão,
   aprovar/descartar/cancelar/publicado, arquivar e excluir com confirmação). Testado local.
2. 🟢 **Agente do PC (14/11):** rotas de máquina, tela PCs (casa e trabalho), fila com prazo,
   3 tentativas, "tentar de novo", legenda nativa, áudio → Groq (pronto, falta a chave), download
   cirúrgico com .txt de metadados. Testado local de ponta a ponta com yt-dlp/ffmpeg simulados
   (nada baixado na VPS). Falta o teste real no PC do dono.
3. 🟢 **Roteiro com IA grátis (14/11):** Gemini plano gratuito, em passos puxados pelo agente
   1.3.0, migration 0008. Testado local com Google de mentira (recusa de config, limite em um
   modelo e nos dois, passos, longos, validação). Falta o teste real no ar.
4. ⬜ Acabamento: tentar de novo em falha, filtro por vídeo/plataforma, copiar metadados.
5. 🟡 **Envio dos Shorts ao YouTube (24/11, agente 3.0.0):** pronto e testado local com YouTube
   simulado; falta o dono criar o acesso no Google Cloud e conectar o PC (`node cortex-agente.mjs youtube`).

## Estado

- 14/11: etapa 1 pronta e testada localmente (rotas por curl; tela em print no PC 1280 e no
  celular 390, sem erro no console). Falta publicar (push na main) e o dono abrir no ar.
- Live em andamento não entra: o link aceito é o do vídeo gravado (VOD) ou clipe. Para pegar a
  live logo que acabar, colar o link do VOD (YouTube costuma manter o mesmo link da live).

- 14/11: etapa 2 publicada. O dono conecta o PC de casa e o do trabalho pela tela PCs.
- 14/11: o dono fez os passos 1 e 2 e o PC ficou online por ~2 min e depois offline. Não era
  falha: o passo 2 (`conectar`) só fala uma vez com o painel e fecha; quem fica rodando é o
  passo 3, que ele ainda não tinha feito. O passo 3 virou o atalho de ligar/desligar (1.1.0) e
  a tela PCs passou a mostrar esse comando sempre (não precisa da chave).
- 14/11: primeiro vídeo da Kick parou em "Falta a chave GROQ_API_KEY" (esperado: Kick e Twitch
  não têm legenda). Pendente: o dono criar a chave na Groq e gravar no Pages; depois, um deploy
  para a Function enxergar a chave e "Tentar de novo" no vídeo.
- 14/11: dono gravou `GROQ_API_KEY` no Pages (produção); deploy feito para a Function enxergar.
  O vídeo da Kick transcreveu pela Groq e chegou à V3.
- 14/11: logo do dono: sem fundo como ícone da aba (`_arquivos/Cortex/logo-sem-fundo.py`) e em
  planta (só traço ciano, com cotas) no cartão do hub (`logo-planta.py` →
  `public/hub-cartoes/cortex.webp`).
- 14/11: o vídeo parou na V3 "aguardando a IA (etapa 3)": a etapa ainda não existia. O dono
  pediu para fazer GRÁTIS para testar: etapa 3 feita com o Gemini gratuito (chave da Jean). A
  migration 0008 coloca na fila do roteiro os vídeos que já estavam na V3.
- 14/11: **etapa 3 funcionou no ar** com a live da Kick (5h22): 19 cortes na Triagem (3 longos,
  16 curtos) e marcas na linha do tempo. Com muitos cartões a coluna espremia os cartões (só a
  1ª linha aparecia): corrigido (`.col-lista > * { flex-shrink: 0 }`), conferido em print no
  PC e no celular com 23 cartões.
- 15/11: três problemas no uso real (dono), resolvidos no agente 1.4.0:
  - **Corte longo horas sem terminar e sem %:** no download de trecho quem trabalha é o
    ffmpeg, e o agente só lia o "%" do yt-dlp. Agora lê o `time=`/`speed=` do ffmpeg e o cartão
    mostra "baixando 42% · 4.2x · faltam ~8 min". E o longo baixa SEM `--force-keyframes-at-cuts`
    (que recodificava os 35 min no PC, a causa provável das horas); o curto continua exato.
    Vigia: 10 min sem avançar (nem % nem tamanho do arquivo) = derruba e tenta de novo (até 3).
  - **Tempo editado não valia no download:** "Aprovar e baixar" mandava só o estado; o tempo
    editado sem "Salvar" se perdia. Agora aprovar leva junto tudo o que está no formulário.
    Botões −5 s/+5 s no início e no fim. "Baixar de novo" (edição) também aceita tempo novo.
  - **"PC offline" com o Cortex ligado:** era só visual. Durante uma tarefa o agente dava sinal
    a cada 5 min e a tela considera offline depois de 2. Agora sinal a cada 1 min; e se uma
    tarefa ficar 3 min sem notícia, o cartão avisa "sem notícia há N min" (aí sim caiu).
  Testado local: tempo editado gravado na aprovação, % e tempo restante chegando ao painel,
  download travado derrubado e repetido, gaveta no PC e no celular.
- 15/11: **qualidade do arquivo baixado** (pergunta do dono). O yt-dlp pede o melhor até 1080p
  (`bv*[height<=1080]+ba/b[height<=1080]/b`): se a origem é 720p, vem 720p; acima de 1080p
  (1440p/4K no YouTube) é limitado a 1080p. Agente 1.5.0 mede o arquivo pronto com o ffprobe e
  manda no "concluir"; coluna `qualidade` (migration 0009). Aparece no cartão ("▣ 1080p60 ·
  H.264"), na gaveta (com resolução e tamanho) e no .txt ao lado do vídeo. Testado local com
  um mp4 real 1080p60.
- 15/11: três pedidos do dono (migration 0010, agente 1.6.0):
  - **Aprovar sem baixar** (cortes longos): o dono baixa o trecho por fora
    (https://kick-video.download, mais rápido e com qualidade alta). Botão "↗ Sem baixar" no
    cartão da triagem e "↗ Aprovar sem baixar" na gaveta: o corte vai direto para C3 Edição com
    `baixar_fora = 1` (o PC não recebe tarefa). A gaveta mostra início, fim, duração, gancho e
    link do vídeo, cada um com "Copiar", o botão que abre o site e "Copiar título, descrição e
    tags". O tempo continua editável (não há arquivo no PC para desencontrar). Saídas: "Marcar
    publicado", "Baixar pelo PC" (vira download normal) e "Voltar para a triagem".
  - **Concluir vídeo** ("resetar a linha do tempo"): arquiva o vídeo. Ele e os cortes saem do
    quadro e da linha do tempo, nada é apagado, e o botão "Concluídos" (topo do quadro) lista e
    reabre. Quando todos os aprovados de um vídeo estão publicados, aparece uma faixa verde
    "Tudo publicado · Concluir vídeo" acima do quadro. Recusa se houver corte na fila do PC.
    Substitui o antigo "Arquivar" da gaveta do vídeo (mesma ação, nome mais claro).
  - **Tempo do gancho**: campos "Gancho começa/termina" (±1 s) abaixo do gancho, com o tempo
    dentro do arquivo do corte (o que o Movavi mostra) calculado na hora. A IA passa a devolver
    `gancho_inicio`/`gancho_fim` nos roteiros novos (descartado se cair fora do corte); cortes
    antigos ficam sem, para preencher à mão. O .txt do PC (1.6.0) ganha "GANCHO NO CORTE".
  Testado local: transições e recusas da API, validação do gancho (servidor e IA), concluir e
  reabrir, telas no PC e no celular sem erro.

- 16/11: **analisar só um trecho** (pedido do dono: live de 7 h em que o bom começa depois de
  3 h). Migration 0011 (`analisar_de_s`/`analisar_ate_s` em `cortex_videos`, NULL = sem limite),
  agente 1.7.0.
  - Importar: botão "⏱ Começar em…" (era "Só um trecho"; renomeado a pedido do dono: o uso
    principal é a live inteira a partir de um ponto) ao lado do link abre "Analisar a partir de" e "Até (vazio =
    até o fim)". Gaveta do vídeo: os mesmos campos + "Salvar trecho". Cartão mostra
    "⏱ 03:00:00 → fim"; a linha do tempo listra o que ficou de fora.
  - PC: legenda nativa é filtrada no trecho; sem legenda, o yt-dlp baixa SÓ o áudio do trecho
    (`--download-sections "*03:00:00-inf"`) e cada parte vai à Groq com o tempo somado ao início
    (os tempos continuam do vídeo original). Agente < 1.7.0 não recebe texto de vídeo com trecho
    (buscaria a live inteira); ele se atualiza sozinho em até 10 min.
  - IA: os trechos de ~45 min começam no "de" (live de 7 h a partir de 3 h = 5 passos, não 9);
    cortes da IA fora do trecho são descartados na validação.
  - Mudar o trecho depois (`POST /videos/:id/trecho`): na entrada só grava. Com texto pronto,
    pede confirmação e refaz: se o texto atual cobre o trecho novo, só a IA lê de novo (sem
    gastar Groq); senão o PC busca o texto de novo. Cortes da IA na triagem/descartados saem;
    aprovados e manuais ficam. Recusa enquanto o PC trabalha no vídeo.
  - "Até" além do fim vira "até o fim"; trecho mínimo 2 min; início depois da duração recusado
    (no servidor e, se a duração só vier do PC, falha clara no cartão para corrigir o trecho).
  Testado local: API (21 verificações), roteiro com Google de mentira (trechos a partir de 3 h e
  depois de 4 h, longos só na parte analisada), agente 1.7.0 com yt-dlp/ffmpeg de mentira
  (baixou só a partir de 2 h, enviou `inicio=7200`), telas no PC e no celular sem erro.

- 17/11: **cortes chegando sem o tempo do gancho** (o dono viu nos últimos cortes). Duas causas
  no `roteiro.js`: (1) `gancho_inicio`/`gancho_fim` eram opcionais no esquema da resposta e o
  Gemini quase sempre os deixava de fora; (2) quando vinham, a IA apontava o começo do BLOCO de
  ~30 s da transcrição, uns segundos antes do corte, e a validação jogava fora. Agora: campos
  obrigatórios; tempo até 30 s fora do corte é trazido para dentro; curto sem tempo usa o começo
  do corte (a regra do roteiro é "começa no gancho") + duração da frase (~2,5 palavras/s);
  longo sem tempo continua vazio. Para os cortes que JÁ existem: botão "Marcar no começo do
  corte" na gaveta, e os ±1 s do gancho com o campo vazio também partem do começo do corte
  (antes não faziam nada). Testado: 7 casos da regra e tela no PC e no celular.

- 18/11: **live da Kick ainda rolando + "Puxar o resto"** (pedido do dono, igual ao
  kick-video.download). Migration 0013 (`ao_vivo_canal`, `fonte_m3u8`, `ao_vivo`,
  `capturado_ate_s`, `continuar_de_s`, `roteiro_de_s`), agente 1.8.0.
  - Colar `kick.com/<canal>`: o vídeo nasce com id provisório (`live:<canal>:<hora>`); o PC
    pergunta à API pública da Kick (`/api/v2/channels/<canal>/videos`) qual é o vídeo da live no
    ar e manda uuid + m3u8 (`POST /maquina/tarefas/:id/live`). Se essa live já estiver no quadro,
    recusa e aponta o "Puxar o resto". Colar a mesma live de novo também é recusado no painel.
  - Descoberto no teste com uma live real (xQc, 9h45 no ar): enquanto a live roda, o yt-dlp NÃO
    abre o link do vídeo (Kick: NOT_FOUND), mas abre o `master.m3u8`, que vem fechado no minuto
    atual (é a "foto" da live). Por isso texto e download de corte desse vídeo vão pelo m3u8.
  - A Kick tem legenda automática nas lives (a da língua do canal é a original; as outras são
    tradução). O PC baixa a da língua do canal em paralelo (12 por vez): 17 min em 4 s. Pelo
    yt-dlp, um arquivo por vez, 9 h de live não terminava em 2,5 min. Sem legenda: áudio pelo m3u8
    só do trecho (testado: 3 min de áudio, 0,5 MB, 21 s) → Groq, como antes.
  - Proteção da Kick: o PC se identifica como `cortex-agente/<versão>`. Fingir ser o Chrome dá 403.
  - "Puxar o resto": botão na gaveta do vídeo e no topo da linha do tempo (vídeo cortado não tem
    cartão no quadro; o nome do vídeo na linha do tempo agora abre a gaveta). Começa 30 s antes de
    `capturado_ate_s`, o texto antigo fica, a IA lê só a parte nova (`roteiro_de_s`), cortes
    antigos ficam. Sem parte nova (menos de 90 s), falha clara: "tente de novo daqui a pouco".
  - Cartão: "● AO VIVO" e "⟳ capturado até HH:MM:SS". Agente < 1.8.0 não recebe texto nem
    download de vídeo de live.
  Testado: painel local + agente 1.8.0 com yt-dlp e Kick de verdade (live no ar): achou a live,
  legenda, roteiro; puxar o resto pegou só os 3 min novos; recusas (link reservado, colar de
  novo, puxar em vídeo comum, puxar duas vezes, mudar trecho durante); tela no PC e no celular.
  Falta: download de um corte de live pelo PC do dono (mesmo yt-dlp, pelo m3u8).

- 18/11: **1º teste do dono com live** (gabepeixe, até 02:00:00): a captura da live funcionou
  (capturado até 2h, duração 6h10 na hora), mas o roteiro parou em "Gemini não respondeu: 503
  high demand". Correções (agente 1.8.1): 503/500/502/504, rede e demora do Google viram ESPERA
  (90 s e repete o mesmo passo, como o limite 429), não falha; o cartão diz "Gemini sobrecarregado".
  E "Puxar o resto" só com o roteiro PRONTO (etapa cortado): com a IA parada no meio, puxar faria
  a parte já capturada ficar sem leitura. Testado local com um Google de mentira devolvendo 503.

- 18/11: **"Puxar mais" aos poucos** (pedido do dono: live de 7 h, puxar mais 2 h, depois mais
  2 h até o fim). O bloco "⟳ Puxar mais da live" na gaveta tem "De (onde parou)", "Até (vazio =
  até o fim)" e atalhos +1 h/+2 h/+3 h/Até o fim; o botão diz o intervalo ("Puxar de 04:00:00 até
  06:00:00 (2h00)"). O botão do topo da linha do tempo abre a gaveta nesse bloco.
  `POST /videos/:id/continuar { ate_s }` grava o "até" em `analisar_ate_s`; "até" além do fim de
  uma live já encerrada vira "até o fim"; vídeo já puxado até o fim recusa. Agente 1.8.2 (a
  1.8.1 puxaria até o fim, por isso não recebe). Testado: API, PC simulado e tela no PC e no
  celular.

- 18/11: **cortes no PC do trabalho caindo em C:\Users\...\Videos\Cortex** (relato do dono). É
  a pasta padrão do agente quando o `config.json` daquele PC não tem `pasta` gravada (o comando
  `pasta` não chegou a valer lá, ou foi rodado numa outra cópia do agente). Correção (migration
  0014, agente 1.8.3): a pasta passa a ser escolhida na tela **PCs** do painel, por PC
  (`cortex_agentes.pasta`). O PC recebe no "oi" (a cada 10 min) e junto de cada download, adota
  na hora e grava no próprio `config.json`; e conta qual pasta está usando (`pasta_atual`, "Usando
  agora" na tela). Caminho precisa ser completo (D:\..., \\servidor\...). Testado: recusa de
  caminho relativo, PC adotando pelo "oi" e pelo download (arquivo caiu na pasta nova), tela no PC
  e no celular.

- 18/11: **ficha .txt também no corte aprovado sem baixar** (pedido do dono: baixa o vídeo por
  fora, mas quer título, gancho, descrição etc. na pasta). Agente 1.9.0. Sem migration: é uma
  tarefa `baixar_corte` de corte com `baixar_fora = 1`, e o PC grava SÓ o .txt (na mesma pasta
  dos cortes: `<data> - <canal> - <vídeo>\Longos\NN - <título>.txt`), começando por
  "BAIXAR POR FORA: início → fim (duração)" e o LINK. Nasce na aprovação e é refeita quando o
  título, gancho, descrição, tags ou tempos mudam (a ficha antiga, de outro nome, sai). Na gaveta:
  "📄 Ficha no PC: ..." e o botão "Gravar ficha no PC / Gravar de novo" (serve também para os
  cortes aprovados antes). `concluir` com `so_ficha` só grava o caminho; o estado não muda.
  Agente < 1.9.0 não recebe (baixaria o vídeo). Testado: recusas, agente gravando só o .txt,
  título novo trocando o arquivo, "Baixar pelo PC" substituindo a ficha na fila, tela no PC e no
  celular.

- 19/11: **vertical 9:16 pronto para os CURTOS** (pedido do dono: escolher um layout - webcam
  topo-direita, topo-esquerda, baixo-esquerda, sem webcam - e o PC já gerar o 1080x1920, sem
  ajustar enquadramento no Movavi). Migration 0015 (`cortex_layouts`; `layout_id` no corte e no
  vídeo), agente 2.0.0, tela nova `public/projetos/cortex/layouts.js`.
  - Tela **▦ Layouts** (botão no topo do quadro): lista à esquerda, print da live ao fundo (Ctrl+V
    ou escolher imagem; fica só no navegador, localStorage, o painel guarda só as coordenadas),
    caixa WEBCAM e caixa GAMEPLAY arrastáveis, canto ◢ muda o tamanho com a proporção TRAVADA na
    do espaço que ocupa no vertical, slider "webcam ocupa N% da altura" (20-60%), prévia do
    celular desenhando o mesmo recorte que o FFmpeg faz. Salvar, Duplicar, Excluir (confirma),
    alterações não salvas perguntam antes de sair. Os 4 iniciais nascem no 1º acesso.
  - Coordenadas em fração do quadro (0 a 1): valem para 720p/1080p/1440p.
  - Escolha: no vídeo ("Layout vertical dos curtos", padrão) e em cada curto ("Padrão do vídeo",
    um layout, ou "Nenhum"). Longo nunca tem vertical. Vídeo novo do mesmo canal herda o layout
    do anterior (o streamer costuma manter a webcam no lugar). Cartão mostra "▦ <layout>".
  - PC (2.0.0): baixa o curto como sempre (Curtos\NN - título.mp4 + .txt) e gera o vertical em
    `Shorts\NN - título.mp4`: `crop` da webcam e da gameplay, `scale` 1080 de largura, `vstack`
    (webcam em cima), libx264 veryfast crf 20, aac. Se o vertical falhar, o horizontal fica e a
    qualidade do corte diz "vertical FALHOU". Agente < 2.0.0 não recebe curto com layout.
  - Mudou o layout de um corte já baixado: "Baixar de novo" gera o vertical com o novo.
  Testado: API (iniciais, recusas, longo sem layout, padrão do vídeo, "nenhum", excluir), agente
  2.0.0 com FFmpeg real (vertical 1080x1920 com áudio na pasta Shorts), editor com print e arrasto,
  gaveta do corte, PC e celular.

- 19/11: **foto e cena de cada curto** (pedido do dono: a live troca de tela - full cam, jogo
  com webcam - e o layout certo muda junto; ver o corte antes de aprovar). Opção A escolhida pelo
  dono. Migration 0016, agente 2.1.0, `projetos/cortex/cena.js`.
  - Tarefa nova `quadros` (uma por vídeo): depois do roteiro (e ao reabrir um vídeo, criar curto
    à mão, mudar o tempo de um curto na Triagem ou "📷 Tirar foto de novo"), o PC tira UMA foto
    640 px do meio de cada curto da Triagem sem foto: `yt-dlp -g` (até 720p) dá o endereço e o
    `ffmpeg -ss` pula direto para o segundo. Não baixa o vídeo.
  - Nuvem (`/maquina/tarefas/:id/quadro`): guarda no R2 (`ARQUIVOS`, chave `<dono>/<corte>-cortex-quadro.jpg`)
    e pergunta ao Gemini grátis a cena: `fullcam`, `jogo_webcam` ou `jogo` (+ certeza). Limite do
    plano grátis: o PC espera e manda a mesma foto de novo.
  - Layout pela cena: na tela Layouts, "Usar sozinho quando a foto do corte mostrar" (Full cam /
    Só o jogo; um layout por cena). Nasce o layout **Full cam** (recorte 9:16 no centro), marcado
    para `fullcam`; "Sem webcam" fica para `jogo`. `jogo_webcam` = padrão do vídeo. Só troca
    curto na Triagem e só se o dono não escolheu à mão (`cena_auto`); escolher à mão vence.
  - Tela: gaveta do curto mostra a foto com as caixas do layout escolhido por cima (mudam junto
    com o seletor), a prévia do vertical (o mesmo recorte do FFmpeg), "IA: Full cam (90%)" e
    "📷 Tirar foto de novo". Cartão: "▦ Full cam · auto".
  - Fotos saem do R2 ao excluir o corte/vídeo, ao refazer o trecho (cortes da IA) e ao concluir
    o vídeo (reabrir tira de novo). `GET /quadros/:id` só com login.
  - **Sem o depósito R2 ligado, a cena é detectada igual** (só não há foto para ver). A ligação
    `[[r2_buckets]]` no `wrangler.toml` entra DEPOIS que o dono criar o depósito `lab-hub-arquivos`
    na Cloudflare dele (ligar antes derruba o deploy).
  Testado local (R2 simulado, Google de mentira, vídeo de 80 min servido por HTTP, ffmpeg real):
  20 fotos e cenas, layout trocado só onde devia, escolha manual preservada, limite do Gemini com
  espera, fila sem duplicar, limpeza do R2 (excluir, concluir), reabrir refaz, foto exige login,
  tela no PC e no celular sem erro. 19/11: depósito `lab-hub-arquivos` criado pelo dono e ligado
  no `wrangler.toml` (binding `ARQUIVOS`), publicado. Falta: teste com live de verdade.

- 19/11: **legenda automática, estilo Shorts** (pedido do dono: "muito trabalho para legendar";
  escolheu o estilo A). Agente 2.2.0, rota `/maquina/tarefas/:id/palavras`. Sem migration.
  - Depois de baixar o corte, o PC separa o áudio (mono 16 kHz opus 24k, ~180 KB/min) e manda;
    a nuvem pede ao Whisper da Groq (mesma `GROQ_API_KEY`, grátis) o tempo de CADA palavra
    (`timestamp_granularities[]=word`; se a Groq recusar, reparte o tempo de cada frase).
  - Curto com layout: o vertical sai **legendado** (até 3 palavras, Arial Black 92, branco com
    contorno preto, a palavra falada em amarelo; na emenda webcam/jogo, ou abaixo do meio sem
    webcam) e, na MESMA passada do FFmpeg (`split` + `ass`), o vertical **sem legenda** em
    `Shorts\sem legenda\`. O FFmpeg roda dentro da pasta temporária e o filtro usa só
    "legenda.ass" (caminho do Windows com "C:" quebra o filtro).
  - Todo corte baixado (curto e longo) ganha um `.srt` ao lado (frases de até ~42 letras), para
    corrigir à mão ou mandar ao YouTube. Longo não leva legenda gravada no vídeo.
  - Falhou a legenda (Groq fora, limite, sem fala, FFmpeg sem libass): o corte sai igual, sem ela,
    e a qualidade diz "legenda FALHOU (refaça com Baixar de novo)". Cartão: "· legendado" ou
    "· sem legenda".
  Testado local (Groq de mentira, vídeo 1080p de 20 s, FFmpeg real com libass): curto Full cam e
  curto com webcam legendados nas posições certas, destaque amarelo, versão sem legenda, .srt nos
  curtos e no longo, Groq fora do ar sem travar o corte, cartões no PC e no celular. Falta: o
  Whisper de verdade (pedido de tempo por palavra na Groq real) e conferir a fonte no Windows.
  Próximo passo proposto: revisar/corrigir o texto da legenda no painel antes de gerar o vídeo.

## Decisões

- 19/11: legenda **gravada no vertical pelo PC** (FFmpeg/libass), não num editor: sai pronta
  para postar; a versão sem legenda e o .srt ficam como reserva para correção.

- 19/11: foto do corte **no R2, não no D1** (regra da base: arquivo mora no depósito, o banco
  guarda a chave). Pequena (640 px, ~15-30 KB) e apagada quando o vídeo é concluído.

- 19/11: no vertical a **webcam fica em cima** e a gameplay embaixo (padrão dos shorts de live);
  o "topo-direita/baixo-esquerda" do layout é onde a webcam está na LIVE, não no vertical.
- 19/11: o **print da live não vai para a nuvem** (o hub não tem depósito de arquivos e a imagem
  só serve para desenhar); em outro aparelho o editor mostra a grade e dá para colar outro print.

- 18/11: live da Kick vai pelo **m3u8** (o link do vídeo não abre enquanto a live roda) e o
  texto prefere a **legenda da própria Kick** na língua do canal (instantânea, sem gastar a cota
  da Groq). Se a qualidade dela incomodar, dá para forçar o Whisper (Groq).

- 16/11: trecho mudado com texto pronto **aproveita a transcrição** quando ela cobre o trecho
  novo (só a IA refaz), para não gastar a cota grátis da Groq de novo.

- 15/11: "resetar a linha do tempo" = **concluir (arquivar)**, não apagar: guarda o histórico
  do que foi publicado e dá para reabrir. Apagar de vez continua em "Excluir vídeo".

- 14/11: **IA do roteiro grátis na beta** (pedido do dono: "primeiro quero entender o
  funcionamento, se der certo mais pra frente utilizo apis pagas"). Gemini gratuito com a chave
  da Jean, no lugar do Claude (que não tem plano grátis). Voltar ao Claude = trocar `perguntar`.

- 14/11: PC do trabalho liberado pelo dono ("posso utilizar normalmente com essas liberdades").
  Cada PC escolhe se recebe download de corte.
- 14/11: pasta dos cortes é por PC (config.json do agente, comando `pasta`; desde 18/11 também na tela PCs, que vale mais). O dono pediu, nas duas máquinas (casa e trabalho),
  `D:\Meus Documentos\Vídeos\Cortex`; o padrão continua `%USERPROFILE%\Videos\Cortex`.
- 14/11: agente liga e desliga à mão pelo atalho da área de trabalho, não com o Windows.

- 14/11: nome **Cortex** (cortes + córtex, a IA que decide). Trocável a qualquer momento: só o
  slug/pasta fica, e é interno.
- 14/11: painel na Cloudflare pessoal, não na VPS corporativa (regras do dono e de infra).
- 14/11: o PC não transcreve nem analisa; só busca texto/áudio leve e baixa trechos.
- 14/11: tema único escuro, visual de editor (timecode, faixas V/C, clipes coloridos por tipo):
  é o padrão das ferramentas de edição e deixa a mídia como a parte mais clara da tela.
- 14/11: título e descrição de corte NÃO levam a máscara de maiúsculas do `campos.js`: é texto
  de publicação, a caixa faz parte do título. Tempos usam máscara própria de timecode.
- 19/11 (tarde): o 1º curto real veio **só horizontal + .srt**: o vídeo estava com layout
  "Nenhum" (o primeiro vídeo de um canal não tinha de quem herdar). Agora vídeo sem layout fica
  com o layout **com webcam** salvo por último (`herdarLayout` + migration 0017 para os vídeos
  no quadro), e o cartão do curto sem layout mostra "só horizontal · sem layout" em vermelho.
  A legenda só é gravada **no vertical**; o horizontal leva só o `.srt`.
- 19/11 (agente 2.3.0, pedido do dono): curto com layout sai **só em `Shorts`** (vertical
  legendado + ficha .txt + cópia em `Shorts\sem legenda`); o horizontal é baixado em `_baixando`
  e apagado (se o vertical falhar, ele vai para `Curtos`). Sem layout ("Nenhum") e longos: só o
  horizontal + .txt, **sem legenda e sem .srt**. Legenda em **português fixo** (`language=pt`;
  antes o Whisper adivinhava e saiu em inglês), modelo `whisper-large-v3` (mais preciso que o
  turbo) e tempo ajustado: início real do áudio (ffprobe), bloco entra 0,12 s antes da fala e
  não pisca entre blocos próximos.
- 19/11 (agente 2.4.0, pedido do dono): **legenda revisada antes de baixar.** Na gaveta do curto
  (Triagem/Edição), "📝 Transcrever para revisar" cria a tarefa `legenda`: o PC busca só o ÁUDIO
  do trecho (`yt-dlp -g -f ba/b`, `ffmpeg -ss -t`), o painel manda ao Whisper e guarda as palavras
  em `cortex_cortes.legenda` (JSON `{p,i,f}`, migration 0018). O dono corrige frase por frase
  (frase mudada reparte o tempo dela entre as palavras novas) e salva; "Aprovar e baixar" salva
  antes o que estiver pendente. No download o PC usa esse texto (não chama a Groq de novo); sem
  revisão, transcreve sozinho e o texto também fica guardado (dá para corrigir e "Baixar de
  novo"). Tempo do corte mudou = legenda apagada. Cartão mostra "· legenda ✓".
- 19/11: "Editar layouts" na gaveta do corte abre o editor com a **foto daquele corte** de fundo
  (não é gravada como print do layout).
- 19/11 (agente 2.5.0): **legenda que "parou" no meio** = o Whisper pulando um pedaço (áudio
  ruim/música), não limite da Groq (limite falha a legenda inteira). Agora o PC acha buracos de
  3,5 s+ sem palavra e manda só aquele pedaço de novo (até 3 rodadas, máx. 10 pedidos); o painel
  tira palavras de segmento que o próprio Whisper marca como "sem fala" e frases-fantasma
  ("legendas pela comunidade Amara.org"...). Buraco que sobrar aparece na revisão com um campo
  para o dono escrever. O "contexto da live" vai como prompt do Whisper (nomes certos).
- 19/11: **padrão de títulos/descrições/tags do canal** (texto do dono, resumido sem perder regra
  em `PADRAO`, roteiro.js): 3 títulos em MAIÚSCULAS com ângulos diferentes + o melhor e por quê,
  descrição (2 primeiras linhas de contexto, complemento breve, hashtags), 8-15 tags na grafia
  normal, direção de thumbnail, "dúvida" quando falta informação, sem emoji (tirado no código
  também), sem repetir estrutura dos títulos já usados na live. Campo **Contexto da live** na
  gaveta do vídeo (migration 0019). Botão **"✨ Refazer textos com a IA"** no corte (não grava;
  o dono confere e Salva). A ficha .txt leva as 3 opções e a thumbnail.
- 19/11: **"Puxar mais" também em vídeo GRAVADO** analisado só em parte (pedido do dono: VOD de
  10 h do Coringa, analisou 2 h e quer ir pegando o resto). Antes só valia para link de live
  (`ao_vivo_canal`). Onde parou = `capturado_ate_s` ou, se faltar, `analisar_ate_s`; aparece
  enquanto esse ponto estiver antes do fim do vídeo. O PC (1.8.2+) já começava de
  `continuar_de_s` em qualquer vídeo; só o painel e a tela travavam.
- 19/11 (agente 2.6.0): **logo do canal nos curtos.** Enviada no editor de layout (reduzida na
  tela para até 800 px, PNG, corpo cru) e guardada no R2 (`<dono>/0-cortex-logo.png`, tabela
  `cortex_marca`, migration 0020). Cada layout liga a logo e define posição/tamanho/opacidade
  (arrastando na prévia, que mostra as faixas dos botões/título do app e a da legenda). O PC
  baixa a logo uma vez (`logo-<data>.png` ao lado do programa, troca quando o dono troca) e faz
  `overlay` por cima do vertical e por baixo da legenda. Excluir a logo apaga o objeto do R2 e
  desliga em todos os layouts. A ficha .txt ganhou `HASHTAGS:` (as tags com #, sem espaço).
- 19/11 (agente 2.6.1, pedido do dono: "tudo estruturado para só copiar e colar"): a ficha .txt
  abre com **PARA PUBLICAR** (TÍTULO / DESCRIÇÃO pronta / TAGS do Studio) e depois **PARA EDITAR**
  (qualidade, opções de título, gancho, thumbnail, origem). Descrição pronta = texto da IA sem a
  linha de hashtags do fim + uma linha só de hashtags (as da descrição primeiro, depois as das
  tags), sem repetir, no máximo 8 (mais de 15 o YouTube ignora todas). Tags do Studio limitadas a
  500 caracteres. A gaveta do corte tem os mesmos 3 botões "Copiar" (usam o que está nos campos).
- 19/11: quadro **não volta mais para o topo** sozinho (a atualização de 20 s redesenhava as
  colunas; agora só redesenha se algo mudou e devolve a rolagem de cada coluna) e os cortes de
  cada coluna ficam em **ordem de tempo** (início do corte), agrupados por vídeo.
- 19/11 (noite): dono relatou "a página parou de carregar". Daqui não dá para abrir com a sessão
  dele; corrigido o que podia travar: (1) depois de uma falha, "Tentar de novo" ficava preso em
  "Carregando" (a correção da rolagem pulava o redesenho) - agora redesenha; (2) GET
  /videos/:id mandava a legenda inteira de cada corte (live de 10 h: ~3 MB) - agora só
  `tem_legenda`; (3) erro de programa aparece ESCRITO na tela (`#erro-tela`, no index.html) para
  um print bastar. Teste local com 330 cortes: quadro em <1 s, vídeo em 216 KB.
- 19/11: editor de layout aberto pela gaveta do corte: ao fechar, a gaveta passa a usar o layout
  salvo por último (PATCH no corte, `cena_auto = 0`, a foto nova não troca mais) e redesenha a
  prévia com as medidas novas. Causa provável do "layout errado ao baixar": corte em "Padrão do
  vídeo" com o layout trocado sozinho pela cena (foto); escolha feita no editor agora trava.
- 19/11 (noite) - **CAUSA REAL da página parada:** a consulta do quadro buscava a última tarefa de
  cada corte SEM índice (`SCAN t`, 4x por corte). Com a live de 10 h, centenas de milhares de
  linhas lidas por atualização (a cada 20 s) - o limite grátis do D1 (5 milhões de linhas
  lidas/dia) estourou, as consultas passaram a falhar (tela parada) e o deploy também (o passo de
  migrations usa o D1). Migration 0021 cria `idx_cortex_tarefas_corte` e `idx_cortex_tarefas_video`
  (busca de 1-2 linhas) e o quadro atualiza a cada 30 s. Se o limite estourou, só volta às 00:00
  UTC (21:00 de Brasília); depois disso, o deploy precisa rodar de novo (Actions › deploy › Run
  workflow, ou um push).
- 20/11 (agente 2.7.0, dono: "em gameplay ele puxa legendas aleatórias que não foram ditas"):
  o Whisper REPETIA o prompt de instrução ("Transcrição em português do Brasil de um trecho de
  live, com pontuação." virou "Coração em português...") e o contexto quando não achava fala.
  Agora: prompt = só os NOMES do contexto (`nomesDoContexto`), nenhum prompt no buraco refeito;
  filtro por trecho (`trechoRuim`): `avg_logprob < -1`, `compression_ratio > 2.4` (loop),
  `no_speech_prob > 0.5` com nota baixa, eco do prompt (85%+ das palavras são os nomes) e
  frases-fantasma; buraco refeito com régua rígida (`lp < -0.6` ou `ns > 0.35` fora). O painel
  devolve os pedaços descartados e o PC não pede de novo (refazer = inventar de novo). Áudio da
  legenda vai com `highpass=90,lowpass=7500`. Revisão ganhou ✕ por frase.
- 20/11 (agente 2.7.1, dono: "a palavra que ainda não foi dita fica na tela"): no vertical, cada
  palavra só aparece quando é dita - as próximas do bloco ficam invisíveis no lugar delas
  (`{\alpha&HFF&}`, o texto não pula), a falada amarela, as ditas brancas. O bloco entra 0,05 s
  antes (era 0,12) e sai 0,35 s depois da última palavra (antes ficava até o próximo bloco se
  viesse em até 0,7 s). Conferido gravando com o libass e tirando quadros.
- 21/11 (novo padrão editorial do dono, agente 2.7.2): o `PADRAO` do `roteiro.js` foi trocado
  pelo padrão novo (melhor gancho em vez de resumo, lista de expressões genéricas a evitar,
  estrutura variada, 3 ângulos: acontecimento / detalhe curioso / reação ou consequência,
  descrição em 2 parágrafos + 3 a 4 hashtags, tags do Studio relevantes, checagem antes de
  entregar). Contexto da live inteira, sem transcrever de novo: o roteiro de um trecho recebe o
  mapa de assuntos dos trechos anteriores; "Refazer textos" recebe o mapa da live toda, 6 min de
  fala antes e 3 min depois do corte (marcados como "não está no vídeo"), e a lista dos outros
  cortes vem com o gancho de cada um. Hashtags da ficha e do "Para publicar": só as da
  descrição (até 5); sem elas, 4 tiradas das tags (antes completava até 8). A escolha dos
  cortes não mudou, e nada regrava corte existente: "Refazer textos" só preenche, o dono salva.
- 21/11 (dono: "evolução do painel de cortes"; diagnóstico apresentado antes, decisões 1A, 2A e
  mapa mantido): cada corte ganha **categoria principal** (hype, engraçado, épico, curiosidade,
  reação, polêmica, história, bastidores ou "a definir"), o motivo, o acontecimento principal, a
  nota de 0 a 10 em 8 critérios (força, contexto, desenvolvimento, desfecho, retenção,
  compartilhamento, autonomia, diferencial) e a "limitação" (o que só o texto não mostra).
  A nota de 0 a 100 passou a ser **calculada pelo código** (`notaDosCriterios`, pesos em
  `PESOS`: força 20, retenção 15, desfecho 15, autonomia 15, contexto 10, desenvolvimento 10,
  compartilhamento 10, diferencial 5); antes era um número "no olho" da IA que nada usava.
  Corte fraco (< 45) só fica com a nota em vermelho (não é descartado). A escolha recebe a
  lista dos cortes já feitos na live com categoria e acontecimento (variedade, sem repetir o
  mesmo momento); a lista de "prefira" saiu, porque as categorias a substituem. A categoria
  orienta os títulos (`PADRAO`, "CATEGORIA NOS TEXTOS"). Cartão: etiqueta discreta ao lado da
  nota. Gaveta: categoria (troca à mão pelo seletor), por quê, acontecimento, gancho,
  limitação e "Como a nota foi calculada" com as barras. Cortes antigos: sem etiqueta, com o
  botão "Classificar com a IA" (rota `POST /cortes/:id/classificar`, guarda a nota antiga em
  `nota_antiga`, não mexe em título, tempo, legenda nem arquivo). Migration 0022 só acrescenta
  colunas. Duração, tempos, transcrição, arquivos e o agente do PC não mudaram.
- 22/11 (dono: "tudo ficou bem devagar"): conferido daqui o que dá para medir. A página e a API
  no ar respondem em 0,1-0,2 s. As consultas novas (outros cortes da live, mapa, fala ao redor)
  usam índice (EXPLAIN). As instruções da IA cresceram de ~1.400 para ~3.200 tokens, contra
  ~10.000 da transcrição de um trecho. Risco achado e corrigido: a resposta por trecho cresceu
  (categoria + critérios) e o limite continuou em 8192 tokens, contando o "pensamento"; se viesse
  cortada, `perguntar` caía nas tentativas seguintes (até 6, de até 150 s). Limite agora em
  16384. Daqui não dá para ver as cotas do Gemini e da Groq nem as métricas do D1 (painel da
  Cloudflare do dono).
- 22/11 (dono: "bem devagar da Entrada até o Roteiro IA"): causa achada na fila do PC. Era uma
  fila só, por ordem de chegada (`/maquina/proxima`, ORDER BY id): vídeo novo esperava todos os
  downloads aprovados antes (cada curto hoje = download + legenda + vertical + logo), e o roteiro,
  criado quando o texto termina, ia para o fim da fila de novo. Agora `PRIORIDADE` em maquina.js:
  legenda (revisão, o dono espera na tela) > roteiro (o PC só espera a nuvem) > fotos > texto >
  baixar_corte; empate pela chegada. Tarefa já em andamento não é interrompida. O quadro ganhou
  `fila` (pendentes + em andamento, pelo índice da fila) e o cartão diz "Na fila do PC · N
  tarefas na frente" / "é a próxima". Testado: com 3 downloads na fila, o PC pegou o texto do
  vídeo novo primeiro. Sem mudança no agente do PC.
- 22/11 (agente 2.8.0, dono: "travando bastante no groq desde hoje à tarde"): o limite grátis da
  Groq é por modelo e apertado (texto = whisper-large-v3-turbo, legenda = whisper-large-v3; na
  ordem de 2 h de áudio por hora e 8 h por dia cada). Uma live longa bate nele, o que é normal.
  O que piorou hoje foi a fila com prioridade: o texto do vídeo novo passa na frente e, na espera
  da Groq (até 30 min por vez), o PC dormia segurando tudo. Agora `aproveitarEspera`: durante a
  espera ele pede `/proxima` com `sem: ['texto','roteiro']` (servidor aceita a lista desde hoje)
  e adianta fotos, legendas e downloads, olhando a fila a cada 20 s; só começa outra tarefa se
  faltarem mais de 90 s de espera. O texto continua pego por este PC (sinal de vida renova o
  prazo) e volta na mesma parte. "Desligar" devolve as duas tarefas. Testado com Groq falsa
  (espera de 5 min): o PC fez as fotos no meio e retomou a parte 1 depois.
- 22/11 (agente 2.9.0, dono: "pegando uma live da Kick e usando a Groq, é porque não tem legenda?"):
  a legenda da Kick só era tentada no link do CANAL (live rolando). Vídeo GRAVADO
  (kick.com/<canal>/videos/<uuid>) ia direto para o áudio (Groq): o yt-dlp não enxerga a legenda
  da Kick. Agora `kickGravado` acha o vídeo na lista do canal (mesma API da live), pega o HLS e a
  língua e tenta `legendaHls` antes; não achou ou sem legenda = áudio como antes. Língua do canal
  desconhecida passou a tentar "pt" (antes ia direto ao áudio). `CORTEX_KICK_API` (env) só para
  teste. Testado com Kick falsa: com legenda, 30 frases e nenhum pedido à Groq; vídeo fora da
  lista, áudio pela Groq. Não conferido com a Kick de verdade se TODO vídeo gravado traz a legenda.
- 23/11 (dono, com a orientação do YouTube Studio do canal NoClipz: poucas views; o que rende é o
  Coringa, Shorts com 60-75% de "continuaram assistindo", o Short se decide nos 2 primeiros
  segundos, tags quase não pesam, vários Shorts no mesmo minuto competem entre si). Sem mudar o
  agente (continua 2.9.0):
  - **Causa achada do "começo frio":** o texto da live era guardado em blocos de ~30 s
    (`juntar` em maquina.js), então a IA só conseguia começar o curto no começo de um bloco, até
    30 s antes do momento-chave. Agora blocos de ~10 s (vale para textos novos; ~3x mais linhas
    em `cortex_transcricao`, leitura continua pelo índice `video_id, inicio_s`).
  - Roteiro: "o inicio do curto é o tempo do gancho (no máximo 1 s antes)"; gancho forte sozinho
    (fala absurda, susto, reação, conflito); contexto vem depois do gancho. Critério `retencao`
    passa a olhar os 2 primeiros segundos.
  - Servidor (`limpar`): curto com gancho mais de 3 s depois do começo passa a começar 1 s antes
    do gancho, se sobrarem 20 s ou mais. Longo não muda.
  - Padrão editorial ganhou "PÚBLICO DO CANAL": com o Coringa no momento, CORINGA no título (de
    preferência no começo, Tainá junto quando faz parte); outro criador sem o Coringa, o título se
    apoia na situação (conflito, reação, absurdo, o que estava em jogo), nome só de apoio, e a
    escolha fica mais exigente. Vale para cortes novos e para "Refazer textos".
  - Tela: cartão de curto na Triagem/Edição com "⚠ começa frio · gancho aos N s" e, na gaveta, o
    botão "Começar no gancho" (põe o início 1 s antes do gancho; só grava no Salvar). No PATCH, se
    só o começo andou para a frente, a legenda revisada é DESLOCADA em vez de apagada.
  - Testado local: regra do `limpar` (gancho aos 12 s -> começa aos 11 s; gancho no começo, sem
    tempo, corte que ficaria curto e longo ficam iguais); aviso, botão e Salvar no PC e no
    celular, legenda corrigida deslocada (palavras do começo frio saem). Não testado com o Gemini
    de verdade: o efeito nas views só se vê depois de alguns dias de publicação.
- 23/11 (dono: "voltar os vídeos do Coringa que estão no download e na edição para a triagem,
  para refazer aos poucos os downloads"): botão "↩ Triagem" no topo das colunas Download e
  Edição abre a gaveta "Voltar para a Triagem", com os cortes agrupados por canal do vídeo
  (marcar o canal inteiro ou corte a corte; só grava ao confirmar). Rota
  `POST /cortes/voltar-triagem {ids}` (até 300, com `auditar` acao 'voltar-triagem'): estado
  'triagem', `baixar_fora` 0, `qualidade` e `erro` limpos, tarefa de download pendente/falhou
  apagada; textos, legenda e `arquivo_local` ficam. Corte que o PC está baixando AGORA não volta.
  O arquivo antigo continua no PC (se o título mudar, o novo sai com outro nome e o antigo precisa
  ser apagado à mão). Testado local: 5 do "coringa" voltaram, 1 em download ativo ficou, os de
  outro canal intactos, auditoria gravada; gaveta no PC e no celular.
- 23/11 (dono: "começar no gancho transforma um corte de 1 min em 22 s"; quer refazer todos os
  cortes de uma vez, desde o começo da live, sem pedir corte a corte):
  - "Começar no gancho" agora ANDA o corte inteiro com a mesma duração (só encurta se bater no
    fim do vídeo); o botão mostra a duração final.
  - `limpar`: a entrada fria só é cortada se sobrarem 40 s ou mais (era 20 s); menos que isso, o
    gancho é o clímax e o corte fica como a IA escolheu. Prompt: os 45-90 s contam a partir do
    gancho; se o forte é o fim de uma conversa longa, o gancho é uma fala forte do meio.
  - "↻ Refazer do zero" na gaveta do vídeo (Roteiro/Cortado ou com erro) e na lista de
    Concluídos (ali, junto com "Excluir", que já existia só na gaveta). Rota
    `POST /videos/:id/refazer {so: 'texto'|'roteiro'}` (`auditar` 'refazer-do-zero'): apaga os
    cortes NÃO publicados (fotos no R2 incluídas), as tarefas deles e o roteiro; publicados
    ficam (a IA os vê em "outros cortes desta live" e não repete o momento); contexto, layout e
    trecho ficam; vídeo volta ao quadro (`arquivado` 0). 'texto' (recomendado) apaga o texto e
    busca de novo, já em blocos de 10 s; 'roteiro' só faz a IA ler de novo. Recusa se o PC
    estiver trabalhando no vídeo. Arquivos no PC ficam.
  - Testado local: bloqueio com o PC baixando; refazer tudo (11 apagados, 1 publicado mantido,
    texto apagado, tarefa de texto nova); "só os cortes" recusado sem texto; vídeo concluído
    reaberto; auditoria; botão do gancho mantendo 1 min; telas no PC e no celular.
  - 23/11, ajuste: o dono travou em "O PC está trabalhando neste vídeo agora (quadros)" num vídeo
    concluído. Agora só bloqueiam texto, roteiro e download/legenda de corte que vai sair, e só
    dentro do prazo; foto em andamento sai junto (o agente trata como "a tarefa saiu deste PC")
    e tarefa vencida não bloqueia. Testado: foto em andamento passa, roteiro em andamento
    bloqueia, roteiro vencido passa.
- 24/11 (dono: "Refazer do zero" deu 1 longo; não quer mínimo, a quantidade de antes servia, quer
  QUALIDADE: longo que segura e rende views). Conferido: as mudanças de 23/11 não tocaram no longo;
  o pedido é "de 1 a N" (N = duração ÷ 40 min, até 6), então 1 é escolha da IA. Achado: a escolha
  dos longos recebia a lista dos curtos com "não repita o acontecimento" e fugia dos melhores
  momentos. Agora (`escolherLongos` em roteiro.js): os curtos entram como PICOS que o longo deve
  conter (com nota e acontecimento); só não repete outro LONGO (inclusive publicado, que também é
  filtrado no código); regras de retenção no pedido (começa em assunto forte, sem "barriga" de
  assunto fraco, termina depois de um desfecho, menos longos se o material for fraco). `aparar()`:
  ponta do longo em assunto de força < 40 sai, desde que fiquem 25 min. Testado com IA simulada.
  Vale para os próximos roteiros e para "Refazer do zero"/"Só os cortes".
- 24/11 (dono: enviar os Shorts direto ao canal pela YouTube Data API v3, OAuth 2.0; arquivo e token
  SÓ no PC; privado por padrão; não subir o mesmo Short duas vezes; modelo de descrição com lugar
  para o texto e as hashtags; falha clara sem travar a fila). Agente **3.0.0**, migration **0023**.
  - Conferido na documentação do Google antes de começar: desde 02/11/2026 o projeto não verificado
    não tem mais os vídeos travados em privado; o envio (`videos.insert`) tem cota própria, ~100 por
    dia. O envio sempre manda `privacyStatus` (sem ele o padrão do YouTube agora é público).
  - Onde fica o quê: painel = fila (`cortex_tarefas` tipo `enviar_youtube`, com `agente_alvo` = o
    PC que tem o arquivo, lido de `arquivo_local` "NOME: caminho"), textos, estado e ID
    (`cortex_cortes.youtube_*`, ID único no banco), configuração (`cortex_youtube`: privacidade
    padrão e modelo). PC = `youtube-cliente.json` (o dono baixa do Google Cloud direto no PC),
    `youtube-token.dat` (acesso permanente protegido pelo Windows/DPAPI) e `youtube-envios.json`
    (registro local: ID e sessão de retomada). Nenhum segredo no painel nem nesta máquina.
  - Modelo da descrição: marcadores `{{descricao}}` (texto da IA sem as hashtags), `{{hashtags}}`
    (até 5, sempre com #Shorts), `{{titulo}}`, `{{criador}}`, `{{link_live}}`; prévia com um Short
    real na tela "▲ YouTube". O texto é montado no SERVIDOR (o mesmo da prévia vai para o PC).
  - Duplicidade, 3 camadas: o painel recusa corte com ID; o PC consulta o registro local antes de
    enviar (subiu mas o painel não soube = só avisa, rota `/maquina/youtube/registrar`); o envio é
    retomável (queda de rede continua do byte em que parou). "Desvincular" esquece o ID (o vídeo
    fica no YouTube) e guarda em `youtube_antigos`, para o PC não reaproveitar o registro local.
  - Falhas: rede/YouTube ocupado = retoma até 6 vezes, depois falha normal (3 tentativas); cota =
    pausa SÓ os envios até a meia-noite do Pacífico (~5 h de Brasília) e o Short volta para a fila
    com o aviso; acesso vencido = pausa os envios até reconectar; arquivo sumido ou texto recusado
    = erro claro no cartão. O PC só recebe envio quando diz estar conectado e sem pausa.
  - "Refazer do zero" passa a manter o corte já enviado ao YouTube (como o publicado) e espera um
    envio em andamento terminar.
  - Testado local (painel de teste + YouTube simulado + agente 3.0.0 real): envio em 3 partes com
    queda no meio e retomada do byte 8.388.608, ID gravado; reenvio recusado; desvincular + novo
    envio não reaproveita o ID antigo; cota esgotada pausa e devolve; aviso atrasado pelo registro
    local; refazer mantém o enviado; auditoria; telas no PC (1280) e celular (390) sem erro e sem
    rolagem lateral. Não testado com o Google de verdade (depende do acesso do dono).
  - Para publicar o app OAuth, o Google exige na tela Branding página inicial, Política de
    Privacidade e Termos no domínio autorizado. Páginas públicas (sem login) em
    `public/projetos/cortex/youtube/` (index, privacidade, termos); domínio autorizado
    `lab-hub-9uh.pages.dev`. Sem verificação: o dono vê o aviso "app não verificado" e segue.
- 24/11, revisão de segurança (pedido do dono): agente **3.0.1** guarda a chave do agente no
  `config.json` protegida pelo Windows (DPAPI do usuário, como o token do YouTube); chave antiga em
  texto é protegida sozinha na primeira leitura. Decisões do dono: VPS continua publicando direto
  (A, mantido); login do painel sem autenticador por enquanto (D). Contas Google e GitHub com
  verificação em 2 etapas: o dono vai fazer.
- 25/11 (pedido do dono: "uma vez upado pro youtube ele já foi publicado"): quando o PC confirma
  o envio, o curto sai da Edição e vai para **Publicado** sozinho (concluir e `/maquina/youtube/
  registrar`). "Desvincular" traz de volta para a Edição (é para enviar de novo). Migration 0024
  acerta os já enviados. Testado local: desvincular > enviar > PC (mock) > Publicado.
- 27/11 (dono estudou o "cortador-de-lives" que um amigo mandou, MIT, Python + Claude Code local;
  análise na conversa; escolheu os itens 1 a 5, descartou tarja de título queimada e pergunta no
  fim da descrição; o 7, layout trocando no meio do corte, ficou em avaliação). Agente **3.1.0**,
  migration **0025**:
  1. **Volume** (ideia central deles: reação não aparece no texto). O PC mede o dB de cada segundo e
     compara com o normal do próprio streamer (mediana de blocos de 30 s, suavizada em ~5 min).
     Kick: não há faixa só de áudio (testado: `audio_only` = 403), então baixa o 160p (~140 MB por
     hora de live, pedaços de 12,5 s, 6 por vez, medidos e apagados). Com áudio já baixado para a
     Groq, mede do próprio arquivo. YouTube/Twitch: o áudio mais leve (`wa`).
  5. **Chat da Kick**: o VOD guarda o chat (`/api/v2/channels/<id>/messages?start_time=`, janela
     fixa de 5 s, teto de 25 mensagens; com 25 a taxa sai do espalhamento dos horários). Uma
     amostra a cada 20 s (30 s em live de mais de 4 h), 2 por vez com ~0,5 s de pausa (testado em
     27/11: 200 seguidos sem bloqueio; 6 por segundo dá 429, aí pausa 30 s e vai mais devagar).
     Canal e hora de início vêm da lista do canal ou de `/api/v1/video/<uuid>` (`start_time` é UTC,
     conferido com a pasta do HLS e com o chat). Chat do YouTube e da Twitch: não (só Kick).
     Força = dB acima do normal + 4 x log2(chat x vezes o normal, olhando até 25 s depois); até 5
     picos por hora (8 a 60), a 90 s um do outro, força mínima 4. Vão ao painel ANTES da última
     parte do texto (`/maquina/tarefas/:id/sinais`, tabela `cortex_sinais`); falhar não impede o
     texto. Roteiro: cada trecho recebe os picos dele com "um pico costuma ser o desfecho, o gancho
     vem antes; pico sem reação na fala não conta"; os longos recebem os 25 mais fortes. Cada corte
     guarda o pico mais forte dentro dele (`sinal`). Tela: "Reações" na gaveta do vídeo, "Reação"
     na do corte e ▼ vermelho na régua da linha do tempo.
  2. **Regras novas no roteiro** (SISTEMA): fala de personagem do jogo não é o streamer; barulho
     sem reação não é momento (nem como pico); leitura de doação/"deixa o like" fora, salvo se for
     a piada. O texto "você lê SÓ o texto" passou a citar os picos.
  3. **Corte colado na fala** (curtos da IA, na Triagem, sem legenda): na tarefa de fotos o PC
     manda ~8 s em volta do começo + 1 s de silêncio + ~9 s em volta do fim (um pedido à Groq por
     curto, ~50 KB); `fala.js` estica o começo até o início da frase (pausa de 0,45 s ou pontuação,
     até 4 s; 0,3 s antes da palavra) e o fim até o fim da frase (até 5 s; 0,5 s depois). **Só
     estica, nunca encurta**: silêncio no texto pode ser a risada/grito que o Whisper não escreve.
     Segundos inteiros, como todo o Cortex. Só grava se o tempo ainda é o que o PC recebeu (ajuste
     do dono nunca é desfeito); gancho continua dentro. Gaveta: "Fala: colado na frase: começa N s
     antes..." e "Voltar ao tempo da IA" (põe nos campos; só grava no Salvar).
  4. **Correções de nomes** (`cortex_correcoes`, por canal ou para todos): "errado -> certo" na
     gaveta do vídeo (Aa Correções de nomes). Valem para o texto que a IA lê (ao receber o texto),
     para a legenda palavra por palavra (rota `palavras`, várias palavras viram uma) e os nomes
     certos vão primeiro na lista do Whisper. O que já foi transcrito não muda. Sem máscara de
     maiúsculas (a caixa do nome faz parte da correção, como no título). Limite 300.
  Testado: regras puras (12 casos: frase cortada no começo/fim, silêncio não encurta, limite de
  4 s, correções com acento e várias palavras, picos com e sem chat); 20 min reais de uma live do
  Coringa medidos em 39 s (8 picos; o mais forte, +14 dB e chat 3,8x, é o fim de um roubo com
  "tem nota pro roubo?"); fluxo completo local com agente 3.1.0 real, Kick real e IA/Groq de
  mentira (texto corrigido, picos no pedido do trecho, corte 02:12:54-02:13:50 colado para
  02:12:52-02:13:53, foto); telas no PC (1280) e celular (390) sem erro nem rolagem lateral.
  Observado aqui: o yt-dlp 2026.10.26 desta máquina dá NOT_FOUND no link de VOD gravado da Kick
  (o caminho pelo HLS funciona); não confirmado no PC do dono.
- 27/11 (print do dono: curto falhou com "Sign in to confirm your age", vídeo do YouTube com
  restrição de idade). Agente **3.1.1**: toda chamada do yt-dlp passa por `rodarYt`; quando o
  YouTube pede login (idade ou "não é um robô"), tenta de novo com `--cookies-from-browser`
  (firefox, edge, chrome, brave, opera, vivaldi) e lembra o que funcionou até reiniciar. O login
  é lido do navegador do PC e não sai dele. Nenhum com login = falha clara pedindo para entrar
  no YouTube pelo Firefox (o Chrome/Edge novos no Windows costumam recusar a leitura) e usar
  "Tentar de novo". Testado com yt-dlp de mentira (Firefox com login; nenhum com login).
- 27/11 (recomendação do YouTube Studio, trazida pelo dono): títulos de Short mais curtos para o
  celular. Regra nova no padrão editorial: Short ideal até 40 caracteres, nunca mais de 50 (o
  título aparece por cima do vídeo e é cortado perto de 40); longo continua até 70. Jogo/evento
  vão para descrição e hashtags quando não são o gancho. Se a opção "melhor" da IA passar de 50
  num Short, `lerTextos` usa a primeira que cabe (e diz isso no "porquê"). Gaveta do corte ganhou
  contador ao vivo (amarelo acima de 40, vermelho acima de 50) e o tamanho de cada opção da IA.
  Títulos já gerados não mudam sozinhos: "Refazer textos" refaz no padrão novo.
- 27/11 (dono: "adicionei uma live e o card sumiu"): vídeo com roteiro pronto e NENHUM corte no
  quadro (live que acabou de começar, trecho curto, ou todos descartados) ficava sem coluna e sem
  cartão: invisível, e colar o link de novo dava "já está no quadro". Agora aparece na coluna
  Roteiro IA com o aviso "A IA não achou corte neste trecho", para abrir e Puxar o resto, mudar o
  trecho, concluir ou excluir (`semCortes` no app.js). Conferido no PC e no celular.
