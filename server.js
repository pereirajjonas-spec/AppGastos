'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const sharp = require('sharp');
const { abrirImagem, validarConteudo, MIMES_IMAGEM } = require('./src/extrair/imagem');
const rateLimit = require('express-rate-limit');

const db = require('./src/db');
const auth = require('./src/auth');
const { emailRedefinicao, emailBoasVindas } = require('./src/email');
const { PDFParse } = require('pdf-parse');
const { extrairNota, paraISO } = require('./src/extrair');
const { statusProvedores, provedorPadrao, PROVEDORES } = require('./src/extrair/ia');

const PORT = Number(process.env.PORT || 3100);
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const CATEGORIAS = ['cafe', 'almoco', 'jantar', 'combustivel', 'estacionamento', 'hospedagem', 'uber_taxi', 'outros'];
const HORAS_CONVITE = 72;
// Teto de leituras por IA por usuário nas últimas 24 h (0 = sem teto). O administrador não entra no teto.
const LIMITE_LEITURAS_DIA = Number(process.env.LIMITE_LEITURAS_DIA ?? 50);


const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],                       // tudo hospedado no próprio app (html2pdf em /vendor)
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'"],                         // fontes em /fonts
      imgSrc: ["'self'", 'data:', 'blob:'],
      frameSrc: ["'self'"],
      objectSrc: ["'self'"],
      upgradeInsecureRequests: null
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.get('/health', (req, res) => res.json({ ok: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ---------- utilitários ----------
const rota = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const erro = (status, msg) => Object.assign(new Error(msg), { status });
const emailValido = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));
const texto = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);

function carregarViagem(req, id) {
  const v = db.prepare('SELECT * FROM viagens WHERE id = ?').get(id);
  if (!v || (req.usuario.perfil !== 'admin' && v.usuario_id !== req.usuario.id)) throw erro(404, 'Viagem não encontrada.');
  return v;
}

/** Usuário comum só altera viagem aberta; admin altera sempre. */
function exigirEditavel(req, viagem) {
  if (viagem.status === 'fechada' && req.usuario.perfil !== 'admin') {
    throw erro(409, 'Esta viagem está fechada. Peça ao administrador para reabrir.');
  }
}

function carregarNota(req, id) {
  const n = db.prepare('SELECT * FROM notas WHERE id = ?').get(id);
  if (!n) throw erro(404, 'Nota não encontrada.');
  return { nota: n, viagem: carregarViagem(req, n.viagem_id) };
}

const notaPublica = n => ({ ...n, alertas: JSON.parse(n.alertas || '[]'), hash_arquivo: undefined });

// =====================================================================
//  AUTENTICAÇÃO
// =====================================================================
const limiteLogin = rateLimit({ windowMs: 15 * 60000, limit: 10, message: { erro: 'Muitas tentativas. Aguarde 15 minutos.' } });
const limiteEsqueci = rateLimit({ windowMs: 15 * 60000, limit: 5, message: { erro: 'Muitas solicitações. Aguarde 15 minutos.' } });

app.post('/api/auth/login', limiteLogin, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  const senhaOk = auth.confereSenha(senha, u && u.ativo ? u.senha_hash : null);   // sempre gasta o mesmo tempo
  if (!u || !u.ativo || !senhaOk) {
    return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
  }
  db.prepare("UPDATE usuarios SET ultimo_login = datetime('now','localtime') WHERE id = ?").run(u.id);
  auth.emitirSessao(res, u);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => { auth.encerrarSessao(res); res.json({ ok: true }); });

app.get('/api/auth/eu', auth.exigirLogin, (req, res) => res.json(req.usuario));

// Resposta sempre igual, exista ou não o e-mail: não revela quem tem cadastro.
app.post('/api/auth/esqueci', limiteEsqueci, rota(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM usuarios WHERE email = ? AND ativo = 1').get(email);
  if (u) {
    const token = auth.criarTokenSenha(u.id, 1);
    emailRedefinicao(u, `${APP_URL}/redefinir.html?token=${token}`)
      .catch(e => console.error('[email] falha ao enviar redefinição:', e.message));
  }
  res.json({ ok: true });
}));

app.get('/api/auth/token', (req, res) => {
  const id = auth.verificarTokenSenha(req.query.token);
  if (!id) return res.status(400).json({ erro: 'Link inválido ou expirado. Peça um novo em "Esqueci minha senha".' });
  const u = db.prepare('SELECT nome, email FROM usuarios WHERE id = ?').get(id);
  res.json(u);
});

