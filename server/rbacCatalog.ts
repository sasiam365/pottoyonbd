import type {
  PermissionKey,
  PermissionScope,
  RbacPermission,
  RoleCategory,
  RolePermissionEntry,
  UserRole,
} from '../src/types/index.ts';

export interface SystemRoleSeed {
  id: string;
  slug: UserRole;
  name_en: string;
  name_bn: string;
  category: RoleCategory;
  institution_type: 'union_parishad' | 'municipality' | null;
  default_scope: PermissionScope;
  is_optional: boolean;
  description_bn: string;
}

export const SYSTEM_ROLES: SystemRoleSeed[] = [
  {
    id: 'role_super_admin',
    slug: 'super_admin',
    name_en: 'Super Admin',
    name_bn: 'সুপার অ্যাডমিন',
    category: 'global',
    institution_type: null,
    default_scope: 'global',
    is_optional: false,
    description_bn:
      'সম্পূর্ণ প্ল্যাটফর্ম, প্রতিষ্ঠান, ব্যবহারকারী, রোল-পারমিশন, ইন্টিগ্রেশন, নিরাপত্তা, ব্যাকআপ ও অডিট লগ ব্যবস্থাপনা (আইনি সনদ অনুমোদন ব্যতীত)।',
  },
  {
    id: 'role_upazila_admin',
    slug: 'upazila_admin',
    name_en: 'Upazila Admin',
    name_bn: 'উপজেলা প্রশাসক (UNO)',
    category: 'upazila',
    institution_type: null,
    default_scope: 'upazila',
    is_optional: false,
    description_bn:
      'পাবনা সদর উপজেলার অধীনস্থ ১০টি ইউনিয়ন পরিষদ ও পাবনা পৌরসভার সামগ্রিক তদারকি, বকেয়া আবেদন ও কর্মদক্ষতা প্রতিবেদন পর্যবেক্ষণ।',
  },
  {
    id: 'role_upazila_monitoring_officer',
    slug: 'upazila_monitoring_officer',
    name_en: 'Upazila Monitoring Officer',
    name_bn: 'উপজেলা মনিটরিং কর্মকর্তা',
    category: 'upazila',
    institution_type: null,
    default_scope: 'upazila',
    is_optional: true,
    description_bn:
      'অধীনস্থ প্রতিষ্ঠানের অনিষ্পন্ন আবেদন, নিষ্পত্তি সময় ও মনিটরিং পর্যবেক্ষণ নথিভুক্তকরণ (অনুমোদন বা অর্থ পরিবর্তনের ক্ষমতা নেই)।',
  },
  {
    id: 'role_union_admin',
    slug: 'union_admin',
    name_en: 'Union Admin',
    name_bn: 'ইউনিয়ন প্রশাসক',
    category: 'union_parishad',
    institution_type: 'union_parishad',
    default_scope: 'institution',
    is_optional: false,
    description_bn:
      'নির্ধারিত ইউনিয়ন পরিষদের কর্মচারী, সেবা ফি, নোটিশ, আবেদন বণ্টন, স্থানীয় সেটিংস ও প্রতিষ্ঠানিক প্রতিবেদন পরিচালনা।',
  },
  {
    id: 'role_chairman',
    slug: 'chairman',
    name_en: 'Chairman / Authorized Approving Officer',
    name_bn: 'চেয়ারম্যান / অনুমোদনকারী কর্মকর্তা',
    category: 'union_parishad',
    institution_type: 'union_parishad',
    default_scope: 'institution',
    is_optional: false,
    description_bn:
      'নির্ধারিত ইউনিয়ন পরিষদের অনুমোদিত সেবাসমূহের চূড়ান্ত সনদ অনুমোদন, বাতিল, পুনঃইস্যু ও সংশোধন অনুরোধ।',
  },
  {
    id: 'role_secretary',
    slug: 'secretary',
    name_en: 'Secretary',
    name_bn: 'ইউনিয়ন পরিষদ সচিব',
    category: 'union_parishad',
    institution_type: 'union_parishad',
    default_scope: 'institution',
    is_optional: false,
    description_bn:
      'নির্ধারিত ইউনিয়নের আবেদনের কাগজপত্র যাচাই, নোট লিপিবদ্ধ, সংশোধন অনুরোধ ও অনুমোদনের জন্য ফরোয়ার্ডিং।',
  },
  {
    id: 'role_ward_member',
    slug: 'ward_member',
    name_en: 'Ward Member',
    name_bn: 'ওয়ার্ড সদস্য',
    category: 'union_parishad',
    institution_type: 'union_parishad',
    default_scope: 'ward',
    is_optional: false,
    description_bn:
      'কেবলমাত্র নির্ধারিত ওয়ার্ডের সরেজমিন তদন্ত, তথ্য যাচাই ও সুপারিশ প্রদান (অর্থ ও অন্য ওয়ার্ডে প্রবেশাধিকার নেই)।',
  },
  {
    id: 'role_union_accountant',
    slug: 'union_accountant',
    name_en: 'Union Accountant',
    name_bn: 'ইউনিয়ন হিসাব সহকারী',
    category: 'union_parishad',
    institution_type: 'union_parishad',
    default_scope: 'institution',
    is_optional: false,
    description_bn:
      'নির্ধারিত ইউনিয়নের ফি লেনদেন, হোল্ডিং ট্যাক্স, ট্রেড লাইসেন্স রাজস্ব সমন্বয় ও রিফান্ড অনুরোধ দাখিল।',
  },
  {
    id: 'role_union_service_operator',
    slug: 'union_service_operator',
    name_en: 'Union Service Operator',
    name_bn: 'ইউনিয়ন সেবা অপারেটর (UDC)',
    category: 'union_parishad',
    institution_type: 'union_parishad',
    default_scope: 'assigned',
    is_optional: true,
    description_bn:
      'নাগরিকদের পক্ষে আবেদন এন্ট্রি, নথি আপলোড, সম্পূর্ণতা যাচাই ও আবেদন জমা প্রদান (অনুমোদন বা বাতিল ক্ষমতা নেই)।',
  },
  {
    id: 'role_municipality_admin',
    slug: 'municipality_admin',
    name_en: 'Municipality Admin',
    name_bn: 'পৌর প্রশাসক',
    category: 'municipality',
    institution_type: 'municipality',
    default_scope: 'institution',
    is_optional: false,
    description_bn:
      'পাবনা পৌরসভার কর্মচারী, বিভাগ, সেবা কনফিগারেশন, নোটিশ ও স্বতন্ত্র পৌর প্রতিবেদন ব্যবস্থাপনা।',
  },
  {
    id: 'role_mayor',
    slug: 'mayor',
    name_en: 'Mayor / Authorized Approving Officer',
    name_bn: 'পৌর মেয়র / অনুমোদনকারী কর্মকর্তা',
    category: 'municipality',
    institution_type: 'municipality',
    default_scope: 'institution',
    is_optional: false,
    description_bn:
      'পাবনা পৌরসভার আইনি ক্ষমতাপ্রাপ্ত সেবাসমূহের চূড়ান্ত সনদ অনুমোদন, বাতিল ও পুনঃইস্যুকরণ।',
  },
  {
    id: 'role_executive_officer',
    slug: 'executive_officer',
    name_en: 'Executive Officer',
    name_bn: 'প্রধান নির্বাহী কর্মকর্তা (CEO)',
    category: 'municipality',
    institution_type: 'municipality',
    default_scope: 'institution',
    is_optional: false,
    description_bn:
      'পৌর প্রশাসনিক কর্মপ্রবাহ তদারকি, বিভাগীয় সমন্বয়, আবেদন ফরোয়ার্ড ও পৃথক অনুমোদন অর্পণ সাপেক্ষে সনদ অনুমোদন।',
  },
  {
    id: 'role_department_officer',
    slug: 'department_officer',
    name_en: 'Department Officer',
    name_bn: 'পৌর বিভাগীয় কর্মকর্তা',
    category: 'municipality',
    institution_type: 'municipality',
    default_scope: 'department',
    is_optional: false,
    description_bn:
      'কেবলমাত্র নির্ধারিত পৌর বিভাগের আবেদন যাচাই, সুপারিশ ও বিভাগীয় কর্মপ্রবাহ হালনাগাদকরণ।',
  },
  {
    id: 'role_municipality_accountant',
    slug: 'municipality_accountant',
    name_en: 'Municipality Accountant',
    name_bn: 'পৌর হিসাবরক্ষক',
    category: 'municipality',
    institution_type: 'municipality',
    default_scope: 'institution',
    is_optional: false,
    description_bn:
      'পাবনা পৌরসভার ফি, কর, রাজস্ব সমন্বয়, আর্থিক প্রতিবেদন ও রিফান্ড অনুরোধ পরিচালনা।',
  },
  {
    id: 'role_municipality_service_operator',
    slug: 'municipality_service_operator',
    name_en: 'Municipality Service Operator',
    name_bn: 'পৌর সেবা অপারেটর',
    category: 'municipality',
    institution_type: 'municipality',
    default_scope: 'assigned',
    is_optional: true,
    description_bn:
      'পৌর নাগরিকদের পক্ষে আবেদন তৈরি, নথি আপলোড ও আবেদনের অবস্থা ট্র্যাকিং।',
  },
  {
    id: 'role_citizen',
    slug: 'citizen',
    name_en: 'Citizen',
    name_bn: 'সাধারণ নাগরিক',
    category: 'public',
    institution_type: null,
    default_scope: 'own',
    is_optional: false,
    description_bn:
      'নিজ প্রোফাইল, অনলাইন আবেদন, ফি পরিশোধ, সংশোধন পুনঃদাখিল, নিজ সনদ ডাউনলোড ও QR যাচাই।',
  },
];

