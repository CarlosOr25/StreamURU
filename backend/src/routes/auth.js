/**
 * routes/auth.js
 * Rutas de autenticación con validaciones via express-validator.
 */

const { Router } = require('express');
const { body } = require('express-validator');
const { register, login, me } = require('../controllers/authController');
const { requireAuth } = require('../middlewares/auth');

const router = Router();

// ─── Validaciones ─────────────────────────────────────────────────────────────

const registerValidations = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('El username debe tener entre 3 y 50 caracteres.')
    .matches(/^[a-zA-Z0-9_.-]+$/)
    .withMessage('El username solo puede contener letras, números, _, . y -.'),
  body('email')
    .isEmail()
    .withMessage('El email no es válido.')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('La contraseña debe tener al menos 8 caracteres.')
    .matches(/[A-Z]/)
    .withMessage('La contraseña debe tener al menos una letra mayúscula.')
    .matches(/[0-9]/)
    .withMessage('La contraseña debe tener al menos un número.'),
];

const loginValidations = [
  body('email').isEmail().withMessage('Email inválido.').normalizeEmail(),
  body('password').notEmpty().withMessage('La contraseña es requerida.'),
];

// ─── Rutas ────────────────────────────────────────────────────────────────────

/** POST /api/auth/register — Registrar nuevo usuario */
router.post('/register', registerValidations, register);

/** POST /api/auth/login — Iniciar sesión, obtener JWT */
router.post('/login', loginValidations, login);

/** GET /api/auth/me — Datos del usuario autenticado */
router.get('/me', requireAuth, me);

module.exports = router;
