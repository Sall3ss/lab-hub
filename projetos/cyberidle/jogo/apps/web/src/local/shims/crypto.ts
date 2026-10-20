// Substituto do `node:crypto` para o modo local (navegador). Só o que o servidor usa:
// randomBytes, scryptSync e timingSafeEqual. Lab Hub, Claude (Opus 5.5).
//
// O scrypt aqui NAO e criptografico: no modo local a "conta" vive so neste navegador e a
// senha nao protege nada contra quem tem acesso a ele. Serve so para o fluxo do jogo
// (reivindicar conta / entrar) continuar funcionando.

class Bytes extends Uint8Array {
  toString(encoding?: string): string {
    if (encoding === 'hex' || encoding === undefined) {
      return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    if (encoding === 'base64url' || encoding === 'base64') {
      const b64 = btoa(String.fromCharCode(...this));
      return encoding === 'base64' ? b64 : b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    throw new Error(`encoding nao suportado: ${encoding}`);
  }
}

export function randomBytes(size: number): Bytes {
  const out = new Bytes(size);
  crypto.getRandomValues(out);
  return out;
}

export function scryptSync(password: string, salt: string, length: number): Bytes {
  // FNV-1a encadeado: deterministico e barato. Ver o aviso no topo.
  const out = new Bytes(length);
  const text = `${salt}:${password}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < length; i += 1) {
    for (let j = 0; j < text.length; j += 1) {
      h ^= text.charCodeAt(j) + i;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out[i] = h & 0xff;
  }
  return out;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export default { randomBytes, scryptSync, timingSafeEqual };
