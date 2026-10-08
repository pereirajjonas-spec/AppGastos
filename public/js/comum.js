/* Utilitários compartilhados pelas telas */
'use strict';

const CATEGORIAS = {
  cafe:           { nome: 'Café da manhã',  curto: 'Café',     cor: 'var(--c-cafe)' },
  almoco:         { nome: 'Almoço',         curto: 'Almoço',   cor: 'var(--c-almoco)' },
  jantar:         { nome: 'Jantar',         curto: 'Jantar',   cor: 'var(--c-jantar)' },
  combustivel:    { nome: 'Combustível',    curto: 'Combust.', cor: 'var(--c-combustivel)' },
  estacionamento: { nome: 'Estacionamento', curto: 'Estacion.', cor: 'var(--c-estacionamento)' },
  hospedagem:     { nome: 'Hospedagem',     curto: 'Hosped.',  cor: 'var(--c-hospedagem)' },
  uber_taxi:      { nome: 'Uber/Táxi',      curto: 'Uber/Táxi', cor: 'var(--c-uber_taxi)' },
  outros:         { nome: 'Outros',         curto: 'Outros',   cor: 'var(--c-outros)' }
};

async function api(url, opts = {}) {
  const o = { credentials: 'same-origin', ...opts, headers: { ...(opts.headers || {}) } };
  if (o.body && !(o.body instanceof FormData)) {
    o.headers['Content-Type'] = 'application/json';
    o.body = JSON.stringify(o.body);
  }
  const r = await fetch(url, o);
  if (r.status === 401 && !url.startsWith('/api/auth/login')) {
    location.href = '/?volta=' + encodeURIComponent(location.pathname + location.search + location.hash);
    throw new Error('Sessão expirada.');
  }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || `Erro ${r.status}`);
  return dados;
}

const NOME_IA = { anthropic: 'Claude', kimi: 'Kimi', deepseek: 'DeepSeek' };
const moeda = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numBR = (v, d = 2) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
function dataBR(iso) {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return d ? `${d}/${m}/${a}` : iso;
}
function periodo(ini, fim) {
  if (!ini && !fim) return 'Período não informado';
  if (ini && fim && ini !== fim) return `${dataBR(ini)} a ${dataBR(fim)}`;
  return dataBR(ini || fim);
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cnpjFmt = c => /^\d{14}$/.test(c || '') ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (c || '');

function catTag(cat) {
  const c = CATEGORIAS[cat] || CATEGORIAS.outros;
  return `<span class="cat" style="--c:${c.cor}">${c.nome}</span>`;
}

const ICONES = {
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  arquivo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15l3-3 3 3"/></svg>',
  mala: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
  lista: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  usuario: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  equipe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  olho: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  baixar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  imprimir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
  lixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  fechar: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  relatorio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
  mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  reler: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/></svg>',
  editar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>'
};

function toast(texto, erro = false) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast' + (erro ? ' erro' : '');
  t.textContent = texto;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), erro ? 6000 : 3200);
}

