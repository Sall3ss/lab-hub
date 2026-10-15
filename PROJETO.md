# Lab Hub - o que é e como funciona

Laboratório pessoal de projetos em fase **beta**. Cada projeto nasce aqui, é testado e,
quando a ideia estiver definida, **migra** para um repositório e endereço próprios.

## Regra principal: projeto não se mistura

Cada projeto tem título, ideia e objetivo próprios, e vive em pastas só dele:

| O quê | Onde |
| --- | --- |
| Tela | `public/projetos/<slug>/` (index.html, estilo.css, app.js) |
| Servidor | `projetos/<slug>/api.js`, respondendo em `/api/p/<slug>/...` |
| Ficha (título, ideia, objetivo, estado, decisões) | `projetos/<slug>/PROJETO.md` |
| Tabelas no banco | prefixo `<slug_com_underscore>_`, migrations `NNNN_<prefixo>_*.sql` |

- O **hub** (`public/index.html`, `hub.css`, `hub.js`) só lista e leva até o projeto.
- A tela do projeto **não carrega nada do hub** (nem o CSS). Só usa o que é da base:
  `/navegador.js`, `/campos.js` e, no servidor, `lib/`.
- Um projeto **nunca** lê tabela ou arquivo de outro.
- Projeto que precisa de processamento pesado (ex.: vídeo) tem um **motor** próprio dentro
  de `projetos/<slug>/motor/`, que roda no computador do dono. Ver o ClipStudio.
- `public/campos.js` ganhou a máscara `url` (aceita localhost). Candidata a voltar para a
  `base-cliente`.

## Criar um projeto

```
node scripts/novo-projeto.mjs <slug> --titulo "..." --ideia "..." --objetivo "..."
```

Copia `scripts/modelo-projeto/` para as pastas do projeto, registra na vitrine
(`public/projetos/projetos.json`) e na API (`projetos/registro.js`, gerado). Não crie à mão:
o script é o que garante o isolamento.

## Fases

`beta` → `pronto` (pronto para migrar) → `migrado` (o card passa a apontar para o
`endereco` próprio). A fase é o campo `fase` em `public/projetos/projetos.json`.

## Migrar um projeto para página própria

1. Novo repositório a partir da `base-cliente` (na conta pessoal).
2. Copiar `public/projetos/<slug>/*` para `public/` do novo repo e `projetos/<slug>/api.js`
   para as rotas dele (a API passa de `/api/p/<slug>/` para `/api/`).
3. Levar as migrations `*_<prefixo>_*.sql` e exportar os dados dessas tabelas.
4. No hub: `fase: "migrado"` e `endereco: "https://..."` no json. As pastas antigas só saem
   depois de conferido o novo no ar (regra de remoção do CLAUDE.md).

## Pendente de infraestrutura (do dono, nas contas pessoais)

- Repositório privado no GitHub pessoal, conta Cloudflare pessoal, D1 e Pages.
- Nome do projeto Pages (sugestão: `lab-hub`) antes de criar: a Cloudflare não renomeia.
- `CLIENTE-SLUG` já trocado por `lab-hub` em `wrangler.toml` e no deploy (15/10): o wrangler
  recusa rodar até no PC com o nome provisório. Se o Pages for criado com outro nome, troque
  nos dois.
- Login: as rotas de sessão (`/api/sessao`) ainda não existem. Só serão necessárias quando
  o primeiro projeto precisar gravar dado no servidor; até lá tudo `/api/p/...` responde 401.
