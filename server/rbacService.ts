import crypto from 'node:crypto';
import { getDb, hashPassword } from './db.ts';
import { SENSITIVE_PERMISSION_KEYS } from './rbacCatalog.ts';
import type {
  Application,
  ApprovalAuthorityAssignment,
  MonitoringObservation,
  PermissionAuditLog,
  PermissionKey,
  PermissionScope,
  RbacPermission,
  RbacRole,
  RefundRequest,
  RoleCategory,
  RolePermissionAssignment,
  RolePermissionEntry,
  UserAccount,
  UserPermissionOverride,
  UserRole,
  UserRoleAssignment,
} from '../src/types/index.ts';

export const SCOPE_RANK: Record<PermissionScope, number> = {
  global: 7,
  upazila: 6,
  institution: 5,
  department: 4,
  ward: 3,
  assigned: 2,
  own: 1,
};

export interface ActorRbacContext {
  user: UserAccount;
  activeRoles: string[];
  effectivePermissions: Map<PermissionKey, PermissionScope>;
  assignedInstitutions: string[];
  assignedWards: number[];
  assignedDepartments: string[];
  approvalAuthorities: ApprovalAuthorityAssignment[];
}

export class RbacError extends Error {
  public statusCode: number;
  public messageBn: string;

  constructor(statusCode: number, message: string, messageBn: string) {
    super(message);
    this.statusCode = statusCode;
    this.messageBn = messageBn;
  }
}

export function normalizeMobile(mobile?: string): string {
  return String(mobile || '').replace(/[-\s+]/g, '');
}

export function mapServiceDepartment(serviceId: string): string {
  if (serviceId === 'srv_trade_license' || serviceId === 'srv_premises_license' || serviceId === 'srv_signboard_license') {
    return 'licensing';
  }
  if (serviceId === 'srv_holding_tax' || serviceId === 'srv_tax_clearance' || serviceId === 'srv_property_valuation') {
    return 'revenue';
  }
  return 'general';
}

export function validateStrongPassword(password: string): boolean {
  if (!password || password.length < 8) return false;
  const hasLetter = /[A-Za-z]/.test(password);
  const hasDigit = /\d/.test(password);
  return hasLetter && hasDigit;
}

export function isNotExpired(expiresAt?: string | null, nowMs = Date.now()): boolean {
  if (!expiresAt) return true;
  const ts = new Date(expiresAt).getTime();
  return Number.isFinite(ts) && ts > nowMs;
}

export function isEffectiveNow(effectiveFrom: string, expiresAt?: string | null, nowMs = Date.now()): boolean {
  const fromTs = new Date(effectiveFrom).getTime();
  if (!Number.isFinite(fromTs) || fromTs > nowMs) return false;
  return isNotExpired(expiresAt, nowMs);
}

export function resolveActorRbacContext(userId: string): ActorRbacContext | null {
  const db = getDb().db;
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown> | undefined;
  if (!userRow || Number(userRow.is_active) !== 1) return null;

  if (userRow.locked_until && new Date(String(userRow.locked_until)).getTime() > Date.now()) {
    return null;
  }

  const nowMs = Date.now();
  const user: UserAccount = {
    id: String(userRow.id),
    username: String(userRow.username),
    name_bn: String(userRow.name_bn),
    title_bn: String(userRow.title_bn),
    mobile: String(userRow.mobile),
    email: userRow.email ? String(userRow.email) : undefined,
    primary_role: String(userRow.primary_role),
    administrative_unit_id: userRow.administrative_unit_id ? String(userRow.administrative_unit_id) : null,
    is_active: Number(userRow.is_active) === 1,
    mfa_enabled: Number(userRow.mfa_enabled) === 1,
    failed_login_attempts: Number(userRow.failed_login_attempts) || 0,
    locked_until: userRow.locked_until ? String(userRow.locked_until) : null,
    created_at: String(userRow.created_at),
  };

  // Load active, non-expired role assignments where the role itself is active
  const roleRows = db
    .prepare(
      `SELECT ur.*, r.is_active AS role_active
       FROM user_roles ur
       JOIN roles r ON ur.role_slug = r.slug
       WHERE ur.user_id = ? AND ur.is_active = 1 AND r.is_active = 1`
    )
    .all(userId) as Array<Record<string, unknown>>;

  const activeRoleAssignments = roleRows.filter((r) =>
    isNotExpired(r.expires_at ? String(r.expires_at) : null, nowMs)
  );
  const activeRoles = Array.from(new Set(activeRoleAssignments.map((r) => String(r.role_slug))));

  const effectivePermissions = new Map<PermissionKey, PermissionScope>();

  if (activeRoles.length > 0) {
    const placeholders = activeRoles.map(() => '?').join(',');
    const rpRows = db
      .prepare(
        `SELECT permission_key, scope
         FROM role_permissions_v2
         WHERE role_slug IN (${placeholders}) AND granted = 1`
      )
      .all(...activeRoles) as Array<{ permission_key: string; scope: string }>;

    for (const row of rpRows) {
      const key = row.permission_key as PermissionKey;
      const scope = row.scope as PermissionScope;
      const existing = effectivePermissions.get(key);
      if (!existing || SCOPE_RANK[scope] > SCOPE_RANK[existing]) {
        effectivePermissions.set(key, scope);
      }
    }
  }

  // Apply explicit user permission overrides (revocations take strict precedence after grants)
  const overrideRows = db
    .prepare('SELECT * FROM user_permission_overrides WHERE user_id = ? AND is_active = 1')
    .all(userId) as Array<Record<string, unknown>>;

  const validOverrides = overrideRows.filter((o) =>
    isNotExpired(o.expires_at ? String(o.expires_at) : null, nowMs)
  );

  for (const ov of validOverrides) {
    if (String(ov.effect) === 'grant') {
      const key = String(ov.permission_key) as PermissionKey;
      const scope = String(ov.scope) as PermissionScope;
      const existing = effectivePermissions.get(key);
      if (!existing || SCOPE_RANK[scope] > SCOPE_RANK[existing]) {
        effectivePermissions.set(key, scope);
      }
    }
  }
  for (const ov of validOverrides) {
    if (String(ov.effect) === 'revoke') {
      effectivePermissions.delete(String(ov.permission_key) as PermissionKey);
    }
  }

  const instRows = db
    .prepare('SELECT administrative_unit_id FROM user_institution_assignments WHERE user_id = ? AND is_active = 1')
    .all(userId) as Array<{ administrative_unit_id: string }>;
  const assignedInstitutions = Array.from(
    new Set([
      ...(user.administrative_unit_id ? [user.administrative_unit_id] : []),
      ...activeRoleAssignments
        .map((r) => (r.administrative_unit_id ? String(r.administrative_unit_id) : ''))
        .filter(Boolean),
      ...instRows.map((r) => r.administrative_unit_id),
    ])
  );

  const wardRows = db
    .prepare('SELECT ward_no FROM user_ward_assignments WHERE user_id = ? AND is_active = 1')
    .all(userId) as Array<{ ward_no: number }>;
  const assignedWards = Array.from(new Set(wardRows.map((w) => Number(w.ward_no))));

  const deptRows = db
    .prepare('SELECT department_code FROM user_department_assignments WHERE user_id = ? AND is_active = 1')
    .all(userId) as Array<{ department_code: string }>;
  const assignedDepartments = Array.from(new Set(deptRows.map((d) => d.department_code)));

  const authRows = db
    .prepare('SELECT * FROM approval_authority_assignments WHERE user_id = ? AND is_active = 1')
    .all(userId) as Array<Record<string, unknown>>;
  const approvalAuthorities: ApprovalAuthorityAssignment[] = authRows
    .filter((a) =>
      isEffectiveNow(
        String(a.effective_from),
        a.expires_at ? String(a.expires_at) : null,
        nowMs
      )
    )
    .map((a) => ({
      id: String(a.id),
      user_id: String(a.user_id),
      role_slug: String(a.role_slug),
      administrative_unit_id: String(a.administrative_unit_id),
      service_id: String(a.service_id),
      max_fee_limit: a.max_fee_limit !== null && a.max_fee_limit !== undefined ? Number(a.max_fee_limit) : null,
      effective_from: String(a.effective_from),
      expires_at: a.expires_at ? String(a.expires_at) : null,
      delegated_by: String(a.delegated_by),
      delegation_note_bn: String(a.delegation_note_bn),
      allow_self_approval: Number(a.allow_self_approval) === 1,
      is_active: Number(a.is_active) === 1,
      created_at: String(a.created_at),
    }));

  return {
    user,
    activeRoles,
    effectivePermissions,
    assignedInstitutions,
    assignedWards,
    assignedDepartments,
    approvalAuthorities,
  };
}

