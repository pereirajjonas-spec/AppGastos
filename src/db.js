'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(process.env.DB_PATH || path.join(DATA_DIR, 'gastos.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nome          TEXT NOT NULL,
  senha_hash    TEXT,
  perfil        TEXT NOT NULL DEFAULT 'usuario' CHECK (perfil IN ('admin','usuario')),
  centro_custo  TEXT,
  ativo         INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  ultimo_login  TEXT
);

CREATE TABLE IF NOT EXISTS tokens_senha (
  token_hash  TEXT PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em   INTEGER NOT NULL,
  usado       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS viagens (
  id            INTEGER PRIMARY KEY,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
  titulo        TEXT NOT NULL,
  destino       TEXT,
  motivo        TEXT,
  centro_custo  TEXT,
  data_inicio   TEXT,
  data_fim      TEXT,
  adiantamento  REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','fechada')),
  criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS notas (
  id               INTEGER PRIMARY KEY,
  viagem_id        INTEGER NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
  usuario_id       INTEGER NOT NULL REFERENCES usuarios(id),
  arquivo          TEXT NOT NULL,
  mimetype         TEXT NOT NULL,
  nome_original    TEXT,
  hash_arquivo     TEXT,
  tipo_documento   TEXT,
  numero           TEXT,
  serie            TEXT,
  chave            TEXT,
  data_emissao     TEXT,
  hora_emissao     TEXT,
  cnpj             TEXT,
  estabelecimento  TEXT,
  cidade           TEXT,
  uf               TEXT,
  valor_total      REAL,
  forma_pagamento  TEXT,
  confianca        REAL,
  origem           TEXT,
  observacoes      TEXT,
  alertas          TEXT NOT NULL DEFAULT '[]',
  modelo_ia        TEXT,
  criado_em        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_notas_viagem ON notas(viagem_id);
CREATE INDEX IF NOT EXISTS ix_notas_chave ON notas(chave);

-- Foto/PDF da nota. Tabela à parte para as listagens de notas não carregarem os arquivos.
CREATE TABLE IF NOT EXISTS arquivos (
  nota_id  INTEGER PRIMARY KEY REFERENCES notas(id) ON DELETE CASCADE,
  dados    BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS lancamentos (
  id          INTEGER PRIMARY KEY,
  nota_id     INTEGER NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
  viagem_id   INTEGER NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
  data        TEXT,
  categoria   TEXT NOT NULL CHECK (categoria IN ('cafe','almoco','jantar','combustivel','estacionamento','hospedagem','uber_taxi','outros')),
  descricao   TEXT,
  valor       REAL NOT NULL,
  litros      REAL,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_lanc_viagem ON lancamentos(viagem_id);

-- Cada leitura de nota por IA (custa crédito): base do teto diário por usuário.
CREATE TABLE IF NOT EXISTS leituras_ia (
  id          INTEGER PRIMARY KEY,
  usuario_id  INTEGER NOT NULL,
  criado_em   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_leituras_usuario ON leituras_ia(usuario_id, criado_em);

CREATE TABLE IF NOT EXISTS config (
  chave  TEXT PRIMARY KEY,
  valor  TEXT
);
`);

// ---------- migrações de bancos criados por versões anteriores ----------
const colunas = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);

// Versão da sessão: sobe a cada troca/redefinição de senha e invalida os cookies antigos.
if (!colunas('usuarios').includes('sessao_versao')) db.exec('ALTER TABLE usuarios ADD COLUMN sessao_versao INTEGER NOT NULL DEFAULT 0');

if (!colunas('notas').includes('provedor_ia')) db.exec('ALTER TABLE notas ADD COLUMN provedor_ia TEXT');

// Arquivos que estavam na pasta uploads/ (versão anterior) passam para dentro do banco.
{
  const fs = require('fs');
  const pasta = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
  const pend = db.prepare("SELECT id, arquivo FROM notas WHERE arquivo <> ''").all();
  if (pend.length) {
    const ins = db.prepare('INSERT OR REPLACE INTO arquivos (nota_id, dados) VALUES (?, ?)');
    const limpa = db.prepare("UPDATE notas SET arquivo = '' WHERE id = ?");
    let ok = 0, faltando = 0;
    db.transaction(() => {
      for (const n of pend) {
        const f = path.join(pasta, n.arquivo);
        if (!fs.existsSync(f)) { faltando++; continue; }
        ins.run(n.id, fs.readFileSync(f));
        limpa.run(n.id);
        ok++;
      }
    })();
    console.log(`[db] migração: ${ok} arquivo(s) de nota movido(s) para o banco${faltando ? `; ${faltando} não encontrado(s) em ${pasta}` : ''}. A pasta uploads/ pode ser apagada depois de conferir.`);
  }
}

// Novas categorias: o CHECK do SQLite não se altera; a tabela é recriada com os mesmos dados.
function acrescentarCategoria(nova, depoisDe) {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'lancamentos'").get().sql;
  if (sql.includes(`'${nova}'`)) return;
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec('ALTER TABLE lancamentos RENAME TO lancamentos_antiga');
    db.exec(sql.replace(`'${depoisDe}'`, `'${depoisDe}','${nova}'`));
    db.exec('INSERT INTO lancamentos SELECT * FROM lancamentos_antiga');
    db.exec('DROP TABLE lancamentos_antiga');
    db.exec('CREATE INDEX IF NOT EXISTS ix_lanc_viagem ON lancamentos(viagem_id)');
  })();
  db.pragma('foreign_keys = ON');
  console.log(`[db] migração: categoria "${nova}" adicionada aos lançamentos.`);
}
acrescentarCategoria('hospedagem', 'estacionamento');
acrescentarCategoria('uber_taxi', 'hospedagem');

module.exports = db;
