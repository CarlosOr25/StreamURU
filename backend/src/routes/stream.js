/**
 * routes/stream.js
 * Ruta para generación de stream tickets efímeros.
 */

const { Router } = require('express');
const { param } = require('express-validator');
const { requireAuth } = require('../middlewares/auth');
const { getStreamTicket } = require('../controllers/streamController');

const router = Router();

/**
 * POST /api/stream/:videoId/ticket
 * Genera un JWT efímero (60s) que el cliente presenta al servidor UDP de streaming.
 * Requiere autenticación JWT de sesión.
 */
router.post(
  '/:videoId/ticket',
  requireAuth,
  [param('videoId').isUUID().withMessage('El videoId no es un UUID válido.')],
  getStreamTicket
);

module.exports = router;