app.post('/api/auth/redefinir', limiteEsqueci, (req, res) => {
  const id = auth.verificarTokenSenha(req.body.token);
  if (!id) return res.status(400).json({ erro: 'Link inválido ou expirado. Peça um novo em "Esqueci minha senha".' });
  const problema = auth.validarSenha(req.body.senha);
  if (problema) return res.status(400).json({ erro: problema });
  db.prepare('UPDATE usuarios SET senha_hash = ?, sessao_versao = sessao_versao + 1 WHERE id = ?').run(auth.hashSenha(req.body.senha), id);
  auth.consumirTokenSenha(req.body.token);
  res.json({ ok: true });
});

// Só tentativas com erro contam; por usuário (não por IP), para ninguém adivinhar a senha atual com uma sessão roubada.
const limiteAlterarSenha = rateLimit({ windowMs: 15 * 60000, limit: 5, skipSuccessfulRequests: true, keyGenerator: req => 'u' + req.usuario.id, message: { erro: 'Muitas tentativas. Aguarde 15 minutos.' } });

app.post('/api/auth/alterar-senha', auth.exigirLogin, limiteAlterarSenha, (req, res) => {
  const u = db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!auth.confereSenha(String(req.body.atual || ''), u.senha_hash)) return res.status(400).json({ erro: 'Senha atual incorreta.' });
  const problema = auth.validarSenha(req.body.nova);
  if (problema) return res.status(400).json({ erro: problema });
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(auth.hashSenha(req.body.nova), req.usuario.id);
  auth.emitirSessao(res, auth.renovarSessoes(req.usuario.id));   // as outras sessões deixam de valer; esta continua
  res.json({ ok: true });
});

// =====================================================================
//  ADMINISTRAÇÃO DE USUÁRIOS
// =====================================================================
const admin = express.Router();
admin.use(auth.exigirLogin, auth.exigirAdmin);

admin.get('/usuarios', (req, res) => {
  res.json(db.prepare(`SELECT id, email, nome, perfil, centro_custo, ativo, criado_em, ultimo_login,
    senha_hash IS NOT NULL AS tem_senha FROM usuarios ORDER BY nome`).all());
});

/** Cria o usuário e envia o e-mail para ele definir a senha. Se o SMTP falhar, devolve o link ao admin. */
admin.post('/usuarios', rota(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const nome = texto(req.body.nome, 120);
  if (!emailValido(email)) throw erro(400, 'Informe um e-mail válido.');
  if (!auth.dominioPermitido(email)) throw erro(400, `Use o e-mail da empresa (${process.env.EMAIL_DOMINIOS}).`);
  if (!nome) throw erro(400, 'Informe o nome.');
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) throw erro(409, 'Já existe um usuário com este e-mail.');

  const perfil = req.body.perfil === 'admin' ? 'admin' : 'usuario';
  const senha = req.body.senha ? String(req.body.senha) : null;
  if (senha) { const p = auth.validarSenha(senha); if (p) throw erro(400, p); }

  const r = db.prepare('INSERT INTO usuarios (email, nome, perfil, centro_custo, senha_hash) VALUES (?, ?, ?, ?, ?)')
    .run(email, nome, perfil, texto(req.body.centro_custo, 60), senha ? auth.hashSenha(senha) : null);
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(r.lastInsertRowid);

  let enviado = false, link = null;
  if (!senha) {
    link = `${APP_URL}/redefinir.html?token=${auth.criarTokenSenha(u.id, HORAS_CONVITE)}&novo=1`;
    try { enviado = await emailBoasVindas(u, link, HORAS_CONVITE); } catch (e) { console.error('[email]', e.message); }
  }
  res.status(201).json({ id: u.id, enviado, link: enviado ? null : link });
}));

admin.patch('/usuarios/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!u) throw erro(404, 'Usuário não encontrado.');
  const b = req.body;
  if (u.id === req.usuario.id && (b.ativo === false || b.perfil === 'usuario')) {
    throw erro(400, 'Você não pode desativar nem tirar o perfil de administrador de si mesmo.');
  }
  db.prepare('UPDATE usuarios SET nome = ?, perfil = ?, centro_custo = ?, ativo = ? WHERE id = ?').run(
    texto(b.nome, 120) || u.nome,
    b.perfil ? (b.perfil === 'admin' ? 'admin' : 'usuario') : u.perfil,
    b.centro_custo !== undefined ? texto(b.centro_custo, 60) : u.centro_custo,
    b.ativo !== undefined ? (b.ativo ? 1 : 0) : u.ativo,
    u.id
  );
  res.json({ ok: true });
});

