'use strict';
/**
 * Leitura da nota fiscal (foto ou PDF) por IA, já classificando os gastos nas
 * categorias da viagem. Dois provedores:
 *   - anthropic (Claude): structured outputs garantem o formato do JSON; lê PDF nativamente.
 *   - kimi (Moonshot, API compatível com OpenAI): JSON mode + schema no prompt;
 *     PDF passa pela extração de texto da própria Moonshot (/v1/files file-extract).
 * O provedor ativo vem da configuração do admin (tabela config) ou do .env (IA_PROVEDOR).
 * Se o provedor ativo falhar e o outro tiver chave, tenta o outro.
 */

const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { toFile } = require('openai');
const sharp = require('sharp');
const { abrirImagem } = require('./imagem');

const CATEGORIAS = ['cafe', 'almoco', 'jantar', 'combustivel', 'estacionamento', 'hospedagem', 'uber_taxi', 'outros'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'tipo_documento', 'numero', 'serie', 'chave_acesso', 'data_emissao', 'hora_emissao',
    'cnpj', 'estabelecimento', 'cidade', 'uf', 'valor_total', 'forma_pagamento',
    'lancamentos', 'confianca', 'observacoes'
  ],
  properties: {
    tipo_documento: { type: 'string', enum: ['NFC-e', 'NF-e', 'NFS-e', 'Cupom Fiscal', 'SAT/CF-e', 'Recibo', 'Outro'] },
    numero: { type: ['string', 'null'] },
    serie: { type: ['string', 'null'] },
    chave_acesso: { type: ['string', 'null'] },
    data_emissao: { type: ['string', 'null'], description: 'DD/MM/AAAA' },
    hora_emissao: { type: ['string', 'null'], description: 'HH:MM' },
    cnpj: { type: ['string', 'null'] },
    estabelecimento: { type: ['string', 'null'] },
    cidade: { type: ['string', 'null'] },
    uf: { type: ['string', 'null'] },
    valor_total: { type: ['number', 'null'] },
    forma_pagamento: { type: ['string', 'null'] },
    lancamentos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['categoria', 'descricao', 'valor', 'litros'],
        properties: {
          categoria: { type: 'string', enum: CATEGORIAS },
          descricao: { type: 'string' },
          valor: { type: 'number' },
          litros: { type: ['number', 'null'] }
        }
      }
    },
    confianca: { type: 'number' },
    observacoes: { type: ['string', 'null'] }
  }
};

const REGRAS_LANC = `Separe o gasto em LANÇAMENTOS por categoria:
- "cafe": café da manhã / lanche da manhã (refeição até ~10h30)
- "almoco": refeição entre ~10h30 e ~15h30
- "jantar": refeição a partir de ~17h (lanche entre 15h30 e 17h: use o mais próximo pelo contexto)
- "combustivel": gasolina, etanol, diesel, GNV, ARLA 32
- "estacionamento": estacionamento, valet, zona azul
- "hospedagem": diárias de hotel, pousada, hostel, apart-hotel, taxa de turismo/ISS da hospedagem
- "uber_taxi": corridas de aplicativo (Uber, 99, Cabify, inDrive) e de táxi, recibo ou nota da corrida
- "outros": todo o resto (conveniência, pedágio, lavagem, lavanderia, farmácia, material etc.)

Regras dos lançamentos:
- Refeição (cafe/almoco/jantar) é consumo de alimentação em restaurante, padaria, lanchonete, cafeteria ou similar
  (inclusive o restaurante do hotel). Use o horário de emissão para escolher entre cafe, almoco e jantar.
  Sem horário, deduza pelo consumo (ex.: café e pão de queijo = cafe).
- Café da manhã incluso na diária do hotel fica junto da hospedagem.
- Itens avulsos comprados junto com combustível em posto/conveniência (água, café, salgadinho) vão em "outros".
- Agrupe os itens da mesma categoria em UM lançamento. Ex.: posto com diesel + água de conveniência = 1 "combustivel" + 1 "outros".
- A soma dos lançamentos deve bater EXATAMENTE com o valor_total (o valor pago, já com descontos/acréscimos).
  Se houver desconto ou acréscimo, rateie proporcionalmente entre os lançamentos e ajuste os centavos no maior deles.
- "descricao" curta (até 60 caracteres), ex.: "Diesel S10 — 45,3 L", "Almoço — buffet + refrigerante", "Hospedagem — 2 diárias".
- "litros" só para combustível, quando aparecer; senão null.`;

