'use strict';
(async function () {
  const $ = id => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const token = qs.get('token');
  const msg = (t, tipo) => { $('msg').className = 'msg msg-' + tipo; $('msg').textContent = t; $('msg').hidden = false; };

  try {
    const u = await api('/api/auth/token?token=' + encodeURIComponent(token || ''));
    if (qs.get('novo')) $('titulo').textContent = 'Defina sua senha';
    $('quem').textContent = `${u.nome} · ${u.email}`;
    $('fSenha').hidden = false;
    $('senha').focus();
  } catch (e) {
    msg(e.message, 'erro');
    return;
  }

  $('fSenha').addEventListener('submit', async e => {
    e.preventDefault();
    $('msg').hidden = true;
    if ($('senha').value !== $('senha2').value) return msg('As senhas não conferem.', 'erro');
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await api('/api/auth/redefinir', { method: 'POST', body: { token, senha: $('senha').value } });
      $('fSenha').hidden = true;
      msg('Senha salva! Você já pode entrar com o seu e-mail e a nova senha.', 'ok');
      setTimeout(() => location.replace('/'), 2500);
    } catch (err) {
      msg(err.message, 'erro');
      btn.disabled = false;
    }
  });
})();
