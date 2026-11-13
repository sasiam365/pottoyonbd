import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { INITIAL_INSTITUTIONS } from '../src/data/seedData.ts';
import type { PermissionKey, PermissionScope, UserRole, UserSession } from '../src/types/index.ts';
import { getDb } from './db.ts';
import {
  authorizeContextPermission,
  resolveActorRbacContext,
  type ActorRbacContext,
  type AuthorizationTarget,
} from './rbacService.ts';

export interface AuthenticatedActor {
  id: string;
  role: UserRole;
  name_bn: string;
  title_bn: string;
  administrative_unit_id?: string;
  employee_id: string;
  issued_at: number;
  exp: number;
}

const SESSION_SECRET =
  process.env.POTTOYON_SESSION_SECRET ||
  crypto.createHash('sha256').update('pottoyonbd-pabna-sadar-runtime-secret-v1').digest('hex');

export const OFFICER_REVIEW_ROLES: ReadonlySet<UserRole> = new Set([
  'super_admin',
  'upazila_admin',
  'upazila_monitoring_officer',
  'union_admin',
  'chairman',
  'secretary',
  'ward_member',
  'union_accountant',
  'union_service_operator',
  'municipality_admin',
  'mayor',
  'executive_officer',
  'department_officer',
  'municipality_accountant',
  'municipality_service_operator',
]);

export const CROSS_UNIT_ROLES: ReadonlySet<UserRole> = new Set([
  'super_admin',
  'upazila_admin',
  'upazila_monitoring_officer',
]);

export const MUNICIPALITY_ROLES: ReadonlySet<UserRole> = new Set([
  'municipality_admin',
  'mayor',
  'executive_officer',
  'department_officer',
  'municipality_accountant',
  'municipality_service_operator',
]);

export function isOfficerRole(role: UserRole): boolean {
  return OFFICER_REVIEW_ROLES.has(role);
}

export function canGrantFinalApproval(role: UserRole, userId?: string): boolean {
  if (userId) {
    const ctx = resolveActorRbacContext(userId);
    if (ctx) {
      return (
        ctx.effectivePermissions.has('applications.approve') ||
        ctx.effectivePermissions.has('certificates.issue')
      );
    }
  }
  return (
    role === 'union_admin' ||
    role === 'chairman' ||
    role === 'municipality_admin' ||
    role === 'mayor'
  );
}

export function canAccessUnit(
  actor: AuthenticatedActor,
  unitId: string,
  rbacCtx?: ActorRbacContext | null
): boolean {
  const ctx = rbacCtx || resolveActorRbacContext(actor.id);
  if (ctx) {
    const dashScope = ctx.effectivePermissions.get('dashboard.view');
    const appScope = ctx.effectivePermissions.get('applications.view');
    if (dashScope === 'global' || dashScope === 'upazila' || appScope === 'global' || appScope === 'upazila') {
      return true;
    }
    return ctx.assignedInstitutions.includes(unitId);
  }
  if (CROSS_UNIT_ROLES.has(actor.role)) {
    return true;
  }
  return Boolean(actor.administrative_unit_id && actor.administrative_unit_id === unitId);
}

/**
 * Authoritative server-side user/officer resolver backed by the `users` table
 * across all 16 roles, 10 Union Parishads, Pabna Municipality, and Upazila Administration.
 */
