import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { Database } from '../../../server/src/db.js';
import { loadWorldEvent } from '../../../server/src/admin.js';
import { describeCharacter, loadCharacter, reconcileHunts } from '../../../server/src/game.js';
import { registerRoutes } from '../../../server/src/routes.js';
import { publicSettlement } from '../../../server/src/settle.js';
import { accountFromHeader, issueToken } from '../../../server/src/auth.js';
import { criarDriver } from './sqljs.js';
import { contaNuvem, ErroNuvem, marcarVersao, nuvemBaixar, nuvemEnviar } from './nuvem.js';
import type { Database as SqlJsDatabase } from 'sql.js';

/**
 * Modo local do Cyberidle: o "servidor" do jogo roda dentro do navegador.
 *
 * As mesmas rotas de apps/server/src/routes.ts, registradas num roteador de mentira com a
 * forma do Fastify, sobre o mesmo `Database` - so que o SQLite e o sql.js e o arquivo do
 * banco fica guardado no IndexedDB deste navegador. Nao ha servidor, nao ha rede, e o
 * Cloudflare Pages so entrega arquivos. O que depende de outros jogadores (chat geral,
 * ranking, mercado entre pessoas) passa a ver so os personagens deste navegador.
 * Lab Hub, Claude (Opus 5.5).
 */

type Handler = (request: Requisicao, reply: Resposta) => unknown;
interface Requisicao {
  headers: { authorization?: string };
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}
class Resposta {
  codigo = 200;
  corpo: unknown = undefined;
  enviado = false;
  log = { error: (e: unknown) => console.error('[cyberidle local]', e) };
  status(codigo: number): this { this.codigo = codigo; return this; }
  code(codigo: number): this { return this.status(codigo); }
  send(corpo: unknown): this { this.corpo = corpo; this.enviado = true; return this; }
  type(): this { return this; }
}

interface Rota { metodo: string; partes: string[]; handler: Handler }
const rotas: Rota[] = [];
const roteador = {
  get: (caminho: string, h: Handler) => rotas.push({ metodo: 'GET', partes: caminho.split('/'), handler: h }),
  post: (caminho: string, h: Handler) => rotas.push({ metodo: 'POST', partes: caminho.split('/'), handler: h }),
  delete: (caminho: string, h: Handler) => rotas.push({ metodo: 'DELETE', partes: caminho.split('/'), handler: h }),
};

function achar(metodo: string, caminho: string): { rota: Rota; params: Record<string, string> } | null {
  const pedaços = caminho.split('/');
  for (const rota of rotas) {
    if (rota.metodo !== metodo || rota.partes.length !== pedaços.length) continue;
    const params: Record<string, string> = {};
    const bate = rota.partes.every((p, i) => {
      if (p.startsWith(':')) { params[p.slice(1)] = decodeURIComponent(pedaços[i]!); return true; }
      return p === pedaços[i];
    });
    if (bate) return { rota, params };
  }
  return null;
}

// ---------------------------------------------------------------- guardar no navegador
const IDB_NOME = 'cyberidle';
const IDB_LOJA = 'banco';
const IDB_CHAVE = 'principal';

function abrirIdb(): Promise<IDBDatabase> {
  return new Promise((ok, erro) => {
    const req = indexedDB.open(IDB_NOME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_LOJA);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => erro(req.error);
  });
}
async function lerBanco(): Promise<Uint8Array | null> {
  try {
    const idb = await abrirIdb();
    return await new Promise((ok) => {
      const req = idb.transaction(IDB_LOJA).objectStore(IDB_LOJA).get(IDB_CHAVE);
      req.onsuccess = () => ok((req.result as Uint8Array | undefined) ?? null);
      req.onerror = () => ok(null);
    });
  } catch {
    return null;
  }
}
async function gravarBanco(bytes: Uint8Array): Promise<void> {
  try {
    const idb = await abrirIdb();
    await new Promise<void>((ok) => {
      const tx = idb.transaction(IDB_LOJA, 'readwrite');
      tx.objectStore(IDB_LOJA).put(bytes, IDB_CHAVE);
      tx.oncomplete = () => ok();
      tx.onerror = () => ok();
    });
  } catch (e) {
    console.error('[cyberidle local] nao consegui salvar o progresso', e);
  }
}

// ---------------------------------------------------------------- inicio
let pronto: Promise<Database> | null = null;
let banco: SqlJsDatabase | null = null;
let alterado = false;
let conflito = false;
const TOKEN_JOGO = 'tibia-idle.token';
const ENVIO_MS = 90_000;

export function iniciar(): Promise<Database> {
  pronto ??= (async () => {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const bruto = new SQL.Database((await lerBanco()) ?? undefined);
    banco = bruto;

    let pendente: number | null = null;
    const salvarJa = (): void => {
      if (pendente !== null) { clearTimeout(pendente); pendente = null; }
      void gravarBanco(bruto.export());
    };
    const salvarLogo = (): void => {
      alterado = true;
      if (pendente === null) pendente = window.setTimeout(salvarJa, 1500);
    };
    window.addEventListener('pagehide', salvarJa);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      salvarJa();
      void enviarParaNuvem();
    });
    window.setInterval(() => { void enviarParaNuvem(); }, ENVIO_MS);

    const db = new Database(criarDriver(bruto, salvarLogo));
    loadWorldEvent(db);
    reconcileHunts(db);
    window.setInterval(() => { try { reconcileHunts(db); } catch (e) { console.error(e); } }, 5 * 60_000);
    registerRoutes(roteador as never, db);
    return db;
  })();
  return pronto;
}

