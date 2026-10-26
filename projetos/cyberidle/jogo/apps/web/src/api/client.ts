import type { AccountView, BossView, CharacterView, HuntView, Settlement, WorldView } from './types.js';
import { assinar, chamar, enviarParaNuvem, importarSave, personagensDeOutrasContas, temContaLocal } from '../local/servidor.js';
import { contaNuvem, ErroNuvem, nuvemBaixar, nuvemEntrar, nuvemRegistrar, nuvemSair } from '../local/nuvem.js';

type Autenticado = { token: string; accountId: number; username: string; guest?: boolean };

const USUARIO_OK = /^[a-zA-Z0-9_-]{3,20}$/;

/** Mesmas regras do servidor do jogo, checadas antes de criar a conta na nuvem. */
function conferirCredenciais(username: string, password: string): void {
  if (!USUARIO_OK.test(username) || /^guest_/i.test(username)) {
    throw new ApiError('Usuário: 3 a 20 letras, números, hífen ou sublinhado.', 400);
  }
  if (password.length < 8) throw new ApiError('A senha precisa de pelo menos 8 caracteres.', 400);
}

function erroDaNuvem(erro: unknown): never {
  if (erro instanceof ErroNuvem) throw new ApiError(erro.message, erro.status || 503);
  throw erro;
}

/**
 * Cyberidle: criar conta / reivindicar cria também a conta na nuvem e envia o save, para o
 * mesmo personagem abrir em outro aparelho. Lab Hub, Claude (Opus 5.5).
 */
async function comNuvemNova(username: string, password: string, local: () => Promise<Autenticado>): Promise<Autenticado> {
  conferirCredenciais(username, password);
  if (await temContaLocal(username)) throw new ApiError('Esse usuário já existe neste aparelho. Use "Entrar".', 409);
  await nuvemRegistrar(username, password).catch(erroDaNuvem);
  const r = await local();
  storeToken(r.token);
  await enviarParaNuvem(true);
  return r;
}

/**
 * Entrar: confere na nuvem; se lá houver um progresso mais novo do que o deste aparelho,
 * baixa e recarrega a página já dentro da conta. Sem internet, entra só com o local.
 */
async function entrarComNuvem(username: string, password: string): Promise<Autenticado> {
  let naNuvem = true;
  let contaSoLocal = false;
  try {
    await nuvemEntrar(username, password);
  } catch (erro) {
    if (erro instanceof ErroNuvem && erro.status === 0) naNuvem = false; // sem rede
    else if (erro instanceof ErroNuvem && erro.status === 401 && await temContaLocal(username)) {
      naNuvem = false; // conta criada só neste aparelho (antes da nuvem)
      contaSoLocal = true;
    } else erroDaNuvem(erro);
  }
  if (naNuvem) {
    const conhecida = contaNuvem()?.versao ?? 0;
    const save = await nuvemBaixar().catch(erroDaNuvem);
    const temAqui = await temContaLocal(username);
    if (save.bytes && (!temAqui || save.versao > conhecida)) {
      const outros = await personagensDeOutrasContas(username);
      const ok = outros === 0 || window.confirm(
        `Este aparelho tem ${outros} personagem(ns) de outra conta que serão substituídos pelo progresso da conta ${username}. Continuar?`,
      );
      if (!ok) throw new ApiError('Entrada cancelada.', 400);
      await importarSave(save.bytes, save.versao, username);
      location.reload();
      return new Promise<Autenticado>(() => {});
    }
    if (!temAqui) {
      // Conta na nuvem sem save ainda: cria a conta local com as mesmas credenciais.
      const r = await request<Autenticado>('POST', '/api/register', { username, password });
      storeToken(r.token);
      await enviarParaNuvem(true);
      return r;
    }
  }
  const r = await request<Autenticado>('POST', '/api/login', { username, password });
  if (contaSoLocal) {
    // Senha conferida no aparelho: leva a conta para a nuvem (se o nome estiver livre lá).
    storeToken(r.token);
    try {
      await nuvemRegistrar(username, password);
      await enviarParaNuvem(true);
    } catch { /* nome já usado na nuvem ou sem rede: continua só neste aparelho */ }
  }
  return r;
}

/**
 * Thin wrapper over the REST API.
 *
 * The token lives in localStorage rather than a cookie: the API is stateless
 * bearer auth and the client may be served from a different origin than the
 * server during development.
 */

const TOKEN_KEY = 'tibia-idle.token';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export function storedToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function storeToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// Cyberidle (Lab Hub): sem servidor. Cada chamada vai para o "servidor local" que roda
// neste navegador (../local/servidor.ts), com as mesmas rotas e respostas. Claude (Opus 5.5).
async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const { status, corpo: payload } = await chamar(method, url, body, storedToken());
  if (status >= 400) {
    const raw = String(payload['error'] ?? '');
    throw new ApiError(raw || 'Algo deu errado.', status);
  }
  return payload as T;
}

