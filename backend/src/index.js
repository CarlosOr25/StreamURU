/**
 * src/index.js
 * Entry point del servidor Express para StreamURU Backend API.
 *
 * Responsabilidades:
 *  1. Cargar variables de entorno (.env)
 *  2. Configurar middlewares de seguridad (helmet, cors)
 *  3. Registrar rutas de la API
 *  4. Verificar conexión a PostgreSQL y disponibilidad del bucket MinIO
 *  5. Arrancar el servidor en el puerto configurado
 */

// Cargar variables de entorno ANTES de cualquier otra importación
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

// Configuraciones de infraestructura
const { testConnection } = require('./config/db');
const { ensureBucket } = require('./config/minio');

// Rutas
const authRoutes = require('./routes/auth');
const videoRoutes = require('./routes/videos');
const streamRoutes = require('./routes/stream');

// ─── Validación de variables de entorno críticas ───────────────────────────────
const REQUIRED_ENV = ['JWT_SECRET', 'STREAM_TICKET_SECRET'];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(
    `[Startup] FATAL: Las siguientes variables de entorno son requeridas y no están definidas: ${missingEnv.join(', ')}`
  );
  process.exit(1);
}

// ─── Inicializar app Express ───────────────────────────────────────────────────
const app = express();
const PORT = Number(process.env.PORT) || 4000;

// ─── Middlewares de seguridad ──────────────────────────────────────────────────

/**
 * helmet: Configura cabeceras HTTP de seguridad (X-Frame-Options, CSP, HSTS, etc.)
 * Protege contra ataques comunes como clickjacking, XSS via cabeceras, etc.
 */
app.use(helmet());

/**
 * cors: Controla qué orígenes pueden hacer peticiones a esta API.
 * En producción, reemplazar CORS_ORIGIN con el dominio real del frontend.
 */
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
app.use(
  cors({
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// ─── Middlewares de parseo ─────────────────────────────────────────────────────

// JSON bodies (limitado a 1MB para evitar DoS via body inflation)
app.use(express.json({ limit: '1mb' }));
// URL-encoded bodies
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'streamuru-backend', timestamp: new Date().toISOString() });
});

// ─── Rutas de la API ──────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/stream', streamRoutes);

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

// ─── Error handler global ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Global Error Handler]', err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production' ? 'Error interno del servidor.' : err.message,
  });
});

// ─── Arranque del servidor ─────────────────────────────────────────────────────

/**
 * Inicialización asíncrona: verificar BD y MinIO antes de aceptar peticiones.
 */
const start = async () => {
  try {
    // Verificar conexión a PostgreSQL
    await testConnection();

    // Verificar/crear bucket en MinIO
    await ensureBucket();

    // Arrancar servidor HTTP
    app.listen(PORT, () => {
      console.log(`\n🚀 StreamURU Backend API corriendo en http://0.0.0.0:${PORT}`);
      console.log(`   Entorno: ${process.env.NODE_ENV || 'development'}`);
      console.log(`   CORS permitido: ${CORS_ORIGIN}`);
      console.log(`   Health check: http://localhost:${PORT}/health\n`);
    });
  } catch (err) {
    console.error('[Startup] Error fatal al iniciar el servidor:', err.message);
    process.exit(1);
  }
};

// ─── Manejo de señales para shutdown limpio ────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('[Shutdown] Señal SIGTERM recibida. Cerrando servidor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Shutdown] Señal SIGINT recibida (Ctrl+C). Cerrando servidor...');
  process.exit(0);
});

start();
