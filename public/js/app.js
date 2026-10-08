'use strict';
/* Despesas de Viagem — app (rotas por hash) */

let EU = null;
const tela = document.getElementById('tela');
const ehAdmin = () => EU && EU.perfil === 'admin';

// =====================================================================
//  Navegação
// =====================================================================
const ROTAS = [
  [/^#?\/?$/, telaViagens],
  [/^#\/viagem\/(\d+)$/, telaViagem],
  [/^#\/lancamentos$/, telaLancamentos],
  [/^#\/admin$/, telaAdmin],
  [/^#\/conta$/, telaConta]
];

function montarMenu() {
  const itens = [
    ['#/', 'Viagens', ICONES.mala],
    ['#/lancamentos', 'Lançamentos', ICONES.lista],
    ...(ehAdmin() ? [['#/admin', 'Usuários', ICONES.equipe]] : []),
    ['#/conta', 'Minha conta', ICONES.usuario]
  ];
  document.getElementById('menu').innerHTML = itens.map(([h, t]) => `<a href="${h}">${t}</a>`).join('');
  document.getElementById('abas').innerHTML = itens.map(([h, t, i]) => `<a href="${h}">${i}<span>${t.replace('Minha conta', 'Conta')}</span></a>`).join('');
  document.getElementById('nomeUsuario').textContent = EU.nome;
}

function marcarMenu() {
  const h = location.hash || '#/';
  const base = h.startsWith('#/viagem') ? '#/' : h;
  document.querySelectorAll('#menu a, #abas a').forEach(a => a.classList.toggle('ativo', a.getAttribute('href') === base));
}

async function navegar() {
  marcarMenu();
  window.scrollTo(0, 0);
  const h = location.hash || '#/';
  for (const [re, fn] of ROTAS) {
    const m = h.match(re);
    if (m) {
      try { await fn(...m.slice(1)); } catch (e) { tela.innerHTML = `<div class="msg msg-erro">${esc(e.message)}</div>`; }
      return;
    }
  }
  location.hash = '#/';
}

// =====================================================================
//  Viagens
// =====================================================================
let filtroUsuarioViagens = '';

async function telaViagens() {
  const qs = ehAdmin() && filtroUsuarioViagens ? `?usuario=${filtroUsuarioViagens}` : '';
  const [viagens, usuarios] = await Promise.all([
    api('/api/viagens' + qs),
    ehAdmin() ? api('/api/admin/usuarios') : Promise.resolve([])
  ]);
  const abertas = viagens.filter(v => v.status === 'aberta');
  const fechadas = viagens.filter(v => v.status === 'fechada');

  const cartao = v => `
    <a class="cartao viagem-item ${v.status}" href="#/viagem/${v.id}">
      <h3>${esc(v.titulo)}</h3>
      <div class="meta">${esc(v.destino || 'Destino não informado')} · ${periodo(v.data_inicio, v.data_fim)}</div>
      ${ehAdmin() ? `<div class="meta">${esc(v.usuario_nome)}</div>` : ''}
      <div class="rodape">
        <span class="meta">${v.qtd_notas} nota${v.qtd_notas === 1 ? '' : 's'} · <span class="selo selo-${v.status}">${v.status}</span></span>
        <span class="valor-grande">${moeda(v.total)}</span>
      </div>
    </a>`;

  tela.innerHTML = `
    <div class="cab">
      <div><h1>Viagens</h1><div class="sub">${ehAdmin() ? 'Todas as viagens dos colaboradores' : 'Registre as notas de cada viagem e gere o relatório'}</div></div>
      <div class="acoes">
        ${ehAdmin() ? `<select id="filtroUsu" style="width:auto"><option value="">Todos os colaboradores</option>${usuarios.map(u => `<option value="${u.id}" ${String(u.id) === filtroUsuarioViagens ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')}</select>` : ''}
        <button class="btn btn-primario" id="novaViagem">${ICONES.mais} Nova viagem</button>
      </div>
    </div>
    ${viagens.length === 0 ? `
      <div class="cartao vazio">${ICONES.mala}<h3>Nenhuma viagem ainda</h3>
        <p>Crie uma viagem e depois fotografe as notas fiscais dos gastos.</p>
        <p style="margin-top:16px"><button class="btn btn-primario" id="novaViagem2">${ICONES.mais} Criar a primeira viagem</button></p></div>` : `
      ${abertas.length ? `<div class="lista-viagens">${abertas.map(cartao).join('')}</div>` : ''}
      ${fechadas.length ? `<div class="secao"><h2>Fechadas</h2><div class="lista-viagens">${fechadas.map(cartao).join('')}</div></div>` : ''}`}`;

  tela.querySelectorAll('#novaViagem, #novaViagem2').forEach(b => b.addEventListener('click', () => formViagem()));
  const f = document.getElementById('filtroUsu');
  if (f) f.addEventListener('change', () => { filtroUsuarioViagens = f.value; telaViagens(); });
}

function formViagem(v = null) {
  const hoje = new Date().toISOString().slice(0, 10);
  const { el, fechar } = abrirModal({
    titulo: v ? 'Editar viagem' : 'Nova viagem',
    corpo: `<form id="fViagem" class="grade" novalidate>
      <div class="campo inteira"><label>Título *</label><input type="text" name="titulo" maxlength="120" required placeholder="Ex.: Visita a clientes — Curitiba" value="${esc(v?.titulo || '')}"></div>
      <div class="campo inteira"><label>Destino (Cidade/UF)</label><input type="text" name="destino" maxlength="120" placeholder="Digite o nome da cidade" value="${esc(v?.destino || '')}"></div>
      <div class="campo"><label>Início</label><input type="date" name="data_inicio" value="${v ? (v.data_inicio || '') : hoje}"></div>
      <div class="campo"><label>Fim</label><input type="date" name="data_fim" value="${v?.data_fim || ''}"></div>
      <div class="campo"><label>Conta/Centro de Custo</label><input type="text" name="centro_custo" maxlength="60" value="${esc(v ? (v.centro_custo || '') : (EU.centro_custo || ''))}"></div>
      <div class="campo"><label>Adiantamento recebido (R$)</label><input type="text" inputmode="decimal" name="adiantamento" placeholder="0,00" value="${v && v.adiantamento ? numBR(v.adiantamento) : ''}"></div>
      <div class="campo inteira"><label>Motivo da viagem</label><textarea name="motivo" maxlength="500">${esc(v?.motivo || '')}</textarea></div>
      <div class="msg msg-erro inteira" id="erroViagem" hidden></div>
    </form>`,
    acoes: `<button class="btn btn-sec" data-fechar>Cancelar</button><button class="btn btn-primario" form="fViagem" type="submit">${v ? 'Salvar' : 'Criar viagem'}</button>`
  });
  autocompletarCidade(el.querySelector('[name=destino]'));
  el.querySelector('#fViagem').addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    d.adiantamento = lerValor(d.adiantamento) || 0;
    try {
      if (v) {
        await api(`/api/viagens/${v.id}`, { method: 'PATCH', body: d });
        fechar(); toast('Viagem atualizada.'); navegar();
      } else {
        const r = await api('/api/viagens', { method: 'POST', body: d });
        fechar(); location.hash = `#/viagem/${r.id}`;
      }
    } catch (err) {
      const m = el.querySelector('#erroViagem'); m.textContent = err.message; m.hidden = false;
    }
  });
}

// =====================================================================
//  Viagem (envio de notas + lançamentos)
// =====================================================================
let VIAGEM = null;   // { viagem, usuario, notas, lancamentos }

async function telaViagem(id) {
  VIAGEM = await api(`/api/viagens/${id}`);
  const { viagem: v, usuario } = VIAGEM;
  const podeEditar = v.status === 'aberta' || ehAdmin();

  tela.innerHTML = `
    <a class="voltar" href="#/">‹ Viagens</a>
    <div class="cab">
      <div>
        <h1>${esc(v.titulo)} <span class="selo selo-${v.status}" style="vertical-align:middle">${v.status}</span></h1>
        <div class="sub">${esc(v.destino || 'Destino não informado')} · ${periodo(v.data_inicio, v.data_fim)}${ehAdmin() ? ' · ' + esc(usuario.nome) : ''}</div>
      </div>
      <div class="acoes">
        <a class="btn btn-azul" href="/relatorio.html?id=${v.id}" target="_blank" rel="noopener">${ICONES.relatorio} Relatório</a>
        ${podeEditar ? `<button class="btn btn-sec" id="editarViagem">${ICONES.editar} Editar</button>` : ''}
        ${v.status === 'aberta' ? `<button class="btn btn-sec" id="fecharViagem">Fechar viagem</button>`
          : ehAdmin() ? `<button class="btn btn-sec" id="reabrirViagem">Reabrir</button>` : ''}
      </div>
    </div>

    <div class="resumo" id="resumo"></div>

    ${podeEditar ? `
      <div class="envio">
        <button class="btn btn-primario" id="btnCamera">${ICONES.camera} Fotografar nota</button>
        <button class="btn btn-sec" id="btnArquivo">${ICONES.arquivo} Enviar foto, PDF ou XML</button>
      </div>
      <div class="zona-soltar" id="zona">Ou arraste aqui as fotos, PDFs ou XMLs das notas fiscais</div>` :
      `<div class="msg msg-aviso" style="margin:0 0 18px">Viagem fechada: os lançamentos não podem mais ser alterados.</div>`}

    <div id="fila"></div>
    <div id="notas"></div>
    ${podeEditar ? `<p style="margin-top:24px"><button class="btn btn-perigo btn-peq" id="excluirViagem">${ICONES.lixo} Excluir viagem</button></p>` : ''}`;

  desenharResumo();
  desenharNotas();

  const on = (sel, fn) => { const b = document.getElementById(sel); if (b) b.addEventListener('click', fn); };
  on('editarViagem', () => formViagem(v));
  on('fecharViagem', async () => {
    if (!await confirmar('Fechar a viagem? Depois de fechada, só o administrador pode reabrir para alterações.', 'Fechar viagem', false)) return;
    await api(`/api/viagens/${v.id}`, { method: 'PATCH', body: { status: 'fechada' } });
    toast('Viagem fechada.'); navegar();
  });
  on('reabrirViagem', async () => {
    await api(`/api/viagens/${v.id}`, { method: 'PATCH', body: { status: 'aberta' } });
    toast('Viagem reaberta.'); navegar();
  });
  on('excluirViagem', async () => {
    if (!await confirmar(`Excluir a viagem "${esc(v.titulo)}" com todas as notas e lançamentos? Não dá para desfazer.`, 'Excluir')) return;
    await api(`/api/viagens/${v.id}`, { method: 'DELETE' });
    toast('Viagem excluída.'); location.hash = '#/';
  });
  on('btnCamera', () => document.getElementById('inCamera').click());
  on('btnArquivo', () => document.getElementById('inArquivo').click());

  const zona = document.getElementById('zona');
  if (zona) {
    ['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add('sobre'); }));
    ['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove('sobre'); }));
    zona.addEventListener('drop', e => enviarArquivos(e.dataTransfer.files));
  }
}

function desenharResumo() {
  const tot = {};
  let total = 0;
  VIAGEM.lancamentos.forEach(l => { tot[l.categoria] = (tot[l.categoria] || 0) + l.valor; total += l.valor; });
  const ref = (tot.cafe || 0) + (tot.almoco || 0) + (tot.jantar || 0);
  document.getElementById('resumo').innerHTML = `
    <div class="item" style="--c:var(--c-almoco)"><div class="rot">Refeições</div><div class="val">${moeda(ref)}</div></div>
    <div class="item" style="--c:var(--c-combustivel)"><div class="rot">Combustível</div><div class="val">${moeda(tot.combustivel)}</div></div>
    <div class="item" style="--c:var(--c-estacionamento)"><div class="rot">Estacionamento</div><div class="val">${moeda(tot.estacionamento)}</div></div>
    <div class="item" style="--c:var(--c-hospedagem)"><div class="rot">Hospedagem</div><div class="val">${moeda(tot.hospedagem)}</div></div>
    <div class="item" style="--c:var(--c-uber_taxi)"><div class="rot">Uber/Táxi</div><div class="val">${moeda(tot.uber_taxi)}</div></div>
    <div class="item" style="--c:var(--c-outros)"><div class="rot">Outros</div><div class="val">${moeda(tot.outros)}</div></div>
    <div class="item total"><div class="rot">Total da viagem</div><div class="val">${moeda(total)}</div></div>`;
}

function desenharNotas(novaId) {
  const cont = document.getElementById('notas');
  const notas = [...VIAGEM.notas].sort((a, b) => (b.data_emissao || '').localeCompare(a.data_emissao || '') || (b.hora_emissao || '').localeCompare(a.hora_emissao || '') || b.id - a.id);
  if (!notas.length) {
    cont.innerHTML = `<div class="cartao vazio">${ICONES.camera}<h3>Nenhuma nota nesta viagem</h3><p>Fotografe a NFC-e ou envie o PDF da NF-e. A leitura e a classificação dos gastos são automáticas.</p></div>`;
    return;
  }
  cont.innerHTML = `<h2 style="margin-bottom:12px">Notas fiscais (${notas.length})</h2>` + notas.map(n => cartaoNota(n, n.id === novaId)).join('');
}

function cartaoNota(n, nova) {
  const podeEditar = VIAGEM.viagem.status === 'aberta' || ehAdmin();
  const lancs = VIAGEM.lancamentos.filter(l => l.nota_id === n.id);
  const ehImagem = String(n.mimetype).startsWith('image/');
  const mini = !ehImagem
    ? `<div class="nota-mini" data-ver="${n.id}">${n.mimetype === 'application/xml' ? 'XML' : 'PDF'}</div>`
    : `<img class="nota-mini" data-ver="${n.id}" src="/api/notas/${n.id}/arquivo" alt="Nota" loading="lazy">`;

  const linhas = lancs.map(l => podeEditar ? `
    <div class="lanc" data-lanc="${l.id}">
      <select data-campo="categoria" aria-label="Categoria">${opcoesCategorias(l.categoria)}</select>
      <input class="desc" type="text" data-campo="descricao" value="${esc(l.descricao || '')}" maxlength="120" aria-label="Descrição">
      <input class="valor" type="text" inputmode="decimal" data-campo="valor" value="${numBR(l.valor)}" aria-label="Valor">
      <button class="remover" data-remover="${l.id}" title="Remover lançamento">${ICONES.lixo}</button>
    </div>` : `
    <div class="lanc"><span>${catTag(l.categoria)}</span><span class="desc">${esc(l.descricao || '')}</span><span class="num" style="text-align:right">${moeda(l.valor)}</span><span></span></div>`).join('');

  const soma = lancs.reduce((s, l) => s + l.valor, 0);
  const difere = n.valor_total && Math.abs(soma - n.valor_total) > 0.05;

  return `
    <div class="cartao nota ${nova ? 'nova' : ''}" data-nota="${n.id}">
      <div class="nota-cab">
        ${mini}
        <div class="nota-info">
          <h3>${esc(n.estabelecimento || 'Estabelecimento não identificado')}</h3>
          <div class="meta">${dataBR(n.data_emissao)}${n.hora_emissao ? ' às ' + esc(n.hora_emissao) : ''} · ${esc(n.cidade || '')}${n.uf ? '/' + esc(n.uf) : ''}</div>
          <div class="meta">${esc(n.tipo_documento || '')}${n.numero ? ' nº ' + esc(n.numero) : ''}${n.forma_pagamento ? ' · ' + esc(n.forma_pagamento) : ''}</div>
        </div>
        <div class="nota-total"><div class="valor-grande">${moeda(n.valor_total ?? soma)}</div><div class="meta" style="font-size:12px;color:var(--cinza)" title="${esc(n.modelo_ia || '')}">${esc(n.origem || '')}${n.provedor_ia ? ' · ' + NOME_IA[n.provedor_ia] : ''}</div></div>
      </div>
      ${n.observacoes ? `<div class="nota-alertas"><div style="color:var(--cinza);background:var(--fundo)">Leitura: ${esc(n.observacoes)}</div></div>` : ''}
      ${(n.alertas.length || difere) ? `<div class="nota-alertas">${n.alertas.map(a => `<div>⚠ ${esc(a)}</div>`).join('')}${difere && !n.alertas.some(a => a.startsWith('Soma')) ? `<div>⚠ Soma dos lançamentos (${moeda(soma)}) difere do total da nota.</div>` : ''}</div>` : ''}
      ${linhas}
      <div class="nota-rodape">
        <button class="btn btn-link btn-peq" data-ver="${n.id}">${ICONES.olho} Ver nota</button>
        ${podeEditar ? `
          <button class="btn btn-link btn-peq" data-add="${n.id}">${ICONES.mais} Lançamento</button>
          <button class="btn btn-link btn-peq" data-editnota="${n.id}">${ICONES.editar} Dados da nota</button>
          <button class="btn btn-link btn-peq" data-reler="${n.id}">${ICONES.reler} Ler novamente</button>
          <button class="btn btn-link btn-peq" style="color:var(--erro);margin-left:auto" data-excluir="${n.id}">${ICONES.lixo} Excluir</button>` : ''}
      </div>
    </div>`;
}

function atualizarNotaNaTela(notaId) {
  const el = document.querySelector(`[data-nota="${notaId}"]`);
  const n = VIAGEM.notas.find(x => x.id === notaId);
  if (el && n) el.outerHTML = cartaoNota(n, false);
  desenharResumo();
}

// --- envio ---
['inCamera', 'inArquivo'].forEach(id => {
  document.getElementById(id).addEventListener('change', e => {
    enviarArquivos(e.target.files);
    e.target.value = '';
  });
});

async function enviarArquivos(lista) {
  const arquivos = [...lista];
  for (const f of arquivos) await enviarUm(f);
}

async function enviarUm(arquivo) {
  if (!VIAGEM) return;
  const fila = document.getElementById('fila');
  const item = document.createElement('div');
  item.className = 'cartao processando';
  item.innerHTML = `<div class="girando"></div><div><b>Lendo a nota…</b><div class="meta" style="font-size:13px;color:var(--cinza)">${esc(arquivo.name || 'foto')} — leitura do QR Code e classificação dos gastos (pode levar até 1 minuto)</div></div>`;
  fila.appendChild(item);
  try {
    const fd = new FormData();
    fd.append('arquivo', arquivo);
    const r = await api(`/api/viagens/${VIAGEM.viagem.id}/notas`, { method: 'POST', body: fd });
    VIAGEM.notas.push(r.nota);
    VIAGEM.lancamentos.push(...r.lancamentos);
    item.remove();
    desenharNotas(r.nota.id);
    desenharResumo();
    toast(`Nota lida: ${r.nota.estabelecimento || 'despesa'} — ${moeda(r.nota.valor_total)}`);
  } catch (e) {
    item.className = 'cartao msg msg-erro';
    item.style.margin = '0 0 12px';
    item.innerHTML = `<b>${esc(arquivo.name || 'Foto')}:</b> ${esc(e.message)} <button class="btn btn-link btn-peq" data-fechar-erro>Fechar</button>`;
    item.querySelector('[data-fechar-erro]').addEventListener('click', () => item.remove());
  }
}

// --- ações nas notas (delegação) ---
tela.addEventListener('click', async e => {
  const b = e.target.closest('[data-ver],[data-remover],[data-add],[data-editnota],[data-excluir],[data-reler]');
  if (!b || !VIAGEM) return;
  if (b.dataset.ver) {
    const n = VIAGEM.notas.find(x => x.id === Number(b.dataset.ver));
    if (n) verNota(n.id, n.estabelecimento, n.mimetype);
  } else if (b.dataset.remover) {
    const id = Number(b.dataset.remover);
    if (!await confirmar('Remover este lançamento?', 'Remover')) return;
    try {
      await api(`/api/lancamentos/${id}`, { method: 'DELETE' });
      const l = VIAGEM.lancamentos.find(x => x.id === id);
      VIAGEM.lancamentos = VIAGEM.lancamentos.filter(x => x.id !== id);
      atualizarNotaNaTela(l.nota_id);
    } catch (err) { toast(err.message, true); }
  } else if (b.dataset.add) {
    formLancamento(Number(b.dataset.add));
  } else if (b.dataset.reler) {
    relerNota(VIAGEM.notas.find(x => x.id === Number(b.dataset.reler)));
  } else if (b.dataset.editnota) {
    formNota(VIAGEM.notas.find(x => x.id === Number(b.dataset.editnota)));
  } else if (b.dataset.excluir) {
    const id = Number(b.dataset.excluir);
    if (!await confirmar('Excluir esta nota e os lançamentos dela?', 'Excluir nota')) return;
    try {
      await api(`/api/notas/${id}`, { method: 'DELETE' });
      VIAGEM.notas = VIAGEM.notas.filter(x => x.id !== id);
      VIAGEM.lancamentos = VIAGEM.lancamentos.filter(x => x.nota_id !== id);
      desenharNotas(); desenharResumo(); toast('Nota excluída.');
    } catch (err) { toast(err.message, true); }
  }
});

// edição inline dos lançamentos
tela.addEventListener('change', async e => {
  const campo = e.target.dataset.campo;
  const linha = e.target.closest('[data-lanc]');
  if (!campo || !linha || !VIAGEM) return;
  const id = Number(linha.dataset.lanc);
  let valor = e.target.value;
  if (campo === 'valor') {
    valor = lerValor(valor);
    if (!(valor > 0)) { toast('Valor inválido.', true); return; }
  }
  try {
    const l = await api(`/api/lancamentos/${id}`, { method: 'PATCH', body: { [campo]: valor } });
    const i = VIAGEM.lancamentos.findIndex(x => x.id === id);
    VIAGEM.lancamentos[i] = { ...VIAGEM.lancamentos[i], ...l };
    if (campo === 'valor') { e.target.value = numBR(l.valor); atualizarNotaNaTela(l.nota_id); }
    else { linha.classList.add('salvo'); setTimeout(() => linha.classList.remove('salvo'), 900); desenharResumo(); }
  } catch (err) { toast(err.message, true); }
});

function formLancamento(notaId) {
  const { el, fechar } = abrirModal({
    titulo: 'Novo lançamento nesta nota',
    corpo: `<form id="fLanc" novalidate>
      <div class="campo"><label>Categoria</label><select name="categoria">${opcoesCategorias('outros')}</select></div>
      <div class="campo"><label>Descrição</label><input type="text" name="descricao" maxlength="120"></div>
      <div class="campo"><label>Valor (R$)</label><input type="text" inputmode="decimal" name="valor" placeholder="0,00" required></div>
      <p class="dica" style="font-size:13px;color:var(--cinza)">Use para separar um item que ficou junto em outro lançamento — e lembre de reduzir o valor do original.</p>
      <div class="msg msg-erro" id="erroLanc" hidden></div></form>`,
    acoes: `<button class="btn btn-sec" data-fechar>Cancelar</button><button class="btn btn-primario" form="fLanc" type="submit">Adicionar</button>`
  });
  el.querySelector('#fLanc').addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    d.valor = lerValor(d.valor);
    try {
      const l = await api(`/api/notas/${notaId}/lancamentos`, { method: 'POST', body: d });
      VIAGEM.lancamentos.push(l);
      fechar(); atualizarNotaNaTela(notaId);
    } catch (err) { const m = el.querySelector('#erroLanc'); m.textContent = err.message; m.hidden = false; }
  });
}

async function relerNota(n) {
  const { provedores } = await api('/api/ia');
  const ativos = provedores.filter(p => p.configurado);
  const sugerido = (ativos.find(p => p.id !== n.provedor_ia) || ativos[0] || {}).id;
  const { el, fechar } = abrirModal({
    titulo: 'Ler a nota novamente',
    corpo: `<form id="fReler">
      <p style="margin-bottom:14px">A nota será lida de novo e <b>os lançamentos dela serão substituídos</b> (correções manuais desta nota se perdem).
        ${n.provedor_ia ? `Leitura atual: <b>${NOME_IA[n.provedor_ia]}</b> (${esc(n.modelo_ia || '')}).` : ''}</p>
      ${provedores.map(p => `<label style="display:flex;gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--borda);border-radius:8px;margin-bottom:8px;${p.configurado ? 'cursor:pointer' : 'opacity:.5'}">
        <input type="radio" name="provedor" value="${p.id}" ${p.id === sugerido ? 'checked' : ''} ${p.configurado ? '' : 'disabled'} style="width:auto">
        <span><b>${esc(p.nome)}</b><br><span style="font-size:13px;color:var(--cinza)">${esc(p.modelo)}${p.configurado ? '' : ' — sem chave no .env'}</span></span></label>`).join('')}
      <div class="msg msg-erro" id="erroReler" hidden></div></form>`,
    acoes: '<button class="btn btn-sec" data-fechar>Cancelar</button><button class="btn btn-primario" form="fReler" type="submit">Ler novamente</button>'
  });
  el.querySelector('#fReler').addEventListener('submit', async e => {
    e.preventDefault();
    const provedor = new FormData(e.target).get('provedor');
    fechar();
    const cartao = document.querySelector(`[data-nota="${n.id}"]`);
    const aviso = document.createElement('div');
    aviso.className = 'processando';
    aviso.style.borderTop = '1px solid var(--borda)';
    aviso.innerHTML = `<div class="girando"></div><div><b>Lendo novamente com ${NOME_IA[provedor]}…</b><div style="font-size:13px;color:var(--cinza)">pode levar até 1 minuto</div></div>`;
    if (cartao) cartao.appendChild(aviso);
    try {
      const r = await api(`/api/notas/${n.id}/reler`, { method: 'POST', body: { provedor } });
      VIAGEM.notas = VIAGEM.notas.map(x => x.id === n.id ? r.nota : x);
      VIAGEM.lancamentos = VIAGEM.lancamentos.filter(l => l.nota_id !== n.id).concat(r.lancamentos);
      desenharNotas(n.id); desenharResumo();
      toast(`Lida com ${NOME_IA[r.nota.provedor_ia] || 'IA'}: ${moeda(r.nota.valor_total)}`);
    } catch (err) {
      aviso.remove();
      toast(err.message, true);
    }
  });
}

function formNota(n) {
  const { el, fechar } = abrirModal({
    titulo: 'Dados da nota',
    corpo: `<form id="fNota" novalidate>
      <div class="campo"><label>Estabelecimento</label><input type="text" name="estabelecimento" maxlength="200" value="${esc(n.estabelecimento || '')}"></div>
      <div class="campo"><label>Data de emissão</label><input type="date" name="data_emissao" value="${n.data_emissao || ''}"></div>
      <div class="campo"><label>Forma de pagamento</label><input type="text" name="forma_pagamento" maxlength="60" value="${esc(n.forma_pagamento || '')}"></div>
      <div class="det" style="margin-top:6px">
        <div><div class="rot">CNPJ</div><div class="val">${esc(cnpjFmt(n.cnpj) || '—')}</div></div>
        <div><div class="rot">Documento</div><div class="val">${esc(n.tipo_documento || '')} ${esc(n.numero || '')}${n.serie ? ' / série ' + esc(n.serie) : ''}</div></div>
        <div style="grid-column:1/-1"><div class="rot">Chave de acesso</div><div class="val" style="word-break:break-all;font-size:13px">${esc(n.chave || '—')}</div></div>
      </div>
      <div class="msg msg-erro" id="erroNota" hidden></div></form>`,
    acoes: `<button class="btn btn-sec" data-fechar>Cancelar</button><button class="btn btn-primario" form="fNota" type="submit">Salvar</button>`
  });
  el.querySelector('#fNota').addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    try {
      await api(`/api/notas/${n.id}`, { method: 'PATCH', body: d });
      Object.assign(n, d, { data_emissao: d.data_emissao || null });
      VIAGEM.lancamentos.filter(l => l.nota_id === n.id).forEach(l => { l.data = n.data_emissao; });
      fechar(); atualizarNotaNaTela(n.id);
    } catch (err) { const m = el.querySelector('#erroNota'); m.textContent = err.message; m.hidden = false; }
  });
}