admin.post('/usuarios/:id/enviar-senha', rota(async (req, res) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!u) throw erro(404, 'Usuário não encontrado.');
  const link = `${APP_URL}/redefinir.html?token=${auth.criarTokenSenha(u.id, HORAS_CONVITE)}`;
  let enviado = false;
  try { enviado = await emailBoasVindas(u, link, HORAS_CONVITE); } catch (e) { console.error('[email]', e.message); }
  res.json({ enviado, link: enviado ? null : link });
}));

/** Provedor de IA usado na leitura das notas (Claude ou Kimi). */
admin.get('/ia', (req, res) => res.json({ provedor: provedorPadrao(), provedores: statusProvedores() }));

admin.put('/ia', (req, res) => {
  const p = req.body.provedor;
  if (!PROVEDORES[p]) throw erro(400, 'Provedor inválido.');
  if (!statusProvedores().find(x => x.id === p).configurado) throw erro(400, `Configure a chave ${PROVEDORES[p].envChave} no .env antes de usar este provedor.`);
  db.prepare("INSERT INTO config (chave, valor) VALUES ('ia_provedor', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(p);
  res.json({ ok: true });
});

app.use('/api/admin', admin);

// =====================================================================
//  VIAGENS
// =====================================================================
const api = express.Router();
api.use(auth.exigirLogin);

api.get('/ia', (req, res) => res.json({ provedor: provedorPadrao(), provedores: statusProvedores() }));

api.get('/viagens', (req, res) => {
  const ehAdmin = req.usuario.perfil === 'admin';
  const filtros = [], args = [];
  if (!ehAdmin) { filtros.push('v.usuario_id = ?'); args.push(req.usuario.id); }
  else if (req.query.usuario) { filtros.push('v.usuario_id = ?'); args.push(req.query.usuario); }
  if (req.query.status) { filtros.push('v.status = ?'); args.push(req.query.status); }
  const where = filtros.length ? 'WHERE ' + filtros.join(' AND ') : '';
  res.json(db.prepare(`
    SELECT v.*, u.nome AS usuario_nome,
      (SELECT COUNT(*) FROM notas n WHERE n.viagem_id = v.id) AS qtd_notas,
      (SELECT COALESCE(SUM(valor), 0) FROM lancamentos l WHERE l.viagem_id = v.id) AS total
    FROM viagens v JOIN usuarios u ON u.id = v.usuario_id
    ${where} ORDER BY COALESCE(v.data_inicio, v.criado_em) DESC, v.id DESC`).all(...args));
});

function dadosViagem(b, atual = {}) {
  const titulo = texto(b.titulo, 120) ?? atual.titulo;
  if (!titulo) throw erro(400, 'Informe um título para a viagem.');
  const ini = b.data_inicio !== undefined ? paraISO(b.data_inicio) : atual.data_inicio;
  const fim = b.data_fim !== undefined ? paraISO(b.data_fim) : atual.data_fim;
  if (ini && fim && fim < ini) throw erro(400, 'A data final é anterior à data inicial.');
  return {
    titulo,
    destino: b.destino !== undefined ? texto(b.destino, 120) : atual.destino,
    motivo: b.motivo !== undefined ? texto(b.motivo, 500) : atual.motivo,
    centro_custo: b.centro_custo !== undefined ? texto(b.centro_custo, 60) : atual.centro_custo,
    data_inicio: ini || null,
    data_fim: fim || null,
    adiantamento: b.adiantamento !== undefined ? Math.max(0, Number(b.adiantamento) || 0) : (atual.adiantamento || 0)
  };
}

api.post('/viagens', (req, res) => {
  const d = dadosViagem(req.body, { centro_custo: req.usuario.centro_custo });
  const r = db.prepare(`INSERT INTO viagens (usuario_id, titulo, destino, motivo, centro_custo, data_inicio, data_fim, adiantamento)
    VALUES (@usuario_id, @titulo, @destino, @motivo, @centro_custo, @data_inicio, @data_fim, @adiantamento)`)
    .run({ ...d, usuario_id: req.usuario.id });
  res.status(201).json({ id: r.lastInsertRowid });
});

/** Viagem completa: usada na tela da viagem e no relatório. */
api.get('/viagens/:id', (req, res) => {
  const v = carregarViagem(req, req.params.id);
  const usuario = db.prepare('SELECT nome, email, centro_custo FROM usuarios WHERE id = ?').get(v.usuario_id);
  const notas = db.prepare('SELECT * FROM notas WHERE viagem_id = ? ORDER BY data_emissao, hora_emissao, id').all(v.id).map(notaPublica);
  const lancamentos = db.prepare(`SELECT l.*, n.estabelecimento, n.cidade, n.uf, n.numero AS nota_numero, n.tipo_documento, n.hora_emissao
    FROM lancamentos l JOIN notas n ON n.id = l.nota_id WHERE l.viagem_id = ? ORDER BY l.data, n.hora_emissao, l.id`).all(v.id);
  res.json({ viagem: v, usuario, notas, lancamentos });
});

api.patch('/viagens/:id', (req, res) => {
  const v = carregarViagem(req, req.params.id);
  // Fechar a viagem é permitido ao dono; reabrir, só ao admin.
  if (req.body.status) {
    if (req.body.status === 'aberta' && v.status === 'fechada' && req.usuario.perfil !== 'admin') {
      throw erro(403, 'Somente o administrador pode reabrir uma viagem.');
    }
    db.prepare('UPDATE viagens SET status = ? WHERE id = ?').run(req.body.status === 'fechada' ? 'fechada' : 'aberta', v.id);
    return res.json({ ok: true });
  }
  exigirEditavel(req, v);
  const d = dadosViagem(req.body, v);
  db.prepare(`UPDATE viagens SET titulo=@titulo, destino=@destino, motivo=@motivo, centro_custo=@centro_custo,
    data_inicio=@data_inicio, data_fim=@data_fim, adiantamento=@adiantamento WHERE id=@id`).run({ ...d, id: v.id });
  res.json({ ok: true });
});

api.delete('/viagens/:id', (req, res) => {
  const v = carregarViagem(req, req.params.id);
  exigirEditavel(req, v);
  db.prepare('DELETE FROM viagens WHERE id = ?').run(v.id);   // notas, arquivos e lançamentos saem em cascata
  res.json({ ok: true });
});

// =====================================================================
//  NOTAS FISCAIS
// =====================================================================
// SVG também vem como "image/svg+xml": por isso o tipo só vale como XML de NF-e se não for imagem.
const ehXml = f => !String(f.mimetype).startsWith('image/') && (/xml/i.test(f.mimetype) || /\.xml$/i.test(f.originalname || ''));
const mimeDoArquivo = f => (ehXml(f) ? 'application/xml' : f.mimetype);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, f, cb) => {
    // Só formatos de foto de nota (sem SVG, TIFF, ícones...). O conteúdo real é conferido depois (validarConteudo).
    const ok = f.mimetype === 'application/pdf' || MIMES_IMAGEM.includes(f.mimetype) || ehXml(f);
    cb(ok ? null : erro(400, 'Envie uma foto (JPG, PNG ou WebP), um PDF ou o XML da nota.'), ok);
  }
});
const limiteUpload = rateLimit({
  windowMs: 60 * 60000, limit: 120,
  keyGenerator: req => String(req.usuario.id),
  message: { erro: 'Limite de envios por hora atingido. Tente mais tarde.' }
});

