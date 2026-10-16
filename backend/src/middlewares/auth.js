/**
 * middlewares/auth.js
 * Middleware de autenticación JWT.
 * Extrae el Bearer token del header Authorization, lo verifica y adjunta
 * el payload decodificado a req.user para uso en controladores posteriores.
 */

const jwt = require('jsonwebtoken');

/**
 * Middleware de autenticación requerida.
 * Rechaza peticiones sin token válido con 401.
 */
const requireAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  // El header debe tener el formato: "Bearer <token>"
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Token de autenticación requerido.',
    });
  }

  const token = authHeader.slice(7); // Extraer el token después de "Bearer "

  try {
    // Verificar y decodificar el token con la clave secreta
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Adjuntar el payload al objeto request para controladores subsiguientes
    req.user = payload;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'El token ha expirado.' });
    }
    return res.status(401).json({ error: 'Token inválido.' });
  }
};

/**
 * Middleware de autenticación opcional.
 * Si hay token y es válido lo adjunta, si no continúa sin req.user.
 * Útil para rutas que cambian comportamiento según si el usuario está autenticado.
 */
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.slice(7);

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    req.user = null;
  }
  next();
};

module.exports = { requireAuth, optionalAuth };