export function resolveAuthoritativeOfficer(
  role: UserRole,
  requestedUnitId?: string,
  usernameOrWard?: string
): Omit<AuthenticatedActor, 'issued_at' | 'exp'> | null {
  const db = getDb().db;

  // Validate institution separation strictly: Municipality roles NEVER bind to a Union Parishad & vice versa
  if (MUNICIPALITY_ROLES.has(role)) {
    if (requestedUnitId && requestedUnitId !== 'unit_pabna_muni') {
      return null;
    }
    const unitId = 'unit_pabna_muni';
    const row = db
      .prepare('SELECT * FROM users WHERE primary_role = ? AND administrative_unit_id = ? AND is_active = 1 LIMIT 1')
      .get(role, unitId) as Record<string, unknown> | undefined;
    if (row) {
      return {
        id: String(row.id),
        role,
        name_bn: String(row.name_bn),
        title_bn: String(row.title_bn),
        administrative_unit_id: unitId,
        employee_id: String(row.username),
      };
    }
  }

  if (role === 'citizen') {
    const cleanUser = usernameOrWard?.trim().toLowerCase();
    const row = (cleanUser
      ? db.prepare('SELECT * FROM users WHERE LOWER(username) = ? AND primary_role = ? AND is_active = 1').get(cleanUser, 'citizen')
      : db.prepare("SELECT * FROM users WHERE id = 'usr_citizen_portal' AND is_active = 1").get()) as
      | Record<string, unknown>
      | undefined;
    if (row) {
      return {
        id: String(row.id),
        role: 'citizen',
        name_bn: String(row.name_bn),
        title_bn: String(row.title_bn),
        employee_id: String(row.username),
      };
    }
    return {
      id: 'usr_citizen_portal',
      role: 'citizen',
      name_bn: 'সাধারণ নাগরিক',
      title_bn: 'নাগরিক সেবা ব্যবহারকারী',
      employee_id: 'citizen',
    };
  }

  if (role === 'super_admin' || role === 'upazila_admin' || role === 'upazila_monitoring_officer') {
    const row = db
      .prepare('SELECT * FROM users WHERE primary_role = ? AND is_active = 1 LIMIT 1')
      .get(role) as Record<string, unknown> | undefined;
    if (row) {
      return {
        id: String(row.id),
        role,
        name_bn: String(row.name_bn),
        title_bn: String(row.title_bn),
        employee_id: String(row.username),
      };
    }
  }

  // Union Parishad roles must map strictly to one of the 10 Union Parishads
  const targetUnitId = requestedUnitId || 'unit_goyeshpur';
  const unit = INITIAL_INSTITUTIONS.find(
    (i) => i.id === targetUnitId && i.type === 'union_parishad'
  );
  if (!unit) return null;

  if (role === 'ward_member' && usernameOrWard) {
    const byUsername = db
      .prepare('SELECT * FROM users WHERE LOWER(username) = ? AND administrative_unit_id = ? AND is_active = 1')
      .get(usernameOrWard.trim().toLowerCase(), unit.id) as Record<string, unknown> | undefined;
    if (byUsername) {
      return {
        id: String(byUsername.id),
        role: 'ward_member',
        name_bn: String(byUsername.name_bn),
        title_bn: String(byUsername.title_bn),
        administrative_unit_id: unit.id,
        employee_id: String(byUsername.username),
      };
    }
  }

  const row = db
    .prepare('SELECT * FROM users WHERE primary_role = ? AND administrative_unit_id = ? AND is_active = 1 LIMIT 1')
    .get(role, unit.id) as Record<string, unknown> | undefined;
  if (row) {
    return {
      id: String(row.id),
      role,
      name_bn: String(row.name_bn),
      title_bn: String(row.title_bn),
      administrative_unit_id: unit.id,
      employee_id: String(row.username),
    };
  }

  return null;
}

