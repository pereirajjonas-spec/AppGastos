'use strict';
/**
 * Leitura do XML da NF-e (modelo 55) e da NFC-e (modelo 65), nfeProc ou NFe avulsa.
 * Os dados vêm exatos do documento: sem OCR e sem IA. Só a classificação dos itens
 * em categorias da viagem é feita depois (src/extrair/ia.js -> classificarItens).
 */

const { XMLParser } = require('fast-xml-parser');
const { decodificarChave, MODELOS } = require('./chave');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,          // mantém "000123" e "0.50" como texto
  processEntities: true,
  htmlEntities: false
});

const lista = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
const num = v => (v == null || v === '' ? 0 : Number(v));
const arred = n => Math.round(n * 100) / 100;

/** Código tPag da NF-e -> texto. */
const FORMAS = {
  '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de Crédito', '04': 'Cartão de Débito',
  '05': 'Crédito Loja', '10': 'Vale Alimentação', '11': 'Vale Refeição', '12': 'Vale Presente',
  '13': 'Vale Combustível', '15': 'Boleto', '16': 'Depósito', '17': 'PIX', '18': 'Transferência',
  '19': 'Fidelidade/Cashback', '90': 'Sem pagamento', '99': 'Outros'
};

function ehXmlNFe(buffer) {
  const ini = buffer.slice(0, 4000).toString('utf8');
  return /<(nfeProc|NFe)[\s>]/.test(ini) || /<infNFe[\s>]/.test(ini);
}

/**
 * @param {Buffer} buffer
 * @returns {{nota: object, itens: object[], alertas: string[]}}
 */
function lerXmlNFe(buffer) {
  let doc;
  try { doc = parser.parse(buffer.toString('utf8')); } catch (e) { throw new Error('XML inválido: ' + e.message); }

  const nfe = (doc.nfeProc && doc.nfeProc.NFe) || doc.NFe;
  const inf = nfe && nfe.infNFe;
  if (!inf) {
    throw new Error('Este XML não é de NF-e/NFC-e (modelos 55 e 65). Para outros documentos, envie o PDF ou a foto.');
  }

  const alertas = [];
  const ide = inf.ide || {};
  const emit = inf.emit || {};
  const ender = emit.enderEmit || {};
  const tot = (inf.total && inf.total.ICMSTot) || {};

  const chave = String(inf['@Id'] || '').replace(/\D/g, '')
    || String((doc.nfeProc && doc.nfeProc.protNFe && doc.nfeProc.protNFe.infProt && doc.nfeProc.protNFe.infProt.chNFe) || '');
  const dec = chave.length === 44 ? decodificarChave(chave) : null;
  if (dec && !dec.chaveValida) alertas.push('A chave de acesso do XML não passou no dígito verificador.');

  const prot = doc.nfeProc && doc.nfeProc.protNFe && doc.nfeProc.protNFe.infProt;
  if (!prot) alertas.push('XML sem protocolo de autorização (não veio como nfeProc) — não dá para confirmar que a nota foi autorizada.');
  else if (String(prot.cStat) !== '100') alertas.push(`Nota NÃO autorizada na SEFAZ (status ${prot.cStat}${prot.xMotivo ? ' — ' + prot.xMotivo : ''}).`);

  const emissao = String(ide.dhEmi || ide.dEmi || '');
  const m = emissao.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/);

  const itens = lista(inf.det).map(d => {
    const p = d.prod || {};
    return {
      descricao: String(p.xProd || '').trim(),
      ncm: p.NCM || null,
      cfop: p.CFOP || null,
      quantidade: num(p.qCom),
      unidade: p.uCom || '',
      valor: arred(num(p.vProd) - num(p.vDesc) + num(p.vFrete) + num(p.vSeg) + num(p.vOutro))
    };
  });

  const pags = lista(inf.pag && inf.pag.detPag);
  const forma = pags.length ? (FORMAS[String(pags[0].tPag).padStart(2, '0')] || '') : '';

  const valorTotal = arred(num(tot.vNF));
  const somaItens = arred(itens.reduce((s, i) => s + i.valor, 0));
  if (valorTotal && Math.abs(somaItens - valorTotal) > 0.05) {
    alertas.push(`Soma dos itens (R$ ${somaItens.toFixed(2)}) difere do total da nota (R$ ${valorTotal.toFixed(2)}) — impostos, frete ou desconto.`);
  }

  const modelo = String(ide.mod || (dec && dec.modelo) || '');
  const nota = {
    tipo_documento: MODELOS[modelo] || (modelo ? 'modelo ' + modelo : 'NF-e'),
    numero: String(Number(ide.nNF || (dec && dec.numero) || 0) || ''),
    serie: String(Number(ide.serie || (dec && dec.serie) || 0)),
    chave,
    data_emissao: m ? `${m[1]}-${m[2]}-${m[3]}` : null,
    hora_emissao: (m && m[4]) || null,
    cnpj: String(emit.CNPJ || emit.CPF || (dec && dec.cnpj) || ''),
    estabelecimento: String(emit.xFant || emit.xNome || '').trim(),
    cidade: String(ender.xMun || '').trim(),
    uf: String(ender.UF || (dec && dec.uf) || '').toUpperCase(),
    valor_total: valorTotal || null,
    forma_pagamento: forma,
    confianca: 1,
    origem: 'XML',
    observacoes: '',
    destinatario: String((inf.dest && (inf.dest.CNPJ || inf.dest.CPF)) || '')
  };
  return { nota, itens, alertas };
}

module.exports = { lerXmlNFe, ehXmlNFe };