/** Conta uma leitura por IA (custa crédito) e recusa quando o usuário passou do teto das últimas 24 h. */
function consumirLeitura(req) {
  if (!LIMITE_LEITURAS_DIA || req.usuario.perfil === 'admin') return;
  const agora = Date.now(), desde = agora - 24 * 3600000;
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM leituras_ia WHERE usuario_id = ? AND criado_em > ?').get(req.usuario.id, desde);
  if (n >= LIMITE_LEITURAS_DIA) {
    throw erro(429, `Você atingiu o limite de ${LIMITE_LEITURAS_DIA} leituras de nota por dia. Tente amanhã ou peça ao administrador.`);
  }
  db.prepare('INSERT INTO leituras_ia (usuario_id, criado_em) VALUES (?, ?)').run(req.usuario.id, agora);
  db.prepare('DELETE FROM leituras_ia WHERE criado_em < ?').run(agora - 7 * 24 * 3600000);
}

/** Prepara o arquivo para o banco. Foto vira JPEG de até 2000px (legível e leve); PDF fica como veio. */
async function prepararArquivo(buffer, mimetype) {
  if (mimetype === 'application/pdf' || mimetype === 'application/xml') return { dados: buffer, mimetype };
  const dados = await abrirImagem(buffer).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 }).toBuffer();
  return { dados, mimetype: 'image/jpeg' };
}