export function signActorToken(
  actor: Omit<AuthenticatedActor, 'issued_at' | 'exp'>,
  ttlSeconds = 60 * 60 * 12
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthenticatedActor = {
    ...actor,
    issued_at: now,
    exp: now + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyActorToken(token: string): AuthenticatedActor | null {
  if (!token || !token.includes('.')) return null;
  const [encoded, providedSig] = token.split('.');
  if (!encoded || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as AuthenticatedActor;
    if (!parsed || !parsed.role || !parsed.id) return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function toUserSession(
  actor: Omit<AuthenticatedActor, 'issued_at' | 'exp'>,
  token: string
): UserSession {
  const ctx = resolveActorRbacContext(actor.id);
  const permsObj: Partial<Record<PermissionKey, PermissionScope>> = {};
  if (ctx) {
    for (const [k, v] of ctx.effectivePermissions.entries()) {
      permsObj[k] = v;
    }
  }
  return {
    user_id: actor.id,
    role: actor.role,
    roles: ctx?.activeRoles || [actor.role],
    name: actor.name_bn,
    title_bn: actor.title_bn,
    administrative_unit_id: actor.administrative_unit_id,
    employee_id: actor.employee_id,
    assigned_wards: ctx?.assignedWards || [],
    assigned_departments: ctx?.assignedDepartments || [],
    permissions: permsObj,
    approval_authorities:
      ctx?.approvalAuthorities.map((a) => ({
        administrative_unit_id: a.administrative_unit_id,
        service_id: a.service_id,
        expires_at: a.expires_at,
      })) || [],
    token,
  };
}

export interface AuthedRequest extends Request {
  actor?: AuthenticatedActor | null;
  rbacContext?: ActorRbacContext | null;
}

function parseCookies(header?: string): Record<string, string> {
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    if (key) result[key] = val;
  }
  return result;
}

export function extractActorMiddleware(req: AuthedRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  let rawToken = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    rawToken = authHeader.slice(7).trim();
  } else if (typeof req.query.auth_token === 'string') {
    rawToken = req.query.auth_token.trim();
  } else {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies['pottoyon_session']) {
      rawToken = cookies['pottoyon_session'];
    }
  }

  const verified = rawToken ? verifyActorToken(rawToken) : null;
  if (verified) {
    const ctx = resolveActorRbacContext(verified.id);
    if (!ctx) {
      // Account deactivated, locked, or missing -> reject stale token
      req.actor = null;
      req.rbacContext = null;
    } else {
      req.actor = verified;
      req.rbacContext = ctx;
    }
  } else {
    req.actor = null;
    req.rbacContext = null;
  }
  next();
}

export function requireOfficerMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.actor || !req.rbacContext) {
    res.status(401).json({
      error: 'Authentication required',
      message_bn: 'অনুগ্রহ করে অনুমোদিত কর্মকর্তা একাউন্টে লগইন করুন।',
    });
    return;
  }
  const hasAnyNonCitizenRole = req.rbacContext.activeRoles.some((r) => r !== 'citizen');
  if (!hasAnyNonCitizenRole || !isOfficerRole(req.actor.role)) {
    res.status(403).json({
      error: 'Forbidden: citizen accounts cannot perform administrative operations',
      message_bn: 'নাগরিক একাউন্ট থেকে প্রশাসনিক কার্যক্রম পরিচালনা করা যাবে না।',
    });
    return;
  }
  next();
}

export function requirePermission(
  permissionKey: PermissionKey,
  targetExtractor?: (req: AuthedRequest) => AuthorizationTarget
) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.actor || !req.rbacContext) {
      res.status(401).json({
        error: 'Authentication required',
        message_bn: 'অনুগ্রহ করে অনুমোদিত একাউন্টে লগইন করুন।',
      });
      return;
    }
    const target = targetExtractor ? targetExtractor(req) : {};
    const check = authorizeContextPermission(req.rbacContext, permissionKey, target);
    if (!check.allowed) {
      res.status(403).json({
        error: check.reason || `Forbidden: missing permission ${permissionKey}`,
        message_bn: check.reasonBn || 'আপনার এই কার্যক্রমের অনুমতি নেই।',
      });
      return;
    }
    next();
  };
}

export function requireFinalApproverMiddleware(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.actor || !req.rbacContext) {
    res.status(401).json({
      error: 'Authentication required',
      message_bn: 'চূড়ান্ত অনুমোদনের জন্য কর্মকর্তার লগইন সেশন আবশ্যক।',
    });
    return;
  }
  const hasApprovePerm =
    req.rbacContext.effectivePermissions.has('applications.approve') ||
    req.rbacContext.effectivePermissions.has('certificates.issue') ||
    req.rbacContext.effectivePermissions.has('certificates.revoke') ||
    req.rbacContext.effectivePermissions.has('certificates.reissue');

  if (!hasApprovePerm) {
    res.status(403).json({
      error: 'Forbidden: insufficient authority for final certificate approval',
      message_bn: 'আপনার বর্তমান পদবি বা পারমিশন থেকে চূড়ান্ত অনুমোদন ও সনদ ইস্যু করার অনুমতি নেই।',
    });
    return;
  }
  next();
}