export const SYSTEM_PERMISSIONS: RbacPermission[] = [
  // DASHBOARD
  { key: 'dashboard.view', module: 'DASHBOARD', name_en: 'View Dashboard', name_bn: 'ড্যাশবোর্ড দেখা', is_sensitive: false },

  // APPLICATIONS
  { key: 'applications.view', module: 'APPLICATIONS', name_en: 'View Scoped Applications', name_bn: 'নির্ধারিত আবেদন দেখা', is_sensitive: false },
  { key: 'applications.view_assigned', module: 'APPLICATIONS', name_en: 'View Assigned Applications', name_bn: 'দায়িত্বপ্রাপ্ত আবেদন দেখা', is_sensitive: false },
  { key: 'applications.view_all', module: 'APPLICATIONS', name_en: 'View All Unit Applications', name_bn: 'সকল আবেদন দেখা', is_sensitive: false },
  { key: 'applications.create', module: 'APPLICATIONS', name_en: 'Create Applications', name_bn: 'আবেদন তৈরি করা', is_sensitive: false },
  { key: 'applications.edit', module: 'APPLICATIONS', name_en: 'Edit Applications', name_bn: 'আবেদন সম্পাদনা করা', is_sensitive: false },
  { key: 'applications.verify', module: 'APPLICATIONS', name_en: 'Verify Applications', name_bn: 'আবেদন ও নথি যাচাই', is_sensitive: false },
  { key: 'applications.forward', module: 'APPLICATIONS', name_en: 'Forward Applications', name_bn: 'অনুমোদনের জন্য প্রেরণ', is_sensitive: false },
  { key: 'applications.recommend', module: 'APPLICATIONS', name_en: 'Recommend Applications', name_bn: 'সুপারিশ প্রদান', is_sensitive: false },
  { key: 'applications.request_correction', module: 'APPLICATIONS', name_en: 'Request Correction', name_bn: 'সংশোধনের নির্দেশনা', is_sensitive: false },
  { key: 'applications.reject', module: 'APPLICATIONS', name_en: 'Reject Applications', name_bn: 'আবেদন প্রত্যাখ্যান', is_sensitive: true },
  { key: 'applications.approve', module: 'APPLICATIONS', name_en: 'Approve Applications', name_bn: 'চূড়ান্ত আবেদন অনুমোদন', is_sensitive: true },
  { key: 'applications.assign', module: 'APPLICATIONS', name_en: 'Assign Officers', name_bn: 'কর্মকর্তা নিয়োগ', is_sensitive: false },
  { key: 'applications.export', module: 'APPLICATIONS', name_en: 'Export Applications', name_bn: 'আবেদন এক্সপোর্ট', is_sensitive: false },

  // CERTIFICATES
  { key: 'certificates.view', module: 'CERTIFICATES', name_en: 'View Certificates', name_bn: 'সনদ তালিকা দেখা', is_sensitive: false },
  { key: 'certificates.preview', module: 'CERTIFICATES', name_en: 'Preview Certificate A4', name_bn: 'সনদ প্রিভিউ', is_sensitive: false },
  { key: 'certificates.download', module: 'CERTIFICATES', name_en: 'Download Certificate PDF', name_bn: 'PDF সনদ ডাউনলোড', is_sensitive: false },
  { key: 'certificates.print', module: 'CERTIFICATES', name_en: 'Print Certificate', name_bn: 'সনদ প্রিন্ট', is_sensitive: false },
  { key: 'certificates.issue', module: 'CERTIFICATES', name_en: 'Issue Official Certificate', name_bn: 'সনদ ইস্যু ও ডিজিটাল স্বাক্ষর', is_sensitive: true },
  { key: 'certificates.revoke', module: 'CERTIFICATES', name_en: 'Revoke Certificate', name_bn: 'সনদ বাতিল করা', is_sensitive: true },
  { key: 'certificates.reissue', module: 'CERTIFICATES', name_en: 'Reissue Certificate', name_bn: 'সনদ পুনঃইস্যু করা', is_sensitive: true },
  { key: 'certificates.verify', module: 'CERTIFICATES', name_en: 'Verify Certificate QR', name_bn: 'QR সনদ যাচাই', is_sensitive: false },

  // PAYMENTS
  { key: 'payments.view', module: 'PAYMENTS', name_en: 'View Payments', name_bn: 'পেমেন্ট ও কর দেখা', is_sensitive: false },
  { key: 'payments.view_reports', module: 'PAYMENTS', name_en: 'View Financial Reports', name_bn: 'আর্থিক প্রতিবেদন দেখা', is_sensitive: false },
  { key: 'payments.reconcile', module: 'PAYMENTS', name_en: 'Reconcile Payments', name_bn: 'লেনদেন সমন্বয় ও কর আদায়', is_sensitive: true },
  { key: 'payments.request_refund', module: 'PAYMENTS', name_en: 'Request Refund', name_bn: 'রিফান্ড অনুরোধ দাখিল', is_sensitive: false },
  { key: 'payments.approve_refund', module: 'PAYMENTS', name_en: 'Approve Refund', name_bn: 'রিফান্ড অনুমোদন', is_sensitive: true },

  // USERS
  { key: 'users.view', module: 'USERS', name_en: 'View Users', name_bn: 'ব্যবহারকারী দেখা', is_sensitive: false },
  { key: 'users.create', module: 'USERS', name_en: 'Create Users', name_bn: 'নতুন ব্যবহারকারী তৈরি', is_sensitive: true },
  { key: 'users.edit', module: 'USERS', name_en: 'Edit Users', name_bn: 'ব্যবহারকারী তথ্য সম্পাদনা', is_sensitive: false },
  { key: 'users.activate', module: 'USERS', name_en: 'Activate Users', name_bn: 'ব্যবহারকারী সক্রিয়করণ', is_sensitive: true },
  { key: 'users.deactivate', module: 'USERS', name_en: 'Deactivate Users', name_bn: 'ব্যবহারকারী নিষ্ক্রিয়করণ', is_sensitive: true },
  { key: 'users.reset_password', module: 'USERS', name_en: 'Reset Password', name_bn: 'পাসওয়ার্ড রিসেট', is_sensitive: true },
  { key: 'users.assign_role', module: 'USERS', name_en: 'Assign Roles & Scope', name_bn: 'রোল ও স্কোপ বরাদ্দ', is_sensitive: true },

  // SERVICES
  { key: 'services.view', module: 'SERVICES', name_en: 'View Services', name_bn: 'সেবা তালিকা দেখা', is_sensitive: false },
  { key: 'services.manage', module: 'SERVICES', name_en: 'Manage Services', name_bn: 'সেবা কনফিগারেশন', is_sensitive: false },
  { key: 'services.configure_fees', module: 'SERVICES', name_en: 'Configure Fees', name_bn: 'সেবা ফি নির্ধারণ', is_sensitive: true },
  { key: 'services.configure_forms', module: 'SERVICES', name_en: 'Configure Forms', name_bn: 'আবেদন ফরম কনফিগার', is_sensitive: false },
  { key: 'services.configure_workflow', module: 'SERVICES', name_en: 'Configure Workflow', name_bn: 'অনুমোদন কর্মপ্রবাহ', is_sensitive: true },

  // EMPLOYEES
  { key: 'employees.view', module: 'EMPLOYEES', name_en: 'View Employees', name_bn: 'কর্মচারী তালিকা দেখা', is_sensitive: false },
  { key: 'employees.manage', module: 'EMPLOYEES', name_en: 'Manage Employees', name_bn: 'কর্মচারী ব্যবস্থাপনা', is_sensitive: true },
  { key: 'employees.assign_department', module: 'EMPLOYEES', name_en: 'Assign Ward/Department', name_bn: 'ওয়ার্ড/বিভাগ বণ্টন', is_sensitive: false },

  // REPORTS & NOTICES & MONITORING
  { key: 'reports.view', module: 'REPORTS', name_en: 'View Reports', name_bn: 'প্রতিবেদন দেখা', is_sensitive: false },
  { key: 'reports.export', module: 'REPORTS', name_en: 'Export Reports', name_bn: 'প্রতিবেদন এক্সপোর্ট', is_sensitive: false },
  { key: 'notices.manage', module: 'REPORTS', name_en: 'Manage Notices', name_bn: 'নোটিশ প্রকাশ ও বাতিল', is_sensitive: false },
  { key: 'monitoring.observe', module: 'REPORTS', name_en: 'Record Monitoring Observations', name_bn: 'মনিটরিং পর্যবেক্ষণ নথিভুক্ত', is_sensitive: false },

  // SETTINGS & RBAC
  { key: 'settings.view', module: 'SETTINGS', name_en: 'View Settings', name_bn: 'সেটিংস দেখা', is_sensitive: false },
  { key: 'settings.manage', module: 'SETTINGS', name_en: 'Manage Settings', name_bn: 'সেটিংস পরিবর্তন', is_sensitive: true },
  { key: 'integrations.manage', module: 'SETTINGS', name_en: 'Manage Integrations', name_bn: 'SMTP/SMS/গেটওয়ে ইন্টিগ্রেশন', is_sensitive: true },
  { key: 'security.manage', module: 'SETTINGS', name_en: 'Manage Security Policies', name_bn: 'নিরাপত্তা ও MFA নীতিমালা', is_sensitive: true },
  { key: 'roles.manage', module: 'SETTINGS', name_en: 'Manage Roles & Permissions', name_bn: 'রোল, পারমিশন ও অনুমোদন ক্ষমতা', is_sensitive: true },

  // AUDIT & BACKUP
  { key: 'audit_logs.view', module: 'AUDIT', name_en: 'View Audit Logs', name_bn: 'অডিট লগ পর্যবেক্ষণ', is_sensitive: false },
  { key: 'backups.manage', module: 'BACKUP', name_en: 'Manage System Backups', name_bn: 'সিস্টেম ব্যাকআপ ব্যবস্থাপনা', is_sensitive: true },
];