// ---------------------------------------------------------------- nuvem (Cyberidle)
// O banco inteiro deste navegador vai para a nuvem (comprimido) quando a pessoa tem conta
// e algo mudou, a cada 90 s e ao sair da aba. Em outro aparelho, entrar na conta baixa
// esse banco. Se outro aparelho gravou depois, não sobrescreve: avisa e oferece o mais novo.

export async function temContaLocal(usuario: string): Promise<boolean> {
  const db = await iniciar();
  return Boolean(db.findAccount(usuario));
}

/** Personagens de OUTRAS contas neste navegador (que um save baixado substituiria). */
export async function personagensDeOutrasContas(usuario: string): Promise<number> {
  const db = await iniciar();
  return db.listAccounts()
    .filter((c) => c.username.toLowerCase() !== usuario.toLowerCase())
    .reduce((n, c) => n + db.charactersForAccount(c.id).length, 0);
}

/**
 * Troca o banco deste navegador pelo baixado e já deixa uma sessão do jogo aberta na conta,
 * para a página recarregar direto nos personagens (o jogo lê a sessão antes de abrir o banco).
 */
export async function importarSave(bytes: Uint8Array, versao: number, usuario: string): Promise<void> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const copia = new SQL.Database(bytes);
  const db = new Database(criarDriver(copia, () => {}));
  const conta = db.findAccount(usuario);
  if (conta) {
    const sessao = issueToken(db, conta.id, conta.username);
    try { localStorage.setItem(TOKEN_JOGO, sessao.token); } catch { /* sem armazenamento */ }
  }
  await gravarBanco(copia.export());
  copia.close();
  marcarVersao(versao);
}

/** Envia agora (ex.: logo depois de criar a conta). */
export async function enviarParaNuvem(forcar = false): Promise<void> {
  if (!banco || conflito || !contaNuvem() || (!alterado && !forcar)) return;
  alterado = false;
  try {
    await nuvemEnviar(banco.export());
  } catch (erro) {
    if (erro instanceof ErroNuvem && erro.status === 409) {
      conflito = true;
      avisarConflito();
      return;
    }
    alterado = true; // sem rede: tenta de novo no próximo ciclo
  }
}

function avisarConflito(): void {
  const usuario = contaNuvem()?.usuario ?? '';
  const ok = window.confirm(
    'Seu progresso foi salvo mais recentemente em outro aparelho.\n\n'
    + 'OK: carregar o progresso mais novo (o deste aparelho desde a última gravação se perde).\n'
    + 'Cancelar: continuar aqui sem gravar na nuvem até recarregar a página.',
  );
  if (!ok) return;
  void nuvemBaixar().then(async (save) => {
    if (!save.bytes) return;
    await importarSave(save.bytes, save.versao, usuario);
    location.reload();
  }).catch(() => { conflito = false; });
}

/** Mesmo contrato do fetch da API: devolve status e corpo JSON. */
export async function chamar(metodo: string, url: string, corpo: unknown, token: string | null): Promise<{ status: number; corpo: Record<string, unknown> }> {
  await iniciar();
  const u = new URL(url, 'http://local');
  const achado = achar(metodo, u.pathname);
  if (!achado) return { status: 404, corpo: { error: 'Not found.' } };
  const req: Requisicao = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    params: achado.params,
    query: Object.fromEntries(u.searchParams),
    body: corpo,
  };
  const resp = new Resposta();
  try {
    const volta = await achado.rota.handler(req, resp);
    const final = resp.enviado ? resp.corpo : volta;
    // Copia profunda: a tela nunca segura referencia a objeto do "servidor".
    return { status: resp.codigo, corpo: JSON.parse(JSON.stringify(final ?? {})) as Record<string, unknown> };
  } catch (e) {
    console.error('[cyberidle local]', e);
    return { status: 500, corpo: { error: 'Something went wrong.' } };
  }
}

/** Substitui o WebSocket: o mesmo "state" a cada 2 s, gerado aqui mesmo. */
export function assinar(
  token: string | null,
  characterId: number,
  aoEstado: (character: unknown, settlement: unknown) => void,
): () => void {
  let parado = false;
  let timer: number | null = null;
  void iniciar().then((db) => {
    if (parado) return;
    const accountId = accountFromHeader(db, token ? `Bearer ${token}` : undefined);
    if (accountId === null) return;
    const empurrar = (): void => {
      try {
        const { loaded, settlement } = loadCharacter(db, accountId, characterId);
        aoEstado(
          JSON.parse(JSON.stringify(describeCharacter(loaded, db))),
          JSON.parse(JSON.stringify(publicSettlement(settlement))),
        );
      } catch (e) {
        console.error('[cyberidle local]', e);
      }
    };
    empurrar();
    timer = window.setInterval(empurrar, 2000);
  });
  return () => { parado = true; if (timer !== null) clearInterval(timer); };
}