export interface AuthorizationTarget {
  unitId?: string;
  wardNo?: number;
  department?: string;
  assignedOfficerId?: string;
  assignedOfficerName?: string;
  ownerUserId?: string;
  ownerMobile?: string;
}

export function authorizeContextPermission(
  ctx: ActorRbacContext,
  permissionKey: PermissionKey,
  target: AuthorizationTarget = {}
): { allowed: boolean; scope?: PermissionScope; reason?: string; reasonBn?: string } {
  const scope = ctx.effectivePermissions.get(permissionKey);
  if (!scope) {
    return {
      allowed: false,
      reason: `Forbidden: missing permission '${permissionKey}'`,
      reasonBn: `এই কার্যক্রমের জন্য আপনার প্রয়োজনীয় অনুমতি (${permissionKey}) নেই।`,
    };
  }

  if (scope === 'global' || scope === 'upazila') {
    return { allowed: true, scope };
  }

  if (scope === 'own') {
    if (target.ownerUserId && target.ownerUserId === ctx.user.id) {
      return { allowed: true, scope };
    }
    if (target.ownerMobile && normalizeMobile(target.ownerMobile) === normalizeMobile(ctx.user.mobile)) {
      return { allowed: true, scope };
    }
    if (!target.ownerUserId && !target.ownerMobile && !target.unitId) {
      return { allowed: true, scope };
    }
    return {
      allowed: false,
      reason: 'Forbidden: record does not belong to current citizen user',
      reasonBn: 'অন্য নাগরিকের আবেদন বা ব্যক্তিগত তথ্যে প্রবেশের অনুমতি নেই।',
    };
  }

  // Institution, department, ward, and assigned scopes ALL require institution isolation
  if (target.unitId && !ctx.assignedInstitutions.includes(target.unitId)) {
    return {
      allowed: false,
      reason: `Forbidden: cross-institution access denied for unit '${target.unitId}'`,
      reasonBn: 'অন্য ইউনিয়ন পরিষদ বা পৌরসভার তথ্যে প্রবেশাধিকার অনুমোদিত নয়।',
    };
  }

  if (scope === 'institution') {
    return { allowed: true, scope };
  }

  if (scope === 'department') {
    if (target.department && !ctx.assignedDepartments.includes(target.department)) {
      return {
        allowed: false,
        reason: `Forbidden: outside assigned department '${target.department}'`,
        reasonBn: 'অন্য বিভাগের আবেদন বা তথ্যে প্রবেশাধিকার নেই।',
      };
    }
    return { allowed: true, scope };
  }

  if (scope === 'ward') {
    if (target.wardNo !== undefined && !ctx.assignedWards.includes(Number(target.wardNo))) {
      return {
        allowed: false,
        reason: `Forbidden: outside assigned ward '${target.wardNo}'`,
        reasonBn: 'অন্য ওয়ার্ডের আবেদন বা নথিপত্রে প্রবেশাধিকার নেই।',
      };
    }
    return { allowed: true, scope };
  }

  if (scope === 'assigned') {
    const isMatched =
      (target.assignedOfficerId && target.assignedOfficerId === ctx.user.id) ||
      (target.assignedOfficerName && target.assignedOfficerName === ctx.user.name_bn) ||
      (target.ownerUserId && target.ownerUserId === ctx.user.id);

    if (target.unitId && !isMatched) {
      return {
        allowed: false,
        reason: 'Forbidden: record is not assigned to this officer/operator',
        reasonBn: 'এই আবেদনটি আপনার ওপর ন্যস্ত নয় বা আপনার দ্বারা দাখিলকৃত নয়।',
      };
    }
    return { allowed: true, scope };
  }

  return {
    allowed: false,
    reason: 'Forbidden: unrecognized permission scope',
    reasonBn: 'অনুমতি পরিধি যাচাই করা যায়নি।',
  };
}

export function authorizeApprovalAction(
  ctx: ActorRbacContext,
  unitId: string,
  serviceId: string,
  application?: Application & { created_by_user_id?: string }
): { allowed: boolean; reason?: string; reasonBn?: string } {
  const permApp = authorizeContextPermission(ctx, 'applications.approve', { unitId });
  if (!permApp.allowed) return permApp;

  const permCert = authorizeContextPermission(ctx, 'certificates.issue', { unitId });
  if (!permCert.allowed) return permCert;

  // Approval authority must explicitly cover the institution + service
  const matchingAuthority = ctx.approvalAuthorities.find(
    (aa) =>
      (aa.administrative_unit_id === unitId || aa.administrative_unit_id === '*') &&
      (aa.service_id === serviceId || aa.service_id === '*')
  );

  if (!matchingAuthority) {
    return {
      allowed: false,
      reason: `Forbidden: no active legal approval authority for service '${serviceId}' in unit '${unitId}'`,
      reasonBn: 'এই নির্দিষ্ট সেবা ও প্রতিষ্ঠানের সনদ চূড়ান্ত অনুমোদনের আইনি ক্ষমতা আপনার ওপর অর্পিত নেই।',
    };
  }

  if (
    matchingAuthority.max_fee_limit !== null &&
    matchingAuthority.max_fee_limit !== undefined &&
    application &&
    application.fee_amount > matchingAuthority.max_fee_limit
  ) {
    return {
      allowed: false,
      reason: 'Forbidden: application fee exceeds assigned approval authority limit',
      reasonBn: 'আবেদনের ফি আপনার অনুমোদিত অনুমোদন সীমা অতিক্রম করেছে।',
    };
  }

  // Conflict-of-interest / self-approval guard
  if (!matchingAuthority.allow_self_approval && application) {
    const isSelfCreated =
      (application.created_by_user_id && application.created_by_user_id === ctx.user.id) ||
      (normalizeMobile(application.mobile) !== '' &&
        normalizeMobile(application.mobile) === normalizeMobile(ctx.user.mobile));
    if (isSelfCreated) {
      return {
        allowed: false,
        reason: 'Forbidden: self-approval conflict of interest violation',
        reasonBn: 'স্বার্থের সংঘাত নীতির কারণে নিজের বা নিজ মোবাইল থেকে দাখিলকৃত আবেদন অনুমোদন করা যাবে না।',
      };
    }
  }

  return { allowed: true };
}

