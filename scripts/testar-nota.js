'use strict';
/**
 * Testa a leitura de uma nota sem passar pelo app:
 *   npm run testar-nota -- "C:caminho
ota.jpg"
 *   npm run testar-nota -- nota.pdf --comparar        (PDF: texto extraído x PDF inteiro)
 *   npm run testar-nota -- nota.pdf --provedor=kimi
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const { extrairNota } = require('../src/extrair');

const args = process.argv.slice(2);
const arq = args.find(a => !a.startsWith('--'));
const flag = n => args.some(a => a === '--' + n);
const provedor = (args.find(a => a.startsWith('--provedor=')) || '').split('=')[1];
if (!arq || !fs.existsSync(arq)) { console.log('Uso: npm run testar-nota -- "caminho/da/nota.jpg|pdf|xml" [--comparar] [--provedor=kimi|anthropic]'); process.exit(1); }
const mime = /.pdf$/i.test(arq) ? 'application/pdf' : /.xml$/i.test(arq) ? 'application/xml' : 'image/jpeg';
const buffer = fs.readFileSync(arq);

async function rodar(opts) {
  const t = Date.now();
  const r = await extrairNota(buffer, mime, { provedor, ...opts });
  return { ...r, segundos: ((Date.now() - t) / 1000).toFixed(1) };
}
const tokens = u => (u ? `${u.input_tokens ?? u.prompt_tokens ?? '?'} entrada / ${u.output_tokens ?? u.completion_tokens ?? '?'} saída` : 'n/d');
const resumo = r => ({ leitura: r.leitura, segundos: r.segundos, tokens: tokens(r.uso), total: r.nota.valor_total, lancamentos: r.lancamentos.map(l => [l.categoria, l.valor, l.litros]), alertas: r.alertas });

(async () => {
  if (flag('comparar') && mime === 'application/pdf') {
    const [a, b] = [await rodar({}), await rodar({ pdfInteiro: true })];
    console.log(JSON.stringify({ 'texto extraído': resumo(a), 'PDF inteiro': resumo(b) }, null, 2));
    const chaves = r => JSON.stringify(r.lancamentos.map(l => [l.categoria, l.valor, l.litros]));   // a descrição pode variar
    const igual = chaves(a) === chaves(b) && a.nota.valor_total === b.nota.valor_total;
    console.log(igual ? '\nMesmos lançamentos e total nos dois modos.' : '\nATENÇÃO: os dois modos divergem.');
  } else {
    const r = await rodar({});
    console.log(JSON.stringify({ ...r, uso: undefined, resumo: resumo(r) }, null, 2));
  }
})().catch(e => { console.error('Falhou:', e.message); process.exit(1); });
