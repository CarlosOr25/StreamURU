/**
 * controllers/videoController.js
 * Controladores CRUD para videos con reglas de visibilidad y almacenamiento en MinIO.
 *
 * Reglas de visibilidad:
 *  - 'public'   → visible para todos, aparece en listado público.
 *  - 'unlisted' → accesible por ID directo, no aparece en listado público.
 *  - 'private'  → solo el dueño puede verlo.
 *
 * Seguridad:
 *  - Nombres de archivo en MinIO son UUIDs (previene IDOR y path traversal).
 *  - El usuario_id se extrae del JWT, nunca del body de la petición.
 *  - Al eliminar un video se elimina también el objeto en MinIO.
 */

const { v4: uuidv4 } = require('uuid');
const { validationResult } = require('express-validator');
const { query } = require('../config/db');
const { uploadBuffer, removeObject } = require('../config/minio');

/**
 * POST /api/videos/upload
 * Sube un video a MinIO y registra sus metadatos en la BD.
 */
const upload = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  // req.file.buffer está disponible gracias a multer memoryStorage
  // req.file.mimetype ha sido verificado por validateVideo.js (magic bytes)
  const { title, description = '', visibility = 'public' } = req.body;
  const userId = req.user.userId;
  const file = req.file;

  // Generar un nombre de objeto UUID para prevenir IDOR y colisiones
  const storageKey = `${uuidv4()}-${Date.now()}`;

  try {
    // 1. Subir el buffer a MinIO
    await uploadBuffer(storageKey, file.buffer, file.mimetype);

    // 2. Registrar los metadatos en PostgreSQL
    const result = await query(
      `INSERT INTO videos (user_id, title, description, visibility, storage_key, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, title, description, visibility, mime_type, size_bytes, created_at`,
      [userId, title.trim(), description.trim(), visibility, storageKey, file.mimetype, file.size]
    );

    return res.status(201).json({
      message: 'Video subido exitosamente.',
      video: result.rows[0],
    });
  } catch (err) {
    // Si la BD falla después de subir a MinIO, intentar limpiar el objeto huérfano
    try { await removeObject(storageKey); } catch { /* ignorar error de limpieza */ }

    console.error('[videoController.upload]', err);
    return res.status(500).json({ error: 'Error al procesar el video.' });
  }
};

/**
 * GET /api/videos
 * Lista todos los videos públicos (paginados).
 */
const list = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  try {
    const result = await query(
      `SELECT v.id, v.title, v.description, v.visibility, v.mime_type,
              v.size_bytes, v.created_at, u.username AS author
       FROM videos v
       JOIN users u ON u.id = v.user_id
       WHERE v.visibility = 'public'
       ORDER BY v.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await query(
      "SELECT COUNT(*) FROM videos WHERE visibility = 'public'"
    );
    const total = parseInt(countResult.rows[0].count);

    return res.status(200).json({
      videos: result.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('[videoController.list]', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

/**
 * GET /api/videos/:id
 * Obtiene un video por ID respetando las reglas de visibilidad.
 * req.user puede ser null (via optionalAuth) si no está autenticado.
 */
const getById = async (req, res) => {
  const { id } = req.params;
  const requestingUserId = req.user?.userId || null;

  try {
    const result = await query(
      `SELECT v.id, v.user_id, v.title, v.description, v.visibility,
              v.storage_key, v.mime_type, v.size_bytes, v.created_at, v.updated_at,
              u.username AS author
       FROM videos v
       JOIN users u ON u.id = v.user_id
       WHERE v.id = $1`,
      [id]
    );

    const video = result.rows[0];

    if (!video) {
      return res.status(404).json({ error: 'Video no encontrado.' });
    }

    // Verificar permisos según visibilidad
    if (video.visibility === 'private' && video.user_id !== requestingUserId) {
      // Devolver 404 en lugar de 403 para no revelar la existencia del video
      return res.status(404).json({ error: 'Video no encontrado.' });
    }

    // Omitir storage_key de la respuesta (información interna del bucket)
    const { storage_key, ...safeVideo } = video;

    return res.status(200).json({ video: safeVideo });
  } catch (err) {
    console.error('[videoController.getById]', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

/**
 * PUT /api/videos/:id
 * Edita los metadatos de un video (solo el dueño).
 */
const update = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const userId = req.user.userId;
  const { title, description, visibility } = req.body;

  try {
    // Verificar existencia y propiedad en una sola query
    const existing = await query(
      'SELECT id, user_id FROM videos WHERE id = $1',
      [id]
    );

    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Video no encontrado.' });
    }

    if (existing.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'No tienes permiso para editar este video.' });
    }

    // Construir la query de actualización dinámicamente con solo los campos provistos
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(title.trim());
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description.trim());
    }
    if (visibility !== undefined) {
      updates.push(`visibility = $${paramIndex++}`);
      values.push(visibility);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No se proporcionaron campos para actualizar.' });
    }

    values.push(id); // Para el WHERE id = $N
    const result = await query(
      `UPDATE videos SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, title, description, visibility, updated_at`,
      values
    );

    return res.status(200).json({
      message: 'Video actualizado.',
      video: result.rows[0],
    });
  } catch (err) {
    console.error('[videoController.update]', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

/**
 * DELETE /api/videos/:id
 * Elimina el video de la BD y su objeto en MinIO (solo el dueño).
 */
const remove = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;

  try {
    const existing = await query(
      'SELECT id, user_id, storage_key FROM videos WHERE id = $1',
      [id]
    );

    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Video no encontrado.' });
    }

    if (existing.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar este video.' });
    }

    const { storage_key } = existing.rows[0];

    // 1. Eliminar de la BD primero (si falla MinIO, el objeto queda huérfano pero la referencia se va)
    await query('DELETE FROM videos WHERE id = $1', [id]);

    // 2. Eliminar el objeto de MinIO (no crítico si falla; puede manejarse con un job de limpieza)
    try {
      await removeObject(storage_key);
    } catch (minioErr) {
      console.warn('[videoController.remove] Error al eliminar objeto de MinIO:', minioErr.message);
    }

/**
 * GET /api/videos/mine
 * Lista todos los videos del usuario autenticado (public, unlisted, private).
 */
const listMine = async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await query(
      `SELECT v.id, v.title, v.description, v.visibility, v.mime_type,
              v.size_bytes, v.created_at, v.updated_at, u.username AS author
       FROM videos v
       JOIN users u ON u.id = v.user_id
       WHERE v.user_id = $1
       ORDER BY v.created_at DESC`,
      [userId]
    );

    return res.status(200).json({ videos: result.rows });
  } catch (err) {
    console.error('[videoController.listMine]', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

module.exports = { upload, list, getById, update, remove, listMine };