export interface HealthView {
  ok: boolean;
  tickMs: number;
  maxOfflineHours: number;
  content: Record<string, number>;
  generatedAt: string;
  beta: 'open' | 'closed';
}

export const api = {
  health: () => request<HealthView>('GET', '/api/health'),

  register: (username: string, password: string, invite?: string) =>
    comNuvemNova(username, password, () => request<Autenticado>('POST', '/api/register', { username, password, invite })),

  guest: () =>
    request<{ token: string; accountId: number; username: string; guest?: boolean }>('POST', '/api/guest'),

  claim: (username: string, password: string) =>
    comNuvemNova(username, password, () => request<Autenticado>('POST', '/api/claim', { username, password })),

  login: (username: string, password: string) => entrarComNuvem(username, password),

  logout: async () => {
    await enviarParaNuvem();
    await nuvemSair();
    return request<{ ok: boolean }>('POST', '/api/logout');
  },

  characters: () => request<{ characters: CharacterView[]; account: AccountView }>('GET', '/api/characters'),

  createCharacter: (name: string, vocationId: number, extras?: { gender?: 'm' | 'f'; weapon?: string }) =>
    request<{ character: CharacterView }>('POST', '/api/characters', { name, vocationId, ...extras }),

  character: (id: number) =>
    request<{ character: CharacterView; settlement: Settlement }>('GET', `/api/characters/${id}`),

  hunts: (id: number) => request<{ hunts: HuntView[] }>('GET', `/api/characters/${id}/hunts`),

  bosses: (id: number) => request<{ bosses: BossView[] }>('GET', `/api/characters/${id}/bosses`),

  startHunt: (id: number, huntId: string, hours?: number) =>
    request<{ character: CharacterView }>('POST', `/api/characters/${id}/hunt`, { huntId, hours }),

  stopHunt: (id: number) =>
    request<{ character: CharacterView; goldBanked: number; supplyRefund: number }>(
      'DELETE',
      `/api/characters/${id}/hunt`,
    ),

  upgradeGear: (id: number) =>
    request<{ character: CharacterView; spent: number }>('POST', `/api/characters/${id}/gear`),

  sellPouch: (id: number) =>
    request<{ character: CharacterView; gold: number }>('POST', `/api/characters/${id}/sell`),

  stashPouch: (id: number) =>
    request<{ character: CharacterView; items: number }>('POST', `/api/characters/${id}/stash`),

  act: (id: number, body: Record<string, unknown>) =>
    request<{ character: CharacterView } & Record<string, unknown>>('POST', `/api/characters/${id}/act`, body),

  world: (channel = 'geral') => request<WorldView>('GET', `/api/world?channel=${encodeURIComponent(channel)}`),

  admin: () => request<{
    accounts: Array<{ id: number; username: string; admin: boolean; characters: Array<{ id: number; name: string; level: number; gold: number; coins: number }> }>;
    orders: Array<{ id: number; accountId: number; packId: string; coins: number; brl: number; status: string; createdAt: number }>;
    event: { name: string; experience: number; loot: number };
    metrics: {
      accounts: number;
      characters: number;
      hunting: number;
      queued: number;
      gold: number;
      coins: number;
      beta: string;
      last24h: { dau: number; registers: number; huntsStarted: number; huntsStopped: number; goldFromHunts: number };
      retention: { d1Cohort: number; d1Returned: number; d1: number | null };
      topHunts: Array<{ huntId: string; n: number }>;
    };
    invites: Array<{ code: string; usedBy: number | null }>;
  }>('GET', '/api/admin'),

  adminAct: (body: Record<string, unknown>) => request<Record<string, unknown>>('POST', '/api/admin', body),
};

/**
 * Live state feed.
 *
 * Reconnects with a backoff instead of giving up: an idle game is left open for
 * hours, and a laptop that sleeps should pick the session back up on wake
 * rather than showing a frozen screen.
 */
export class LiveSocket {
  private parar: (() => void) | null;

  constructor(
    characterId: number,
    onState: (character: CharacterView, settlement: Settlement) => void,
    onStatus: (status: 'connecting' | 'open' | 'closed') => void,
  ) {
    // Modo local: o "estado ao vivo" vem do servidor local, sem rede. Lab Hub, Claude (Opus 5.5).
    onStatus('open');
    this.parar = assinar(storedToken(), characterId, (character, settlement) => {
      onState(character as CharacterView, (settlement as Settlement | undefined) ?? { elapsedSeconds: 0, stoppedBecause: null });
    });
  }

  close(): void {
    this.parar?.();
    this.parar = null;
  }
}
