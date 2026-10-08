'use strict';
/**
 * Abertura segura de imagens enviadas por usuários.
 *  - limitInputPixels: recusa imagens "bomba" (poucos KB que viram centenas de milhões de pixels na memória).
 *    80 milhões cobre qualquer câmera de celular (50 MP) com folga.
 *  - FORMATOS_IMAGEM: só os formatos de foto de nota; SVG, TIFF, ícones etc. ficam de fora
 *    (menos superfície de ataque nas bibliotecas de imagem).
 */
const sharp = require('sharp');

const LIMITE_PIXELS = 80e6;
const FORMATOS_IMAGEM = ['jpeg', 'png', 'webp', 'gif'];
const MIMES_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const abrirImagem = (entrada, opcoes = {}) => sharp(entrada, { limitInputPixels: LIMITE_PIXELS, ...opcoes });

/**
 * Confere pelo CONTEÚDO (não pelo tipo informado no envio) se o arquivo é o que diz ser.
 * @returns {Promise<string|null>} mensagem de erro, ou null se estiver ok
 */
async function validarConteudo(buffer, mimetype) {
  if (mimetype === 'application/pdf') {
    return buffer.slice(0, 5).toString('latin1') === '%PDF-' ? null : 'O arquivo não é um PDF válido.';
  }
  if (mimetype === 'application/xml') {
    return /^\s*(<\?xml|<)/.test(buffer.slice(0, 200).toString('utf8').replace(/^﻿/, '')) ? null : 'O arquivo não é um XML válido.';
  }
  try {
    const meta = await abrirImagem(buffer).metadata();
    if (!FORMATOS_IMAGEM.includes(meta.format)) return 'Formato de imagem não aceito. Use JPG, PNG ou WebP.';
    return null;
  } catch (e) {
    return /pixel/i.test(e.message) ? 'Imagem grande demais (mais de 80 megapixels).' : 'Não consegui abrir a imagem. Envie outra foto.';
  }
}

module.exports = { abrirImagem, validarConteudo, MIMES_IMAGEM, FORMATOS_IMAGEM, LIMITE_PIXELS };
