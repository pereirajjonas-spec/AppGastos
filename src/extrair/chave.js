'use strict';
/**
 * Decodificacao da chave de acesso de 44 digitos da NF-e / NFC-e.
 *
 * Layout (Manual de Orientacao do Contribuinte / NT 2013.005):
 *   cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
 *
 * Vantagem sobre OCR: numero, serie, CNPJ, UF e mes/ano de emissao vem
 * da propria chave, sem risco de erro de leitura.
 */

const UF_POR_CODIGO = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP',
  '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB',
  '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES',
  '33': 'RJ', '35': 'SP', '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS',
  '51': 'MT', '52': 'GO', '53': 'DF'
};

const MODELOS = {
  '55': 'NF-e',
  '65': 'NFC-e',
  '57': 'CT-e',
  '58': 'MDF-e',
  '59': 'SAT/CF-e',
  '67': 'CT-e OS'
};

/** Digito verificador da chave: modulo 11, pesos 2..9 ciclicos da direita. */
function calcularDV(chave43) {
  let peso = 2;
  let soma = 0;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto === 0 || resto === 1 ? 0 : 11 - resto;
}

function validarChave(chave) {
  if (!/^\d{44}$/.test(chave || '')) return false;
  return calcularDV(chave.slice(0, 43)) === Number(chave[43]);
}

function formatarCNPJ(cnpj) {
  if (!/^\d{14}$/.test(cnpj || '')) return cnpj || '';
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

/**
 * Decodifica a chave em campos. Retorna null se a chave for invalida.
 * @param {string} chave 44 digitos
 */
function decodificarChave(chave) {
  const limpa = String(chave || '').replace(/\D/g, '');
  if (limpa.length !== 44) return null;

  const cUF     = limpa.slice(0, 2);
  const aamm    = limpa.slice(2, 6);
  const cnpj    = limpa.slice(6, 20);
  const modelo  = limpa.slice(20, 22);
  const serie   = limpa.slice(22, 25);
  const numero  = limpa.slice(25, 34);
  const tpEmis  = limpa.slice(34, 35);
  const cNF     = limpa.slice(35, 43);

  const ano = 2000 + Number(aamm.slice(0, 2));
  const mes = Number(aamm.slice(2, 4));

  return {
    chave: limpa,
    chaveValida: validarChave(limpa),
    uf: UF_POR_CODIGO[cUF] || '',
    codigoUF: cUF,
    tipoDocumento: MODELOS[modelo] || ('modelo ' + modelo),
    modelo,
    serie: String(Number(serie)),          // remove zeros a esquerda
    numero: String(Number(numero)),
    cnpj,
    cnpjFormatado: formatarCNPJ(cnpj),
    competencia: (mes < 10 ? '0' : '') + mes + '/' + ano,
    anoEmissao: ano,
    mesEmissao: mes,
    tipoEmissao: tpEmis,
    codigoNumerico: cNF
  };
}

/** Procura uma chave de 44 digitos valida dentro de qualquer texto (URL de QR, OCR, etc). */
function extrairChaveDeTexto(texto) {
  if (!texto) return null;
  const candidatos = String(texto).replace(/[^\d]/g, ' ').match(/\d{44,}/g) || [];
  for (const bloco of candidatos) {
    for (let i = 0; i + 44 <= bloco.length; i++) {
      const c = bloco.slice(i, i + 44);
      if (validarChave(c)) return c;
    }
  }
  // fallback: parametros nomeados comuns (chNFe=, p=CHAVE|...)
  const m = String(texto).match(/(?:chNFe|chCTe|p)=([0-9]{44})/i);
  if (m && validarChave(m[1])) return m[1];
  // ultimo recurso: primeiro bloco de 44 digitos mesmo sem DV valido
  const bruto = String(texto).replace(/\D/g, '').match(/\d{44}/);
  return bruto ? bruto[0] : null;
}

/**
 * Procura a chave no TEXTO de um PDF (DANFE). Ela costuma vir em grupos de 4 dígitos
 * ("3526 0911 2223 ...") ou colada; aceita as duas formas e só devolve chave com DV válido.
 */
function extrairChaveDeTextoPdf(texto) {
  if (!texto) return null;
  const t = String(texto);
  const candidatas = [
    ...(t.match(/(?:\d{4}[\s.]?){10}\d{4}/g) || []),      // 11 grupos de 4
    ...(t.match(/\d{44}/g) || [])
  ].map(c => c.replace(/\D/g, ''));
  for (const c of candidatas) if (validarChave(c)) return c;
  return null;
}

module.exports = {
  extrairChaveDeTextoPdf,
  decodificarChave,
  validarChave,
  extrairChaveDeTexto,
  formatarCNPJ,
  UF_POR_CODIGO,
  MODELOS
};
