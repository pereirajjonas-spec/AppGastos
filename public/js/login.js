'use strict';
(function () {
  const $ = id => document.getElementById(id);
  const destino = () => {
    const v = new URLSearchParams(location.search).get('volta');
    return v && v.startsWith('/') && !v.startsWith('//') ? v : '/app';
  };

  // Já logado? Vai direto para o app.
  fetch('/api/auth/eu', { credentials: 'same-origin' }).then(r => { if (r.ok) location.replace(destino()); });

  $('fLogin').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    $('erroLogin').hidden = true;
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      await api('/api/auth/login', { method: 'POST', body: { email: $('email').value.trim(), senha: $('senha').value } });
      location.replace(destino());
    } catch (err) {
      $('erroLogin').textContent = err.message;
      $('erroLogin').hidden = false;
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  });

  $('lnkEsqueci').addEventListener('click', e => {
    e.preventDefault();
    $('fLogin').hidden = true; $('fEsqueci').hidden = false;
    $('emailEsq').value = $('email').value; $('emailEsq').focus();
  });
  $('lnkVoltar').addEventListener('click', e => {
    e.preventDefault();
    $('fEsqueci').hidden = true; $('fLogin').hidden = false;
  });

  $('fEsqueci').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('msgEsqueci');
    const email = $('emailEsq').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      msg.className = 'msg msg-erro'; msg.textContent = 'Informe um e-mail válido.'; msg.hidden = false; return;
    }
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await api('/api/auth/esqueci', { method: 'POST', body: { email } });
      msg.className = 'msg msg-ok';
      msg.textContent = 'Se este e-mail estiver cadastrado, você vai receber em instantes um link para criar uma nova senha. Confira também a caixa de spam.';
    } catch (err) {
      msg.className = 'msg msg-erro'; msg.textContent = err.message;
    }
    msg.hidden = false; btn.disabled = false;
  });
})();
