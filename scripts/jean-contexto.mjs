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

// "O que foi feito por ultimo" (ideia do dono, 14/11/2026): a Jean nao precisa da ficha
// inteira para saber onde o projeto parou. Quebra a secao Estado em registros datados
// (linhas que comecam com "**DD/MM" ou "- DD/MM" ou trazem "(DD/MM)" logo no inicio) e
// ordena pela DATA, nao pela posicao: as fichas nao estao em ordem (no Cyberidle o 31/10
// e o segundo registro, depois de um 28/10).
const ANO = new Date().getFullYear();
function registrosDatados(estado) {
  const linhas = estado.split('\n');
  const blocos = [];
  let atual = null;
  for (const l of linhas) {
    const inicio = /^(\*\*|- )/.test(l) ? l.slice(0, 40).match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/) : null;
    if (inicio) {
      atual = { data: new Date(Number(inicio[3] || ANO), Number(inicio[2]) - 1, Number(inicio[1])), texto: l, ordem: blocos.length };
      blocos.push(atual);
    } else if (atual) atual.texto += '\n' + l;
  }
  return blocos
    .map((b) => ({ ...b, texto: b.texto.trim() }))
    .sort((a, b) => b.data - a.data || a.ordem - b.ordem);
}
function ultimosRegistros(estado, limite) {
  const blocos = registrosDatados(estado);
  if (!blocos.length) return { texto: corte(estado, limite), ultimo: null };
  let texto = '';
  for (const b of blocos) {
    const pedaco = (texto ? '\n\n' : '') + b.texto;
    if (texto && texto.length + pedaco.length > limite) break;
    texto += texto ? pedaco : corte(b.texto, limite);
  }
  const d = blocos[0].data;
  return { texto, ultimo: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` };
}
// O que esta marcado como pendente, limite conhecido ou a rever, em qualquer parte da ficha.
function pendencias(ficha, limite) {
  const achadas = ficha.split('\n').filter((l) =>
    /^\s*(- |\d+\. )/.test(l) && /(🟡|🔴|pendente|falta|conhecido:|limite|para rever|a rever|depois:|todo\b)/i.test(l));
  return corte([...new Set(achadas.map((l) => l.trim()))].join('\n'), limite);
}

const projetos = lista.map((p) => {
  const ficha = ler('projetos', p.slug, 'PROJETO.md');
  const estado = secao(ficha, 'Estado');
  const recente = ultimosRegistros(estado, 3500);
  const curto = ultimosRegistros(estado, 1200);
  return {
    slug: p.slug,
    titulo: p.titulo,
    ideia: p.ideia || '',
    objetivo: p.objetivo || '',
    fase: p.fase || 'beta',
    endereco: p.endereco || null,
    criado_em: p.criado_em || null,
    ultima_atualizacao: recente.ultimo,
    estado: curto.texto,                  // vai no contexto de TODA mensagem (curto)
    recente: recente.texto,               // ler_ficha padrao: o que foi feito por ultimo
    pendencias: pendencias(ficha, 1500),
    proximo: corte(secao(ficha, 'Próximo passo') || secao(ficha, 'Proximo passo') || secao(ficha, 'O que falta'), 800),
    ficha,                                // ler_ficha "completa": so quando precisar
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
  ultima_atualizacao: null,
  estado: '',
  recente: corte(secao(ler('ESTADO.md'), 'O que falta') || '', 3500),
  pendencias: pendencias(ler('ESTADO.md'), 1500),
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
