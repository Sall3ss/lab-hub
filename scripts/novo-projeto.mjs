#!/usr/bin/env node
// scripts/novo-projeto.mjs - cria um projeto novo DENTRO do Lab Hub, ja isolado.
//
//   node scripts/novo-projeto.mjs <slug> --titulo "..." --ideia "..." --objetivo "..."
//        [--resumo "frase curta do cartao"] [--icone tesoura|video|projeto]
//
// Cada projeto nasce em pastas so dele, a partir de scripts/modelo-projeto/:
//   public/projetos/<slug>/   a tela (index.html, estilo.css, app.js)
//   projetos/<slug>/          o servidor (api.js) e a ficha (PROJETO.md)
// e entra no registro do hub (public/projetos/projetos.json) e no da API
// (projetos/registro.js). Fazer pelo script, e nao a mao, e o que garante que nenhum
// projeto nasce misturado com outro.
//
// Autoria: Claude (Opus 5.5).

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODELO = join(RAIZ, 'scripts', 'modelo-projeto');
const LISTA = join(RAIZ, 'public', 'projetos', 'projetos.json');
const REGISTRO = join(RAIZ, 'projetos', 'registro.js');

function sair(msg) { console.error('ERRO: ' + msg); process.exit(1); }

const args = process.argv.slice(2);
const slug = args[0];
const opc = {};
for (let i = 1; i < args.length; i += 2) {
  if (!args[i].startsWith('--')) sair('argumento inesperado: ' + args[i]);
  opc[args[i].slice(2)] = args[i + 1] ?? '';
}

if (!slug) sair('uso: node scripts/novo-projeto.mjs <slug> --titulo "..." --ideia "..." --objetivo "..."');
// O slug vira pasta, endereco e prefixo de tabela: sem acento, espaco ou maiuscula.
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(slug)) sair('slug invalido: use minusculas, numeros e hifen (ex.: controle-treino)');
if (!opc.titulo) sair('falta --titulo');

const lista = JSON.parse(readFileSync(LISTA, 'utf8'));
if (lista.some((p) => p.slug === slug)) sair('ja existe projeto com o slug ' + slug);
const pastaTela = join(RAIZ, 'public', 'projetos', slug);
const pastaServ = join(RAIZ, 'projetos', slug);
if (existsSync(pastaTela) || existsSync(pastaServ)) sair('ja existe pasta para ' + slug);

const hoje = new Date();
const dados = {
  SLUG: slug,
  TITULO: opc.titulo,
  IDEIA: opc.ideia || '(a definir)',
  OBJETIVO: opc.objetivo || '(a definir)',
  PREFIXO: slug.replace(/-/g, '_'),
  DATA: hoje.toLocaleDateString('pt-BR'),
};
const preencher = (txt) => txt.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in dados ? dados[k] : _));

function copiar(origem, destino) {
  mkdirSync(destino, { recursive: true });
  for (const nome of readdirSync(origem)) {
    writeFileSync(join(destino, nome), preencher(readFileSync(join(origem, nome), 'utf8')));
  }
}
copiar(join(MODELO, 'tela'), pastaTela);
copiar(join(MODELO, 'servidor'), pastaServ);

lista.push({
  slug,
  titulo: opc.titulo,
  ideia: opc.ideia || '',
  objetivo: opc.objetivo || '',
  ...(opc.resumo ? { resumo: opc.resumo } : {}),
  ...(opc.icone ? { icone: opc.icone } : {}),
  fase: 'beta',
  criado_em: hoje.toISOString().slice(0, 10),
});
writeFileSync(LISTA, JSON.stringify(lista, null, 2) + '\n');

// O registro da API e regerado inteiro a partir da lista: nunca fica um projeto de fora.
const ident = (s) => 'p_' + s.replace(/-/g, '_');
const comApi = lista.filter((p) => existsSync(join(RAIZ, 'projetos', p.slug, 'api.js')));
writeFileSync(REGISTRO,
  '// projetos/registro.js - GERADO por scripts/novo-projeto.mjs. Nao edite a mao.\n' +
  '// Liga o slug de cada projeto do hub ao modulo de rotas dele (projetos/<slug>/api.js).\n\n' +
  comApi.map((p) => `import * as ${ident(p.slug)} from './${p.slug}/api.js';`).join('\n') +
  (comApi.length ? '\n\n' : '') +
  'export const PROJETOS = {\n' +
  comApi.map((p) => `  '${p.slug}': ${ident(p.slug)},`).join('\n') +
  (comApi.length ? '\n' : '') +
  '};\n');

console.log(`Projeto "${opc.titulo}" criado:`);
console.log(`  tela      public/projetos/${slug}/`);
console.log(`  servidor  projetos/${slug}/api.js  (rotas em /api/p/${slug}/...)`);
console.log(`  ficha     projetos/${slug}/PROJETO.md`);
console.log(`  tabelas   prefixo ${dados.PREFIXO}_`);
