/**
 * middlewares/upload.js
 * Configuración de Multer para recibir archivos de video en memoria.
 * NO se escribe nada en disco; el buffer se procesa en el controlador
 * antes de subirlo a MinIO.
 */

const multer = require('multer');

// Tamaño máximo de archivo: 500 MB (ajustable por variable de entorno)
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE_MB || 500) * 1024 * 1024;

// Tipos MIME permitidos a nivel de cabecera (verificación superficial).
// La validación real por magic bytes se realiza en validateVideo.js.
const ALLOWED_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
]);

// Almacenamiento en memoria: el archivo queda disponible en req.file.buffer
const storage = multer.memoryStorage();

/**
 * Filtro de tipo MIME declarativo (Content-Type del cliente).
 * Nota: Este filtro es la primera línea de defensa; no es suficiente por sí solo
 * ya que el cliente puede falsificar el Content-Type. Por eso también se validan
 * los magic bytes en validateVideo.js.
 */
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Tipo de archivo no permitido: ${file.mimetype}. Solo se aceptan video/mp4, video/webm, video/ogg.`
      ),
      false
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1, // Solo un archivo por petición
  },
});

/**
 * Middleware que maneja errores de Multer de forma centralizada.
 * Debe colocarse DESPUÉS del middleware de Multer en la cadena de routes.
 */
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `El archivo excede el tamaño máximo permitido de ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
      });
    }
    return res.status(400).json({ error: `Error de subida: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
};

module.exports = { upload, handleMulterError };
