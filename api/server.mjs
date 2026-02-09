import express from 'express';
import cors from 'cors';
import { jwtVerify } from 'jose';
import { Pool } from 'pg';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { Storage } from '@google-cloud/storage';

// Config
const PORT = process.env.PORT || 3001;
const BASE_PATH = process.env.BASE_PATH || '/api';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,https://deceroacien.app,https://www.deceroacien.app')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || '';
const MP_INTEGRATOR_ID = process.env.MP_INTEGRATOR_ID || '';
const PUBLIC_API_BASE = process.env.PUBLIC_API_BASE || '';
const PUBLIC_SITE_BASE = process.env.PUBLIC_SITE_BASE || 'https://www.deceroacien.app';
const GRANT_SECRET = process.env.GRANT_SECRET || '';
const CERT_BUCKET = process.env.CERT_BUCKET || '';
const CERT_URL_MODE = (process.env.CERT_URL_MODE || 'signed').toLowerCase();
const CERT_SIGNED_TTL = Number(process.env.CERT_SIGNED_TTL || 3600);
// Supabase Auth (config pública + verificación)
const PUBLIC_SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL || '';
const PUBLIC_SUPABASE_ANON_KEY = process.env.PUBLIC_SUPABASE_ANON_KEY || '';
// Cuando Supabase emite tokens HS256 (por defecto), debemos verificar con el secreto del proyecto
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
// Nota: Si en el futuro se usa RS256, agregar verificación vía JWKS (no necesaria hoy)
// Parámetros de pago (configurables por entorno)
const MP_INSTALLMENTS = Number(process.env.MP_INSTALLMENTS || 6);
const _EXC = (process.env.MP_EXCLUDE_PAYMENT_METHODS ?? '');
const MP_EXCLUDED_PAYMENT_METHODS = _EXC
  ? _EXC.split(',').map(s => s.trim()).filter(Boolean).map(id => ({ id }))
  : [];
// Email (opcional)
const SMTP_URL = process.env.SMTP_URL || '';
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || 'no-reply@deceroacien.app';
const LEADS_NOTIFY_EMAIL = process.env.LEADS_NOTIFY_EMAIL || '';
// Email via Resend (opcional)
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
// Zoho CRM (opcional)
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || '';
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || '';
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || '';
const ZOHO_DC = (process.env.ZOHO_DC || 'com').toLowerCase(); // com | eu | in | com.au | jp

// Firebase Admin eliminado: verificación y autenticación ahora son exclusivamente vía Supabase

// Inicializar pool PG (opcional)
let pool = null;
if (process.env.DATABASE_URL) {
  try {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } });
    console.log('[api] Pool PG inicializado');
  } catch (e) {
    console.error('[api] Error inicializando PG:', e);
  }
} else {
  console.warn('[api] DATABASE_URL no definido; endpoints responderán sin persistencia.');
}

