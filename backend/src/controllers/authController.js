/**
 * controllers/authController.js
 * Controladores para registro, login y consulta del usuario autenticado.
 *
 * Seguridad:
 *  - Contraseñas hasheadas con bcrypt (cost factor 12).
 *  - Respuestas de error genéricas para evitar user enumeration en login.
 *  - JWT con expiración configurable (default 7d).
 */

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const { query } = require('../config/db');

// Factor de coste de bcrypt: 12 ofrece buen balance seguridad/rendimiento
const BCRYPT_ROUNDS = 12;
// Expiración del JWT de sesión
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * POST /api/auth/register
 * Registra un nuevo usuario.
 */
const register = async (req, res) => {
  // Verificar errores de validación (express-validator)
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { username, email, password } = req.body;

  try {
    // Hashear la contraseña
    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Insertar usuario; la BD lanzará error si username o email ya existen (UNIQUE)
    const result = await query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, created_at`,
      [username.trim(), email.toLowerCase().trim(), password_hash]
    );

    const user = result.rows[0];

    // Generar token JWT para que el usuario quede autenticado inmediatamente
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.status(201).json({
      message: 'Usuario registrado exitosamente.',
      user: { id: user.id, username: user.username, email: user.email, created_at: user.created_at },
      token,
    });
  } catch (err) {
    // Código 23505 = violación de restricción UNIQUE en PostgreSQL
    if (err.code === '23505') {
      const field = err.constraint?.includes('email') ? 'email' : 'username';
      return res.status(409).json({ error: `El ${field} ya está en uso.` });
    }
    console.error('[authController.register]', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

/**
 * POST /api/auth/login
 * Autentica un usuario y devuelve un JWT.
 */
const login = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    // Buscar usuario por email
    const result = await query(
      'SELECT id, username, email, password_hash FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    const user = result.rows[0];

    // Mensaje genérico para evitar user enumeration
    const INVALID_CREDS = 'Credenciales incorrectas.';

    if (!user) {
      // Realizar comparación ficticia para mitigar timing attacks
      await bcrypt.compare(password, '$2b$12$invalidhashpadding000000000000000000000000000000000000');
      return res.status(401).json({ error: INVALID_CREDS });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: INVALID_CREDS });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.status(200).json({
      message: 'Login exitoso.',
      user: { id: user.id, username: user.username, email: user.email },
      token,
    });
  } catch (err) {
    console.error('[authController.login]', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

/**
 * GET /api/auth/me
 * Devuelve los datos del usuario autenticado (requiere JWT válido).
 */
const me = async (req, res) => {
  try {
    const result = await query(
      'SELECT id, username, email, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    return res.status(200).json({ user: result.rows[0] });
  } catch (err) {
    console.error('[authController.me]', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

module.exports = { register, login, me };
