/**
 * config/minio.js
 * Cliente MinIO (compatible con S3) para almacenamiento de archivos de video.
 * MinIO se utiliza como almacenamiento de objetos; los videos se guardan con
 * nombre UUID para prevenir ataques de enumeración (IDOR).
 */

const Minio = require('minio');

// Nombre del bucket donde se almacenarán los videos
const BUCKET_NAME = process.env.MINIO_BUCKET || 'streamuru-videos';

// Inicializar cliente MinIO con credenciales del entorno
const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: Number(process.env.MINIO_PORT) || 9000,
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
});

/**
 * Asegura que el bucket exista; lo crea si es necesario.
 * Se llama al arrancar el servidor.
 * @returns {Promise<void>}
 */
const ensureBucket = async () => {
  const exists = await minioClient.bucketExists(BUCKET_NAME);
  if (!exists) {
    await minioClient.makeBucket(BUCKET_NAME, process.env.MINIO_REGION || 'us-east-1');
    console.log(`[MinIO] Bucket '${BUCKET_NAME}' creado.`);
  } else {
    console.log(`[MinIO] Bucket '${BUCKET_NAME}' verificado OK.`);
  }
};

/**
 * Sube un buffer al bucket MinIO.
 * @param {string} objectName - Nombre del objeto en el bucket (UUID)
 * @param {Buffer} buffer     - Contenido del archivo
 * @param {string} mimeType   - Tipo MIME del archivo
 * @returns {Promise<import('minio').UploadedObjectInfo>}
 */
const uploadBuffer = (objectName, buffer, mimeType) =>
  minioClient.putObject(BUCKET_NAME, objectName, buffer, buffer.length, {
    'Content-Type': mimeType,
  });

/**
 * Elimina un objeto del bucket.
 * @param {string} objectName - Nombre del objeto a eliminar
 * @returns {Promise<void>}
 */
const removeObject = (objectName) =>
  minioClient.removeObject(BUCKET_NAME, objectName);

module.exports = { minioClient, BUCKET_NAME, ensureBucket, uploadBuffer, removeObject };
