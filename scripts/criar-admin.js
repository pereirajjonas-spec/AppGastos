'use strict';
/**
 * Cria (ou promove) o primeiro administrador.
 *   npm run criar-admin -- jonas.pereira@grupomsa.com.br "Jonas Pereira"
 * A senha é pedida no terminal (não fica no histórico do shell).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const readline = require('readline');
const db = require('../src/db');
const { hashSenha, validarSenha } = require('../src/auth');

const [email, nome] = process.argv.slice(2);
if (!email || !nome) {
  console.log('Uso: npm run criar-admin -- email@empresa.com.br "Nome Completo"');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Senha do administrador (mín. 8, letras e números): ', senha => {
  rl.close();
  const p = validarSenha(senha);
  if (p) { console.error(p); process.exit(1); }
  const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email.toLowerCase());
  if (existe) {
    db.prepare("UPDATE usuarios SET perfil = 'admin', ativo = 1, senha_hash = ?, nome = ? WHERE id = ?").run(hashSenha(senha), nome, existe.id);
    console.log('Usuário existente promovido a administrador.');
  } else {
    db.prepare("INSERT INTO usuarios (email, nome, perfil, senha_hash) VALUES (?, ?, 'admin', ?)").run(email.toLowerCase(), nome, hashSenha(senha));
    console.log('Administrador criado.');
  }
});