export function canUserAccessApplicationRecord(
  ctx: ActorRbacContext,
  app: Application & { created_by_user_id?: string }
): boolean {
  const res = authorizeContextPermission(ctx, 'applications.view', {
    unitId: app.administrative_unit_id,
    wardNo: app.ward_no,
    department: mapServiceDepartment(app.service_id),
    assignedOfficerId: app.assigned_officer_id,
    assignedOfficerName: app.assigned_officer,
    ownerUserId: app.created_by_user_id,
    ownerMobile: app.mobile,
  });
  return res.allowed;
}

export function filterApplicationsForContext(
  ctx: ActorRbacContext,
  apps: Application[]
): Application[] {
  return apps.filter((a) => canUserAccessApplicationRecord(ctx, a));
}

export function appendPermissionAuditLog(params: {
  actorId: string;
  actorRole: string;
  actorNameBn: string;
  actionType: string;
  targetType: PermissionAuditLog['target_type'];
  targetId: string;
  unitId?: string | null;
  before?: unknown;
  after?: unknown;
  reasonBn: string;
}): void {
  const db = getDb().db;
  db.prepare(
    `INSERT INTO permission_audit_logs (
      id, actor_id, actor_role, actor_name_bn, action_type, target_type,
      target_id, administrative_unit_id, before_json, after_json, reason_bn, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `pal_${crypto.randomUUID()}`,
    params.actorId,
    params.actorRole,
    params.actorNameBn,
    params.actionType,
    params.targetType,
    params.targetId,
    params.unitId || null,
    params.before !== undefined ? JSON.stringify(params.before) : null,
    params.after !== undefined ? JSON.stringify(params.after) : null,
    params.reasonBn,
    new Date().toISOString()
  );
}

// --- RBAC Management Queries & Mutations ---

export function listAllRoles(): RbacRole[] {
  const db = getDb().db;
  const rows = db.prepare('SELECT * FROM roles ORDER BY is_system DESC, created_at ASC').all() as Array<Record<string, unknown>>;
  const counts = db
    .prepare('SELECT role_slug, COUNT(*) AS cnt FROM role_permissions_v2 WHERE granted = 1 GROUP BY role_slug')
    .all() as Array<{ role_slug: string; cnt: number }>;
  const countMap = new Map(counts.map((c) => [c.role_slug, Number(c.cnt)]));

  return rows.map((r) => ({
    id: String(r.id),
    slug: String(r.slug),
    name_en: String(r.name_en),
    name_bn: String(r.name_bn),
    category: String(r.category) as RoleCategory,
    institution_type: (r.institution_type ? String(r.institution_type) : null) as RbacRole['institution_type'],
    default_scope: String(r.default_scope) as PermissionScope,
    is_system: Number(r.is_system) === 1,
    is_active: Number(r.is_active) === 1,
    is_optional: Number(r.is_optional) === 1,
    description_bn: String(r.description_bn),
    permission_count: countMap.get(String(r.slug)) || 0,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  }));
}

export function listAllPermissions(): RbacPermission[] {
  const db = getDb().db;
  const rows = db.prepare('SELECT * FROM permissions').all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    key: String(r.key) as PermissionKey,
    module: String(r.module),
    name_en: String(r.name_en),
    name_bn: String(r.name_bn),
    is_sensitive: Number(r.is_sensitive) === 1,
  }));
}

export function getRolePermissionsV2(roleSlug: string): RolePermissionAssignment[] {
  const db = getDb().db;
  const rows = db
    .prepare('SELECT * FROM role_permissions_v2 WHERE role_slug = ? AND granted = 1')
    .all(roleSlug) as Array<{ role_slug: string; permission_key: string; scope: string; granted: number }>;
  return rows.map((r) => ({
    role_slug: r.role_slug,
    permission_key: r.permission_key as PermissionKey,
    scope: r.scope as PermissionScope,
    granted: Number(r.granted) === 1,
  }));
}

export function syncLegacyRoleSummary(roleSlug: string): void {
  const db = getDb().db;
  const roleRow = db.prepare('SELECT * FROM roles WHERE slug = ?').get(roleSlug) as Record<string, unknown> | undefined;
  if (!roleRow) return;
  const grants = getRolePermissionsV2(roleSlug);
  const keySet = new Set(grants.map((g) => g.permission_key));
  const summary: RolePermissionEntry = {
    role: roleSlug as UserRole,
    label_bn: String(roleRow.name_bn),
    scope_bn: String(roleRow.default_scope),
    can_view_applications:
      keySet.has('applications.view') || keySet.has('applications.view_all') || keySet.has('applications.view_assigned'),
    can_verify_applications: keySet.has('applications.verify'),
    can_forward_applications: keySet.has('applications.forward'),
    can_final_approve: keySet.has('applications.approve'),
    can_revoke_certificate: keySet.has('certificates.revoke'),
    can_manage_revenue: keySet.has('payments.reconcile') || keySet.has('payments.view'),
    can_manage_staff: keySet.has('employees.manage') || keySet.has('users.assign_role'),
    can_manage_settings: keySet.has('settings.manage'),
  };
  db.prepare(
    `INSERT INTO role_permissions (role, data_json) VALUES (?, ?)
     ON CONFLICT(role) DO UPDATE SET data_json = excluded.data_json`
  ).run(roleSlug, JSON.stringify(summary));
}

export function updateRolePermissionsTransactional(params: {
  actorCtx: ActorRbacContext;
  roleSlug: string;
  assignments: Array<{ permission_key: PermissionKey; scope: PermissionScope; granted: boolean }>;
  reasonBn: string;
}): RolePermissionAssignment[] {
  const { actorCtx, roleSlug, assignments, reasonBn } = params;
  const db = getDb().db;

  const role = db.prepare('SELECT * FROM roles WHERE slug = ?').get(roleSlug) as Record<string, unknown> | undefined;
  if (!role) {
    throw new RbacError(404, 'Role not found', 'নির্বাচিত রোল খুঁজে পাওয়া যায়নি।');
  }

  // Non-super-admin cannot grant permissions they do not hold or exceed their own scope
  const isSuper = actorCtx.activeRoles.includes('super_admin');
  for (const item of assignments) {
    if (!item.granted) continue;
    if (!isSuper) {
      const actorScope = actorCtx.effectivePermissions.get(item.permission_key);
      if (!actorScope || SCOPE_RANK[item.scope] > SCOPE_RANK[actorScope] || SENSITIVE_PERMISSION_KEYS.has(item.permission_key)) {
        throw new RbacError(
          403,
          `Forbidden: cannot grant '${item.permission_key}' beyond own delegation scope`,
          'নিজস্ব অনুমোদিত ক্ষমতার বাইরে কোনো পারমিশন বরাদ্দ করা যাবে না।'
        );
      }
    }
  }

  const before = getRolePermissionsV2(roleSlug);

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM role_permissions_v2 WHERE role_slug = ?').run(roleSlug);
    const ins = db.prepare(
      'INSERT INTO role_permissions_v2 (role_slug, permission_key, scope, granted) VALUES (?, ?, ?, 1)'
    );
    for (const item of assignments) {
      if (item.granted) {
        ins.run(roleSlug, item.permission_key, item.scope);
      }
    }
    db.prepare('UPDATE roles SET updated_at = ? WHERE slug = ?').run(new Date().toISOString(), roleSlug);
    syncLegacyRoleSummary(roleSlug);

    appendPermissionAuditLog({
      actorId: actorCtx.user.id,
      actorRole: actorCtx.user.primary_role,
      actorNameBn: actorCtx.user.name_bn,
      actionType: 'role_permissions_updated',
      targetType: 'role',
      targetId: roleSlug,
      before,
      after: assignments.filter((a) => a.granted),
      reasonBn: reasonBn || `${roleSlug} রোলের পারমিশন হালনাগাদ`,
    });

    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }

  return getRolePermissionsV2(roleSlug);
}

export function createCustomRoleTransactional(params: {
  actorCtx: ActorRbacContext;
  slug: string;
  nameEn: string;
  nameBn: string;
  category: RoleCategory;
  institutionType?: 'union_parishad' | 'municipality' | null;
  defaultScope: PermissionScope;
  descriptionBn: string;
  assignments: Array<{ permission_key: PermissionKey; scope: PermissionScope }>;
}): RbacRole {
  const db = getDb().db;
  const cleanSlug = params.slug
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleanSlug) {
    throw new RbacError(400, 'Invalid role slug', 'রোল স্লাগ সঠিক নয়।');
  }
  const existing = db.prepare('SELECT id FROM roles WHERE slug = ?').get(cleanSlug);
  if (existing) {
    throw new RbacError(409, 'Role slug already exists', 'এই নামে একটি রোল ইতোমধ্যেই বিদ্যমান।');
  }

  const nowIso = new Date().toISOString();
  const id = `role_custom_${crypto.randomUUID().slice(0, 8)}`;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO roles (
        id, slug, name_en, name_bn, category, institution_type,
        default_scope, is_system, is_active, is_optional, description_bn,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 1, ?, ?, ?)`
    ).run(
      id,
      cleanSlug,
      params.nameEn,
      params.nameBn,
      params.category || 'custom',
      params.institutionType || null,
      params.defaultScope || 'institution',
      params.descriptionBn || '',
      nowIso,
      nowIso
    );

    const ins = db.prepare(
      'INSERT INTO role_permissions_v2 (role_slug, permission_key, scope, granted) VALUES (?, ?, ?, 1)'
    );
    for (const item of params.assignments) {
      ins.run(cleanSlug, item.permission_key, item.scope);
    }

    appendPermissionAuditLog({
      actorId: params.actorCtx.user.id,
      actorRole: params.actorCtx.user.primary_role,
      actorNameBn: params.actorCtx.user.name_bn,
      actionType: 'custom_role_created',
      targetType: 'role',
      targetId: cleanSlug,
      after: { name_bn: params.nameBn, permissions: params.assignments },
      reasonBn: `নতুন কাস্টম রোল তৈরি: ${params.nameBn}`,
    });

    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }

  return listAllRoles().find((r) => r.slug === cleanSlug)!;
}