const PROMPT = `Você é um assistente de prestação de contas de viagens corporativas no Brasil.
Analise o documento fiscal anexado (NFC-e, NF-e/DANFE, NFS-e, cupom fiscal, SAT/CF-e ou recibo) e extraia os dados.

${REGRAS_LANC}

Regras gerais:
- valor_total é número com ponto decimal (ex.: 127.5): use o TOTAL A PAGAR.
- Nunca invente. Campo ilegível ou ausente = null.
- chave_acesso tem exatamente 44 dígitos; se não conseguir ler todos com certeza, use null.
- numero, serie e cnpj só com dígitos. Datas em DD/MM/AAAA, hora em HH:MM.
- confianca: sua certeza geral sobre a leitura, de 0.0 a 1.0.
- observacoes: problemas da leitura (foto cortada, borrada, valor rasurado) ou null.`;

const SCHEMA_ITENS = {
  type: 'object',
  additionalProperties: false,
  required: ['lancamentos'],
  properties: { lancamentos: SCHEMA.properties.lancamentos }
};

const PROVEDORES = {
  anthropic: { nome: 'Claude (Anthropic)', envChave: 'ANTHROPIC_API_KEY', modelo: () => process.env.ANTHROPIC_MODEL || 'claude-opus-5-5' },
  kimi:      { nome: 'Kimi (Moonshot)',    envChave: 'MOONSHOT_API_KEY',  modelo: () => process.env.KIMI_MODEL || 'kimi-k3' },
  // Em avaliação: não entra como alternativa automática; só quando escolhido (tela de Usuários ou "Ler novamente").
  deepseek:  { nome: 'DeepSeek Flash', envChave: 'DEEPSEEK_API_KEY', modelo: () => process.env.DEEPSEEK_MODEL || 'deepseek-flash', experimental: true }
};

const temChave = p => !!process.env[PROVEDORES[p].envChave];

let anthropic = null, moonshot = null, deepseek = null;
const getAnthropic = () => anthropic || (anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
const getMoonshot = () => moonshot || (moonshot = new OpenAI({
  apiKey: process.env.MOONSHOT_API_KEY,
  baseURL: process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1',
  timeout: 180000
}));

const getDeepseek = () => deepseek || (deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  timeout: 120000,
  maxRetries: 0      // provedor em avaliação: se não responder, falha logo (sem repetir por minutos)
}));

