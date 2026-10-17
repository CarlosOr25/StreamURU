/**
 * api.js — Módulo de comunicación HTTP con el backend y el servidor de streaming.
 * Todas las peticiones agregan automáticamente el header Authorization si hay
 * un JWT almacenado en localStorage.
 */

const API_BASE = '/api';

// ─── Helpers internos ────────────────────────────────────────────────────────

/**
 * Construye los headers comunes para las peticiones JSON.
 * @returns {Headers}
 */
function buildHeaders(extra = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json', ...extra });
  const token = localStorage.getItem('streamuru_token');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

/**
 * Procesa la respuesta HTTP: lanza error si !ok, devuelve JSON o texto.
 * @param {Response} res
 */
async function handleResponse(res) {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      if (err.errors && Array.isArray(err.errors) && err.errors.length > 0) {
        message = err.errors.map((e) => e.msg || e.message).join(' | ');
      } else {
        message = err.message || err.error || message;
      }
    } catch (_) { /* sin cuerpo JSON */ }
    throw new Error(message);
  }
  const contentType = res.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res.text();
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * GET <url>
 * @param {string} url  Ruta relativa (e.g. '/api/videos') o absoluta.
 */
export async function get(url) {
  const res = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(),
  });
  return handleResponse(res);
}

/**
 * POST <url> con body JSON.
 * @param {string} url
 * @param {object} body
 */
export async function post(url, body = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

/**
 * PUT <url> con body JSON.
 * @param {string} url
 * @param {object} body
 */
export async function put(url, body = {}) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

/**
 * DELETE <url>.
 * @param {string} url
 */
export async function del(url) {
  const res = await fetch(url, {
    method: 'DELETE',
    headers: buildHeaders(),
  });
  return handleResponse(res);
}

/**
 * Subida de archivo multipart/form-data.
 * NO establece Content-Type manualmente para que el navegador agregue el
 * boundary correcto del FormData.
 * @param {string}   url
 * @param {FormData} formData
 * @param {function} [onProgress]  Callback(percent: number)
 */
export function uploadFile(url, formData, onProgress = null) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);

    // Agregar token si existe
    const token = localStorage.getItem('streamuru_token');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (_) { resolve(xhr.responseText); }
      } else {
        let msg = `HTTP ${xhr.status}`;
        try { msg = JSON.parse(xhr.responseText).message || msg; } catch (_) {}
        reject(new Error(msg));
      }
    };

    xhr.onerror = () => reject(new Error('Error de red al subir el archivo'));
    xhr.send(formData);
  });
}