export function listUsersWithAssignments(unitId?: string): UserAccount[] {
  const db = getDb().db;
  const rows = (unitId
    ? db.prepare('SELECT * FROM users WHERE administrative_unit_id = ? ORDER BY created_at DESC').all(unitId)
    : db.prepare('SELECT * FROM users ORDER BY created_at DESC').all()) as Array<Record<string, unknown>>;

  return rows.map((u) => {
    const uid = String(u.id);
    const roles = (
      db.prepare('SELECT * FROM user_roles WHERE user_id = ?').all(uid) as Array<Record<string, unknown>>
    ).map((r) => ({
      id: String(r.id),
      user_id: String(r.user_id),
      role_slug: String(r.role_slug),
      administrative_unit_id: r.administrative_unit_id ? String(r.administrative_unit_id) : null,
      is_primary: Number(r.is_primary) === 1,
      assigned_by: String(r.assigned_by),
      expires_at: r.expires_at ? String(r.expires_at) : null,
      is_active: Number(r.is_active) === 1,
      created_at: String(r.created_at),
    }));

    const wards = (
      db.prepare('SELECT ward_no FROM user_ward_assignments WHERE user_id = ? AND is_active = 1').all(uid) as Array<{
        ward_no: number;
      }>
    ).map((w) => Number(w.ward_no));

    const departments = (
      db
        .prepare('SELECT department_code FROM user_department_assignments WHERE user_id = ? AND is_active = 1')
        .all(uid) as Array<{ department_code: string }>
    ).map((d) => d.department_code);

    const overrides = (
      db
        .prepare('SELECT * FROM user_permission_overrides WHERE user_id = ? ORDER BY created_at DESC')
        .all(uid) as Array<Record<string, unknown>>
    ).map((o) => ({
      id: String(o.id),
      user_id: String(o.user_id),
      permission_key: String(o.permission_key) as PermissionKey,
      scope: String(o.scope) as PermissionScope,
      effect: String(o.effect) as 'grant' | 'revoke',
      reason_bn: String(o.reason_bn),
      assigned_by: String(o.assigned_by),
      expires_at: o.expires_at ? String(o.expires_at) : null,
      is_active: Number(o.is_active) === 1,
      created_at: String(o.created_at),
    }));

    return {
      id: uid,
      username: String(u.username),
      name_bn: String(u.name_bn),
      title_bn: String(u.title_bn),
      mobile: String(u.mobile),
      email: u.email ? String(u.email) : undefined,
      primary_role: String(u.primary_role),
      administrative_unit_id: u.administrative_unit_id ? String(u.administrative_unit_id) : null,
      is_active: Number(u.is_active) === 1,
      mfa_enabled: Number(u.mfa_enabled) === 1,
      failed_login_attempts: Number(u.failed_login_attempts) || 0,
      locked_until: u.locked_until ? String(u.locked_until) : null,
      created_at: String(u.created_at),
      roles,
      wards,
      departments,
      overrides,
    };
  });
}

