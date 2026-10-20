# ESTADO - Lab Hub

**Atualizado em 20/10/2026 (Cyberidle: avaliando o jogo do zip TB Idle como base).**

## Pronto

- Página do hub (vitrine de projetos) com estado vazio, cards com título, ideia, objetivo
  e fase, filtro por fase e erro de carregamento com "tentar de novo". Conferida em print no
  PC (1280) e no celular (390).
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
5. 🟢 **Cyberidle** Fase 1 no ar (15/10): https://lab-hub-9uh.pages.dev/cyberidle - combate
   automático, Creds, XP, level up, upgrade. 20/10: visual com sprites (6 inimigos, arena
   neon), só do OpenTibia Sprite Pack (CC BY 4.0). Ficha com conceito, fases e decisões em
   `projetos/cyberidle/PROJETO.md`. Próximo: Fase 2 (loot/inventário e distritos).
6. 🟡 **Cyberidle vai ser substituído pelo jogo do `TB Idle.zip`** (pedido do dono em 20/10:
   usar como base, ter o jogo todo funcional com UI e animações, e só depois virar cyberpunk).
   O zip (`../_arquivos/Cyberidle/TB Idle.zip`, 819 MB, fora do Git) é o projeto "Tibia Idle
   Global": monorepo pnpm, ~30 mil linhas - `apps/web` (React + PixiJS), `apps/server`
   (Fastify + SQLite + WebSocket), `packages/sim` (combate determinístico), `packages/data`
   (1800 monstros, 131 hunts), sprites oficiais do cliente Tibia extraídos (11 mil webp,
   ~51 MB). Rodado nesta máquina em 20/10 (cópia de teste no scratchpad): **funciona** -
   convidado, criação de personagem, hunt animada no mapa, painéis estilo Tibia.
   Problemas para pôr no hub: (a) o servidor Node+SQLite+WebSocket não roda no Cloudflare
   Pages; (b) os sprites e a UI são arte oficial da CipSoft e o nome "Tibia" é marca dela -
   numa página pública arrisca pedido de remoção que derruba o Pages inteiro (o hub junto).
   ❓ 🔴 Aguardando o dono: (1) modo local no navegador (recomendado) x servidor próprio;
   (2) proteger `/cyberidle` com Cloudflare Access (só o e-mail dele) antes de publicar.
3. Rotas de sessão/login - só quando um projeto precisar gravar no servidor.

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