export const SENSITIVE_PERMISSION_KEYS = new Set<PermissionKey>(
  SYSTEM_PERMISSIONS.filter((p) => p.is_sensitive).map((p) => p.key)
);

type GrantTuple = [PermissionKey, PermissionScope];

function mapGrants(scopeDefault: PermissionScope, keys: PermissionKey[], overrides?: Partial<Record<PermissionKey, PermissionScope>>): GrantTuple[] {
  return keys.map((k) => [k, overrides?.[k] || scopeDefault]);
}

export const DEFAULT_ROLE_PERMISSION_MAP: Record<UserRole, GrantTuple[]> = {
  // 1. SUPER ADMIN — Technical platform admin; NO automatic legal certificate approval authority!
  super_admin: mapGrants('global', [
    'dashboard.view',
    'applications.view',
    'applications.view_all',
    'applications.assign',
    'applications.export',
    'certificates.view',
    'certificates.preview',
    'certificates.download',
    'certificates.print',
    'certificates.verify',
    'payments.view',
    'payments.view_reports',
    'payments.reconcile',
    'payments.approve_refund',
    'users.view',
    'users.create',
    'users.edit',
    'users.activate',
    'users.deactivate',
    'users.reset_password',
    'users.assign_role',
    'services.view',
    'services.manage',
    'services.configure_fees',
    'services.configure_forms',
    'services.configure_workflow',
    'employees.view',
    'employees.manage',
    'employees.assign_department',
    'reports.view',
    'reports.export',
    'notices.manage',
    'monitoring.observe',
    'settings.view',
    'settings.manage',
    'integrations.manage',
    'security.manage',
    'roles.manage',
    'audit_logs.view',
    'backups.manage',
  ]),

  // 2. UPAZILA ADMIN — Subordinate institution monitoring; NO automatic certificate approval
  upazila_admin: mapGrants('upazila', [
    'dashboard.view',
    'applications.view',
    'applications.view_all',
    'applications.assign',
    'applications.export',
    'certificates.view',
    'certificates.preview',
    'certificates.verify',
    'payments.view_reports',
    'services.view',
    'employees.view',
    'employees.manage',
    'reports.view',
    'reports.export',
    'notices.manage',
    'monitoring.observe',
    'settings.view',
    'settings.manage',
    'audit_logs.view',
  ], { 'certificates.verify': 'global' }),

  // 3. UPAZILA MONITORING OFFICER
  upazila_monitoring_officer: [
    ['dashboard.view', 'upazila'],
    ['applications.view', 'upazila'],
    ['applications.view_all', 'upazila'],
    ['certificates.view', 'upazila'],
    ['certificates.verify', 'global'],
    ['services.view', 'upazila'],
    ['reports.view', 'upazila'],
    ['reports.export', 'upazila'],
    ['monitoring.observe', 'upazila'],
    ['audit_logs.view', 'upazila'],
  ],

  // 4. UNION ADMIN
  union_admin: [
    ['dashboard.view', 'institution'],
    ['applications.view', 'institution'],
    ['applications.view_all', 'institution'],
    ['applications.assign', 'institution'],
    ['applications.verify', 'institution'],
    ['applications.forward', 'institution'],
    ['applications.request_correction', 'institution'],
    ['applications.reject', 'institution'],
    ['applications.approve', 'institution'],
    ['applications.export', 'institution'],
    ['certificates.view', 'institution'],
    ['certificates.preview', 'institution'],
    ['certificates.download', 'institution'],
    ['certificates.print', 'institution'],
    ['certificates.issue', 'institution'],
    ['certificates.revoke', 'institution'],
    ['certificates.reissue', 'institution'],
    ['certificates.verify', 'global'],
    ['payments.view', 'institution'],
    ['payments.view_reports', 'institution'],
    ['payments.reconcile', 'institution'],
    ['payments.approve_refund', 'institution'],
    ['services.view', 'institution'],
    ['services.manage', 'institution'],
    ['services.configure_fees', 'institution'],
    ['employees.view', 'institution'],
    ['employees.manage', 'institution'],
    ['reports.view', 'institution'],
    ['reports.export', 'institution'],
    ['notices.manage', 'institution'],
    ['settings.view', 'institution'],
    ['settings.manage', 'institution'],
    ['audit_logs.view', 'institution'],
  ],

  // 5. CHAIRMAN / AUTHORIZED APPROVING OFFICER
  chairman: [
    ['dashboard.view', 'institution'],
    ['applications.view', 'institution'],
    ['applications.view_all', 'institution'],
    ['applications.verify', 'institution'],
    ['applications.request_correction', 'institution'],
    ['applications.reject', 'institution'],
    ['applications.approve', 'institution'],
    ['certificates.view', 'institution'],
    ['certificates.preview', 'institution'],
    ['certificates.download', 'institution'],
    ['certificates.print', 'institution'],
    ['certificates.issue', 'institution'],
    ['certificates.revoke', 'institution'],
    ['certificates.reissue', 'institution'],
    ['certificates.verify', 'global'],
    ['payments.approve_refund', 'institution'],
    ['services.view', 'institution'],
    ['reports.view', 'institution'],
    ['notices.manage', 'institution'],
  ],

  // 6. SECRETARY — Verification & forwarding; NO approve/issue by default
  secretary: [
    ['dashboard.view', 'institution'],
    ['applications.view', 'institution'],
    ['applications.view_all', 'institution'],
    ['applications.assign', 'institution'],
    ['applications.verify', 'institution'],
    ['applications.forward', 'institution'],
    ['applications.recommend', 'institution'],
    ['applications.request_correction', 'institution'],
    ['certificates.view', 'institution'],
    ['certificates.preview', 'institution'],
    ['certificates.verify', 'global'],
    ['services.view', 'institution'],
    ['reports.view', 'institution'],
    ['notices.manage', 'institution'],
  ],

  // 7. WARD MEMBER — Strictly ward-scoped; NO financial access, NO approve/issue
  ward_member: [
    ['dashboard.view', 'ward'],
    ['applications.view', 'ward'],
    ['applications.view_assigned', 'ward'],
    ['applications.verify', 'ward'],
    ['applications.recommend', 'ward'],
    ['applications.forward', 'ward'],
    ['certificates.view', 'ward'],
    ['certificates.verify', 'global'],
    ['reports.view', 'ward'],
  ],

  // 8. UNION ACCOUNTANT — Financial scope; NO certificate approval
  union_accountant: [
    ['dashboard.view', 'institution'],
    ['payments.view', 'institution'],
    ['payments.view_reports', 'institution'],
    ['payments.reconcile', 'institution'],
    ['payments.request_refund', 'institution'],
    ['reports.view', 'institution'],
    ['reports.export', 'institution'],
    ['certificates.verify', 'global'],
  ],

  // 9. UNION SERVICE OPERATOR — Citizen intake & assist; NO approve/reject/issue/payments
  union_service_operator: [
    ['dashboard.view', 'institution'],
    ['applications.view', 'assigned'],
    ['applications.view_assigned', 'assigned'],
    ['applications.create', 'institution'],
    ['applications.edit', 'assigned'],
    ['services.view', 'institution'],
    ['certificates.view', 'assigned'],
    ['certificates.verify', 'global'],
  ],

  // 10. MUNICIPALITY ADMIN
  municipality_admin: [
    ['dashboard.view', 'institution'],
    ['applications.view', 'institution'],
    ['applications.view_all', 'institution'],
    ['applications.assign', 'institution'],
    ['applications.verify', 'institution'],
    ['applications.forward', 'institution'],
    ['applications.request_correction', 'institution'],
    ['applications.reject', 'institution'],
    ['applications.approve', 'institution'],
    ['applications.export', 'institution'],
    ['certificates.view', 'institution'],
    ['certificates.preview', 'institution'],
    ['certificates.download', 'institution'],
    ['certificates.print', 'institution'],
    ['certificates.issue', 'institution'],
    ['certificates.revoke', 'institution'],
    ['certificates.reissue', 'institution'],
    ['certificates.verify', 'global'],
    ['payments.view', 'institution'],
    ['payments.view_reports', 'institution'],
    ['payments.reconcile', 'institution'],
    ['payments.approve_refund', 'institution'],
    ['services.view', 'institution'],
    ['services.manage', 'institution'],
    ['services.configure_fees', 'institution'],
    ['employees.view', 'institution'],
    ['employees.manage', 'institution'],
    ['employees.assign_department', 'institution'],
    ['reports.view', 'institution'],
    ['reports.export', 'institution'],
    ['notices.manage', 'institution'],
    ['settings.view', 'institution'],
    ['settings.manage', 'institution'],
    ['audit_logs.view', 'institution'],
  ],

  // 11. MAYOR / AUTHORIZED APPROVING OFFICER
  mayor: [
    ['dashboard.view', 'institution'],
    ['applications.view', 'institution'],
    ['applications.view_all', 'institution'],
    ['applications.verify', 'institution'],
    ['applications.request_correction', 'institution'],
    ['applications.reject', 'institution'],
    ['applications.approve', 'institution'],
    ['certificates.view', 'institution'],
    ['certificates.preview', 'institution'],
    ['certificates.download', 'institution'],
    ['certificates.print', 'institution'],
    ['certificates.issue', 'institution'],
    ['certificates.revoke', 'institution'],
    ['certificates.reissue', 'institution'],
    ['certificates.verify', 'global'],
    ['payments.approve_refund', 'institution'],
    ['services.view', 'institution'],
    ['reports.view', 'institution'],
    ['notices.manage', 'institution'],
  ],

  // 12. EXECUTIVE OFFICER — Approve only if separately authorized via override + approval authority
  executive_officer: [
    ['dashboard.view', 'institution'],
    ['applications.view', 'institution'],
    ['applications.view_all', 'institution'],
    ['applications.assign', 'institution'],
    ['applications.verify', 'institution'],
    ['applications.forward', 'institution'],
    ['applications.request_correction', 'institution'],
    ['certificates.view', 'institution'],
    ['certificates.preview', 'institution'],
    ['certificates.verify', 'global'],
    ['employees.view', 'institution'],
    ['employees.assign_department', 'institution'],
    ['services.view', 'institution'],
    ['reports.view', 'institution'],
    ['reports.export', 'institution'],
    ['notices.manage', 'institution'],
  ],

  // 13. DEPARTMENT OFFICER — Strictly department-scoped
  department_officer: [
    ['dashboard.view', 'department'],
    ['applications.view', 'department'],
    ['applications.view_assigned', 'department'],
    ['applications.verify', 'department'],
    ['applications.forward', 'department'],
    ['applications.recommend', 'department'],
    ['applications.request_correction', 'department'],
    ['certificates.view', 'department'],
    ['certificates.verify', 'global'],
    ['services.view', 'department'],
    ['reports.view', 'department'],
  ],

  // 14. MUNICIPALITY ACCOUNTANT
  municipality_accountant: [
    ['dashboard.view', 'institution'],
    ['payments.view', 'institution'],
    ['payments.view_reports', 'institution'],
    ['payments.reconcile', 'institution'],
    ['payments.request_refund', 'institution'],
    ['reports.view', 'institution'],
    ['reports.export', 'institution'],
    ['certificates.verify', 'global'],
  ],

  // 15. MUNICIPALITY SERVICE OPERATOR
  municipality_service_operator: [
    ['dashboard.view', 'institution'],
    ['applications.view', 'assigned'],
    ['applications.view_assigned', 'assigned'],
    ['applications.create', 'institution'],
    ['applications.edit', 'assigned'],
    ['services.view', 'institution'],
    ['certificates.view', 'assigned'],
    ['certificates.verify', 'global'],
  ],

  // 16. CITIZEN — Own records only
  citizen: [
    ['dashboard.view', 'own'],
    ['applications.view', 'own'],
    ['applications.create', 'own'],
    ['applications.edit', 'own'],
    ['certificates.view', 'own'],
    ['certificates.preview', 'own'],
    ['certificates.download', 'own'],
    ['certificates.print', 'own'],
    ['certificates.verify', 'global'],
    ['payments.view', 'own'],
    ['services.view', 'global'],
  ],
};

