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
                                 Function → Claude API → roteiro JSON
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
| `cortex_cortes` | o corte: `tipo` longo/curto, `origem` ia/manual, início/fim, título, descrição, tags (JSON), gancho, motivo e nota da IA, `estado` (triagem → download → edicao → publicado, ou descartado), caminho do arquivo no PC |
| `cortex_tarefas` | fila do PC: `texto` (buscar legenda/áudio) ou `baixar_corte`; pendente → pega (com prazo) → feita/falhou, tentativas |
| `cortex_agentes` | o PC (ou PCs) do dono: chave guardada só como hash, `visto_em` (mostra "PC online"), revogação, `baixa_cortes` (0007), versão do agente e das ferramentas |

O **Kanban não tem tabela**: as colunas saem do estado. V1 Entrada, V2 Transcrição, V3 Roteiro
IA (cartão = vídeo) e C1 Triagem, C2 Download no PC, C3 Edição (Movavi), C4 Publicado
(cartão = corte). Transições que o dono pode fazer estão em `TRANSICOES` no `api.js`; o resto
é do agente.

## O roteiro da IA (etapa 3)

- Chamada da Function à **Claude API** (SDK oficial `@anthropic-ai/sdk`, modelo
  `claude-opus-5-5`, em streaming, saída estruturada por JSON Schema em `output_config.format`,
  com `fallbacks` ligado para recusa).
- Entrada: a transcrição como linhas `[hh:mm:ss] texto` + o pedido (foco GTA 6, público BR).
- Saída: `{ longos: [...], curtos: [...] }`, cada um com `inicio_s`, `fim_s`, `titulo`,
  `descricao`, `tags`, `gancho`, `motivo`, `nota`. Longos de 30-40 min, curtos de 45-90 s; o
  servidor valida limites e tempos antes de gravar (o `validarCorte` já existe).
- Custo estimado com os preços de hoje: live de 6 h ≈ 90 mil tokens de entrada e ~8 mil de
  saída ≈ **US$ 0,50 por live** no Claude; a Groq (Whisper) cobra centavos por hora de áudio e
  tem plano grátis com limite diário. Com legenda nativa do YouTube, a Groq nem é chamada.
- Segredos (o dono grava no Pages, nunca nesta máquina): `ANTHROPIC_API_KEY`, `GROQ_API_KEY`.

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
3. ⬜ Roteiro com o Claude (`GROQ_API_KEY` gravada em 14/11; falta `ANTHROPIC_API_KEY`).
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

## Decisões

- 14/11: PC do trabalho liberado pelo dono ("posso utilizar normalmente com essas liberdades").
  Cada PC escolhe se recebe download de corte.
- 14/11: agente liga e desliga à mão pelo atalho da área de trabalho, não com o Windows.

- 14/11: nome **Cortex** (cortes + córtex, a IA que decide). Trocável a qualquer momento: só o
  slug/pasta fica, e é interno.
- 14/11: painel na Cloudflare pessoal, não na VPS corporativa (regras do dono e de infra).
- 14/11: o PC não transcreve nem analisa; só busca texto/áudio leve e baixa trechos.
- 14/11: tema único escuro, visual de editor (timecode, faixas V/C, clipes coloridos por tipo):
  é o padrão das ferramentas de edição e deixa a mídia como a parte mais clara da tela.
- 14/11: título e descrição de corte NÃO levam a máscara de maiúsculas do `campos.js`: é texto
  de publicação, a caixa faz parte do título. Tempos usam máscara própria de timecode.
