'use strict';
/**
 * Orquestra a leitura: QR Code primeiro (determinístico), IA depois.
 * O que vem da chave de acesso válida sempre vence a IA.
 * (Adaptado de "Acerto viagem/bot-notas/src/extrair.js".)
 */

const { lerQrCode } = require('./qrcode');
const { decodificarChave, extrairChaveDeTexto, extrairChaveDeTextoPdf, validarChave } = require('./chave');
const { extrairComIA, classificarItens, CATEGORIAS } = require('./ia');
const { lerXmlNFe } = require('./xml');

const FORMAS = [
  [/pix/i, 'PIX'],
  [/(credito|crédito|cred\b)/i, 'Cartão de Crédito'],
  [/(debito|débito|deb\b|maestro)/i, 'Cartão de Débito'],
  [/(dinheiro|especie|espécie)/i, 'Dinheiro'],
  [/(vale.?refei|ticket refei|alelo refei|sodexo refei)/i, 'Vale Refeição'],
  [/(vale.?aliment|ticket aliment)/i, 'Vale Alimentação'],
  [/(combust|ticket car|ticket log|valecard|goodcard)/i, 'Cartão Combustível'],
  [/boleto/i, 'Boleto'],
  [/(prazo|faturado|duplicata)/i, 'A Prazo'],
  [/(cartao|cartão|card)/i, 'Cartão']
];

function normalizarFormaPagamento(v) {
  if (!v) return '';
  for (const [re, nome] of FORMAS) if (re.test(v)) return nome;
  return String(v).trim();
}

function arred(n) { return Math.round(Number(n) * 100) / 100; }

/** DD/MM/AAAA (ou AAAA-MM-DD) -> AAAA-MM-DD */
function paraISO(v) {
  if (!v) return null;
  const s = String(v);
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (!m) return null;
  const ano = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function soDigitos(v) { return String(v || '').replace(/\D/g, ''); }
function semZeros(v) { const d = soDigitos(v); return d ? String(Number(d)) : ''; }
function limpar(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return ['null', 'undefined', 'N/A'].includes(s) ? '' : s;
}

// Texto de PDF que parece mesmo uma nota: tamanho mínimo e ao menos um valor com vírgula decimal.
const TEXTO_UTIL = /^(?=[\s\S]{150,})(?=[\s\S]*\d+,\d{2})[\s\S]*$/;

/** Texto de um PDF (DANFE gerado pelo emissor tem texto; PDF escaneado volta vazio). */
async function textoDoPdf(buffer) {
  const { PDFParse } = require('pdf-parse');
  const leitor = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const r = await Promise.race([
      leitor.getText(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), 20000))
    ]);
    return r.text || '';
  } finally {
    leitor.destroy().catch(() => {});
  }
}

/** Consistências comuns a todas as formas de leitura. */
function conferir(nota, lancamentos, alertas, base) {
  const soma = arred(lancamentos.reduce((s, l) => s + l.valor, 0));
  if (nota.valor_total && Math.abs(soma - nota.valor_total) > 0.05) {
    alertas.push(`Soma dos lançamentos (R$ ${soma.toFixed(2)}) difere do total da nota (R$ ${nota.valor_total.toFixed(2)}).`);
  }
  if (!nota.valor_total) alertas.push('Valor total não identificado — confira.');
  if (!nota.data_emissao) alertas.push('Data de emissão não identificada.');
  if (!nota.estabelecimento) alertas.push('Estabelecimento não identificado.');
  if (nota.chave && !validarChave(nota.chave)) {
    alertas.push('A chave de acesso lida não é válida (dígito verificador) — confira na nota.');
  }
  if (nota.confianca !== null && nota.confianca < 0.6) {
    alertas.push(`Leitura com baixa confiança (${Math.round(nota.confianca * 100)}%) — confira.`);
  }
  if (base && nota.data_emissao) {
    const [ano, mes] = nota.data_emissao.split('-').map(Number);
    if (ano !== base.anoEmissao || mes !== base.mesEmissao) {
      alertas.push(`Data lida (${nota.data_emissao}) não bate com a competência da chave (${base.competencia}).`);
    }
  }
}

const normalizarLancamentos = arr => (arr || [])
  .filter(l => CATEGORIAS.includes(l.categoria) && Number(l.valor) > 0)
  .map(l => ({
    categoria: l.categoria,
    descricao: limpar(l.descricao).slice(0, 120),
    valor: arred(l.valor),
    litros: l.litros == null ? null : Number(l.litros)
  }));