async function ensureSchema() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        email TEXT UNIQUE,
        first_name TEXT,
        last_name TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
      -- Extensiones para identidad (RUT)
      ALTER TABLE users ADD COLUMN IF NOT EXISTS rut TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS rut_verified BOOLEAN DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS rut_updated_at TIMESTAMPTZ;
      CREATE TABLE IF NOT EXISTS products (
        sku TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        price NUMERIC,
        currency TEXT DEFAULT 'CLP',
        metadata JSONB
      );
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        user_id UUID,
        email TEXT,
        items JSONB NOT NULL,
        total NUMERIC,
        currency TEXT,
        preference_id TEXT,
        status TEXT, -- created|pending|paid|cancelled
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        order_id TEXT,
        status TEXT,
        amount NUMERIC,
        currency TEXT,
        method TEXT,
        raw JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS enrollments (
        id TEXT PRIMARY KEY,
        user_id UUID NOT NULL,
        entitlement TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS webhook_events (
        id TEXT PRIMARY KEY,
        topic TEXT,
        resource_id TEXT,
        payload JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS processed_payments (
        payment_id TEXT PRIMARY KEY,
        processed_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        actor TEXT,
        action TEXT,
        target TEXT,
        data JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS download_leads (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT,
        source TEXT NOT NULL DEFAULT 'descargas-gratuitas',
        tags TEXT[] DEFAULT ARRAY[]::TEXT[],
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS download_leads_email_source_idx ON download_leads (email, source);
      -- LMS-lite: cursos, módulos, lecciones
      CREATE TABLE IF NOT EXISTS courses (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        hours_expected NUMERIC,
        metadata JSONB
      );
      CREATE TABLE IF NOT EXISTS modules (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        title TEXT NOT NULL,
        position INT,
        metadata JSONB
      );
      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY,
        module_id TEXT,
        course_id TEXT,
        title TEXT NOT NULL,
        content_type TEXT,
        duration_seconds INT,
        metadata JSONB
      );
      CREATE TABLE IF NOT EXISTS content_progress (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        content_type TEXT NOT NULL,
        content_id TEXT NOT NULL,
        progress_seconds INT DEFAULT 0,
        completed BOOLEAN DEFAULT false,
        last_ts TIMESTAMPTZ DEFAULT now(),
        metadata JSONB
      );
      CREATE UNIQUE INDEX IF NOT EXISTS content_progress_uniq ON content_progress (user_id, content_type, content_id);
      CREATE TABLE IF NOT EXISTS video_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        event TEXT NOT NULL,
        delta_seconds INT DEFAULT 0,
        position_seconds INT DEFAULT 0,
        duration_seconds INT DEFAULT 0,
        visible BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT now(),
        metadata JSONB
      );
      CREATE TABLE IF NOT EXISTS attendance (
        id TEXT PRIMARY KEY,
        user_id UUID NOT NULL,
        session_id TEXT NOT NULL,
        joined_at TIMESTAMPTZ,
        left_at TIMESTAMPTZ,
        total_seconds INT DEFAULT 0,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS attendance_uniq ON attendance (user_id, session_id);
      CREATE TABLE IF NOT EXISTS certificates (
        id TEXT PRIMARY KEY,
        user_id UUID NOT NULL,
        course_id TEXT NOT NULL,
        type TEXT NOT NULL,
        issued_at TIMESTAMPTZ DEFAULT now(),
        hours NUMERIC,
        code TEXT UNIQUE NOT NULL,
        hash TEXT,
        revoked BOOLEAN DEFAULT false,
        metadata JSONB
      );
      -- Datos por usuario/herramienta (persistencia simple de herramientas)
      CREATE TABLE IF NOT EXISTS user_data (
        user_id UUID NOT NULL,
        tool TEXT NOT NULL,
        doc_id TEXT NOT NULL,
        data JSONB DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (user_id, tool, doc_id)
      );
      -- Tenants (instituciones) y membresías/roles
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        metadata JSONB
      );
      CREATE TABLE IF NOT EXISTS tenant_users (
        tenant_id TEXT NOT NULL,
        user_id UUID NOT NULL,
        role TEXT NOT NULL DEFAULT 'usuario',
        created_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (tenant_id, user_id)
      );
      -- Invitaciones/membresías pendientes por email (antes del primer login)
      CREATE TABLE IF NOT EXISTS tenant_invites (
        tenant_id TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'usuario',
        created_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (tenant_id, email)
      );
      -- Grants pendientes por email (otorgar al primer login)
      CREATE TABLE IF NOT EXISTS pending_grants (
        email TEXT PRIMARY KEY,
        entitlements TEXT[] NOT NULL,
        tenant_id TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      -- Parámetros de administración (globales)
      CREATE TABLE IF NOT EXISTS admin_params (
        id TEXT PRIMARY KEY,
        data JSONB DEFAULT '{}'::jsonb
      );
      -- Encuestas de satisfacción
      CREATE TABLE IF NOT EXISTS survey_responses (
        id TEXT PRIMARY KEY,
        user_id UUID NOT NULL,
        module_id TEXT NOT NULL,
        tenant_id TEXT,
        answers JSONB NOT NULL,
        score NUMERIC,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      -- Actividades (para calendario de admin/usuarios)
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT,
        schedule JSONB, -- [{day,time,timezone,duration}]
        recorded_course BOOLEAN DEFAULT false,
        members TEXT[] DEFAULT ARRAY[]::TEXT[]
      );
    `);
    // Índices por user_id para performance (idempotentes)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders (user_id);
      CREATE INDEX IF NOT EXISTS enrollments_user_id_idx ON enrollments (user_id);
      CREATE INDEX IF NOT EXISTS attendance_user_id_idx ON attendance (user_id);
      CREATE INDEX IF NOT EXISTS certificates_user_id_idx ON certificates (user_id);
      CREATE INDEX IF NOT EXISTS tenant_users_user_id_idx ON tenant_users (user_id);
      CREATE INDEX IF NOT EXISTS user_data_user_id_idx ON user_data (user_id);
      CREATE INDEX IF NOT EXISTS survey_responses_user_id_idx ON survey_responses (user_id);
    `);
    console.log('[api] Esquema aplicado/validado');
  } catch (e) {
    console.error('[api] Error aplicando esquema:', e?.message || e);
  }
}
ensureSchema().catch(()=>{});
// Migración a UUID + FKs (idempotente y segura si las columnas ya son UUID)
async function ensureUUIDAndFKs() {
  if (!pool) return;
  // Helper para cambiar tipo a UUID si aún es TEXT
  async function alterToUUID(table, column) {
    try {
      const r = await pool.query(
        `SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
        [table, column]
      );
      const dt = r.rows[0]?.data_type || '';
      if (dt && dt.toLowerCase() !== 'uuid') {
        await pool.query(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE UUID USING ${column}::uuid`);
      }
    } catch (e) {
      console.warn(`[api] ALTER ${table}.${column}→UUID omitido:`, e?.message || e);
    }
  }
  await alterToUUID('users', 'id');
  await alterToUUID('orders', 'user_id');
  await alterToUUID('enrollments', 'user_id');
  await alterToUUID('attendance', 'user_id');
  await alterToUUID('certificates', 'user_id');
  await alterToUUID('tenant_users', 'user_id');
  await alterToUUID('user_data', 'user_id');
  await alterToUUID('survey_responses', 'user_id');

  // Agregar FKs (ignora si existen)
  async function addFK(table, column, constraint) {
    try {
      // ¿existe la constraint?
      const q = await pool.query(
        `SELECT 1 FROM information_schema.table_constraints WHERE table_name=$1 AND constraint_name=$2 LIMIT 1`,
        [table, constraint]
      );
      if (q.rowCount === 0) {
        await pool.query(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY (${column}) REFERENCES users(id) ON DELETE CASCADE`);
      }
    } catch (e) {
      console.warn(`[api] FK ${table}.${column} omitida:`, e?.message || e);
    }
  }
  await addFK('orders', 'user_id', 'fk_orders_user_id');
  await addFK('enrollments', 'user_id', 'fk_enrollments_user_id');
  await addFK('attendance', 'user_id', 'fk_attendance_user_id');
  await addFK('certificates', 'user_id', 'fk_certificates_user_id');
  await addFK('tenant_users', 'user_id', 'fk_tenant_users_user_id');
  await addFK('user_data', 'user_id', 'fk_user_data_user_id');
  await addFK('survey_responses', 'user_id', 'fk_survey_responses_user_id');
}
ensureUUIDAndFKs().catch(()=>{});
// Inicializar GCS Storage (solo si hay CERT_BUCKET)
let gcs = null;
try {
  gcs = new Storage();
} catch (e) {
  console.warn('[api] No se pudo inicializar @google-cloud/storage:', e?.message || e);
}


// Helpers
// (corsOptions eliminado: usamos configuración directa con cors())

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const REPORTS_API_KEY = process.env.REPORTS_API_KEY || '';

// Validación básica de RUT chileno (NNNNNNN-DV; DV puede ser K)
function validateRUT(rutRaw) {
  if (!rutRaw || typeof rutRaw !== 'string') return false;
  const cleaned = rutRaw.replace(/\./g, '').replace(/-/g, '').toUpperCase();
  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  if (!/^\d+$/.test(body)) return false;
  let sum = 0, mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const res = 11 - (sum % 11);
  const expected = res === 11 ? '0' : (res === 10 ? 'K' : String(res));
  return dv === expected;
}

function requireApiKey(req, res) {
  const key = req.headers['x-api-key'];
  if (!REPORTS_API_KEY || key !== REPORTS_API_KEY) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

async function verifyBearer(req) {
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return null;
  const token = m[1];
  
  // Detectar algoritmo y kid del token
  let alg = null;
  try {
    const parts = token.split('.');
    if (parts.length >= 2) {
      const header = JSON.parse(Buffer.from(parts[0], 'base64').toString('utf8'));
      alg = header && header.alg ? String(header.alg) : null;
    }
  } catch {}
  
  const expectedIssuer = PUBLIC_SUPABASE_URL ? `${PUBLIC_SUPABASE_URL.replace(/\/$/, '')}/auth/v1` : null;

  // Para Supabase con JWT Signing Keys, intentamos con el secreto (incluso con kid presente)
  // Supabase mantiene compatibilidad con verificación HS256 usando el JWT secret

  // Intentar verificación con JWT Secret (funciona para legacy y JWT signing keys)
  if (alg === 'HS256' && SUPABASE_JWT_SECRET) {
    try {
      const cleanedSecret = SUPABASE_JWT_SECRET.trim().replace(/[\r\n]/g, '');
      const secret = new TextEncoder().encode(cleanedSecret);
      let payload;
      
      // Intentar diferentes configuraciones de verificación
      const attempts = [
        // 1. Verificación completa con issuer y audience
        () => jwtVerify(token, secret, { 
          algorithms: ['HS256'], 
          issuer: expectedIssuer, 
          audience: 'authenticated' 
        }),
        // 2. Solo con issuer
        () => jwtVerify(token, secret, { 
          algorithms: ['HS256'], 
          issuer: expectedIssuer 
        }),
        // 3. Solo algoritmo
        () => jwtVerify(token, secret, { algorithms: ['HS256'] }),
        // 4. Sin restricciones
        () => jwtVerify(token, secret)
      ];
      
      for (let i = 0; i < attempts.length; i++) {
        try {
          ({ payload } = await attempts[i]());
          console.log(`[api] Verificación HS256 exitosa (attempt ${i+1})`);
          break;
        } catch (attemptErr) {
          console.warn(`[api] Attempt ${i+1} falló:`, attemptErr?.message || attemptErr);
          if (i === attempts.length - 1) throw attemptErr;
        }
      }
      
      return {
        uid: payload.sub,
        email: payload.email || null,
        name: payload.user_metadata?.full_name || payload.name || null,
        provider_id: payload.provider_id || null,
        _supabase: payload
      };
    } catch (e) {
      console.warn('[api] Todas las verificaciones HS256 fallaron:', e?.message || e);
    }
  }
  
  return null;
}

// App
const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: false }));
// Asegurar preflight para cualquier ruta
app.options('*', cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

// Health
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Config pública (sin secretos) solo para Supabase y bases
app.get('/api/public-config', (req, res) => {
  const supabase = { url: PUBLIC_SUPABASE_URL || '', anonKey: PUBLIC_SUPABASE_ANON_KEY || '' };
  res.json({ supabase, apiBase: PUBLIC_API_BASE || '', siteBase: PUBLIC_SITE_BASE || '' });
});

// Namespace API
const router = express.Router();

// ==============================
// Roles y scopes (RBAC simple)
// ==============================
const ROLE_SCOPES = {
  superadmin: ['*'],
  admin: [
    'admin:tenants', 'admin:users', 'admin:params', 'admin:grants',
    'reports:read', 'courses:read', 'calendar:read', 'calendar:manage', 'surveys:summary'
  ],
  profesor: ['calendar:manage', 'courses:read', 'users:read'],
  empresa: ['tenant:manage-users', 'grants:tenant', 'reports:read:tenant', 'surveys:summary:tenant'],
  usuario: ['courses:view', 'tools:use', 'surveys:submit'],
  ninguno: []
};

async function getUserGlobalRole(userId) {
  if (!pool) return null;
  try {
    const r = await pool.query(
      `SELECT role FROM tenant_users WHERE tenant_id='*' AND user_id=$1 LIMIT 1`,
      [String(userId)]
    );
    return r.rows[0]?.role || null;
  } catch {
    return null;
  }
}

function scopesForRole(role) {
  if (!role) return [];
  if (role === 'superadmin') return ['*'];
  return ROLE_SCOPES[role] || [];
}

function hasScope(effectiveScopes, needed) {
  if (!needed) return true;
  if (!effectiveScopes) return false;
  if (effectiveScopes.includes('*')) return true;
  return effectiveScopes.includes(needed);
}

async function requireAuthWithScopes(req, res, neededScope) {
  const decoded = await verifyBearer(req);
  if (!decoded) { res.status(401).json({ error: 'invalid_token' }); return null; }
  const userId = decoded.uid || decoded.user_id || decoded.sub;
  let globalRole = await getUserGlobalRole(userId);
  const effective = scopesForRole(globalRole);
  if (!hasScope(effective, neededScope)) {
    res.status(403).json({ error: 'forbidden', needed: neededScope });
    return null;
  }
  return { userId, decoded, effective, globalRole };
}

// Roles disponibles
router.get('/admin/roles', async (req, res) => {
  res.json({ roles: Object.keys(ROLE_SCOPES), scopes: ROLE_SCOPES });
});

// POST /auth/verify: verifica token y provisiona usuario de forma idempotente
router.post('/auth/verify', async (req, res) => {
  const decoded = await verifyBearer(req);
  if (!decoded) return res.status(401).json({ error: 'invalid_token' });

  // Datos básicos del usuario (Supabase)
  const uid = decoded.uid || decoded.user_id || decoded.sub;
  const email = decoded.email || null;
  const name = decoded.name || decoded._supabase?.user_metadata?.full_name || '';

  // Provisionar en DB si existe pool y tabla users
  if (pool) {
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE,
            first_name TEXT,
            last_name TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        );`
      );
      const [firstName, ...rest] = (name || '').split(' ');
      const lastName = rest.join(' ');
      await pool.query(
        `INSERT INTO users (id, email, first_name, last_name)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, updated_at = now()`,
        [uid, email, firstName || null, lastName || null]
      );
      // Aplicar invitaciones y grants pendientes por email
      if (email) {
        // 1) Convertir tenant_invites en tenant_users
        try {
          const inv = await pool.query(`SELECT tenant_id, role FROM tenant_invites WHERE email=$1`, [email]);
          for (const row of inv.rows) {
            await pool.query(
              `INSERT INTO tenant_users (tenant_id, user_id, role)
               VALUES ($1,$2,$3) ON CONFLICT (tenant_id, user_id) DO NOTHING`,
              [row.tenant_id, uid, row.role || 'usuario']
            );
          }
          await pool.query(`DELETE FROM tenant_invites WHERE email=$1`, [email]);
        } catch { }
        // 2) Aplicar pending_grants
        try {
          const pg = await pool.query(`SELECT entitlements FROM pending_grants WHERE email=$1`, [email]);
          if (pg.rows[0]?.entitlements?.length) {
            await grantEntitlements({ userId: uid, email, entitlements: pg.rows[0].entitlements });
            await pool.query(`DELETE FROM pending_grants WHERE email=$1`, [email]);
          }
        } catch { }
      }
    } catch (e) {
      console.warn('[api] upsert users falló (continuamos):', e?.message || e);
    }
  }

  return res.status(204).send();
});

