import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  type AuthedRequest,
  extractActorMiddleware,
  requireFinalApproverMiddleware,
  requireOfficerMiddleware,
  resolveAuthoritativeOfficer,
  signActorToken,
  toUserSession,
} from './auth.ts';
import {
  approveAndIssueCertificate,
  reissueCertificate,
  revokeCertificate,
  sanitizeCertificateForResponse,
  ServiceError,
  verifyCertificateByToken,
} from './certificateService.ts';
import {
  getAttachmentStorageRoot,
  getDb,
  hashPassword,
  hashVerificationToken,
  verifyPassword,
} from './db.ts';
import {
  type ActorRbacContext,
  adminResetUserPasswordTransactional,
  appendPermissionAuditLog,
  assignUserRoleAndScopeTransactional,
  authorizeContextPermission,
  canUserAccessApplicationRecord,
  createCustomRoleTransactional,
  createUserAccountTransactional,
  createUserPermissionOverrideTransactional,
  filterApplicationsForContext,
  getRolePermissionsV2,
  grantApprovalAuthorityTransactional,
  insertMonitoringObservation,
  listAllPermissions,
  listAllRoles,
  listApprovalAuthorities,
  listMonitoringObservations,
  listPermissionAuditLogs,
  listRefundRequests,
  listUsersWithAssignments,
  mapServiceDepartment,
  normalizeMobile,
  RbacError,
  revokeApprovalAuthorityTransactional,
  revokeUserOverrideTransactional,
  revokeUserRoleTransactional,
  setRoleActiveStatusTransactional,
  setUserActiveStatusTransactional,
  updateRolePermissionsTransactional,
  upsertRefundRequest,
  validateStrongPassword,
} from './rbacService.ts';
import type {
  Application,
  ApplicationAttachment,
  ApplicationStatus,
  Certificate,
  DashboardStatsResponse,
  HoldingTaxRecord,
  MonitoringObservation,
  Notice,
  PermissionKey,
  PermissionScope,
  RefundRequest,
  RoleCategory,
  RolePermissionEntry,
  StaffMember,
  TradeLicenseRecord,
  UserRole,
  WardOrDepartment,
} from '../src/types/index.ts';

// In-memory sliding window rate limiter for public verification endpoint
const verifyRateBuckets = new Map<string, number[]>();

export function resetVerifyRateLimiter(): void {
  verifyRateBuckets.clear();
}

function getVerifyRateLimitMax(): number {
  const raw = process.env.POTTOYON_VERIFY_RATE_LIMIT;
  const parsed = raw ? parseInt(raw, 10) : 30;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

function checkVerifyRateLimit(ip: string): { allowed: boolean; retryAfterSec: number; remaining: number } {
  const maxRequests = getVerifyRateLimitMax();
  const windowMs = 60_000;
  const now = Date.now();
  const existing = (verifyRateBuckets.get(ip) || []).filter((ts) => now - ts < windowMs);

  if (existing.length >= maxRequests) {
    const oldest = existing[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    verifyRateBuckets.set(ip, existing);
    return { allowed: false, retryAfterSec, remaining: 0 };
  }

  existing.push(now);
  verifyRateBuckets.set(ip, existing);
  return { allowed: true, retryAfterSec: 0, remaining: maxRequests - existing.length };
}

function extractClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

function sanitizeText(val: unknown, maxLen = 500): string {
  return String(val ?? '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLen);
}

function escapeCsvCell(value: unknown): string {
  let str = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildMeaningfulPdfFilename(cert: Certificate, serviceEn?: string, trackingNo?: string): string {
  const slugBase = (serviceEn || cert.service_id || 'Certificate')
    .replace(/^srv_/, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  const trackPart = (trackingNo || cert.application_tracking_no || '')
    .replace(/[^A-Za-z0-9-]+/g, '')
    .slice(0, 24);
  const certNoPart = (cert.certificate_number || cert.certificate_no || 'cert')
    .replace(/[^A-Za-z0-9-]+/g, '')
    .slice(0, 24);
  return ['PottoyonBD', slugBase || 'Certificate', trackPart, certNoPart]
    .filter(Boolean)
    .join('_') + '.pdf';
}

function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}

function sameOriginProtectionMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        res.status(403).json({
          error: 'Forbidden: Cross-site request blocked',
          message_bn: 'নিরাপত্তার কারণে বাহ্যিক উৎস থেকে পরিবর্তন অনুরোধ প্রত্যাখ্যাত হয়েছে।',
        });
        return;
      }
    } catch {
      res.status(403).json({ error: 'Invalid Origin header' });
      return;
    }
  }
  next();
}

function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    'Set-Cookie',
    `pottoyon_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 3600}`
  );
}

function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    'pottoyon_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
  );
}

function hasBroadUnitScope(ctx: ActorRbacContext, key: PermissionKey): boolean {
  const sc = ctx.effectivePermissions.get(key);
  return sc === 'global' || sc === 'upazila';
}

function redactCitizenApplication(app: Application): Application {
  return {
    ...app,
    review_notes: ['আবেদনটি সিস্টেমে সংরক্ষিত রয়েছে এবং যাচাই প্রক্রিয়াধীন।'],
  };
}

function handleRbacError(res: Response, err: unknown, fallbackMsg: string): void {
  if (err instanceof RbacError) {
    res.status(err.statusCode).json({
      error: err.message,
      message_bn: err.messageBn,
    });
    return;
  }
  console.error(fallbackMsg, err);
  res.status(500).json({ error: fallbackMsg });
}

const ALLOWED_ATTACHMENT_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024; // 2 MB

