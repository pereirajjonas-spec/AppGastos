'use strict';
const nodemailer = require('nodemailer');

let transporte = null;
function getTransporte() {
  if (transporte) return transporte;
  if (!process.env.SMTP_HOST) return null;
  transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',     // true = 465; false = STARTTLS na 587
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
  return transporte;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function modelo(titulo, nome, texto, botao, link, rodape) {
  return `<!doctype html><html><body style="margin:0;background:#F5F5F5;font-family:Arial,Helvetica,sans-serif;color:#1A1A1A">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
    <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:12px;border-top:4px solid #5BA85F">
      <tr><td style="padding:28px 32px 8px"><img src="cid:logo-msa" alt="Grupo MSA" height="28"></td></tr>
      <tr><td style="padding:8px 32px 0"><h1 style="font-size:20px;margin:12px 0">${esc(titulo)}</h1>
        <p style="font-size:15px;line-height:1.5">Olá, ${esc(nome)}.</p>
        <p style="font-size:15px;line-height:1.5">${texto}</p>
        <p style="margin:28px 0"><a href="${esc(link)}" style="background:#5BA85F;color:#fff;text-decoration:none;padding:13px 24px;border-radius:6px;font-weight:bold;display:inline-block">${esc(botao)}</a></p>
        <p style="font-size:12px;color:#666;line-height:1.5">Se o botão não funcionar, copie este endereço no navegador:<br><span style="word-break:break-all">${esc(link)}</span></p>
        <p style="font-size:12px;color:#666;line-height:1.5">${rodape}</p>
      </td></tr>
      <tr><td style="padding:16px 32px 24px;font-size:11px;color:#999;border-top:1px solid #eee">Despesas de Viagem · Grupo MSA — mensagem automática, não responda.</td></tr>
    </table></td></tr></table></body></html>`;
}

async function enviar(para, assunto, html) {
  const t = getTransporte();
  if (!t) {
    // Sem SMTP configurado (ambiente de desenvolvimento): registra o conteúdo no console.
    console.warn(`[email] SMTP não configurado. E-mail para ${para} — "${assunto}" não foi enviado.`);
    console.warn('[email] Link:', (html.match(/href="([^"]+)"/) || [])[1]);
    return false;
  }
  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: para,
    subject: assunto,
    html,
    attachments: [{ filename: 'logo.jpg', path: require('path').join(__dirname, '..', 'public', 'img', 'logo.jpg'), cid: 'logo-msa' }]
  });
  return true;
}

function emailRedefinicao(usuario, link) {
  return enviar(usuario.email, 'Redefinição de senha — Despesas de Viagem',
    modelo('Redefinição de senha', usuario.nome,
      'Recebemos um pedido para redefinir a sua senha do aplicativo Despesas de Viagem. Clique no botão abaixo para criar uma nova senha.',
      'Criar nova senha', link,
      'O link vale por 1 hora e só pode ser usado uma vez. Se você não pediu a redefinição, ignore este e-mail: sua senha atual continua valendo.'));
}

function emailBoasVindas(usuario, link, horas) {
  return enviar(usuario.email, 'Seu acesso ao Despesas de Viagem',
    modelo('Bem-vindo ao Despesas de Viagem', usuario.nome,
      `O administrador criou o seu acesso ao aplicativo de despesas de viagem do Grupo MSA. Seu login é o seu e-mail: <b>${esc(usuario.email)}</b>. Clique no botão abaixo para definir a sua senha.`,
      'Definir minha senha', link,
      `O link vale por ${horas} horas. Depois disso, use "Esqueci minha senha" na tela de login.`));
}

module.exports = { emailRedefinicao, emailBoasVindas };
