'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const COOKIE = 'gastos_sessao';
const JWT_SECRET = process.env.JWT_SECRET;
const SESSAO_DIAS = Number(process.env.SESSAO_DIAS || 30);

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET ausente ou curto no .env (mínimo 32 caracteres).');
}

function hashSenha(senha) { return bcrypt.hashSync(senha, 10); }

// Usuário inexistente, inativo ou sem senha também gasta o tempo de uma comparação bcrypt:
// assim o tempo de resposta do login não revela quais e-mails estão cadastrados.
const HASH_FALSO = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);
function confereSenha(senha, hash) {
  const ok = bcrypt.compareSync(String(senha || ''), hash || HASH_FALSO);
  return !!hash && ok;
}

/** Troca de senha: invalida todas as sessões abertas e devolve a nova versão. */
function renovarSessoes(usuarioId) {
  db.prepare('UPDATE usuarios SET sessao_versao = sessao_versao + 1 WHERE id = ?').run(usuarioId);
  return db.prepare('SELECT id, sessao_versao FROM usuarios WHERE id = ?').get(usuarioId);
}

function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < 8) return 'A senha deve ter pelo menos 8 caracteres.';
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return 'A senha deve ter letras e números.';
  return null;
}

/** Domínios aceitos para login (EMAIL_DOMINIOS=grupomsa.com.br,outra.com.br). Vazio = qualquer. */
function dominioPermitido(email) {
  const lista = (process.env.EMAIL_DOMINIOS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!lista.length) return true;
  const dom = String(email).split('@')[1] || '';
  return lista.includes(dom.toLowerCase());
}

function emitirSessao(res, usuario) {
  const token = jwt.sign({ id: usuario.id, v: usuario.sessao_versao || 0 }, JWT_SECRET, { expiresIn: `${SESSAO_DIAS}d` });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: SESSAO_DIAS * 86400000
  });
}

function encerrarSessao(res) { res.clearCookie(COOKIE); }

/** Carrega o usuário do cookie. Sessão de usuário desativado deixa de valer na hora. */
function exigirLogin(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
  try {
    const { id, v } = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const u = db.prepare('SELECT id, email, nome, perfil, centro_custo, ativo, sessao_versao FROM usuarios WHERE id = ?').get(id);
    if (!u || !u.ativo) throw new Error('inativo');
    if ((v || 0) !== u.sessao_versao) throw new Error('sessão substituída');   // senha trocada depois deste login
    delete u.sessao_versao;
    req.usuario = u;
    next();
  } catch (_) {
    encerrarSessao(res);
    res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
  }
}

function exigirAdmin(req, res, next) {
  if (req.usuario.perfil !== 'admin') return res.status(403).json({ erro: 'Acesso restrito ao administrador.' });
  next();
}

// ---------- Tokens de redefinição de senha ----------
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

/** Gera token de uso único. Só o hash fica no banco. */
function criarTokenSenha(usuarioId, horas) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM tokens_senha WHERE usuario_id = ? OR expira_em < ?').run(usuarioId, Date.now());
  db.prepare('INSERT INTO tokens_senha (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)')
    .run(sha256(token), usuarioId, Date.now() + horas * 3600000);
  return token;
}

/** Retorna o usuario_id se o token for válido (sem consumir). */
function verificarTokenSenha(token) {
  const r = db.prepare('SELECT usuario_id, expira_em, usado FROM tokens_senha WHERE token_hash = ?').get(sha256(String(token || '')));
  if (!r || r.usado || r.expira_em < Date.now()) return null;
  return r.usuario_id;
}

function consumirTokenSenha(token) {
  db.prepare('UPDATE tokens_senha SET usado = 1 WHERE token_hash = ?').run(sha256(String(token || '')));
}

module.exports = {
  hashSenha, confereSenha, validarSenha, dominioPermitido,
  emitirSessao, encerrarSessao, exigirLogin, exigirAdmin, renovarSessoes,
  criarTokenSenha, verificarTokenSenha, consumirTokenSenha
};
