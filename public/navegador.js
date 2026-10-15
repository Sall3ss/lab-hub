// navegador.js — detecta navegador embutido de aplicativo e manda a pessoa pro navegador
// de verdade. BASE compartilhada: carregue em TODO projeto que tenha tela de login.
//
// POR QUE ISTO EXISTE (custou um bug em produção pra descobrir):
// O link do sistema quase sempre chega por WhatsApp. Quando a pessoa toca, o WhatsApp NÃO
// abre o Chrome nem o Safari: abre um navegador interno próprio. E ali:
//
//   - o armazenamento é SEPARADO do navegador de verdade e costuma ser descartado.
//     A pessoa usa o sistema, fecha, abre pelo ícone e "sumiu tudo".
//   - não dá pra instalar na tela inicial
//   - compartilhar arquivo (mandar o PDF de volta pro WhatsApp) falha
//   - a sessão pode não sobreviver
//
// O mesmo vale pra Instagram, Facebook, Messenger, TikTok e afins.
//
// Autoria: Claude (Opus 5), 01/08/2026. Nasceu do painel-fabio-bianchi, onde o cliente
// final montou orçamentos dentro do navegador do WhatsApp e achou que não tinha gravado.

(() => {
  'use strict';

  const ua = navigator.userAgent || '';

  // Assinaturas de aplicativo que abre navegador próprio.
  const APLICATIVOS = [
    [/FBAN|FBAV|FB_IAB|FBIOS/i, 'Facebook'],
    [/Instagram/i, 'Instagram'],
    [/WhatsApp/i, 'WhatsApp'],
    [/Messenger/i, 'Messenger'],
    [/LinkedInApp/i, 'LinkedIn'],
    [/Twitter|TwitterAndroid/i, 'X'],
    [/TikTok|BytedanceWebview|musical_ly/i, 'TikTok'],
    [/Line\//i, 'Line'],
    [/Telegram/i, 'Telegram'],
    [/Snapchat/i, 'Snapchat'],
  ];

  const ehIOS = /iphone|ipad|ipod/i.test(ua);
  const ehAndroid = /android/i.test(ua);

  function detectar() {
    for (const [regex, nome] of APLICATIVOS) if (regex.test(ua)) return nome;

    // Android: WebView embutida se anuncia com "; wv)". Pega os aplicativos que não
    // colocam o próprio nome, inclusive várias versões do WhatsApp.
    if (ehAndroid && /;\s*wv\)/i.test(ua)) return 'outro aplicativo';

    // iOS: WKWebView embutida parece Safari mas NÃO traz o token "Safari".
    // Chrome, Firefox e Edge no iPhone trazem CriOS/FxiOS/EdgiOS e são navegadores
    // de verdade, então ficam de fora.
    if (ehIOS && /AppleWebKit/i.test(ua) && !/Safari/i.test(ua)
        && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)) return 'outro aplicativo';

    return null;
  }

  // Já rodando instalado na tela inicial: não é navegador embutido, é o app.
  const instalado = window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  const dentroDe = instalado ? null : detectar();
  if (!dentroDe) return;

  // A pessoa pode insistir. Guardamos a escolha pra não brigar a cada carregamento.
  try {
    if (sessionStorage.getItem('navegador.insistiu') === '1') return;
  } catch (_) { /* armazenamento bloqueado: mostra o aviso mesmo assim */ }

  const url = location.href;
  const semEsquema = url.replace(/^https?:\/\//, '');

  const estilo = document.createElement('style');
  estilo.textContent = `
    #aviso-navegador {
      position: fixed; inset: 0; z-index: 9999;
      background: #0b3d2e; color: #fff;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      display: flex; align-items: center; justify-content: center;
      padding: 1.5rem; overflow-y: auto;
    }
    #aviso-navegador .caixa { width: 100%; max-width: 24rem; }
    #aviso-navegador h1 { font-size: 1.35rem; margin: 0 0 .6rem; }
    #aviso-navegador p { margin: 0 0 .9rem; line-height: 1.5; opacity: .92; font-size: .95rem; }
    #aviso-navegador ol { margin: 0 0 1rem; padding-left: 1.2rem; line-height: 1.6; font-size: .95rem; opacity: .92; }
    #aviso-navegador li { margin-bottom: .4rem; }
    #aviso-navegador .link {
      background: #ffffff1a; border: 1px solid #ffffff33; border-radius: 10px;
      padding: .6rem .7rem; font-size: .85rem; word-break: break-all; margin-bottom: 1rem;
    }
    #aviso-navegador button {
      font: inherit; width: 100%; min-height: 50px; border-radius: 12px;
      border: 0; cursor: pointer; margin-bottom: .6rem; font-weight: 600;
      background: #fff; color: #0b3d2e;
    }
    #aviso-navegador button.secundario {
      background: transparent; color: #fff; border: 1px solid #ffffff55; font-weight: 400;
    }
    #aviso-navegador .insistir {
      display: block; width: 100%; text-align: center; background: none; border: 0;
      color: #ffffff88; font-size: .8rem; text-decoration: underline;
      margin-top: .8rem; min-height: 44px; font-weight: 400;
    }
  `;

  const caixa = document.createElement('div');
  caixa.id = 'aviso-navegador';

  const passosIOS = `
    <ol>
      <li>Toque no botão <strong>&#8942;</strong> ou <strong>&#8230;</strong> no canto da tela</li>
      <li>Toque em <strong>Abrir no Safari</strong> (ou <strong>Abrir no navegador</strong>)</li>
    </ol>`;

  const passosOutros = `
    <ol>
      <li>Toque no botão <strong>&#8942;</strong> ou <strong>&#8230;</strong> no canto da tela</li>
      <li>Toque em <strong>Abrir no navegador</strong> ou <strong>Abrir no Chrome</strong></li>
    </ol>`;

  caixa.innerHTML = `
    <div class="caixa">
      <h1>Abra no navegador do celular</h1>
      <p>Você entrou pelo ${dentroDe}, que usa um navegador interno. Aqui o sistema
         <strong>não guarda seus dados direito</strong> e não dá pra instalar na tela inicial.</p>
      ${ehAndroid ? '' : (ehIOS ? passosIOS : passosOutros)}
      <div class="link">${semEsquema}</div>
      ${ehAndroid ? '<button id="abrir-chrome">Abrir no Chrome</button>' : ''}
      <button id="copiar-link" class="secundario">Copiar o link</button>
      <button id="insistir" class="insistir">Continuar assim mesmo</button>
    </div>`;

  document.documentElement.append(estilo, caixa);

  const abrir = caixa.querySelector('#abrir-chrome');
  if (abrir) {
    abrir.addEventListener('click', () => {
      // intent:// é o jeito do Android de dizer "abre isto no Chrome, não em mim".
      const alvo = 'intent://' + semEsquema + '#Intent;scheme=https;package=com.android.chrome;end';
      location.href = alvo;
    });
  }

  caixa.querySelector('#copiar-link').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    try {
      await navigator.clipboard.writeText(url);
      b.textContent = 'Link copiado. Cole no navegador.';
    } catch (_) {
      b.textContent = 'Copie o endereço acima à mão.';
    }
  });

  caixa.querySelector('#insistir').addEventListener('click', () => {
    try { sessionStorage.setItem('navegador.insistiu', '1'); } catch (_) {}
    caixa.remove();
    estilo.remove();
  });
})();