async function imagemJPEG(buffer) {
  return abrirImagem(buffer)
    .rotate()
    .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

function promptCom(dicaQR) {
  return dicaQR ? `${PROMPT}\n\nDados já lidos do QR Code deste documento (confiáveis, use como verdade):\n${dicaQR}` : PROMPT;
}

// ---------------------------------------------------------------------------
/** Texto extraído do PDF, no formato em que vai para a IA (mais barato e rápido que mandar o PDF inteiro). */
const blocoTextoPdf = texto =>
  `TEXTO EXTRAÍDO DO PDF DA NOTA (as colunas podem ter perdido os espaços; use quantidade × valor unitário para separar os números):\n"""\n${texto.slice(0, 60000)}\n"""`;

/**
 * Opções do pedido ao Claude. Modelos antigos/pequenos (Haiku 4.5, Sonnet 4.x) não aceitam o parâmetro
 * de esforço (effort) nem o recurso de contingência (fallbacks): para eles só vai o formato da resposta.
 */
function opcoesClaude(schema) {
  const modelo = PROVEDORES.anthropic.modelo();
  const basico = /haiku-[1-4]|sonnet-4-[0-5]|opus-4-[0-5]/.test(modelo);
  return {
    output_config: { ...(basico ? {} : { effort: 'low' }), format: { type: 'json_schema', schema } },
    ...(basico ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
  };
}

async function lerComClaude(buffer, mimetype, dicaQR, texto) {
  const bloco = mimetype === 'application/pdf' && texto
    ? { type: 'text', text: blocoTextoPdf(texto) }
    : mimetype === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } }
    : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: (await imagemJPEG(buffer)).toString('base64') } };

  const resp = await getAnthropic().beta.messages.create({
    model: PROVEDORES.anthropic.modelo(),
    max_tokens: 4000,
    ...opcoesClaude(SCHEMA),
    messages: [{ role: 'user', content: [bloco, { type: 'text', text: promptCom(dicaQR) }] }]
  }, { timeout: 120000 });

  if (resp.stop_reason === 'refusal') throw new Error('A IA recusou a leitura deste documento.');
  if (resp.stop_reason === 'max_tokens') throw new Error('Resposta da IA incompleta (max_tokens).');
  const json = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return { dados: JSON.parse(json), modelo: resp.model, uso: resp.usage };
}

// ---------------------------------------------------------------------------
/** PDF -> texto pela extração de arquivos da Moonshot (o arquivo é apagado em seguida). */
async function textoDoPdfMoonshot(buffer) {
  const cli = getMoonshot();
  const arq = await cli.files.create({ file: await toFile(buffer, 'nota.pdf', { type: 'application/pdf' }), purpose: 'file-extract' });
  try {
    const r = await cli.files.content(arq.id);
    const corpo = JSON.parse(await r.text());
    return String(corpo.content || '').trim();
  } finally {
    cli.files.delete(arq.id).catch(() => {});
  }
}

