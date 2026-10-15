# ESTADO - Lab Hub

**Atualizado em 15/10/2026.**

## Pronto

- Página do hub (vitrine de projetos) com estado vazio, cards com título, ideia, objetivo
  e fase, filtro por fase e erro de carregamento com "tentar de novo". Conferida em print no
  PC (1280) e no celular (390).
- Estrutura de isolamento por projeto e o comando `scripts/novo-projeto.mjs`, testado numa
  cópia descartável com dois projetos: pastas separadas, registro da API gerado, slug
  repetido e slug inválido recusados, rota `/ping` respondendo.
- Porta única da API encaminha `/api/p/<slug>/...` para o módulo do projeto, depois das
  travas de sessão.
- Como funciona e como migrar: `PROJETO.md`.

## O que falta

1. 🔴 Primeiro projeto: título, ideia e objetivo (perguntado em 15/10/2026).
2. Infra pessoal (repo, Cloudflare, D1, Pages) e nome do Pages - do dono.
3. Rotas de sessão/login - só quando um projeto precisar gravar no servidor.

## Próximo passo

Receber título, ideia e objetivo do primeiro projeto e criá-lo com o script.

## Por quê

- **Duas pastas por projeto (tela e servidor), não uma:** o que está em `public/` é
  publicado como arquivo aberto; código de servidor ali ficaria exposto. Com o slug no nome
  das duas, continua sendo um projeto, um lugar.
- **Lista em json estático, não no banco:** criar projeto é criar código (pastas), então o
  registro anda junto com o código no Git, e o hub funciona sem banco e sem login.
- **Projeto não carrega o CSS do hub:** é o que permite migrar copiando a pasta, sem
  arrastar dependência.
