'use strict';
/**
 * Visualização do XML da NF-e/NFC-e como um documento legível (DANFE simplificado).
 * Não é o DANFE oficial: mostra os mesmos dados do XML (emitente, chave, itens, totais, pagamento)
 * para o comprovante poder ser lido, impresso e anexado ao relatório.
 * Usa só DOMParser + textContent: nada do XML é inserido como HTML.
 */

const DANFE_CSS = `
.dfe{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;background:#fff;padding:14px;max-width:760px;margin:0 auto;text-align:left}
.dfe h3{font-size:13px;margin:0 0 2px}
.dfe .tit{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;border-bottom:2px solid #5BA85F;padding-bottom:6px;margin-bottom:8px}
.dfe .tit small{color:#666;font-size:10px}
.dfe .cx{border:1px solid #ccc;border-radius:4px;padding:5px 8px;margin-bottom:6px}
.dfe .cx .l{font-size:9px;text-transform:uppercase;color:#777;font-weight:700;letter-spacing:.03em}
.dfe .cx .v{font-weight:600;word-break:break-word}
.dfe .g{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.dfe .g .cx{margin:0}
.dfe table{width:100%;border-collapse:collapse;margin-top:6px}
.dfe th{background:#f2f2f2;font-size:9px;text-transform:uppercase;text-align:left;padding:4px 5px;border:1px solid #ddd}
.dfe td{padding:3px 5px;border:1px solid #e5e5e5;vertical-align:top}
.dfe .n{text-align:right;white-space:nowrap}
.dfe .tot{font-weight:800;font-size:12px}
.dfe .al{background:#fff6e0;border:1px solid #f1dda8;color:#8a5a00;border-radius:4px;padding:5px 8px;margin-bottom:6px}
.dfe .nota{margin-top:8px;color:#555;font-size:10px;white-space:pre-wrap}
`;

const FORMAS_PAG = {
  '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de Crédito', '04': 'Cartão de Débito', '05': 'Crédito Loja',
  '10': 'Vale Alimentação', '11': 'Vale Refeição', '12': 'Vale Presente', '13': 'Vale Combustível',
  '15': 'Boleto', '16': 'Depósito', '17': 'PIX', '18': 'Transferência', '19': 'Fidelidade/Cashback', '90': 'Sem pagamento', '99': 'Outros'
};

