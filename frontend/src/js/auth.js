/**
 * auth.js — Gestión de autenticación JWT para StreamURU.
 * Maneja login, registro, logout y estado de sesión del usuario.
 */

import { post } from './api.js';

const TOKEN_KEY = 'streamuru_token';
const USER_KEY  = 'streamuru_user';

// ─── Helpers de almacenamiento ────────────────────────────────────────────────

/** Guarda el JWT en localStorage. */
function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

/** Guarda los datos del usuario en localStorage. */
function saveUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Obtiene el JWT almacenado, o null si no existe.
 * @returns {string|null}
 */
export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Indica si hay un usuario autenticado (JWT presente).
 * @returns {boolean}
 */
export function isLoggedIn() {
  return !!getToken();
}

/**
 * Devuelve los datos del usuario autenticado, o null.
 * @returns {object|null}
 */
export function getCurrentUser() {
  const raw = localStorage.getItem(USER_KEY);
  try { return raw ? JSON.parse(raw) : null; }
  catch (_) { return null; }
}

/**
 * Inicia sesión con email y contraseña.
 * Guarda el token y redirige a index.html si tiene éxito.
 * @param {string} email
 * @param {string} password
 */
export async function login(email, password) {
  const data = await post('/api/auth/login', { email, password });
  if (!data.token) throw new Error('Respuesta inválida del servidor');
  saveToken(data.token);
  saveUser(data.user || { email });
  window.location.href = '/index.html';
}

/**
 * Registra un nuevo usuario.
 * Guarda el token y redirige a index.html si tiene éxito.
 * @param {string} username
 * @param {string} email
 * @param {string} password
 */
export async function register(username, email, password) {
  const data = await post('/api/auth/register', { username, email, password });
  if (!data.token) throw new Error('Respuesta inválida del servidor');
  saveToken(data.token);
  saveUser(data.user || { username, email });
  window.location.href = '/index.html';
}

/**
 * Cierra la sesión: elimina token y datos del usuario, redirige a login.
 */
export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.location.href = '/login.html';
}

/**
 * Actualiza la UI del header según el estado de autenticación.
 * Llama a esta función en cada página para mantener el header sincronizado.
 */
export function syncAuthUI() {
  const loginBtn  = document.getElementById('btn-login');
  const logoutBtn = document.getElementById('btn-logout');
  const uploadNav = document.getElementById('nav-upload');
  const userInfo  = document.getElementById('user-info');
  const user      = getCurrentUser();

  if (isLoggedIn()) {
    loginBtn  && loginBtn.classList.add('hidden');
    logoutBtn && logoutBtn.classList.remove('hidden');
    uploadNav && uploadNav.classList.remove('hidden');
    if (userInfo && user) userInfo.textContent = user.username || user.email || 'Usuario';
  } else {
    loginBtn  && loginBtn.classList.remove('hidden');
    logoutBtn && logoutBtn.classList.add('hidden');
    uploadNav && uploadNav.classList.add('hidden');
    if (userInfo) userInfo.textContent = '';
  }
}
