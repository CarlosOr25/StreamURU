/**
 * server.js — StreamURU Streaming Server
 * =======================================
 * Servidor de streaming de video sobre UDP/WebRTC para la plataforma StreamURU.
 *
 * ARQUITECTURA:
 * ─────────────
 *  1. Servidor HTTP Express (puerto STREAMING_PORT_HTTP, default 5000)
 *     └── Actúa como señalizador SDP (signaling server) para WebRTC
 *
 *  2. Transporte principal: WebRTC DataChannel (node-datachannel)
 *     └── Encapsula el video en chunks enviados por SRTP/UDP
 *
 *  3. Transporte fallback: UDP nativo (dgram) + WebTransport en el cliente
 *     └── Se activa si node-datachannel no logra establecer la conexión ICE
 *
 * FLUJO COMPLETO:
 * ───────────────
 *  [Cliente] ──POST /stream/start { ticket }──────────► [Servidor]
 *             ◄── { sessionId, sdp: offer } ──────────
 *  [Cliente] ──POST /stream/answer { sessionId, sdp }─► [Servidor]
 *             ◄── { ok: true } ─────────────────────────
 *  [WebRTC DataChannel establecido sobre UDP/SRTP]
 *  [Servidor descarga video de MinIO y envía chunks por DataChannel]
 *  [Cliente usa MediaSource API + SourceBuffer para reproducir]
 *
 * VARIABLES DE ENTORNO:
 * ─────────────────────
 *  STREAM_TICKET_SECRET    — Secreto JWT para verificar tickets efímeros
 *  MINIO_ENDPOINT          — Host de MinIO (ej: "minio" en Docker)
 *  MINIO_PORT              — Puerto de MinIO (ej: 9000)
 *  MINIO_ROOT_USER         — Usuario MinIO
 *  MINIO_ROOT_PASSWORD     — Contraseña MinIO
 *  MINIO_BUCKET_NAME       — Bucket donde se almacenan los videos
 *  STREAMING_PORT_HTTP     — Puerto HTTP de señalización (default: 5000)
 *  STREAMING_UDP_MIN_PORT  — Puerto UDP mínimo para ICE/WebRTC (default: 50000)
 *  STREAMING_UDP_MAX_PORT  — Puerto UDP máximo para ICE/WebRTC (default: 50100)
 */

'use strict';

require('dotenv').config();

const express    = require('express');
const { v4: uuidv4 } = require('uuid');
const dgram      = require('dgram');
const { Client: MinioClient } = require('minio');
const { verifyStreamTicket } = require('./ticketVerifier');

// ─── Intentar cargar node-datachannel (WebRTC) ───────────────────────────────
// Si el módulo no está disponible (p. ej. compilación nativa fallida en la
// plataforma), caemos automáticamente al modo fallback UDP nativo.
let nodeDataChannel;
let webrtcAvailable = false;
try {
  nodeDataChannel = require('node-datachannel');
  webrtcAvailable = true;
  console.log('[WebRTC] node-datachannel cargado correctamente ✓');
} catch (err) {
  console.warn(
    '[WebRTC] node-datachannel no disponible, usando fallback UDP nativo:',
    err.message
  );
}

// ─── Configuración ────────────────────────────────────────────────────────────
const HTTP_PORT   = parseInt(process.env.STREAMING_PORT_HTTP  || '5000', 10);
const UDP_MIN     = parseInt(process.env.STREAMING_UDP_MIN_PORT || '50000', 10);
const UDP_MAX     = parseInt(process.env.STREAMING_UDP_MAX_PORT || '50100', 10);

// ─── Cliente MinIO ────────────────────────────────────────────────────────────
const minioClient = new MinioClient({
  endPoint:  process.env.MINIO_ENDPOINT        || 'minio',
  port:      parseInt(process.env.MINIO_PORT   || '9000', 10),
  useSSL:    false,
  accessKey: process.env.MINIO_ROOT_USER       || 'minioadmin',
  secretKey: process.env.MINIO_ROOT_PASSWORD   || 'miniopassword123',
});

const BUCKET = process.env.MINIO_BUCKET_NAME || 'videos';

// ─── Mapa de sesiones activas ─────────────────────────────────────────────────
// sessionId → { peer, dataChannel, videoId, storageKey, userId, udpSocket, udpPort }
const sessions = new Map();