/** XML da NF-e: dados exatos do documento; a IA só classifica os itens por categoria. */
async function extrairDeXml(buffer, opts) {
  const { nota, itens, alertas } = lerXmlNFe(buffer);
  const base = nota.chave.length === 44 ? decodificarChave(nota.chave) : null;
  let lancamentos = [];
  try {
    const ia = await classificarItens(nota, itens, { provedor: opts.provedor });
    lancamentos = normalizarLancamentos(ia.dados.lancamentos);
    nota.modelo_ia = ia.modelo;
    nota.provedor_ia = ia.provedor;
    if (ia.usouAlternativa) alertas.push(`O provedor de IA principal falhou; os itens foram classificados pelo ${ia.provedor === 'kimi' ? 'Kimi' : 'Claude'}.`);
  } catch (e) {
    alertas.push('Não foi possível classificar os itens pela IA (' + e.message + '). Lançado como "Outros" — revise a categoria.');
  }
  if (!lancamentos.length && nota.valor_total) {
    lancamentos = [{ categoria: 'outros', descricao: nota.estabelecimento || 'Despesa', valor: nota.valor_total, litros: null }];
  }
  delete nota.destinatario;
  conferir(nota, lancamentos, alertas, base);
  return { nota, lancamentos, alertas };
}

/**
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @param {{provedor?: string}} opts provedor força 'anthropic' ou 'kimi'
 * @returns {Promise<object>} nota normalizada + lancamentos + alertas
 */
async function extrairNota(buffer, mimetype, opts = {}) {
  if (mimetype === 'application/xml') return extrairDeXml(buffer, opts);
  const alertas = [];
  let qr = null;
  let dadosChave = null;

  if (mimetype.startsWith('image/')) {
    try { qr = await lerQrCode(buffer); } catch (e) { alertas.push('Falha ao ler o QR Code: ' + e.message); }
    if (qr && qr.chave) {
      dadosChave = decodificarChave(qr.chave);
      if (dadosChave && !dadosChave.chaveValida) alertas.push('Chave do QR Code não passou no dígito verificador.');
    }
  }

  let origemChave = 'QR';
  let textoPdf = '';
  if (mimetype === 'application/pdf') {
    try {
      textoPdf = await textoDoPdf(buffer);
      const chavePdf = extrairChaveDeTextoPdf(textoPdf);
      if (chavePdf) { dadosChave = decodificarChave(chavePdf); origemChave = 'PDF'; }
    } catch (e) { /* PDF escaneado ou ilegível: segue só com a IA */ }
  }

  const dicaQR = dadosChave && [
    `chave_acesso = ${dadosChave.chave}`,
    `tipo_documento = ${dadosChave.tipoDocumento}`,
    `numero = ${dadosChave.numero}`,
    `serie = ${dadosChave.serie}`,
    `cnpj = ${dadosChave.cnpj}`,
    `uf = ${dadosChave.uf}`,
    `mês/ano de emissão = ${dadosChave.competencia}`
  ].join('\n');

  // PDF com texto (DANFE do emissor): a IA lê o texto, sem receber o PDF inteiro. PDF escaneado segue como PDF.
  const texto = !opts.pdfInteiro && TEXTO_UTIL.test(textoPdf) && textoPdf.length <= 60000 ? textoPdf : '';
  const ia = await extrairComIA(buffer, mimetype, { dicaQR, provedor: opts.provedor, texto });
  if (ia.usouAlternativa) alertas.push(`O provedor de IA principal falhou; a nota foi lida pelo ${ia.provedor === 'kimi' ? 'Kimi' : 'Claude'}.`);
  const d = ia.dados;

  const chaveIA = extrairChaveDeTexto(d.chave_acesso);
  const chave = (dadosChave && dadosChave.chave) || chaveIA || '';
  const base = dadosChave || (chave ? decodificarChave(chave) : null);
  if (dadosChave && chaveIA && chaveIA !== dadosChave.chave) {
    alertas.push('A chave lida pela IA difere da lida no documento; prevaleceu a do documento.');
  }

  const nota = {
    tipo_documento: (base && base.tipoDocumento) || limpar(d.tipo_documento) || 'Recibo',
    numero: (base && base.numero) || semZeros(d.numero),
    serie: (base && base.serie) || semZeros(d.serie),
    chave,
    data_emissao: paraISO(d.data_emissao),
    hora_emissao: limpar(d.hora_emissao) || null,
    cnpj: (base && base.cnpj) || soDigitos(d.cnpj),
    estabelecimento: limpar(d.estabelecimento),
    cidade: limpar(d.cidade),
    uf: (limpar(d.uf) || (base && base.uf) || '').toUpperCase().slice(0, 2),
    valor_total: d.valor_total == null ? null : arred(d.valor_total),
    forma_pagamento: normalizarFormaPagamento(limpar(d.forma_pagamento)),
    confianca: typeof d.confianca === 'number' ? d.confianca : null,
    origem: dadosChave ? `${origemChave} + IA` : 'IA',
    observacoes: limpar(d.observacoes),
    modelo_ia: ia.modelo,
    provedor_ia: ia.provedor
  };

  let lancamentos = normalizarLancamentos(d.lancamentos);
  if (!lancamentos.length && nota.valor_total) {
    lancamentos = [{ categoria: 'outros', descricao: nota.estabelecimento || 'Despesa', valor: nota.valor_total, litros: null }];
    alertas.push('A IA não separou os itens; lançado como "Outros" — revise a categoria.');
  }

  conferir(nota, lancamentos, alertas, base);
  return { nota, lancamentos, alertas, uso: ia.uso, leitura: texto ? 'texto' : mimetype === 'application/pdf' ? 'pdf inteiro' : 'imagem' };
}

module.exports = { extrairNota, paraISO };