// GET /auth/me: devuelve user + enrollments según token
router.get('/auth/me', async (req, res) => {
  const decoded = await verifyBearer(req);
  if (!decoded) return res.status(401).json({ error: 'invalid_token' });

  const idClaim = decoded.uid || decoded.user_id || decoded.sub;
  let user = {
    id: idClaim,
    email: decoded.email || null,
    first_name: (decoded.name || decoded._supabase?.user_metadata?.full_name || '').split(' ')[0] || null,
    last_name: (decoded.name || decoded._supabase?.user_metadata?.full_name || '').split(' ').slice(1).join(' ') || null
  };
  let enrollments = [];
  let memberships = [];
  let scopes = [];

  if (pool) {
    try {
  const ures = await pool.query('SELECT id, email, first_name, last_name FROM users WHERE id = $1 LIMIT 1', [idClaim]);
      if (ures.rows[0]) {
        user = ures.rows[0];
      }
    } catch (e) {
      console.warn('[api] select users falló (continuamos):', e?.message || e);
    }
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS enrollments (
          id TEXT PRIMARY KEY,
          user_id UUID NOT NULL,
          entitlement TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        );`
      );
      const eres = await pool.query('SELECT entitlement FROM enrollments WHERE user_id = $1', [idClaim]);
      enrollments = eres.rows.map(r => r.entitlement);
    } catch (e) {
      console.warn('[api] select enrollments falló (continuamos):', e?.message || e);
    }
    try {
      const mr = await pool.query('SELECT tenant_id, role FROM tenant_users WHERE user_id=$1', [idClaim]);
      memberships = mr.rows || [];
      const globalRole = mr.rows.find(r => r.tenant_id === '*')?.role || null;
      scopes = scopesForRole(globalRole);
    } catch (e) {
      console.warn('[api] select tenant_users falló (continuamos):', e?.message || e);
    }
  }

  return res.json({ user, enrollments, memberships, scopes });
});

// ==============================
// Admin: Tenants e invitaciones
// ==============================
router.get('/admin/tenants', async (req, res) => {
  const auth = await requireAuthWithScopes(req, res, 'admin:tenants');
  if (!auth) return;
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const r = await pool.query('SELECT id, name, metadata FROM tenants ORDER BY name ASC');
  res.json({ items: r.rows });
});

router.post('/admin/tenants', async (req, res) => {
  const auth = await requireAuthWithScopes(req, res, 'admin:tenants');
  if (!auth) return;
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const { id, name, metadata = {} } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name_required' });
  const tid = (id && String(id)) || `ten_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  await pool.query('INSERT INTO tenants (id, name, metadata) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, metadata=COALESCE(EXCLUDED.metadata, tenants.metadata)', [tid, String(name), metadata]);
  res.status(201).json({ id: tid, name, metadata });
});

router.put('/admin/tenants/:id', async (req, res) => {
  const auth = await requireAuthWithScopes(req, res, 'admin:tenants');
  if (!auth) return;
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const id = String(req.params.id);
  const { name, metadata } = req.body || {};
  await pool.query('UPDATE tenants SET name=COALESCE($2,name), metadata=COALESCE($3,metadata) WHERE id=$1', [id, name || null, metadata || null]);
  res.status(204).send();
});

router.delete('/admin/tenants/:id', async (req, res) => {
  const auth = await requireAuthWithScopes(req, res, 'admin:tenants');
  if (!auth) return;
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const id = String(req.params.id);
  await pool.query('DELETE FROM tenants WHERE id=$1', [id]);
  res.status(204).send();
});

// Otorgar acceso por licitación: generar invitaciones por email y grants pendientes
router.post('/admin/tenants/:id/grant-access', async (req, res) => {
  const auth = await requireAuthWithScopes(req, res, 'admin:grants');
  if (!auth) return;
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const tenantId = String(req.params.id);
  const { emails = [], entitlements = [], role = 'usuario' } = req.body || {};
  const normalized = emails
    .filter(Boolean)
    .map(e => String(e).trim().toLowerCase())
    .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (!normalized.length) return res.status(400).json({ error: 'emails_required' });
  try {
    for (const email of normalized) {
      // Invitación a tenant
      await pool.query(
        `INSERT INTO tenant_invites (tenant_id, email, role)
         VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id, email) DO UPDATE SET role=EXCLUDED.role`,
        [tenantId, email, role]
      );
      // Grants pendientes agregados/mergeados
      const r = await pool.query('SELECT email, entitlements FROM pending_grants WHERE email=$1', [email]);
      const prev = r.rows[0]?.entitlements || [];
      const merged = Array.from(new Set([...(prev||[]), ...entitlements]));
      if (merged.length) {
        await pool.query(
          `INSERT INTO pending_grants (email, entitlements, tenant_id)
           VALUES ($1,$2,$3)
           ON CONFLICT (email) DO UPDATE SET entitlements = $2, tenant_id=COALESCE(EXCLUDED.tenant_id, pending_grants.tenant_id)`,
          [email, merged, tenantId]
        );
      }
    }
    res.status(204).send();
  } catch (e) {
    console.error('[api] grant-access error:', e?.message || e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Listado de usuarios opcionalmente filtrado por tenant
router.get('/admin/users', async (req, res) => {
  const auth = await requireAuthWithScopes(req, res, 'admin:users');
  if (!auth) return;
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const tenantId = req.query.tenant_id ? String(req.query.tenant_id) : null;
  try {
    let q = `SELECT u.id, u.email, u.first_name, u.last_name,
                    COALESCE(json_agg(json_build_object('tenant_id', tu.tenant_id, 'role', tu.role)) FILTER (WHERE tu.tenant_id IS NOT NULL), '[]'::json) AS memberships
             FROM users u
             LEFT JOIN tenant_users tu ON tu.user_id = u.id`;
    const params = [];
    if (tenantId) {
      q += ` WHERE EXISTS (SELECT 1 FROM tenant_users x WHERE x.user_id = u.id AND x.tenant_id = $1)`;
      params.push(tenantId);
    }
    q += ' GROUP BY u.id ORDER BY u.email ASC';
    const r = await pool.query(q, params);
    res.json({ items: r.rows });
  } catch (e) {
    console.error('[api] admin/users error:', e?.message || e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Upsert masivo por email (provisiona en users por email con id pseudo, hasta que haga login)
router.post('/admin/users/bulk-upsert', async (req, res) => {
  const auth = await requireAuthWithScopes(req, res, 'admin:users');
  if (!auth) return;
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const { users = [] } = req.body || {};
  try {
    for (const u of users) {
      const email = String(u.email || '').trim().toLowerCase();
      if (!EMAIL_REGEX.test(email)) continue;
      // Intentar encontrar id existente por email
      let id = null;
      const r = await pool.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [email]);
      id = r.rows[0]?.id || null;
      if (id) {
        await pool.query('UPDATE users SET first_name=COALESCE($2,first_name), last_name=COALESCE($3,last_name), updated_at=now() WHERE id=$1', [id, u.first_name || null, u.last_name || null]);
      }
      if (u.tenant_id && u.role) {
        if (id) {
          // Usuario existe: aplicar rol directamente
          await pool.query('INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, user_id) DO UPDATE SET role=EXCLUDED.role', [String(u.tenant_id), id, String(u.role)]);
        } else {
          // Usuario no existe aún: crear invitación por email para que se aplique al primer login
          await pool.query(
            `INSERT INTO tenant_invites (tenant_id, email, role)
             VALUES ($1,$2,$3)
             ON CONFLICT (tenant_id, email) DO UPDATE SET role=EXCLUDED.role`,
            [String(u.tenant_id), email, String(u.role)]
          );
        }
      }
    }
    res.status(204).send();
  } catch (e) {
    console.error('[api] bulk-upsert error:', e?.message || e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Parámetros de administración (global)
router.get('/admin/params', async (req, res) => {
  const auth = await requireAuthWithScopes(req, res, 'admin:params');
  if (!auth) return;
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const r = await pool.query(`SELECT data FROM admin_params WHERE id='global'`);
  res.json({ data: r.rows[0]?.data || {} });
});
router.put('/admin/params', async (req, res) => {
  const auth = await requireAuthWithScopes(req, res, 'admin:params');
  if (!auth) return;
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const data = (req.body && req.body.data) || req.body || {};
  await pool.query(`INSERT INTO admin_params (id, data) VALUES ('global',$1) ON CONFLICT (id) DO UPDATE SET data=$1`, [data]);
  res.status(204).send();
});

// Actividades / Cursos (solo lectura por ahora)
router.get('/activities', async (req, res) => {
  if (!pool) return res.json({ items: [] });
  const r = await pool.query('SELECT id, name, color, schedule, recorded_course, members FROM activities ORDER BY name ASC');
  res.json({ items: r.rows });
});

router.get('/courses', async (req, res) => {
  if (!pool) return res.json({ items: [] });
  const r = await pool.query('SELECT id, title, hours_expected, metadata FROM courses ORDER BY title ASC');
  res.json({ items: r.rows });
});

// Asignación de roles globales por email (tenant_id='*')
router.post('/admin/roles/global-assign', async (req, res) => {
  const auth = await requireAuthWithScopes(req, res, 'admin:users');
  if (!auth) return;
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const items = (req.body && (req.body.assignments || req.body.items)) || req.body || [];
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'assignments_required' });
  const out = { updated: 0, errors: [] };
  for (const it of items) {
    try {
      const email = String(it.email || '').trim().toLowerCase();
      const role = String(it.role || '').trim().toLowerCase();
      if (!EMAIL_REGEX.test(email)) { out.errors.push({ email, error: 'invalid_email' }); continue; }
      if (!ROLE_SCOPES[role]) { out.errors.push({ email, error: 'invalid_role' }); continue; }
      // localizar o crear usuario por email
      let userId = null;
      try {
        const r = await pool.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [email]);
        userId = r.rows[0]?.id || null;
  } catch { }
      if (userId) {
        await pool.query(
          `INSERT INTO tenant_users (tenant_id, user_id, role)
           VALUES ('*', $1, $2)
           ON CONFLICT (tenant_id, user_id) DO UPDATE SET role=EXCLUDED.role`,
          [userId, role]
        );
      } else {
        // Sin usuario aún: invitación global (tenant_id='*') que se aplicará en /auth/verify al primer login
        await pool.query(
          `INSERT INTO tenant_invites (tenant_id, email, role)
           VALUES ('*', $1, $2)
           ON CONFLICT (tenant_id, email) DO UPDATE SET role=EXCLUDED.role`,
          [email, role]
        );
      }
      out.updated++;
    } catch (e) {
      out.errors.push({ email: it && it.email, error: e?.message || String(e) });
    }
  }
  res.json(out);
});

// ==============================
// Encuesta de satisfacción
// ==============================
router.post('/surveys/satisfaction/:moduleId', async (req, res) => {
  const decoded = await verifyBearer(req);
  if (!decoded) return res.status(401).json({ error: 'invalid_token' });
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const userId = decoded.uid || decoded.user_id || decoded.sub;
  const moduleId = String(req.params.moduleId);
  const answers = (req.body && req.body.answers) || req.body || {};
  if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'invalid_answers' });
  const values = Object.values(answers).map(x => Number(x)).filter(n => !isNaN(n));
  const score = values.length ? (values.reduce((a,b)=>a+b,0) / values.length) : null;
  // Resolver tenant_id si existe membresía (toma el primero distinto de '*')
  let tenantId = null;
  try {
    const mr = await pool.query("SELECT tenant_id FROM tenant_users WHERE user_id=$1 AND tenant_id <> '*' LIMIT 1", [userId]);
    tenantId = mr.rows[0]?.tenant_id || null;
  } catch { }
  const id = `sv_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  await pool.query('INSERT INTO survey_responses (id, user_id, module_id, tenant_id, answers, score) VALUES ($1,$2,$3,$4,$5,$6)', [id, userId, moduleId, tenantId, JSON.stringify(answers), score]);
  res.status(201).json({ id, score });
});

router.get('/surveys/satisfaction/summary', async (req, res) => {
  const auth = await requireAuthWithScopes(req, res, 'surveys:summary');
  if (!auth) return;
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const { module_id = null, tenant_id = null, from = null, to = null } = req.query || {};
  const params = [];
  let where = '1=1';
  if (module_id) { where += ` AND module_id = $${params.length+1}`; params.push(String(module_id)); }
  if (tenant_id) { where += ` AND COALESCE(tenant_id,'') = $${params.length+1}`; params.push(String(tenant_id)); }
  if (from) { where += ` AND created_at >= $${params.length+1}`; params.push(new Date(from)); }
  if (to) { where += ` AND created_at <= $${params.length+1}`; params.push(new Date(to)); }
  const q = `SELECT module_id, COALESCE(tenant_id,'') AS tenant_id, COUNT(*) as responses, ROUND(AVG(NULLIF(score, 'NaN')),2) as avg_score FROM survey_responses WHERE ${where} GROUP BY module_id, tenant_id ORDER BY module_id`;
  const r = await pool.query(q, params);
  res.json({ items: r.rows });
});

// ==============================
// Persistencia simple por usuario/herramienta (JSON)
// ==============================
router.get('/user-data/:tool/:docId', async (req, res) => {
  const decoded = await verifyBearer(req);
  if (!decoded) return res.status(401).json({ error: 'invalid_token' });
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const userId = decoded.uid || decoded.user_id || decoded.sub;
  const tool = String(req.params.tool || '').trim().toLowerCase();
  const docId = String(req.params.docId || 'default').trim().toLowerCase();
  if (!tool) return res.status(400).json({ error: 'tool_required' });
  try {
    const r = await pool.query(`SELECT data, updated_at FROM user_data WHERE user_id=$1 AND tool=$2 AND doc_id=$3`, [userId, tool, docId]);
    if (!r.rows[0]) return res.status(404).json({ notFound: true });
    return res.json({ data: r.rows[0].data || {}, updated_at: r.rows[0].updated_at });
  } catch (e) {
    console.error('[api] user-data get error:', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.put('/user-data/:tool/:docId', async (req, res) => {
  const decoded = await verifyBearer(req);
  if (!decoded) return res.status(401).json({ error: 'invalid_token' });
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const userId = decoded.uid || decoded.user_id || decoded.sub;
  const tool = String(req.params.tool || '').trim().toLowerCase();
  const docId = String(req.params.docId || 'default').trim().toLowerCase();
  const payload = (req.body && (req.body.data || req.body)) || {};
  if (!tool) return res.status(400).json({ error: 'tool_required' });
  if (typeof payload !== 'object') return res.status(400).json({ error: 'invalid_data' });
  try {
    await pool.query(
      `INSERT INTO user_data (user_id, tool, doc_id, data, updated_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (user_id, tool, doc_id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [userId, tool, docId, JSON.stringify(payload)]
    );
    return res.status(204).send();
  } catch (e) {
    console.error('[api] user-data put error:', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// ==============================
// Tracking de video y contenido (LMS-lite)
// ==============================
router.post('/tracking/video', async (req, res) => {
  const decoded = await verifyBearer(req);
  if (!decoded) return res.status(401).json({ error: 'invalid_token' });
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const userId = decoded.uid || decoded.user_id || decoded.sub;
  const { video_id, delta = 0, position = 0, duration = 0, state = 'heartbeat', visible = true } = req.body || {};
  if (!video_id) return res.status(400).json({ error: 'video_id_required' });
  const id = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  try {
    await pool.query(
      `INSERT INTO video_events (id, user_id, video_id, event, delta_seconds, position_seconds, duration_seconds, visible)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, userId, String(video_id), String(state), Number(delta)||0, Number(position)||0, Number(duration)||0, !!visible]
    );
    // Upsert progreso agregado
    await pool.query(
      `INSERT INTO content_progress (id, user_id, content_type, content_id, progress_seconds, completed, last_ts)
       VALUES ($1,$2,'video',$3,$4, $5, now())
       ON CONFLICT (user_id, content_type, content_id)
       DO UPDATE SET progress_seconds = content_progress.progress_seconds + EXCLUDED.progress_seconds,
                     completed = content_progress.completed OR EXCLUDED.completed,
                     last_ts = now()`,
      [`cp_${userId}_${video_id}`, userId, String(video_id), Math.max(0, Number(delta)||0), false]
    );
    // Si tenemos duration y suma supera 90%, marcar completed
    if (duration) {
      const r = await pool.query(
        `SELECT progress_seconds FROM content_progress WHERE user_id=$1 AND content_type='video' AND content_id=$2`,
        [userId, String(video_id)]
      );
      const prog = r.rows[0]?.progress_seconds || 0;
      if (prog >= 0.9 * Number(duration)) {
        await pool.query(
          `UPDATE content_progress SET completed = true WHERE user_id=$1 AND content_type='video' AND content_id=$2`,
          [userId, String(video_id)]
        );
      }
    }
    return res.status(204).send();
  } catch (e) {
    console.error('[api] tracking/video error:', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.post('/tracking/content', async (req, res) => {
  const decoded = await verifyBearer(req);
  if (!decoded) return res.status(401).json({ error: 'invalid_token' });
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const userId = decoded.uid || decoded.user_id || decoded.sub;
  const { content_type = 'article', content_id, delta = 0, completed = false } = req.body || {};
  if (!content_id) return res.status(400).json({ error: 'content_id_required' });
  try {
    await pool.query(
      `INSERT INTO content_progress (id, user_id, content_type, content_id, progress_seconds, completed, last_ts)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (user_id, content_type, content_id)
       DO UPDATE SET progress_seconds = content_progress.progress_seconds + EXCLUDED.progress_seconds,
                     completed = content_progress.completed OR EXCLUDED.completed,
                     last_ts = now()`,
      [`cp_${userId}_${content_type}_${content_id}`, userId, String(content_type), String(content_id), Math.max(0, Number(delta)||0), !!completed]
    );
    return res.status(204).send();
  } catch (e) {
    console.error('[api] tracking/content error:', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// ==============================
// Identidad del usuario (RUT, PII)
// ==============================
router.post('/users/identity', async (req, res) => {
  const decoded = await verifyBearer(req);
  if (!decoded) return res.status(401).json({ error: 'invalid_token' });
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const userId = decoded.uid || decoded.user_id || decoded.sub;
  const { first_name, last_name, rut } = req.body || {};
  if (rut && !validateRUT(rut)) return res.status(400).json({ error: 'invalid_rut' });
  try {
    await pool.query(
      `UPDATE users SET first_name = COALESCE($2, first_name), last_name = COALESCE($3, last_name), rut = COALESCE($4, rut), rut_verified = CASE WHEN $4 IS NOT NULL THEN true ELSE rut_verified END, rut_updated_at = CASE WHEN $4 IS NOT NULL THEN now() ELSE rut_updated_at END, updated_at = now() WHERE id = $1`,
      [userId, first_name || null, last_name || null, rut || null]
    );
    return res.status(204).send();
  } catch (e) {
    console.error('[api] users/identity error:', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// ==============================
// Certificados
// ==============================
function genCertCode() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

router.post('/certificates/issue', async (req, res) => {
  if (!requireApiKey(req, res)) return;
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const { user_id, course_id, type = 'completion', hours = null, metadata = {} } = req.body || {};
  if (!user_id || !course_id) return res.status(400).json({ error: 'missing_fields' });
  const id = `cert_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const code = genCertCode();
  try {
    await pool.query(
      `INSERT INTO certificates (id, user_id, course_id, type, hours, code, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, String(user_id), String(course_id), String(type), hours === null ? null : Number(hours), code, metadata]
    );
    const verifyUrl = `${PUBLIC_SITE_BASE.replace(/\/$/, '')}/api/certificates/verify?code=${code}`;
    return res.json({ id, code, verifyUrl });
  } catch (e) {
    console.error('[api] certificates/issue error:', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.get('/certificates/verify', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const code = String(req.query.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'code_required' });
  try {
    const r = await pool.query(`SELECT user_id, course_id, type, issued_at, hours, code, revoked, metadata FROM certificates WHERE code = $1 LIMIT 1`, [code]);
    if (!r.rows[0]) return res.status(404).json({ valid: false });
    const cert = r.rows[0];
    return res.json({ valid: !cert.revoked, certificate: cert });
  } catch (e) {
    console.error('[api] certificates/verify error:', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Render PDF y subir a GCS: POST /certificates/render-pdf
// Body: { code } | { user_id, course_id, type }
router.post('/certificates/render-pdf', async (req, res) => {
  if (!requireApiKey(req, res)) return;
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  if (!gcs || !CERT_BUCKET) return res.status(503).json({ error: 'storage_unavailable' });
  try {
    const { code: codeIn, user_id, course_id } = req.body || {};
    let certRow = null;
    if (codeIn) {
      const r = await pool.query(`SELECT id, user_id, course_id, type, issued_at, hours, code, revoked FROM certificates WHERE code=$1 LIMIT 1`, [String(codeIn).trim().toUpperCase()]);
      certRow = r.rows[0] || null;
    } else if (user_id && course_id) {
      const r = await pool.query(`SELECT id, user_id, course_id, type, issued_at, hours, code, revoked FROM certificates WHERE user_id=$1 AND course_id=$2 ORDER BY issued_at DESC LIMIT 1`, [String(user_id), String(course_id)]);
      certRow = r.rows[0] || null;
    }
    if (!certRow) return res.status(404).json({ error: 'certificate_not_found' });
    if (certRow.revoked) return res.status(400).json({ error: 'certificate_revoked' });

    // Datos del usuario (nombre y RUT)
    const ur = await pool.query(`SELECT first_name, last_name, rut FROM users WHERE id=$1 LIMIT 1`, [certRow.user_id]);
    const u = ur.rows[0] || { first_name: null, last_name: null, rut: null };
    const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || 'Usuario';
    const rut = u.rut || '—';
    const issuedDate = certRow.issued_at ? new Date(certRow.issued_at).toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
    const typeLabel = certRow.type === 'participation' ? 'Participación' : 'Finalización';
    const actionLabel = certRow.type === 'participation' ? 'participado en' : 'completado';
    const code = certRow.code;
    const verifyUrl = `${PUBLIC_SITE_BASE.replace(/\/$/, '')}/api/certificates/verify?code=${encodeURIComponent(code)}`;

    // Leer template y renderizar con Puppeteer
    const fsPromises = await import('fs/promises');
    const { default: puppeteer } = await import('puppeteer');
    const { default: QR } = await import('qrcode');
    const tplPath = path.join(process.cwd(), 'reports', 'templates', 'certificate.html');
    const html = await fsPromises.readFile(tplPath, 'utf-8');
    const qrDataUrl = await QR.toDataURL(verifyUrl, { margin: 1, scale: 4 });
    const courseTitle = certRow.course_id; // Si hay catálogo de cursos, puedes mapear a título real
    const filled = html
      .replace(/\{\{FULL_NAME\}\}/g, fullName)
      .replace(/\{\{RUT\}\}/g, rut)
      .replace(/\{\{COURSE_TITLE\}\}/g, courseTitle)
      .replace(/\{\{TYPE_LABEL\}\}/g, typeLabel)
      .replace(/\{\{ACTION_LABEL\}\}/g, actionLabel)
      .replace(/\{\{ISSUED_AT\}\}/g, issuedDate)
      .replace(/\{\{HOURS\}\}/g, String(certRow.hours ?? '—'))
      .replace(/\{\{CODE\}\}/g, code)
      .replace(/\{\{VERIFY_URL\}\}/g, verifyUrl)
      .replace('<!-- Inserta aquí un <img src="data:image/png;base64,...."> con el QR de VERIFY_URL al renderizar -->', `<img alt="QR" src="${qrDataUrl}" width="120" height="120"/>`);

    const tmpHtmlPath = path.join(process.cwd(), 'api', '_tmp', `.cert_${code}.html`);
  try { fs.mkdirSync(path.dirname(tmpHtmlPath), { recursive: true }); } catch { }
    await fsPromises.writeFile(tmpHtmlPath, filled, 'utf-8');

    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
    let pdfBuffer;
    try {
      const page = await browser.newPage();
      const url = `file://${tmpHtmlPath.replace(/\\/g,'/')}`;
      await page.goto(url, { waitUntil: 'networkidle0' });
      pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
    } finally {
      await browser.close();
  try { await fsPromises.unlink(tmpHtmlPath); } catch { }
    }

    // Subir a GCS
    const objectPath = `certificates/${certRow.course_id}/${certRow.user_id}/${code}.pdf`;
    const bucket = gcs.bucket(CERT_BUCKET);
    const file = bucket.file(objectPath);
    await file.save(pdfBuffer, { contentType: 'application/pdf', resumable: false, metadata: { cacheControl: 'private, max-age=0, no-transform' } });
    let url;
    if (CERT_URL_MODE === 'public') {
      try { await file.makePublic(); } catch { }
      url = `https://storage.googleapis.com/${CERT_BUCKET}/${objectPath}`;
    } else {
      // Signed URL v4
      const [signed] = await file.getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + CERT_SIGNED_TTL * 1000 });
      url = signed;
    }

    return res.json({ ok: true, path: objectPath, url });
  } catch (e) {
    console.error('[api] certificates/render-pdf error:', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// ==============================
// Reportes (API Key)
// ==============================
router.get('/reports/progress', async (req, res) => {
  if (!requireApiKey(req, res)) return;
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const { course_id, from, to } = req.query || {};
  try {
    const params = [];
    let where = '1=1';
    if (course_id) {
      where += ' AND l.course_id = $' + (params.length + 1);
      params.push(String(course_id));
    }
    if (from) {
      where += ' AND cp.last_ts >= $' + (params.length + 1);
      params.push(new Date(from));
    }
    if (to) {
      where += ' AND cp.last_ts <= $' + (params.length + 1);
      params.push(new Date(to));
    }
    const q = `
      SELECT u.id as user_id, u.email, u.first_name, u.last_name, u.rut,
             l.course_id, l.id as content_id, l.title as content_title,
             cp.progress_seconds, cp.completed, cp.last_ts
      FROM content_progress cp
      LEFT JOIN users u ON u.id = cp.user_id
      LEFT JOIN lessons l ON (l.id = cp.content_id)
      WHERE ${where}
      ORDER BY u.email, cp.last_ts DESC
    `;
    const r = await pool.query(q, params);
    // CSV opcional
    if ((req.headers['accept'] || '').includes('text/csv')) {
      const header = 'user_id,email,first_name,last_name,rut,course_id,content_id,content_title,progress_seconds,completed,last_ts\n';
      const rows = r.rows.map(row => [row.user_id, row.email, row.first_name, row.last_name, row.rut, row.course_id, row.content_id, row.content_title, row.progress_seconds, row.completed, row.last_ts?.toISOString?.() || row.last_ts].join(','));
      res.setHeader('Content-Type', 'text/csv');
      return res.send(header + rows.join('\n'));
    }
    return res.json({ items: r.rows });
  } catch (e) {
    console.error('[api] reports/progress error:', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Reporte agregado de horas por usuario/curso
router.get('/reports/hours', async (req, res) => {
  if (!requireApiKey(req, res)) return;
  if (!pool) return res.status(503).json({ error: 'db_unavailable' });
  const { course_id, from, to } = req.query || {};
  try {
    const params = [];
    let where = '1=1';
    if (course_id) { where += ' AND l.course_id = $' + (params.length + 1); params.push(String(course_id)); }
    if (from) { where += ' AND cp.last_ts >= $' + (params.length + 1); params.push(new Date(from)); }
    if (to) { where += ' AND cp.last_ts <= $' + (params.length + 1); params.push(new Date(to)); }
    const q = `
      SELECT u.id AS user_id, u.email, u.first_name, u.last_name, u.rut,
             l.course_id,
             SUM(COALESCE(cp.progress_seconds,0)) AS total_seconds,
             ROUND(SUM(COALESCE(cp.progress_seconds,0))/3600.0, 2) AS total_hours,
             SUM(CASE WHEN cp.completed THEN 1 ELSE 0 END) AS completed_count,
             MAX(cp.last_ts) AS last_activity
      FROM content_progress cp
      LEFT JOIN users u ON u.id = cp.user_id
      LEFT JOIN lessons l ON l.id = cp.content_id
      WHERE ${where}
      GROUP BY u.id, u.email, u.first_name, u.last_name, u.rut, l.course_id
      ORDER BY u.email, l.course_id
    `;
    const r = await pool.query(q, params);
    if ((req.headers['accept'] || '').includes('text/csv')) {
      const header = 'user_id,email,first_name,last_name,rut,course_id,total_seconds,total_hours,completed_count,last_activity\n';
      const rows = r.rows.map(row => [row.user_id, row.email, row.first_name, row.last_name, row.rut, row.course_id, row.total_seconds, row.total_hours, row.completed_count, row.last_activity?.toISOString?.() || row.last_activity].join(','));
      res.setHeader('Content-Type', 'text/csv');
      return res.send(header + rows.join('\n'));
    }
    return res.json({ items: r.rows });
  } catch (e) {
    console.error('[api] reports/hours error:', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// ==============================
// Mercado Pago: configuración y endpoints
// ==============================
let mpClient = null;
let mpPreference = null;
let mpPayment = null;
if (MP_ACCESS_TOKEN) {
  try {
    mpClient = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
    mpPreference = new Preference(mpClient);
    mpPayment = new Payment(mpClient);
    console.log('[api] Mercado Pago SDK inicializado');
  } catch (e) {
    console.warn('[api] No se pudo inicializar Mercado Pago SDK:', e?.message || e);
  }
} else {
  console.warn('[api] MP_ACCESS_TOKEN no definido; /mp/* limitado o inactivo.');
}

function buildNotificationUrl(req) {
  if (PUBLIC_API_BASE) return `${PUBLIC_API_BASE}${BASE_PATH}/mp/webhook`;
  // Fallback: derivar del request (puede no ser preciso detrás de proxies)
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https');
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}${BASE_PATH}/mp/webhook`;
}

function inferSiteBase(req, referer) {
  if (process.env.PUBLIC_SITE_BASE) return PUBLIC_SITE_BASE;
  try {
    const r = referer || '';
    if (!r) return PUBLIC_SITE_BASE;
    const u = new URL(r);
    return `${u.protocol}//${u.host}`;
  } catch {
    return PUBLIC_SITE_BASE;
  }
}

function mapItemToEntitlement(item) {
  // Dado un item, intenta deducir entitlement
  // Convención: item.metadata.entitlement o item.id/sku
  const mdEnt = (item && item.metadata && (item.metadata.entitlement || item.metadata.entitlements)) || null;
  if (mdEnt) return mdEnt;
  const id = (item && (item.id || item.sku || item.category_id)) || '';
  // Mapeo básico por id/sku
  const map = {
    'course.pmv': 'course.pmv',
    'course.pmf': 'course.pmf',
    'course.growth': 'course.growth',
    'course.ceo': 'course.ceo',
    'product.camino_dorado': 'product.camino_dorado',
    'product.deceroacien': 'product.deceroacien'
  };
  return map[id] || null;
}

async function grantEntitlements({ userId, email, entitlements = [] }) {
  if (!pool) return; // si no hay DB, no persistimos (visibilidad dependerá del cliente)
  if (!entitlements || !entitlements.length) return;
  try {
    await ensureSchema();
    let uid = userId || null;
    if (!uid && email) {
      // buscar user id por email
      try {
        const r = await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
        if (r.rows[0]) uid = r.rows[0].id;
      } catch {}
    }
    if (!uid) return; // sin usuario no podemos asignar
    for (const ent of entitlements.flat()) {
      if (!ent) continue;
      const rowId = `enr_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      try {
        await pool.query('INSERT INTO enrollments (id, user_id, entitlement) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING', [rowId, uid, ent]);
      } catch {}
    }
  } catch (e) {
    console.warn('[api] grantEntitlements falló:', e?.message || e);
  }
}

async function sendEmail({ to, subject, html }) {
  // Preferir Resend si hay API key
  if (RESEND_API_KEY) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ from: SMTP_FROM, to: Array.isArray(to) ? to : [to], subject, html })
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(()=> '');
        throw new Error(`Resend error ${resp.status}: ${txt}`);
      }
      return true;
    } catch (e) {
      console.warn('[api] Resend fallo, intento SMTP si está configurado:', e?.message || e);
      // Fallback a SMTP si está disponible
    }
  }
  if (!SMTP_URL && !SMTP_HOST) return false;
  try {
    const transporter = SMTP_URL
      ? nodemailer.createTransport(SMTP_URL)
      : nodemailer.createTransport({
          host: SMTP_HOST,
          port: SMTP_PORT,
          secure: SMTP_SECURE,
          auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
        });
    await transporter.sendMail({ from: SMTP_FROM, to, subject, html });
    return true;
  } catch (e) {
    console.warn('[api] sendEmail fallo:', e?.message || e);
    return false;
  }
}

// ==============================
// Google Meet: join con registro de asistencia
// ==============================
router.get('/meet/join', async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '').trim();
    const session = String(req.query.session || '').trim();
    if (!rawUrl) return res.status(400).json({ error: 'url_required' });
    // Validar host permitido para evitar open-redirect
    let url;
    try { url = new URL(rawUrl); } catch { return res.status(400).json({ error: 'invalid_url' }); }
    const allowedHosts = new Set(['meet.google.com', 'g.co']);
    if (!allowedHosts.has(url.host)) return res.status(400).json({ error: 'forbidden_host' });

    // Si hay token, registrar asistencia
    const decoded = await verifyBearer(req);
    if (decoded && pool) {
      try {
        const userId = decoded.uid || decoded.user_id || decoded.sub;
        const sessionId = session || `meet:${url.pathname.replace(/\//g, '')}`;
        await pool.query(
          `INSERT INTO attendance (id, user_id, session_id, joined_at)
           VALUES ($1,$2,$3, now())
           ON CONFLICT (user_id, session_id)
           DO UPDATE SET joined_at = COALESCE(attendance.joined_at, EXCLUDED.joined_at)`,
          [`att_${userId}_${sessionId}`, userId, sessionId]
        );
      } catch (e) {
        console.warn('[api] meet/join attendance err:', e?.message || e);
      }
    }
    return res.redirect(url.toString());
  } catch (e) {
    console.error('[api] meet/join error:', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function persistDownloadLead({ email, name, source, tags, metadata }) {
  if (!pool) {
    try {
      const dir = path.join(process.cwd(), 'api', '_tmp');
      fs.mkdirSync(dir, { recursive: true });
      const payload = {
        id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        email,
        name: name || null,
        source: source || 'descargas-gratuitas',
        tags: Array.isArray(tags) ? tags : null,
        metadata: metadata || null,
        stored_at: new Date().toISOString(),
        storage: 'file'
      };
      fs.appendFileSync(path.join(dir, 'download-leads.ndjson'), JSON.stringify(payload) + '\n', 'utf-8');
      return { stored: false, fallback: 'file' };
    } catch (e) {
      console.warn('[api] persistDownloadLead fallback file error:', e?.message || e);
      return { stored: false, reason: 'no_database' };
    }
  }

  try {
    await ensureSchema();
    const id = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tagsArray = Array.isArray(tags)
      ? tags.map(t => String(t || '').trim()).filter(Boolean)
      : [];
    const metadataJson = metadata && typeof metadata === 'object' ? metadata : {};
    const res = await pool.query(
      `INSERT INTO download_leads (id, email, name, source, tags, metadata)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (email, source) DO UPDATE
         SET name = COALESCE(EXCLUDED.name, download_leads.name),
             tags = CASE
               WHEN EXCLUDED.tags IS NULL OR array_length(EXCLUDED.tags, 1) IS NULL OR array_length(EXCLUDED.tags, 1) = 0
                 THEN download_leads.tags
               ELSE EXCLUDED.tags
             END,
             metadata = COALESCE(download_leads.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
             updated_at = now()
       RETURNING id;`,
      [
        id,
        email,
        name || null,
        source || 'descargas-gratuitas',
  tagsArray,
        JSON.stringify(metadataJson)
      ]
    );
    return { stored: true, id: res.rows[0]?.id || id };
  } catch (e) {
    console.warn('[api] persistDownloadLead falló:', e?.message || e);
    return { stored: false, reason: e?.message || 'db_error' };
  }
}

router.post('/leads/downloads', async (req, res) => {
  try {
    // Honeypot: si viene un campo 'hp' con contenido, aceptar silenciosamente
    if (req.body && typeof req.body.hp === 'string' && req.body.hp.trim()) {
      return res.status(200).json({ ok: true, honeypot: true });
    }

    // Cooldown leve por IP (20s)
    const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || req.socket?.remoteAddress || 'unknown';
    global.__dc100_rate__ = global.__dc100_rate__ || new Map();
    const key = `downloads:${ip}`;
    const now = Date.now();
    const last = global.__dc100_rate__.get(key) || 0;
    if (now - last < 20000) {
      res.setHeader('X-Rate-Limited', '1');
      return res.status(200).json({ ok: true, rate_limited: true });
    }
    global.__dc100_rate__.set(key, now);

    const body = req.body || {};
    const rawEmail = typeof body.email === 'string' ? body.email.trim() : '';
    if (!rawEmail || !EMAIL_REGEX.test(rawEmail)) {
      return res.status(400).json({ error: 'invalid_email' });
    }

    const email = rawEmail.toLowerCase();
    const name = typeof body.name === 'string' ? body.name.trim() || null : null;
    const source = typeof body.source === 'string' && body.source.trim()
      ? body.source.trim().toLowerCase()
      : 'descargas-gratuitas';
    const tags = Array.isArray(body.tags)
      ? body.tags.map(tag => String(tag || '').trim()).filter(Boolean)
      : [];
    const consent = (body.consent && typeof body.consent === 'object') ? body.consent : null;

    const metadata = (body.metadata && typeof body.metadata === 'object') ? { ...body.metadata } : {};
    if (body.asset && typeof body.asset === 'string') {
      metadata.asset = body.asset;
    }
    if (body.context && typeof body.context === 'object') {
      metadata.context = body.context;
    }
    if (body.formId && typeof body.formId === 'string') {
      metadata.formId = body.formId;
    }
    if (body.formVariant && typeof body.formVariant === 'string') {
      metadata.formVariant = body.formVariant;
    }
    metadata.page = metadata.page || body.page || null;
    metadata.referer = req.headers['referer'] || null;
    metadata.ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || req.socket?.remoteAddress || null;
    metadata.userAgent = req.headers['user-agent'] || null;
    if (consent) {
      metadata.consent = consent;
    }

    const stored = await persistDownloadLead({ email, name, source, tags, metadata });

    // Integración opcional a Zoho CRM: crear Lead en paralelo (best-effort)
    if (ZOHO_CLIENT_ID && ZOHO_CLIENT_SECRET && ZOHO_REFRESH_TOKEN) {
      try {
        const { accessToken, apiDomain } = await getZohoAccessToken();
        const apiBase = apiDomain || zohoApiDomainFromDC();
        const lead = {
          Email: email,
          First_Name: name ? String(name).split(' ')[0] : undefined,
          Last_Name: name ? String(name).split(' ').slice(1).join(' ') || undefined : undefined,
          Company: (metadata && metadata.company) || undefined,
          Lead_Source: source || 'descargas-gratuitas',
          Description: JSON.stringify(metadata || {})
        };
        const zr = await fetch(`${apiBase}/crm/v8/Leads`, {
          method: 'POST',
          headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: [lead] })
        });
        // No interrumpir respuesta al cliente si Zoho falla
        if (!zr.ok) {
          try { const zbody = await zr.text(); console.warn('[api] zoho lead (downloads) non-200:', zr.status, zbody); } catch{}
        }
      } catch (zerr) {
        console.warn('[api] zoho lead (downloads) error:', zerr?.message || zerr);
      }
    }

    let notified = false;
    if (LEADS_NOTIFY_EMAIL) {
      const createdAt = new Date().toISOString();
      const html = `
        <h2>Nuevo lead de descargas</h2>
        <ul>
          <li><strong>Email:</strong> ${escapeHtml(email)}</li>
          <li><strong>Nombre:</strong> ${escapeHtml(name || '—')}</li>
          <li><strong>Origen:</strong> ${escapeHtml(source)}</li>
          <li><strong>Tags:</strong> ${escapeHtml(tags.join(', ') || '—')}</li>
          <li><strong>Registrado:</strong> ${escapeHtml(createdAt)}</li>
        </ul>
        <pre style="background:#f5f5f5;padding:12px;border-radius:8px;white-space:pre-wrap;word-break:break-word;">
${escapeHtml(JSON.stringify(metadata, null, 2))}
        </pre>
      `;
      notified = await sendEmail({ to: LEADS_NOTIFY_EMAIL, subject: `[Leads] Descarga gratuita (${source})`, html });
    }

    return res.json({ ok: true, stored: stored.stored || false, fallback: stored.fallback || null, id: stored.id || null, notified });
  } catch (e) {
    console.error('[api] /leads/downloads error:', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ==============================
// Integración Zoho CRM — Crear Lead
// ==============================
function zohoApiDomainFromDC() {
  const dc = ZOHO_DC;
  if (dc === 'com') return 'https://www.zohoapis.com';
  if (dc === 'eu') return 'https://www.zohoapis.eu';
  if (dc === 'in') return 'https://www.zohoapis.in';
  if (dc === 'com.au') return 'https://www.zohoapis.com.au';
  if (dc === 'jp') return 'https://www.zohoapis.jp';
  return 'https://www.zohoapis.com';
}

async function getZohoAccessToken() {
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) return null;
  const accountsBase = `https://accounts.zoho.${ZOHO_DC}`;
  const params = new URLSearchParams();
  params.set('grant_type', 'refresh_token');
  params.set('client_id', ZOHO_CLIENT_ID);
  params.set('client_secret', ZOHO_CLIENT_SECRET);
  params.set('refresh_token', ZOHO_REFRESH_TOKEN);
  const r = await fetch(`${accountsBase}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.access_token) {
    throw new Error(`zoho_refresh_failed: ${r.status} ${(body && (body.error || body.message)) || ''}`);
  }
  return { accessToken: body.access_token, apiDomain: body.api_domain || zohoApiDomainFromDC() };
}

router.post('/integrations/zoho/leads', async (req, res) => {
  try {
    // Honeypot
    if (req.body && typeof req.body.hp === 'string' && req.body.hp.trim()) {
      return res.status(200).json({ ok: true, honeypot: true });
    }

    // Cooldown leve por IP (15s)
    const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || req.socket?.remoteAddress || 'unknown';
    global.__dc100_rate__ = global.__dc100_rate__ || new Map();
    const key = `zoho:${ip}`;
    const now = Date.now();
    const last = global.__dc100_rate__.get(key) || 0;
    if (now - last < 15000) {
      res.setHeader('X-Rate-Limited', '1');
      return res.status(200).json({ ok: true, rate_limited: true });
    }
    global.__dc100_rate__.set(key, now);

    if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
      return res.status(503).json({ error: 'zoho_not_configured' });
    }
    const b = req.body || {};
    const email = (b.email || b.Email || '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) return res.status(400).json({ error: 'invalid_email' });
    const lead = {};
    lead.Email = email;
    if (b.firstname || b.first_name || b.First_Name) lead.First_Name = String(b.firstname || b.first_name || b.First_Name).trim();
    if (b.lastname || b.last_name || b.Last_Name) lead.Last_Name = String(b.lastname || b.last_name || b.Last_Name).trim();
    if (b.company || b.Company) lead.Company = String(b.company || b.Company).trim();
    if (b.phone || b.Phone) lead.Phone = String(b.phone || b.Phone).trim();
    if (b.lead_source || b.Lead_Source || b.source) lead.Lead_Source = String(b.lead_source || b.Lead_Source || b.source).trim();
    if (b.description || b.Description || b.notes) lead.Description = String(b.description || b.Description || b.notes).trim();
    if (Array.isArray(b.tags) && b.tags.length) {
      // Zoho suele aceptar Tag como array de objetos { name }
      lead.Tag = b.tags.map(t => ({ name: String(t).trim() })).filter(x => x.name);
    }
    // Metadata útil
    lead.Description = [lead.Description || '', `Referrer: ${req.headers['referer'] || ''}`, `UserAgent: ${req.headers['user-agent'] || ''}`]
      .filter(Boolean).join('\n');

    const { accessToken, apiDomain } = await getZohoAccessToken();
    const apiBase = apiDomain || zohoApiDomainFromDC();
    const payload = { data: [lead] };
    const zr = await fetch(`${apiBase}/crm/v8/Leads`, {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const zbody = await zr.json().catch(() => ({}));
    if (!zr.ok) {
      return res.status(502).json({ error: 'zoho_api_error', status: zr.status, details: zbody });
    }
    return res.json({ ok: true, zoho: zbody });
  } catch (e) {
    console.error('[api] zoho/leads error:', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// POST /mp/create-preference
router.post('/mp/create-preference', async (req, res) => {
  try {
    if (!mpPreference) return res.status(503).json({ error: 'mp_unavailable' });
  const { items = [], user = {}, metadata = {} } = req.body || {};
    const referer = req.headers['referer'] || '';
    const siteBase = inferSiteBase(req, referer);
    const notificationUrl = buildNotificationUrl(req);
    // Preparar metadata consolidada
    const md = {
      user_id: user.id || null,
      email: user.email || null,
      entitlements: (items || []).map(it => mapItemToEntitlement(it)).filter(Boolean),
      ...metadata
    };
    // Cargar pricing.json para aceptar SKUs como strings
    let pricing = null;
    try {
      const pricingPath = path.join(process.cwd(), 'assets', 'config', 'pricing.json');
      const raw = fs.readFileSync(pricingPath, 'utf-8');
      pricing = JSON.parse(raw);
    } catch (e) {
      console.warn('[api] No se pudo leer assets/config/pricing.json:', e?.message || e);
    }

    const DEFAULT_DESC = 'Dispositivo de tienda móvil de comercio electrónico';
    const DEFAULT_IMG = `${PUBLIC_SITE_BASE}/assets/logo_de_cero_a_cien.png`;
    const itemsForPref = (items || []).map(it => {
      const isSku = typeof it === 'string';
      let sku = isSku ? it : (it.id || it.sku || null);
      let def = null;
      if (pricing && sku && pricing.products && pricing.products[sku]) {
        def = pricing.products[sku];
      }
      const title = (isSku && def?.title) || it.title || it.name || 'Producto';
      const unit_price = Number((isSku && def?.unit_price) || it.unit_price || it.price || 0);
      const currency_id = (pricing?.currency) || it.currency_id || 'CLP';
      return {
        title,
        description: it.description || DEFAULT_DESC,
        picture_url: it.picture_url || it.image || it.image_url || DEFAULT_IMG,
        quantity: Number(it.quantity || 1),
        currency_id,
        unit_price,
        id: (it.id && String(it.id)) || (it.sku && String(it.sku)) || '1234',
        category_id: it.category_id || undefined
      };
    });
    const orderTotal = itemsForPref.reduce((s, it) => s + Number(it.unit_price) * Number(it.quantity), 0);
    // Validación de productos: si vienen SKUs y no tenemos pricing, lo rechazamos; si vienen objetos completos, permitimos pasar
    if ((items || []).some(s => typeof s === 'string')) {
      if (!pricing || !pricing.products) {
        return res.status(400).json({ error: 'invalid_items', message: 'Se enviaron SKUs pero el servidor no tiene pricing.json; enviar ítems completos desde el frontend o incluir pricing.json' });
      }
      const invalid = (items || []).filter(s => typeof s === 'string' && !pricing.products[s]);
      if (invalid.length) {
        return res.status(400).json({ error: 'invalid_items', items: invalid });
      }
    }

    // Crear orden preliminar (idempotencia a nivel de negocio)
    let orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    if (pool) {
      try {
        await ensureSchema();
        await pool.query(
          'INSERT INTO orders (id, user_id, email, items, total, currency, status, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [orderId, user?.id || null, user?.email || null, JSON.stringify(itemsForPref), orderTotal, (itemsForPref[0]?.currency_id)||'CLP', 'created', JSON.stringify(md)]
        );
      } catch (e) { console.warn('[api] crear orden falló:', e?.message || e); }
    }

    const prefBody = {
      items: itemsForPref,
      payer: user && user.email ? { email: user.email } : undefined,
      back_urls: {
        success: `${siteBase}/pago-id.html`,
        pending: `${siteBase}/pago-pendiente.html`,
        failure: `${siteBase}/pago-error.html`
      },
      auto_return: 'approved',
      notification_url: notificationUrl,
      payment_methods: {
        installments: MP_INSTALLMENTS,
        ...(MP_EXCLUDED_PAYMENT_METHODS.length ? { excluded_payment_methods: MP_EXCLUDED_PAYMENT_METHODS } : {})
      },
      external_reference: process.env.MP_CERT_EMAIL || (user && user.email) || undefined,
      metadata: { ...md, order_id: orderId }
    };
    let resp;
    let body;
    
    // 1) SDK con integrator (si está configurado)
    try {
      resp = await mpPreference.create({ body: prefBody, requestOptions: MP_INTEGRATOR_ID ? { headers: { 'x-integrator-id': MP_INTEGRATOR_ID } } : undefined });
      body = resp && resp.init_point ? resp : (resp?.body || resp);
  } catch {
      // 2) SDK sin integrator header
      try {
        const r2 = await mpPreference.create({ body: prefBody });
        body = r2 && r2.init_point ? r2 : (r2?.body || r2);
  } catch {
        // 3) REST con integrator header
        try {
          const r3 = await fetch('https://api.mercadopago.com/checkout/preferences', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
              ...(MP_INTEGRATOR_ID ? { 'x-integrator-id': MP_INTEGRATOR_ID } : {})
            },
            body: JSON.stringify(prefBody)
          });
          const b3 = await r3.json();
          if (!r3.ok) throw new Error(`REST create failed: ${r3.status} ${b3?.error || b3?.message || ''}`);
          body = b3;
  } catch {
          // 4) REST sin integrator header
          const r4 = await fetch('https://api.mercadopago.com/checkout/preferences', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${MP_ACCESS_TOKEN}`
            },
            body: JSON.stringify(prefBody)
          });
          const b4 = await r4.json();
          if (!r4.ok) throw new Error(`REST create (no integrator) failed: ${r4.status} ${b4?.error || b4?.message || ''}`);
          body = b4;
        }
      }
    }
    // Actualizar orden con preference y estado pendiente
    if (pool) {
      try {
        await pool.query('UPDATE orders SET preference_id=$1, status=$2, updated_at=now() WHERE id=$3', [body.id || body.preference_id || null, 'pending', orderId]);
      } catch (e) { console.warn('[api] actualizar orden falló:', e?.message || e); }
    }

    return res.json({
      id: body.id,
      init_point: body.init_point,
      sandbox_init_point: body.sandbox_init_point
    });
  } catch (e) {
    console.error('[api] mp/create-preference error:', e?.message || e);
    // Fallback REST para obtener más detalle del error
    try {
      const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          ...(MP_INTEGRATOR_ID ? { 'x-integrator-id': MP_INTEGRATOR_ID } : {})
        },
        body: JSON.stringify({
          items: [{ title: 'Diagnóstico', quantity: 1, unit_price: 1000, currency_id: 'CLP', id: '1234' }],
          back_urls: { success: 'https://example.com', pending: 'https://example.com', failure: 'https://example.com' }
        })
      });
      const body = await r.json();
      const status = r.status;
      // Devolver detalles para diagnóstico del integrador
      return res.status(500).json({
        error: 'mp_error',
        message: e?.message || String(e),
        mp_status: status,
        mp_error: body?.error || body?.message || null,
        mp_cause: body?.cause || body?.causes || null
      });
    } catch (e2) {
      return res.status(500).json({ error: 'mp_error', message: e2?.message || String(e2) });
    }
  }
});

// POST /mp/webhook
router.get('/mp/webhook', async (req, res) => {
  // Endpoint simple para verificación/challenge y debugging rápido
  res.status(200).json({ ok: true, method: 'GET', query: req.query || {} });
});
router.post('/mp/webhook', async (req, res) => {
  try {
    const topic = (req.query.topic || req.query.type || req.body.type || '').toString();
    const id = (req.query['data.id'] || req.body?.data?.id || req.query.id || req.body.id || '').toString();
    if (!id) { res.status(200).json({ ok: true }); return; }

    // Manejo especial de merchant_order: no necesitamos otorgar aquí, pero no debemos fallar
    if (topic === 'merchant_order') {
      // Opcional: podríamos inspeccionar la orden
      try {
        if (MP_ACCESS_TOKEN) {
          const r = await fetch(`https://api.mercadopago.com/merchant_orders/${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
          });
          await r.json().catch(()=>null);
        }
  } catch {}
      res.status(200).json({ ok: true, topic });
      return;
    }

    // Log webhook event
    if (pool) {
      try {
        await ensureSchema();
        const evId = `wh_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        await pool.query('INSERT INTO webhook_events (id, topic, resource_id, payload) VALUES ($1,$2,$3,$4)', [evId, topic || 'payment', id, JSON.stringify(req.body || {})]);
      } catch (e) { console.warn('[api] guardar webhook_events falló:', e?.message || e); }
    }

    // Para pagos: intentar SDK y luego REST como respaldo
    let payment = null;
    if (mpPayment) {
      try {
        const p = await mpPayment.get({ id, requestOptions: MP_INTEGRATOR_ID ? { headers: { 'x-integrator-id': MP_INTEGRATOR_ID } } : undefined });
        payment = p?.body || p;
      } catch (e) {
        console.warn('[api] mp webhook get payment (SDK) falló:', e?.message || e);
      }
    }
    if (!payment && MP_ACCESS_TOKEN) {
      try {
        const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, {
          headers: {
            Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
            ...(MP_INTEGRATOR_ID ? { 'x-integrator-id': MP_INTEGRATOR_ID } : {})
          }
        });
        const body = await r.json();
        if (r.ok) payment = body; else console.warn('[api] mp webhook get payment (REST) no ok:', body);
      } catch (e) {
        console.warn('[api] mp webhook get payment (REST) falló:', e?.message || e);
      }
    }

    if (payment && payment.status === 'approved') {
      const md = payment.metadata || {};
      const userId = md.user_id || null;
      const email = md.email || (payment.payer && payment.payer.email) || null;
      const ents = md.entitlements || [];
      // Idempotencia: registrar payment procesado
      let isNew = true;
      if (pool) {
        try {
          await ensureSchema();
          await pool.query('INSERT INTO processed_payments (payment_id) VALUES ($1) ON CONFLICT (payment_id) DO NOTHING', [String(payment.id)]);
          const chk = await pool.query('SELECT payment_id FROM processed_payments WHERE payment_id=$1', [String(payment.id)]);
          isNew = !!chk.rowCount;
        } catch (e) { console.warn('[api] processed_payments fallo:', e?.message || e); }
      }

      if (isNew) {
        // Registrar pago y actualizar orden si existe metadata.order_id
        if (pool) {
          try {
            const amount = payment.transaction_amount || payment.total_paid_amount || null;
            const currency = payment.currency_id || 'CLP';
            const method = payment.payment_method_id || payment.payment_type_id || null;
            const orderId = md.order_id || null;
            if (orderId) {
              await pool.query('UPDATE orders SET status=$1, updated_at=now() WHERE id=$2', ['paid', orderId]);
            }
            await pool.query('INSERT INTO payments (id, order_id, status, amount, currency, method, raw) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING', [String(payment.id), orderId, payment.status, amount, currency, method, JSON.stringify(payment)]);
          } catch (e) { console.warn('[api] registrar pago fallo:', e?.message || e); }
        }

        // Otorgar accesos
        await grantEntitlements({ userId, email, entitlements: ents });

        // Email transaccional (opcional)
        if (email) {
          const ok = await sendEmail({
            to: email,
            subject: 'Tu pago fue aprobado – Acceso habilitado',
            html: `<p>¡Gracias por tu compra!</p><p>Tu pago (${payment.id}) fue aprobado. Ya puedes acceder al Portal del Alumno:</p><p><a href="${PUBLIC_SITE_BASE}/portal-alumno.html">Ir al Portal</a></p>`
          });
          if (!ok) console.log('[api] email no enviado (config no presente)');
        }
      }
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[api] mp/webhook error:', e?.message || e);
    res.status(200).json({ ok: true }); // evitar reintentos agresivos
  }
});

// DEBUG/QA — Webhook de prueba (no toca Mercado Pago). Requiere X-API-KEY (REPORTS_API_KEY).
// POST /mp/webhook-test
// Body esperado: { payment: { id, status:'approved', transaction_amount, currency_id, payment_method_id?, metadata:{ user_id?, email?, entitlements:[], order_id? } } }
router.post('/mp/webhook-test', async (req, res) => {
  try {
    if (!requireApiKey(req, res)) return;
    const payment = (req.body && req.body.payment) || null;
    if (!payment || payment.status !== 'approved') {
      return res.status(400).json({ ok: false, error: 'invalid_payment' });
    }

    const md = payment.metadata || {};
    const userId = md.user_id || null;
    const email = md.email || null;
    const ents = md.entitlements || [];

    // Idempotencia simple
    if (pool) {
      try {
        await ensureSchema();
        await pool.query('INSERT INTO processed_payments (payment_id) VALUES ($1) ON CONFLICT (payment_id) DO NOTHING', [String(payment.id)]);
      } catch (e) { console.warn('[api] webhook-test processed_payments fallo:', e?.message || e); }
    }

    // Registrar pago/orden si corresponde
    if (pool) {
      try {
        const amount = payment.transaction_amount || payment.total_paid_amount || null;
        const currency = payment.currency_id || 'CLP';
        const method = payment.payment_method_id || payment.payment_type_id || null;
        const orderId = md.order_id || null;
        if (orderId) {
          await pool.query('UPDATE orders SET status=$1, updated_at=now() WHERE id=$2', ['paid', orderId]);
        }
        await pool.query('INSERT INTO payments (id, order_id, status, amount, currency, method, raw) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING', [String(payment.id), md.order_id || null, payment.status, amount, currency, method, JSON.stringify(payment)]);
      } catch (e) { console.warn('[api] webhook-test registrar pago fallo:', e?.message || e); }
    }

    // Otorgar accesos
    await grantEntitlements({ userId, email, entitlements: ents });

    // Email opcional
    if (email) {
      try {
        await sendEmail({
          to: email,
          subject: 'Acceso habilitado (prueba) — De Cero a Cien',
          html: `<p>Este es un webhook de prueba. Se otorgaron: <code>${(ents||[]).join(', ')}</code></p>`
        });
  } catch { }
    }

    res.json({ ok: true, test: true });
  } catch (e) {
    console.error('[api] mp/webhook-test error:', e?.message || e);
    res.status(500).json({ ok: false });
  }
});

// GET /mp/verify-grant?grant=...&t=...&ref=...&sig=...
import crypto from 'crypto';
router.get('/mp/verify-grant', async (req, res) => {
  try {
    const { grant, t, ref, sig } = req.query || {};
    if (!GRANT_SECRET) return res.json({ ok: false });
    if (!grant || !t || !sig) return res.json({ ok: false });
    // tolerancia 30 minutos
    const now = Date.now();
    const ts = Number(t);
    if (isNaN(ts) || Math.abs(now - ts) > 30 * 60 * 1000) return res.json({ ok: false });
    const toSign = `${grant}|${t}|${ref || ''}`;
    const h = crypto.createHmac('sha256', GRANT_SECRET).update(toSign).digest('hex');
    if (h !== sig) return res.json({ ok: false });
    return res.json({ ok: true });
  } catch {
    return res.json({ ok: false });
  }
});

app.use(BASE_PATH, router);

// ==============================
// Debug seguro de token (solo con GRANT_SECRET)
// GET /api/auth/debug-token
// Header: Authorization: Bearer <token>
// Header o query: x-debug-secret / ?secret=
router.get('/auth/debug-token', async (req, res) => {
  try {
    const secret = req.headers['x-debug-secret'] || req.query.secret;
    if (!GRANT_SECRET || !secret || secret !== GRANT_SECRET) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    // Intentar verificación normal
    let decoded = await verifyBearer(req);
    let provider = decoded ? (decoded._supabase ? 'supabase' : 'firebase') : 'unknown';

    // Extra: detectar algoritmo del header para diagnosticar
    let alg = null;
    try {
      const h = req.headers['authorization'] || '';
      const m = /^Bearer\s+(.+)$/i.exec(h);
      if (m) {
        const parts = m[1].split('.');
        const header = JSON.parse(Buffer.from(parts[0] || '', 'base64').toString('utf8'));
        alg = header && header.alg ? String(header.alg) : null;
      }
  } catch {}

    // Si no se pudo verificar, intentar decodificar sin verificar (solo para diagnóstico)
    let unsigned = null;
    if (!decoded) {
      const h = req.headers['authorization'] || '';
      const m = /^Bearer\s+(.+)$/i.exec(h);
      if (m) {
        try {
          const parts = m[1].split('.');
          const payload = JSON.parse(Buffer.from(parts[1] || '', 'base64').toString('utf8'));
          unsigned = payload || null;
  } catch {}
      }
    }

    const out = { ok: !!decoded, provider, alg };
    if (decoded) {
      out.sub = decoded.uid || decoded.user_id || decoded.sub || null;
      out.email = decoded.email || null;
      out.name = decoded.name || null;
      if (decoded._supabase) {
        out.iss = decoded._supabase.iss || null;
        out.aud = decoded._supabase.aud || null;
        out.exp = decoded._supabase.exp || null;
      }
    } else {
      out.error = 'invalid_token';
      if (unsigned) {
        out.unsigned = {
          iss: unsigned.iss || null,
          aud: unsigned.aud || null,
          sub: unsigned.sub || null,
          email: unsigned.email || null
        };
        if (alg === 'HS256' && !process.env.SUPABASE_JWT_SECRET) {
          out.hint = 'Token HS256 de Supabase: configure SUPABASE_JWT_SECRET en Cloud Run (Auth settings > JWT secret)';
        }
      }
    }

    return res.json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Endpoint de diagnóstico (opcional): inspeccionar preferencia por ID
router.get('/mp/debug-preference', async (req, res) => {
  try {
    if (!mpPreference) return res.status(503).json({ ok: false, error: 'mp_unavailable' });
    const prefId = req.query.pref_id || req.query.id;
    if (!prefId) return res.status(400).json({ ok: false, error: 'missing_pref_id' });
    try {
      const resp = await mpPreference.get({ preferenceId: String(prefId), requestOptions: MP_INTEGRATOR_ID ? { headers: { 'x-integrator-id': MP_INTEGRATOR_ID } } : undefined });
      const body = resp?.body || resp;
      return res.json({ ok: true, source: 'sdk', preference: body });
  } catch {
      // Fallback REST para ver el error exacto
      try {
        const r = await fetch(`https://api.mercadopago.com/checkout/preferences/${encodeURIComponent(String(prefId))}`, {
          headers: {
            Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
            ...(MP_INTEGRATOR_ID ? { 'x-integrator-id': MP_INTEGRATOR_ID } : {})
          }
        });
        const body = await r.json();
        return res.status(r.ok ? 200 : 200).json({ ok: r.ok, source: 'rest', status: r.status, response: body });
      } catch (restErr) {
        return res.status(500).json({ ok: false, error: restErr?.message || String(restErr) });
      }
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Diagnóstico: ¿quién es el vendedor según el MP_ACCESS_TOKEN?
router.get('/mp/debug-whoami', async (req, res) => {
  try {
    if (!MP_ACCESS_TOKEN) return res.status(200).json({ ok: false, error: 'no_token_configured' });
    const r = await fetch('https://api.mercadopago.com/users/me', {
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        ...(MP_INTEGRATOR_ID ? { 'x-integrator-id': MP_INTEGRATOR_ID } : {})
      }
    });
    const body = await r.json();
    res.status(r.ok ? 200 : 200).json({ ok: r.ok, status: r.status, user: body });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// ==============================
// Admin: Leads recientes (x-api-key)
// ==============================
router.get('/admin/leads', async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ ok: false, error: 'no_database' });
    const apiKey = req.headers['x-api-key'] || req.query.k;
    if (!process.env.REPORTS_API_KEY || !apiKey || apiKey !== process.env.REPORTS_API_KEY) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    await ensureSchema();
    const limit = Math.min( Number(req.query.limit || 100), 500 );
    const r = await pool.query(
      'SELECT id, email, name, source, tags, metadata, created_at, updated_at FROM download_leads ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST LIMIT $1',
      [limit]
    );
    return res.json({ ok: true, items: r.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// ==============================
// Health check y verificación de routing
// ==============================
router.get('/health', async (req, res) => {
  try {
    const info = {
      ok: true,
      service: 'deceroacien-api',
      basePath: BASE_PATH,
      env: process.env.NODE_ENV || 'production',
      time: new Date().toISOString(),
      host: req.headers['host'] || null,
      zohoConfigured: !!(ZOHO_CLIENT_ID && ZOHO_CLIENT_SECRET && ZOHO_REFRESH_TOKEN),
      resendConfigured: !!RESEND_API_KEY
    };
    // Permite ?format=txt para pruebas manuales
    if ((req.query.format || '').toString() === 'txt') {
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send('OK');
    }
    return res.json(info);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT} basePath=${BASE_PATH}`);
  console.log(`[api] allowed origins:`, ALLOWED_ORIGINS);
});
