# ESTADO - Lab Hub

**Atualizado em 14/11/2026 (Cortex: agente do PC, casa e trabalho).**

## Pronto

- Página do hub (vitrine de projetos) com estado vazio, cards com título, ideia, objetivo
  e fase, filtro por fase e erro de carregamento com "tentar de novo". Conferida em print no
  PC (1280) e no celular (390).
- 13/11, pedido do dono: cartões mais modernos (cantos de 1.5rem, sombra suave, cor e
  inicial do projeto calculadas pelo slug, título maior). Ideia e objetivo saíram do cartão
  e foram para o menu de três pontos (canto superior direito) → "Sobre o projeto", que abre
  uma janela com os dois e o botão "Abrir projeto". O cartão inteiro continua sendo o link.
  Conferido em print no PC (1280, claro e escuro) e no celular (390).
- Visual "painel de engenharia" (pedido do dono, depois do item acima): tema único escuro
  (#07090e com grade técnica), ciano #00f0ff nos elementos ativos, fontes Chakra Petch
  (títulos) e JetBrains Mono (códigos, status, contador), via Google Fonts. Cartão = módulo
  chanfrado com código SEC-NN, ID/INIT, coordenadas, cantoneiras e um desenho de esquema
  original no canto inferior direito (`ESQUEMAS` no hub.js: boneco cyberpunk no Cyberidle,
  núcleo de voz na Jean, cubo genérico para os demais; projeto novo ganha desenho
  acrescentando a chave com o slug). Cartões acendem quando o mouse se aproxima. Contador
  virou visor de telemetria; filtros viraram seletores de comando. Menu de três pontos e
  "Sobre o projeto" mantidos. Conferido em print no PC (1280) e no celular (390).
- Fundo com a planta "Lab Hub System Schematic" que o dono mandou (imagem dele): recortes
  em `public/hub-fundo/` (esfera.webp colorida, chip.webp e fluxo.webp em ciano), já sem o
  papel azul. A esfera é o centro (opacidade .78, gira devagar, núcleo rosa pulsando no
  CSS); chip e fluxo bem fracos nos cantos (no celular, só esfera e chip). Cartões ficaram
  translúcidos para a esfera aparecer através deles. ~600 KB no total.
- Estrutura de isolamento por projeto e o comando `scripts/novo-projeto.mjs`, testado numa
  cópia descartável com dois projetos: pastas separadas, registro da API gerado, slug
  repetido e slug inválido recusados, rota `/ping` respondendo.
- Porta única da API encaminha `/api/p/<slug>/...` para o módulo do projeto, depois das
  travas de sessão.
- Repositório: `github.com/Sall3ss/lab-hub` (privado, conta pessoal). Push desta máquina
  com chave própria do repo (`~/.ssh/id_ed25519_labhub`, host `github-labhub`).
- Como funciona e como migrar: `PROJETO.md`.

## O que falta

1. 🟢 **Hub no ar: https://lab-hub-9uh.pages.dev** (15/10). Cloudflare pessoal do dono, D1
   `lab-hub-d1`, projeto Pages `lab-hub` criado pelo próprio deploy. Push na main publica.
   Conferido: página e `projetos.json` (vazio) respondem 200, `/api/p/...` responde 401
   (esperado, sem login). Endereço desconhecido cai no hub (comportamento padrão do Pages).
2. 🟢 Autoria dos 4 primeiros commits (`ventures-dev`, e-mail da empresa): **mantida**, decidido
   pelo dono em 15/10 ("pode manter tudo na empresa, estou usando de testes e treino").
4. ⚠️ `lab-hub.pages.dev` (sem o `-9uh`) é de OUTRA pessoa ("Runstack Lab"). O nosso é
   `lab-hub-9uh.pages.dev`.
6. 🟢 **Cyberidle = jogo do `TB Idle.zip` em modo local, no ar em endereço próprio:
   https://cyberidle-game.pages.dev** (20/10). Roda inteiro no navegador (servidor do jogo
   dentro da página, banco sql.js no IndexedDB), nome trocado para Cyberidle. Projeto Pages
   separado (`cyberidle-game`), publicado pelo mesmo deploy, para um pedido de remoção da arte
   (sprites/UI do Tibia, da CipSoft) não derrubar o hub. Cartão do hub e `/cyberidle` apontam
   para lá. Detalhes em `projetos/cyberidle/PROJETO.md`.
   24/10: a cada wave o personagem anda 2-4 SQMs dentro de uma região contínua do mapa
   (letreiro "WAVE N", monstros novos chegam depois) e os slots de party levam outros
   personagens da conta, escolhidos na engrenagem do painel "Party" (pedidos do dono). Party com cartões
   HP/MP/XP por membro, XP igual à do líder e Helper com aba por membro. 26/10: os
   companheiros lutam de verdade (dano, cura, poções pelo Helper de cada um; Knight segura
   dano do líder). 26/10: salvamento na nuvem (Functions + D1 do hub, tabelas cyberidle_*;
   mesmo personagem no PC e no celular). 27/10: ranking e mercado gerais com travas, chat
   tirado, telas de entrada responsivas; tema cyberpunk (Edinho), visual neon, boas-vindas,
   party v2 e mapas de rua com arte própria. Arte própria etapa 2 (monstros e personagens)
   gerada por código (27/10). 28/10: personagens e monstros com arte feita em IA pelo dono
   (spritelab), ícones de itens, sala de treino e decorações com arte própria, monstros
   cercando o tank. O dono quer mexer no mapa depois.
   Estado e próximos passos na ficha dele.
