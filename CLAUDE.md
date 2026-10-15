# CLAUDE.md — Projeto de cliente (clone da base-cliente)

Este é um projeto de CLIENTE, isolado. Leia este arquivo inteiro antes de agir.

## Isolamento (crítico)

- Este projeto vê SÓ os dados deste cliente. NUNCA referencie dados, segredos ou nomes de
  outro cliente. Se precisar de exemplo, invente um genérico.
- O banco é o D1 deste cliente (binding `DB`). Não existe acesso a outro D1 aqui.
- Segredos ficam nos secrets do Pages deste projeto. Nada de credencial de outro cliente.
- Esta máquina de desenvolvimento é COMPARTILHADA entre o gestor e o técnico. Trate tudo
  que for escrito aqui (conversa, arquivo, log) como legível por ambos.

## Acesso ao sistema: sem token, sem senha mestra (08/08/2026)

Todo painel nasce com o **administrador já criado** e com senha provisória aleatória, e
obriga a definição do acesso no primeiro login (nome, e-mail e senha nova). Quem gera isso
é `node scripts/admin-inicial.mjs`, que grava a senha num arquivo FORA do repositório para
o gestor entregar uma vez — o que vai para o Git é só o hash.

**Não crie tela de "primeiro acesso" pedindo token, e não reintroduza `ADMIN_TOKEN`.** O
gestor recusou o conceito, com razão: token não identifica ninguém (e prontuário exige
saber QUEM fez cada registro), é um conceito novo aparecendo justo no dia da entrega, e
obriga o gestor a estar no meio de toda implantação.

Enquanto `usuarios.senha_provisoria = 1`, a pessoa entra mas **não faz mais nada** além de
definir o próprio acesso. Essa trava vale no servidor, não só na tela.

## Arquivo do cliente mora no R2, nunca no banco

Foto, documento, exame, comprovante: tudo que o usuário envia vai para o depósito R2, e o
D1 guarda só a **chave** e os metadados. Use `lib/arquivos.js`, que já traz a convenção:

```
depósito:  painel-<cliente>-arquivos
binding:   ARQUIVOS                    (assim como o banco é DB)
chave:     <dono>/<id>-<nome>          ex.: 12/87-exame-audiometria.pdf
```

A chave começa pelo dono para "apagar tudo de um dono" ser um prefixo, e não uma busca.

**Quem manda no ciclo de vida é o banco.** Apagou a linha, apague o objeto na mesma ação -
senão o depósito vira cemitério de arquivo órfão que ninguém sabe de quem é.

**Não mande arquivo em base64 dentro de JSON.** Engorda um terço, obriga navegador e Worker
a segurar tudo na memória, e é o que na prática limita o tamanho. Mande o arquivo cru no
corpo, com os metadados na URL.

⚠️ Binding novo só passa a existir no **deploy seguinte** ao da ligação. Ajuste o código,
publique, e só então ele enxerga `env.ARQUIVOS`.

## ⚠️ Segredo: nunca nesta máquina

**Não peça, não gere e não aceite valor de senha, token ou chave de API nesta máquina.**
O histórico das conversas é gravado em arquivo no disco daqui e é legível por quem tem
acesso à máquina. Segredo entra no sistema por outro caminho:

- **Secret do Cloudflare Pages** (produção) e **secret do repo no GitHub** (deploy) — o
  gestor grava a partir da máquina dele; depois de gravado ninguém lê o valor de volta.
- Aqui você usa só o NOME: `env.NOME_DA_CHAVE`. Nunca o valor.

Se algo exigir um segredo pra continuar, pare e diga ao gestor o que falta — ele grava
do lado dele e você segue.

## Base x Casca

- `lib/` é a BASE compartilhada (auth, db, audit, notify, diag). NÃO customize por
  cliente — corrija na base e propague. Variação por cliente é via config, nunca
  editando o miolo, e NUNCA com `if (cliente === 'X')`.
- A CASCA deste cliente é `public/` + rotas em `functions/api/` + migrations `0002+`.
  É aqui que mora o que é único. Pode regenerar à vontade.
- Capacidade que se repetir em 2 clientes vira módulo compartilhado versionado. No
  primeiro uso, não generalize — resolva o caso concreto.

## ⛔ Antes de REMOVER qualquer coisa em produção

Vale pra função, rota, tabela, coluna, migration, secret, deployment, dependência ou
arquivo. "Parece duplicado", "parece obsoleto" e "parece que não é usado" NÃO bastam:

1. **Leia 100% do código** da coisa — arquivo ou função inteira, até o fim. Nunca as
   primeiras linhas.
2. **Procure todas as referências** no projeto (onde é chamada, agendada, listada).
3. **Descreva o que ela REALMENTE faz**, com base no que leu — não no nome dela.
4. **Apresente ao gestor** o que sai, o que isso quebra se estiver errado, e como voltar.
5. **Espere o "pode remover"** explícito. Aprovação genérica anterior não cobre.
6. **Valide depois** que o estado ficou como esperado.

Dado de cliente em produção não tem desfazer. Na dúvida, não remova: pergunte.

## Fundamentos de tela (aplicar sempre, sem precisar ser pedido)

1. **Saída sempre existe.** Toda tela, modal ou estado tem como voltar, fechar ou cancelar.
2. **Não gravar sem intenção.** Abrir um formulário ou clicar em "Novo" NÃO cria registro.
   Só grava quando a pessoa confirma (Salvar / Criar / Concluir).
3. **Toda criação tem exclusão.** Se dá pra criar, dá pra excluir ou arquivar.
4. **Ação destrutiva confirma** antes de executar.
5. **Cancelar não deixa rastro** no banco.
6. **Vazio e erro tratados** — sem dados mostra mensagem/CTA; falha de rede mostra erro
   claro e não trava a tela.
