#!/usr/bin/env node
// scripts/admin-inicial.mjs — cria a migration que já traz o administrador do sistema,
// com uma senha provisória ALEATÓRIA que o próprio sistema obriga a trocar no primeiro
// acesso.
//
// Por que existe (decidido pelo gestor em 08/08/2026): o painel não pode nascer vazio e
// pedir um "token de administração" na tela. Isso é um conceito a mais aparecendo justo
// no dia da entrega, e obriga o gestor a estar no meio de toda implantação. Agora o
// sistema nasce com o acesso pronto: o gestor recebe usuário e senha uma vez e repassa.
//
// A senha NÃO é escrita na tela nem no histórico da conversa: vai para um arquivo, fora
// do repositório, para ser lida, entregue e apagada. O que entra no Git é só o hash.
//
//   node scripts/admin-inicial.mjs                 # sistema novo
//   node scripts/admin-inicial.mjs --refazer       # sistema JÁ NO AR: troca a senha
//   node scripts/admin-inicial.mjs --usuario admin --saida ../_arquivos/ACESSO.txt
//
// Autoria: Claude (Opus 5), 08/08/2026.

import { pbkdf2Sync, randomBytes, randomInt } from 'node:crypto';
import { writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

// Precisa bater exatamente com lib/auth.js, senão a senha gerada aqui não entra lá.
// ⚠️ 100.000 é o TETO do Cloudflare Workers em produção. Acima disso a verificação lança
// exceção só no ar - o runtime local não aplica o limite. Não aumente.
const ITERACOES = 100000;

function hashSenha(senha) {
  const sal = randomBytes(16);
  const bits = pbkdf2Sync(senha, sal, ITERACOES, 32, 'sha256');
  return `pbkdf2$${ITERACOES}$${sal.toString('base64')}$${bits.toString('base64')}`;
}

/**
 * Senha ditável por telefone: sem 0/O e sem 1/l/I, que é onde as pessoas erram.
 * 16 caracteres de um alfabeto de 31, mais um dígito. Provisória, mas não frágil - o
 * sistema fica exposto na internet desde o primeiro minuto.
 */
function senhaProvisoria() {
  const alfabeto = 'abcdefghjkmnpqrstuvwxyz23456789';
  const grupo = () => Array.from({ length: 4 }, () => alfabeto[randomInt(alfabeto.length)]).join('');
  // um dígito garantido no fim: a regra de senha do sistema exige letra E número
  return [grupo(), grupo(), grupo(), grupo()].join('-') + randomInt(10);
}

// ---------------------------------------------------------------- argumentos

const args = process.argv.slice(2);
const opcao = (nome, padrao) => {
  const i = args.indexOf('--' + nome);
  return i >= 0 && args[i + 1] ? args[i + 1] : padrao;
};

const usuario = opcao('usuario', 'admin');
const nome = opcao('nome', 'ADMINISTRADOR');
const saida = opcao('saida', join(RAIZ, '..', '_arquivos', 'PRIMEIRO-ACESSO.txt'));
const refazer = args.includes('--refazer');

const migrations = join(RAIZ, 'migrations');
const arquivos = readdirSync(migrations);
const jaExiste = arquivos.some((f) => f.includes('acesso_inicial') || f.includes('senha_admin'));

if (jaExiste && !refazer) {
  console.error('Já existe uma migration de acesso para este projeto.');
  console.error('');
  console.error('  Senha perdida ANTES de publicar:  apague a migration e rode de novo.');
  console.error('  Sistema JÁ NO AR:                 use --refazer, que gera uma migration');
  console.error('                                    nova trocando a senha, em vez de tentar');
  console.error('                                    criar o usuário outra vez.');
  process.exit(1);
}
if (refazer && !jaExiste) {
  console.error('--refazer só faz sentido quando já existe a migration de acesso inicial.');
  process.exit(1);
}

// Próximo número livre em migrations/
const usados = arquivos.map((f) => Number(f.slice(0, 4))).filter((n) => !isNaN(n));
const numero = String(Math.max(0, ...usados) + 1).padStart(4, '0');
const nomeArquivo = refazer ? `${numero}_senha_admin.sql` : `${numero}_acesso_inicial.sql`;

// A pasta de saída pode não existir ainda (projeto recém-criado).
mkdirSync(dirname(saida), { recursive: true });

// ---------------------------------------------------------------- gera

const senha = senhaProvisoria();
const hash = hashSenha(senha);
const agora = new Date().toISOString();

const cabecalho = `-- ${nomeArquivo} — ${refazer ? 'nova senha provisória do administrador' : 'o administrador com que o sistema nasce'}.
--
-- Gerado por scripts/admin-inicial.mjs em ${agora.slice(0, 10)}. NÃO edite à mão.
--
-- A senha correspondente a este hash foi entregue ao gestor uma única vez e não existe em
-- lugar nenhum do repositório. O sistema OBRIGA a troca no primeiro acesso (coluna
-- senha_provisoria), e nesse momento a pessoa também informa nome e e-mail - é esse
-- e-mail que passa a aparecer na auditoria.
--
-- Se a senha se perder antes do primeiro acesso, rode o script com --refazer.
-- Depois do primeiro acesso, quem redefine senha é o próprio administrador, pela tela de
-- usuários.
`;

// O par INSERT + UPDATE deixa a migration correta nos dois casos: usuário que ainda não
// existe (sistema novo) e usuário que já existe (troca de senha em sistema no ar).
writeFileSync(join(migrations, nomeArquivo), `${cabecalho}
INSERT OR IGNORE INTO usuarios (email, senha_hash, nome, ativo, criado_em, perfil, senha_provisoria)
VALUES ('${usuario}', '${hash}', '${nome}', 1, '${agora}', 'administrador', 1);

UPDATE usuarios SET senha_hash = '${hash}', senha_provisoria = 1, atualizado_em = '${agora}'
 WHERE email = '${usuario}';
`);

// A senha vai para arquivo, nunca para a saída padrão: o histórico do terminal e o da
// conversa ficam gravados em disco, e senha viva não pode morar em log.
writeFileSync(saida, `PRIMEIRO ACESSO - ${usuario}

Usuario: ${usuario}
Senha:   ${senha}

Esta senha e PROVISORIA e serve para UM login. Ao entrar, o sistema obriga a definir
nome, e-mail e uma senha nova, e a partir dai o acesso passa a ser pelo e-mail escolhido.

Entregue estes dados ao responsavel da clinica por um canal seguro e APAGUE ESTE ARQUIVO.
Ele esta fora do repositorio de proposito e nao deve ser versionado.

Gerado em ${agora}
`);

console.log(`migration criada:  migrations/${nomeArquivo}`);
console.log(`usuario:           ${usuario}`);
console.log(`senha:             gravada em ${saida}`);
console.log('');
console.log('Leia o arquivo, entregue os dados ao gestor e apague o arquivo.');
console.log('A senha NAO foi impressa aqui de proposito.');
