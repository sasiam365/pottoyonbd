import type {
  AdministrativeUnit,
  Application,
  ApplicationApproval,
  ApplicationAttachment,
  ApplicationStatus,
  ApprovalAuthorityAssignment,
  Certificate,
  CertificateEvent,
  CertificateTemplate,
  CertificateVerificationLog,
  CitizenNotification,
  ContactInquiry,
  DashboardStatsResponse,
  HoldingTaxRecord,
  MonitoringObservation,
  Notice,
  PaginatedResult,
  PermissionAuditLog,
  PermissionKey,
  PermissionScope,
  RbacPermission,
  RbacRole,
  RefundRequest,
  RoleCategory,
  RolePermissionAssignment,
  RolePermissionEntry,
  Service,
  StaffMember,
  SystemSettings,
  TradeLicenseRecord,
  UserAccount,
  UserPermissionOverride,
  UserRole,
  UserRoleAssignment,
  UserSession,
  VerificationResponse,
  WardOrDepartment,
} from '../types';

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message_bn || data.error || `Request failed (${res.status})`) as Error & {
      status?: number;
      data?: unknown;
    };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

export const api = {
  async login(payload: {
    role: UserRole;
    administrative_unit_id?: string;
    username: string;
    password: string;
    otp?: string;
  }): Promise<{ token: string; session: UserSession }> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async switchRole(role: UserRole, administrativeUnitId?: string, username?: string): Promise<{ token: string; session: UserSession }> {
    const res = await fetch('/api/auth/switch-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, administrative_unit_id: administrativeUnitId, username }),
    });
    return parseJson(res);
  },

  async logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
  },

  async requestPasswordReset(identifier: string): Promise<{ success: boolean; message_bn: string; reset_token_preview?: string }> {
    const res = await fetch('/api/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier }),
    });
    return parseJson(res);
  },

  async confirmPasswordReset(token: string, newPassword: string): Promise<{ success: boolean; message_bn: string }> {
    const res = await fetch('/api/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, new_password: newPassword }),
    });
    return parseJson(res);
  },

  async getDashboardStats(token: string, unitId?: string): Promise<DashboardStatsResponse> {
    const url = unitId && unitId !== 'all' ? `/api/dashboard/stats?unit_id=${encodeURIComponent(unitId)}` : '/api/dashboard/stats';
    const res = await fetch(url, { headers: authHeaders(token) });
    return parseJson(res);
  },

  async getCitizenPortal(params: { mobile?: string; tracking_no?: string; token?: string }): Promise<{
    applications: Application[];
    certificates: Certificate[];
    notifications: CitizenNotification[];
  }> {
    const q = new URLSearchParams();
    if (params.mobile) q.set('mobile', params.mobile);
    if (params.tracking_no) q.set('tracking_no', params.tracking_no);
    const res = await fetch(`/api/citizen/portal?${q.toString()}`, {
      headers: params.token ? authHeaders(params.token) : undefined,
    });
    return parseJson(res);
  },

  async listApplications(token: string, unitId?: string): Promise<Application[]> {
    const url = unitId && unitId !== 'all' ? `/api/applications?unit_id=${encodeURIComponent(unitId)}` : '/api/applications';
    const res = await fetch(url, { headers: authHeaders(token) });
    return parseJson(res);
  },

  async queryApplications(
    token: string,
    params: {
      unit_id?: string;
      q?: string;
      status?: string;
      service_id?: string;
      page?: number;
      page_size?: number;
    }
  ): Promise<PaginatedResult<Application>> {
    const q = new URLSearchParams({ paginated: '1' });
    if (params.unit_id && params.unit_id !== 'all') q.set('unit_id', params.unit_id);
    if (params.q) q.set('q', params.q);
    if (params.status) q.set('status', params.status);
    if (params.service_id) q.set('service_id', params.service_id);
    if (params.page) q.set('page', String(params.page));
    if (params.page_size) q.set('page_size', String(params.page_size));
    const res = await fetch(`/api/applications?${q.toString()}`, { headers: authHeaders(token) });
    return parseJson(res);
  },

  async getApplicationByTracking(
    trackingNo: string,
    token?: string
  ): Promise<Application & { certificate?: Certificate; notifications?: CitizenNotification[]; approvals?: ApplicationApproval[] }> {
    const res = await fetch(`/api/applications/${encodeURIComponent(trackingNo)}`, {
      headers: token ? authHeaders(token) : undefined,
    });
    return parseJson(res);
  },

  async createApplication(app: Partial<Application>, token?: string): Promise<Application> {
    const res = await fetch('/api/applications', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(app),
    });
    return parseJson(res);
  },

  async uploadAttachment(
    applicationId: string,
    payload: { doc_type: 'nid' | 'photo' | 'proof' | 'other'; original_name: string; mime_type: string; content_base64: string }
  ): Promise<ApplicationAttachment> {
    const res = await fetch(`/api/applications/${encodeURIComponent(applicationId)}/attachments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async resubmitApplication(
    applicationId: string,
    payload: { tracking_no: string; applicant_name_bn?: string; present_address_bn?: string; correction_response: string }
  ): Promise<Application> {
    const res = await fetch(`/api/applications/${encodeURIComponent(applicationId)}/resubmit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async checkoutPayment(payload: {
    applicationId: string;
    method: 'bkash' | 'nagad' | 'rocket' | 'card';
    amount: number;
  }): Promise<{ success: boolean; transaction_id: string; amount: number; paid_at: string; application: Application }> {
    const res = await fetch('/api/payments/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async updateApplicationStatus(
    token: string,
    id: string,
    status: ApplicationStatus,
    note?: string
  ): Promise<Application> {
    const res = await fetch(`/api/applications/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ status, note }),
    });
    return parseJson(res);
  },

  async assignApplicationOfficer(
    token: string,
    applicationId: string,
    payload: { staff_id?: string; officer_name_bn?: string }
  ): Promise<Application> {
    const res = await fetch(`/api/applications/${encodeURIComponent(applicationId)}/assign`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async requestApplicationCorrection(token: string, applicationId: string, reason: string): Promise<Application> {
    const res = await fetch(`/api/applications/${encodeURIComponent(applicationId)}/request-correction`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ reason }),
    });
    return parseJson(res);
  },

  async getApplicationHistory(
    token: string,
    applicationId: string
  ): Promise<{ approvals: ApplicationApproval[]; events: CertificateEvent[] }> {
    const res = await fetch(`/api/applications/${encodeURIComponent(applicationId)}/history`, {
      headers: authHeaders(token),
    });
    return parseJson(res);
  },

  async finalApproveAndIssue(
    token: string,
    applicationId: string,
    options?: { notes?: string; expires_in_days?: number | null }
  ): Promise<{
    already_issued: boolean;
    certificate: Certificate;
    application: Application;
    verification_url?: string;
  }> {
    const res = await fetch(`/api/applications/${encodeURIComponent(applicationId)}/final-approve`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(options || {}),
    });
    return parseJson(res);
  },

  async listCertificates(token: string, unitId?: string): Promise<Certificate[]> {
    const url = unitId && unitId !== 'all' ? `/api/certificates?unit_id=${encodeURIComponent(unitId)}` : '/api/certificates';
    const res = await fetch(url, { headers: authHeaders(token) });
    return parseJson(res);
  },

  async queryCertificates(
    token: string,
    params: {
      unit_id?: string;
      q?: string;
      status?: string;
      service_id?: string;
      date_from?: string;
      date_to?: string;
      sort_by?: string;
      sort_dir?: 'asc' | 'desc';
      page?: number;
      page_size?: number;
    }
  ): Promise<PaginatedResult<Certificate>> {
    const q = new URLSearchParams({ paginated: '1' });
    if (params.unit_id && params.unit_id !== 'all') q.set('unit_id', params.unit_id);
    if (params.q) q.set('q', params.q);
    if (params.status) q.set('status', params.status);
    if (params.service_id) q.set('service_id', params.service_id);
    if (params.date_from) q.set('date_from', params.date_from);
    if (params.date_to) q.set('date_to', params.date_to);
    if (params.sort_by) q.set('sort_by', params.sort_by);
    if (params.sort_dir) q.set('sort_dir', params.sort_dir);
    if (params.page) q.set('page', String(params.page));
    if (params.page_size) q.set('page_size', String(params.page_size));
    const res = await fetch(`/api/certificates?${q.toString()}`, { headers: authHeaders(token) });
    return parseJson(res);
  },

  getCertificatesExportUrl(
    token: string,
    params: { unit_id?: string; q?: string; status?: string; service_id?: string }
  ): string {
    const q = new URLSearchParams({ auth_token: token });
    if (params.unit_id && params.unit_id !== 'all') q.set('unit_id', params.unit_id);
    if (params.q) q.set('q', params.q);
    if (params.status) q.set('status', params.status);
    if (params.service_id) q.set('service_id', params.service_id);
    return `/api/certificates/export?${q.toString()}`;
  },

  async revokeCertificate(
    token: string,
    certificateId: string,
    reason: string
  ): Promise<{ success: boolean; certificate: Certificate }> {
    const res = await fetch(`/api/certificates/${encodeURIComponent(certificateId)}/revoke`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ reason }),
    });
    return parseJson(res);
  },

  async reissueCertificate(
    token: string,
    certificateId: string,
    options?: { notes?: string; expires_in_days?: number | null }
  ): Promise<{
    already_issued: boolean;
    certificate: Certificate;
    application: Application;
    verification_url?: string;
  }> {
    const res = await fetch(`/api/certificates/${encodeURIComponent(certificateId)}/reissue`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(options || {}),
    });
    return parseJson(res);
  },

  async getCertificateHistory(
    token: string,
    certificateId: string
  ): Promise<{
    events: CertificateEvent[];
    approvals: ApplicationApproval[];
    verification_logs: CertificateVerificationLog[];
  }> {
    const res = await fetch(`/api/certificates/${encodeURIComponent(certificateId)}/history`, {
      headers: authHeaders(token),
    });
    return parseJson(res);
  },

  async getCertificateById(
    certificateId: string,
    options?: { authToken?: string; trackingNo?: string }
  ): Promise<Certificate> {
    const q = new URLSearchParams();
    if (options?.trackingNo) q.set('tracking_no', options.trackingNo);
    const qs = q.toString();
    const res = await fetch(
      `/api/certificates/${encodeURIComponent(certificateId)}${qs ? `?${qs}` : ''}`,
      {
        headers: options?.authToken ? authHeaders(options.authToken) : {},
        credentials: 'include',
      }
    );
    return parseJson(res);
  },

  async verifyCertificate(rawToken: string): Promise<{ statusCode: number; data: VerificationResponse }> {
    const res = await fetch(`/api/verify/${encodeURIComponent(rawToken.trim())}`);
    const data = (await res.json().catch(() => ({}))) as VerificationResponse;
    return { statusCode: res.status, data };
  },

  async getAuditLogs(
    token: string,
    unitId?: string
  ): Promise<{
    events: CertificateEvent[];
    verification_logs: CertificateVerificationLog[];
    approvals: ApplicationApproval[];
  }> {
    const url = unitId && unitId !== 'all' ? `/api/audit-logs?unit_id=${encodeURIComponent(unitId)}` : '/api/audit-logs';
    const res = await fetch(url, { headers: authHeaders(token) });
    return parseJson(res);
  },

  async getCertificateTemplates(): Promise<CertificateTemplate[]> {
    const res = await fetch('/api/certificate-templates');
    return parseJson(res);
  },

  async getNotifications(params: { token?: string; trackingNo?: string }): Promise<CitizenNotification[]> {
    const url = params.trackingNo
      ? `/api/notifications?tracking_no=${encodeURIComponent(params.trackingNo)}`
      : '/api/notifications';
    const res = await fetch(url, { headers: authHeaders(params.token) });
    return parseJson(res);
  },

  getPdfDownloadUrl(
    certificateId: string,
    options: { authToken?: string; trackingNo?: string; inline?: boolean }
  ): string {
    const q = new URLSearchParams();
    if (options.authToken) q.set('auth_token', options.authToken);
    if (options.trackingNo) q.set('tracking_no', options.trackingNo);
    if (options.inline) q.set('inline', '1');
    const qs = q.toString();
    return `/api/certificates/${encodeURIComponent(certificateId)}/pdf${qs ? `?${qs}` : ''}`;
  },

  // --- Holding Taxes, Trade Licenses, Notices ---
  async listHoldingTaxes(unitId?: string): Promise<HoldingTaxRecord[]> {
    const url = unitId && unitId !== 'all' ? `/api/holding-taxes?unit_id=${encodeURIComponent(unitId)}` : '/api/holding-taxes';
    const res = await fetch(url);
    return parseJson(res);
  },

  async createHoldingTax(token: string, payload: Partial<HoldingTaxRecord>): Promise<HoldingTaxRecord> {
    const res = await fetch('/api/holding-taxes', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async payHoldingTax(token: string, id: string, amount?: number): Promise<HoldingTaxRecord> {
    const res = await fetch(`/api/holding-taxes/${encodeURIComponent(id)}/pay`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ amount }),
    });
    return parseJson(res);
  },

  async listTradeLicenses(unitId?: string): Promise<TradeLicenseRecord[]> {
    const url = unitId && unitId !== 'all' ? `/api/trade-licenses?unit_id=${encodeURIComponent(unitId)}` : '/api/trade-licenses';
    const res = await fetch(url);
    return parseJson(res);
  },

  async createTradeLicense(token: string, payload: Partial<TradeLicenseRecord>): Promise<TradeLicenseRecord> {
    const res = await fetch('/api/trade-licenses', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async renewTradeLicense(token: string, id: string): Promise<TradeLicenseRecord> {
    const res = await fetch(`/api/trade-licenses/${encodeURIComponent(id)}/renew`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    return parseJson(res);
  },

  async listNotices(unitId?: string): Promise<Notice[]> {
    const url = unitId && unitId !== 'all' ? `/api/notices?unit_id=${encodeURIComponent(unitId)}` : '/api/notices';
    const res = await fetch(url);
    return parseJson(res);
  },

  async createNotice(token: string, payload: Partial<Notice>): Promise<Notice> {
    const res = await fetch('/api/notices', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async deleteNotice(token: string, id: string): Promise<void> {
    const res = await fetch(`/api/notices/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    await parseJson(res);
  },

  // --- Staff, Wards/Departments, Institutions, Services, Permissions, Settings ---
  async listStaff(token: string, unitId?: string): Promise<StaffMember[]> {
    const url = unitId && unitId !== 'all' ? `/api/staff?unit_id=${encodeURIComponent(unitId)}` : '/api/staff';
    const res = await fetch(url, { headers: authHeaders(token) });
    return parseJson(res);
  },

  async createStaff(token: string, payload: Partial<StaffMember>): Promise<StaffMember> {
    const res = await fetch('/api/staff', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async updateStaff(token: string, id: string, payload: Partial<StaffMember>): Promise<StaffMember> {
    const res = await fetch(`/api/staff/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async listWardsDepartments(token: string, unitId?: string, kind?: 'ward' | 'department'): Promise<WardOrDepartment[]> {
    const q = new URLSearchParams();
    if (unitId && unitId !== 'all') q.set('unit_id', unitId);
    if (kind) q.set('kind', kind);
    const qs = q.toString();
    const res = await fetch(`/api/wards-departments${qs ? `?${qs}` : ''}`, { headers: authHeaders(token) });
    return parseJson(res);
  },

  async createWardOrDepartment(token: string, payload: Partial<WardOrDepartment>): Promise<WardOrDepartment> {
    const res = await fetch('/api/wards-departments', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async updateInstitution(
    token: string,
    unitId: string,
    payload: Partial<AdministrativeUnit>
  ): Promise<AdministrativeUnit> {
    const res = await fetch(`/api/institutions/${encodeURIComponent(unitId)}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async listServices(): Promise<Service[]> {
    const res = await fetch('/api/services');
    return parseJson(res);
  },

  async updateService(token: string, serviceId: string, payload: Partial<Service>): Promise<Service> {
    const res = await fetch(`/api/services/${encodeURIComponent(serviceId)}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async listRolePermissions(token: string): Promise<RolePermissionEntry[]> {
    const res = await fetch('/api/role-permissions', { headers: authHeaders(token) });
    return parseJson(res);
  },

  async updateRolePermission(
    token: string,
    role: UserRole,
    payload: Partial<RolePermissionEntry>
  ): Promise<RolePermissionEntry> {
    const res = await fetch(`/api/role-permissions/${encodeURIComponent(role)}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async getSystemSettings(token: string): Promise<SystemSettings> {
    const res = await fetch('/api/system-settings', { headers: authHeaders(token) });
    return parseJson(res);
  },

  async updateSystemSettings(token: string, payload: Partial<SystemSettings>): Promise<SystemSettings> {
    const res = await fetch('/api/system-settings', {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async submitContactInquiry(payload: { name: string; phone: string; subject: string; message: string }): Promise<ContactInquiry> {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async listContactInquiries(token: string): Promise<ContactInquiry[]> {
    const res = await fetch('/api/contact', { headers: authHeaders(token) });
    return parseJson(res);
  },

  // --- RBAC Management, Monitoring, Refund Requests & Backups ---
  async listRbacRoles(token: string): Promise<RbacRole[]> {
    const res = await fetch('/api/rbac/roles', { headers: authHeaders(token) });
    return parseJson(res);
  },

  async createRbacRole(
    token: string,
    payload: {
      slug: string;
      name_en: string;
      name_bn: string;
      category: RoleCategory;
      institution_type?: 'union_parishad' | 'municipality' | null;
      default_scope: PermissionScope;
      description_bn: string;
      assignments: Array<{ permission_key: PermissionKey; scope: PermissionScope }>;
    }
  ): Promise<RbacRole> {
    const res = await fetch('/api/rbac/roles', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async toggleRbacRoleStatus(token: string, slug: string, isActive: boolean): Promise<RbacRole> {
    const res = await fetch(`/api/rbac/roles/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ is_active: isActive }),
    });
    return parseJson(res);
  },

  async listRbacPermissions(token: string): Promise<RbacPermission[]> {
    const res = await fetch('/api/rbac/permissions', { headers: authHeaders(token) });
    return parseJson(res);
  },

  async getRolePermissionsV2(token: string, slug: string): Promise<RolePermissionAssignment[]> {
    const res = await fetch(`/api/rbac/roles/${encodeURIComponent(slug)}/permissions`, {
      headers: authHeaders(token),
    });
    return parseJson(res);
  },

  async updateRolePermissionsV2(
    token: string,
    slug: string,
    assignments: Array<{ permission_key: PermissionKey; scope: PermissionScope; granted: boolean }>,
    reasonBn?: string
  ): Promise<RolePermissionAssignment[]> {
    const res = await fetch(`/api/rbac/roles/${encodeURIComponent(slug)}/permissions`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ assignments, reason_bn: reasonBn }),
    });
    return parseJson(res);
  },

  async listRbacUsers(token: string, unitId?: string): Promise<UserAccount[]> {
    const url = unitId && unitId !== 'all' ? `/api/rbac/users?unit_id=${encodeURIComponent(unitId)}` : '/api/rbac/users';
    const res = await fetch(url, { headers: authHeaders(token) });
    return parseJson(res);
  },

  async createRbacUser(
    token: string,
    payload: {
      username: string;
      password: string;
      name_bn: string;
      title_bn: string;
      mobile: string;
      email?: string;
      primary_role: string;
      administrative_unit_id?: string | null;
      ward_nos?: number[];
      departments?: string[];
      mfa_enabled?: boolean;
    }
  ): Promise<UserAccount> {
    const res = await fetch('/api/rbac/users', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async toggleRbacUserStatus(token: string, userId: string, isActive: boolean): Promise<UserAccount> {
    const res = await fetch(`/api/rbac/users/${encodeURIComponent(userId)}/status`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ is_active: isActive }),
    });
    return parseJson(res);
  },

  async adminResetUserPassword(token: string, userId: string, newPassword: string): Promise<void> {
    const res = await fetch(`/api/rbac/users/${encodeURIComponent(userId)}/reset-password`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ new_password: newPassword }),
    });
    await parseJson(res);
  },

  async assignUserRoleAndScope(
    token: string,
    userId: string,
    payload: {
      role_slug: string;
      administrative_unit_id?: string | null;
      ward_nos?: number[];
      departments?: string[];
      expires_at?: string | null;
      reason_bn?: string;
    }
  ): Promise<UserRoleAssignment> {
    const res = await fetch(`/api/rbac/users/${encodeURIComponent(userId)}/roles`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async revokeUserRole(token: string, userId: string, assignmentId: string): Promise<void> {
    const res = await fetch(
      `/api/rbac/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(assignmentId)}`,
      { method: 'DELETE', headers: authHeaders(token) }
    );
    await parseJson(res);
  },

  async createUserOverride(
    token: string,
    userId: string,
    payload: {
      permission_key: PermissionKey;
      scope: PermissionScope;
      effect: 'grant' | 'revoke';
      expires_at?: string | null;
      reason_bn?: string;
    }
  ): Promise<UserPermissionOverride> {
    const res = await fetch(`/api/rbac/users/${encodeURIComponent(userId)}/overrides`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async revokeUserOverride(token: string, userId: string, overrideId: string): Promise<void> {
    const res = await fetch(
      `/api/rbac/users/${encodeURIComponent(userId)}/overrides/${encodeURIComponent(overrideId)}`,
      { method: 'DELETE', headers: authHeaders(token) }
    );
    await parseJson(res);
  },

  async listApprovalAuthorities(token: string, unitId?: string): Promise<ApprovalAuthorityAssignment[]> {
    const url = unitId && unitId !== 'all'
      ? `/api/rbac/approval-authorities?unit_id=${encodeURIComponent(unitId)}`
      : '/api/rbac/approval-authorities';
    const res = await fetch(url, { headers: authHeaders(token) });
    return parseJson(res);
  },

  async grantApprovalAuthority(
    token: string,
    payload: {
      user_id: string;
      role_slug: string;
      administrative_unit_id: string;
      service_id: string;
      max_fee_limit?: number | null;
      expires_at?: string | null;
      delegation_note_bn: string;
      allow_self_approval?: boolean;
    }
  ): Promise<ApprovalAuthorityAssignment> {
    const res = await fetch('/api/rbac/approval-authorities', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async revokeApprovalAuthority(token: string, id: string): Promise<void> {
    const res = await fetch(`/api/rbac/approval-authorities/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    await parseJson(res);
  },

  async listPermissionAuditLogs(token: string, unitId?: string): Promise<PermissionAuditLog[]> {
    const url = unitId && unitId !== 'all'
      ? `/api/rbac/audit-logs?unit_id=${encodeURIComponent(unitId)}`
      : '/api/rbac/audit-logs';
    const res = await fetch(url, { headers: authHeaders(token) });
    return parseJson(res);
  },

  async listMonitoringObservations(token: string, unitId?: string): Promise<MonitoringObservation[]> {
    const url = unitId && unitId !== 'all'
      ? `/api/monitoring/observations?unit_id=${encodeURIComponent(unitId)}`
      : '/api/monitoring/observations';
    const res = await fetch(url, { headers: authHeaders(token) });
    return parseJson(res);
  },

  async createMonitoringObservation(
    token: string,
    payload: { administrative_unit_id: string; application_id?: string | null; observation_bn: string; severity?: 'info' | 'warning' | 'critical' | 'overdue' }
  ): Promise<MonitoringObservation> {
    const res = await fetch('/api/monitoring/observations', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async listRefundRequests(token: string, unitId?: string): Promise<RefundRequest[]> {
    const url = unitId && unitId !== 'all'
      ? `/api/payments/refund-requests?unit_id=${encodeURIComponent(unitId)}`
      : '/api/payments/refund-requests';
    const res = await fetch(url, { headers: authHeaders(token) });
    return parseJson(res);
  },

  async createRefundRequest(
    token: string,
    payload: { application_id: string; amount?: number; reason_bn: string }
  ): Promise<RefundRequest> {
    const res = await fetch('/api/payments/refund-requests', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  },

  async decideRefundRequest(
    token: string,
    id: string,
    decision: 'approved' | 'rejected'
  ): Promise<RefundRequest> {
    const res = await fetch(`/api/payments/refund-requests/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ decision }),
    });
    return parseJson(res);
  },

  getBackupExportUrl(token: string): string {
    return `/api/backups/export?auth_token=${encodeURIComponent(token)}`;
  },

  async resetDatabase(): Promise<void> {
    const res = await fetch('/api/reset', { method: 'POST' });
    await parseJson(res);
  },
};