// ─── Express App ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Permite peticiones CORS desde el frontend en desarrollo
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    transport: webrtcAvailable ? 'WebRTC/UDP (SRTP)' : 'UDP nativo (fallback)',
    sessions: sessions.size,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /stream/start
// Verifica el ticket JWT y devuelve una oferta SDP WebRTC (o puerto UDP en
// modo fallback).
// Body: { ticket: string }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/stream/start', async (req, res) => {
  const { ticket } = req.body || {};

  // 1. Verificar ticket JWT ──────────────────────────────────────────────────
  let payload;
  try {
    payload = verifyStreamTicket(ticket);
  } catch (err) {
    console.warn('[/stream/start] Ticket inválido:', err.message);
    return res.status(401).json({ error: err.message });
  }

  const { videoId, userId, storageKey } = payload;
  const sessionId = uuidv4();

  console.log(
    `[/stream/start] Sesión ${sessionId} | video=${videoId} | user=${userId}`
  );

  // 2. Ruta principal: WebRTC ─────────────────────────────────────────────────
  if (webrtcAvailable) {
    try {
      const result = await createWebRTCSession(sessionId, videoId, storageKey, userId);
      return res.json(result);
    } catch (err) {
      console.error('[WebRTC] Error creando sesión, fallback a UDP:', err.message);
      // Si WebRTC falla, continuamos al bloque de fallback
    }
  }

  // 3. Ruta fallback: UDP nativo ─────────────────────────────────────────────
  try {
    const result = await createUDPSession(sessionId, videoId, storageKey, userId);
    return res.json(result);
  } catch (err) {
    console.error('[UDP Fallback] Error:', err.message);
    return res.status(500).json({ error: 'Error iniciando sesión de streaming' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /stream/answer
// Recibe la SDP answer del cliente para completar el handshake WebRTC.
// Body: { sessionId: string, sdp: string }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/stream/answer', async (req, res) => {
  const { sessionId, sdp } = req.body || {};

  if (!sessionId || !sdp) {
    return res.status(400).json({ error: 'Se requieren sessionId y sdp' });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Sesión no encontrada o expirada' });
  }

  if (!session.peer) {
    // Sesión en modo fallback UDP: no hay SDP answer necesaria
    return res.json({ ok: true, mode: 'udp-fallback' });
  }

  try {
    // Completar el handshake WebRTC con la answer del cliente
    session.peer.setRemoteDescription(sdp, 'answer');
    console.log(`[/stream/answer] SDP answer aceptada | sesión ${sessionId}`);
    res.json({ ok: true, mode: 'webrtc' });
  } catch (err) {
    console.error('[/stream/answer] Error:', err.message);
    res.status(500).json({ error: 'Error procesando SDP answer' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /stream/stop
// Cierra y limpia una sesión de streaming activa.
// Body: { sessionId: string }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/stream/stop', (req, res) => {
  const { sessionId } = req.body || {};
  if (sessionId && sessions.has(sessionId)) {
    cleanupSession(sessionId);
    console.log(`[/stream/stop] Sesión ${sessionId} cerrada`);
    return res.json({ ok: true });
  }
  res.status(404).json({ error: 'Sesión no encontrada' });
});

// ─────────────────────────────────────────────────────────────────────────────
// LÓGICA WEBRTC — createWebRTCSession
// Crea una PeerConnection con node-datachannel, genera oferta SDP y registra
// los callbacks para cuando el DataChannel esté listo.
// ─────────────────────────────────────────────────────────────────────────────
async function createWebRTCSession(sessionId, videoId, storageKey, userId) {
  return new Promise((resolve, reject) => {
    // Configuración ICE: usamos servidores STUN públicos como fallback además
    // del rango de puertos UDP configurado (para entornos Docker con NAT).
    const iceServers = [
      { urls: ['stun:stun.l.google.com:19302'] },
    ];

    const peer = new nodeDataChannel.PeerConnection(`streamuru-${sessionId}`, {
      iceServers,
      portRangeBegin: UDP_MIN,
      portRangeEnd:   UDP_MAX,
    });

    let sdpOfferSent = false;

    // Callback: nueva descripción local lista (oferta SDP generada)
    peer.onLocalDescription((sdp, type) => {
      if (type === 'offer' && !sdpOfferSent) {
        sdpOfferSent = true;
        console.log(`[WebRTC] Oferta SDP generada | sesión ${sessionId}`);
        resolve({
          sessionId,
          sdp,
          type: 'offer',
          transport: 'webrtc-srtp-udp',
        });
      }
    });

    peer.onLocalCandidate((candidate, mid) => {
      // Los candidatos ICE se embeben en el SDP (trickle ICE desactivado para
      // simplificar la señalización HTTP one-shot).
      console.log(`[WebRTC] Candidato ICE local | mid=${mid}`);
    });

    peer.onStateChange((state) => {
      console.log(`[WebRTC] Estado peer | sesión ${sessionId}: ${state}`);
    });

    // Crear DataChannel para enviar los chunks de video
    const dc = peer.createDataChannel('video-stream');

    dc.onOpen(() => {
      console.log(`[WebRTC] DataChannel abierto | sesión ${sessionId} — iniciando stream`);
      // Iniciar la descarga y envío del video desde MinIO
      streamVideoToDataChannel(sessionId, storageKey, dc);
    });

    dc.onClosed(() => {
      console.log(`[WebRTC] DataChannel cerrado | sesión ${sessionId}`);
      cleanupSession(sessionId);
    });

    dc.onError((err) => {
      console.error(`[WebRTC] Error en DataChannel | sesión ${sessionId}:`, err);
    });

    // Guardar sesión
    sessions.set(sessionId, { peer, dataChannel: dc, videoId, storageKey, userId });

    // Generar la oferta SDP (el callback onLocalDescription se dispara internamente)
    peer.setLocalDescription();

    // Timeout: si en 10 s no se genera el SDP, rechazamos
    setTimeout(() => {
      if (!sdpOfferSent) {
        reject(new Error('Timeout generando oferta SDP'));
      }
    }, 10_000);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// LÓGICA UDP FALLBACK — createUDPSession
// Abre un socket UDP nativo en un puerto libre del rango configurado.
// El cliente frontend debe usar WebTransport o una conexión UDP directa
// (según las capacidades del navegador) para recibir los chunks.
// ─────────────────────────────────────────────────────────────────────────────
async function createUDPSession(sessionId, videoId, storageKey, userId) {
  return new Promise((resolve, reject) => {
    // Buscar puerto UDP libre en el rango configurado
    const udpPort = findAvailableUDPPort();
    if (!udpPort) {
      return reject(new Error('No hay puertos UDP disponibles en el rango configurado'));
    }

    const udpSocket = dgram.createSocket('udp4');

    udpSocket.on('error', (err) => {
      console.error(`[UDP] Error en socket | sesión ${sessionId}:`, err.message);
      cleanupSession(sessionId);
    });

    udpSocket.on('message', (msg, rinfo) => {
      // El primer mensaje del cliente registra su dirección para enviarle datos
      const session = sessions.get(sessionId);
      if (session && !session.clientAddress) {
        session.clientAddress = rinfo.address;
        session.clientPort    = rinfo.port;
        console.log(
          `[UDP] Cliente registrado ${rinfo.address}:${rinfo.port} | sesión ${sessionId}`
        );
        // Iniciar streaming una vez que conocemos la dirección del cliente
        streamVideoOverUDP(sessionId, storageKey, udpSocket, rinfo.address, rinfo.port);
      }
    });

    udpSocket.bind(udpPort, '0.0.0.0', () => {
      console.log(`[UDP Fallback] Socket UDP abierto en puerto ${udpPort} | sesión ${sessionId}`);
      sessions.set(sessionId, {
        peer: null,
        dataChannel: null,
        udpSocket,
        udpPort,
        videoId,
        storageKey,
        userId,
        clientAddress: null,
        clientPort: null,
      });
      resolve({
        sessionId,
        transport: 'udp-fallback',
        udpPort,
        // Instrucción al cliente: conectar por UDP a este puerto y enviar un
        // paquete inicial para registrar su dirección.
        note: 'Conectar por WebTransport o UDP nativo al puerto indicado y enviar cualquier dato para iniciar el stream.',
      });
    });

    udpSocket.on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STREAMING DE VIDEO — streamVideoToDataChannel
// Descarga el archivo de video de MinIO y lo envía en chunks por el
// WebRTC DataChannel. El cliente usa MediaSource API para reproducirlo.
// ─────────────────────────────────────────────────────────────────────────────
async function streamVideoToDataChannel(sessionId, storageKey, dataChannel) {
  console.log(`[Stream] Descargando ${storageKey} de MinIO | sesión ${sessionId}`);

  let stream;
  try {
    stream = await minioClient.getObject(BUCKET, storageKey);
  } catch (err) {
    console.error(`[MinIO] Error obteniendo objeto '${storageKey}':`, err.message);
    // Notificar al cliente del error antes de cerrar
    try {
      dataChannel.sendMessage(JSON.stringify({ type: 'error', message: 'Error obteniendo video de storage' }));
    } catch (_) {}
    cleanupSession(sessionId);
    return;
  }

  // Tamaño de chunk: 64 KB — balance entre latencia y overhead por paquete
  const CHUNK_SIZE = 64 * 1024;

  // Enviar mensaje de inicio al cliente
  try {
    dataChannel.sendMessage(JSON.stringify({ type: 'stream-start', storageKey }));
  } catch (_) {}

  let totalBytes = 0;
  let buffer = Buffer.alloc(0);

  stream.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    totalBytes += chunk.length;

    // Enviar chunks completos tan pronto como tengamos suficiente dato
    while (buffer.length >= CHUNK_SIZE) {
      const toSend = buffer.slice(0, CHUNK_SIZE);
      buffer = buffer.slice(CHUNK_SIZE);

      try {
        // sendMessageBinary envía el buffer como Uint8Array por el DataChannel
        dataChannel.sendMessageBinary(toSend);
      } catch (err) {
        console.error(`[Stream] Error enviando chunk | sesión ${sessionId}:`, err.message);
        stream.destroy();
        cleanupSession(sessionId);
        return;
      }
    }
  });

  stream.on('end', () => {
    // Enviar cualquier dato remanente del buffer
    if (buffer.length > 0) {
      try {
        dataChannel.sendMessageBinary(buffer);
      } catch (_) {}
    }
    // Señal de fin de stream
    try {
      dataChannel.sendMessage(JSON.stringify({ type: 'stream-end', totalBytes }));
    } catch (_) {}
    console.log(
      `[Stream] Completado | sesión ${sessionId} | ${(totalBytes / 1024 / 1024).toFixed(2)} MB`
    );
    cleanupSession(sessionId);
  });

  stream.on('error', (err) => {
    console.error(`[Stream] Error de lectura | sesión ${sessionId}:`, err.message);
    cleanupSession(sessionId);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STREAMING DE VIDEO — streamVideoOverUDP
// Modo fallback: descarga el video de MinIO y envía paquetes UDP al cliente.
// Protocolo mínimo propio (cabecera de 8 bytes: número de secuencia uint32 +
// flags uint32) para que el cliente pueda reordenar paquetes si es necesario.
//
// Cabecera de paquete UDP (8 bytes):
//   [0-3] seqNumber  (uint32 big-endian) — número de secuencia del chunk
//   [4-7] flags      (uint32 big-endian) — 0x00000000 = datos, 0x00000001 = EOS
// ─────────────────────────────────────────────────────────────────────────────
async function streamVideoOverUDP(sessionId, storageKey, udpSocket, clientAddress, clientPort) {
  console.log(
    `[UDP Stream] Descargando ${storageKey} | sesión ${sessionId} → ${clientAddress}:${clientPort}`
  );

  let stream;
  try {
    stream = await minioClient.getObject(BUCKET, storageKey);
  } catch (err) {
    console.error(`[MinIO] Error obteniendo objeto '${storageKey}':`, err.message);
    return;
  }

  const CHUNK_SIZE = 1400; // Tamaño seguro para UDP (MTU típico 1500 - cabeceras IP/UDP)
  const HEADER_SIZE = 8;
  const PAYLOAD_SIZE = CHUNK_SIZE - HEADER_SIZE;

  // Control de flujo: pausa entre paquetes para no saturar el buffer UDP del cliente
  // ~10 Mbps simulado: 1400 bytes / 1.25e6 B/s = 1.12ms por paquete
  const INTER_PACKET_DELAY_MS = 1;

  let seqNumber = 0;
  let buffer = Buffer.alloc(0);
  let totalBytes = 0;

  const sendPacket = (payload, flags = 0) => {
    return new Promise((resolve, reject) => {
      const packet = Buffer.allocUnsafe(HEADER_SIZE + payload.length);
      packet.writeUInt32BE(seqNumber++, 0);
      packet.writeUInt32BE(flags, 4);
      payload.copy(packet, HEADER_SIZE);

      udpSocket.send(packet, clientPort, clientAddress, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Paquete inicial de tipo "inicio de stream"
  const startPayload = Buffer.from(JSON.stringify({ type: 'stream-start', storageKey }));
  try {
    await sendPacket(startPayload, 0x00000002); // flag 2 = control/metadata
  } catch (err) {
    console.error('[UDP Stream] Error enviando paquete de inicio:', err.message);
  }

  // Leer el stream y enviar chunks
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
    totalBytes += chunk.length;

    while (buffer.length >= PAYLOAD_SIZE) {
      const payload = buffer.slice(0, PAYLOAD_SIZE);
      buffer = buffer.slice(PAYLOAD_SIZE);

      try {
        await sendPacket(payload, 0x00000000);
        await sleep(INTER_PACKET_DELAY_MS);
      } catch (err) {
        console.error(`[UDP Stream] Error enviando paquete #${seqNumber}:`, err.message);
        cleanupSession(sessionId);
        return;
      }
    }
  }

  // Enviar datos restantes del buffer
  if (buffer.length > 0) {
    try {
      await sendPacket(buffer, 0x00000000);
    } catch (_) {}
  }

  // Paquete EOS (End of Stream)
  try {
    const eosPayload = Buffer.from(JSON.stringify({ type: 'stream-end', totalBytes }));
    await sendPacket(eosPayload, 0x00000001); // flag 1 = EOS
  } catch (_) {}

  console.log(
    `[UDP Stream] Completado | sesión ${sessionId} | ${(totalBytes / 1024 / 1024).toFixed(2)} MB | ${seqNumber} paquetes`
  );
  cleanupSession(sessionId);
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Libera todos los recursos de una sesión (peer WebRTC, socket UDP, etc.)
 */
function cleanupSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  if (session.dataChannel) {
    try { session.dataChannel.close(); } catch (_) {}
  }
  if (session.peer) {
    try { session.peer.close(); } catch (_) {}
  }
  if (session.udpSocket) {
    try { session.udpSocket.close(); } catch (_) {}
  }

  sessions.delete(sessionId);
  console.log(`[Cleanup] Sesión ${sessionId} eliminada. Sesiones activas: ${sessions.size}`);
}

/**
 * Busca un puerto UDP libre en el rango [UDP_MIN, UDP_MAX].
 * Comprueba contra los puertos ya utilizados por sesiones activas.
 */
function findAvailableUDPPort() {
  const usedPorts = new Set(
    [...sessions.values()]
      .filter((s) => s.udpPort)
      .map((s) => s.udpPort)
  );

  for (let port = UDP_MIN; port <= UDP_MAX; port++) {
    if (!usedPorts.has(port)) return port;
  }
  return null; // Rango agotado
}

// ─────────────────────────────────────────────────────────────────────────────
// LIMPIEZA PERIÓDICA DE SESIONES HUÉRFANAS
// Elimina sesiones que llevan más de 5 minutos sin actividad (por si el
// cliente se desconecta sin llamar a /stream/stop).
// ─────────────────────────────────────────────────────────────────────────────
setInterval(() => {
  // En una implementación completa se añadiría un timestamp de último acceso
  // a cada sesión. Por ahora sólo se loguea el estado.
  if (sessions.size > 0) {
    console.log(`[Heartbeat] Sesiones activas: ${sessions.size}`);
  }
}, 60_000);

// ─────────────────────────────────────────────────────────────────────────────
// ARRANQUE DEL SERVIDOR
// ─────────────────────────────────────────────────────────────────────────────
app.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║       StreamURU — Streaming Server UDP/WebRTC        ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  HTTP Señalización : http://0.0.0.0:${HTTP_PORT}`);
  console.log(`  Transporte        : ${webrtcAvailable ? 'WebRTC DataChannel (SRTP/UDP)' : 'UDP nativo (fallback)'}`);
  console.log(`  Rango UDP         : ${UDP_MIN}–${UDP_MAX}`);
  console.log(`  MinIO             : ${process.env.MINIO_ENDPOINT || 'minio'}:${process.env.MINIO_PORT || '9000'}`);
  console.log(`  Bucket            : ${BUCKET}`);
  console.log('');
});

// Manejo graceful de señales de terminación (importante en Docker)
process.on('SIGTERM', () => {
  console.log('[Shutdown] SIGTERM recibido. Cerrando sesiones activas...');
  for (const sessionId of sessions.keys()) {
    cleanupSession(sessionId);
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Shutdown] SIGINT recibido.');
  for (const sessionId of sessions.keys()) {
    cleanupSession(sessionId);
  }
  process.exit(0);
});
