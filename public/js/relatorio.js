'use strict';
(async function () {
  const folha = document.getElementById('folha');
  const id = new URLSearchParams(location.search).get('id');
  document.getElementById('btnImprimir').innerHTML = ICONES.imprimir + ' Imprimir';
  document.getElementById('btnPdf').innerHTML = ICONES.baixar + ' Baixar PDF';
  if (id) document.getElementById('voltar').href = `/app#/viagem/${id}`;

  let R;
  try { R = await api(`/api/viagens/${id}`); } catch (e) {
    folha.innerHTML = `<div class="msg msg-erro">${esc(e.message)}</div>`;
    return;
  }
  const { viagem: v, usuario: u, notas, lancamentos: L } = R;
  document.title = `Relatório — ${v.titulo}`;

  const ORDEM = ['cafe', 'almoco', 'jantar', 'combustivel', 'estacionamento', 'hospedagem', 'uber_taxi', 'outros'];
  const soma = arr => arr.reduce((s, l) => s + l.valor, 0);
  const porCat = Object.fromEntries(ORDEM.map(c => [c, L.filter(l => l.categoria === c)]));
  const total = soma(L);
  const refeicoes = soma(porCat.cafe) + soma(porCat.almoco) + soma(porCat.jantar);
  const litros = porCat.combustivel.reduce((s, l) => s + (l.litros || 0), 0);
  const saldo = (v.adiantamento || 0) - total;
  const notaPorId = Object.fromEntries(notas.map(n => [n.id, n]));

  const linhaCat = c => `<tr><td>${catTag(c)}</td><td class="num">${porCat[c].length}</td><td class="num">${moeda(soma(porCat[c]))}</td></tr>`;

  // Despesas por dia: uma linha por lançamento, ordenado por data (a API já ordena por data e hora).
  // Modelo do documento: vem da chave de acesso (posições 21-22); sem chave, deduz do tipo (NF-e = 55, NFC-e = 65).
  const modeloDoc = n => {
    if (n && String(n.chave || '').length === 44) return n.chave.slice(20, 22);
    return { 'NF-e': '55', 'NFC-e': '65' }[n && n.tipo_documento] || '';
  };
  // Média diária: dias do período da viagem (início a fim); sem período, dias distintos com despesa.
  const dias = (() => {
    const a = Date.parse(v.data_inicio), b = Date.parse(v.data_fim);
    if (a && b && b >= a) return Math.round((b - a) / 86400000) + 1;
    return new Set(L.filter(l => l.data).map(l => l.data)).size;
  })();
  const linhaMedia = dias ? `<tr class="sub"><td colspan="4">Média por dia (${dias} ${dias === 1 ? 'dia' : 'dias'})</td><td class="num">${numBR(total / dias)}</td></tr>` : '';
  const quadro = L.map(l => {
    const n = notaPorId[l.nota_id] || {};
    return `<tr><td>${l.data ? dataBR(l.data) : 'Sem data'}</td><td>${esc(n.numero || '—')}</td><td>${esc(modeloDoc(n) || n.tipo_documento || '—')}</td><td>${catTag(l.categoria)}</td><td class="num">${numBR(l.valor)}</td></tr>`;
  }).join('');

  const detalhe = L.map((l, i) => {
    const n = notaPorId[l.nota_id] || {};
    return `<tr>
      <td class="num" style="text-align:left">${i + 1}</td>
      <td>${dataBR(l.data)}${n.hora_emissao ? `<div class="peq">${esc(n.hora_emissao)}</div>` : ''}</td>
      <td>${esc(n.estabelecimento || '—')}<div class="peq">${esc(cnpjFmt(n.cnpj))}${n.cidade ? ' · ' + esc(n.cidade) + (n.uf ? '/' + esc(n.uf) : '') : ''}</div></td>
      <td>${esc(n.tipo_documento || '')}<div class="peq">${n.numero ? 'nº ' + esc(n.numero) : ''}</div></td>
      <td>${catTag(l.categoria)}</td>
      <td>${esc(l.descricao || '')}${l.litros ? `<div class="peq">${numBR(l.litros, 2)} L</div>` : ''}</td>
      <td class="num">${moeda(l.valor)}</td></tr>`;
  }).join('');

  // Todo comprovante entra no relatório, qualquer que seja o formato enviado (foto, PDF ou XML).
  // O conteúdo é carregado depois (preencherAnexos); aqui só a moldura com a legenda.
  const legenda = (n, i, extra = '') => `<div class="leg"><span><b>Comprovante ${i + 1}</b>${extra} — ${esc(n.estabelecimento || 'Nota fiscal')} · ${dataBR(n.data_emissao)}${n.numero ? ' · ' + esc(n.tipo_documento) + ' nº ' + esc(n.numero) : ''}</span><b>${moeda(n.valor_total)}</b></div>`;
  const anexos = notas.map((n, i) => `
    <div class="r-anexo" data-anexo="${n.id}">
      ${legenda(n, i)}
      <div class="corpo"><div class="girando" style="margin:30px auto"></div></div>
    </div>`).join('');

  const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  folha.innerHTML = `
    <div class="r-cab">
      <img src="/img/logo.jpg" alt="Grupo MSA">
      <div class="tit"><h1>Relatório de Despesas de Viagem</h1><div class="emissao">Emitido em ${agora} · Viagem nº ${v.id} · ${v.status === 'fechada' ? 'FECHADA' : 'EM ABERTO'}</div></div>
    </div>

    <div class="r-bloco">
      <h2>Dados da viagem</h2>
      <div class="r-dados">
        <div class="larga"><div class="l">Colaborador</div><div class="v">${esc(u.nome)}</div></div>
        <div class="larga"><div class="l">E-mail</div><div class="v">${esc(u.email)}</div></div>
        <div class="larga"><div class="l">Viagem</div><div class="v">${esc(v.titulo)}</div></div>
        <div><div class="l">Destino</div><div class="v">${esc(v.destino || '—')}</div></div>
        <div><div class="l">Conta/Centro de Custo</div><div class="v">${esc(v.centro_custo || u.centro_custo || '—')}</div></div>
        <div class="larga"><div class="l">Período</div><div class="v">${periodo(v.data_inicio, v.data_fim)}</div></div>
        <div><div class="l">Notas fiscais</div><div class="v">${notas.length}</div></div>
        <div><div class="l">Lançamentos</div><div class="v">${L.length}</div></div>
        ${v.motivo ? `<div class="toda"><div class="l">Motivo</div><div class="v" style="font-weight:400">${esc(v.motivo)}</div></div>` : ''}
      </div>
    </div>

    <div class="r-bloco r-resumo">
      <div>
        <h2>Resumo por categoria</h2>
        <table class="r-tab">
          <thead><tr><th>Categoria</th><th class="num">Qtd</th><th class="num">Valor</th></tr></thead>
          <tbody>
            ${linhaCat('cafe')}${linhaCat('almoco')}${linhaCat('jantar')}
            <tr class="sub"><td>Subtotal refeições</td><td class="num">${porCat.cafe.length + porCat.almoco.length + porCat.jantar.length}</td><td class="num">${moeda(refeicoes)}</td></tr>
            ${linhaCat('combustivel')}
            ${litros ? `<tr><td class="peq" style="padding-left:22px">${numBR(litros, 2)} litros abastecidos</td><td></td><td></td></tr>` : ''}
            ${linhaCat('estacionamento')}${linhaCat('hospedagem')}${linhaCat('uber_taxi')}${linhaCat('outros')}
            <tr class="tot"><td>Total</td><td class="num">${L.length}</td><td class="num">${moeda(total)}</td></tr>
          </tbody>
        </table>
      </div>
      <div>
        <h2>Acerto</h2>
        <div class="r-saldo">
          <div class="linha"><span>Total das despesas</span><b>${moeda(total)}</b></div>
          <div class="linha"><span>Adiantamento recebido</span><b>${moeda(v.adiantamento)}</b></div>
          <div class="linha final ${saldo < 0 ? 'receber' : saldo > 0 ? 'devolver' : ''}">
            <span>${saldo < 0 ? 'A reembolsar ao colaborador' : saldo > 0 ? 'A devolver pelo colaborador' : 'Saldo'}</span><span>${moeda(Math.abs(saldo))}</span>
          </div>
        </div>
      </div>
    </div>

    ${L.length ? `
    <div class="r-bloco">
      <h2>Despesas por dia (R$)</h2>
      <table class="r-tab">
        <thead><tr><th>Data</th><th>Nº doc</th><th>Tipo doc</th><th>Tipo de despesa</th><th class="num">Valor</th></tr></thead>
        <tbody>${quadro}
          ${linhaMedia}
          <tr class="tot"><td colspan="4">Total</td><td class="num">${numBR(total)}</td></tr>
        </tbody>
      </table>
    </div>` : ''}

    <div class="r-fecho">
      <div class="r-assin">
        <div><b>${esc(u.nome)}</b>Colaborador</div>
        <div><b>&nbsp;</b>Gestor imediato</div>
        <div><b>&nbsp;</b>Financeiro</div>
      </div>
      <div class="r-local">Francisco Beltrão - PR, ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
    </div>

    <div class="r-bloco r-detalhe">
      <h2>Detalhamento dos lançamentos</h2>
      ${L.length ? `<table class="r-tab">
        <thead><tr><th>#</th><th>Data</th><th>Estabelecimento</th><th>Documento</th><th>Categoria</th><th>Descrição</th><th class="num">Valor</th></tr></thead>
        <tbody>${detalhe}<tr class="tot"><td colspan="6">Total</td><td class="num">${moeda(total)}</td></tr></tbody>
      </table>` : '<p>Nenhum lançamento nesta viagem.</p>'}
    </div>

    <div class="r-rodape">Despesas de Viagem · Grupo MSA — valores lidos das notas fiscais (QR Code e IA) e conferidos pelo colaborador.</div>

    ${anexos}`;

  const chk = document.getElementById('chkAnexos');
  chk.addEventListener('change', () => folha.classList.toggle('sem-anexos', !chk.checked));
  if (!notas.length) chk.parentElement.hidden = true;
  const chkDet = document.getElementById('chkDetalhe');
  chkDet.addEventListener('change', () => folha.classList.toggle('sem-detalhe', !chkDet.checked));
  if (!L.length) chkDet.parentElement.hidden = true;

  // ---------- carrega o conteúdo dos comprovantes ----------
  const aguardarImagens = el => Promise.all([...el.querySelectorAll('img')].map(img =>
    img.complete ? null : new Promise(ok => { img.onload = img.onerror = ok; })));
  const falha = (n, motivo) => `<div class="pdf">Não foi possível carregar o comprovante (${esc(motivo)}). Veja o arquivo original pela tela de lançamentos.</div>`;

  async function preencherAnexo(div, n, i) {
    const corpo = div.querySelector('.corpo');
    const folhas = [div];
    try {
      if (String(n.mimetype).startsWith('image/')) {
        corpo.innerHTML = `<img src="/api/notas/${n.id}/arquivo" alt="Comprovante ${i + 1}">`;
      } else if (n.mimetype === 'application/xml') {
        const xml = await (await fetch(`/api/notas/${n.id}/arquivo?download=1`, { credentials: 'same-origin' })).text();
        corpo.innerHTML = danfeHtml(xml);
      } else {
        const { total } = await api(`/api/notas/${n.id}/paginas`);
        if (!total) throw new Error('PDF sem páginas');
        corpo.innerHTML = `<img src="/api/notas/${n.id}/pagina/1" alt="Comprovante ${i + 1}">`;
        for (let p = 2; p <= total; p++) {   // páginas seguintes, cada uma em folha própria
          const extra = document.createElement('div');
          extra.className = 'r-anexo';
          extra.innerHTML = `${legenda(n, i, ` (pág. ${p}/${total})`)}<div class="corpo"><img src="/api/notas/${n.id}/pagina/${p}" alt="Comprovante ${i + 1}, página ${p}"></div>`;
          folhas[folhas.length - 1].after(extra);
          folhas.push(extra);
        }
      }
    } catch (e) {
      corpo.innerHTML = falha(n, e.message);
    }
    await Promise.all(folhas.map(aguardarImagens));
  }

  // ---------- comprovantes por página (1 = um por folha, 2 = lado a lado, 4 = grade 2x2) ----------
  const ALTURA_MAX_XML = 440;   // px: dois comprovantes por coluna cabem numa A4
  function aplicarPorPagina(n) {
    folha.querySelectorAll('.r-grade').forEach(w => { while (w.firstChild) w.before(w.firstChild); w.remove(); });
    folha.querySelectorAll('.r-anexo .corpo').forEach(c => { c.style.height = ''; const d = c.querySelector('.dfe'); if (d) d.style.cssText = ''; });
    if (n !== 2 && n !== 4) return;
    const lista = [...folha.querySelectorAll('.r-anexo')];
    for (let i = 0; i < lista.length; i += n) {
      const grupo = document.createElement('div');
      grupo.className = 'r-grade n' + n;
      lista[i].before(grupo);
      lista.slice(i, i + n).forEach(a => grupo.appendChild(a));
    }
    // XML: a visualização tem 760 px de largura; reduz para caber na célula
    folha.querySelectorAll('.r-grade .corpo').forEach(c => {
      const d = c.querySelector('.dfe');
      if (!d) return;
      d.style.cssText = 'width:760px;max-width:none;margin:0;transform-origin:top left';
      const esc = Math.min(1, c.clientWidth / 760, (n === 2 ? 900 : ALTURA_MAX_XML) / d.offsetHeight);
      d.style.transform = `scale(${esc})`;
      c.style.height = Math.ceil(d.offsetHeight * esc) + 'px';
    });
  }
  const selPP = document.getElementById('selPorPagina');
  try { const salvo = localStorage.getItem('rel_por_pagina'); if (salvo === '2' || salvo === '4') selPP.value = salvo; } catch (_) { /* sem storage */ }
  if (!notas.length) document.getElementById('lblPorPagina').hidden = true;

  const btnImp = document.getElementById('btnImprimir'), btnPdfEl = document.getElementById('btnPdf');
  btnImp.disabled = btnPdfEl.disabled = true;
  const carregando = Promise.all([...folha.querySelectorAll('.r-anexo[data-anexo]')].map((div, k) =>
    preencherAnexo(div, notas[k], k))).then(() => { aplicarPorPagina(Number(selPP.value)); btnImp.disabled = btnPdfEl.disabled = false; });

  selPP.addEventListener('change', async () => {
    try { localStorage.setItem('rel_por_pagina', selPP.value); } catch (_) { /* sem storage */ }
    await carregando;
    aplicarPorPagina(Number(selPP.value));
  });

  document.getElementById('btnImprimir').addEventListener('click', () => window.print());

  document.getElementById('btnPdf').addEventListener('click', async () => {
    const btn = document.getElementById('btnPdf');
    if (!window.html2pdf) { toast('Gerador de PDF indisponível. Use Imprimir → "Salvar como PDF".', true); return; }
    btn.disabled = true; btn.textContent = 'Gerando PDF…';
    await carregando;
    document.body.classList.add('gerando-pdf');
    try {
      const nome = `Relatorio-viagem-${v.id}-${u.nome.split(' ')[0]}-${(v.titulo || '').replace(/[^\w]+/g, '_').slice(0, 30)}.pdf`;
      // O gerador cria uma página em branco para cada quebra forçada, mesmo em seção oculta:
      // por isso as seções desmarcadas são retiradas da cópia usada no PDF.
      const copia = folha.cloneNode(true);
      if (!chkDet.checked) copia.querySelectorAll('.r-detalhe').forEach(e => e.remove());
      if (!chk.checked) copia.querySelectorAll('.r-anexo, .r-grade').forEach(e => e.remove());
      await html2pdf().set({
        margin: [10, 10, 10, 10],
        filename: nome,
        image: { type: 'jpeg', quality: 0.92 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.r-fecho', '.r-bloco.r-resumo'] }
      }).from(copia).save();
    } catch (e) {
      toast('Não foi possível gerar o PDF: ' + e.message, true);
    } finally {
      document.body.classList.remove('gerando-pdf');
      btn.disabled = false; btn.innerHTML = ICONES.baixar + ' Baixar PDF';
    }
  });
})();
