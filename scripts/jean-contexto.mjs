#!/usr/bin/env node
// scripts/jean-contexto.mjs - gera projetos/jean/contexto-gerado.js, o retrato dos
// projetos do hub que a Jean enxerga (o "JeanContextService" do lado dos arquivos).
//
// Por que gerar: no ar (Cloudflare) nao existe pasta nem arquivo .md para ler, so o codigo
// publicado. Entao as fichas entram no codigo do servidor na hora da publicacao. Fica do
// lado do SERVIDOR (projetos/), nunca em public/: ficha nao e pagina aberta.
//
// Roda no deploy (.github/workflows/deploy.yml), antes de publicar, e pode rodar a mao:
//   node scripts/jean-contexto.mjs
// O resultado tambem vai para o Git, para o servidor local funcionar sem passo extra.
//
// Autoria: Claude (Opus 5.5), Lab Hub, 13/11/2026.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const lista = JSON.parse(readFileSync(join(RAIZ, 'public', 'projetos', 'projetos.json'), 'utf8'));

const ler = (...p) => { const f = join(RAIZ, ...p); return existsSync(f) ? readFileSync(f, 'utf8') : ''; };

// Trecho de uma secao "## Nome" ate a proxima "## ".
function secao(md, nome) {
  const m = md.match(new RegExp('^##\\s+' + nome + '[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))', 'mi'));
  return m ? m[1].trim() : '';
}
const corte = (s, n) => (s.length > n ? s.slice(0, n).trimEnd() + ' [...]' : s);

const projetos = lista.map((p) => {
  const ficha = ler('projetos', p.slug, 'PROJETO.md');
  return {
    slug: p.slug,
    titulo: p.titulo,
    ideia: p.ideia || '',
    objetivo: p.objetivo || '',
    fase: p.fase || 'beta',
    endereco: p.endereco || null,
    criado_em: p.criado_em || null,
    estado: corte(secao(ficha, 'Estado'), 1200),
    proximo: corte(secao(ficha, 'Próximo passo') || secao(ficha, 'Proximo passo'), 800),
    ficha,
  };
});

// O proprio hub entra como "projeto" de leitura: e onde mora a estrutura e o estado geral.
const hub = {
  slug: 'hub',
  titulo: 'Lab Hub (o próprio hub)',
  ideia: 'Vitrine e estrutura que abriga os projetos.',
  objetivo: 'Testar ideias rápido e migrar as que amadurecem para endereço próprio.',
  fase: 'no ar',
  endereco: 'https://lab-hub-9uh.pages.dev',
  estado: '',
  proximo: '',
  ficha: ler('PROJETO.md') + '\n\n---\n\n' + ler('ESTADO.md'),
};

const saida = join(RAIZ, 'projetos', 'jean', 'contexto-gerado.js');
writeFileSync(saida,
  '// projetos/jean/contexto-gerado.js - GERADO por scripts/jean-contexto.mjs. Nao edite a mao.\n' +
  '// Retrato dos projetos do hub (cartao + ficha) para a Jean. Regerado a cada publicacao.\n\n' +
  'export const PROJETOS = ' + JSON.stringify(projetos, null, 1) + ';\n\n' +
  'export const HUB = ' + JSON.stringify(hub, null, 1) + ';\n');

console.log(`contexto da Jean: ${projetos.length} projeto(s) + hub -> projetos/jean/contexto-gerado.js`);