export async function createApp(): Promise<express.Express> {
  const store = getDb();
  await store.ensureSeedCertificateAsset();

  const app = express();
  app.use(securityHeadersMiddleware);
  app.use(sameOriginProtectionMiddleware);
  app.use(express.json({ limit: '5mb' }));
  app.use(extractActorMiddleware);

  // --- Health & CSRF ---
  app.get('/api/health', (_req: Request, res: Response) => {
    const institutions = store.getInstitutions();
    res.json({
      status: 'ok',
      platform: 'PottoyonBD',
      region: 'Pabna Sadar Upazila, Pabna, Bangladesh',
      institutions_count: institutions.length,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/auth/csrf', (_req: Request, res: Response) => {
    const token = crypto.randomBytes(24).toString('base64url');
    res.json({ csrf_token: token });
  });

  // --- Auth, Lockout, MFA, Password Reset & Session ---
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { role, administrative_unit_id, username, password, otp } = req.body || {};
    if (!username || !password) {
      res.status(400).json({
        error: 'Username and password required',
        message_bn: 'ইউজারনেম ও পাসওয়ার্ড প্রদান করুন।',
      });
      return;
    }

    const cleanUsername = String(username).trim().toLowerCase();
    const userRow = store.db
      .prepare('SELECT * FROM users WHERE LOWER(username) = ? LIMIT 1')
      .get(cleanUsername) as Record<string, unknown> | undefined;

    if (!userRow) {
      res.status(401).json({
        error: 'Invalid username or password',
        message_bn: 'ইউজারনেম বা পাসওয়ার্ড সঠিক নয়।',
      });
      return;
    }

    if (Number(userRow.is_active) !== 1) {
      res.status(403).json({
        error: 'Account deactivated',
        message_bn: 'এই ব্যবহারকারী একাউন্টটি প্রশাসনিকভাবে নিষ্ক্রিয় করা হয়েছে।',
      });
      return;
    }

    if (userRow.locked_until && new Date(String(userRow.locked_until)).getTime() > Date.now()) {
      res.status(423).json({
        error: 'Account temporarily locked due to repeated failed login attempts',
        message_bn: 'একাধিক ভুল পাসওয়ার্ড প্রচেষ্টার কারণে একাউন্টটি সাময়িকভাবে লক করা হয়েছে।',
      });
      return;
    }

    const passwordValid = verifyPassword(String(password), String(userRow.password_hash));
    if (!passwordValid) {
      const nextFails = (Number(userRow.failed_login_attempts) || 0) + 1;
      const lockedUntil =
        nextFails >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
      store.db
        .prepare('UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?')
        .run(nextFails, lockedUntil, String(userRow.id));

      if (lockedUntil) {
        res.status(423).json({
          error: 'Account temporarily locked after 5 failed attempts',
          message_bn: '৫ বার ভুল পাসওয়ার্ড দেওয়ার কারণে একাউন্টটি ১৫ মিনিটের জন্য লক হয়েছে।',
        });
        return;
      }

      res.status(401).json({
        error: 'Invalid username or password',
        message_bn: `পাসওয়ার্ড সঠিক নয় (অবশিষ্ট চেষ্টা: ${Math.max(0, 5 - nextFails)} বার)।`,
      });
      return;
    }

    // Validate institution boundary if role & administrative_unit_id explicitly supplied
    const resolvedRole = String(userRow.primary_role) as UserRole;
    if (role && role !== resolvedRole) {
      // Allow only if the user also holds that active role assignment
      const hasAssignedRole = store.db
        .prepare('SELECT id FROM user_roles WHERE user_id = ? AND role_slug = ? AND is_active = 1')
        .get(String(userRow.id), String(role));
      if (!hasAssignedRole) {
        res.status(403).json({
          error: 'User does not hold the requested role',
          message_bn: 'এই একাউন্টে নির্বাচিত পদবি বরাদ্দ নেই।',
        });
        return;
      }
    }

    if (
      administrative_unit_id &&
      userRow.administrative_unit_id &&
      String(userRow.administrative_unit_id) !== String(administrative_unit_id)
    ) {
      res.status(403).json({
        error: 'Institution mismatch for user account',
        message_bn: 'এই কর্মকর্তা নির্বাচিত প্রতিষ্ঠানের অন্তর্ভুক্ত নন।',
      });
      return;
    }

    const settings = store.getSystemSettings();
    const mfaRequired =
      Number(userRow.mfa_enabled) === 1 &&
      resolvedRole !== 'citizen' &&
      settings.require_2fa_for_officers;

    if (mfaRequired) {
      if (!otp) {
        res.status(401).json({
          error: '2FA OTP required for officer login',
          mfa_required: true,
          message_bn: 'কর্মকর্তা লগইনের জন্য ৬ ডিজিটের 2FA OTP কোড আবশ্যক।',
        });
        return;
      }
      if (String(otp).trim() !== '123456') {
        res.status(401).json({
          error: 'Invalid 2FA OTP',
          message_bn: 'প্রদত্ত 2FA OTP কোড সঠিক নয় (স্যান্ডবক্স কোড: 123456)।',
        });
        return;
      }
    }

    store.db
      .prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?')
      .run(String(userRow.id));

    const actor = {
      id: String(userRow.id),
      role: (role || resolvedRole) as UserRole,
      name_bn: String(userRow.name_bn),
      title_bn: String(userRow.title_bn),
      administrative_unit_id: userRow.administrative_unit_id
        ? String(userRow.administrative_unit_id)
        : undefined,
      employee_id: String(userRow.username),
    };

    const token = signActorToken(actor);
    setSessionCookie(res, token);
    res.json({
      token,
      session: toUserSession(actor, token),
    });
  });

  app.post('/api/auth/switch-role', (req: Request, res: Response) => {
    const { role, administrative_unit_id, username } = req.body || {};
    const actor = resolveAuthoritativeOfficer(
      (role || 'citizen') as UserRole,
      administrative_unit_id,
      typeof username === 'string' ? username : undefined
    );
    if (!actor) {
      res.status(400).json({
        error: 'Invalid role or institution',
        message_bn: 'রোল বা প্রতিষ্ঠান সঠিক নয়।',
      });
      return;
    }

    const token = signActorToken(actor);
    setSessionCookie(res, token);
    res.json({
      token,
      session: toUserSession(actor, token),
    });
  });

  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.json({ success: true });
  });

  app.post('/api/auth/password-reset/request', (req: Request, res: Response) => {
    const { identifier } = req.body || {};
    const clean = String(identifier || '').trim().toLowerCase();
    if (!clean) {
      res.status(400).json({ error: 'Username, email, or mobile required' });
      return;
    }
    const userRow = store.db
      .prepare(
        `SELECT * FROM users
         WHERE is_active = 1 AND (LOWER(username) = ? OR LOWER(COALESCE(email, '')) = ? OR REPLACE(REPLACE(mobile, '-', ''), ' ', '') = ?)
         LIMIT 1`
      )
      .get(clean, clean, normalizeMobile(clean)) as Record<string, unknown> | undefined;

    if (!userRow) {
      res.json({
        success: true,
        message_bn: 'যদি একাউন্টটি বিদ্যমান থাকে তবে পাসওয়ার্ড রিসেট টোকেন প্রেরণ করা হয়েছে।',
      });
      return;
    }

    const rawToken = crypto.randomBytes(18).toString('base64url');
    const tokenHash = hashVerificationToken(rawToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60_000).toISOString();

    store.db
      .prepare(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`
      )
      .run(`prt_${crypto.randomUUID().slice(0, 8)}`, String(userRow.id), tokenHash, expiresAt, now.toISOString());

    res.json({
      success: true,
      message_bn: 'পাসওয়ার্ড রিসেট টোকেন প্রস্তুত হয়েছে (৩০ মিনিট কার্যকর)।',
      reset_token_preview: rawToken,
      expires_at: expiresAt,
    });
  });

  app.post('/api/auth/password-reset/confirm', (req: Request, res: Response) => {
    const { token, new_password } = req.body || {};
    if (!token || !new_password) {
      res.status(400).json({ error: 'Reset token and new_password required' });
      return;
    }
    if (!validateStrongPassword(String(new_password))) {
      res.status(400).json({
        error: 'Password must be at least 8 characters and include both letters and numbers',
        message_bn: 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের এবং অক্ষর ও সংখ্যার সমন্বয়ে হতে হবে।',
      });
      return;
    }

    const tokenHash = hashVerificationToken(String(token));
    const row = store.db
      .prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL LIMIT 1')
      .get(tokenHash) as Record<string, unknown> | undefined;

    if (!row || new Date(String(row.expires_at)).getTime() <= Date.now()) {
      res.status(400).json({
        error: 'Invalid or expired reset token',
        message_bn: 'পাসওয়ার্ড রিসেট টোকেনটি সঠিক নয় অথবা মেয়াদ উত্তীর্ণ হয়েছে।',
      });
      return;
    }

    const newHash = hashPassword(String(new_password));
    const nowIso = new Date().toISOString();
    store.db.exec('BEGIN IMMEDIATE');
    try {
      store.db
        .prepare('UPDATE users SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?')
        .run(newHash, String(row.user_id));
      store.db
        .prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?')
        .run(nowIso, String(row.id));
      store.db.exec('COMMIT');
    } catch (err) {
      try {
        store.db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }

    res.json({
      success: true,
      message_bn: 'পাসওয়ার্ড সফলভাবে হালনাগাদ ও একাউন্ট আনলক করা হয়েছে।',
    });
  });

  app.get('/api/auth/me', (req: AuthedRequest, res: Response) => {
    if (!req.actor || !req.rbacContext) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    res.json({
      actor: req.actor,
      session: toUserSession(req.actor, ''),
    });
  });

  app.get('/api/rbac/me', (req: AuthedRequest, res: Response) => {
    if (!req.actor || !req.rbacContext) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    res.json({
      session: toUserSession(req.actor, ''),
      assigned_institutions: req.rbacContext.assignedInstitutions,
      assigned_wards: req.rbacContext.assignedWards,
      assigned_departments: req.rbacContext.assignedDepartments,
      approval_authorities: req.rbacContext.approvalAuthorities,
    });
  });

  // --- Institutions & Services ---
  app.get('/api/institutions', (_req: Request, res: Response) => {
    res.json(store.getInstitutions());
  });

  app.get('/api/institutions/:id', (req: Request, res: Response) => {
    const unit = store.getInstitutionById(req.params.id);
    if (!unit) {
      res.status(404).json({ error: 'Institution not found' });
      return;
    }
    res.json(unit);
  });

  app.patch('/api/institutions/:id', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const unit = store.getInstitutionById(req.params.id);
    if (!unit) {
      res.status(404).json({ error: 'Institution not found' });
      return;
    }
    const permCheck = authorizeContextPermission(ctx, 'settings.manage', { unitId: unit.id });
    if (!permCheck.allowed) {
      res.status(403).json({
        error: permCheck.reason || 'Forbidden: cross-institution update denied',
        message_bn: permCheck.reasonBn || 'অন্য প্রতিষ্ঠানের তথ্য পরিবর্তন করার অনুমতি নেই।',
      });
      return;
    }

    const b = req.body || {};
    const updated = {
      ...unit,
      office_address_bn: b.office_address_bn ? sanitizeText(b.office_address_bn, 300) : unit.office_address_bn,
      contact_phone: b.contact_phone ? sanitizeText(b.contact_phone, 50) : unit.contact_phone,
      contact_email: b.contact_email ? sanitizeText(b.contact_email, 120) : unit.contact_email,
      chairman_or_mayor_name_bn: b.chairman_or_mayor_name_bn
        ? sanitizeText(b.chairman_or_mayor_name_bn, 120)
        : unit.chairman_or_mayor_name_bn,
      secretary_or_ceo_name_bn: b.secretary_or_ceo_name_bn
        ? sanitizeText(b.secretary_or_ceo_name_bn, 120)
        : unit.secretary_or_ceo_name_bn,
    };
    store.updateInstitution(updated);
    res.json(updated);
  });

  app.get('/api/services', (_req: Request, res: Response) => {
    res.json(store.getServices());
  });

  app.get('/api/services/:id', (req: Request, res: Response) => {
    const srv = store.getServiceById(req.params.id);
    if (!srv) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    res.json(srv);
  });

  app.patch('/api/services/:id', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const b = req.body || {};
    const unitId = typeof b.unit_id === 'string' ? b.unit_id : undefined;
    const feeCheck = authorizeContextPermission(ctx, 'services.configure_fees', { unitId });
    const manageCheck = authorizeContextPermission(ctx, 'services.manage', { unitId });
    const effective = feeCheck.allowed ? feeCheck : manageCheck;

    if (!effective.allowed || (effective.scope !== 'global' && effective.scope !== 'upazila' && !unitId)) {
      res.status(403).json({
        error: 'Forbidden: insufficient authority to modify global service configuration',
        message_bn: 'কেন্দ্রীয় সেবা ও ফি কনফিগারেশন পরিবর্তনের অনুমতি আপনার নেই।',
      });
      return;
    }

    const srv = store.getServiceById(req.params.id);
    if (!srv) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    const nextFee = typeof b.default_fee === 'number' && b.default_fee >= 0 ? b.default_fee : srv.default_fee;
    const nextDays =
      typeof b.delivery_time_days === 'number' && b.delivery_time_days >= 1
        ? b.delivery_time_days
        : srv.delivery_time_days;
    const updated = {
      ...srv,
      default_fee: nextFee,
      delivery_time_days: nextDays,
      is_active: typeof b.is_active === 'boolean' ? b.is_active : srv.is_active ?? true,
    };
    store.updateService(updated);
    res.json(updated);
  });

  app.get('/api/certificate-templates', (_req: Request, res: Response) => {
    res.json(store.getCertificateTemplates());
  });

  // --- Live Dashboard Aggregated Stats (Permission & Scope Isolated) ---
  app.get('/api/dashboard/stats', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const requestedUnit = typeof req.query.unit_id === 'string' && req.query.unit_id !== 'all'
      ? req.query.unit_id
      : undefined;

    const dashPerm = authorizeContextPermission(ctx, 'dashboard.view', { unitId: requestedUnit });
    if (!dashPerm.allowed) {
      res.status(403).json({
        error: dashPerm.reason || 'Forbidden: cross-institution stats access denied',
        message_bn: dashPerm.reasonBn || 'অন্য প্রতিষ্ঠানের পরিসংখ্যান দেখার অনুমতি নেই।',
      });
      return;
    }

    const isBroad = hasBroadUnitScope(ctx, 'dashboard.view');
    const unitScope = isBroad ? requestedUnit : ctx.assignedInstitutions[0];

    const rawApps = store.getApplications(unitScope);
    const hasAppView = ctx.effectivePermissions.has('applications.view');
    const hasFinanceView =
      ctx.effectivePermissions.has('payments.view') || ctx.effectivePermissions.has('payments.view_reports');

    const apps = hasAppView
      ? filterApplicationsForContext(ctx, rawApps)
      : hasFinanceView
      ? rawApps
      : [];

    const appIds = new Set(apps.map((a) => a.id));
    const rawCerts = store.getCertificates(unitScope);
    const certs = hasAppView
      ? rawCerts.filter((c) => appIds.has(c.application_id))
      : ctx.effectivePermissions.has('certificates.view')
      ? rawCerts
      : [];

    const holdingTaxes = hasFinanceView ? store.getHoldingTaxes(unitScope) : [];
    const tradeLicenses = hasFinanceView || ctx.effectivePermissions.has('services.view')
      ? store.getTradeLicenses(unitScope)
      : [];
    const institutions = store.getInstitutions();

    const pendingStatuses = new Set(['pending_payment', 'paid', 'under_verification', 'correction_required', 'forwarded_for_approval']);
    const monthNamesBn = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'];
    const monthMap = new Map<string, { count: number; revenue: number }>();
    for (const appItem of apps) {
      const d = new Date(appItem.created_at);
      const label = monthNamesBn[d.getUTCMonth()] || 'নভে';
      const prev = monthMap.get(label) || { count: 0, revenue: 0 };
      prev.count += 1;
      if (appItem.payment_status === 'paid') prev.revenue += appItem.fee_amount || 0;
      monthMap.set(label, prev);
    }

    const monthly_stats = Array.from(monthMap.entries()).map(([month, v]) => ({
      month,
      count: v.count,
      revenue: v.revenue,
    }));

    const serviceCounter = new Map<string, { service_id: string; service_name_bn: string; count: number }>();
    for (const appItem of apps) {
      const prev = serviceCounter.get(appItem.service_id) || {
        service_id: appItem.service_id,
        service_name_bn: appItem.service_name_bn,
        count: 0,
      };
      prev.count += 1;
      serviceCounter.set(appItem.service_id, prev);
    }

    const institution_breakdown = institutions
      .filter((inst) => !unitScope || inst.id === unitScope)
      .map((inst) => {
        const instApps = apps.filter((a) => a.administrative_unit_id === inst.id);
        const instCerts = certs.filter((c) => c.administrative_unit_id === inst.id);
        const instRev = instApps
          .filter((a) => a.payment_status === 'paid')
          .reduce((s, a) => s + (a.fee_amount || 0), 0);
        return {
          unit_id: inst.id,
          name_bn: inst.name_bn,
          type: inst.type,
          applications: instApps.length,
          certificates: instCerts.length,
          revenue: instRev,
        };
      });

    const stats: DashboardStatsResponse = {
      total_applications: apps.length,
      pending_applications: apps.filter((a) => pendingStatuses.has(a.status)).length,
      under_verification: apps.filter((a) => a.status === 'under_verification').length,
      correction_required: apps.filter((a) => a.status === 'correction_required').length,
      forwarded_for_approval: apps.filter((a) => a.status === 'forwarded_for_approval').length,
      approved_applications: apps.filter((a) => a.status === 'approved' || a.status === 'certificate_issued').length,
      rejected_applications: apps.filter((a) => a.status === 'rejected').length,
      total_certificates: certs.length,
      valid_certificates: certs.filter((c) => c.status === 'valid').length,
      revoked_certificates: certs.filter((c) => c.status === 'revoked').length,
      expired_certificates: certs.filter((c) => c.status === 'expired').length,
      total_revenue: hasFinanceView || isBroad
        ? apps.filter((a) => a.payment_status === 'paid').reduce((s, a) => s + (a.fee_amount || 0), 0)
        : 0,
      holding_tax_due: holdingTaxes.reduce((s, h) => s + (h.current_due || 0), 0),
      holding_tax_collected: holdingTaxes.filter((h) => h.status === 'paid').reduce((s, h) => s + (h.annual_tax || 0), 0),
      active_trade_licenses: tradeLicenses.filter((t) => t.status === 'active').length,
      monthly_stats,
      service_breakdown: Array.from(serviceCounter.values()).sort((a, b) => b.count - a.count),
      institution_breakdown,
    };

    res.json(stats);
  });

  // --- Citizen Self-Service Portal (IDOR Protected for Authenticated Citizens) ---
  app.get('/api/citizen/portal', (req: AuthedRequest, res: Response) => {
    const mobile = typeof req.query.mobile === 'string' ? req.query.mobile.trim() : '';
    const trackingNo = typeof req.query.tracking_no === 'string' ? req.query.tracking_no.trim().toUpperCase() : '';

    if (req.actor && req.actor.role === 'citizen' && req.rbacContext) {
      const ctx = req.rbacContext;
      const myNormMobile = normalizeMobile(ctx.user.mobile);

      if (mobile && normalizeMobile(mobile) !== myNormMobile) {
        res.status(403).json({
          error: 'Forbidden: cannot access another citizen portal data',
          message_bn: 'অন্য নাগরিকের মোবাইল নম্বর দিয়ে তথ্য দেখার অনুমতি নেই।',
        });
        return;
      }

      const allApps = store.getApplications();
      if (trackingNo) {
        const target = allApps.find((a) => a.tracking_no.toUpperCase() === trackingNo);
        if (target && !canUserAccessApplicationRecord(ctx, target)) {
          res.status(403).json({
            error: 'Forbidden: application belongs to another citizen',
            message_bn: 'অন্য নাগরিকের আবেদনের তথ্য দেখার অনুমতি নেই।',
          });
          return;
        }
      }

      const matchedApps = allApps
        .filter((a) => canUserAccessApplicationRecord(ctx, a))
        .filter((a) => !trackingNo || a.tracking_no.toUpperCase() === trackingNo);

      const appIds = new Set(matchedApps.map((a) => a.id));
      const certs = store
        .getCertificates()
        .filter((c) => appIds.has(c.application_id))
        .map(sanitizeCertificateForResponse);
      const notifications = matchedApps.flatMap((a) => store.getNotifications({ applicationId: a.id }));

      res.json({
        applications: matchedApps.map(redactCitizenApplication),
        certificates: certs,
        notifications: notifications.sort((a, b) => b.created_at.localeCompare(a.created_at)),
      });
      return;
    }

    if (!mobile && !trackingNo) {
      res.status(400).json({
        error: 'Provide mobile number or tracking_no',
        message_bn: 'নাগরিক তথ্য দেখতে মোবাইল নম্বর অথবা ট্র্যাকিং নম্বর দিন।',
      });
      return;
    }

    const allApps = store.getApplications();
    const matchedApps = allApps.filter((a) => {
      if (trackingNo && a.tracking_no.toUpperCase() === trackingNo) return true;
      if (mobile && normalizeMobile(a.mobile) === normalizeMobile(mobile)) return true;
      return false;
    });

    const appIds = new Set(matchedApps.map((a) => a.id));
    const certs = store
      .getCertificates()
      .filter((c) => appIds.has(c.application_id))
      .map(sanitizeCertificateForResponse);

    const notifications = matchedApps.flatMap((a) => store.getNotifications({ applicationId: a.id }));

    res.json({
      applications: matchedApps.map(redactCitizenApplication),
      certificates: certs,
      notifications: notifications.sort((a, b) => b.created_at.localeCompare(a.created_at)),
    });
  });

  // --- Applications (Permission + Institution/Ward/Dept/Assigned/Own Scoped) ---
  app.get('/api/applications', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const requestedUnit = typeof req.query.unit_id === 'string' && req.query.unit_id !== 'all'
      ? req.query.unit_id
      : undefined;

    const viewCheck = authorizeContextPermission(ctx, 'applications.view', { unitId: requestedUnit });
    if (!viewCheck.allowed) {
      res.status(403).json({
        error: viewCheck.reason || 'Forbidden: applications view access denied',
        message_bn: viewCheck.reasonBn || 'আপনার পদবি থেকে আবেদন তালিকা দেখার অনুমতি নেই।',
      });
      return;
    }

    const wardNoParam = typeof req.query.ward_no === 'string' ? parseInt(req.query.ward_no, 10) : NaN;
    if (Number.isFinite(wardNoParam) && viewCheck.scope === 'ward' && !ctx.assignedWards.includes(wardNoParam)) {
      res.status(403).json({
        error: 'Forbidden: outside assigned ward scope',
        message_bn: 'অন্য ওয়ার্ডের আবেদন দেখার অনুমতি নেই।',
      });
      return;
    }

    const isBroad = hasBroadUnitScope(ctx, 'applications.view');
    const effectiveUnit = isBroad ? requestedUnit : ctx.assignedInstitutions[0];
    let items = filterApplicationsForContext(ctx, store.getApplications(effectiveUnit));

    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const serviceId = typeof req.query.service_id === 'string' ? req.query.service_id : '';

    if (q) {
      items = items.filter(
        (a) =>
          a.tracking_no.toLowerCase().includes(q) ||
          a.applicant_name_bn.toLowerCase().includes(q) ||
          a.service_name_bn.toLowerCase().includes(q) ||
          a.mobile.toLowerCase().includes(q) ||
          (a.assigned_officer || '').toLowerCase().includes(q)
      );
    }
    if (status && status !== 'all') {
      items = items.filter((a) => a.status === status);
    }
    if (serviceId && serviceId !== 'all') {
      items = items.filter((a) => a.service_id === serviceId);
    }
    if (Number.isFinite(wardNoParam)) {
      items = items.filter((a) => a.ward_no === wardNoParam);
    }

    if (req.query.paginated === '1') {
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.page_size || '10'), 10) || 10));
      const total = items.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const safePage = Math.min(page, totalPages);
      const paged = items.slice((safePage - 1) * pageSize, safePage * pageSize);
      res.json({
        items: paged,
        total,
        page: safePage,
        page_size: pageSize,
        total_pages: totalPages,
      });
      return;
    }

    res.json(items);
  });

  app.get('/api/applications/:idOrTracking', (req: AuthedRequest, res: Response) => {
    const appRecord = store.getApplicationByIdOrTracking(req.params.idOrTracking);
    if (!appRecord) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }

    const isCitizenOrAnon = !req.actor || req.actor.role === 'citizen';

    if (req.actor && req.rbacContext) {
      if (!canUserAccessApplicationRecord(req.rbacContext, appRecord)) {
        res.status(403).json({
          error: 'Forbidden: record access denied by RBAC scope',
          message_bn: 'অন্য প্রতিষ্ঠান, ওয়ার্ড, বিভাগ বা নাগরিকের আবেদনে প্রবেশের অনুমতি নেই।',
        });
        return;
      }
    } else {
      // Unauthenticated lookup allowed ONLY by exact tracking number (prevents raw ID IDOR enumeration)
      const byTracking = req.params.idOrTracking.trim().toUpperCase() === appRecord.tracking_no.toUpperCase();
      if (!byTracking) {
        res.status(401).json({
          error: 'Authentication or exact tracking number required',
          message_bn: 'আবেদন দেখতে লগইন করুন অথবা সঠিক ট্র্যাকিং নম্বর ব্যবহার করুন।',
        });
        return;
      }
    }

    const cert = appRecord.certificate_id
      ? store.getCertificateById(appRecord.certificate_id)
      : store.getCertificateByApplicationId(appRecord.id);

    const notifications = store.getNotifications({ applicationId: appRecord.id });
    const approvals = isCitizenOrAnon
      ? []
      : store.getApplicationApprovals(appRecord.id);

    res.json({
      ...(isCitizenOrAnon ? redactCitizenApplication(appRecord) : appRecord),
      certificate: cert ? sanitizeCertificateForResponse(cert) : undefined,
      notifications,
      approvals,
    });
  });

  app.post('/api/applications', (req: AuthedRequest, res: Response) => {
    const body = req.body || {};
    if (!body.administrative_unit_id || !body.service_id || !body.applicant_name_bn || !body.mobile) {
      res.status(400).json({
        error: 'Missing required application fields',
        message_bn: 'আবশ্যকীয় তথ্যসমূহ পূরণ করুন।',
      });
      return;
    }

    if (req.actor && req.rbacContext) {
      const check = authorizeContextPermission(req.rbacContext, 'applications.create', {
        unitId: req.actor.role === 'citizen' ? undefined : body.administrative_unit_id,
        ownerUserId: req.actor.id,
      });
      if (!check.allowed) {
        res.status(403).json({
          error: check.reason || 'Forbidden: cannot create application',
          message_bn: check.reasonBn || 'আপনার পদবি থেকে আবেদন তৈরির অনুমতি নেই।',
        });
        return;
      }
    }

    const unit = store.getInstitutionById(body.administrative_unit_id);
    const service = store.getServiceById(body.service_id);
    if (!unit || !service) {
      res.status(404).json({
        error: 'Invalid institution or service',
        message_bn: 'নির্বাচিত প্রতিষ্ঠান বা সেবা সঠিক নয়।',
      });
      return;
    }

    const prefix = unit.type === 'municipality' ? 'PM' : 'UP';
    const randomNum = crypto.randomInt(10000, 99999);
    const trackingNo = body.tracking_no || `${prefix}-2026-${randomNum}`;
    const nowIso = new Date().toISOString();

    const newApp: Application = {
      ...body,
      applicant_name_bn: sanitizeText(body.applicant_name_bn, 160),
      father_name_bn: sanitizeText(body.father_name_bn || '', 160),
      mother_name_bn: sanitizeText(body.mother_name_bn || '', 160),
      id: body.id || `app_${Date.now()}_${randomNum}`,
      tracking_no: trackingNo,
      service_name_bn: sanitizeText(body.service_name_bn || service.name_bn, 160),
      fee_amount: typeof body.fee_amount === 'number' ? body.fee_amount : service.default_fee,
      status: body.status === 'paid' ? 'paid' : 'pending_payment',
      payment_status: body.payment_status === 'paid' ? 'paid' : 'unpaid',
      created_by_user_id: req.actor?.id || body.created_by_user_id,
      assigned_officer_id:
        req.actor && req.actor.role !== 'citizen' ? req.actor.id : body.assigned_officer_id,
      assigned_officer:
        req.actor && req.actor.role !== 'citizen' ? req.actor.name_bn : body.assigned_officer,
      created_at: nowIso,
      updated_at: nowIso,
      review_notes: body.review_notes || ['আবেদন সফলভাবে সার্ভারে সংরক্ষিত হয়েছে।'],
    };

    delete newApp.certificate_id;
    delete newApp.verification_token;
    if (newApp.status === ('certificate_issued' as ApplicationStatus)) {
      newApp.status = 'paid';
    }

    store.upsertApplication(newApp);
    res.status(201).json(newApp);
  });

  // Citizen resubmits application after correction_required
  app.post('/api/applications/:id/resubmit', (req: AuthedRequest, res: Response) => {
    const appRecord = store.getApplicationByIdOrTracking(req.params.id);
    if (!appRecord) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }

    if (req.actor && req.rbacContext && req.actor.role === 'citizen') {
      if (!canUserAccessApplicationRecord(req.rbacContext, appRecord)) {
        res.status(403).json({
          error: 'Forbidden: cannot resubmit another citizen application',
          message_bn: 'অন্য নাগরিকের আবেদন পুনঃদাখিল করার অনুমতি নেই।',
        });
        return;
      }
    }

    const { tracking_no, applicant_name_bn, present_address_bn, correction_response } = req.body || {};
    if (!tracking_no || String(tracking_no).trim().toUpperCase() !== appRecord.tracking_no.toUpperCase()) {
      res.status(403).json({
        error: 'Matching tracking number required',
        message_bn: 'সংশোধিত আবেদন পুনঃদাখিল করতে সঠিক ট্র্যাকিং নম্বর প্রয়োজন।',
      });
      return;
    }
    if (appRecord.status !== 'correction_required') {
      res.status(409).json({
        error: 'Application is not awaiting correction',
        message_bn: 'এই আবেদনটি বর্তমানে সংশোধনের জন্য ফেরত পাঠানো অবস্থায় নেই।',
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const updated: Application = {
      ...appRecord,
      applicant_name_bn: applicant_name_bn ? sanitizeText(applicant_name_bn, 160) : appRecord.applicant_name_bn,
      present_address_bn: present_address_bn ? sanitizeText(present_address_bn, 300) : appRecord.present_address_bn,
      status: 'under_verification',
      updated_at: nowIso,
      review_notes: [
        ...(appRecord.review_notes || []),
        `নাগরিক কর্তৃক সংশোধিত তথ্য পুনঃদাখিল: ${sanitizeText(correction_response || 'তথ্য হালনাগাদ করা হয়েছে', 300)}`,
      ],
    };
    store.upsertApplication(updated);
    res.json(updated);
  });

  // Upload validated attachment for an application (PDF/JPG/PNG <= 2MB)
  app.post('/api/applications/:id/attachments', (req: AuthedRequest, res: Response) => {
    const appRecord = store.getApplicationByIdOrTracking(req.params.id);
    if (!appRecord) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }
    if (req.actor && req.rbacContext && !canUserAccessApplicationRecord(req.rbacContext, appRecord)) {
      res.status(403).json({ error: 'Forbidden: cannot attach documents to this application' });
      return;
    }
    const { doc_type, original_name, mime_type, content_base64 } = req.body || {};
    if (!original_name || !mime_type || !content_base64) {
      res.status(400).json({
        error: 'Attachment filename, mime_type, and content_base64 are required',
        message_bn: 'নথির নাম, ধরন ও ফাইল কনটেন্ট আবশ্যক।',
      });
      return;
    }
    if (!ALLOWED_ATTACHMENT_MIMES.has(String(mime_type))) {
      res.status(400).json({
        error: 'Unsupported file type; only PDF, JPG, and PNG allowed',
        message_bn: 'শুধুমাত্র PDF, JPG অথবা PNG ফরম্যাটের ফাইল আপলোড করা যাবে।',
      });
      return;
    }

    const rawBase64 = String(content_base64).replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(rawBase64, 'base64');
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      res.status(400).json({
        error: 'File size must be between 1 byte and 2 MB',
        message_bn: 'ফাইলের আকার সর্বোচ্চ ২ মেগাবাইটের মধ্যে হতে হবে।',
      });
      return;
    }

    const safeExt =
      mime_type === 'application/pdf' ? '.pdf' : mime_type === 'image/png' ? '.png' : '.jpg';
    const attId = `att_${crypto.randomUUID()}`;
    const dir = path.join(getAttachmentStorageRoot(), appRecord.administrative_unit_id, appRecord.id);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${attId}${safeExt}`);
    fs.writeFileSync(filePath, buffer);

    const safeName = path.basename(sanitizeText(original_name, 120)) || `document${safeExt}`;
    const att: ApplicationAttachment & { storage_path: string } = {
      id: attId,
      application_id: appRecord.id,
      doc_type: ['nid', 'photo', 'proof'].includes(doc_type) ? doc_type : 'other',
      original_name: safeName,
      mime_type: String(mime_type),
      size_bytes: buffer.byteLength,
      storage_path: filePath,
      uploaded_at: new Date().toISOString(),
    };
    store.insertAttachment(att);
    const { storage_path: _sp, ...publicMeta } = att;
    res.status(201).json(publicMeta);
  });

  app.get('/api/attachments/:id', (req: AuthedRequest, res: Response) => {
    const att = store.getAttachmentWithPath(req.params.id);
    if (!att) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }
    const appRecord = store.getApplicationByIdOrTracking(att.application_id);
    if (!appRecord) {
      res.status(404).json({ error: 'Linked application not found' });
      return;
    }
    const trackingParam =
      typeof req.query.tracking_no === 'string' ? req.query.tracking_no.trim().toUpperCase() : '';
    const hasAnonTrackingMatch = !req.actor && Boolean(trackingParam && appRecord.tracking_no.toUpperCase() === trackingParam);
    const hasRbacAccess = Boolean(
      req.actor && req.rbacContext && canUserAccessApplicationRecord(req.rbacContext, appRecord)
    );

    if (!hasRbacAccess && !hasAnonTrackingMatch) {
      res.status(403).json({
        error: 'Forbidden: attachment access denied',
        message_bn: 'এই নাগরিক নথিপত্র দেখার অনুমতি আপনার নেই।',
      });
      return;
    }
    if (!fs.existsSync(att.storage_path)) {
      res.status(404).json({ error: 'Attachment file missing' });
      return;
    }
    res.setHeader('Content-Type', att.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${att.original_name.replace(/"/g, '')}"`);
    fs.createReadStream(att.storage_path).pipe(res);
  });

  // Assign application to an officer within the same institution
  app.post('/api/applications/:id/assign', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const actor = req.actor!;
    const ctx = req.rbacContext!;
    const appRecord = store.getApplicationByIdOrTracking(req.params.id);
    if (!appRecord) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }

    const permCheck = authorizeContextPermission(ctx, 'applications.assign', {
      unitId: appRecord.administrative_unit_id,
      wardNo: appRecord.ward_no,
      department: mapServiceDepartment(appRecord.service_id),
    });
    if (!permCheck.allowed) {
      res.status(403).json({
        error: permCheck.reason || 'Forbidden: cross-institution assignment denied',
        message_bn: permCheck.reasonBn || 'অন্য প্রতিষ্ঠানের আবেদনে কর্মকর্তা নিয়োগের অনুমতি নেই।',
      });
      return;
    }

    const { staff_id, officer_name_bn } = req.body || {};
    let assigneeName = sanitizeText(officer_name_bn, 120);
    let assigneeId = staff_id ? String(staff_id) : undefined;
    if (staff_id) {
      const staff = store.getStaffById(String(staff_id));
      if (!staff || staff.administrative_unit_id !== appRecord.administrative_unit_id) {
        res.status(400).json({
          error: 'Selected staff does not belong to this institution',
          message_bn: 'নির্বাচিত কর্মকর্তা এই প্রতিষ্ঠানের অন্তর্ভুক্ত নন।',
        });
        return;
      }
      assigneeName = staff.name_bn;
      assigneeId = staff.id;
    }

    if (!assigneeName) {
      res.status(400).json({ error: 'Officer name or staff_id required' });
      return;
    }

    const nowIso = new Date().toISOString();
    const updated: Application = {
      ...appRecord,
      assigned_officer: assigneeName,
      assigned_officer_id: assigneeId,
      updated_at: nowIso,
      review_notes: [
        ...(appRecord.review_notes || []),
        `দায়িত্ব বণ্টন (${actor.name_bn}): ${assigneeName} কে যাচাইয়ের দায়িত্ব অর্পণ করা হয়েছে।`,
      ],
    };
    store.upsertApplication(updated);
    store.recordApprovalAction({
      applicationId: appRecord.id,
      unitId: appRecord.administrative_unit_id,
      officerId: actor.id,
      officerRole: actor.role,
      officerNameBn: actor.name_bn,
      officerTitleBn: actor.title_bn,
      decision: 'assigned',
      notes: `দায়িত্বপ্রাপ্ত কর্মকর্তা: ${assigneeName}`,
      timestamp: nowIso,
    });
    res.json(updated);
  });

  // Request correction from citizen
  app.post('/api/applications/:id/request-correction', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const actor = req.actor!;
    const ctx = req.rbacContext!;
    const appRecord = store.getApplicationByIdOrTracking(req.params.id);
    if (!appRecord) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }

    const permCheck = authorizeContextPermission(ctx, 'applications.request_correction', {
      unitId: appRecord.administrative_unit_id,
      wardNo: appRecord.ward_no,
      department: mapServiceDepartment(appRecord.service_id),
      assignedOfficerId: appRecord.assigned_officer_id,
      assignedOfficerName: appRecord.assigned_officer,
    });
    if (!permCheck.allowed) {
      res.status(403).json({
        error: permCheck.reason || 'Forbidden: correction request denied',
        message_bn: permCheck.reasonBn || 'সংশোধনের নির্দেশনা প্রদানের অনুমতি আপনার নেই।',
      });
      return;
    }

    const reason = sanitizeText(req.body?.reason || req.body?.note || 'তথ্য বা সংযুক্ত নথিতে সংশোধন প্রয়োজন।', 400);
    const nowIso = new Date().toISOString();
    const updated: Application = {
      ...appRecord,
      status: 'correction_required',
      correction_note: reason,
      assigned_officer: appRecord.assigned_officer || actor.name_bn,
      updated_at: nowIso,
      review_notes: [
        ...(appRecord.review_notes || []),
        `সংশোধন অনুরোধ (${actor.name_bn}): ${reason}`,
      ],
    };
    store.upsertApplication(updated);
    store.recordApprovalAction({
      applicationId: appRecord.id,
      unitId: appRecord.administrative_unit_id,
      officerId: actor.id,
      officerRole: actor.role,
      officerNameBn: actor.name_bn,
      officerTitleBn: actor.title_bn,
      decision: 'correction_required',
      notes: reason,
      timestamp: nowIso,
    });
    store.insertNotification({
      mobile: appRecord.mobile,
      applicationId: appRecord.id,
      unitId: appRecord.administrative_unit_id,
      titleBn: 'আবেদন সংশোধনের নির্দেশনা',
      messageBn: `আপনার আবেদন (${appRecord.tracking_no}) সংশোধনের জন্য ফেরত পাঠানো হয়েছে। কারণ: ${reason}`,
    });
    res.json(updated);
  });

  app.patch('/api/applications/:id/status', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const actor = req.actor!;
    const ctx = req.rbacContext!;
    const { status, note, assigned_officer } = req.body || {};
    const appRecord = store.getApplicationByIdOrTracking(req.params.id);
    if (!appRecord) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }

    if (status === 'certificate_issued' || status === 'approved') {
      res.status(400).json({
        error: 'Use /api/applications/:id/final-approve for final approval and certificate issuance',
        message_bn: 'চূড়ান্ত অনুমোদন ও সনদ ইস্যুর জন্য অনুমোদিত ফাইনাল-অ্যাপ্রুভ ধাপ ব্যবহার করুন।',
      });
      return;
    }

    const permissionByStatus: Record<string, PermissionKey> = {
      under_verification: 'applications.verify',
      forwarded_for_approval: 'applications.forward',
      correction_required: 'applications.request_correction',
      rejected: 'applications.reject',
    };
    const requiredPerm = permissionByStatus[String(status)];
    if (!requiredPerm) {
      res.status(400).json({ error: 'Invalid status transition' });
      return;
    }

    const permCheck = authorizeContextPermission(ctx, requiredPerm, {
      unitId: appRecord.administrative_unit_id,
      wardNo: appRecord.ward_no,
      department: mapServiceDepartment(appRecord.service_id),
      assignedOfficerId: appRecord.assigned_officer_id,
      assignedOfficerName: appRecord.assigned_officer,
      ownerUserId: appRecord.created_by_user_id,
    });
    if (!permCheck.allowed) {
      res.status(403).json({
        error: permCheck.reason || 'Forbidden: status transition not allowed for current role/scope',
        message_bn: permCheck.reasonBn || 'আপনার বর্তমান পদবি বা নির্ধারিত পরিধি থেকে এই ধাপের অনুমতি নেই।',
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const cleanNote = sanitizeText(note || `কর্মকর্তা (${actor.name_bn}) কর্তৃক অবস্থা পরিবর্তন: ${status}`, 400);
    const updated: Application = {
      ...appRecord,
      status: status as ApplicationStatus,
      updated_at: nowIso,
      assigned_officer: assigned_officer || actor.name_bn,
      correction_note: status === 'correction_required' ? cleanNote : appRecord.correction_note,
      rejection_reason: status === 'rejected' ? cleanNote : appRecord.rejection_reason,
      review_notes: [...(appRecord.review_notes || []), cleanNote],
    };
    store.upsertApplication(updated);

    const decisionMap: Record<string, 'under_verification' | 'correction_required' | 'forwarded' | 'rejected'> = {
      under_verification: 'under_verification',
      correction_required: 'correction_required',
      forwarded_for_approval: 'forwarded',
      rejected: 'rejected',
    };
    store.recordApprovalAction({
      applicationId: appRecord.id,
      unitId: appRecord.administrative_unit_id,
      officerId: actor.id,
      officerRole: actor.role,
      officerNameBn: actor.name_bn,
      officerTitleBn: actor.title_bn,
      decision: decisionMap[status],
      notes: cleanNote,
      timestamp: nowIso,
    });

    if (status === 'rejected' || status === 'correction_required') {
      store.insertNotification({
        mobile: appRecord.mobile,
        applicationId: appRecord.id,
        unitId: appRecord.administrative_unit_id,
        titleBn: status === 'rejected' ? 'আবেদন বাতিল করা হয়েছে' : 'আবেদন সংশোধনের নির্দেশনা',
        messageBn: `আবেদন নং ${appRecord.tracking_no}: ${cleanNote}`,
      });
    }

    res.json(updated);
  });

  app.get('/api/applications/:id/history', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const appRecord = store.getApplicationByIdOrTracking(req.params.id);
    if (!appRecord) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }
    if (!canUserAccessApplicationRecord(req.rbacContext!, appRecord)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    res.json({
      approvals: store.getApplicationApprovals(appRecord.id),
      events: store.getCertificateEvents(undefined, undefined, appRecord.id),
    });
  });

  // --- Payment Checkout ---
  app.post('/api/payments/checkout', (req: Request, res: Response) => {
    const { applicationId, method, amount } = req.body || {};
    const appRecord = store.getApplicationByIdOrTracking(applicationId);

    if (!appRecord) {
      res.status(404).json({ error: 'Application not found for payment' });
      return;
    }

    const trxPrefix = method === 'bkash' ? 'BKS' : method === 'nagad' ? 'NGD' : method === 'rocket' ? 'RKT' : 'CRD';
    const trxId = `${trxPrefix}${crypto.randomInt(10000000, 99999999)}`;
    const paidAt = new Date().toISOString();

    const updated: Application = {
      ...appRecord,
      payment_status: 'paid',
      status: appRecord.status === 'pending_payment' || appRecord.status === 'draft' ? 'paid' : appRecord.status,
      payment_method: method || 'bkash',
      transaction_id: trxId,
      paid_at: paidAt,
      updated_at: paidAt,
      review_notes: [
        ...(appRecord.review_notes || []),
        `অনলাইন ফি ৳${amount ?? appRecord.fee_amount} সফলভাবে পরিশোধিত (${String(method || 'bkash').toUpperCase()}, TrxID: ${trxId})`,
      ],
    };
    store.upsertApplication(updated);

    res.json({
      success: true,
      transaction_id: trxId,
      amount: amount ?? appRecord.fee_amount,
      paid_at: paidAt,
      application: updated,
    });
  });

  // --- Final Approval & Automatic QR/PDF Certificate Issuance ---
  const handleFinalApprove = async (req: AuthedRequest, res: Response) => {
    try {
      const result = await approveAndIssueCertificate({
        applicationId: req.params.id,
        actor: req.actor!,
        notes: req.body?.notes || req.body?.note,
        expiresInDays:
          typeof req.body?.expires_in_days === 'number' ? req.body.expires_in_days : undefined,
      });
      res.status(result.already_issued ? 200 : 201).json(result);
    } catch (err) {
      if (err instanceof ServiceError) {
        res.status(err.statusCode).json({
          error: err.message,
          message_bn: err.messageBn,
        });
        return;
      }
      console.error('Final approval error:', err);
      res.status(500).json({
        error: 'Certificate issuance failed',
        message_bn: 'সনদপত্র প্রস্তুতকরণে কারিগরি ত্রুটি হয়েছে।',
      });
    }
  };

  app.post('/api/applications/:id/final-approve', requireFinalApproverMiddleware, handleFinalApprove);
  app.post('/api/applications/:id/issue-certificate', requireFinalApproverMiddleware, handleFinalApprove);

  // --- Certificate Registry, Export, Filter/Sort/Paginate, Revocation, Reissue & PDF Download ---
  function filterAndSortCertificates(req: Request, unitScope?: string, ctx?: ActorRbacContext | null): Certificate[] {
    let items = store.getCertificates(unitScope);

    if (ctx) {
      items = items.filter((c) => {
        const linkedApp = store.getApplicationByIdOrTracking(c.application_id);
        return authorizeContextPermission(ctx, 'certificates.view', {
          unitId: c.administrative_unit_id,
          wardNo: linkedApp?.ward_no,
          department: mapServiceDepartment(c.service_id),
          assignedOfficerId: linkedApp?.assigned_officer_id,
          assignedOfficerName: linkedApp?.assigned_officer,
          ownerUserId: linkedApp?.created_by_user_id,
          ownerMobile: linkedApp?.mobile,
        }).allowed;
      });
    }

    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const serviceId = typeof req.query.service_id === 'string' ? req.query.service_id : '';
    const dateFrom = typeof req.query.date_from === 'string' ? req.query.date_from : '';
    const dateTo = typeof req.query.date_to === 'string' ? req.query.date_to : '';
    const sortBy = typeof req.query.sort_by === 'string' ? req.query.sort_by : 'issued_at';
    const sortDir = req.query.sort_dir === 'asc' ? 1 : -1;

    if (q) {
      items = items.filter(
        (c) =>
          (c.certificate_number || c.certificate_no).toLowerCase().includes(q) ||
          c.applicant_name_bn.toLowerCase().includes(q) ||
          c.certificate_title_bn.toLowerCase().includes(q) ||
          (c.application_tracking_no || '').toLowerCase().includes(q) ||
          (c.issuing_unit_bn || '').toLowerCase().includes(q) ||
          c.officer_name_bn.toLowerCase().includes(q)
      );
    }
    if (status && status !== 'all') {
      items = items.filter((c) => c.status === status);
    }
    if (serviceId && serviceId !== 'all') {
      items = items.filter((c) => c.service_id === serviceId);
    }
    if (dateFrom) {
      const fromTs = new Date(dateFrom).getTime();
      if (Number.isFinite(fromTs)) {
        items = items.filter((c) => new Date(c.issued_at || 0).getTime() >= fromTs);
      }
    }
    if (dateTo) {
      const toTs = new Date(dateTo).getTime() + 86400_000;
      if (Number.isFinite(toTs)) {
        items = items.filter((c) => new Date(c.issued_at || 0).getTime() <= toTs);
      }
    }

    items.sort((a, b) => {
      if (sortBy === 'applicant_name_bn') {
        return a.applicant_name_bn.localeCompare(b.applicant_name_bn) * sortDir;
      }
      if (sortBy === 'certificate_number') {
        return (a.certificate_number || '').localeCompare(b.certificate_number || '') * sortDir;
      }
      if (sortBy === 'status') {
        return a.status.localeCompare(b.status) * sortDir;
      }
      const ta = new Date(a.issued_at || a.approved_at || 0).getTime();
      const tb = new Date(b.issued_at || b.approved_at || 0).getTime();
      return (ta - tb) * sortDir;
    });

    return items.map(sanitizeCertificateForResponse);
  }

  app.get('/api/certificates', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const requestedUnit = typeof req.query.unit_id === 'string' && req.query.unit_id !== 'all'
      ? req.query.unit_id
      : undefined;

    const certCheck = authorizeContextPermission(ctx, 'certificates.view', { unitId: requestedUnit });
    if (!certCheck.allowed) {
      res.status(403).json({
        error: certCheck.reason || 'Forbidden: cross-institution access denied',
        message_bn: certCheck.reasonBn || 'অন্য প্রতিষ্ঠানের সনদ তালিকা দেখার অনুমতি নেই।',
      });
      return;
    }

    const effectiveUnit = hasBroadUnitScope(ctx, 'certificates.view')
      ? requestedUnit
      : ctx.assignedInstitutions[0];
    const filtered = filterAndSortCertificates(req, effectiveUnit, ctx);

    if (req.query.paginated === '1') {
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.page_size || '10'), 10) || 10));
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const safePage = Math.min(page, totalPages);
      const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
      res.json({
        items: paged,
        total,
        page: safePage,
        page_size: pageSize,
        total_pages: totalPages,
      });
      return;
    }

    res.json(filtered);
  });

  app.get('/api/certificates/export', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const requestedUnit = typeof req.query.unit_id === 'string' && req.query.unit_id !== 'all'
      ? req.query.unit_id
      : undefined;

    const viewOk = authorizeContextPermission(ctx, 'certificates.view', { unitId: requestedUnit });
    const exportOk =
      authorizeContextPermission(ctx, 'applications.export', { unitId: requestedUnit }).allowed ||
      authorizeContextPermission(ctx, 'reports.export', { unitId: requestedUnit }).allowed ||
      authorizeContextPermission(ctx, 'certificates.download', { unitId: requestedUnit }).allowed;

    if (!viewOk.allowed || !exportOk) {
      res.status(403).json({
        error: 'Forbidden: certificate export permission denied',
        message_bn: 'সনদ রেজিস্ট্রি এক্সপোর্ট করার অনুমতি আপনার নেই।',
      });
      return;
    }

    const effectiveUnit = hasBroadUnitScope(ctx, 'certificates.view')
      ? requestedUnit
      : ctx.assignedInstitutions[0];
    const items = filterAndSortCertificates(req, effectiveUnit, ctx);

    const header = [
      'Certificate No',
      'Application No',
      'Applicant Name',
      'Certificate Type',
      'Issuing Institution',
      'Submitted At',
      'Approved At',
      'Issued At',
      'Status',
      'Assigned Officer',
    ];
    const rows = items.map((c) => [
      escapeCsvCell(c.certificate_number || c.certificate_no),
      escapeCsvCell(c.application_tracking_no || c.application_id),
      escapeCsvCell(c.applicant_name_bn),
      escapeCsvCell(c.certificate_title_bn),
      escapeCsvCell(c.issuing_unit_bn || c.administrative_unit_id),
      escapeCsvCell(c.application_created_at || ''),
      escapeCsvCell(c.approved_at || ''),
      escapeCsvCell(c.issued_at || ''),
      escapeCsvCell(c.status),
      escapeCsvCell(c.assigned_officer || c.officer_name_bn),
    ]);
    const csvContent = '\uFEFF' + [header.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const filename = `PottoyonBD_Certificates_Export_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  });

  app.post('/api/certificates/:id/revoke', requireFinalApproverMiddleware, async (req: AuthedRequest, res: Response) => {
    try {
      const updated = await revokeCertificate({
        certificateId: req.params.id,
        actor: req.actor!,
        reason: String(req.body?.reason || ''),
      });
      res.json({
        success: true,
        certificate: updated,
      });
    } catch (err) {
      if (err instanceof ServiceError) {
        res.status(err.statusCode).json({
          error: err.message,
          message_bn: err.messageBn,
        });
        return;
      }
      console.error('Revocation error:', err);
      res.status(500).json({ error: 'Revocation failed' });
    }
  });

  app.post('/api/certificates/:id/reissue', requireFinalApproverMiddleware, async (req: AuthedRequest, res: Response) => {
    try {
      const result = await reissueCertificate({
        certificateId: req.params.id,
        actor: req.actor!,
        notes: req.body?.notes || req.body?.reason,
        expiresInDays:
          typeof req.body?.expires_in_days === 'number' ? req.body.expires_in_days : undefined,
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof ServiceError) {
        res.status(err.statusCode).json({
          error: err.message,
          message_bn: err.messageBn,
        });
        return;
      }
      console.error('Reissue error:', err);
      res.status(500).json({
        error: 'Certificate reissue failed',
        message_bn: 'সনদ পুনঃইস্যু করতে সমস্যা হয়েছে।',
      });
    }
  });

  app.get('/api/certificates/:id/history', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const cert = store.getCertificateById(req.params.id);
    if (!cert) {
      res.status(404).json({ error: 'Certificate not found' });
      return;
    }
    const appRecord = store.getApplicationByIdOrTracking(cert.application_id);
    const check = authorizeContextPermission(req.rbacContext!, 'certificates.view', {
      unitId: cert.administrative_unit_id,
      wardNo: appRecord?.ward_no,
      department: mapServiceDepartment(cert.service_id),
      assignedOfficerId: appRecord?.assigned_officer_id,
      assignedOfficerName: appRecord?.assigned_officer,
    });
    if (!check.allowed) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    res.json({
      events: store.getCertificateEvents(undefined, undefined, cert.application_id),
      approvals: store.getApplicationApprovals(cert.application_id),
      verification_logs: store.getVerificationLogs(undefined, cert.id),
    });
  });

  app.get('/api/certificates/:id', (req: AuthedRequest, res: Response) => {
    const cert = store.getCertificateById(req.params.id);
    if (!cert) {
      res.status(404).json({ error: 'Certificate not found' });
      return;
    }

    const trackingParam =
      typeof req.query.tracking_no === 'string' ? req.query.tracking_no.trim().toUpperCase() : '';
    const appRecord = store.getApplicationByIdOrTracking(cert.application_id);
    const hasAnonTrackingMatch = !req.actor && Boolean(
      appRecord && trackingParam && appRecord.tracking_no.toUpperCase() === trackingParam
    );

    const hasRbacAccess = Boolean(
      req.actor &&
      req.rbacContext &&
      authorizeContextPermission(req.rbacContext, 'certificates.view', {
        unitId: cert.administrative_unit_id,
        wardNo: appRecord?.ward_no,
        department: mapServiceDepartment(cert.service_id),
        assignedOfficerId: appRecord?.assigned_officer_id,
        assignedOfficerName: appRecord?.assigned_officer,
        ownerUserId: appRecord?.created_by_user_id,
        ownerMobile: appRecord?.mobile,
      }).allowed
    );

    if (!hasRbacAccess && !hasAnonTrackingMatch) {
      res.status(403).json({
        error: 'Forbidden: authorized officer or matching tracking number required',
        message_bn: 'পূর্ণাঙ্গ সনদপত্র দেখতে অনুমোদিত কর্মকর্তা লগইন অথবা সঠিক ট্র্যাকিং নম্বর প্রয়োজন।',
      });
      return;
    }

    res.json(sanitizeCertificateForResponse(cert));
  });

  app.get('/api/certificates/:id/pdf', (req: AuthedRequest, res: Response) => {
    const cert = store.getCertificateById(req.params.id);
    if (!cert) {
      res.status(404).json({ error: 'Certificate not found' });
      return;
    }

    const trackingParam =
      typeof req.query.tracking_no === 'string' ? req.query.tracking_no.trim().toUpperCase() : '';
    const appRecord = store.getApplicationByIdOrTracking(cert.application_id);
    const hasAnonTrackingMatch = !req.actor && Boolean(
      appRecord && trackingParam && appRecord.tracking_no.toUpperCase() === trackingParam
    );

    const target = {
      unitId: cert.administrative_unit_id,
      wardNo: appRecord?.ward_no,
      department: mapServiceDepartment(cert.service_id),
      assignedOfficerId: appRecord?.assigned_officer_id,
      assignedOfficerName: appRecord?.assigned_officer,
      ownerUserId: appRecord?.created_by_user_id,
      ownerMobile: appRecord?.mobile,
    };

    const hasRbacDownload = Boolean(
      req.actor &&
      req.rbacContext &&
      (authorizeContextPermission(req.rbacContext, 'certificates.download', target).allowed ||
        (req.query.inline === '1' && authorizeContextPermission(req.rbacContext, 'certificates.preview', target).allowed))
    );

    if (!hasRbacDownload && !hasAnonTrackingMatch) {
      res.status(403).json({
        error: 'Forbidden: PDF download requires authorized permission or citizen ownership',
        message_bn: 'অফিসিয়াল পিডিএফ ডাউনলোডের জন্য অনুমোদন প্রয়োজন।',
      });
      return;
    }

    if (!cert.pdf_path || !fs.existsSync(cert.pdf_path)) {
      res.status(404).json({ error: 'Certificate PDF file not available' });
      return;
    }

    const service = store.getServiceById(cert.service_id);
    const filename = buildMeaningfulPdfFilename(cert, service?.name_en, appRecord?.tracking_no);
    const dispositionType = req.query.inline === '1' ? 'inline' : 'attachment';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${filename}"`);
    fs.createReadStream(cert.pdf_path).pipe(res);
  });

  // --- Audit & Verification Logs ---
  app.get('/api/certificates/:id/events', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const cert = store.getCertificateById(req.params.id);
    if (!cert) {
      res.status(404).json({ error: 'Certificate not found' });
      return;
    }
    const check = authorizeContextPermission(req.rbacContext!, 'certificates.view', {
      unitId: cert.administrative_unit_id,
    });
    if (!check.allowed) {
      res.status(403).json({ error: 'Forbidden: cross-institution audit access denied' });
      return;
    }
    res.json(store.getCertificateEvents(cert.id));
  });

  app.get('/api/audit-logs', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const requestedUnit = typeof req.query.unit_id === 'string' && req.query.unit_id !== 'all'
      ? req.query.unit_id
      : undefined;

    const check = authorizeContextPermission(ctx, 'audit_logs.view', { unitId: requestedUnit });
    if (!check.allowed) {
      res.status(403).json({
        error: check.reason || 'Forbidden: audit logs view permission required',
        message_bn: check.reasonBn || 'অডিট লগ দেখার অনুমতি আপনার নেই।',
      });
      return;
    }

    const unitScope = hasBroadUnitScope(ctx, 'audit_logs.view')
      ? requestedUnit
      : ctx.assignedInstitutions[0];

    res.json({
      events: store.getCertificateEvents(undefined, unitScope),
      verification_logs: store.getVerificationLogs(unitScope),
      approvals: store
        .getApplicationApprovals()
        .filter((a) => !unitScope || a.administrative_unit_id === unitScope),
    });
  });

  // --- Notifications ---
  app.get('/api/notifications', (req: AuthedRequest, res: Response) => {
    const trackingNo =
      typeof req.query.tracking_no === 'string' ? req.query.tracking_no.trim() : undefined;
    const applicationId =
      typeof req.query.application_id === 'string' ? req.query.application_id.trim() : undefined;

    if (trackingNo) {
      const appRecord = store.getApplicationByIdOrTracking(trackingNo);
      if (req.actor && req.actor.role === 'citizen' && req.rbacContext && appRecord) {
        if (!canUserAccessApplicationRecord(req.rbacContext, appRecord)) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }
      }
      res.json(appRecord ? store.getNotifications({ applicationId: appRecord.id }) : []);
      return;
    }

    if (applicationId) {
      const appRecord = store.getApplicationByIdOrTracking(applicationId);
      if (req.actor && req.rbacContext && appRecord && !canUserAccessApplicationRecord(req.rbacContext, appRecord)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      res.json(store.getNotifications({ applicationId }));
      return;
    }

    if (req.actor && req.rbacContext && req.actor.role !== 'citizen') {
      const unitScope = hasBroadUnitScope(req.rbacContext, 'dashboard.view')
        ? undefined
        : req.rbacContext.assignedInstitutions[0];
      res.json(store.getNotifications({ unitId: unitScope }));
      return;
    }

    res.status(401).json({ error: 'Officer session or tracking_no required' });
  });

  // --- Public Rate-Limited Real-Time Certificate Verification ---
  app.get('/api/verify/:token', (req: Request, res: Response) => {
    const ip = extractClientIp(req);
    const rate = checkVerifyRateLimit(ip);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({
        verified: false,
        status: 'invalid',
        error: 'Rate limit exceeded',
        message_bn: `অতিরিক্ত যাচাই অনুরোধ পাঠানো হয়েছে। অনুগ্রহ করে ${rate.retryAfterSec} সেকেন্ড পর পুনরায় চেষ্টা করুন।`,
      });
      return;
    }

    const result = verifyCertificateByToken({
      rawToken: req.params.token,
      ipAddress: ip,
      userAgent: String(req.headers['user-agent'] || 'unknown'),
    });

    res.status(result.httpStatus).json(result.body);
  });

  // --- Holding Taxes, Trade Licenses, Notices ---
  app.get('/api/holding-taxes', (req: AuthedRequest, res: Response) => {
    const requestedUnit = typeof req.query.unit_id === 'string' && req.query.unit_id !== 'all'
      ? req.query.unit_id
      : undefined;
    if (req.actor && req.rbacContext) {
      const check = authorizeContextPermission(req.rbacContext, 'payments.view', { unitId: requestedUnit });
      if (!check.allowed) {
        res.status(403).json({ error: check.reason || 'Forbidden: financial tax registry denied' });
        return;
      }
      const effectiveUnit = hasBroadUnitScope(req.rbacContext, 'payments.view')
        ? requestedUnit
        : req.rbacContext.assignedInstitutions[0];
      res.json(store.getHoldingTaxes(effectiveUnit));
      return;
    }
    res.json(store.getHoldingTaxes(requestedUnit));
  });

  app.post('/api/holding-taxes', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const b = req.body || {};
    const targetUnit = b.administrative_unit_id
      ? String(b.administrative_unit_id)
      : hasBroadUnitScope(ctx, 'payments.reconcile')
        ? 'unit_goyeshpur'
        : ctx.assignedInstitutions[0];

    const check = authorizeContextPermission(ctx, 'payments.reconcile', { unitId: targetUnit });
    if (!check.allowed) {
      res.status(403).json({
        error: check.reason || 'Forbidden: insufficient financial permissions',
        message_bn: check.reasonBn || 'হোল্ডিং ট্যাক্স এন্ট্রি করার অনুমতি আপনার নেই।',
      });
      return;
    }
    if (!b.holding_no || !b.owner_name_bn) {
      res.status(400).json({ error: 'holding_no and owner_name_bn required' });
      return;
    }
    const annualTax = Number(b.annual_tax) || 500;
    const record: HoldingTaxRecord = {
      id: `ht_${crypto.randomUUID().slice(0, 8)}`,
      administrative_unit_id: targetUnit,
      holding_no: sanitizeText(b.holding_no, 40),
      ward_no: Number(b.ward_no) || 1,
      owner_name_bn: sanitizeText(b.owner_name_bn, 120),
      owner_mobile: sanitizeText(b.owner_mobile || '01700-000000', 30),
      village_bn: sanitizeText(b.village_bn || 'সদর', 120),
      structure_type: sanitizeText(b.structure_type || 'আধাপাকা বসতবাড়ি', 80),
      annual_assessment: annualTax * 12,
      annual_tax: annualTax,
      arrears: Number(b.arrears) || 0,
      current_due: annualTax + (Number(b.arrears) || 0),
      fiscal_year: '২০২৫-২০২৬',
      status: 'due',
    };
    store.upsertHoldingTax(record);
    res.status(201).json(record);
  });

  app.post('/api/holding-taxes/:id/pay', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const record = store.getHoldingTaxById(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Holding tax record not found' });
      return;
    }
    const check = authorizeContextPermission(ctx, 'payments.reconcile', {
      unitId: record.administrative_unit_id,
    });
    if (!check.allowed) {
      res.status(403).json({ error: check.reason || 'Forbidden: payment reconciliation denied' });
      return;
    }
    const payAmount =
      typeof req.body?.amount === 'number' && req.body.amount > 0 ? req.body.amount : record.current_due;
    const remaining = Math.max(0, record.current_due - payAmount);
    const updated: HoldingTaxRecord = {
      ...record,
      current_due: remaining,
      arrears: remaining > 0 ? remaining : 0,
      last_paid_at: new Date().toISOString().slice(0, 10),
      status: remaining === 0 ? 'paid' : 'partial',
    };
    store.upsertHoldingTax(updated);
    res.json(updated);
  });

  app.get('/api/trade-licenses', (req: AuthedRequest, res: Response) => {
    const requestedUnit = typeof req.query.unit_id === 'string' && req.query.unit_id !== 'all'
      ? req.query.unit_id
      : undefined;
    if (req.actor && req.rbacContext) {
      const check =
        authorizeContextPermission(req.rbacContext, 'payments.view', { unitId: requestedUnit }).allowed ||
        authorizeContextPermission(req.rbacContext, 'services.view', { unitId: requestedUnit, department: 'licensing' }).allowed;
      if (!check) {
        res.status(403).json({ error: 'Forbidden: trade license registry access denied' });
        return;
      }
      const isBroad = hasBroadUnitScope(req.rbacContext, 'payments.view') || hasBroadUnitScope(req.rbacContext, 'services.view');
      const effectiveUnit = isBroad ? requestedUnit : req.rbacContext.assignedInstitutions[0];
      res.json(store.getTradeLicenses(effectiveUnit));
      return;
    }
    res.json(store.getTradeLicenses(requestedUnit));
  });

  app.post('/api/trade-licenses', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const b = req.body || {};
    const targetUnit = b.administrative_unit_id
      ? String(b.administrative_unit_id)
      : hasBroadUnitScope(ctx, 'payments.reconcile') || hasBroadUnitScope(ctx, 'services.manage')
        ? 'unit_goyeshpur'
        : ctx.assignedInstitutions[0];

    const allowed =
      authorizeContextPermission(ctx, 'payments.reconcile', { unitId: targetUnit }).allowed ||
      authorizeContextPermission(ctx, 'services.manage', { unitId: targetUnit, department: 'licensing' }).allowed;
    if (!allowed) {
      res.status(403).json({ error: 'Forbidden: insufficient authority to issue trade license' });
      return;
    }
    if (!b.business_name_bn || !b.owner_name_bn) {
      res.status(400).json({ error: 'business_name_bn and owner_name_bn required' });
      return;
    }
    const now = new Date();
    const nextYear = new Date(now.getTime() + 365 * 86400_000);
    const record: TradeLicenseRecord = {
      id: `tl_${crypto.randomUUID().slice(0, 8)}`,
      license_no: sanitizeText(b.license_no || `TL-2026-${crypto.randomInt(1000, 9999)}`, 40),
      administrative_unit_id: targetUnit,
      business_name_bn: sanitizeText(b.business_name_bn, 160),
      owner_name_bn: sanitizeText(b.owner_name_bn, 120),
      business_type: sanitizeText(b.business_type || 'সাধারণ ব্যবসা ও স্টোর', 80),
      ward_no: Number(b.ward_no) || 1,
      address_bn: sanitizeText(b.address_bn || 'বাজার এলাকা', 160),
      fee_amount: Number(b.fee_amount) || 500,
      issue_date: now.toISOString().slice(0, 10),
      expiry_date: nextYear.toISOString().slice(0, 10),
      status: 'active',
    };
    store.upsertTradeLicense(record);
    res.status(201).json(record);
  });

  app.post('/api/trade-licenses/:id/renew', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const record = store.getTradeLicenseById(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Trade license not found' });
      return;
    }
    const allowed =
      authorizeContextPermission(ctx, 'payments.reconcile', { unitId: record.administrative_unit_id }).allowed ||
      authorizeContextPermission(ctx, 'services.manage', { unitId: record.administrative_unit_id, department: 'licensing' }).allowed;
    if (!allowed) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const baseDate = new Date(record.expiry_date).getTime() > Date.now() ? new Date(record.expiry_date) : new Date();
    const renewedUntil = new Date(baseDate.getTime() + 365 * 86400_000).toISOString().slice(0, 10);
    const updated: TradeLicenseRecord = {
      ...record,
      expiry_date: renewedUntil,
      status: 'active',
    };
    store.upsertTradeLicense(updated);
    res.json(updated);
  });

  app.get('/api/notices', (req: Request, res: Response) => {
    const unitId = typeof req.query.unit_id === 'string' ? req.query.unit_id : undefined;
    res.json(store.getNotices(unitId));
  });

  app.post('/api/notices', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const b = req.body || {};
    const targetUnit = b.administrative_unit_id
      ? String(b.administrative_unit_id)
      : hasBroadUnitScope(ctx, 'notices.manage')
        ? undefined
        : ctx.assignedInstitutions[0];

    const check = authorizeContextPermission(ctx, 'notices.manage', { unitId: targetUnit });
    if (!check.allowed) {
      res.status(403).json({
        error: check.reason || 'Forbidden: notice management permission denied',
        message_bn: check.reasonBn || 'নোটিশ প্রকাশের অনুমতি আপনার নেই।',
      });
      return;
    }
    if (!b.title_bn || !b.content_bn) {
      res.status(400).json({ error: 'title_bn and content_bn required' });
      return;
    }
    const notice: Notice = {
      id: `ntc_${crypto.randomUUID().slice(0, 8)}`,
      administrative_unit_id: targetUnit,
      title_bn: sanitizeText(b.title_bn, 200),
      title_en: sanitizeText(b.title_en || b.title_bn, 200),
      category: sanitizeText(b.category || 'সাধারণ বিজ্ঞপ্তি', 80),
      published_at: new Date().toISOString().slice(0, 10),
      content_bn: sanitizeText(b.content_bn, 1200),
      is_pinned: Boolean(b.is_pinned),
    };
    store.upsertNotice(notice);
    res.status(201).json(notice);
  });

  app.delete('/api/notices/:id', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const existing = store.getNotices().find((n) => n.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Notice not found' });
      return;
    }
    const check = authorizeContextPermission(ctx, 'notices.manage', {
      unitId: existing.administrative_unit_id,
    });
    if (!check.allowed) {
      res.status(403).json({ error: check.reason || 'Forbidden' });
      return;
    }
    store.deleteNotice(req.params.id);
    res.json({ success: true });
  });

  // --- Staff, Wards/Departments, Role Permissions & System Settings ---
  app.get('/api/staff', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const requestedUnit = typeof req.query.unit_id === 'string' && req.query.unit_id !== 'all'
      ? req.query.unit_id
      : undefined;

    const canView =
      authorizeContextPermission(ctx, 'employees.view', { unitId: requestedUnit }).allowed ||
      authorizeContextPermission(ctx, 'applications.assign', { unitId: requestedUnit }).allowed;
    if (!canView) {
      res.status(403).json({ error: 'Forbidden: staff view denied' });
      return;
    }
    const isBroad = hasBroadUnitScope(ctx, 'employees.view') || hasBroadUnitScope(ctx, 'applications.assign');
    const scope = isBroad ? requestedUnit : ctx.assignedInstitutions[0];
    res.json(store.getStaffMembers(scope));
  });

  app.post('/api/staff', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const b = req.body || {};
    const targetUnit = hasBroadUnitScope(ctx, 'employees.manage')
      ? b.administrative_unit_id || 'unit_goyeshpur'
      : ctx.assignedInstitutions[0];

    const check = authorizeContextPermission(ctx, 'employees.manage', { unitId: targetUnit });
    if (!check.allowed) {
      res.status(403).json({ error: check.reason || 'Forbidden: employee management denied' });
      return;
    }
    if (!b.name_bn || !b.designation_bn) {
      res.status(400).json({ error: 'name_bn and designation_bn required' });
      return;
    }
    const staff: StaffMember = {
      id: `stf_${crypto.randomUUID().slice(0, 8)}`,
      administrative_unit_id: targetUnit,
      name_bn: sanitizeText(b.name_bn, 120),
      designation_bn: sanitizeText(b.designation_bn, 120),
      role: (b.role || 'secretary') as UserRole,
      employee_code: sanitizeText(b.employee_code || `emp.${crypto.randomInt(100, 999)}`, 40),
      mobile: sanitizeText(b.mobile || '01700-000000', 30),
      ward_or_dept_bn: sanitizeText(b.ward_or_dept_bn || 'সাধারণ শাখা', 120),
      status: 'active',
      created_at: new Date().toISOString(),
    };
    store.upsertStaffMember(staff);
    res.status(201).json(staff);
  });

  app.patch('/api/staff/:id', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const existing = store.getStaffById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Staff member not found' });
      return;
    }
    const check = authorizeContextPermission(ctx, 'employees.manage', {
      unitId: existing.administrative_unit_id,
    });
    if (!check.allowed) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const b = req.body || {};
    const updated: StaffMember = {
      ...existing,
      name_bn: b.name_bn ? sanitizeText(b.name_bn, 120) : existing.name_bn,
      designation_bn: b.designation_bn ? sanitizeText(b.designation_bn, 120) : existing.designation_bn,
      mobile: b.mobile ? sanitizeText(b.mobile, 30) : existing.mobile,
      status: b.status === 'inactive' || b.status === 'active' ? b.status : existing.status,
    };
    store.upsertStaffMember(updated);
    res.json(updated);
  });

  app.get('/api/wards-departments', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const requestedUnit = typeof req.query.unit_id === 'string' && req.query.unit_id !== 'all'
      ? req.query.unit_id
      : undefined;

    const allowed =
      authorizeContextPermission(ctx, 'employees.view', { unitId: requestedUnit }).allowed ||
      authorizeContextPermission(ctx, 'services.view', { unitId: requestedUnit }).allowed ||
      authorizeContextPermission(ctx, 'dashboard.view', { unitId: requestedUnit }).allowed;
    if (!allowed) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const isBroad = hasBroadUnitScope(ctx, 'employees.view') || hasBroadUnitScope(ctx, 'dashboard.view');
    const scope = isBroad ? requestedUnit : ctx.assignedInstitutions[0];
    const kind = req.query.kind === 'ward' || req.query.kind === 'department' ? req.query.kind : undefined;
    res.json(store.getWardsAndDepartments(scope, kind));
  });

  app.post('/api/wards-departments', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const b = req.body || {};
    const targetUnit = hasBroadUnitScope(ctx, 'employees.assign_department') || hasBroadUnitScope(ctx, 'employees.manage')
      ? b.administrative_unit_id || 'unit_goyeshpur'
      : ctx.assignedInstitutions[0];

    const allowed =
      authorizeContextPermission(ctx, 'employees.assign_department', { unitId: targetUnit }).allowed ||
      authorizeContextPermission(ctx, 'employees.manage', { unitId: targetUnit }).allowed;
    if (!allowed) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    if (!b.name_bn || !b.head_name_bn) {
      res.status(400).json({ error: 'name_bn and head_name_bn required' });
      return;
    }
    const item: WardOrDepartment = {
      id: `wd_${crypto.randomUUID().slice(0, 8)}`,
      administrative_unit_id: targetUnit,
      kind: b.kind === 'department' ? 'department' : 'ward',
      code_or_no: sanitizeText(b.code_or_no || 'NEW-01', 20),
      name_bn: sanitizeText(b.name_bn, 120),
      head_name_bn: sanitizeText(b.head_name_bn, 120),
      head_mobile: sanitizeText(b.head_mobile || '01700-000000', 30),
      households_or_staff_count: Number(b.households_or_staff_count) || 0,
      status: 'active',
    };
    store.upsertWardOrDepartment(item);
    res.status(201).json(item);
  });

  app.get('/api/role-permissions', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    if (!ctx.effectivePermissions.has('roles.manage') && !ctx.effectivePermissions.has('settings.view')) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    res.json(store.getRolePermissions());
  });

  app.patch('/api/role-permissions/:role', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const check = authorizeContextPermission(ctx, 'roles.manage');
    if (!check.allowed || check.scope !== 'global') {
      res.status(403).json({
        error: 'Forbidden: Super Admin required',
        message_bn: 'রোল পারমিশন পরিবর্তনের অনুমতি কেবল সুপার অ্যাডমিনের।',
      });
      return;
    }
    const existing = store.getRolePermissions().find((p) => p.role === req.params.role);
    if (!existing) {
      res.status(404).json({ error: 'Role permission not found' });
      return;
    }
    const updated: RolePermissionEntry = {
      ...existing,
      ...(req.body || {}),
      role: existing.role,
    };
    store.updateRolePermission(updated);
    res.json(updated);
  });

  app.get('/api/system-settings', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    if (!ctx.effectivePermissions.has('settings.view')) {
      res.status(403).json({ error: 'Forbidden: settings view permission required' });
      return;
    }
    res.json(store.getSystemSettings());
  });

  app.patch('/api/system-settings', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const check = authorizeContextPermission(ctx, 'settings.manage');
    if (!check.allowed || check.scope !== 'global') {
      res.status(403).json({
        error: 'Forbidden: Super Admin required for global system settings',
        message_bn: 'কেন্দ্রীয় সিস্টেম সেটিংস পরিবর্তনের অনুমতি কেবল সুপার অ্যাডমিনের।',
      });
      return;
    }
    const current = store.getSystemSettings();
    const b = req.body || {};
    const updated = {
      ...current,
      platform_name_bn: b.platform_name_bn ? sanitizeText(b.platform_name_bn, 200) : current.platform_name_bn,
      support_phone: b.support_phone ? sanitizeText(b.support_phone, 40) : current.support_phone,
      support_email: b.support_email ? sanitizeText(b.support_email, 120) : current.support_email,
      allow_online_applications:
        typeof b.allow_online_applications === 'boolean'
          ? b.allow_online_applications
          : current.allow_online_applications,
      require_2fa_for_officers:
        typeof b.require_2fa_for_officers === 'boolean'
          ? b.require_2fa_for_officers
          : current.require_2fa_for_officers,
      auto_sms_notifications:
        typeof b.auto_sms_notifications === 'boolean'
          ? b.auto_sms_notifications
          : current.auto_sms_notifications,
      updated_at: new Date().toISOString(),
    };
    store.updateSystemSettings(updated);
    res.json(updated);
  });

  // --- Granular RBAC Management APIs (/api/rbac/*) ---
  app.get('/api/rbac/roles', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const ok =
      ctx.effectivePermissions.has('roles.manage') ||
      ctx.effectivePermissions.has('users.view') ||
      ctx.effectivePermissions.has('employees.view') ||
      ctx.effectivePermissions.has('settings.view');
    if (!ok) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    res.json(listAllRoles());
  });

  app.post('/api/rbac/roles', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    if (!authorizeContextPermission(ctx, 'roles.manage').allowed) {
      res.status(403).json({
        error: 'Forbidden: roles.manage permission required',
        message_bn: 'নতুন রোল তৈরির অনুমতি কেবল অনুমোদিত প্রশাসকের।',
      });
      return;
    }
    try {
      const b = req.body || {};
      const role = createCustomRoleTransactional({
        actorCtx: ctx,
        slug: String(b.slug || ''),
        nameEn: sanitizeText(b.name_en || b.slug, 100),
        nameBn: sanitizeText(b.name_bn || b.name_en, 120),
        category: (b.category || 'custom') as RoleCategory,
        institutionType: b.institution_type || null,
        defaultScope: (b.default_scope || 'institution') as PermissionScope,
        descriptionBn: sanitizeText(b.description_bn || '', 400),
        assignments: Array.isArray(b.assignments) ? b.assignments : [],
      });
      res.status(201).json(role);
    } catch (err) {
      handleRbacError(res, err, 'Failed to create role');
    }
  });

  app.patch('/api/rbac/roles/:slug', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    if (!authorizeContextPermission(ctx, 'roles.manage').allowed) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    try {
      const updated = setRoleActiveStatusTransactional({
        actorCtx: ctx,
        roleSlug: req.params.slug,
        isActive: Boolean(req.body?.is_active),
      });
      res.json(updated);
    } catch (err) {
      handleRbacError(res, err, 'Failed to update role status');
    }
  });

  app.get('/api/rbac/permissions', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    if (!ctx.effectivePermissions.has('roles.manage') && !ctx.effectivePermissions.has('settings.view')) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    res.json(listAllPermissions());
  });

  app.get('/api/rbac/roles/:slug/permissions', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    if (!ctx.effectivePermissions.has('roles.manage') && !ctx.effectivePermissions.has('settings.view')) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    res.json(getRolePermissionsV2(req.params.slug));
  });

  app.put('/api/rbac/roles/:slug/permissions', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    if (!authorizeContextPermission(ctx, 'roles.manage').allowed) {
      res.status(403).json({
        error: 'Forbidden: roles.manage permission required',
        message_bn: 'রোলের পারমিশন পরিবর্তনের অনুমতি আপনার নেই।',
      });
      return;
    }
    try {
      const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
      const updated = updateRolePermissionsTransactional({
        actorCtx: ctx,
        roleSlug: req.params.slug,
        assignments,
        reasonBn: sanitizeText(req.body?.reason_bn || '', 300),
      });
      res.json(updated);
    } catch (err) {
      handleRbacError(res, err, 'Failed to update role permissions');
    }
  });

  app.get('/api/rbac/compare', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    if (!ctx.effectivePermissions.has('roles.manage') && !ctx.effectivePermissions.has('settings.view')) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const roleA = String(req.query.roleA || '');
    const roleB = String(req.query.roleB || '');
    const permsA = getRolePermissionsV2(roleA);
    const permsB = getRolePermissionsV2(roleB);
    res.json({
      roleA,
      roleB,
      permissionsA: permsA,
      permissionsB: permsB,
    });
  });

  app.get('/api/rbac/users', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const requestedUnit = typeof req.query.unit_id === 'string' && req.query.unit_id !== 'all'
      ? req.query.unit_id
      : undefined;

    const canView =
      authorizeContextPermission(ctx, 'users.view', { unitId: requestedUnit }).allowed ||
      authorizeContextPermission(ctx, 'employees.view', { unitId: requestedUnit }).allowed;
    if (!canView) {
      res.status(403).json({ error: 'Forbidden: user directory permission denied' });
      return;
    }
    const isBroad = hasBroadUnitScope(ctx, 'users.view') || hasBroadUnitScope(ctx, 'employees.view');
    const unitScope = isBroad ? requestedUnit : ctx.assignedInstitutions[0];
    res.json(listUsersWithAssignments(unitScope));
  });

  app.post('/api/rbac/users', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const b = req.body || {};
    const targetUnit = hasBroadUnitScope(ctx, 'users.create')
      ? b.administrative_unit_id || null
      : ctx.assignedInstitutions[0];

    if (!authorizeContextPermission(ctx, 'users.create', { unitId: targetUnit || undefined }).allowed) {
      res.status(403).json({ error: 'Forbidden: user creation permission denied' });
      return;
    }
    try {
      const created = createUserAccountTransactional({
        actorCtx: ctx,
        username: String(b.username || ''),
        password: String(b.password || ''),
        nameBn: sanitizeText(b.name_bn, 120),
        titleBn: sanitizeText(b.title_bn, 120),
        mobile: sanitizeText(b.mobile || '01700-000000', 30),
        email: b.email ? sanitizeText(b.email, 120) : undefined,
        primaryRole: String(b.primary_role || 'union_service_operator'),
        administrativeUnitId: targetUnit,
        wardNos: Array.isArray(b.ward_nos) ? b.ward_nos.map(Number) : undefined,
        departments: Array.isArray(b.departments) ? b.departments.map(String) : undefined,
        mfaEnabled: b.mfa_enabled,
      });
      res.status(201).json(created);
    } catch (err) {
      handleRbacError(res, err, 'Failed to create user');
    }
  });

  app.patch('/api/rbac/users/:id/status', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const wantActive = Boolean(req.body?.is_active);
    const neededKey: PermissionKey = wantActive ? 'users.activate' : 'users.deactivate';
    if (!authorizeContextPermission(ctx, neededKey).allowed) {
      res.status(403).json({ error: `Forbidden: ${neededKey} permission required` });
      return;
    }
    try {
      const updated = setUserActiveStatusTransactional({
        actorCtx: ctx,
        targetUserId: req.params.id,
        isActive: wantActive,
      });
      res.json(updated);
    } catch (err) {
      handleRbacError(res, err, 'Failed to toggle user status');
    }
  });

  app.post('/api/rbac/users/:id/reset-password', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    if (!authorizeContextPermission(ctx, 'users.reset_password').allowed) {
      res.status(403).json({ error: 'Forbidden: users.reset_password required' });
      return;
    }
    try {
      adminResetUserPasswordTransactional({
        actorCtx: ctx,
        targetUserId: req.params.id,
        newPassword: String(req.body?.new_password || ''),
      });
      res.json({ success: true });
    } catch (err) {
      handleRbacError(res, err, 'Failed to reset user password');
    }
  });

  app.post('/api/rbac/users/:id/roles', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const targetUserId = req.params.id;
    // Note: prevent self-elevation explicitly even before permission check or within permission check
    if (targetUserId === ctx.user.id) {
      res.status(403).json({
        error: 'Forbidden: users cannot elevate or assign roles to themselves',
        message_bn: 'নিরাপত্তা নীতির কারণে নিজেই নিজের রোল বা ক্ষমতা বৃদ্ধি করা নিষিদ্ধ।',
      });
      return;
    }
    if (!authorizeContextPermission(ctx, 'users.assign_role', { unitId: req.body?.administrative_unit_id }).allowed) {
      res.status(403).json({
        error: 'Forbidden: users.assign_role permission required',
        message_bn: 'রোল বরাদ্দ করার অনুমতি আপনার নেই।',
      });
      return;
    }
    try {
      const b = req.body || {};
      const assigned = assignUserRoleAndScopeTransactional({
        actorCtx: ctx,
        targetUserId,
        roleSlug: String(b.role_slug || ''),
        administrativeUnitId: b.administrative_unit_id || null,
        wardNos: Array.isArray(b.ward_nos) ? b.ward_nos.map(Number) : undefined,
        departments: Array.isArray(b.departments) ? b.departments.map(String) : undefined,
        expiresAt: b.expires_at || null,
        reasonBn: sanitizeText(b.reason_bn || '', 300),
      });
      res.status(201).json(assigned);
    } catch (err) {
      handleRbacError(res, err, 'Failed to assign user role');
    }
  });

  app.delete('/api/rbac/users/:id/roles/:assignmentId', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    if (!authorizeContextPermission(ctx, 'users.assign_role').allowed) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    try {
      revokeUserRoleTransactional({
        actorCtx: ctx,
        targetUserId: req.params.id,
        assignmentId: req.params.assignmentId,
      });
      res.json({ success: true });
    } catch (err) {
      handleRbacError(res, err, 'Failed to revoke user role');
    }
  });

  app.post('/api/rbac/users/:id/overrides', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const targetUserId = req.params.id;
    if (targetUserId === ctx.user.id && req.body?.effect === 'grant') {
      res.status(403).json({
        error: 'Forbidden: users cannot grant themselves additional permissions',
        message_bn: 'নিজের একাউন্টে অতিরিক্ত পারমিশন যোগ করা নিষিদ্ধ।',
      });
      return;
    }
    const allowed =
      authorizeContextPermission(ctx, 'roles.manage').allowed ||
      authorizeContextPermission(ctx, 'users.assign_role').allowed;
    if (!allowed) {
      res.status(403).json({ error: 'Forbidden: permission override authority required' });
      return;
    }
    try {
      const b = req.body || {};
      const ov = createUserPermissionOverrideTransactional({
        actorCtx: ctx,
        targetUserId,
        permissionKey: String(b.permission_key) as PermissionKey,
        scope: (b.scope || 'institution') as PermissionScope,
        effect: b.effect === 'revoke' ? 'revoke' : 'grant',
        expiresAt: b.expires_at || null,
        reasonBn: sanitizeText(b.reason_bn || '', 300),
      });
      res.status(201).json(ov);
    } catch (err) {
      handleRbacError(res, err, 'Failed to create permission override');
    }
  });

  app.delete('/api/rbac/users/:id/overrides/:overrideId', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const allowed =
      authorizeContextPermission(ctx, 'roles.manage').allowed ||
      authorizeContextPermission(ctx, 'users.assign_role').allowed;
    if (!allowed) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    try {
      revokeUserOverrideTransactional({
        actorCtx: ctx,
        targetUserId: req.params.id,
        overrideId: req.params.overrideId,
      });
      res.json({ success: true });
    } catch (err) {
      handleRbacError(res, err, 'Failed to revoke override');
    }
  });

  app.get('/api/rbac/approval-authorities', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const requestedUnit = typeof req.query.unit_id === 'string' && req.query.unit_id !== 'all'
      ? req.query.unit_id
      : undefined;
    const allowed =
      ctx.effectivePermissions.has('roles.manage') ||
      ctx.effectivePermissions.has('settings.view') ||
      ctx.effectivePermissions.has('employees.view');
    if (!allowed) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const isBroad = hasBroadUnitScope(ctx, 'roles.manage') || hasBroadUnitScope(ctx, 'settings.view');
    const unitScope = isBroad ? requestedUnit : ctx.assignedInstitutions[0];
    res.json(listApprovalAuthorities(unitScope));
  });

  app.post('/api/rbac/approval-authorities', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    if (!authorizeContextPermission(ctx, 'roles.manage').allowed) {
      res.status(403).json({
        error: 'Forbidden: roles.manage permission required to delegate approval authority',
        message_bn: 'সনদ অনুমোদন ক্ষমতা অর্পণের অনুমতি কেবল সুপার অ্যাডমিনের।',
      });
      return;
    }
    try {
      const b = req.body || {};
      const item = grantApprovalAuthorityTransactional({
        actorCtx: ctx,
        userId: String(b.user_id || ''),
        roleSlug: String(b.role_slug || ''),
        administrativeUnitId: String(b.administrative_unit_id || ''),
        serviceId: String(b.service_id || ''),
        maxFeeLimit: typeof b.max_fee_limit === 'number' ? b.max_fee_limit : null,
        effectiveFrom: b.effective_from || undefined,
        expiresAt: b.expires_at || null,
        delegationNoteBn: sanitizeText(b.delegation_note_bn || '', 300),
        allowSelfApproval: Boolean(b.allow_self_approval),
      });
      res.status(201).json(item);
    } catch (err) {
      handleRbacError(res, err, 'Failed to grant approval authority');
    }
  });

  app.delete('/api/rbac/approval-authorities/:id', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    if (!authorizeContextPermission(ctx, 'roles.manage').allowed) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    try {
      revokeApprovalAuthorityTransactional({
        actorCtx: ctx,
        authorityId: req.params.id,
      });
      res.json({ success: true });
    } catch (err) {
      handleRbacError(res, err, 'Failed to revoke approval authority');
    }
  });

  app.get('/api/rbac/audit-logs', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const requestedUnit = typeof req.query.unit_id === 'string' && req.query.unit_id !== 'all'
      ? req.query.unit_id
      : undefined;
    const check = authorizeContextPermission(ctx, 'audit_logs.view', { unitId: requestedUnit });
    if (!check.allowed) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const unitScope = hasBroadUnitScope(ctx, 'audit_logs.view') ? requestedUnit : ctx.assignedInstitutions[0];
    res.json(listPermissionAuditLogs(unitScope));
  });

  // --- Upazila Monitoring Observations ---
  app.get('/api/monitoring/observations', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const requestedUnit = typeof req.query.unit_id === 'string' && req.query.unit_id !== 'all'
      ? req.query.unit_id
      : undefined;
    const canView =
      authorizeContextPermission(ctx, 'monitoring.observe', { unitId: requestedUnit }).allowed ||
      authorizeContextPermission(ctx, 'audit_logs.view', { unitId: requestedUnit }).allowed;
    if (!canView) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const unitScope = hasBroadUnitScope(ctx, 'monitoring.observe') || hasBroadUnitScope(ctx, 'audit_logs.view')
      ? requestedUnit
      : ctx.assignedInstitutions[0];
    res.json(listMonitoringObservations(unitScope));
  });

  app.post('/api/monitoring/observations', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const b = req.body || {};
    const targetUnit = String(b.administrative_unit_id || '');
    if (!targetUnit || !b.observation_bn) {
      res.status(400).json({ error: 'administrative_unit_id and observation_bn required' });
      return;
    }
    const check = authorizeContextPermission(ctx, 'monitoring.observe', { unitId: targetUnit });
    if (!check.allowed) {
      res.status(403).json({ error: check.reason || 'Forbidden: monitoring.observe required' });
      return;
    }
    const obs: MonitoringObservation = {
      id: `obs_${crypto.randomUUID().slice(0, 8)}`,
      administrative_unit_id: targetUnit,
      application_id: b.application_id ? String(b.application_id) : null,
      officer_id: ctx.user.id,
      officer_name_bn: ctx.user.name_bn,
      observation_bn: sanitizeText(b.observation_bn, 800),
      severity: ['info', 'warning', 'critical', 'overdue'].includes(b.severity) ? b.severity : 'info',
      created_at: new Date().toISOString(),
    };
    insertMonitoringObservation(obs);
    res.status(201).json(obs);
  });

  // --- Refund Requests Workflow ---
  app.get('/api/payments/refund-requests', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const requestedUnit = typeof req.query.unit_id === 'string' && req.query.unit_id !== 'all'
      ? req.query.unit_id
      : undefined;
    const allowed =
      authorizeContextPermission(ctx, 'payments.view_reports', { unitId: requestedUnit }).allowed ||
      authorizeContextPermission(ctx, 'payments.request_refund', { unitId: requestedUnit }).allowed ||
      authorizeContextPermission(ctx, 'payments.approve_refund', { unitId: requestedUnit }).allowed;
    if (!allowed) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const isBroad = hasBroadUnitScope(ctx, 'payments.view_reports') || hasBroadUnitScope(ctx, 'payments.approve_refund');
    const unitScope = isBroad ? requestedUnit : ctx.assignedInstitutions[0];
    res.json(listRefundRequests(unitScope));
  });

  app.post('/api/payments/refund-requests', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const b = req.body || {};
    const appRecord = store.getApplicationByIdOrTracking(String(b.application_id || ''));
    if (!appRecord) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }
    const check = authorizeContextPermission(ctx, 'payments.request_refund', {
      unitId: appRecord.administrative_unit_id,
    });
    if (!check.allowed) {
      res.status(403).json({ error: check.reason || 'Forbidden: refund request permission required' });
      return;
    }
    const rr: RefundRequest = {
      id: `rr_${crypto.randomUUID().slice(0, 8)}`,
      application_id: appRecord.id,
      administrative_unit_id: appRecord.administrative_unit_id,
      amount: Number(b.amount) || appRecord.fee_amount,
      reason_bn: sanitizeText(b.reason_bn || 'ভুল বা অতিরিক্ত ফি পরিশোধের কারণে রিফান্ড অনুরোধ', 400),
      requested_by: ctx.user.id,
      requested_by_name_bn: ctx.user.name_bn,
      status: 'pending',
      reviewed_by: null,
      reviewed_at: null,
      created_at: new Date().toISOString(),
    };
    upsertRefundRequest(rr);
    res.status(201).json(rr);
  });

  app.post('/api/payments/refund-requests/:id/decision', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const rr = listRefundRequests().find((r) => r.id === req.params.id);
    if (!rr) {
      res.status(404).json({ error: 'Refund request not found' });
      return;
    }
    const check = authorizeContextPermission(ctx, 'payments.approve_refund', {
      unitId: rr.administrative_unit_id,
    });
    if (!check.allowed) {
      res.status(403).json({ error: check.reason || 'Forbidden: refund approval permission required' });
      return;
    }
    const decision = req.body?.decision === 'rejected' ? 'rejected' : 'approved';
    const nowIso = new Date().toISOString();
    const updated: RefundRequest = {
      ...rr,
      status: decision,
      reviewed_by: ctx.user.id,
      reviewed_at: nowIso,
    };
    upsertRefundRequest(updated);
    if (decision === 'approved') {
      const appRecord = store.getApplicationByIdOrTracking(rr.application_id);
      if (appRecord) {
        store.upsertApplication({
          ...appRecord,
          payment_status: 'refunded',
          status: 'refunded',
          updated_at: nowIso,
          review_notes: [
            ...(appRecord.review_notes || []),
            `রিফান্ড অনুমোদিত (${ctx.user.name_bn}): ৳${rr.amount}`,
          ],
        });
      }
    }
    res.json(updated);
  });

  // --- System Backup Export (Super Admin Only) ---
  app.get('/api/backups/export', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const check = authorizeContextPermission(ctx, 'backups.manage');
    if (!check.allowed || check.scope !== 'global') {
      res.status(403).json({
        error: 'Forbidden: system backup permission required',
        message_bn: 'সিস্টেম ব্যাকআপ নেওয়ার অনুমতি কেবল সুপার অ্যাডমিনের।',
      });
      return;
    }

    appendPermissionAuditLog({
      actorId: ctx.user.id,
      actorRole: ctx.user.primary_role,
      actorNameBn: ctx.user.name_bn,
      actionType: 'system_backup_exported',
      targetType: 'system',
      targetId: 'pottoyonbd_full_snapshot',
      reasonBn: 'সুপার অ্যাডমিন কর্তৃক পূর্ণাঙ্গ সিস্টেম ব্যাকআপ ডাউনলোড',
    });

    const snapshot = {
      exported_at: new Date().toISOString(),
      exported_by: ctx.user.username,
      institutions_count: store.getInstitutions().length,
      services_count: store.getServices().length,
      applications_count: store.getApplications().length,
      certificates_count: store.getCertificates().length,
      roles: listAllRoles(),
      permission_audit_logs: listPermissionAuditLogs(),
      system_settings: store.getSystemSettings(),
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="PottoyonBD_Backup_${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.send(JSON.stringify(snapshot, null, 2));
  });

  // --- Contact Inquiries ---
  app.post('/api/contact', (req: Request, res: Response) => {
    const b = req.body || {};
    if (!b.name || !b.phone || !b.message) {
      res.status(400).json({ error: 'name, phone, and message are required' });
      return;
    }
    const inquiry = {
      id: `inq_${crypto.randomUUID().slice(0, 8)}`,
      name: sanitizeText(b.name, 120),
      phone: sanitizeText(b.phone, 40),
      subject: sanitizeText(b.subject || 'সাধারণ জিজ্ঞাসা', 160),
      message: sanitizeText(b.message, 1500),
      status: 'new' as const,
      created_at: new Date().toISOString(),
    };
    store.insertContactInquiry(inquiry);
    res.status(201).json(inquiry);
  });

  app.get('/api/contact', requireOfficerMiddleware, (req: AuthedRequest, res: Response) => {
    const ctx = req.rbacContext!;
    const ok = hasBroadUnitScope(ctx, 'dashboard.view');
    if (!ok) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    res.json(store.getContactInquiries());
  });

  // --- Reset DB ---
  app.post('/api/reset', async (_req: Request, res: Response) => {
    store.resetDatabase();
    await store.ensureSeedCertificateAsset();
    resetVerifyRateLimiter();
    res.json({ success: true, message: 'Database reset to initial seeds' });
  });

  return app;
}
