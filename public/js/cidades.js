'use strict';
/**
 * Autocompletar de cidade/UF com a lista oficial de municípios do IBGE (public/data/municipios.json).
 * O usuário digita, vê as opções (sem diferenciar acento ou maiúscula) e pode escolher uma delas.
 * Texto livre continua permitido (ex.: destino no exterior); nesse caso aparece um aviso.
 * O valor gravado segue o padrão "Cidade/UF" (ex.: Francisco Beltrão/PR).
 */

let _municipios = null;
function carregarMunicipios() {
  if (!_municipios) {
    _municipios = fetch('/data/municipios.json')
      .then(r => { if (!r.ok) throw new Error('lista indisponível'); return r.json(); })
      .then(lista => lista.map(s => {
        const [nome, uf] = s.split('|');
        return { nome, uf, texto: `${nome}/${uf}`, chave: semAcento(nome), busca: semAcento(nome) + ' ' + uf.toLowerCase() };
      }))
      .catch(() => { _municipios = null; return []; });
  }
  return _municipios;
}

function semAcento(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Até `max` municípios: primeiro os que começam com o texto, depois os que contêm todas as palavras. */
function buscarMunicipios(lista, consulta, max = 8) {
  const q = semAcento(consulta.replace(/[\/,\-]+/g, ' ')).replace(/\s+/g, ' ');
  if (q.length < 2) return [];
  const palavras = q.split(' ');
  const comeca = [], contem = [];
  for (const m of lista) {
    if (m.chave.startsWith(q) || m.busca.startsWith(q)) comeca.push(m);
    else if (palavras.every(p => m.busca.includes(p))) contem.push(m);
    if (comeca.length >= max) break;
  }
  return comeca.concat(contem).slice(0, max);
}

function autocompletarCidade(input) {
  const campo = input.closest('.campo') || input.parentElement;
  campo.style.position = 'relative';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');

  const lista = document.createElement('ul');
  lista.className = 'ac-lista';
  lista.setAttribute('role', 'listbox');
  lista.hidden = true;
  const aviso = document.createElement('div');
  aviso.className = 'dica';
  campo.append(lista, aviso);

  let itens = [], ativo = -1, todos = [];

  const fechar = () => { lista.hidden = true; input.setAttribute('aria-expanded', 'false'); ativo = -1; };
  const marcar = i => {
    ativo = i;
    [...lista.children].forEach((li, k) => li.classList.toggle('ativo', k === i));
    if (i >= 0) lista.children[i].scrollIntoView({ block: 'nearest' });
  };
  const escolher = m => { input.value = m.texto; fechar(); atualizarAviso(); input.dispatchEvent(new Event('change', { bubbles: true })); };

  function atualizarAviso() {
    const v = input.value.trim();
    if (!v) { aviso.textContent = ''; aviso.style.color = ''; return; }
    const ok = todos.some(m => m.texto.toLowerCase() === v.toLowerCase());
    if (ok) { aviso.textContent = '✓ Cidade da lista oficial'; aviso.style.color = 'var(--verde-escuro)'; }
    else if (todos.length) { aviso.textContent = 'Não está na lista de municípios: será salvo como digitado. Escolha uma opção para evitar erro de digitação.'; aviso.style.color = 'var(--aviso)'; }
  }

  async function mostrar() {
    todos = await carregarMunicipios();
    itens = buscarMunicipios(todos, input.value);
    lista.innerHTML = '';
    if (!itens.length) { fechar(); return; }
    const q = input.value.trim();
    itens.forEach((m, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.className = 'ac-item';
      const nomeHtml = esc(m.nome);
      li.innerHTML = `<span>${nomeHtml}</span><small>${esc(m.uf)}</small>`;
      li.addEventListener('mousedown', e => { e.preventDefault(); escolher(m); });   // antes do blur do input
      li.addEventListener('mousemove', () => marcar(i));
      lista.appendChild(li);
    });
    lista.style.top = (input.offsetTop + input.offsetHeight + 2) + 'px';
    lista.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    marcar(0);
  }

  input.addEventListener('input', () => { mostrar(); atualizarAviso(); });
  input.addEventListener('focus', () => { carregarMunicipios().then(l => { todos = l; atualizarAviso(); }); if (input.value.trim().length >= 2) mostrar(); });
  input.addEventListener('blur', () => { setTimeout(fechar, 100); atualizarAviso(); });
  input.addEventListener('keydown', e => {
    if (lista.hidden) { if (e.key === 'ArrowDown' && input.value.trim().length >= 2) { mostrar(); e.preventDefault(); } return; }
    if (e.key === 'ArrowDown') { marcar((ativo + 1) % itens.length); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { marcar((ativo - 1 + itens.length) % itens.length); e.preventDefault(); }
    else if (e.key === 'Enter' && ativo >= 0) { escolher(itens[ativo]); e.preventDefault(); }
    else if (e.key === 'Escape') { fechar(); e.stopPropagation(); }
  });

  carregarMunicipios().then(l => { todos = l; atualizarAviso(); });
}
