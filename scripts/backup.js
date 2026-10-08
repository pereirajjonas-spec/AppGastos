'use strict';
/**
 * Backup consistente do banco (inclui as fotos/PDFs das notas), mesmo com o app rodando:
 *   npm run backup                      -> backups\gastos-AAAA-MM-DD.db
 *   npm run backup -- "E:\backup-msa"   -> na pasta indicada
 * Mantém os 30 backups mais recentes da pasta.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const pasta = path.resolve(process.argv[2] || path.join(__dirname, '..', 'backups'));
fs.mkdirSync(pasta, { recursive: true });
const destino = path.join(pasta, `gastos-${new Date().toISOString().slice(0, 10)}.db`);

db.backup(destino).then(() => {
  const antigos = fs.readdirSync(pasta).filter(f => /^gastos-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(30);
  antigos.forEach(f => fs.rmSync(path.join(pasta, f)));
  console.log(`Backup gravado: ${destino} (${(fs.statSync(destino).size / 1048576).toFixed(1)} MB)`);
  process.exit(0);
}).catch(e => { console.error('Falha no backup:', e.message); process.exit(1); });
