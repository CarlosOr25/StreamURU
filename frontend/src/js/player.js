/**
 * player.js — Cliente WebRTC/UDP para reproducir video en StreamURU.
 *
 * Flujo:
 *  1. Leer ?id= de la URL → obtener metadatos del video.
 *  2. POST /api/stream/<id>/ticket → obtener ticket efímero.
 *  3. POST /stream/start  { ticket } → recibir oferta SDP del servidor de streaming.
 *  4. Crear RTCPeerConnection, procesar oferta, generar answer.
 *  5. POST /stream/answer { answer, ticket } → servidor completa el handshake WebRTC.
 *  6. Recibir chunks de video por DataChannel → acumular en MediaSource/SourceBuffer.
 */

import { get, post } from './api.js';

// ─── Constantes ────────────────────────────────────────────────────────────────
const MIME_TYPE = 'video/webm; codecs="vp8,opus"'; // MIME esperado del servidor

// ─── Estado global del reproductor ────────────────────────────────────────────
let peerConnection = null;
let mediaSource    = null;
let sourceBuffer   = null;
let chunkQueue     = [];  // Cola de chunks si el SourceBuffer está ocupado
let isAppending    = false;

// ─── Helpers de UI ─────────────────────────────────────────────────────────────

/** Actualiza el badge de estado de conexión. */
function setStatus(msg, type = 'info') {
  const el = document.getElementById('connection-status');
  if (!el) return;

  const map = {
    info:       'bg-gray-700 text-gray-200',
    connecting: 'bg-yellow-700 text-yellow-100',
    playing:    'bg-green-700 text-green-100',
    error:      'bg-red-800 text-red-100',
  };
  el.className = `inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${map[type] || map.info}`;
  el.textContent = msg;
}

/** Rellena los metadatos del video en la UI. */
function renderVideoInfo(video) {
  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '';
  };
  setText('video-title',       video.title);
  setText('video-description', video.description);
  setText('video-owner',       video.owner_name || 'Desconocido');
  document.title = `${video.title} — StreamURU`;
}

// ─── MediaSource helpers ───────────────────────────────────────────────────────

/** Inicializa el MediaSource y lo enlaza al elemento <video>. */
function initMediaSource(videoEl) {
  return new Promise((resolve, reject) => {
    if (!MediaSource.isTypeSupported(MIME_TYPE)) {
      reject(new Error(`MIME no soportado: ${MIME_TYPE}`));
      return;
    }

    mediaSource = new MediaSource();
    videoEl.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener('sourceopen', () => {
      try {
        sourceBuffer = mediaSource.addSourceBuffer(MIME_TYPE);
        sourceBuffer.addEventListener('updateend', flushQueue);
        resolve(sourceBuffer);
      } catch (err) {
        reject(err);
      }
    });

    mediaSource.addEventListener('error', () =>
      reject(new Error('MediaSource error')));
  });
}

/** Agrega un chunk al SourceBuffer o a la cola si está ocupado. */
function appendChunk(chunk) {
  if (!sourceBuffer) return;
  chunkQueue.push(chunk);
  flushQueue();
}

/** Envía el siguiente chunk de la cola al SourceBuffer. */
function flushQueue() {
  if (isAppending || chunkQueue.length === 0 || !sourceBuffer) return;
  if (sourceBuffer.updating) return;

  isAppending = true;
  const chunk = chunkQueue.shift();
  try {
    sourceBuffer.appendBuffer(chunk);
  } catch (err) {
    console.error('[player] Error al agregar chunk:', err);
    isAppending = false;
  }
  sourceBuffer.addEventListener('updateend', () => {
    isAppending = false;
    flushQueue();
  }, { once: true });
}

// ─── Flujo WebRTC ──────────────────────────────────────────────────────────────

/**
 * Inicia la sesión WebRTC con el servidor de streaming.
 * @param {string} ticket  Ticket efímero obtenido del backend.
 * @param {HTMLVideoElement} videoEl
 */
async function startWebRTC(ticket, videoEl) {
  setStatus('Conectando…', 'connecting');

  // 1. Solicitar oferta SDP al servidor de streaming
  const { sdp: offerSdp, type: offerType } = await post('/stream/start', { ticket });

  // 2. Crear RTCPeerConnection
  peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });

  // 3. Configurar DataChannel para recibir chunks de video
  peerConnection.ondatachannel = (event) => {
    const channel = event.channel;
    channel.binaryType = 'arraybuffer';

    channel.onopen    = () => setStatus('Reproduciendo', 'playing');
    channel.onclose   = () => setStatus('Desconectado', 'info');
    channel.onerror   = (e) => {
      console.error('[player] DataChannel error:', e);
      setStatus('Error en el canal de datos', 'error');
    };

    channel.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) appendChunk(new Uint8Array(e.data));
    };
  };

  // 4. Manejar candidatos ICE
  peerConnection.onicecandidate = (e) => {
    // Con ICE Trickle desactivado en el servidor, no necesitamos enviar candidatos
    // individualmente. Pero lo registramos por depuración.
    if (e.candidate) console.debug('[player] ICE candidate:', e.candidate.candidate);
  };

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    console.info('[player] Connection state:', state);
    if (state === 'failed' || state === 'disconnected') {
      setStatus(`Estado: ${state}`, 'error');
    }
  };

  // 5. Procesar la oferta del servidor
  await peerConnection.setRemoteDescription({ type: offerType || 'offer', sdp: offerSdp });

  // 6. Generar answer
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  // 7. Enviar answer al servidor de streaming
  await post('/stream/answer', {
    ticket,
    answer: {
      type: peerConnection.localDescription.type,
      sdp:  peerConnection.localDescription.sdp,
    },
  });

  setStatus('Negociación completada — esperando stream…', 'connecting');

  // 8. Iniciar MediaSource para reproducción
  await initMediaSource(videoEl);

  // Iniciar reproducción automática cuando haya suficientes datos
  videoEl.addEventListener('canplay', () => videoEl.play().catch(() => {}), { once: true });
}

// ─── Punto de entrada ──────────────────────────────────────────────────────────

/**
 * Inicializa el reproductor. Llámese cuando el DOM esté listo.
 */
export async function initPlayer() {
  const params  = new URLSearchParams(window.location.search);
  const videoId = params.get('id');
  const videoEl = document.getElementById('stream-video');
  const errorEl = document.getElementById('player-error');

  if (!videoId) {
    if (errorEl) errorEl.textContent = 'No se especificó un ID de video.';
    setStatus('Sin ID de video', 'error');
    return;
  }

  setStatus('Obteniendo información del video…', 'connecting');

  try {
    // 1. Metadatos del video
    const video = await get(`/api/videos/${videoId}`);
    renderVideoInfo(video);

    // 2. Obtener ticket efímero
    setStatus('Solicitando ticket de streaming…', 'connecting');
    const { ticket } = await post(`/api/stream/${videoId}/ticket`, {});
    if (!ticket) throw new Error('El backend no devolvió un ticket válido.');

    // 3. Iniciar WebRTC
    await startWebRTC(ticket, videoEl);

  } catch (err) {
    console.error('[player] Error fatal:', err);
    setStatus(`Error: ${err.message}`, 'error');
    if (errorEl) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  }
}

/** Limpia recursos al salir de la página. */
window.addEventListener('beforeunload', () => {
  peerConnection?.close();
  if (mediaSource && mediaSource.readyState === 'open') {
    try { mediaSource.endOfStream(); } catch (_) {}
  }
});
