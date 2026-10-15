// Tela do projeto "cyberidle" - Fase 1 (protótipo mínimo jogável).
// Tudo roda no navegador: loop de combate, ganho de Creds/XP, level up e upgrade.
// O progresso fica salvo SÓ neste navegador (localStorage). Salvar no servidor e ganho
// offline são da Fase 3; a API dele responderá em /api/p/cyberidle/...
// Base: protótipo do dono (15/10/2026). Autoria dos ajustes: Claude (Opus 5.5).
(function () {
  var CHAVE = 'cyberidle.progresso.v1';
  var TICK_MS = 200;
  // Aba em segundo plano: o navegador espaça o timer. O loop compensa pelo tempo real
  // que passou, até este teto (mais que isso é "ganho offline", que é da Fase 3).
  var TETO_MS = 5 * 60 * 1000;
  var LOG_MAX = 60;

  function novo() {
    return { nivel: 1, xp: 0, xpProx: 100, creds: 0, atk: 10, custoUp: 15, abates: 0, alvoMax: 50, alvoHp: 50 };
  }

  var s = carregar();
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return Math.floor(n).toLocaleString('pt-BR'); };

  function carregar() {
    try {
      var j = JSON.parse(localStorage.getItem(CHAVE) || 'null');
      if (j && typeof j.nivel === 'number') return Object.assign(novo(), j);
    } catch (_) {}
    return novo();
  }
  function salvar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(s)); } catch (_) {}
  }

  // Alvo sobe de versão a cada 10 abates (só nome, por enquanto).
  function nomeAlvo() { return 'Drone de Vigilância v' + (1 + Math.floor(s.abates / 10)); }
  // Recompensa acompanha a vida do alvo: sem isso o alvo cresce 5% por abate e o
  // ganho fica parado, e o jogo trava depois de poucos minutos.
  function premioCreds() { return Math.ceil(s.alvoMax / 10); }
  function premioXp() { return Math.ceil(s.alvoMax / 2); }

  function log(msg, tipo) {
    var box = $('log');
    var d = document.createElement('div');
    if (tipo) d.className = tipo;
    d.textContent = '> ' + msg;
    box.appendChild(d);
    while (box.childNodes.length > LOG_MAX) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  // Um abate: paga, sobe nível quantas vezes couber, e o próximo alvo vem 5% mais forte.
  function abater(silencioso) {
    var c = premioCreds(), x = premioXp(), nome = nomeAlvo();
    s.creds += c; s.xp += x; s.abates++;
    if (!silencioso) log('Alvo ' + nome + ' neutralizado! +$' + fmt(c) + ', +' + fmt(x) + ' XP', 'ok');
    while (s.xp >= s.xpProx) {
      s.xp -= s.xpProx;
      s.nivel++;
      s.xpProx = Math.floor(s.xpProx * 1.5);
      s.atk += 2;
      log('SISTEMA ATUALIZADO! Nível do Operador agora é ' + s.nivel + ' (+2 DPS).', 'ok');
    }
    s.alvoMax = Math.floor(s.alvoMax * 1.05);
    s.alvoHp = s.alvoMax;
  }

  var ultimo = Date.now();
  function tick() {
    var agora = Date.now();
    var dano = s.atk * Math.min(agora - ultimo, TETO_MS) / 1000;
    ultimo = agora;
    var antes = { n: s.abates, c: s.creds };
    var muitos = dano > s.alvoHp * 3; // voltou de segundo plano: resume em uma linha
    var guarda = 0;
    while (dano > 0 && guarda++ < 100000) {
      if (dano >= s.alvoHp) { dano -= s.alvoHp; abater(muitos); }
      else { s.alvoHp -= dano; dano = 0; }
    }
    if (muitos && s.abates > antes.n) {
      log('Enquanto a aba estava em segundo plano: ' + fmt(s.abates - antes.n) + ' alvos neutralizados, +$' + fmt(s.creds - antes.c) + '.', 'ok');
    }
    desenhar();
  }

  function desenhar() {
    $('nivel').textContent = s.nivel;
    $('creds').textContent = '$' + fmt(s.creds);
    $('atk').textContent = fmt(s.atk);
    $('abates').textContent = fmt(s.abates);
    $('xp-txt').textContent = fmt(s.xp) + '/' + fmt(s.xpProx) + ' XP';
    $('xp-barra').style.width = Math.min(100, s.xp / s.xpProx * 100) + '%';
    $('alvo-nome').textContent = nomeAlvo();
    $('alvo-hp-txt').textContent = fmt(Math.ceil(Math.max(0, s.alvoHp))) + '/' + fmt(s.alvoMax);
    $('hp-barra').style.width = Math.max(0, s.alvoHp / s.alvoMax * 100) + '%';
    var b = $('btn-overclock');
    b.textContent = 'UPGRADE: OVERCLOCK (+5 DPS) · $' + fmt(s.custoUp);
    b.disabled = s.creds < s.custoUp;
  }

  $('btn-overclock').onclick = function () {
    if (s.creds < s.custoUp) { log('Creds insuficientes para o upgrade!', 'alerta'); return; }
    s.creds -= s.custoUp;
    s.atk += 5;
    s.custoUp = Math.floor(s.custoUp * 1.8);
    log('Upgrade instalado: Overclock de hardware ativado (+5 DPS).', 'alerta');
    salvar();
    desenhar();
  };

  $('btn-reiniciar').onclick = function () {
    if (!confirm('Reiniciar o progresso? Nível, Creds e upgrades voltam ao início e não há como desfazer.')) return;
    s = novo();
    ultimo = Date.now();
    salvar();
    $('log').textContent = '';
    log('Progresso reiniciado. Nova sessão iniciada.');
    desenhar();
  };

  // Salva a cada 10 s e quando a pessoa sai ou troca de aba.
  setInterval(salvar, 10000);
  document.addEventListener('visibilitychange', function () { if (document.hidden) salvar(); });
  window.addEventListener('pagehide', salvar);

  log(s.abates ? 'Sessão retomada. Progresso carregado deste navegador.' : 'Sessão iniciada. Conectado ao nó de rede local.');
  desenhar();
  setInterval(tick, TICK_MS);
})();
