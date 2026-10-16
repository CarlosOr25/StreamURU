/**
 * ticketVerifier.js
 * -----------------
 * Verifica el ticket JWT efímero generado por el Backend API.
 *
 * El Backend firma el ticket con STREAM_TICKET_SECRET y lo entrega al cliente
 * con una vida útil de 60 segundos. Este módulo valida:
 *   - Firma criptográfica del token (HS256)
 *   - Expiración del token
 *   - Presencia de los claims obligatorios: videoId, userId, storageKey
 *
 * Uso:
 *   const { verifyStreamTicket } = require('./ticketVerifier');
 *   const payload = verifyStreamTicket(token); // lanza Error si inválido
 */

'use strict';

const jwt = require('jsonwebtoken');

/**
 * Verifica y decodifica un ticket JWT de streaming.
 *
 * @param {string} token - JWT firmado por el Backend API
 * @returns {{ videoId: string, userId: string|number, storageKey: string, iat: number, exp: number }}
 * @throws {Error} Si el token es inválido, expirado o le faltan claims
 */
function verifyStreamTicket(token) {
  const secret = process.env.STREAM_TICKET_SECRET;

  if (!secret) {
    throw new Error(
      'STREAM_TICKET_SECRET no está configurado en las variables de entorno'
    );
  }

  if (!token || typeof token !== 'string') {
    throw new Error('Token de streaming no proporcionado o inválido');
  }

  let payload;
  try {
    // jwt.verify lanza si la firma es incorrecta o el token expiró
    payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
    });
  } catch (err) {
    // Distinguimos entre expirado y otros errores para mejores mensajes de log
    if (err.name === 'TokenExpiredError') {
      throw new Error(`Ticket de streaming expirado a las ${err.expiredAt}`);
    }
    if (err.name === 'JsonWebTokenError') {
      throw new Error(`Ticket de streaming con firma inválida: ${err.message}`);
    }
    throw new Error(`Error verificando ticket: ${err.message}`);
  }

  // Validación de claims obligatorios
  const required = ['videoId', 'userId', 'storageKey'];
  for (const claim of required) {
    if (payload[claim] === undefined || payload[claim] === null) {
      throw new Error(`Ticket inválido: falta el claim '${claim}'`);
    }
  }

  return payload;
}

module.exports = { verifyStreamTicket };