export function assignUserRoleAndScopeTransactional(params: {
  actorCtx: ActorRbacContext;
  targetUserId: string;
  roleSlug: string;
  administrativeUnitId?: string | null;
  wardNos?: number[];
  departments?: string[];
  expiresAt?: string | null;
  reasonBn: string;
}): UserRoleAssignment {
  const { actorCtx, targetUserId, roleSlug, administrativeUnitId, wardNos, departments, expiresAt, reasonBn } = params;
  const db = getDb().db;

  // Prevent self-elevation unless super_admin modifying another user
  if (targetUserId === actorCtx.user.id) {
    throw new RbacError(
      403,
      'Forbidden: users cannot elevate or modify their own role assignments',
      'নিরাপত্তা নীতির কারণে কোনো ব্যবহারকারী নিজেই নিজের রোল বা ক্ষমতা উন্নীত করতে পারবেন না।'
    );
  }

  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId) as Record<string, unknown> | undefined;
  if (!targetUser) {
    throw new RbacError(404, 'Target user not found', 'লক্ষ্য ব্যবহারকারী পাওয়া যায়নি।');
  }
  const roleRow = db.prepare('SELECT * FROM roles WHERE slug = ? AND is_active = 1').get(roleSlug) as
    | Record<string, unknown>
    | undefined;
  if (!roleRow) {
    throw new RbacError(404, 'Active role not found', 'সক্রিয় রোল খুঁজে পাওয়া যায়নি।');
  }

  const isSuper = actorCtx.activeRoles.includes('super_admin');
  if (!isSuper) {
    if (roleSlug === 'super_admin' || roleSlug === 'upazila_admin') {
      throw new RbacError(
        403,
        'Forbidden: only Super Admin can assign global or upazila-level administrative roles',
        'এই উচ্চপর্যায়ের রোল বরাদ্দের ক্ষমতা কেবল সুপার অ্যাডমিনের।'
      );
    }
    if (administrativeUnitId && !actorCtx.assignedInstitutions.includes(administrativeUnitId)) {
      throw new RbacError(
        403,
        'Forbidden: cannot assign role outside your institution scope',
        'নিজ প্রতিষ্ঠানের বাইরে রোল বরাদ্দ করা যাবে না।'
      );
    }
  }

  const id = `ur_${crypto.randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO user_roles (
        id, user_id, role_slug, administrative_unit_id, is_primary,
        assigned_by, expires_at, is_active, created_at
      ) VALUES (?, ?, ?, ?, 0, ?, ?, 1, ?)`
    ).run(id, targetUserId, roleSlug, administrativeUnitId || null, actorCtx.user.id, expiresAt || null, nowIso);

    if (administrativeUnitId) {
      const hasInst = db
        .prepare('SELECT id FROM user_institution_assignments WHERE user_id = ? AND administrative_unit_id = ? AND is_active = 1')
        .get(targetUserId, administrativeUnitId);
      if (!hasInst) {
        db.prepare(
          `INSERT INTO user_institution_assignments (
            id, user_id, administrative_unit_id, is_active, assigned_by, created_at
          ) VALUES (?, ?, ?, 1, ?, ?)`
        ).run(`uia_${crypto.randomUUID().slice(0, 8)}`, targetUserId, administrativeUnitId, actorCtx.user.id, nowIso);
      }
    }

    if (Array.isArray(wardNos) && administrativeUnitId) {
      db.prepare('DELETE FROM user_ward_assignments WHERE user_id = ? AND administrative_unit_id = ?').run(
        targetUserId,
        administrativeUnitId
      );
      const insWard = db.prepare(
        `INSERT INTO user_ward_assignments (
          id, user_id, administrative_unit_id, ward_no, is_active, assigned_by, created_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?)`
      );
      for (const w of wardNos) {
        insWard.run(`uwa_${crypto.randomUUID().slice(0, 8)}`, targetUserId, administrativeUnitId, w, actorCtx.user.id, nowIso);
      }
    }

    if (Array.isArray(departments) && administrativeUnitId) {
      db.prepare('DELETE FROM user_department_assignments WHERE user_id = ? AND administrative_unit_id = ?').run(
        targetUserId,
        administrativeUnitId
      );
      const insDept = db.prepare(
        `INSERT INTO user_department_assignments (
          id, user_id, administrative_unit_id, department_code, is_active, assigned_by, created_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?)`
      );
      for (const d of departments) {
        insDept.run(`uda_${crypto.randomUUID().slice(0, 8)}`, targetUserId, administrativeUnitId, d, actorCtx.user.id, nowIso);
      }
    }

    appendPermissionAuditLog({
      actorId: actorCtx.user.id,
      actorRole: actorCtx.user.primary_role,
      actorNameBn: actorCtx.user.name_bn,
      actionType: 'user_role_assigned',
      targetType: 'user',
      targetId: targetUserId,
      unitId: administrativeUnitId || null,
      after: { role_slug: roleSlug, administrative_unit_id: administrativeUnitId, wardNos, departments, expiresAt },
      reasonBn: reasonBn || `রোল বরাদ্দ: ${roleSlug}`,
    });

    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }

  return {
    id,
    user_id: targetUserId,
    role_slug: roleSlug,
    administrative_unit_id: administrativeUnitId || null,
    is_primary: false,
    assigned_by: actorCtx.user.id,
    expires_at: expiresAt || null,
    is_active: true,
    created_at: nowIso,
  };
}