/** Abre um modal. Retorna { el, fechar }. Botões com data-fechar fecham. */
function abrirModal({ titulo, corpo, acoes = '', larga = false, semCorpo = false }) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="modal-caixa ${larga ? 'larga' : ''}" role="dialog" aria-modal="true">
    <div class="modal-cab"><h2>${esc(titulo)}</h2><button class="fechar" data-fechar aria-label="Fechar">${ICONES.fechar}</button></div>
    ${semCorpo ? corpo : `<div class="modal-corpo">${corpo}</div>`}
    ${acoes ? `<div class="modal-acoes">${acoes}</div>` : ''}</div>`;
  const fechar = () => { m.remove(); document.removeEventListener('keydown', tecla); };
  const tecla = e => { if (e.key === 'Escape') fechar(); };
  m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-fechar]')) fechar(); });
  document.addEventListener('keydown', tecla);
  document.body.appendChild(m);
  const primeiro = m.querySelector('input, select, textarea');
  if (primeiro) setTimeout(() => primeiro.focus(), 50);
  return { el: m, fechar };
}

function confirmar(texto, botao = 'Confirmar', perigo = true) {
  return new Promise(ok => {
    const { el, fechar } = abrirModal({
      titulo: 'Confirmação', corpo: `<p>${texto}</p>`,
      acoes: `<button class="btn btn-sec" data-fechar>Cancelar</button><button class="btn ${perigo ? 'btn-perigo' : 'btn-primario'}" data-sim>${esc(botao)}</button>`
    });
    el.querySelector('[data-sim]').addEventListener('click', () => { fechar(); ok(true); });
    el.addEventListener('click', e => { if (e.target.closest('[data-fechar]') || e.target === el) ok(false); });
  });
}

/** Imprime um arquivo da mesma origem por um iframe oculto (imagem, PDF) ou o documento gerado do XML. */
function imprimirArquivo(url, tipo) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  if (tipo === 'pdf') {
    f.src = url;
    f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (_) { window.open(url, '_blank'); } };
  } else if (tipo === 'xml') {
    fetch(url + '?download=1', { credentials: 'same-origin' }).then(r => r.text()).then(xml => {
      const d = f.contentDocument;
      d.open(); d.write(danfeDocumento(xml)); d.close();
      setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); }, 250);
    });
  } else {
    const d = f.contentDocument;
    d.open();
    d.write('<!doctype html><title>Nota fiscal</title><style>@page{margin:10mm}body{margin:0;text-align:center}img{max-width:100%;max-height:100vh}</style><img>');
    d.close();
    const img = d.querySelector('img');
    img.onload = () => { f.contentWindow.focus(); f.contentWindow.print(); };
    img.src = url;
  }
  setTimeout(() => f.remove(), 60000);
}

/** Visualizador da nota fiscal original, com imprimir e baixar. */
function verNota(notaId, titulo, mimetype) {
  const url = `/api/notas/${notaId}/arquivo`;
  const tipo = String(mimetype).startsWith('image/') ? 'imagem' : mimetype === 'application/xml' ? 'xml' : 'pdf';
  const conteudo = tipo === 'imagem' ? `<img src="${url}" alt="Nota fiscal">`
    : tipo === 'xml' ? '<div class="xml-view" style="width:100%;height:100%;overflow:auto;background:#fff"><div class="girando" style="margin:40px auto"></div></div>'
    : `<iframe src="${url}" title="Nota fiscal"></iframe>`;
  const { el } = abrirModal({
    titulo: titulo || 'Nota fiscal', larga: true, semCorpo: true,
    corpo: `<div class="visualizador">${conteudo}</div>`,
    acoes: `<a class="btn btn-sec" href="${url}" target="_blank" rel="noopener">${ICONES.olho} Abrir em nova aba</a>
      <button class="btn btn-sec" data-imprimir>${ICONES.imprimir} Imprimir</button>
      <a class="btn btn-primario" href="${url}?download=1">${ICONES.baixar} Baixar${tipo === 'xml' ? ' XML' : ''}</a>`
  });
  if (tipo === 'xml') {
    fetch(url + '?download=1', { credentials: 'same-origin' }).then(r => r.text())
      .then(xml => { el.querySelector('.xml-view').innerHTML = danfeHtml(xml); })
      .catch(() => { el.querySelector('.xml-view').textContent = 'Não foi possível abrir o XML.'; });
  }
  el.querySelector('[data-imprimir]').addEventListener('click', () => imprimirArquivo(url, tipo === 'imagem' ? 'imagem' : tipo));
}

function opcoesCategorias(sel) {
  return Object.entries(CATEGORIAS).map(([k, c]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${c.nome}</option>`).join('');
}

/** Lê valor digitado no padrão brasileiro: "1.234,56" -> 1234.56 */
function lerValor(s) {
  s = String(s || '').replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return Number(s);
}
