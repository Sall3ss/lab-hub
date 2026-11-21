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