export function createUserPermissionOverrideTransactional(params: {
  actorCtx: ActorRbacContext;
  targetUserId: string;
  permissionKey: PermissionKey;
  scope: PermissionScope;
  effect: 'grant' | 'revoke';
  expiresAt?: string | null;
  reasonBn: string;
}): UserPermissionOverride {
  const { actorCtx, targetUserId, permissionKey, scope, effect, expiresAt, reasonBn } = params;
  const db = getDb().db;

  if (targetUserId === actorCtx.user.id && effect === 'grant') {
    throw new RbacError(
      403,
      'Forbidden: users cannot grant themselves additional permissions',
      'নিজ একাউন্টে অতিরিক্ত পারমিশন বরাদ্দ করা নিষিদ্ধ।'
    );
  }

  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId) as Record<string, unknown> | undefined;
  if (!targetUser) {
    throw new RbacError(404, 'Target user not found', 'ব্যবহারকারী খুঁজে পাওয়া যায়নি।');
  }

  const isSuper = actorCtx.activeRoles.includes('super_admin');
  if (!isSuper && effect === 'grant') {
    const actorScope = actorCtx.effectivePermissions.get(permissionKey);
    if (!actorScope || SCOPE_RANK[scope] > SCOPE_RANK[actorScope] || SENSITIVE_PERMISSION_KEYS.has(permissionKey)) {
      throw new RbacError(
        403,
        'Forbidden: cannot grant permission beyond own authorized delegation scope',
        'নিজ অনুমোদিত পরিধির বাইরে কোনো অস্থায়ী পারমিশন দেওয়া যাবে না।'
      );
    }
  }

  const id = `ov_${crypto.randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO user_permission_overrides (
        id, user_id, permission_key, scope, effect, reason_bn,
        assigned_by, expires_at, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(id, targetUserId, permissionKey, scope, effect, reasonBn || 'প্রশাসনিক আদেশ', actorCtx.user.id, expiresAt || null, nowIso);

    appendPermissionAuditLog({
      actorId: actorCtx.user.id,
      actorRole: actorCtx.user.primary_role,
      actorNameBn: actorCtx.user.name_bn,
      actionType: effect === 'grant' ? 'permission_override_granted' : 'permission_override_revoked',
      targetType: 'override',
      targetId: targetUserId,
      unitId: targetUser.administrative_unit_id ? String(targetUser.administrative_unit_id) : null,
      after: { permission_key: permissionKey, scope, effect, expires_at: expiresAt || null },
      reasonBn: reasonBn || `${permissionKey} ${effect}`,
    });

    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }

  return {
    id,
    user_id: targetUserId,
    permission_key: permissionKey,
    scope,
    effect,
    reason_bn: reasonBn,
    assigned_by: actorCtx.user.id,
    expires_at: expiresAt || null,
    is_active: true,
    created_at: nowIso,
  };
}

export function listApprovalAuthorities(unitId?: string): ApprovalAuthorityAssignment[] {
  const db = getDb().db;
  const rows = (unitId
    ? db
        .prepare(
          `SELECT a.*, u.name_bn AS user_name_bn
           FROM approval_authority_assignments a
           LEFT JOIN users u ON a.user_id = u.id
           WHERE a.administrative_unit_id = ?
           ORDER BY a.created_at DESC`
        )
        .all(unitId)
    : db
        .prepare(
          `SELECT a.*, u.name_bn AS user_name_bn
           FROM approval_authority_assignments a
           LEFT JOIN users u ON a.user_id = u.id
           ORDER BY a.created_at DESC`
        )
        .all()) as Array<Record<string, unknown>>;

  return rows.map((a) => ({
    id: String(a.id),
    user_id: String(a.user_id),
    user_name_bn: a.user_name_bn ? String(a.user_name_bn) : undefined,
    role_slug: String(a.role_slug),
    administrative_unit_id: String(a.administrative_unit_id),
    service_id: String(a.service_id),
    max_fee_limit: a.max_fee_limit !== null && a.max_fee_limit !== undefined ? Number(a.max_fee_limit) : null,
    effective_from: String(a.effective_from),
    expires_at: a.expires_at ? String(a.expires_at) : null,
    delegated_by: String(a.delegated_by),
    delegation_note_bn: String(a.delegation_note_bn),
    allow_self_approval: Number(a.allow_self_approval) === 1,
    is_active: Number(a.is_active) === 1,
    created_at: String(a.created_at),
  }));
}

export function grantApprovalAuthorityTransactional(params: {
  actorCtx: ActorRbacContext;
  userId: string;
  roleSlug: string;
  administrativeUnitId: string;
  serviceId: string;
  maxFeeLimit?: number | null;
  effectiveFrom?: string;
  expiresAt?: string | null;
  delegationNoteBn: string;
  allowSelfApproval?: boolean;
}): ApprovalAuthorityAssignment {
  const db = getDb().db;
  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(params.userId) as Record<string, unknown> | undefined;
  if (!targetUser) {
    throw new RbacError(404, 'Target user not found', 'ব্যবহারকারী খুঁজে পাওয়া যায়নি।');
  }
  if (params.userId === params.actorCtx.user.id && !params.actorCtx.activeRoles.includes('super_admin')) {
    throw new RbacError(403, 'Forbidden: cannot delegate approval authority to self', 'নিজের কাছে অনুমোদন ক্ষমতা অর্পণ করা যাবে না।');
  }

  const id = `aa_${crypto.randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();
  const effectiveFrom = params.effectiveFrom || nowIso;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO approval_authority_assignments (
        id, user_id, role_slug, administrative_unit_id, service_id,
        max_fee_limit, effective_from, expires_at, delegated_by,
        delegation_note_bn, allow_self_approval, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      id,
      params.userId,
      params.roleSlug,
      params.administrativeUnitId,
      params.serviceId,
      params.maxFeeLimit ?? null,
      effectiveFrom,
      params.expiresAt || null,
      params.actorCtx.user.id,
      params.delegationNoteBn || 'আনুষ্ঠানিক অনুমোদন ক্ষমতা অর্পণ',
      params.allowSelfApproval ? 1 : 0,
      nowIso
    );

    appendPermissionAuditLog({
      actorId: params.actorCtx.user.id,
      actorRole: params.actorCtx.user.primary_role,
      actorNameBn: params.actorCtx.user.name_bn,
      actionType: 'approval_authority_granted',
      targetType: 'approval_authority',
      targetId: params.userId,
      unitId: params.administrativeUnitId,
      after: {
        id,
        role_slug: params.roleSlug,
        service_id: params.serviceId,
        max_fee_limit: params.maxFeeLimit ?? null,
        effective_from: effectiveFrom,
        expires_at: params.expiresAt || null,
      },
      reasonBn: params.delegationNoteBn || 'অনুমোদন ক্ষমতা অর্পণ',
    });

    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }

  return {
    id,
    user_id: params.userId,
    user_name_bn: String(targetUser.name_bn),
    role_slug: params.roleSlug,
    administrative_unit_id: params.administrativeUnitId,
    service_id: params.serviceId,
    max_fee_limit: params.maxFeeLimit ?? null,
    effective_from: effectiveFrom,
    expires_at: params.expiresAt || null,
    delegated_by: params.actorCtx.user.id,
    delegation_note_bn: params.delegationNoteBn,
    allow_self_approval: Boolean(params.allowSelfApproval),
    is_active: true,
    created_at: nowIso,
  };
}

export function listPermissionAuditLogs(unitId?: string): PermissionAuditLog[] {
  const db = getDb().db;
  const rows = (unitId
    ? db
        .prepare('SELECT * FROM permission_audit_logs WHERE administrative_unit_id = ? ORDER BY created_at DESC LIMIT 150')
        .all(unitId)
    : db.prepare('SELECT * FROM permission_audit_logs ORDER BY created_at DESC LIMIT 150').all()) as Array<
    Record<string, unknown>
  >;

  return rows.map((r) => ({
    id: String(r.id),
    actor_id: String(r.actor_id),
    actor_role: String(r.actor_role),
    actor_name_bn: String(r.actor_name_bn),
    action_type: String(r.action_type),
    target_type: String(r.target_type) as PermissionAuditLog['target_type'],
    target_id: String(r.target_id),
    administrative_unit_id: r.administrative_unit_id ? String(r.administrative_unit_id) : null,
    before_json: r.before_json ? String(r.before_json) : null,
    after_json: r.after_json ? String(r.after_json) : null,
    reason_bn: String(r.reason_bn),
    created_at: String(r.created_at),
  }));
}

export function listMonitoringObservations(unitId?: string): MonitoringObservation[] {
  const db = getDb().db;
  const rows = (unitId
    ? db
        .prepare('SELECT * FROM monitoring_observations WHERE administrative_unit_id = ? ORDER BY created_at DESC LIMIT 100')
        .all(unitId)
    : db.prepare('SELECT * FROM monitoring_observations ORDER BY created_at DESC LIMIT 100').all()) as Array<
    Record<string, unknown>
  >;
  return rows.map((r) => ({
    id: String(r.id),
    administrative_unit_id: String(r.administrative_unit_id),
    application_id: r.application_id ? String(r.application_id) : null,
    officer_id: String(r.officer_id),
    officer_name_bn: String(r.officer_name_bn),
    observation_bn: String(r.observation_bn),
    severity: String(r.severity) as MonitoringObservation['severity'],
    created_at: String(r.created_at),
  }));
}

