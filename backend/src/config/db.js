/**
 * config/db.js
 * Configuración y pool de conexiones a PostgreSQL usando la librería `pg`.
 * Se utiliza un Pool para reutilizar conexiones y mejorar el rendimiento.
 */

const { Pool } = require('pg');

// Crear el pool con variables de entorno; pg también acepta DATABASE_URL directamente
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'streamuru',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  // Número máximo de clientes en el pool
  max: 10,
  // Tiempo máximo (ms) que un cliente inactivo puede permanecer en el pool
  idleTimeoutMillis: 30_000,
  // Tiempo máximo (ms) de espera para obtener un cliente del pool
  connectionTimeoutMillis: 5_000,
});

// Evento de error en cliente inactivo (evita crashes no controlados)
pool.on('error', (err) => {
  console.error('[DB] Error inesperado en cliente inactivo del pool:', err.message);
});

/**
 * Función helper para ejecutar queries parametrizadas.
 * @param {string} text   - Consulta SQL con placeholders ($1, $2, ...)
 * @param {Array}  params - Valores para los placeholders
 * @returns {Promise<import('pg').QueryResult>}
 */
const query = (text, params) => pool.query(text, params);

/**
 * Verifica que la conexión a la BD es funcional al arrancar el servidor.
 * @returns {Promise<void>}
 */
const testConnection = async () => {
  const client = await pool.connect();
  try {
    await client.query('SELECT NOW()');
    console.log('[DB] Conexión a PostgreSQL establecida correctamente.');
  } finally {
    client.release();
  }
};

module.exports = { pool, query, testConnection };
