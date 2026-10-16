/**
 * controllers/streamController.js
 * Controlador para la generación de stream tickets efímeros.
 *
 * El flujo es:
 *  1. Cliente HTTP autenticado solicita un ticket para un videoId.
 *  2. Este endpoint verifica que el usuario tiene acceso al video.
 *  3. Si tiene acceso, genera un JWT firmado con STREAM_TICKET_SECRET (TTL: 60s).
 *  4. El cliente presenta ese ticket al servidor UDP de streaming (fuera de este servicio).
 *  5. El servidor UDP verifica el ticket con verifyTicket() sin consultar la BD.
 *
 * Nota: El servidor UDP consumidor de estos tickets debe importar y usar
 * verifyTicket() de utils/ticketGenerator.js para validar el token.
 */

const { query } = require('../config/db');
const { generateTicket, TICKET_TTL_SECONDS } = require('../utils/ticketGenerator');

/**
 * POST /api/stream/:videoId/ticket
 * Genera un stream ticket efímero para el video solicitado.
 * Requiere JWT de sesión válido (requireAuth middleware).
 */
const getStreamTicket = async (req, res) => {
  const { videoId } = req.params;
  const userId = req.user.userId;

  try {
    // Obtener metadatos del video para verificar acceso y storage_key
    const result = await query(
      'SELECT id, user_id, visibility, storage_key FROM videos WHERE id = $1',
      [videoId]
    );

    const video = result.rows[0];

    if (!video) {
      return res.status(404).json({ error: 'Video no encontrado.' });
    }

    // Verificar permisos según visibilidad
    switch (video.visibility) {
      case 'public':
      case 'unlisted':
        // Cualquier usuario autenticado puede acceder
        break;
      case 'private':
        // Solo el dueño puede obtener un ticket
        if (video.user_id !== userId) {
          // 404 para no revelar existencia del video privado
          return res.status(404).json({ error: 'Video no encontrado.' });
        }
        break;
      default:
        return res.status(500).json({ error: 'Estado de visibilidad desconocido.' });
    }

    // Generar el ticket JWT efímero con storageKey
    const ticket = generateTicket({
      videoId: video.id,
      userId,
      storageKey: video.storage_key,
      visibility: video.visibility,
    });

    return res.status(200).json({
      ticket,
      expiresIn: TICKET_TTL_SECONDS,
      message: `Ticket válido por ${TICKET_TTL_SECONDS} segundos. Úsalo en el servidor de streaming UDP.`,
    });
  } catch (err) {
    console.error('[streamController.getStreamTicket]', err);
    return res.status(500).json({ error: 'Error al generar el ticket de stream.' });
  }
};

module.exports = { getStreamTicket };
