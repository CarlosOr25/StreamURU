/**
 * utils/ticketGenerator.js
 * Generación y verificación de tickets efímeros para el servicio de streaming UDP.
 *
 * Un "stream ticket" es un JWT firmado con STREAM_TICKET_SECRET (clave independiente
 * del JWT de sesión) que tiene una vida útil muy corta (60 segundos por defecto).
 * El servidor UDP valida este ticket antes de iniciar la transmisión.
 *
 * Seguridad:
 *  - Clave separada de JWT_SECRET para limitar el impacto de compromisos parciales.
 *  - Expiración corta (60s) para minimizar la ventana de reutilización.
 *  - El payload incluye videoId, userId y visibility para que el servidor UDP
 *    pueda verificar el acceso sin consultar la BD.
 */

const jwt = require('jsonwebtoken');

// Expiración del ticket en segundos (configurable por entorno)
const TICKET_TTL_SECONDS = Number(process.env.STREAM_TICKET_TTL || 60);

/**
 * Genera un stream ticket firmado.
 * @param {object} params
 * @param {string} params.videoId    - ID del video solicitado
 * @param {string} params.userId     - ID del usuario que solicita el stream
 * @param {string} params.visibility - Visibilidad del video ('public'|'unlisted'|'private')
 * @returns {string} JWT firmado
 */
const generateTicket = ({ videoId, userId, storageKey, visibility }) => {
  const secret = process.env.STREAM_TICKET_SECRET;
  if (!secret) {
    throw new Error('STREAM_TICKET_SECRET no está configurado.');
  }

  return jwt.sign(
    {
      videoId,
      userId,
      storageKey,
      visibility,
      // 'purpose' es un claim custom que permite distinguir este token de un JWT de sesión
      purpose: 'stream_ticket',
    },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: TICKET_TTL_SECONDS,
    }
  );
};

/**
 * Verifica y decodifica un stream ticket.
 * @param {string} token - JWT del ticket
 * @returns {object} Payload decodificado
 * @throws {Error} Si el token es inválido, expirado o no es un ticket de stream
 */
const verifyTicket = (token) => {
  const secret = process.env.STREAM_TICKET_SECRET;
  if (!secret) {
    throw new Error('STREAM_TICKET_SECRET no está configurado.');
  }

  const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });

  // Verificar que el token es efectivamente un stream ticket y no un JWT de sesión
  if (payload.purpose !== 'stream_ticket') {
    throw new Error('El token no es un stream ticket válido.');
  }

  return payload;
};

module.exports = { generateTicket, verifyTicket, TICKET_TTL_SECONDS };
