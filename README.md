# base-cliente

Template para projetos de clientes. Modelo: **base gorda, casca fina**.
Um **projeto Pages + um D1 por cliente**, tudo numa conta Cloudflare "clientes"
separada da Casa (LCA/F1).

## Ideia
- **Base (`lib/`)** — igual em todo cliente. Conserta um bug aqui, todos herdam.
  auth · db · audit · notify (Resend + WhatsApp oficial) · diag · arquivos (R2).
- **Casca** — única por cliente: `public/` (frontend) + `functions/api/` (rotas) + `migrations/0002+`.

## Novo cliente (resumo)
1. `novo-projeto <slug> cliente` (ver `_governanca/REGRAS.md`).
2. O gestor cria repo, D1 e Pages; preencher `database_id` no `wrangler.toml`, os nomes
   no `.github/workflows/deploy.yml` e o registro em `clientes.json`.
3. `node scripts/admin-inicial.mjs` — gera a migration com o administrador do sistema e
   grava a senha provisória num arquivo FORA do repositório, para o gestor entregar.
4. Push na `main`: o GitHub Actions aplica as migrations e publica.

## Acesso: como todo painel nasce (desde 08/08/2026)

**Não existe token de administração, e não existe senha mestra.** O painel nasce com o
administrador já criado, com senha provisória aleatória. O gestor recebe usuário e senha
uma vez e repassa ao cliente; no primeiro login o sistema **obriga** a pessoa a informar
nome, e-mail e uma senha nova, e a partir daí ela entra pelo e-mail dela.

Vale para qualquer usuário, não só o primeiro: quem o administrador cria também nasce com
senha provisória. Assim **o administrador nunca sabe a senha de ninguém**, e a auditoria
nunca atribui um registro a quem não o fez.

O que sustenta isso:

| Onde | O quê |
| --- | --- |
| `lib/auth.js` | senha (PBKDF2), sessão em cookie, `precisaDefinirAcesso` |
| `migrations/0001_base.sql` | colunas `perfil`, `senha_provisoria`, sessão com IP |
| `scripts/admin-inicial.mjs` | gera a migration do administrador e a senha provisória |
| `functions/api/[[path]].js` | aplica as duas travas antes de qualquer rota |

O motivo da mudança está comentado no topo do `lib/auth.js`. Resumo: token não identifica
ninguém, e a tela pedindo token era um conceito novo aparecendo justo no dia da entrega.

## Migrar schema em todos os clientes
`npm run migrate:all` — roda as migrations em cada D1 do registro (o "imposto" do
modelo D1-por-cliente vira um loop).

## Presets de frontend
- **App/dashboard** (HTML/JS + Functions) — apps internos, atendimento. **[este esqueleto]**
- **Site/catálogo** (Astro) — institucional, landing, loja. **[a adicionar quando surgir o 1º site]**

## Camada shared (seguro de futuro)
`lib/` está isolado de propósito. Quando houver ~3-4 clientes, extrair `lib/` para um
pacote privado versionado é trivial — aí "conserta uma vez" deixa de exigir tocar N repos.
