-- ============================================================
-- models/init.sql
-- Script DDL para inicializar el esquema de la BD de StreamURU.
-- Ejecutar una vez al desplegar, o incluir en el entrypoint de Docker.
-- ============================================================

-- Habilitar la extensión para generar UUIDs de forma nativa en PostgreSQL
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Tabla: users ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(50)  NOT NULL UNIQUE,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Índice para búsquedas rápidas por email (login)
CREATE INDEX IF NOT EXISTS idx_users_email    ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

-- ─── Tabla: videos ───────────────────────────────────────────────────────────
-- visibility: 'public' | 'unlisted' | 'private'
CREATE TABLE IF NOT EXISTS videos (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        VARCHAR(255) NOT NULL,
    description  TEXT         NOT NULL DEFAULT '',
    visibility   VARCHAR(20)  NOT NULL DEFAULT 'public'
                   CHECK (visibility IN ('public', 'unlisted', 'private')),
    storage_key  VARCHAR(255) NOT NULL UNIQUE,  -- UUID del objeto en MinIO
    mime_type    VARCHAR(50)  NOT NULL,
    size_bytes   BIGINT       NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Índices de consulta frecuente
CREATE INDEX IF NOT EXISTS idx_videos_user_id    ON videos (user_id);
CREATE INDEX IF NOT EXISTS idx_videos_visibility ON videos (visibility);
CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos (created_at DESC);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_videos_updated_at ON videos;
CREATE TRIGGER set_videos_updated_at
    BEFORE UPDATE ON videos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
