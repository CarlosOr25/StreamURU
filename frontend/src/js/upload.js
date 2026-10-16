/**
 * upload.js — Maneja el formulario de subida de video en upload.html.
 * Incluye validación de campos, barra de progreso y llamada a uploadFile().
 */

import { uploadFile } from './api.js';
import { isLoggedIn } from './auth.js';

// ─── Estado del módulo ────────────────────────────────────────────────────────
let isUploading = false;

// ─── Inicialización ───────────────────────────────────────────────────────────

/**
 * Inicializa el formulario de subida. Llámese cuando el DOM esté listo.
 */
export function initUpload() {
  // Redirigir si no está autenticado
  if (!isLoggedIn()) {
    window.location.href = '/login.html?redirect=upload';
    return;
  }

  const form       = document.getElementById('upload-form');
  const fileInput  = document.getElementById('video-file');
  const fileLabel  = document.getElementById('file-label');
  const progressWrap = document.getElementById('progress-wrap');
  const progressBar  = document.getElementById('progress-bar');
  const progressPct  = document.getElementById('progress-pct');
  const statusMsg    = document.getElementById('upload-status');
  const submitBtn    = document.getElementById('submit-btn');

  if (!form) return;

  // Actualizar etiqueta al seleccionar archivo
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) {
      fileLabel.textContent = file.name;
      fileLabel.classList.add('text-indigo-300');
    }
  });

  // Envío del formulario
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isUploading) return;

    const title       = document.getElementById('title').value.trim();
    const description = document.getElementById('description').value.trim();
    const visibility  = document.getElementById('visibility').value;
    const file        = fileInput?.files[0];

    // Validaciones básicas
    if (!title) return showError(statusMsg, 'El título es obligatorio.');
    if (!file)  return showError(statusMsg, 'Selecciona un archivo de video.');
    if (!file.type.startsWith('video/')) {
      return showError(statusMsg, 'El archivo seleccionado no es un video válido.');
    }

    // Preparar FormData
    const formData = new FormData();
    formData.append('title',       title);
    formData.append('description', description);
    formData.append('visibility',  visibility);
    formData.append('video',       file);

    // UI: inicio de subida
    isUploading = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Subiendo…';
    progressWrap?.classList.remove('hidden');
    clearStatus(statusMsg);

    try {
      const result = await uploadFile('/api/videos', formData, (pct) => {
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (progressPct) progressPct.textContent  = `${pct}%`;
      });

      // Éxito
      showSuccess(statusMsg, '¡Video subido exitosamente! Redirigiendo…');
      setTimeout(() => {
        window.location.href = result?.id
          ? `/player.html?id=${result.id}`
          : '/index.html';
      }, 1500);
    } catch (err) {
      console.error('[upload] Error:', err);
      showError(statusMsg, `Error al subir el video: ${err.message}`);
      isUploading = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Subir Video';
    }
  });
}

// ─── Helpers de UI ────────────────────────────────────────────────────────────

function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.className = 'mt-4 text-red-400 text-sm text-center';
}

function showSuccess(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.className = 'mt-4 text-green-400 text-sm text-center';
}

function clearStatus(el) {
  if (!el) return;
  el.textContent = '';
  el.className = '';
}
