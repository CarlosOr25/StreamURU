/**
 * routes/videos.js
 * Rutas CRUD de videos con middleware de autenticación, subida y validación.
 */

const { Router } = require('express');
const { body, param } = require('express-validator');
const { upload, handleMulterError } = require('../middlewares/upload');
const { validateVideo } = require('../middlewares/validateVideo');
const { requireAuth, optionalAuth } = require('../middlewares/auth');
const {
  upload: uploadVideo,
  list,
  getById,
  update,
  remove,
  listMine,
} = require('../controllers/videoController');

const router = Router();

// ─── Validaciones compartidas ─────────────────────────────────────────────────

const visibilityValues = ['public', 'unlisted', 'private'];

const uploadValidations = [
  body('title')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('El título debe tener entre 1 y 255 caracteres.'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 5000 })
    .withMessage('La descripción no puede exceder 5000 caracteres.'),
  body('visibility')
    .optional()
    .isIn(visibilityValues)
    .withMessage(`La visibilidad debe ser: ${visibilityValues.join(', ')}.`),
];

const updateValidations = [
  param('id').isUUID().withMessage('El ID del video no es válido.'),
  body('title')
    .optional()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('El título debe tener entre 1 y 255 caracteres.'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 5000 })
    .withMessage('La descripción no puede exceder 5000 caracteres.'),
  body('visibility')
    .optional()
    .isIn(visibilityValues)
    .withMessage(`La visibilidad debe ser: ${visibilityValues.join(', ')}.`),
];

const idValidation = [
  param('id').isUUID().withMessage('El ID del video no es válido.'),
];

// ─── Rutas ────────────────────────────────────────────────────────────────────

/**
 * POST /api/videos/upload
 * Subir un video. Cadena de middlewares:
 *  1. requireAuth    → verificar JWT
 *  2. upload.single  → recibir archivo en memoria
 *  3. handleMulterError → manejar errores de multer
 *  4. validateVideo  → verificar magic bytes
 *  5. uploadValidations → validar campos de texto
 *  6. uploadVideo    → controlador
 */
router.post(
  '/upload',
  requireAuth,
  upload.single('video'),
  handleMulterError,
  validateVideo,
  uploadValidations,
  uploadVideo
);

/** GET /api/videos — Listar videos públicos (sin autenticación) */
router.get('/', list);

/** GET /api/videos/mine — Listar videos del usuario autenticado (requiere JWT) */
router.get('/mine', requireAuth, listMine);

/**
 * GET /api/videos/:id — Obtener video por ID.
 * optionalAuth permite que usuarios autenticados accedan a videos privados propios.
 */
router.get('/:id', idValidation, optionalAuth, getById);

/** PUT /api/videos/:id — Editar video (solo dueño, requiere JWT) */
router.put('/:id', requireAuth, updateValidations, update);

/** DELETE /api/videos/:id — Eliminar video y objeto MinIO (solo dueño) */
router.delete('/:id', requireAuth, idValidation, remove);

module.exports = router;