const arquivoDaNota = id => db.prepare('SELECT dados FROM arquivos WHERE nota_id = ?').get(id)?.dados;

api.post('/viagens/:id/notas', limiteUpload, upload.single('arquivo'), rota(async (req, res) => {
  const v = carregarViagem(req, req.params.id);
  exigirEditavel(req, v);
  if (!req.file) throw erro(400, 'Nenhum arquivo recebido.');
  const invalido = await validarConteudo(req.file.buffer, mimeDoArquivo(req.file));
  if (invalido) throw erro(400, invalido);

  const hash =crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  const mesmoArquivo = db.prepare('SELECT n.id, v.titulo FROM notas n JOIN viagens v ON v.id = n.viagem_id WHERE n.hash_arquivo = ?').get(hash);
  if (mesmoArquivo) throw erro(409, `Este arquivo já foi lançado (viagem "${mesmoArquivo.titulo}").`);

  consumirLeitura(req);
  let lido;
  try {
    lido = await extrairNota(req.file.buffer, mimeDoArquivo(req.file));
  } catch (e) {
    console.error('[extração]', e);
    throw erro(422, 'Não consegui ler esta nota. Tente uma foto mais nítida, com a nota inteira e sem reflexo. (' + e.message + ')');
  }
  const { nota, lancamentos, alertas } = lido;

  if (nota.chave && nota.chave.length === 44) {
    const dup = db.prepare(`SELECT n.id, v.titulo, u.nome FROM notas n JOIN viagens v ON v.id = n.viagem_id
      JOIN usuarios u ON u.id = n.usuario_id WHERE n.chave = ?`).get(nota.chave);
    if (dup) throw erro(409, `Esta nota fiscal já foi lançada por ${dup.nome} na viagem "${dup.titulo}".`);
  }
  if (nota.data_emissao && v.data_inicio && v.data_fim && (nota.data_emissao < v.data_inicio || nota.data_emissao > v.data_fim)) {
    alertas.push('A data da nota está fora do período da viagem.');
  }

  const arq = await prepararArquivo(req.file.buffer, mimeDoArquivo(req.file));
  const salvar = db.transaction(() => {
    const r = db.prepare(`INSERT INTO notas (viagem_id, usuario_id, arquivo, mimetype, nome_original, hash_arquivo,
      tipo_documento, numero, serie, chave, data_emissao, hora_emissao, cnpj, estabelecimento, cidade, uf,
      valor_total, forma_pagamento, confianca, origem, observacoes, alertas, modelo_ia, provedor_ia)
      VALUES (@viagem_id, @usuario_id, @arquivo, @mimetype, @nome_original, @hash_arquivo,
      @tipo_documento, @numero, @serie, @chave, @data_emissao, @hora_emissao, @cnpj, @estabelecimento, @cidade, @uf,
      @valor_total, @forma_pagamento, @confianca, @origem, @observacoes, @alertas, @modelo_ia, @provedor_ia)`).run({
      ...nota,
      viagem_id: v.id, usuario_id: v.usuario_id,
      arquivo: '', mimetype: arq.mimetype, nome_original: texto(req.file.originalname, 200), hash_arquivo: hash,
      alertas: JSON.stringify(alertas)
    });
    db.prepare('INSERT INTO arquivos (nota_id, dados) VALUES (?, ?)').run(r.lastInsertRowid, arq.dados);
    const ins = db.prepare(`INSERT INTO lancamentos (nota_id, viagem_id, usuario_id, data, categoria, descricao, valor, litros)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const l of lancamentos) ins.run(r.lastInsertRowid, v.id, v.usuario_id, nota.data_emissao, l.categoria, l.descricao, l.valor, l.litros);
    return r.lastInsertRowid;
  });
  const notaId = salvar();

  res.status(201).json({
    nota: notaPublica(db.prepare('SELECT * FROM notas WHERE id = ?').get(notaId)),
    lancamentos: db.prepare('SELECT * FROM lancamentos WHERE nota_id = ? ORDER BY id').all(notaId)
  });
}));

/** Arquivo original da nota (para visualizar, imprimir ou baixar). */
api.get('/notas/:id/arquivo', (req, res) => {
  const { nota } = carregarNota(req, req.params.id);
  const ext = nota.mimetype === 'application/pdf' ? 'pdf' : nota.mimetype === 'application/xml' ? 'xml' : 'jpg';
  const nome = `nota-${nota.numero || nota.id}-${(nota.estabelecimento || 'despesa').replace(/[^\w]+/g, '_').slice(0, 40)}.${ext}`;
  // XML enviado por usuário nunca é servido como XML renderizável no mesmo domínio: na tela vai como texto puro.
  res.setHeader('Content-Type', nota.mimetype === 'application/xml' ? (req.query.download ? 'application/xml' : 'text/plain; charset=utf-8') : nota.mimetype);
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${nome}"`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  const dados = arquivoDaNota(nota.id);
  if (!dados) throw erro(404, 'Arquivo da nota não encontrado.');
  res.send(dados);
});

/** Lê a nota de novo (opcionalmente com outro provedor) e substitui os lançamentos dela. */
api.post('/notas/:id/reler', limiteUpload, rota(async (req, res) => {
  const { nota, viagem } = carregarNota(req, req.params.id);
  exigirEditavel(req, viagem);
  const provedor = PROVEDORES[req.body.provedor] ? req.body.provedor : undefined;
  const buffer = arquivoDaNota(nota.id);
  if (!buffer) throw erro(404, 'Arquivo da nota não encontrado.');

  consumirLeitura(req);
  let lido;
  try { lido = await extrairNota(buffer, nota.mimetype, { provedor }); } catch (e) {
    console.error('[extração]', e);
    throw erro(422, 'Não consegui ler esta nota novamente. (' + e.message + ')');
  }
  const { nota: n, lancamentos, alertas } = lido;
  if (n.chave && n.chave.length === 44) {
    const dup = db.prepare('SELECT v.titulo FROM notas x JOIN viagens v ON v.id = x.viagem_id WHERE x.chave = ? AND x.id <> ?').get(n.chave, nota.id);
    if (dup) alertas.push(`Esta chave de acesso também aparece em outra nota (viagem "${dup.titulo}").`);
  }
  if (n.data_emissao && viagem.data_inicio && viagem.data_fim && (n.data_emissao < viagem.data_inicio || n.data_emissao > viagem.data_fim)) {
    alertas.push('A data da nota está fora do período da viagem.');
  }

  db.transaction(() => {
    db.prepare(`UPDATE notas SET tipo_documento=@tipo_documento, numero=@numero, serie=@serie, chave=@chave,
      data_emissao=@data_emissao, hora_emissao=@hora_emissao, cnpj=@cnpj, estabelecimento=@estabelecimento, cidade=@cidade,
      uf=@uf, valor_total=@valor_total, forma_pagamento=@forma_pagamento, confianca=@confianca, origem=@origem,
      observacoes=@observacoes, alertas=@alertas, modelo_ia=@modelo_ia, provedor_ia=@provedor_ia WHERE id=@id`)
      .run({ ...n, alertas: JSON.stringify(alertas), id: nota.id });
    db.prepare('DELETE FROM lancamentos WHERE nota_id = ?').run(nota.id);
    const ins = db.prepare(`INSERT INTO lancamentos (nota_id, viagem_id, usuario_id, data, categoria, descricao, valor, litros)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const l of lancamentos) ins.run(nota.id, viagem.id, viagem.usuario_id, n.data_emissao, l.categoria, l.descricao, l.valor, l.litros);
  })();

  res.json({
    nota: notaPublica(db.prepare('SELECT * FROM notas WHERE id = ?').get(nota.id)),
    lancamentos: db.prepare('SELECT * FROM lancamentos WHERE nota_id = ? ORDER BY id').all(nota.id)
  });
}));

// Renderizar página de PDF usa CPU: teto por usuário (um relatório grande usa dezenas de chamadas; o navegador guarda em cache).
const limitePdf = rateLimit({ windowMs: 60 * 60000, limit: 600, keyGenerator: req => 'u' + req.usuario.id, message: { erro: 'Muitas páginas pedidas. Tente mais tarde.' } });

/** Páginas de um comprovante em PDF como imagem (usado no relatório, que precisa mostrar a nota em qualquer formato). */
const MAX_PAGINAS_PDF = 6;

api.get('/notas/:id/paginas', limitePdf, rota(async (req, res) => {
  const { nota } = carregarNota(req, req.params.id);
  if (nota.mimetype !== 'application/pdf') return res.json({ total: 0 });
  const dados = arquivoDaNota(nota.id);
  if (!dados) throw erro(404, 'Arquivo da nota não encontrado.');
  const leitor = new PDFParse({ data: new Uint8Array(dados) });
  try {
    const info = await leitor.getInfo();
    res.json({ total: Math.min(info.total, MAX_PAGINAS_PDF), paginas_no_arquivo: info.total });
  } finally { leitor.destroy().catch(() => {}); }
}));

api.get('/notas/:id/pagina/:n', limitePdf, rota(async (req, res) => {
  const { nota } = carregarNota(req, req.params.id);
  const n = Number(req.params.n);
  if (nota.mimetype !== 'application/pdf' || !(n >= 1 && n <= MAX_PAGINAS_PDF)) throw erro(404, 'Página não encontrada.');
  const dados = arquivoDaNota(nota.id);
  if (!dados) throw erro(404, 'Arquivo da nota não encontrado.');
  const leitor = new PDFParse({ data: new Uint8Array(dados) });
  try {
    const r = await leitor.getScreenshot({ partial: [n], desiredWidth: 1100, imageDataUrl: false, imageBuffer: true });
    if (!r.pages.length) throw erro(404, 'Página não encontrada.');
    const jpg = await sharp(Buffer.from(r.pages[0].data)).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(jpg);
  } finally { leitor.destroy().catch(() => {}); }
}));

api.patch('/notas/:id', (req, res) => {
  const { nota, viagem } = carregarNota(req, req.params.id);
  exigirEditavel(req, viagem);
  const b = req.body;
  const data = b.data_emissao !== undefined ? paraISO(b.data_emissao) : nota.data_emissao;
  db.prepare('UPDATE notas SET estabelecimento = ?, data_emissao = ?, forma_pagamento = ? WHERE id = ?').run(
    b.estabelecimento !== undefined ? texto(b.estabelecimento, 200) : nota.estabelecimento,
    data,
    b.forma_pagamento !== undefined ? texto(b.forma_pagamento, 60) : nota.forma_pagamento,
    nota.id);
  if (data !== nota.data_emissao) db.prepare('UPDATE lancamentos SET data = ? WHERE nota_id = ?').run(data, nota.id);
  res.json({ ok: true });
});

api.delete('/notas/:id', (req, res) => {
  const { nota, viagem } = carregarNota(req, req.params.id);
  exigirEditavel(req, viagem);
  db.prepare('DELETE FROM notas WHERE id = ?').run(nota.id);   // o arquivo sai junto (cascata)
  res.json({ ok: true });
});

// =====================================================================
//  LANÇAMENTOS
// =====================================================================
api.get('/lancamentos', (req, res) => {
  const f = [], a = [];
  if (req.usuario.perfil !== 'admin') { f.push('l.usuario_id = ?'); a.push(req.usuario.id); }
  else if (req.query.usuario) { f.push('l.usuario_id = ?'); a.push(req.query.usuario); }
  if (req.query.viagem) { f.push('l.viagem_id = ?'); a.push(req.query.viagem); }
  if (CATEGORIAS.includes(req.query.categoria)) { f.push('l.categoria = ?'); a.push(req.query.categoria); }
  if (req.query.de) { f.push('l.data >= ?'); a.push(paraISO(req.query.de)); }
  if (req.query.ate) { f.push('l.data <= ?'); a.push(paraISO(req.query.ate)); }
  res.json(db.prepare(`
    SELECT l.*, n.estabelecimento, n.cidade, n.uf, n.numero AS nota_numero, n.tipo_documento, n.hora_emissao,
      n.mimetype, v.titulo AS viagem_titulo, v.status AS viagem_status, u.nome AS usuario_nome
    FROM lancamentos l JOIN notas n ON n.id = l.nota_id JOIN viagens v ON v.id = l.viagem_id JOIN usuarios u ON u.id = l.usuario_id
    ${f.length ? 'WHERE ' + f.join(' AND ') : ''} ORDER BY l.data DESC, n.hora_emissao DESC, l.id DESC LIMIT 2000`).all(...a));
});

function carregarLancamento(req, id) {
  const l = db.prepare('SELECT * FROM lancamentos WHERE id = ?').get(id);
  if (!l) throw erro(404, 'Lançamento não encontrado.');
  const viagem = carregarViagem(req, l.viagem_id);
  exigirEditavel(req, viagem);
  return l;
}

function dadosLancamento(b, atual = {}) {
  const categoria = b.categoria ?? atual.categoria;
  if (!CATEGORIAS.includes(categoria)) throw erro(400, 'Categoria inválida.');
  const valor = b.valor !== undefined ? Math.round(Number(String(b.valor).replace(',', '.')) * 100) / 100 : atual.valor;
  if (!(valor > 0)) throw erro(400, 'Informe um valor maior que zero.');
  return {
    categoria, valor,
    descricao: b.descricao !== undefined ? texto(b.descricao, 120) : atual.descricao,
    litros: b.litros !== undefined ? (Number(b.litros) || null) : (atual.litros ?? null)
  };
}

api.patch('/lancamentos/:id', (req, res) => {
  const l = carregarLancamento(req, req.params.id);
  const d = dadosLancamento(req.body, l);
  db.prepare('UPDATE lancamentos SET categoria=@categoria, descricao=@descricao, valor=@valor, litros=@litros WHERE id=@id').run({ ...d, id: l.id });
  res.json(db.prepare('SELECT * FROM lancamentos WHERE id = ?').get(l.id));
});

/** Novo lançamento numa nota já existente (ex.: separar um item que a IA juntou). */
api.post('/notas/:id/lancamentos', (req, res) => {
  const { nota, viagem } = carregarNota(req, req.params.id);
  exigirEditavel(req, viagem);
  const d = dadosLancamento(req.body);
  const r = db.prepare(`INSERT INTO lancamentos (nota_id, viagem_id, usuario_id, data, categoria, descricao, valor, litros)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(nota.id, viagem.id, viagem.usuario_id, nota.data_emissao, d.categoria, d.descricao, d.valor, d.litros);
  res.status(201).json(db.prepare('SELECT * FROM lancamentos WHERE id = ?').get(r.lastInsertRowid));
});

api.delete('/lancamentos/:id', (req, res) => {
  const l = carregarLancamento(req, req.params.id);
  db.prepare('DELETE FROM lancamentos WHERE id = ?').run(l.id);
  res.json({ ok: true });
});

app.use('/api', api);

// ---------- estáticos ----------
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---------- erros ----------
app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ erro: err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo maior que 15 MB.' : err.message });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ erro: status >= 500 ? 'Erro interno. Tente novamente.' : err.message });
});

// Primeiro administrador via variáveis de ambiente (hospedagens sem terminal, como o plano gratuito do Render).
// Só age quando ainda não existe nenhum administrador; depois disso as variáveis são ignoradas.
(function criarAdminInicial() {
  const { ADMIN_EMAIL, ADMIN_NOME, ADMIN_SENHA } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_SENHA || db.prepare("SELECT 1 FROM usuarios WHERE perfil = 'admin'").get()) return;
  const problema = auth.validarSenha(ADMIN_SENHA);
  if (problema) return console.warn('AVISO: ADMIN_SENHA inválida — ' + problema);
  db.prepare("INSERT OR IGNORE INTO usuarios (email, nome, perfil, senha_hash) VALUES (?, ?, 'admin', ?)")
    .run(ADMIN_EMAIL.trim().toLowerCase(), ADMIN_NOME || 'Administrador', auth.hashSenha(ADMIN_SENHA));
  console.log('Administrador inicial criado: ' + ADMIN_EMAIL);
})();

app.listen(PORT, () => {
  console.log(`Despesas de Viagem — http://localhost:${PORT}  (APP_URL=${APP_URL})`);
  const ias = statusProvedores();
  console.log('IA: ' + ias.map(p => `${p.nome} [${p.modelo}] ${p.configurado ? 'ok' : 'sem chave'}`).join(' · ') + ` — principal: ${provedorPadrao()}`);
  if (!ias.some(p => p.configurado)) console.warn('AVISO: nenhuma chave de IA (ANTHROPIC_API_KEY / MOONSHOT_API_KEY) — a leitura de notas não vai funcionar.');
  if (!process.env.SMTP_HOST) console.warn('AVISO: SMTP não configurado — os links de senha serão mostrados no console/tela do admin.');
  if (!db.prepare("SELECT 1 FROM usuarios WHERE perfil = 'admin'").get()) {
    console.warn('AVISO: nenhum administrador cadastrado. Rode:  npm run criar-admin -- email@empresa.com.br "Nome"');
  }
});