function extrairJSON(texto) {
  const t = String(texto || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const ini = t.indexOf('{'), fim = t.lastIndexOf('}');
  if (ini === -1 || fim === -1) throw new Error('A IA não devolveu JSON.');
  return JSON.parse(t.slice(ini, fim + 1));
}

async function lerComKimi(buffer, mimetype, dicaQR, texto) {
  const instrucao = `${promptCom(dicaQR)}\n\nResponda SOMENTE com um objeto JSON válido (sem texto antes ou depois) que siga exatamente este JSON Schema:\n${JSON.stringify(SCHEMA)}`;
  let content;
  if (mimetype === 'application/pdf') {
    texto = texto || await textoDoPdfMoonshot(buffer);
    if (texto.length < 40) throw new Error('Não foi possível extrair texto deste PDF (pode ser um PDF escaneado). Envie uma foto da nota.');
    content = `${instrucao}\n\n${blocoTextoPdf(texto)}`;
  } else {
    const img = (await imagemJPEG(buffer)).toString('base64');
    content = [
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img}` } },
      { type: 'text', text: instrucao }
    ];
  }

  const resp = await getMoonshot().chat.completions.create({
    model: PROVEDORES.kimi.modelo(),
    response_format: { type: 'json_object' },
    max_tokens: 16000,
    messages: [{ role: 'user', content }]
  });
  const escolha = resp.choices && resp.choices[0];
  if (!escolha) throw new Error('Resposta vazia do Kimi.');
  if (escolha.finish_reason === 'length') throw new Error('Resposta do Kimi incompleta (max_tokens).');
  return { dados: extrairJSON(escolha.message.content), modelo: resp.model || PROVEDORES.kimi.modelo(), uso: resp.usage };
}

// ---------------------------------------------------------------------------
// Classificação só de texto (itens que já vieram do XML da NF-e)
async function classificarComClaude(prompt) {
  const resp = await getAnthropic().beta.messages.create({
    model: PROVEDORES.anthropic.modelo(),
    max_tokens: 4000,
    ...opcoesClaude(SCHEMA_ITENS),
    messages: [{ role: 'user', content: prompt }]
  }, { timeout: 120000 });
  if (resp.stop_reason === 'refusal') throw new Error('A IA recusou a classificação.');
  if (resp.stop_reason === 'max_tokens') throw new Error('Resposta da IA incompleta (max_tokens).');
  return { dados: JSON.parse(resp.content.filter(b => b.type === 'text').map(b => b.text).join('')), modelo: resp.model };
}

async function classificarComKimi(prompt) {
  const resp = await getMoonshot().chat.completions.create({
    model: PROVEDORES.kimi.modelo(),
    response_format: { type: 'json_object' },
    max_tokens: 16000,
    messages: [{ role: 'user', content: `${prompt}

Responda SOMENTE com um objeto JSON válido que siga este JSON Schema:
${JSON.stringify(SCHEMA_ITENS)}` }]
  });
  const e = resp.choices && resp.choices[0];
  if (!e) throw new Error('Resposta vazia do Kimi.');
  if (e.finish_reason === 'length') throw new Error('Resposta do Kimi incompleta (max_tokens).');
  return { dados: extrairJSON(e.message.content), modelo: resp.model || PROVEDORES.kimi.modelo() };
}

// ---------------------------------------------------------------------------
// DeepSeek (API compatível com OpenAI)
/** PDF escaneado: renderiza as primeiras páginas como imagem (este provedor lê imagem, não PDF). */
async function paginasPdfComoImagens(buffer, max = 3) {
  const { PDFParse } = require('pdf-parse');
  const leitor = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const info = await leitor.getInfo();
    const partial = Array.from({ length: Math.min(info.total, max) }, (_, i) => i + 1);
    const r = await leitor.getScreenshot({ partial, desiredWidth: 1400, imageDataUrl: false, imageBuffer: true });
    return Promise.all(r.pages.map(p => sharp(Buffer.from(p.data)).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer()));
  } finally { leitor.destroy().catch(() => {}); }
}

async function chamarDeepseek(content, rotulo) {
  const resp = await getDeepseek().chat.completions.create({
    model: PROVEDORES.deepseek.modelo(),
    temperature: 0,
    max_tokens: 32000,   // o raciocínio consome tokens antes da resposta; 8000 chegou a faltar numa nota
    stream: false,
    // DEEPSEEK_THINKING=off desliga o raciocínio (mais rápido e barato); por padrão fica como a DeepSeek define
    ...(process.env.DEEPSEEK_THINKING === 'off' ? { thinking: { type: 'disabled' } } : {}),
    messages: [{ role: 'user', content }]
  });
  const escolha = resp.choices && resp.choices[0];
  if (!escolha) throw new Error('Resposta vazia do DeepSeek.');
  if (escolha.finish_reason === 'length') throw new Error('Resposta do DeepSeek incompleta (max_tokens).');
  if (!escolha.message.content) throw new Error('O DeepSeek não devolveu texto (' + rotulo + ').');
  return { dados: extrairJSON(escolha.message.content), modelo: resp.model || PROVEDORES.deepseek.modelo(), uso: resp.usage };
}

async function lerComDeepseek(buffer, mimetype, dicaQR, texto) {
  const instrucao = `${promptCom(dicaQR)}

Responda SOMENTE com um objeto JSON válido (sem texto antes ou depois) que siga exatamente este JSON Schema:
${JSON.stringify(SCHEMA)}`;
  const img = b => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b.toString('base64')}` } });
  let content;
  if (mimetype === 'application/pdf' && texto) {
    content = `${instrucao}

${blocoTextoPdf(texto)}`;
  } else if (mimetype === 'application/pdf') {
    content = [...(await paginasPdfComoImagens(buffer)).map(img), { type: 'text', text: instrucao }];
  } else {
    content = [img(await imagemJPEG(buffer)), { type: 'text', text: instrucao }];
  }
  return chamarDeepseek(content, 'leitura');
}

async function classificarComDeepseek(prompt) {
  return chamarDeepseek(`${prompt}

Responda SOMENTE com um objeto JSON válido que siga este JSON Schema:
${JSON.stringify(SCHEMA_ITENS)}`, 'classificação');
}

