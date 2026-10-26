/**
 * Salvamento na nuvem do Cyberidle (cliente). O jogo continua rodando no navegador; a
 * nuvem (Pages Functions + D1, ver projetos/cyberidle/nuvem/) só guarda uma cópia do banco
 * do jogador, para o mesmo personagem abrir no PC e no celular.
 *
 * A senha não sai do aparelho: daqui vai só uma chave derivada (PBKDF2, pesada de propósito
 * e feita aqui, para o servidor grátis não gastar CPU). Lab Hub, Claude (Opus 5.5).
 */

const CHAVE_LS = 'cyberidle.nuvem';
const ITERACOES = 150_000;

export interface ContaNuvem {
  usuario: string;
  token: string;
  /** Versão do save que este aparelho conhece (a última que enviou ou baixou). */
  versao: number;
}

export class ErroNuvem extends Error {
  constructor(message: string, readonly status: number, readonly versao?: number) {
    super(message);
    this.name = 'ErroNuvem';
  }
}

export function contaNuvem(): ContaNuvem | null {
  try {
    const c = JSON.parse(localStorage.getItem(CHAVE_LS) || 'null') as ContaNuvem | null;
    return c && c.token && c.usuario ? c : null;
  } catch {
    return null;
  }
}

function guardar(conta: ContaNuvem | null): void {
  try {
    if (conta) localStorage.setItem(CHAVE_LS, JSON.stringify(conta));
    else localStorage.removeItem(CHAVE_LS);
  } catch { /* sem armazenamento: segue só local */ }
}

export function marcarVersao(versao: number): void {
  const c = contaNuvem();
  if (c) guardar({ ...c, versao });
}

async function derivarChave(usuario: string, senha: string): Promise<string> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(`cyberidle:${usuario.toLowerCase()}`), iterations: ITERACOES },
    base,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function pedir<T>(metodo: string, rota: string, corpo?: unknown, token?: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/nuvem/${rota}`, {
      method: metodo,
      headers: {
        ...(corpo === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new ErroNuvem('Sem conexão com a nuvem.', 0);
  }
  let dados: Record<string, unknown> = {};
  try { dados = (await r.json()) as Record<string, unknown>; } catch { /* corpo vazio */ }
  if (!r.ok) throw new ErroNuvem(String(dados['error'] ?? 'Falha na nuvem.'), r.status, Number(dados['versao'] ?? 0));
  return dados as T;
}

export async function nuvemRegistrar(usuario: string, senha: string): Promise<void> {
  const chave = await derivarChave(usuario, senha);
  const r = await pedir<{ token: string; usuario: string }>('POST', 'registrar', { usuario, chave });
  guardar({ usuario: r.usuario, token: r.token, versao: 0 });
}

export async function nuvemEntrar(usuario: string, senha: string): Promise<void> {
  const chave = await derivarChave(usuario, senha);
  const r = await pedir<{ token: string; usuario: string }>('POST', 'entrar', { usuario, chave });
  const antes = contaNuvem();
  const mesma = antes && antes.usuario.toLowerCase() === r.usuario.toLowerCase();
  guardar({ usuario: r.usuario, token: r.token, versao: mesma ? antes!.versao : 0 });
}

export async function nuvemSair(): Promise<void> {
  const c = contaNuvem();
  guardar(null);
  if (c) await pedir('POST', 'sair', {}, c.token).catch(() => {});
}

// ---------------------------------------------------------------- save (gzip + base64)
async function comprimir(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('gzip'));
  const gz = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < gz.length; i += 0x8000) bin += String.fromCharCode(...gz.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function descomprimir(base64: string): Promise<Uint8Array> {
  const bin = atob(base64);
  const gz = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) gz[i] = bin.charCodeAt(i);
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function nuvemBaixar(): Promise<{ versao: number; bytes: Uint8Array | null }> {
  const c = contaNuvem();
  if (!c) throw new ErroNuvem('Sem conta na nuvem.', 401);
  const r = await pedir<{ versao: number; dados: string | null }>('GET', 'save', undefined, c.token);
  return { versao: r.versao, bytes: r.dados ? await descomprimir(r.dados) : null };
}

export async function nuvemEnviar(bytes: Uint8Array): Promise<number> {
  const c = contaNuvem();
  if (!c) throw new ErroNuvem('Sem conta na nuvem.', 401);
  const dados = await comprimir(bytes);
  const r = await pedir<{ versao: number }>('PUT', 'save', { versaoBase: c.versao, dados }, c.token);
  marcarVersao(r.versao);
  return r.versao;
}
