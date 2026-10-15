# ESTADO - Lab Hub

**Atualizado em 15/10/2026 (ClipStudio: tela e motor até a transcrição).**

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

1. 🟢 Primeiro projeto criado: **ClipStudio** (`clipstudio`), página em branco no hub.
4. 🟢 ClipStudio: link E arquivo (decidido pelo dono em 15/10). Tela e motor prontos até a
   transcrição.
5. 🟡 ClipStudio: motor e tela LIGADOS no PC do dono (Windows, `C:\Users\F1\lab-hub`, 15/10),
   chave da Groq no `.env` dele. Falta testar com uma live de verdade.
7. ❓ 🔴 Onde o motor mora para não depender do PC do dono (o dono quer que ele e outros
   técnicos usem sem a máquina dele ligada). Opções dadas em 15/10: A) VPS pessoal dele
   (recomendada; risco: YouTube bloqueia download de IP de datacenter), B) VPS da empresa
   (quebra a regra de projeto pessoal, precisa do gestor, segredo em máquina compartilhada),
   C) seguir no PC por ora. Aguardando resposta.
8. ❓ 🔴 Os 4 primeiros commits estão com autor `ventures-dev <contato@informaticaf1.com.br>`
   (feitos antes do repo existir). Passar para o nome do dono ou manter? Aguardando.
6. ClipStudio: etapa 4 (IA escolhe os cortes) e etapa 5 (recorte 9:16 + legenda).
2. Infra pessoal: 🟢 repo criado (`github.com/Sall3ss/lab-hub`, privado). Falta Cloudflare,
   D1, Pages e nome do Pages - do dono. O deploy automático está desligado até lá
   (`.github/workflows/deploy.yml` só roda à mão).
3. Rotas de sessão/login - só quando um projeto precisar gravar no servidor.

## Próximo passo

ClipStudio, etapa 4: mandar a transcrição para a IA e receber os trechos (início, fim,
nota, título, gancho) - a galeria já sabe mostrar.

## Por quê

- **Duas pastas por projeto (tela e servidor), não uma:** o que está em `public/` é
  publicado como arquivo aberto; código de servidor ali ficaria exposto. Com o slug no nome
  das duas, continua sendo um projeto, um lugar.
- **Lista em json estático, não no banco:** criar projeto é criar código (pastas), então o
  registro anda junto com o código no Git, e o hub funciona sem banco e sem login.
- **Projeto não carrega o CSS do hub:** é o que permite migrar copiando a pasta, sem
  arrastar dependência.