// =====================================================================
//  Lançamentos (todos)
// =====================================================================
const FILTRO = { viagem: '', categoria: '', de: '', ate: '', usuario: '' };

async function telaLancamentos() {
  VIAGEM = null;
  const [viagens, usuarios] = await Promise.all([api('/api/viagens'), ehAdmin() ? api('/api/admin/usuarios') : []]);
  tela.innerHTML = `
    <div class="cab"><div><h1>Lançamentos</h1><div class="sub">Todos os gastos registrados a partir das notas fiscais</div></div></div>
    <div class="cartao cartao-corpo" style="margin-bottom:14px">
      <div class="filtros">
        ${ehAdmin() ? `<div><label>Colaborador</label><select data-f="usuario"><option value="">Todos</option>${usuarios.map(u => `<option value="${u.id}">${esc(u.nome)}</option>`).join('')}</select></div>` : ''}
        <div><label>Viagem</label><select data-f="viagem"><option value="">Todas</option>${viagens.map(v => `<option value="${v.id}">${esc(v.titulo)}${ehAdmin() ? ' — ' + esc(v.usuario_nome) : ''}</option>`).join('')}</select></div>
        <div><label>Categoria</label><select data-f="categoria"><option value="">Todas</option>${opcoesCategorias('')}</select></div>
        <div><label>De</label><input type="date" data-f="de"></div>
        <div><label>Até</label><input type="date" data-f="ate"></div>
      </div>
    </div>
    <div class="cartao" id="resultado"><div class="vazio"><div class="girando" style="margin:0 auto"></div></div></div>`;

  tela.querySelectorAll('[data-f]').forEach(c => {
    c.value = FILTRO[c.dataset.f];
    c.addEventListener('change', () => { FILTRO[c.dataset.f] = c.value; carregarLancamentos(); });
  });
  carregarLancamentos();
}