8. Regra do dono (26/10): nenhum projeto do hub pode rodar na VPS ou pesar nela - tudo no
   navegador ou na Cloudflare.
7. Combinado em 26/10: uma conversa por projeto, com etiqueta `[Hub]` / `[Cyberidle]` no
   começo; o andamento de cada projeto fica na ficha dele (ver CLAUDE.md da pasta).
3. 🟢 **Login do hub (13/11):** `/entrar/`, rotas `/api/sessao` (`app/rotas/sessao.js`),
   administrador com senha provisória (migration `0004_acesso_inicial.sql`; a senha está em
   `_arquivos/PRIMEIRO-ACESSO.txt`, fora do repo, para o dono ler e APAGAR). Vitrine aberta;
   projeto que precisa de login manda para `/entrar/?volta=...`.
9. 🟡 **Jean (13/11): assistente do hub, em `/jean`.** Etapa 1 no ar (login, tabelas
   `jean_*`, casca da tela) e etapa 2 (conversa por texto com o Gemini grátis, lista de
   conversas com busca, fixar, renomear, excluir; confirmada pelo dono no ar) e etapa 3
   (enxerga as fichas dos projetos, memórias, propõe nota/tarefa/memória com cartão de
   confirmação, painel "Pulso do Lab Hub"). Tudo grátis na BETA. Chave `GEMINI_API_KEY`
   gravada pelo dono no Pages. O deploy agora roda `scripts/jean-contexto.mjs`.
   14/11: tarefas da Jean chegam ao Claude Code pelo botão "Copiar para o Claude" no Pulso
   (opção A). A opção B (Jean gravar tarefas no repositório, com token do GitHub) ficou
   guardada na ficha da Jean como alternativa futura, a pedido do dono.
   14/11: etapa 5 no ar antes da 4 - `public/jean-painel.js` (base) põe a Jean em qualquer
   tela do domínio (botão "J" e Ctrl+K); carregado no hub e no modelo de projeto novo.
   Botão no Cyberidle pendente (dono não quer mexer nele agora). Etapa 4 (voz) no ar e confirmada pelo dono
   em 14/11 (conversa por voz no celular, voz do Gemini): ditado e conversa por voz (navegador), áudio gravado (o Gemini ouve), Jean
   falando (TTS oficial do Gemini, reserva voz do navegador). edge-tts recusado (não
   oficial, AGPL, exige Node); motivo na ficha da Jean.
   14/11: visual novo (pedido do dono, print de referência): tema escuro com a esfera de
   fogo no centro representando a Jean, que pulsa com o volume da voz quando ela fala; a
   conversa por voz deixou de abrir outra tela.
   14/11: voz também confirmada no PC (conversa por voz ouvindo pelo Gemini, menos de
   5 s por etapa). Estado e decisões em `projetos/jean/PROJETO.md`.

10. 🟡 **Cortex (14/11): central de cortes, em `/cortex`.** Sucessor da ideia do ClipStudio, refeito:
   a nuvem (Cloudflare pessoal) guarda link, transcrição, roteiro e estado; o PC do dono só
   busca texto/áudio leve e baixa os minutos marcados (yt-dlp) para o Movavi. Etapa 1 pronta
   (cartão no hub, tabelas `cortex_*` na migration 0006, quadro de 7 colunas, linha do tempo,
   corte manual, triagem). Etapa 2 no ar: agente do PC (`cortex-agente.mjs`, Node sem
   dependências) conectado pela tela Cortex › PCs, um por máquina (casa e trabalho). A porta da
   API ganhou `/api/p/<slug>/maquina/...` (sem sessão; o projeto confere a chave). Falta o
   Claude (etapa 3) e a chave `GROQ_API_KEY` para vídeos sem legenda. Arquitetura,
   modelo de dados e próximos passos em `projetos/cortex/PROJETO.md`.

## ClipStudio: arquivado em 15/10/2026

O dono pausou o projeto e pediu o hub limpo. Tudo saiu do código (tela, motor, ficha,
cartão, atalho `/clipstudio`, máscara `url` do `campos.js`, ícone/resumo do cartão).
Nada dele rodava na VPS (conferido: sem processo, sem pacote, sem arquivo fora do repo).

Fica guardado na tag **`arquivo/clipstudio`** (tela + motor Python até a transcrição, e a
ficha com as decisões). Para recuperar:
`git checkout arquivo/clipstudio -- projetos/clipstudio public/projetos/clipstudio`.

Lição: o motor exigia uma máquina ligada (o PC do dono), e o dono quer tudo acessível pela
web sem depender de máquina de ninguém. Se voltar, decidir antes onde o motor mora
(VPS pessoal do dono era a recomendação).

## Por quê

- **Duas pastas por projeto (tela e servidor), não uma:** o que está em `public/` é
  publicado como arquivo aberto; código de servidor ali ficaria exposto. Com o slug no nome
  das duas, continua sendo um projeto, um lugar.
- **Lista em json estático, não no banco:** criar projeto é criar código (pastas), então o
  registro anda junto com o código no Git, e o hub funciona sem banco e sem login.
- **Projeto não carrega o CSS do hub:** é o que permite migrar copiando a pasta, sem
  arrastar dependência.
