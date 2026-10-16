/**
 * catalog.js — Carga y renderiza el catálogo de videos en index.html.
 * Muestra videos públicos para todos los usuarios y, si está autenticado,
 * incluye los videos privados/ocultos del propio usuario.
 */

import { get } from './api.js';
import { isLoggedIn } from './auth.js';

// ─── Helpers de renderizado ───────────────────────────────────────────────────

/**
 * Devuelve el badge HTML según la visibilidad del video.
 * @param {'public'|'unlisted'|'private'} visibility
 */
function visibilityBadge(visibility) {
  const map = {
    public:   { label: 'Público',  cls: 'bg-green-600' },
    unlisted: { label: 'Oculto',   cls: 'bg-yellow-600' },
    private:  { label: 'Privado',  cls: 'bg-red-700' },
  };
  const { label, cls } = map[visibility] || map.public;
  return `<span class="text-xs font-semibold px-2 py-0.5 rounded-full ${cls} text-white">${label}</span>`;
}

/**
 * Trunca un texto a `maxLen` caracteres.
 * @param {string} text
 * @param {number} maxLen
 */
function truncate(text, maxLen = 100) {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

/**
 * Crea el HTML de una tarjeta de video.
 * @param {object} video
 */
function videoCard(video) {
  const thumb = video.thumbnail_url
    ? `<img src="${video.thumbnail_url}" alt="${video.title}" class="w-full h-40 object-cover">`
    : `<div class="w-full h-40 bg-gray-700 flex items-center justify-center">
         <svg class="w-12 h-12 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
           <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"/>
         </svg>
       </div>`;

  return `
    <article class="bg-gray-800 rounded-xl overflow-hidden shadow-lg hover:shadow-2xl
                    transition-shadow duration-300 flex flex-col">
      <a href="/player.html?id=${video.id}" class="block">
        ${thumb}
      </a>
      <div class="p-4 flex flex-col flex-1">
        <div class="flex items-start justify-between gap-2 mb-1">
          <h2 class="text-white font-semibold text-sm leading-tight line-clamp-2 flex-1">
            ${video.title}
          </h2>
          ${visibilityBadge(video.visibility)}
        </div>
        <p class="text-gray-400 text-xs mb-3 flex-1">${truncate(video.description)}</p>
        <div class="flex items-center justify-between mt-auto">
          <span class="text-gray-500 text-xs">${video.owner_name || 'Anónimo'}</span>
          <a href="/player.html?id=${video.id}"
             class="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium
                    px-3 py-1.5 rounded-lg transition-colors">
            Ver ▶
          </a>
        </div>
      </div>
    </article>`;
}

/**
 * Renderiza un mensaje de estado (cargando / sin videos / error).
 * @param {string} msg
 * @param {'info'|'error'} type
 */
function renderStatus(container, msg, type = 'info') {
  const color = type === 'error' ? 'text-red-400' : 'text-gray-400';
  container.innerHTML = `
    <div class="col-span-full text-center py-16 ${color}">
      <p class="text-lg">${msg}</p>
    </div>`;
}

// ─── Inicialización ───────────────────────────────────────────────────────────

/**
 * Carga el catálogo de videos y lo renderiza en el grid.
 * Debe llamarse cuando el DOM esté listo.
 */
export async function loadCatalog() {
  const grid    = document.getElementById('video-grid');
  const counter = document.getElementById('video-count');
  if (!grid) return;

  renderStatus(grid, 'Cargando videos…');

  try {
    // Videos públicos — disponibles para todos
    const publicVideos = await get('/api/videos');

    // Videos del usuario autenticado (privados / ocultos)
    let myVideos = [];
    if (isLoggedIn()) {
      try {
        myVideos = await get('/api/videos/mine');
      } catch (_) {
        // Si falla silenciosamente (p.ej. 401 expirado) ignoramos
      }
    }

    // Combinar y deduplicar por ID
    const seen = new Set();
    const allVideos = [...publicVideos, ...myVideos].filter((v) => {
      if (seen.has(v.id)) return false;
      seen.add(v.id);
      return true;
    });

    if (allVideos.length === 0) {
      renderStatus(grid, 'No hay videos disponibles todavía. ¡Sé el primero en subir uno!');
      return;
    }

    grid.innerHTML = allVideos.map(videoCard).join('');
    if (counter) counter.textContent = `${allVideos.length} video${allVideos.length !== 1 ? 's' : ''}`;
  } catch (err) {
    console.error('[catalog] Error al cargar videos:', err);
    renderStatus(grid, `Error al cargar el catálogo: ${err.message}`, 'error');
  }
}