/** @returns {string} HTML do documento (já com <style>) */
function danfeHtml(xmlTexto) {
  const doc = new DOMParser().parseFromString(xmlTexto, 'application/xml');
  if (doc.querySelector('parsererror')) return '<div class="dfe"><div class="al">XML ilegível.</div></div>';

  const um = (ctx, tag) => (ctx && ctx.getElementsByTagName(tag)[0]) || null;
  const t = (ctx, tag) => { const e = um(ctx, tag); return e ? e.textContent.trim() : ''; };
  const e$ = s => esc(s);
  const dec = (v, d = 2) => (v === '' || v == null) ? '' : numBR(Number(v), d);

  const inf = um(doc, 'infNFe');
  if (!inf) return '<div class="dfe"><div class="al">Este XML não é de NF-e/NFC-e.</div></div>';
  const ide = um(inf, 'ide'), emit = um(inf, 'emit'), end = um(emit, 'enderEmit'), dest = um(inf, 'dest');
  const tot = um(um(inf, 'total'), 'ICMSTot'), prot = um(doc, 'infProt');
  const chave = (inf.getAttribute('Id') || '').replace(/\D/g, '') || t(prot, 'chNFe');
  const modelo = t(ide, 'mod');
  const emissao = t(ide, 'dhEmi') || t(ide, 'dEmi');
  const dt = emissao.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/);
  const aut = prot && t(prot, 'cStat') === '100';

  const itens = [...inf.getElementsByTagName('det')].map(d => {
    const p = um(d, 'prod');
    return `<tr><td>${e$(t(d, 'cProd'))}</td><td>${e$(t(p, 'xProd'))}</td><td>${e$(t(p, 'NCM'))}</td><td>${e$(t(p, 'CFOP'))}</td>
      <td>${e$(t(p, 'uCom'))}</td><td class="n">${dec(t(p, 'qCom'), 3)}</td><td class="n">${dec(t(p, 'vUnCom'), 2)}</td><td class="n">${dec(t(p, 'vProd'))}</td></tr>`;
  }).join('');

  const pag = [...inf.getElementsByTagName('detPag')].map(d =>
    `${e$(FORMAS_PAG[String(t(d, 'tPag')).padStart(2, '0')] || 'Outros')}: ${moeda(Number(t(d, 'vPag')))}`).join(' · ');

  const cx = (l, v, extra = '') => `<div class="cx" ${extra}><div class="l">${l}</div><div class="v">${v || '—'}</div></div>`;

  return `<div class="dfe"><style>${DANFE_CSS}</style>
    <div class="tit"><div><h3>${modelo === '65' ? 'DANFE NFC-e' : 'DANFE NF-e'} — visualização do XML</h3>
      <small>Documento gerado a partir do XML; não é o DANFE oficial do emissor.</small></div>
      <div style="text-align:right"><b>Nº ${e$(String(Number(t(ide, 'nNF')) || ''))}</b> · Série ${e$(String(Number(t(ide, 'serie') || 0)))}<br>
      <small>Modelo ${e$(modelo)}</small></div></div>
    ${prot ? (aut ? '' : `<div class="al">NOTA NÃO AUTORIZADA — status ${e$(t(prot, 'cStat'))} ${e$(t(prot, 'xMotivo'))}</div>`)
           : '<div class="al">XML sem protocolo de autorização.</div>'}
    ${cx('Chave de acesso', e$(chave.replace(/(\d{4})(?=\d)/g, '$1 ')))}
    <div class="g">
      ${cx('Emissão', dt ? `${dt[3]}/${dt[2]}/${dt[1]}${dt[4] ? ' ' + dt[4] : ''}` : '')}
      ${cx('Natureza da operação', e$(t(ide, 'natOp')))}
      ${cx('Protocolo de autorização', prot ? e$(t(prot, 'nProt')) : '')}
    </div>
    <div class="cx" style="margin-top:6px"><div class="l">Emitente</div>
      <div class="v">${e$(t(emit, 'xNome'))}${t(emit, 'xFant') ? ' (' + e$(t(emit, 'xFant')) + ')' : ''}</div>
      <div>CNPJ/CPF ${e$(cnpjFmt(t(emit, 'CNPJ') || t(emit, 'CPF')))} · IE ${e$(t(emit, 'IE') || '—')}</div>
      <div>${e$([t(end, 'xLgr'), t(end, 'nro'), t(end, 'xBairro'), t(end, 'xMun') && (t(end, 'xMun') + '/' + t(end, 'UF'))].filter(Boolean).join(', '))}</div></div>
    ${dest ? `<div class="cx"><div class="l">Destinatário</div><div class="v">${e$(t(dest, 'xNome') || 'Consumidor não identificado')}</div>
      <div>CNPJ/CPF ${e$(cnpjFmt(t(dest, 'CNPJ') || t(dest, 'CPF')) || '—')}</div></div>` : ''}
    <table><thead><tr><th>Cód.</th><th>Descrição</th><th>NCM</th><th>CFOP</th><th>Un.</th><th class="n">Qtd.</th><th class="n">V. unit.</th><th class="n">V. total</th></tr></thead>
      <tbody>${itens || '<tr><td colspan="8">Sem itens.</td></tr>'}</tbody></table>
    <div class="g" style="margin-top:8px">
      ${cx('Total dos produtos', moeda(Number(t(tot, 'vProd'))))}
      ${cx('Frete / seguro / outras', moeda(Number(t(tot, 'vFrete')) + Number(t(tot, 'vSeg')) + Number(t(tot, 'vOutro'))))}
      ${cx('Desconto', moeda(Number(t(tot, 'vDesc'))))}
    </div>
    <div class="cx tot" style="margin-top:6px;display:flex;justify-content:space-between"><span>VALOR TOTAL DA NOTA</span><span>${moeda(Number(t(tot, 'vNF')))}</span></div>
    ${cx('Pagamento', pag)}
    ${t(inf, 'infCpl') ? `<div class="nota">${e$(t(inf, 'infCpl'))}</div>` : ''}
  </div>`;
}

/** HTML completo (para imprimir num iframe). */
function danfeDocumento(xmlTexto) {
  return `<!doctype html><meta charset="utf-8"><title>Nota fiscal</title><style>@page{margin:10mm}body{margin:0}</style>${danfeHtml(xmlTexto)}`;
}