const LEITORES = { anthropic: lerComClaude, kimi: lerComKimi, deepseek: lerComDeepseek };
const CLASSIFICADORES = { anthropic: classificarComClaude, kimi: classificarComKimi, deepseek: classificarComDeepseek };

/** Provedor padrão: configuração salva pelo admin > IA_PROVEDOR do .env > anthropic. */
function provedorPadrao() {
  let p = null;
  try { p = require('../db').prepare("SELECT valor FROM config WHERE chave = 'ia_provedor'").get()?.valor; } catch (_) { /* sem tabela */ }
  p = p || process.env.IA_PROVEDOR || 'anthropic';
  return PROVEDORES[p] ? p : 'anthropic';
}

/**
 * @param {Buffer} buffer
 * @param {string} mimetype image/* ou application/pdf
 * @param {{dicaQR?: string, provedor?: string}} opts provedor força um provedor específico (sem alternativa)
 */
async function extrairComIA(buffer, mimetype, opts = {}) {
  return executar(opts, LEITORES, p => [buffer, mimetype, opts.dicaQR, opts.texto], 'leu a nota');
}

/** Classifica itens (texto) de uma NF-e lida do XML em lançamentos por categoria. */
async function classificarItens(nota, itens, opts = {}) {
  const dados = {
    estabelecimento: nota.estabelecimento, cidade: nota.cidade, uf: nota.uf,
    data_emissao: nota.data_emissao, hora_emissao: nota.hora_emissao, valor_total: nota.valor_total,
    itens: itens.map(i => ({ descricao: i.descricao, ncm: i.ncm, cfop: i.cfop, quantidade: i.quantidade, unidade: i.unidade, valor: i.valor }))
  };
  const prompt = `Você é um assistente de prestação de contas de viagens corporativas no Brasil.
Abaixo estão os dados de uma NF-e/NFC-e já extraídos do XML (confiáveis). Classifique os itens em LANÇAMENTOS por categoria.

${REGRAS_LANC}

O valor de cada item já inclui frete, seguro e outras despesas e já está sem o desconto. A soma dos lançamentos deve bater com valor_total;
se houver diferença (impostos, arredondamento), ajuste o maior lançamento. NCM 2710 e CFOP 5656/5667 indicam combustível; quantidade em L é litros.

Dados da nota:
${JSON.stringify(dados)}`;
  return executar(opts, CLASSIFICADORES, () => [prompt], 'classificou os itens');
}

/** Roda no provedor principal; se falhar, tenta o outro (quando houver chave). */
async function executar(opts, fabrica, args, verbo) {
  const forcado = opts.provedor && PROVEDORES[opts.provedor] ? opts.provedor : null;
  const principal = forcado || provedorPadrao();
  const ordem = forcado ? [principal] : [principal, ...Object.keys(PROVEDORES).filter(p => p !== principal && !PROVEDORES[p].experimental)];
  const candidatos = ordem.filter(temChave);
  if (!candidatos.length) throw new Error(`Chave da API não configurada no .env (${PROVEDORES[principal].envChave}).`);

  const erros = [];
  for (const p of candidatos) {
    const inicio = Date.now();
    try {
      const r = await fabrica[p](...args(p));
      console.log(`[ia] ${p} (${r.modelo}) ${verbo} em ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
      return { ...r, provedor: p, usouAlternativa: p !== principal };
    } catch (e) {
      console.error(`[ia] ${p} falhou:`, e.message);
      erros.push(`${PROVEDORES[p].nome}: ${e.message}`);
    }
  }
  throw new Error(erros.join(' | '));
}

function statusProvedores() {
  return Object.entries(PROVEDORES).map(([id, p]) => ({ id, nome: p.nome, modelo: p.modelo(), configurado: temChave(id) }));
}

module.exports = { extrairComIA, classificarItens, CATEGORIAS, statusProvedores, provedorPadrao, PROVEDORES };
