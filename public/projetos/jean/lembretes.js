// lembretes.js - a Jean avisando dos compromissos da Agenda Google, POR VOZ.
// Pedido do dono (16/11/2026): nada rodando em segundo plano só para isso. Os lembretes
// existem enquanto a página da Jean está aberta (no tablet do setup, quase sempre):
//   - a cada 5 min (e ao voltar para a página) busca os próximos compromissos no servidor;
//   - a cada 15 s confere se chegou a hora de algum aviso;
//   - a hora do aviso segue as notificações do evento no Google (ex.: 10 min antes); evento
//     sem notificação nenhuma é avisado na hora de começar. Evento de dia inteiro não fala.
//   - o aviso aparece num cartão na própria tela e a Jean fala (a esfera pulsa junto).
// O que já foi avisado fica lembrado NESTE aparelho (para não repetir ao recarregar).
// Claude (Opus 5.5), Lab Hub.
var LembretesJean = (function () {
  var BUSCA_MS = 5 * 60 * 1000, CONFERE_MS = 15 * 1000;
  var CHAVE_FEITOS = 'jean.lembretesFeitos', CHAVE_VOZ = 'jean.lembretesVoz', CHAVE_TELA = 'jean.telaAcesa';
  var op = null, eventos = [], estado = null, ultimaBusca = 0, buscando = false, erro = null;
  var fila = [], falandoAgora = false, travaTela = null;

  function ler(chave, padrao) { try { var v = localStorage.getItem(chave); return v === null ? padrao : v; } catch (e) { return padrao; } }
  function gravar(chave, v) { try { localStorage.setItem(chave, v); } catch (e) { /* sem armazenamento */ } }
  function feitos() { try { return JSON.parse(ler(CHAVE_FEITOS, '{}')) || {}; } catch (e) { return {}; } }
  function marcarFeito(chave) {
    var f = feitos(), limite = Date.now() - 3 * 24 * 3600 * 1000;
    Object.keys(f).forEach(function (k) { if (f[k] < limite) delete f[k]; });
    f[chave] = Date.now();
    gravar(CHAVE_FEITOS, JSON.stringify(f));
  }
  function vozLigada() { return ler(CHAVE_VOZ, '1') === '1'; }

  // ------------------------------------------------------------------ busca
  async function buscar(forcar) {
    if (buscando || (!forcar && Date.now() - ultimaBusca < BUSCA_MS - 2000)) return;
    buscando = true;
    try {
      estado = await op.api('/agenda');
      if (estado.conectada && !estado.precisa_reconectar) {
        var r = await op.api('/agenda/eventos?dias=8');
        eventos = r.eventos || [];
        erro = null;
      } else eventos = [];
      ultimaBusca = Date.now();
    } catch (e) {
      erro = (e && e.message) || 'Não foi possível ler a agenda.';
      // reconectar: o servidor marcou; na próxima busca o estado já vem certo
      if (/conect/i.test(erro)) ultimaBusca = Date.now();
    } finally {
      buscando = false;
      atualizarHud();
      if (op.aoMudarDica) op.aoMudarDica();
      if (op.aoMudar) op.aoMudar();
      conferir();
    }
  }

  // ------------------------------------------------------------------ quando avisar
  function conferir() {
    var agora = Date.now(), f = feitos();
    eventos.forEach(function (e) {
      if (e.dia_inteiro) return;
      var inicio = new Date(e.inicio).getTime();
      if (!(inicio > agora - 5 * 60 * 1000)) return; // já começou faz mais de 5 min
      var minutos = e.lembretes && e.lembretes.length ? e.lembretes : [0];
      // O aviso mais recente que já venceu (se a página abriu atrasada, avisa uma vez só).
      var vencido = null;
      minutos.forEach(function (m) {
        var hora = inicio - m * 60000;
        if (hora <= agora && (vencido === null || m < vencido)) vencido = m;
      });
      if (vencido === null) return;
      var chave = e.id + '|' + e.inicio + '|' + vencido;
      if (f[chave]) return;
      minutos.forEach(function (m) { if (m >= vencido) marcarFeito(e.id + '|' + e.inicio + '|' + m); });
      avisar(e);
    });
  }

  function hora(iso) { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  function quantoFalta(iso) {
    var min = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
    if (min <= 0) return min < -1 ? 'começou há ' + (-min) + ' minutos' : 'está começando agora';
    if (min === 1) return 'começa em 1 minuto';
    if (min < 60) return 'começa em ' + min + ' minutos';
    var h = Math.floor(min / 60), r = min % 60;
    var hs = h === 1 ? '1 hora' : h + ' horas';
    if (h >= 20) {
      var amanha = new Date(); amanha.setDate(amanha.getDate() + 1);
      var dia = new Date(iso).toDateString() === amanha.toDateString() ? 'amanhã' : new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric' });
      return 'é ' + dia + ', às ' + hora(iso);
    }
    return 'começa em ' + hs + (r ? ' e ' + r + ' minutos' : '');
  }

  function textoFalado(e) {
    var nome = op.nomeDono ? op.nomeDono() : '';
    var t = (nome ? nome + ', ' : '') + 'lembrete: ' + e.titulo + ' ' + quantoFalta(e.inicio);
    if (!/às \d/.test(t)) t += ', às ' + hora(e.inicio);
    t += '.';
    if (e.local) t += ' Local: ' + e.local + '.';
    return t;
  }

  // ------------------------------------------------------------------ aviso na tela + voz
  function avisar(e, teste) {
    var caixa = document.getElementById('lembretes');
    var el = document.createElement('div');
    el.className = 'lembrete';
    el.setAttribute('role', 'alert');
    el.innerHTML =
      '<div class="lembrete-icone" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg></div>' +
      '<div class="lembrete-texto"><span class="lembrete-rotulo"></span><strong></strong><span class="lembrete-quando"></span></div>' +
      '<div class="lembrete-botoes"><button type="button" class="secundario" data-de-novo>Ouvir</button><button type="button" class="primario" data-ok>OK</button></div>';
    el.querySelector('.lembrete-rotulo').textContent = teste ? 'Teste de lembrete' : 'Lembrete da agenda';
    el.querySelector('strong').textContent = e.titulo;
    el.querySelector('.lembrete-quando').textContent = hora(e.inicio) + ' · ' + quantoFalta(e.inicio) + (e.local ? ' · ' + e.local : '');
    el.querySelector('[data-ok]').addEventListener('click', function () { el.remove(); if (window.VozJean && falandoAgora) VozJean.parar(); });
    el.querySelector('[data-de-novo]').addEventListener('click', function () { fila.push(textoFalado(e)); falarProximo(); });
    caixa.prepend(el);
    // Some sozinho 15 min depois de começar o evento.
    setTimeout(function () { el.remove(); }, Math.max(60000, new Date(e.inicio).getTime() - Date.now() + 15 * 60000));
    if (vozLigada() || teste) { fila.push(textoFalado(e)); falarProximo(); }
  }

  // Fala quando a Jean está livre (não interrompe uma resposta nem a conversa por voz).
  var esperando = null;
  function falarProximo() {
    if (falandoAgora || !fila.length) return;
    var ocupada = (op.ocupada && op.ocupada()) || (window.VozJean && VozJean.falando());
    if (ocupada) { clearTimeout(esperando); esperando = setTimeout(falarProximo, 2000); return; }
    var texto = fila.shift();
    falandoAgora = true;
    op.falar(texto, function () { falandoAgora = false; setTimeout(falarProximo, 400); });
  }

  // ------------------------------------------------------------------ painel de instrumentos
  function proximo() {
    var agora = Date.now();
    return eventos.find(function (e) { return !e.dia_inteiro && new Date(e.inicio).getTime() > agora - 5 * 60000; }) || null;
  }
  function atualizarHud() {
    var rotulo = document.getElementById('hud-agenda-rotulo'), valor = document.getElementById('hud-agenda');
    if (!rotulo || !valor) return;
    if (!estado || !estado.conectada) { rotulo.textContent = 'CONTEXTO'; valor.textContent = 'LAB HUB'; return; }
    var p = proximo();
    rotulo.textContent = 'PRÓXIMO';
    if (!p) { valor.textContent = 'AGENDA LIVRE'; return; }
    var hoje = new Date(p.inicio).toDateString() === new Date().toDateString();
    valor.textContent = (hoje ? hora(p.inicio) : new Date(p.inicio).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hora(p.inicio)) +
      ' ' + p.titulo.slice(0, 22).toUpperCase();
  }

  // ------------------------------------------------------------------ manter a tela acesa
  async function pedirTelaAcesa() {
    if (ler(CHAVE_TELA, '0') !== '1' || !('wakeLock' in navigator) || travaTela || document.hidden) return;
    try { travaTela = await navigator.wakeLock.request('screen'); travaTela.addEventListener('release', function () { travaTela = null; }); }
    catch (e) { /* bateria fraca ou navegador recusou */ }
  }
  function telaAcesa(sim) {
    gravar(CHAVE_TELA, sim ? '1' : '0');
    if (sim) pedirTelaAcesa(); else if (travaTela) { travaTela.release(); travaTela = null; }
  }

  // ------------------------------------------------------------------ início
  function iniciar(opcoes) {
    op = opcoes;
    buscar(true);
    setInterval(function () { buscar(false); }, 60 * 1000);
    setInterval(function () { conferir(); atualizarHud(); }, CONFERE_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { buscar(false); conferir(); pedirTelaAcesa(); } });
    window.addEventListener('online', function () { buscar(true); });
    pedirTelaAcesa();
    // Navegador só deixa tocar som depois do primeiro toque na página. Se a página abriu
    // sozinha (tablet reiniciou), avisa para tocar uma vez.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) {
      var dica = document.createElement('button');
      dica.type = 'button';
      dica.className = 'lembrete-liberar';
      dica.textContent = 'Toque aqui uma vez para a Jean poder falar os lembretes da agenda';
      document.getElementById('lembretes').appendChild(dica);
      var tirar = function () { dica.remove(); document.removeEventListener('pointerdown', tirar, true); };
      document.addEventListener('pointerdown', tirar, true);
      dica.hidden = true;
      op.aoMudarDica = function () { dica.hidden = !(estado && estado.conectada && vozLigada()); };
    }
  }

  return {
    iniciar: iniciar,
    atualizar: function () { return buscar(true); },
    estado: function () { return estado; },
    eventos: function () { return eventos; },
    erro: function () { return erro; },
    vozLigada: vozLigada,
    ligarVoz: function (sim) { gravar(CHAVE_VOZ, sim ? '1' : '0'); },
    telaAcesaLigada: function () { return ler(CHAVE_TELA, '0') === '1'; },
    temTelaAcesa: 'wakeLock' in navigator,
    telaAcesa: telaAcesa,
    testar: function () {
      avisar({ id: 'teste', titulo: 'Exemplo de compromisso', inicio: new Date(Date.now() + 10 * 60000).toISOString(), local: null }, true);
    },
    quantoFalta: quantoFalta,
    hora: hora,
  };
})();
