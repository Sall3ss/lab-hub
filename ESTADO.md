# ESTADO - Lab Hub

**Atualizado em 15/10/2026 (ClipStudio arquivado; hub limpo, sem projeto).**

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

1. 🟡 Hub no ar pela web (pedido do dono em 15/10: acessar como os outros projetos, sem
   rodar nada local). Precisa da Cloudflare pessoal dele: conta, projeto Pages `lab-hub`,
   banco D1 `lab-hub-d1` (o id vai no `wrangler.toml`) e os secrets `CLOUDFLARE_API_TOKEN` e
   `CLOUDFLARE_ACCOUNT_ID` no repositório. Depois, religar o push no `deploy.yml`.
2. 🟢 Autoria dos 4 primeiros commits (`ventures-dev`, e-mail da empresa): **mantida**, decidido
   pelo dono em 15/10 ("pode manter tudo na empresa, estou usando de testes e treino").
4. ⚠️ `lab-hub.pages.dev` JÁ É DE OUTRA PESSOA (conferido em 15/10: abre "Runstack Lab").
   O Pages do dono, mesmo com o nome `lab-hub`, vai ganhar outro endereço
   (ex.: `lab-hub-xxx.pages.dev`). Anotar aqui o endereço real quando existir.
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
