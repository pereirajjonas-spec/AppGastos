'use strict';
/**
 * Leitura do QR Code do DANFE / DANFE NFC-e a partir da foto.
 *
 * Estrategia: foto de nota costuma estar torta, com sombra e baixo contraste.
 * Em vez de uma unica tentativa, geramos varias versoes da imagem
 * (escala, rotacao, recorte, binarizacao) e paramos na primeira que decodificar.
 */

const { abrirImagem } = require('./imagem');
const jsQR = require('jsqr');
let QrCodeReader = null;
try { QrCodeReader = require('qrcode-reader'); } catch (_) { /* opcional */ }

const { extrairChaveDeTexto } = require('./chave');

async function paraRGBA(pipeline) {
  // jsQR exige RGBA (4 bytes por pixel). grayscale()/threshold() devolvem 1 canal
  // e o sharp nao expande de forma confiavel, entao montamos o RGBA aqui.
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const total = width * height;

  if (channels === 4 && data.length === total * 4) {
    return { data: new Uint8ClampedArray(data), width, height };
  }

  const rgba = new Uint8ClampedArray(total * 4);
  for (let i = 0; i < total; i++) {
    const o = i * channels;
    const r = data[o];
    const g = channels >= 3 ? data[o + 1] : r;
    const b = channels >= 3 ? data[o + 2] : r;
    const d = i * 4;
    rgba[d] = r; rgba[d + 1] = g; rgba[d + 2] = b; rgba[d + 3] = 255;
  }
  return { data: rgba, width, height };
}

function tentarJsQR(img) {
  for (const inv of ['dontInvert', 'attemptBoth']) {
    try {
      const r = jsQR(img.data, img.width, img.height, { inversionAttempts: inv });
      if (r && r.data) return r.data;
    } catch (_) { /* variacao invalida, tenta a proxima */ }
  }
  return null;
}

function tentarQrCodeReader(img) {
  if (!QrCodeReader) return null;
  return new Promise((resolve) => {
    try {
      const qr = new QrCodeReader();
      const timer = setTimeout(() => resolve(null), 4000);
      qr.callback = (err, value) => {
        clearTimeout(timer);
        resolve(err || !value ? null : value.result);
      };
      qr.decode({ width: img.width, height: img.height, data: img.data });
    } catch (_) { resolve(null); }
  });
}

/** Gera as variacoes da imagem que serao testadas, da mais provavel para a menos. */
function* variacoes(buffer, meta) {
  const larguras = [1400, 2000, 900];
  const rotacoes = [0, 90, 270, 180];

  for (const rot of rotacoes) {
    for (const w of larguras) {
      // 1) cinza + normalizacao de contraste
      yield {
        nome: `rot${rot}_w${w}_norm`,
        pipe: () => abrirImagem(buffer).rotate(rot).resize({ width: w, withoutEnlargement: false }).grayscale().normalize()
      };
      // 2) cinza + binarizacao (resolve sombra e papel amarelado)
      yield {
        nome: `rot${rot}_w${w}_bin`,
        pipe: () => abrirImagem(buffer).rotate(rot).resize({ width: w }).grayscale().normalize().sharpen().threshold(140)
      };
    }
  }

  // 3) recortes: o QR quase sempre esta no rodape (NFC-e) ou no topo (DANFE NF-e)
  if (meta && meta.width && meta.height) {
    const H = meta.height, W = meta.width;
    const recortes = [
      { nome: 'rodape', top: Math.floor(H * 0.55), height: Math.floor(H * 0.45) },
      { nome: 'topo',   top: 0,                    height: Math.floor(H * 0.45) },
      { nome: 'meio',   top: Math.floor(H * 0.30), height: Math.floor(H * 0.40) }
    ];
    for (const r of recortes) {
      yield {
        nome: `crop_${r.nome}`,
        pipe: () => abrirImagem(buffer)
          .extract({ left: 0, top: r.top, width: W, height: Math.min(r.height, H - r.top) })
          .resize({ width: 1600 }).grayscale().normalize().sharpen()
      };
      yield {
        nome: `crop_${r.nome}_bin`,
        pipe: () => abrirImagem(buffer)
          .extract({ left: 0, top: r.top, width: W, height: Math.min(r.height, H - r.top) })
          .resize({ width: 1600 }).grayscale().normalize().threshold(140)
      };
    }
  }
}

/**
 * Le o QR Code de uma imagem.
 * @param {Buffer} buffer imagem original
 * @returns {Promise<{texto:string, chave:string|null, variacao:string}|null>}
 */
async function lerQrCode(buffer) {
  let meta = null;
  try { meta = await abrirImagem(buffer).metadata(); } catch (_) { return null; }

  for (const v of variacoes(buffer, meta)) {
    let img;
    try { img = await paraRGBA(v.pipe()); } catch (_) { continue; }

    let texto = tentarJsQR(img);
    if (!texto) texto = await tentarQrCodeReader(img);

    if (texto) {
      return { texto, chave: extrairChaveDeTexto(texto), variacao: v.nome };
    }
  }
  return null;
}

module.exports = { lerQrCode };
