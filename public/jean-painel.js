// jean-painel.js - a Jean em QUALQUER tela do Lab Hub (etapa 5 da Jean, 14/11/2026).
//
// Uma linha na pagina basta:   <script src="/jean-painel.js" defer></script>
//
// Poe um botao flutuante "J" no canto e o atalho Ctrl+K (Cmd+K no Mac). Os dois abrem a
// Jean num painel lateral, por cima da pagina, ja sabendo de onde foi chamada:
//   - na pagina de um projeto (/projetos/<slug>/...) -> projeto <slug>
//   - no hub (/)                                      -> o proprio hub
// e qual pagina estava aberta (caminho e titulo). Ela entende "este projeto" sem explicacao.
//
// E da BASE, como navegador.js e campos.js: nao depende de nada do hub nem de projeto.
// Se o arquivo faltar (ex.: projeto migrado para endereco proprio), a pagina segue normal.
// A Jean em si e a pagina /projetos/jean/ dentro de um iframe (?embutido=1): mesma
// conversa, mesmo login, nada duplicado.
//
// Claude (Opus 5.5), Lab Hub.
(function () {
  if (window.__jeanPainel) return;
  window.__jeanPainel = true;
  var caminho = location.pathname;
  if (/^\/projetos\/jean\//.test(caminho)) return; // na propria Jean, nao faz sentido

  var m = caminho.match(/^\/projetos\/([a-z0-9-]+)\//);
  var de = m ? m[1] : (caminho === '/' || caminho === '/index.html' ? 'hub' : '');

  var css = '' +
    '.jp-botao{position:fixed;right:max(1rem,env(safe-area-inset-right));bottom:max(1rem,env(safe-area-inset-bottom));z-index:2147483000;' +
    'width:3.25rem;height:3.25rem;border-radius:1.1rem;border:0;cursor:pointer;color:#fff;font:700 1.35rem/1 system-ui,sans-serif;' +
    'background:linear-gradient(135deg,#c8322b,#c98a12);box-shadow:0 10px 28px rgb(200 50 43 / .35);display:grid;place-items:center;transition:transform .15s}' +
    '.jp-botao:hover{transform:translateY(-2px)}.jp-botao:focus-visible{outline:3px solid #f2b441;outline-offset:3px}' +
    '.jp-dica{position:absolute;right:calc(100% + .5rem);white-space:nowrap;font:600 .75rem system-ui,sans-serif;color:#fff;background:#1f1b19;padding:.3rem .55rem;border-radius:.5rem;opacity:0;pointer-events:none;transition:opacity .15s}' +
    '.jp-botao:hover .jp-dica{opacity:1}@media (hover:none){.jp-dica{display:none}}' +
    '.jp-veu{position:fixed;inset:0;background:rgb(0 0 0 / .35);z-index:2147483001}' +
    '.jp-gaveta{position:fixed;top:0;right:0;bottom:0;width:min(30rem,100vw);z-index:2147483002;background:#f7f6f4;box-shadow:-12px 0 40px rgb(0 0 0 / .25);' +
    'transform:translateX(100%);transition:transform .2s ease;display:flex}' +
    '.jp-gaveta.jp-aberta{transform:none}.jp-gaveta iframe{border:0;width:100%;height:100%}' +
    '@media (prefers-color-scheme:dark){.jp-gaveta{background:#14110f}}' +
    '.jp-escondido{display:none!important}';

  var estilo = document.createElement('style');
  estilo.textContent = css;
  document.head.appendChild(estilo);

  var botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'jp-botao';
  botao.setAttribute('aria-label', 'Falar com a Jean (Ctrl+K)');
  var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  botao.innerHTML = 'J<span class="jp-dica">Jean · ' + (mac ? '⌘' : 'Ctrl') + '+K</span>';

  var veu = document.createElement('div');
  veu.className = 'jp-veu jp-escondido';
  var gaveta = document.createElement('div');
  gaveta.className = 'jp-gaveta';
  gaveta.setAttribute('role', 'dialog');
  gaveta.setAttribute('aria-label', 'Jean');
  gaveta.setAttribute('aria-hidden', 'true');

  var iframe = null;
  var aberta = false;
  var focoAntes = null;

  function endereco() {
    var q = new URLSearchParams({ embutido: '1', pagina: (caminho + ' - ' + document.title).slice(0, 200) });
    if (de) q.set('de', de);
    return '/projetos/jean/?' + q.toString();
  }

  function abrir() {
    if (aberta) return;
    aberta = true;
    focoAntes = document.activeElement;
    // A Jean so e carregada na primeira vez; depois o painel so aparece de novo, com a
    // conversa onde estava.
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.title = 'Jean';
      iframe.src = endereco();
      iframe.allow = 'clipboard-write; microphone';
      gaveta.appendChild(iframe);
    }
    veu.classList.remove('jp-escondido');
    gaveta.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () { gaveta.classList.add('jp-aberta'); });
    botao.classList.add('jp-escondido');
    document.documentElement.style.overflow = 'hidden';
    setTimeout(function () { try { iframe.contentWindow.postMessage({ jean: 'focar' }, location.origin); } catch (e) { /* ainda carregando */ } }, 250);
  }

  function fechar() {
    if (!aberta) return;
    aberta = false;
    gaveta.classList.remove('jp-aberta');
    gaveta.setAttribute('aria-hidden', 'true');
    veu.classList.add('jp-escondido');
    botao.classList.remove('jp-escondido');
    document.documentElement.style.overflow = '';
    if (focoAntes && focoAntes.focus) focoAntes.focus(); else botao.focus();
  }

  botao.addEventListener('click', abrir);
  veu.addEventListener('click', fechar);
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (aberta) fechar(); else abrir();
    } else if (e.key === 'Escape' && aberta) {
      fechar();
    }
  });
  // A Jean (dentro do iframe) pede para fechar: botao X, Esc ou Ctrl+K la dentro.
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.jean !== 'fechar') return;
    fechar();
  });

  function montar() {
    document.body.appendChild(veu);
    document.body.appendChild(gaveta);
    document.body.appendChild(botao);
  }
  if (document.body) montar(); else document.addEventListener('DOMContentLoaded', montar);
})();