async function carregarLancamentos() {
  const qs = new URLSearchParams(Object.entries(FILTRO).filter(([, v]) => v)).toString();
  const lista = await api('/api/lancamentos' + (qs ? '?' + qs : ''));
  const res = document.getElementById('resultado');
  if (!res) return;
  if (!lista.length) { res.innerHTML = `<div class="vazio">${ICONES.lista}<h3>Nenhum lançamento encontrado</h3><p>Ajuste os filtros ou envie notas em uma viagem.</p></div>`; return; }
  const total = lista.reduce((s, l) => s + l.valor, 0);
  const verBtn = l => `<button class="btn btn-link btn-peq" data-vernota="${l.nota_id}" data-mime="${esc(l.mimetype)}" data-tit="${esc(l.estabelecimento || '')}">${ICONES.olho} Nota</button>`;

  res.innerHTML = `
    <div class="so-desktop tabela-wrap"><table class="tabela">
      <thead><tr><th>Data</th><th>Categoria</th><th>Estabelecimento</th><th>Descrição</th><th>Viagem</th>${ehAdmin() ? '<th>Colaborador</th>' : ''}<th class="num">Valor</th><th></th></tr></thead>
      <tbody>${lista.map(l => `<tr>
        <td>${dataBR(l.data)}${l.hora_emissao ? `<div style="font-size:12px;color:var(--cinza)">${esc(l.hora_emissao)}</div>` : ''}</td>
        <td>${catTag(l.categoria)}</td>
        <td>${esc(l.estabelecimento || '—')}<div style="font-size:12px;color:var(--cinza)">${esc(l.cidade || '')}${l.uf ? '/' + esc(l.uf) : ''}</div></td>
        <td>${esc(l.descricao || '')}</td>
        <td><a href="#/viagem/${l.viagem_id}">${esc(l.viagem_titulo)}</a></td>
        ${ehAdmin() ? `<td>${esc(l.usuario_nome)}</td>` : ''}
        <td class="num">${moeda(l.valor)}</td>
        <td>${verBtn(l)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="${ehAdmin() ? 6 : 5}">${lista.length} lançamento${lista.length === 1 ? '' : 's'}</td><td class="num">${moeda(total)}</td><td></td></tr></tfoot>
    </table></div>
    <div class="so-mobile lista-lanc">${lista.map(l => `
      <div class="linha" data-vernota="${l.nota_id}" data-mime="${esc(l.mimetype)}" data-tit="${esc(l.estabelecimento || '')}">
        <div class="info">
          <div class="t">${esc(l.estabelecimento || l.descricao || '—')}</div>
          <div class="m">${dataBR(l.data)} · ${catTag(l.categoria)}</div>
          <div class="m">${esc(l.viagem_titulo)}${ehAdmin() ? ' · ' + esc(l.usuario_nome) : ''}</div>
        </div>
        <div class="v">${moeda(l.valor)}</div>
      </div>`).join('')}
      <div class="total-filtro"><span>${lista.length} lançamento${lista.length === 1 ? '' : 's'}</span><span>${moeda(total)}</span></div>
    </div>`;

  res.querySelectorAll('[data-vernota]').forEach(b => b.addEventListener('click', e => {
    if (e.target.closest('a')) return;
    verNota(b.dataset.vernota, b.dataset.tit, b.dataset.mime);
  }));
}

// =====================================================================
//  Administração de usuários
// =====================================================================
async function telaAdmin() {
  VIAGEM = null;
  if (!ehAdmin()) { location.hash = '#/'; return; }
  const [usuarios, ia] = await Promise.all([api('/api/admin/usuarios'), api('/api/admin/ia')]);
  tela.innerHTML = `
    <div class="cab">
      <div><h1>Usuários</h1><div class="sub">Somente usuários cadastrados aqui conseguem acessar o aplicativo</div></div>
      <button class="btn btn-primario" id="novoUsu">${ICONES.mais} Novo usuário</button>
    </div>
    <div class="cartao tabela-wrap"><table class="tabela">
      <thead><tr><th>Nome</th><th>E-mail</th><th>Conta/Centro de Custo</th><th>Situação</th><th>Último acesso</th><th></th></tr></thead>
      <tbody>${usuarios.map(u => `<tr>
        <td><b>${esc(u.nome)}</b> ${u.perfil === 'admin' ? '<span class="selo selo-admin">admin</span>' : ''}</td>
        <td>${esc(u.email)}</td>
        <td>${esc(u.centro_custo || '—')}</td>
        <td>${u.ativo ? (u.tem_senha ? '<span class="selo selo-aberta">ativo</span>' : '<span class="selo selo-fechada">aguardando senha</span>') : '<span class="selo selo-inativo">inativo</span>'}</td>
        <td>${u.ultimo_login ? dataBR(u.ultimo_login) : '—'}</td>
        <td style="white-space:nowrap"><button class="btn btn-link btn-peq" data-editusu="${u.id}">${ICONES.editar} Editar</button>
          <button class="btn btn-link btn-peq" data-senhausu="${u.id}">Enviar link de senha</button></td></tr>`).join('')}</tbody>
    </table></div>`;

  tela.insertAdjacentHTML('beforeend', `
    <div class="secao" style="max-width:640px">
      <h2>Leitura das notas (IA)</h2>
      <div class="cartao cartao-corpo">
        <p style="font-size:14px;color:var(--cinza);margin-bottom:12px">Provedor usado nas notas novas. Se ele falhar, o app tenta o outro automaticamente (quando houver chave). Para comparar, use "Ler novamente" em uma nota.</p>
        ${ia.provedores.map(p => `<label style="display:flex;gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--borda);border-radius:8px;margin-bottom:8px;${p.configurado ? 'cursor:pointer' : 'opacity:.5'}">
          <input type="radio" name="iaProv" value="${p.id}" ${p.id === ia.provedor ? 'checked' : ''} ${p.configurado ? '' : 'disabled'} style="width:auto">
          <span><b>${esc(p.nome)}</b><br><span style="font-size:13px;color:var(--cinza)">modelo ${esc(p.modelo)}${p.configurado ? '' : ' — sem chave no .env'}</span></span></label>`).join('')}
      </div>
    </div>`);
  tela.querySelectorAll('[name=iaProv]').forEach(r => r.addEventListener('change', async () => {
    try { await api('/api/admin/ia', { method: 'PUT', body: { provedor: r.value } }); toast(`Notas novas serão lidas pelo ${NOME_IA[r.value]}.`); }
    catch (err) { toast(err.message, true); telaAdmin(); }
  }));
  document.getElementById('novoUsu').addEventListener('click', () => formUsuario());
  tela.querySelectorAll('[data-editusu]').forEach(b => b.addEventListener('click', () => formUsuario(usuarios.find(u => u.id === Number(b.dataset.editusu)))));
  tela.querySelectorAll('[data-senhausu]').forEach(b => b.addEventListener('click', async () => {
    const u = usuarios.find(x => x.id === Number(b.dataset.senhausu));
    if (!await confirmar(`Enviar para <b>${esc(u.email)}</b> um link para definir uma nova senha?`, 'Enviar', false)) return;
    try {
      const r = await api(`/api/admin/usuarios/${u.id}/enviar-senha`, { method: 'POST' });
      r.enviado ? toast('E-mail enviado.') : mostrarLink(r.link);
    } catch (err) { toast(err.message, true); }
  }));
}

function mostrarLink(link) {
  const { el } = abrirModal({
    titulo: 'E-mail não enviado',
    corpo: `<p>O envio de e-mail não está configurado ou falhou. Repasse este link ao usuário para ele definir a senha:</p>
      <input type="text" readonly value="${esc(link)}" style="margin-top:12px;font-size:13px">`,
    acoes: '<button class="btn btn-primario" data-fechar>OK</button>'
  });
  el.querySelector('input').addEventListener('focus', e => e.target.select());
}

function formUsuario(u = null) {
  const { el, fechar } = abrirModal({
    titulo: u ? 'Editar usuário' : 'Novo usuário',
    corpo: `<form id="fUsu" novalidate>
      <div class="campo"><label>Nome completo *</label><input type="text" name="nome" maxlength="120" required value="${esc(u?.nome || '')}"></div>
      <div class="campo"><label>E-mail da empresa *</label><input type="email" name="email" ${u ? 'disabled' : 'required'} value="${esc(u?.email || '')}"></div>
      <div class="campo"><label>Conta/Centro de Custo</label><input type="text" name="centro_custo" maxlength="60" value="${esc(u?.centro_custo || '')}"></div>
      <div class="campo"><label>Perfil</label><select name="perfil">
        <option value="usuario" ${u?.perfil !== 'admin' ? 'selected' : ''}>Usuário — lança as próprias despesas</option>
        <option value="admin" ${u?.perfil === 'admin' ? 'selected' : ''}>Administrador — vê tudo e cadastra usuários</option></select></div>
      ${u ? `<div class="campo"><label><input type="checkbox" name="ativo" ${u.ativo ? 'checked' : ''} style="width:auto;margin-right:6px">Acesso ativo</label></div>`
          : `<p style="font-size:13px;color:var(--cinza)">O usuário recebe um e-mail com o link para definir a própria senha.</p>`}
      <div class="msg msg-erro" id="erroUsu" hidden></div></form>`,
    acoes: `<button class="btn btn-sec" data-fechar>Cancelar</button><button class="btn btn-primario" form="fUsu" type="submit">${u ? 'Salvar' : 'Cadastrar e enviar convite'}</button>`
  });
  el.querySelector('#fUsu').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const d = Object.fromEntries(new FormData(f));
    try {
      if (u) {
        d.ativo = f.ativo.checked;
        await api(`/api/admin/usuarios/${u.id}`, { method: 'PATCH', body: d });
        fechar(); toast('Usuário atualizado.');
      } else {
        const r = await api('/api/admin/usuarios', { method: 'POST', body: d });
        fechar();
        r.enviado ? toast('Usuário cadastrado. Convite enviado por e-mail.') : mostrarLink(r.link);
      }
      telaAdmin();
    } catch (err) { const m = el.querySelector('#erroUsu'); m.textContent = err.message; m.hidden = false; }
  });
}

// =====================================================================
//  Minha conta
// =====================================================================
async function telaConta() {
  VIAGEM = null;
  tela.innerHTML = `
    <div class="cab"><div><h1>Minha conta</h1></div></div>
    <div class="cartao cartao-corpo" style="max-width:560px">
      <div class="det">
        <div><div class="rot">Nome</div><div class="val">${esc(EU.nome)}</div></div>
        <div><div class="rot">E-mail</div><div class="val">${esc(EU.email)}</div></div>
        <div><div class="rot">Perfil</div><div class="val">${ehAdmin() ? 'Administrador' : 'Usuário'}</div></div>
        <div><div class="rot">Conta/Centro de Custo</div><div class="val">${esc(EU.centro_custo || '—')}</div></div>
      </div>
    </div>
    <div class="secao" style="max-width:560px">
      <h2>Alterar senha</h2>
      <form class="cartao cartao-corpo" id="fSenha" novalidate>
        <div class="campo"><label>Senha atual</label><input type="password" name="atual" autocomplete="current-password" required></div>
        <div class="campo"><label>Nova senha</label><input type="password" name="nova" autocomplete="new-password" required><div class="dica">Mínimo de 8 caracteres, com letras e números.</div></div>
        <div class="campo"><label>Repita a nova senha</label><input type="password" name="nova2" autocomplete="new-password" required></div>
        <button class="btn btn-primario" type="submit">Alterar senha</button>
        <div class="msg" id="msgSenha" hidden></div>
      </form>
    </div>
    <div class="secao" style="max-width:560px">
      <h2>Instalar no celular</h2>
      <div class="cartao cartao-corpo" style="font-size:14px">
        <p><b>Android (Chrome):</b> menu ⋮ → <i>Instalar aplicativo</i> ou <i>Adicionar à tela inicial</i>.</p>
        <p style="margin-top:6px"><b>iPhone (Safari):</b> botão Compartilhar → <i>Adicionar à Tela de Início</i>.</p>
      </div>
    </div>
    <p style="margin-top:26px"><button class="btn btn-perigo" id="sair">Sair do aplicativo</button></p>`;

  document.getElementById('fSenha').addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const m = document.getElementById('msgSenha');
    m.hidden = false;
    if (d.nova !== d.nova2) { m.className = 'msg msg-erro'; m.textContent = 'As senhas não conferem.'; return; }
    try {
      await api('/api/auth/alterar-senha', { method: 'POST', body: d });
      m.className = 'msg msg-ok'; m.textContent = 'Senha alterada.'; e.target.reset();
    } catch (err) { m.className = 'msg msg-erro'; m.textContent = err.message; }
  });
  document.getElementById('sair').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.replace('/');
  });
}

// =====================================================================
//  Início
// =====================================================================
(async function () {
  try { EU = await api('/api/auth/eu'); } catch (_) { return; }
  montarMenu();
  window.addEventListener('hashchange', navegar);
  navegar();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