7. **Funciona no PC E no celular.** Não é opcional: boa parte do uso é no telefone, em
   campo. Teste as duas larguras antes de dar por pronto.

## Navegador embutido de aplicativo: use `public/navegador.js`, SEMPRE

**Toda tela com login carrega `navegador.js`, e ele vem antes de todo o resto.**

```html
<script src="/navegador.js"></script>
```

O link do sistema quase sempre chega por WhatsApp. Quando a pessoa toca, o WhatsApp
**não abre o Chrome nem o Safari**: abre um navegador interno próprio. E ali:

- o armazenamento é **separado** do navegador de verdade e costuma ser descartado. A
  pessoa usa o sistema, fecha, abre pelo ícone e "sumiu tudo"
- não dá para instalar na tela inicial
- compartilhar arquivo (mandar um PDF de volta pro WhatsApp) falha
- a sessão pode não sobreviver

Mesma coisa em Instagram, Facebook, Messenger, TikTok e afins.

O `navegador.js` detecta isso e mostra uma tela cheia pedindo para abrir no navegador de
verdade. No Android tem botão que abre o Chrome direto (`intent://`); no iPhone, o passo
a passo, porque a Apple não permite forçar. Sempre com "continuar assim mesmo", para não
prender ninguém.

**Isto não substitui sincronizar com o servidor.** Todo sistema que guarda dado no
aparelho tem que **subir E baixar**. Se só sobe, basta o armazenamento se perder para
parecer que os dados sumiram.

## Campos de formulário: use `public/campos.js`, NUNCA reimplemente

Existe uma camada pronta na base. **Todo campo em que o usuário digita tem máscara**, e
isso não se pergunta ao gestor — ele cansou de pedir caso a caso.

```html
<script src="/campos.js"></script>
<input data-mask="cnpj">                       <!-- formata + valida dígito verificador -->
<input data-mask="telefone">                   <!-- (12) 98127-6178 -->
<input data-mask="upper">                      <!-- default de texto comum: MAIÚSCULAS -->
<input data-mask="email">                      <!-- minúsculo, sem espaço -->
<input data-mask="cep" data-autocep>           <!-- preenche o endereço sozinho -->
<input data-mask="upper" data-end="logradouro"><!-- destino do autofill -->
```

Depois de montar a tela: `Campos.aplicar(document)`. Antes de salvar:
`if (!Campos.tudoValido(form)) return;`

**A máscara sai da lógica do campo**, sempre:

| Campo | Máscara |
| --- | --- |
| CNPJ / CPF / CEP / telefone | a sua, com validação de dígito verificador onde existe |
| Data | `type="date"` (calendário nativo), NÃO máscara de texto |
| Dinheiro | `moeda` |
| UF | 2 letras maiúsculas |
| E-mail | **minúsculo** |
| Texto comum (nome, endereço, razão social) | **MAIÚSCULAS** |
| Quantidade | `type="number"` |

**Regra do salvar:** campo **vazio pode** salvar (nem sempre se tem tudo na hora); campo
**preenchido tem que ser válido**. Nunca gravar dado inválido "pra corrigir depois".

**Cidade e UF juntos = `Cidade/UF`**, com barra. Nunca hífen, vírgula ou travessão.

**Facilitar o preenchimento é parte do trabalho, não enfeite:**
- Conjunto conhecido (status, tipo, técnico) = lista para escolher, nunca digitação livre.
- Lista longa = campo de busca, nunca `<select>` com centenas de opções.
- Sim/Não = dois botões na linha do rótulo, nunca `<select>` ocupando uma linha inteira.
- Campo que só faz sentido depois de outra resposta **só aparece quando a condição bate**.
- Endereço começa pelo **CEP**, e o resto vem preenchido.
- Menor número de toques possível. Digitar é o último recurso.

## Como trabalhar com o gestor

- **Português do Brasil, direto ao ponto.** Ele não é programador: explique o "porquê"
  sem jargão, e deixe o detalhe técnico para quem quiser auditar.
- **Não use travessão longo (—) no texto.** Use hífen.
- **Dentro de uma direção já aprovada, decida e avance.** Não peça permissão a cada passo.
  Pergunte quando houver bifurcação real ou quando for remover algo (ver acima).
- **Ao apresentar opções, recomende uma** e diga por quê.
- **Verifique antes de afirmar.** "O sistema faz X" só depois de ler o código ou medir.
  Suposição apresentada como fato custa caro.
- **Avise quando algo estiver errado**, mesmo que não tenha sido perguntado.
- Conteúdo para copiar (comando, texto, mensagem) vai em bloco de código.

## Fluxo

- **Migrations:** tabela nova = arquivo novo em `migrations/` + aplicar com
  `wrangler d1 migrations apply <db> --remote`. Nunca editar migration já aplicada.
- **Deploy:** push na main dispara o GitHub Actions. Não existe deploy manual com
  credencial nesta máquina — é de propósito.
- **Registro:** ao criar ou alterar cliente, mantenha `clientes.json` atualizado.
- **Auditoria:** toda escrita sensível chama `auditar(...)` da base. Endpoint de escrita
  novo sem `auditar()` está incompleto.
- **WhatsApp:** Cloud API OFICIAL da Meta. Nunca API não-oficial — expõe o número do
  cliente a banimento.

## Autoria

Objeto que você criar (tabela, coluna, cron, rota, regra) leva marca de autoria no
comentário quando o formato permitir. Mais de uma pessoa mexe no mesmo sistema, e sem
marca não dá para saber a origem depois.
