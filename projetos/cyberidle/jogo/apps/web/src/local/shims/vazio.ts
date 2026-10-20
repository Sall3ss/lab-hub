// Substituto de `node:fs`, `node:path` e `node:module` no navegador. O servidor so os usa
// quando roda no Node; no modo local o banco chega pronto (ver ../servidor.ts).
// Lab Hub, Claude (Opus 5.5).
const naoTem = (): never => { throw new Error('Indisponivel no navegador (modo local).'); };
export const mkdirSync = (): void => {};
export const dirname = (p: string): string => p.replace(/[/\\][^/\\]*$/, '');
export const createRequire = (): (() => never) => naoTem;
export default { mkdirSync, dirname, createRequire };
