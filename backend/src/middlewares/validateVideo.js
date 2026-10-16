/**
 * middlewares/validateVideo.js
 * Validación de tipo MIME real usando "magic bytes" (firma binaria del archivo).
 * El Content-Type declarado por el cliente puede ser falsificado; la firma
 * del buffer es la fuente de verdad.
 *
 * Firmas de referencia:
 *  - MP4:  bytes 4-7 = "ftyp" (0x66747970)  — ISO Base Media file format
 *  - WebM: bytes 0-3 = 0x1A 0x45 0xDF 0xA3  — EBML signature
 *  - OGG:  bytes 0-3 = "OggS" (0x4F676753)
 */

/**
 * Map de firmas conocidas con su detección.
 * @type {Array<{type: string, detect: (buf: Buffer) => boolean}>}
 */
const MAGIC_SIGNATURES = [
  {
    type: 'video/mp4',
    // Los bytes 4–7 del archivo contienen el string "ftyp"
    detect: (buf) =>
      buf.length > 11 &&
      buf[4] === 0x66 && // f
      buf[5] === 0x74 && // t
      buf[6] === 0x79 && // y
      buf[7] === 0x70,   // p
  },
  {
    type: 'video/webm',
    // Los primeros 4 bytes son la firma EBML de Matroska/WebM
    detect: (buf) =>
      buf.length > 3 &&
      buf[0] === 0x1a &&
      buf[1] === 0x45 &&
      buf[2] === 0xdf &&
      buf[3] === 0xa3,
  },
  {
    type: 'video/ogg',
    // Los primeros 4 bytes son "OggS"
    detect: (buf) =>
      buf.length > 3 &&
      buf[0] === 0x4f && // O
      buf[1] === 0x67 && // g
      buf[2] === 0x67 && // g
      buf[3] === 0x53,   // S
  },
];

/**
 * Detecta el tipo MIME real del buffer comparando magic bytes.
 * @param {Buffer} buffer - Buffer del archivo subido
 * @returns {string|null} - Tipo MIME detectado o null si no coincide ninguno
 */
const detectMimeType = (buffer) => {
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.detect(buffer)) return sig.type;
  }
  return null;
};

/**
 * Middleware que valida que el archivo subido sea realmente un video
 * reconocido por sus magic bytes.
 * Debe colocarse DESPUÉS del middleware de multer (req.file debe existir).
 */
const validateVideo = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió ningún archivo de video.' });
  }

  const realMime = detectMimeType(req.file.buffer);

  if (!realMime) {
    return res.status(415).json({
      error:
        'El archivo no es un video válido. Solo se aceptan MP4, WebM y OGG verificados por firma binaria.',
    });
  }

  // Sobrescribir el mimetype declarado con el detectado realmente
  req.file.mimetype = realMime;
  next();
};

module.exports = { validateVideo, detectMimeType };