// Clean summary entries for backwards-compatible RolePermissionEntry view
export const DEFAULT_LEGACY_ROLE_SUMMARIES: RolePermissionEntry[] = SYSTEM_ROLES.filter(
  (r) => r.slug !== 'citizen'
).map((r) => {
  const keys = new Set(DEFAULT_ROLE_PERMISSION_MAP[r.slug].map(([k]) => k));
  return {
    role: r.slug,
    label_bn: r.name_bn,
    scope_bn: r.default_scope === 'global'
      ? 'সমগ্র প্ল্যাটফর্ম'
      : r.default_scope === 'upazila'
      ? 'পাবনা সদর উপজেলা'
      : r.default_scope === 'ward'
      ? 'নির্ধারিত ওয়ার্ড'
      : r.default_scope === 'department'
      ? 'নির্ধারিত বিভাগ'
      : 'নির্ধারিত প্রতিষ্ঠান',
    can_view_applications: keys.has('applications.view') || keys.has('applications.view_all') || keys.has('applications.view_assigned'),
    can_verify_applications: keys.has('applications.verify'),
    can_forward_applications: keys.has('applications.forward'),
    can_final_approve: keys.has('applications.approve'),
    can_revoke_certificate: keys.has('certificates.revoke'),
    can_manage_revenue: keys.has('payments.reconcile') || keys.has('payments.view'),
    can_manage_staff: keys.has('employees.manage') || keys.has('users.assign_role'),
    can_manage_settings: keys.has('settings.manage'),
  };
});