export function insertMonitoringObservation(obs: MonitoringObservation): void {
  const db = getDb().db;
  db.prepare(
    `INSERT INTO monitoring_observations (
      id, administrative_unit_id, application_id, officer_id,
      officer_name_bn, observation_bn, severity, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    obs.id,
    obs.administrative_unit_id,
    obs.application_id || null,
    obs.officer_id,
    obs.officer_name_bn,
    obs.observation_bn,
    obs.severity,
    obs.created_at
  );
}

export function listRefundRequests(unitId?: string): RefundRequest[] {
  const db = getDb().db;
  const rows = (unitId
    ? db.prepare('SELECT * FROM refund_requests WHERE administrative_unit_id = ? ORDER BY created_at DESC').all(unitId)
    : db.prepare('SELECT * FROM refund_requests ORDER BY created_at DESC').all()) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    application_id: String(r.application_id),
    administrative_unit_id: String(r.administrative_unit_id),
    amount: Number(r.amount),
    reason_bn: String(r.reason_bn),
    requested_by: String(r.requested_by),
    requested_by_name_bn: String(r.requested_by_name_bn),
    status: String(r.status) as RefundRequest['status'],
    reviewed_by: r.reviewed_by ? String(r.reviewed_by) : null,
    reviewed_at: r.reviewed_at ? String(r.reviewed_at) : null,
    created_at: String(r.created_at),
  }));
}

export function upsertRefundRequest(rr: RefundRequest): void {
  const db = getDb().db;
  db.prepare(
    `INSERT INTO refund_requests (
      id, application_id, administrative_unit_id, amount, reason_bn,
      requested_by, requested_by_name_bn, status, reviewed_by, reviewed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      reviewed_by = excluded.reviewed_by,
      reviewed_at = excluded.reviewed_at`
  ).run(
    rr.id,
    rr.application_id,
    rr.administrative_unit_id,
    rr.amount,
    rr.reason_bn,
    rr.requested_by,
    rr.requested_by_name_bn,
    rr.status,
    rr.reviewed_by || null,
    rr.reviewed_at || null,
    rr.created_at
  );
}

export function createUserAccountTransactional(params: {
  actorCtx: ActorRbacContext;
  username: string;
  password: string;
  nameBn: string;
  titleBn: string;
  mobile: string;
  email?: string;
  primaryRole: string;
  administrativeUnitId?: string | null;
  wardNos?: number[];
  departments?: string[];
  mfaEnabled?: boolean;
}): UserAccount {
  const db = getDb().db;
  if (!validateStrongPassword(params.password)) {
    throw new RbacError(
      400,
      'Password must be at least 8 characters and include both letters and numbers',
      'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের এবং অক্ষর ও সংখ্যার সমন্বয়ে হতে হবে।'
    );
  }
  const cleanUser = params.username.trim().toLowerCase();
  if (db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(cleanUser)) {
    throw new RbacError(409, 'Username already exists', 'এই ইউজারনেমটি ইতোমধ্যেই ব্যবহৃত হচ্ছে।');
  }

  const isSuper = params.actorCtx.activeRoles.includes('super_admin');
  if (!isSuper && (params.primaryRole === 'super_admin' || params.primaryRole === 'upazila_admin')) {
    throw new RbacError(403, 'Forbidden: cannot create higher-privilege account', 'উচ্চপর্যায়ের একাউন্ট তৈরির অনুমতি নেই।');
  }
  if (!isSuper && params.administrativeUnitId && !params.actorCtx.assignedInstitutions.includes(params.administrativeUnitId)) {
    throw new RbacError(403, 'Forbidden: cross-institution user creation denied', 'অন্য প্রতিষ্ঠানে ব্যবহারকারী তৈরি করা যাবে না।');
  }

  const id = `usr_${crypto.randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();
  const pwHash = hashPassword(params.password);

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO users (
        id, username, password_hash, name_bn, title_bn, mobile, email,
        primary_role, administrative_unit_id, is_active, mfa_enabled,
        failed_login_attempts, locked_until, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, NULL, ?)`
    ).run(
      id,
      cleanUser,
      pwHash,
      params.nameBn,
      params.titleBn,
      params.mobile,
      params.email || null,
      params.primaryRole,
      params.administrativeUnitId || null,
      params.mfaEnabled === false ? 0 : 1,
      nowIso
    );

    db.prepare(
      `INSERT INTO user_roles (
        id, user_id, role_slug, administrative_unit_id, is_primary,
        assigned_by, expires_at, is_active, created_at
      ) VALUES (?, ?, ?, ?, 1, ?, NULL, 1, ?)`
    ).run(
      `ur_${crypto.randomUUID().slice(0, 8)}`,
      id,
      params.primaryRole,
      params.administrativeUnitId || null,
      params.actorCtx.user.id,
      nowIso
    );

    if (params.administrativeUnitId) {
      db.prepare(
        `INSERT INTO user_institution_assignments (
          id, user_id, administrative_unit_id, is_active, assigned_by, created_at
        ) VALUES (?, ?, ?, 1, ?, ?)`
      ).run(`uia_${crypto.randomUUID().slice(0, 8)}`, id, params.administrativeUnitId, params.actorCtx.user.id, nowIso);

      for (const w of params.wardNos || []) {
        db.prepare(
          `INSERT INTO user_ward_assignments (
            id, user_id, administrative_unit_id, ward_no, is_active, assigned_by, created_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?)`
        ).run(`uwa_${crypto.randomUUID().slice(0, 8)}`, id, params.administrativeUnitId, w, params.actorCtx.user.id, nowIso);
      }

      for (const d of params.departments || []) {
        db.prepare(
          `INSERT INTO user_department_assignments (
            id, user_id, administrative_unit_id, department_code, is_active, assigned_by, created_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?)`
        ).run(`uda_${crypto.randomUUID().slice(0, 8)}`, id, params.administrativeUnitId, d, params.actorCtx.user.id, nowIso);
      }
    }

    appendPermissionAuditLog({
      actorId: params.actorCtx.user.id,
      actorRole: params.actorCtx.user.primary_role,
      actorNameBn: params.actorCtx.user.name_bn,
      actionType: 'user_created',
      targetType: 'user',
      targetId: id,
      unitId: params.administrativeUnitId || null,
      after: { username: cleanUser, primary_role: params.primaryRole, wardNos: params.wardNos, departments: params.departments },
      reasonBn: `নতুন ব্যবহারকারী তৈরি: ${params.nameBn}`,
    });

    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }

  return listUsersWithAssignments().find((u) => u.id === id)!;
}

export function setRoleActiveStatusTransactional(params: {
  actorCtx: ActorRbacContext;
  roleSlug: string;
  isActive: boolean;
}): RbacRole {
  const db = getDb().db;
  if (params.roleSlug === 'super_admin' && !params.isActive) {
    throw new RbacError(400, 'Cannot deactivate system super_admin role', 'সুপার অ্যাডমিন রোল নিষ্ক্রিয় করা যাবে না।');
  }
  const existing = db.prepare('SELECT * FROM roles WHERE slug = ?').get(params.roleSlug) as Record<string, unknown> | undefined;
  if (!existing) {
    throw new RbacError(404, 'Role not found', 'রোল খুঁজে পাওয়া যায়নি।');
  }
  const nowIso = new Date().toISOString();
  db.prepare('UPDATE roles SET is_active = ?, updated_at = ? WHERE slug = ?').run(
    params.isActive ? 1 : 0,
    nowIso,
    params.roleSlug
  );
  appendPermissionAuditLog({
    actorId: params.actorCtx.user.id,
    actorRole: params.actorCtx.user.primary_role,
    actorNameBn: params.actorCtx.user.name_bn,
    actionType: params.isActive ? 'role_activated' : 'role_deactivated',
    targetType: 'role',
    targetId: params.roleSlug,
    before: { is_active: Number(existing.is_active) === 1 },
    after: { is_active: params.isActive },
    reasonBn: `${params.roleSlug} রোল ${params.isActive ? 'সক্রিয়' : 'নিষ্ক্রিয়'} করা হয়েছে`,
  });
  return listAllRoles().find((r) => r.slug === params.roleSlug)!;
}

export function setUserActiveStatusTransactional(params: {
  actorCtx: ActorRbacContext;
  targetUserId: string;
  isActive: boolean;
}): UserAccount {
  const db = getDb().db;
  if (params.targetUserId === params.actorCtx.user.id && !params.isActive) {
    throw new RbacError(400, 'Cannot deactivate own active session account', 'নিজের একাউন্ট নিজেই নিষ্ক্রিয় করা যাবে না।');
  }
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(params.targetUserId) as Record<string, unknown> | undefined;
  if (!target) {
    throw new RbacError(404, 'User not found', 'ব্যবহারকারী খুঁজে পাওয়া যায়নি।');
  }
  const isSuper = params.actorCtx.activeRoles.includes('super_admin');
  if (!isSuper && target.administrative_unit_id && !params.actorCtx.assignedInstitutions.includes(String(target.administrative_unit_id))) {
    throw new RbacError(403, 'Forbidden: cross-institution user status modification denied', 'অন্য প্রতিষ্ঠানের ব্যবহারকারীর অবস্থা পরিবর্তন করা যাবে না।');
  }

  db.prepare('UPDATE users SET is_active = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(
    params.isActive ? 1 : 0,
    params.targetUserId
  );
  appendPermissionAuditLog({
    actorId: params.actorCtx.user.id,
    actorRole: params.actorCtx.user.primary_role,
    actorNameBn: params.actorCtx.user.name_bn,
    actionType: params.isActive ? 'user_activated' : 'user_deactivated',
    targetType: 'user',
    targetId: params.targetUserId,
    unitId: target.administrative_unit_id ? String(target.administrative_unit_id) : null,
    before: { is_active: Number(target.is_active) === 1 },
    after: { is_active: params.isActive },
    reasonBn: `ব্যবহারকারী ${String(target.name_bn)} ${params.isActive ? 'সক্রিয়' : 'নিষ্ক্রিয়'} করা হয়েছে`,
  });
  return listUsersWithAssignments().find((u) => u.id === params.targetUserId)!;
}

export function revokeUserRoleTransactional(params: {
  actorCtx: ActorRbacContext;
  targetUserId: string;
  assignmentId: string;
}): void {
  const db = getDb().db;
  const row = db
    .prepare('SELECT * FROM user_roles WHERE id = ? AND user_id = ?')
    .get(params.assignmentId, params.targetUserId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new RbacError(404, 'Role assignment not found', 'রোল অ্যাসাইনমেন্ট পাওয়া যায়নি।');
  }
  db.prepare('UPDATE user_roles SET is_active = 0 WHERE id = ?').run(params.assignmentId);
  appendPermissionAuditLog({
    actorId: params.actorCtx.user.id,
    actorRole: params.actorCtx.user.primary_role,
    actorNameBn: params.actorCtx.user.name_bn,
    actionType: 'user_role_revoked',
    targetType: 'user',
    targetId: params.targetUserId,
    unitId: row.administrative_unit_id ? String(row.administrative_unit_id) : null,
    before: { role_slug: String(row.role_slug), is_active: true },
    after: { role_slug: String(row.role_slug), is_active: false },
    reasonBn: `রোল বাতিল: ${String(row.role_slug)}`,
  });
}

export function revokeUserOverrideTransactional(params: {
  actorCtx: ActorRbacContext;
  targetUserId: string;
  overrideId: string;
}): void {
  const db = getDb().db;
  const row = db
    .prepare('SELECT * FROM user_permission_overrides WHERE id = ? AND user_id = ?')
    .get(params.overrideId, params.targetUserId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new RbacError(404, 'Override not found', 'ওভাররাইড খুঁজে পাওয়া যায়নি।');
  }
  db.prepare('UPDATE user_permission_overrides SET is_active = 0 WHERE id = ?').run(params.overrideId);
  appendPermissionAuditLog({
    actorId: params.actorCtx.user.id,
    actorRole: params.actorCtx.user.primary_role,
    actorNameBn: params.actorCtx.user.name_bn,
    actionType: 'permission_override_deactivated',
    targetType: 'override',
    targetId: params.targetUserId,
    before: { permission_key: String(row.permission_key), effect: String(row.effect) },
    after: { is_active: false },
    reasonBn: `পারমিশন ওভাররাইড বাতিল (${String(row.permission_key)})`,
  });
}

export function revokeApprovalAuthorityTransactional(params: {
  actorCtx: ActorRbacContext;
  authorityId: string;
}): void {
  const db = getDb().db;
  const row = db.prepare('SELECT * FROM approval_authority_assignments WHERE id = ?').get(params.authorityId) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    throw new RbacError(404, 'Approval authority assignment not found', 'অনুমোদন ক্ষমতা এন্ট্রি পাওয়া যায়নি।');
  }
  db.prepare('UPDATE approval_authority_assignments SET is_active = 0 WHERE id = ?').run(params.authorityId);
  appendPermissionAuditLog({
    actorId: params.actorCtx.user.id,
    actorRole: params.actorCtx.user.primary_role,
    actorNameBn: params.actorCtx.user.name_bn,
    actionType: 'approval_authority_revoked',
    targetType: 'approval_authority',
    targetId: String(row.user_id),
    unitId: String(row.administrative_unit_id),
    before: { service_id: String(row.service_id), role_slug: String(row.role_slug) },
    after: { is_active: false },
    reasonBn: `অনুমোদন ক্ষমতা প্রত্যাহার (${String(row.service_id)})`,
  });
}

export function adminResetUserPasswordTransactional(params: {
  actorCtx: ActorRbacContext;
  targetUserId: string;
  newPassword: string;
}): void {
  const db = getDb().db;
  if (!validateStrongPassword(params.newPassword)) {
    throw new RbacError(
      400,
      'Password must be at least 8 characters and include both letters and numbers',
      'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের এবং অক্ষর ও সংখ্যার সমন্বয়ে হতে হবে।'
    );
  }
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(params.targetUserId) as Record<string, unknown> | undefined;
  if (!target) {
    throw new RbacError(404, 'User not found', 'ব্যবহারকারী খুঁজে পাওয়া যায়নি।');
  }
  const pwHash = hashPassword(params.newPassword);
  db.prepare('UPDATE users SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(
    pwHash,
    params.targetUserId
  );
  appendPermissionAuditLog({
    actorId: params.actorCtx.user.id,
    actorRole: params.actorCtx.user.primary_role,
    actorNameBn: params.actorCtx.user.name_bn,
    actionType: 'user_password_reset',
    targetType: 'user',
    targetId: params.targetUserId,
    unitId: target.administrative_unit_id ? String(target.administrative_unit_id) : null,
    reasonBn: `প্রশাসনিক আদেশে পাসওয়ার্ড রিসেট ও একাউন্ট আনলক (${String(target.name_bn)})`,
  });
}

