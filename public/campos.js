// campos.js — máscara, validação e autofill de endereço. BASE compartilhada.
//
// Regra da casa: TODO campo em que o usuário digita tem máscara, sem ninguém precisar
// pedir. Campo de texto sem máscara declarada vira MAIÚSCULAS; e-mail é minúsculo.
// Isto aqui é a camada reusável — não implemente máscara campo a campo.
//
// Uso no HTML:
//   <input data-mask="cnpj">          formata enquanto digita e valida o dígito verificador
//   <input data-mask="upper">         MAIÚSCULAS (default de texto comum)
//   <input data-mask="email">         minúsculo, sem espaço
//   <input data-mask="cep" data-autocep>   ao completar 8 dígitos, preenche o endereço
//   <input data-end="logradouro">     destino do autofill (logradouro|bairro|cidade|uf)
//
// Depois de montar a tela:  Campos.aplicar(document);
//
// Autoria: Claude (Opus 5). Portado do Painel F1, onde essas regras nasceram.

const Campos = (() => {
  const so = (v, n) => String(v == null ? '' : v).replace(/\D/g, '').slice(0, n);

  // ---------- máscaras ----------
  const mCNPJ = (v) => { const d = so(v, 14); let o = d.slice(0, 2); if (d.length > 2) o += '.' + d.slice(2, 5); if (d.length > 5) o += '.' + d.slice(5, 8); if (d.length > 8) o += '/' + d.slice(8, 12); if (d.length > 12) o += '-' + d.slice(12, 14); return o; };
  const mCPF = (v) => { const d = so(v, 11); let o = d.slice(0, 3); if (d.length > 3) o += '.' + d.slice(3, 6); if (d.length > 6) o += '.' + d.slice(6, 9); if (d.length > 9) o += '-' + d.slice(9, 11); return o; };
  const mCEP = (v) => { const d = so(v, 8); return d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d; };
  const mTel = (v) => { const d = so(v, 11); if (!d) return ''; if (d.length <= 10) { let o = '(' + d.slice(0, 2); if (d.length > 2) o += ') ' + d.slice(2, 6); if (d.length > 6) o += '-' + d.slice(6, 10); return o; } return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7, 11); };
  const mData = (v) => { const d = so(v, 8); let o = d.slice(0, 2); if (d.length > 2) o += '/' + d.slice(2, 4); if (d.length > 4) o += '/' + d.slice(4, 8); return o; };
  const mUF = (v) => String(v == null ? '' : v).replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2);
  const mUpper = (v) => String(v == null ? '' : v).toUpperCase();
  const mEmail = (v) => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, '');
  // moeda: digita em centavos, mostra 1.234,56
  const mMoeda = (v) => { const d = so(v, 15); if (!d) return ''; const n = (parseInt(d, 10) / 100).toFixed(2); return n.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };

  const FMT = { cnpj: mCNPJ, cpf: mCPF, cep: mCEP, telefone: mTel, data: mData, uf: mUF, email: mEmail, upper: mUpper, moeda: mMoeda };

  // ---------- validação (dígito verificador de verdade onde existe) ----------
  const vCNPJ = (v) => { const c = so(v, 14); if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false; const k = (b) => { let s = 0, p = b.length - 7; for (let i = 0; i < b.length; i++) { s += +b[i] * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; }; return k(c.slice(0, 12)) === +c[12] && k(c.slice(0, 13)) === +c[13]; };
  const vCPF = (v) => { const c = so(v, 11); if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false; const k = (b) => { let s = 0; for (let i = 0; i < b.length; i++) s += +b[i] * (b.length + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; }; return k(c.slice(0, 9)) === +c[9] && k(c.slice(0, 10)) === +c[10]; };
  const vTel = (v) => { const d = so(v, 11); return d.length === 10 || d.length === 11; };
  const vData = (v) => { const m = String(v || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (!m) return false; const dd = +m[1], mm = +m[2], yy = +m[3], dt = new Date(yy, mm - 1, dd); return yy >= 1900 && yy <= 2100 && dt.getFullYear() === yy && dt.getMonth() === mm - 1 && dt.getDate() === dd; };
  const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
  const vUF = (v) => UFS.includes(String(v || '').trim().toUpperCase());
  const vEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
  const vCEP = (v) => so(v, 8).length === 8;

  const VALIDA = { cnpj: vCNPJ, cpf: vCPF, cep: vCEP, telefone: vTel, data: vData, uf: vUF, email: vEmail };
  const COMPLETO = { cnpj: 14, cpf: 11, cep: 8, telefone: 10, data: 8 };

  // teclado do celular derivado da máscara: campo novo já nasce certo
  const IMODE = { cnpj: 'numeric', cpf: 'numeric', cep: 'numeric', telefone: 'numeric', data: 'numeric', moeda: 'decimal' };

  // ---------- CEP -> endereço (ViaCEP, grátis e com CORS) ----------
  async function buscarCEP(cep) {
    const d = so(cep, 8);
    if (d.length !== 8) return null;
    try {
      const r = await fetch('https://viacep.com.br/ws/' + d + '/json/');
      const j = await r.json();
      if (j.erro) return null;
      return { logradouro: j.logradouro || '', bairro: j.bairro || '', cidade: j.localidade || '', uf: j.uf || '' };
    } catch (_) { return null; }
  }

  // preenche os campos [data-end] do mesmo formulário, sem sobrescrever o que já foi digitado
  async function autofillCEP(elCep) {
    const box = elCep.closest('form') || elCep.closest('[data-form]') || document;
    const e = await buscarCEP(elCep.value);
    if (!e) return;
    const por = (chave, valor) => {
      const alvo = box.querySelector('[data-end="' + chave + '"]');
      if (alvo && !String(alvo.value || '').trim() && valor) {
        alvo.value = alvo.dataset.mask === 'upper' ? mUpper(valor) : valor;
        alvo.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
    por('logradouro', e.logradouro); por('bairro', e.bairro);
    por('cidade', e.cidade); por('uf', e.uf);
  }

  // ---------- liga tudo ----------
  // Regra do salvar: campo VAZIO pode salvar; campo PREENCHIDO tem que ser válido.
  // O visual marca .invalido / .valido; quem bloqueia o salvar é Campos.tudoValido(box).
  function aplicar(box) {
    (box || document).querySelectorAll('[data-mask]').forEach((el) => {
      if (el.dataset.campoLigado) return;      // idempotente: pode chamar de novo após re-render
      el.dataset.campoLigado = '1';
      const m = el.dataset.mask;
      const fmt = FMT[m];
      if (!fmt) return;

      if (IMODE[m] && !el.getAttribute('inputmode')) el.setAttribute('inputmode', IMODE[m]);

      const semTamanho = (m === 'upper' || m === 'email');   // não insere caractere -> preserva o cursor
      const formatar = () => {
        if (semTamanho) { const p = el.selectionStart; el.value = fmt(el.value); try { el.setSelectionRange(p, p); } catch (_) {} }
        else { el.value = fmt(el.value); }
      };
      el.addEventListener('input', formatar);

      if (VALIDA[m]) {
        const conferir = (soCompleto) => {
          const v = String(el.value || '').trim();
          const compl = (m === 'email') ? /.+@.+\..+/.test(v) : (so(v, 20).length >= (COMPLETO[m] || 0));
          const ok = VALIDA[m](v);
          const ruim = soCompleto ? (compl && !ok) : (!!v && !ok);
          el.classList.toggle('invalido', ruim);
          el.classList.toggle('valido', compl && ok);
          el.title = ruim ? 'valor inválido' : '';
        };
        el.addEventListener('input', () => conferir(true));   // digitando: só quando já completou
        el.addEventListener('blur', () => conferir(false));   // ao sair: qualquer valor incompleto
        conferir(false);                                      // valida o que veio pré-preenchido
      }

      if (el.hasAttribute('data-autocep')) {
        el.addEventListener('input', () => { if (so(el.value, 8).length === 8) autofillCEP(el); });
      }

      if (el.value) formatar();
    });
  }

  // true se nenhum campo preenchido está inválido. Vazio não reprova.
  function tudoValido(box) {
    let ok = true;
    (box || document).querySelectorAll('[data-mask]').forEach((el) => {
      const m = el.dataset.mask, v = String(el.value || '').trim();
      if (VALIDA[m] && v && !VALIDA[m](v)) { ok = false; el.classList.add('invalido'); }
    });
    return ok;
  }

  return { aplicar, tudoValido, buscarCEP, fmt: FMT, valida: VALIDA };
})();

if (typeof window !== 'undefined') window.Campos = Campos;
