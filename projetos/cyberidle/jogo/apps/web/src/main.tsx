import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { LocaleProvider } from './i18n/Locale.js';
import './styles.css';
import './tema/neon.css';
import { aplicarTema, observarTextos } from './tema/cyberpunk.js';

// Nomes cyberpunk (monstros, caçadas, vocações, Edinho) antes de qualquer tela ou do
// servidor local ler os dados. Lab Hub, Claude (Opus 5.5).
aplicarTema();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

/**
 * Cyberidle: a interface inteira acompanha o tamanho da janela. Referência: cerca de
 * 1366x700 de área útil (monitor comum com a barra do navegador; o dono achou 1440x860 pequeno); em telas menores encolhe (tudo cabe, nada corta) e em maiores cresce (nada fica
 * miúdo). Até 1100 px de largura (tablet/celular) fica 1, com o layout de uma coluna.
 * O #root ganha a largura/altura da janela dividida pelo zoom, para o zoom não estourar a tela.
 * Lab Hub, Claude (Opus 5.5).
 */
function ajustarZoom(el: HTMLElement): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const z = w <= 1100 ? 1 : Math.min(1.5, Math.max(0.8, Math.min(w / 1366, h / 700)));
  const arred = Math.round(z * 100) / 100;
  el.style.zoom = String(arred);
  // Uma coluna: a página rola normalmente, sem tamanho fixo.
  el.style.width = w <= 1100 ? '' : `${w / arred}px`;
  el.style.height = w <= 1100 ? '' : `${h / arred}px`;
  document.documentElement.style.setProperty('--zoom-ui', String(arred));
}
ajustarZoom(root);
observarTextos(root);
window.addEventListener('resize', () => ajustarZoom(root));

createRoot(root).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
