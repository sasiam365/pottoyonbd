import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  FileText,
  Award,
  CreditCard,
  Home,
  Store,
  BarChart3,
  Settings,
  Bell,
  CheckCircle,
  Clock,
  Building2,
  ChevronRight,
  Download,
  QrCode,
  AlertTriangle,
  ExternalLink,
  Users,
  Layers,
  Megaphone,
  Sliders,
  Paperclip,
  UserPlus,
  RotateCcw,
  History,
  Shield,
  Eye,
  LogOut,
  PlusCircle,
} from 'lucide-react';
import {
  AdministrativeUnit,
  Application,
  ApplicationApproval,
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
  PermissionKey,
  RefundRequest,
  RolePermissionEntry,
  Service,
  StaffMember,
  SystemSettings,
  TradeLicenseRecord,
  UserSession,
  WardOrDepartment,
} from '../../types';
import { storage } from '../../services/storage';
import { api } from '../../services/api';
import { ResponsiveDataTable, TableColumn } from '../common/ResponsiveDataTable';
import { CertificateManagementPanel } from './CertificateManagementPanel';
import {
  HoldingTaxPanel,
  PaymentsPanel,
  ReportsAndSettingsPanel,
  StaffPanel,
  TradeLicensePanel,
  WardsAndNoticesPanel,
} from './AdminOperationsPanels';
import { RoleManagementPanel } from './RoleManagementPanel';

type AdminMenuKey =
  | 'overview'
  | 'applications'
  | 'certificates'
  | 'monitoring'
  | 'payments'
  | 'holding_tax'
  | 'trade_license'
  | 'staff'
  | 'wards_depts'
  | 'notices'
  | 'services_config'
  | 'reports'
  | 'role_management'
  | 'settings';

const APP_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending_payment: { label: 'পেমেন্ট অপেক্ষমাণ', cls: 'bg-amber-100 text-amber-800' },
  paid: { label: 'ফি পরিশোধিত', cls: 'bg-sky-100 text-sky-800' },
  under_verification: { label: 'যাচাই চলছে', cls: 'bg-blue-100 text-blue-800' },
  correction_required: { label: 'সংশোধন প্রয়োজন', cls: 'bg-orange-100 text-orange-800' },
  forwarded_for_approval: { label: 'অনুমোদনের জন্য প্রেরিত', cls: 'bg-indigo-100 text-indigo-800' },
  approved: { label: 'অনুমোদিত', cls: 'bg-teal-100 text-teal-800' },
  certificate_issued: { label: 'সনদ ইস্যুকৃত', cls: 'bg-emerald-100 text-emerald-800' },
  rejected: { label: 'বাতিল', cls: 'bg-red-100 text-red-800' },
  refunded: { label: 'রিফান্ডকৃত', cls: 'bg-slate-200 text-slate-800' },
};

interface AdminDashboardProps {
  userSession: UserSession;
  institutions: AdministrativeUnit[];
  services: Service[];
  onViewCertificate: (cert: Certificate) => void;
  onPrintCertificate?: (cert: Certificate, trackingNo?: string) => void;
  onNavigateVerify?: (token: string) => void;
  onRefreshPlatformData?: () => Promise<void>;
  onApplyNewService?: (serviceId?: string, unitId?: string) => void;
  onLogout?: () => void;
  lang?: 'bn' | 'en';
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  userSession,
  institutions,
  services,
  onPrintCertificate,
  onNavigateVerify,
  onRefreshPlatformData,
  onApplyNewService,
  onLogout,
}) => {
  const perms = userSession.permissions || {};
  const hasPerm = useCallback((key: PermissionKey): boolean => Boolean(perms[key]), [perms]);

  const hasApprovalAuthorityFor = useCallback(
    (unitId?: string, serviceId?: string): boolean => {
      if (!hasPerm('applications.approve')) return false;
      const nowMs = Date.now();
      return (userSession.approval_authorities || []).some((auth) => {
        if (auth.expires_at && new Date(auth.expires_at).getTime() <= nowMs) return false;
        const unitMatch =
          auth.administrative_unit_id === '*' || !unitId || auth.administrative_unit_id === unitId;
        const srvMatch = auth.service_id === '*' || !serviceId || auth.service_id === serviceId;
        return unitMatch && srvMatch;
      });
    },
    [hasPerm, userSession.approval_authorities]
  );

  const canAnyApproval = hasApprovalAuthorityFor();
  const isCrossUnit =
    perms['dashboard.view'] === 'global' || perms['dashboard.view'] === 'upazila';

  const allowedMenus: AdminMenuKey[] = [
    ...(hasPerm('dashboard.view') ? (['overview'] as AdminMenuKey[]) : []),
    ...(hasPerm('applications.view') ? (['applications'] as AdminMenuKey[]) : []),
    ...(hasPerm('certificates.view') ? (['certificates'] as AdminMenuKey[]) : []),
    ...(hasPerm('monitoring.observe') || userSession.role === 'upazila_admin' || userSession.role === 'super_admin'
      ? (['monitoring'] as AdminMenuKey[])
      : []),
    ...(hasPerm('payments.view') || hasPerm('payments.view_reports') || hasPerm('payments.request_refund')
      ? (['payments'] as AdminMenuKey[])
      : []),
    ...(hasPerm('payments.view') || hasPerm('payments.reconcile') ? (['holding_tax'] as AdminMenuKey[]) : []),
    ...(hasPerm('payments.view') || hasPerm('services.view') ? (['trade_license'] as AdminMenuKey[]) : []),
    ...(hasPerm('employees.view') || hasPerm('employees.manage') ? (['staff'] as AdminMenuKey[]) : []),
    ...(hasPerm('employees.view') || hasPerm('services.view') ? (['wards_depts'] as AdminMenuKey[]) : []),
    ...(hasPerm('notices.manage') || hasPerm('dashboard.view') ? (['notices'] as AdminMenuKey[]) : []),
    ...(hasPerm('services.manage') || hasPerm('services.configure_fees')
      ? (['services_config'] as AdminMenuKey[])
      : []),
    ...(hasPerm('reports.view') || hasPerm('audit_logs.view') ? (['reports'] as AdminMenuKey[]) : []),
    ...(hasPerm('roles.manage') || hasPerm('users.assign_role') || hasPerm('users.view') || hasPerm('settings.view')
      ? (['role_management'] as AdminMenuKey[])
      : []),
    ...(hasPerm('settings.view') || hasPerm('settings.manage') ? (['settings'] as AdminMenuKey[]) : []),
  ];

  const [activeMenu, setActiveMenu] = useState<AdminMenuKey>(allowedMenus[0] || 'overview');

  useEffect(() => {
    if (allowedMenus.length > 0 && !allowedMenus.includes(activeMenu)) {
      setActiveMenu(allowedMenus[0]);
    }
  }, [userSession.role, userSession.user_id]);

  const currentUnitId = userSession.administrative_unit_id;
  const isSuperOrUpazila = isCrossUnit;
  const isMuniRole =
    userSession.role === 'municipality_admin' ||
    userSession.role === 'mayor' ||
    userSession.role === 'executive_officer' ||
    userSession.role === 'department_officer' ||
    userSession.role === 'municipality_accountant' ||
    userSession.role === 'municipality_service_operator';
  const isAccountant =
    userSession.role === 'union_accountant' || userSession.role === 'municipality_accountant';
  const isServiceOperator =
    userSession.role === 'union_service_operator' || userSession.role === 'municipality_service_operator';
  const isMonitoringOfficer = userSession.role === 'upazila_monitoring_officer';

  const [selectedUnitFilter, setSelectedUnitFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Selected app & modal controls
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [selectedAppHistory, setSelectedAppHistory] = useState<ApplicationApproval[]>([]);
  const [assignStaffId, setAssignStaffId] = useState<string>('');
  const [reviewNote, setReviewNote] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [showCorrectionInput, setShowCorrectionInput] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const [actionError, setActionError] = useState('');
  const [actionSuccessMessage, setActionSuccessMessage] = useState('');
  const [lastIssuedInfo, setLastIssuedInfo] = useState<{
    cert: Certificate;
    verificationUrl: string;
    token: string;
  } | null>(null);

  // Notifications drawer
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<CitizenNotification[]>([]);

  // Live server datasets
  const [stats, setStats] = useState<DashboardStatsResponse | null>(null);
  const [applications, setApplications] = useState<Application[]>(() =>
    storage.getApplications(isSuperOrUpazila ? undefined : currentUnitId)
  );
  const [holdingTaxes, setHoldingTaxes] = useState<HoldingTaxRecord[]>([]);
  const [tradeLicenses, setTradeLicenses] = useState<TradeLicenseRecord[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [wardsDepts, setWardsDepts] = useState<WardOrDepartment[]>([]);
  const [events, setEvents] = useState<CertificateEvent[]>([]);
  const [verificationLogs, setVerificationLogs] = useState<CertificateVerificationLog[]>([]);
  const [templates, setTemplates] = useState<CertificateTemplate[]>([]);
  const [inquiries, setInquiries] = useState<ContactInquiry[]>([]);
  const [rolePermissions, setRolePermissions] = useState<RolePermissionEntry[]>([]);
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [monitoringObservations, setMonitoringObservations] = useState<MonitoringObservation[]>([]);
  const [refundRequests, setRefundRequests] = useState<RefundRequest[]>([]);

  // Monitoring observation creation state
  const [obsUnitId, setObsUnitId] = useState<string>('unit_goyeshpur');
  const [obsSeverity, setObsSeverity] = useState<'info' | 'warning' | 'critical' | 'overdue'>('warning');
  const [obsAppId, setObsAppId] = useState<string>('');
  const [obsText, setObsText] = useState<string>('');
  const [obsBusy, setObsBusy] = useState(false);

  const effectiveUnitScope = isSuperOrUpazila
    ? selectedUnitFilter !== 'all'
      ? selectedUnitFilter
      : undefined
    : currentUnitId;

  const unit = institutions.find((i) => i.id === (effectiveUnitScope || currentUnitId)) || institutions[0];

  const refreshServerData = useCallback(async () => {
    if (!userSession.token) return;
    const tok = userSession.token;
    try {
      const [
        statsData,
        appsData,
        auditData,
        tplData,
        htData,
        tlData,
        noticeData,
        staffData,
        wdData,
        notifData,
        permData,
        sysData,
        obsData,
        refundData,
      ] = await Promise.all([
        hasPerm('dashboard.view') ? api.getDashboardStats(tok, effectiveUnitScope).catch(() => null) : Promise.resolve(null),
        hasPerm('applications.view') ? api.listApplications(tok, effectiveUnitScope).catch(() => []) : Promise.resolve([]),
        hasPerm('audit_logs.view')
          ? api.getAuditLogs(tok, effectiveUnitScope).catch(() => ({ events: [], verification_logs: [], approvals: [] }))
          : Promise.resolve({ events: [], verification_logs: [], approvals: [] }),
        api.getCertificateTemplates().catch(() => []),
        hasPerm('payments.view') ? api.listHoldingTaxes(effectiveUnitScope).catch(() => []) : Promise.resolve([]),
        hasPerm('payments.view') || hasPerm('services.view')
          ? api.listTradeLicenses(effectiveUnitScope).catch(() => [])
          : Promise.resolve([]),
        api.listNotices(effectiveUnitScope).catch(() => []),
        hasPerm('employees.view') || hasPerm('applications.assign')
          ? api.listStaff(tok, effectiveUnitScope).catch(() => [])
          : Promise.resolve([]),
        hasPerm('employees.view') || hasPerm('services.view') || hasPerm('dashboard.view')
          ? api.listWardsDepartments(tok, effectiveUnitScope).catch(() => [])
          : Promise.resolve([]),
        api.getNotifications({ token: tok }).catch(() => []),
        hasPerm('roles.manage') || hasPerm('settings.view')
          ? api.listRolePermissions(tok).catch(() => [])
          : Promise.resolve([]),
        hasPerm('settings.view') ? api.getSystemSettings(tok).catch(() => null) : Promise.resolve(null),
        hasPerm('monitoring.observe') || hasPerm('audit_logs.view')
          ? api.listMonitoringObservations(tok, effectiveUnitScope).catch(() => [])
          : Promise.resolve([]),
        hasPerm('payments.view_reports') || hasPerm('payments.request_refund') || hasPerm('payments.approve_refund')
          ? api.listRefundRequests(tok, effectiveUnitScope).catch(() => [])
          : Promise.resolve([]),
      ]);

      setStats(statsData);
      setApplications(appsData);
      setEvents(auditData.events);
      setVerificationLogs(auditData.verification_logs);
      setTemplates(tplData);
      setHoldingTaxes(htData);
      setTradeLicenses(tlData);
      setNotices(noticeData);
      setStaffMembers(staffData);
      setWardsDepts(wdData);
      setNotifications(notifData);
      setRolePermissions(permData);
      setSystemSettings(sysData);
      setMonitoringObservations(obsData);
      setRefundRequests(refundData);

      if (isSuperOrUpazila) {
        api.listContactInquiries(tok).then(setInquiries).catch(() => {});
      } else {
        setInquiries([]);
      }
      if (onRefreshPlatformData) {
        await onRefreshPlatformData();
      }
    } catch {
      setApplications(storage.getApplications(effectiveUnitScope));
    }
  }, [userSession.token, effectiveUnitScope, isSuperOrUpazila, hasPerm]);

  useEffect(() => {
    refreshServerData();
  }, [refreshServerData]);

  const handleCreateObservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userSession.token || !obsText.trim()) return;
    setObsBusy(true);
    setActionError('');
    try {
      await api.createMonitoringObservation(userSession.token, {
        administrative_unit_id: obsUnitId,
        application_id: obsAppId.trim() || null,
        observation_bn: obsText.trim(),
        severity: obsSeverity,
      });
      setObsText('');
      setObsAppId('');
      setActionSuccessMessage('উপজেলা মনিটরিং পর্যবেক্ষণ সফলভাবে সংরক্ষিত হয়েছে।');
      await refreshServerData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'পর্যবেক্ষণ সংরক্ষণ ব্যর্থ হয়েছে।');
    } finally {
      setObsBusy(false);
    }
  };

  const openApplicationModal = async (app: Application) => {
    setSelectedApp(app);
    setReviewNote('');
    setCorrectionReason('');
    setShowCorrectionInput(false);
    setExpiresInDays('');
    setAssignStaffId(app.assigned_officer_id || '');
    setSelectedAppHistory([]);

    if (userSession.token) {
      try {
        const [fullApp, hist] = await Promise.all([
          api.getApplicationByTracking(app.id, userSession.token),
          api.getApplicationHistory(userSession.token, app.id).catch(() => ({ approvals: [], events: [] })),
        ]);
        setSelectedApp(fullApp);
        setSelectedAppHistory(hist.approvals || []);
      } catch {
        // fallback uses row app
      }
    }
  };

  const handleAssignOfficer = async () => {
    if (!selectedApp || !userSession.token || !assignStaffId) return;
    setSubmitting(true);
    setActionError('');
    try {
      const updated = await api.assignApplicationOfficer(userSession.token, selectedApp.id, {
        staff_id: assignStaffId,
      });
      setSelectedApp(updated);
      setActionSuccessMessage(`আবেদন ${updated.tracking_no} এ কর্মকর্তা (${updated.assigned_officer}) নিযুক্ত হয়েছেন।`);
      await refreshServerData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'কর্মকর্তা নিয়োগ ব্যর্থ হয়েছে।');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestCorrection = async () => {
    if (!selectedApp || !userSession.token) return;
    setSubmitting(true);
    setActionError('');
    try {
      await api.requestApplicationCorrection(
        userSession.token,
        selectedApp.id,
        correctionReason.trim() || reviewNote.trim() || 'অনুগ্রহ করে সঠিক তথ্য ও স্পষ্ট কাগজপত্র পুনঃদাখিল করুন।'
      );
      setActionSuccessMessage(`আবেদন ${selectedApp.tracking_no} সংশোধনের জন্য নাগরিকের নিকট ফেরত পাঠানো হয়েছে।`);
      setSelectedApp(null);
      await refreshServerData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'সংশোধন অনুরোধ ব্যর্থ হয়েছে।');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatus = async (
    newStatus: 'under_verification' | 'forwarded_for_approval' | 'rejected' | 'certificate_issued'
  ) => {
    if (!selectedApp) return;
    setActionError('');

    if (!userSession.token) {
      setActionError('অফিসার সেশন টোকেন পাওয়া যায়নি। অনুগ্রহ করে পুনরায় লগইন করুন।');
      return;
    }

    setSubmitting(true);
    try {
      if (newStatus === 'certificate_issued') {
        const parsedDays = expiresInDays.trim() ? parseInt(expiresInDays.trim(), 10) : undefined;
        const result = await api.finalApproveAndIssue(userSession.token, selectedApp.id, {
          notes: reviewNote || undefined,
          expires_in_days: Number.isFinite(parsedDays) ? parsedDays : undefined,
        });

        const url = result.verification_url || result.certificate.verification_url;
        const extractedToken = url.includes('/verify/') ? url.split('/verify/')[1] : '';

        setActionSuccessMessage(
          result.already_issued
            ? `এই আবেদনের বিপরীতে ইতোপূর্বেই সনদ ইস্যু হয়েছে (সনদ নং: ${result.certificate.certificate_no})`
            : `চূড়ান্ত অনুমোদন, স্বয়ংক্রিয় QR ও PDF সনদ ইস্যু সম্পন্ন! (সনদ নং: ${result.certificate.certificate_no})`
        );

        if (extractedToken && !extractedToken.includes('[')) {
          setLastIssuedInfo({
            cert: result.certificate,
            verificationUrl: url,
            token: extractedToken,
          });
        }

        setSelectedApp(null);
        await refreshServerData();
      } else {
        await api.updateApplicationStatus(
          userSession.token,
          selectedApp.id,
          newStatus,
          reviewNote || `স্ট্যাটাস পরিবর্তন: ${newStatus}`
        );
        setActionSuccessMessage('আবেদনের স্ট্যাটাস সফলভাবে আপডেট করা হয়েছে।');
        setSelectedApp(null);
        await refreshServerData();
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'কার্যক্রম সম্পন্ন করা যায়নি।');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadPdf = (cert: Certificate) => {
    const url = api.getPdfDownloadUrl(cert.id, { authToken: userSession.token });
    const a = document.createElement('a');
    a.href = url;
    a.download = `PottoyonBD-${cert.certificate_number || cert.certificate_no}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const filteredApps = applications.filter((app) => {
    const matchesStatus = statusFilter === 'all' || app.status === statusFilter;
    const q = searchQuery.toLowerCase().trim();
    const matchesQuery =
      !q ||
      app.tracking_no.toLowerCase().includes(q) ||
      app.applicant_name_bn.toLowerCase().includes(q) ||
      app.service_name_bn.toLowerCase().includes(q) ||
      (app.assigned_officer || '').toLowerCase().includes(q);
    return matchesStatus && matchesQuery;
  });

  // Live aggregated metrics (zero fake fallback numbers)
  const totalApps = stats?.total_applications ?? applications.length;
  const pendingApps =
    stats?.pending_applications ??
    applications.filter((a) =>
      ['pending_payment', 'paid', 'under_verification', 'correction_required', 'forwarded_for_approval'].includes(a.status)
    ).length;
  const approvedApps =
    stats?.approved_applications ??
    applications.filter((a) => a.status === 'approved' || a.status === 'certificate_issued').length;
  const totalRevenue =
    stats?.total_revenue ??
    applications.filter((a) => a.payment_status === 'paid').reduce((sum, a) => sum + (a.fee_amount || 0), 0);

  const monthlyStats = stats?.monthly_stats || [];
  const maxMonthlyCount = Math.max(1, ...monthlyStats.map((m) => m.count));

  const menuDefinitions: Array<{
    key: AdminMenuKey;
    label: string;
    icon: React.FC<{ className?: string }>;
    badge?: number;
  }> = [
    { key: 'overview', label: 'ড্যাশবোর্ড', icon: LayoutDashboard },
    { key: 'applications', label: 'আবেদনসমূহ', icon: FileText, badge: pendingApps },
    { key: 'certificates', label: 'সনদ ব্যবস্থাপনা', icon: Award },
    { key: 'monitoring', label: 'মনিটরিং ও SLA', icon: Eye, badge: monitoringObservations.length },
    { key: 'payments', label: 'পেমেন্ট ও রাজস্ব', icon: CreditCard },
    { key: 'holding_tax', label: 'হোল্ডিং ট্যাক্স', icon: Home },
    { key: 'trade_license', label: 'ট্রেড লাইসেন্স', icon: Store },
    { key: 'staff', label: 'কর্মকর্তা ও কর্মচারী', icon: Users },
    { key: 'wards_depts', label: isMuniRole ? 'ওয়ার্ড ও বিভাগ' : 'ওয়ার্ড ব্যবস্থাপনা', icon: Layers },
    { key: 'notices', label: 'নোটিশ বোর্ড', icon: Megaphone },
    { key: 'services_config', label: 'সেবা ও ফি কনফিগ', icon: Sliders },
    { key: 'reports', label: 'রিপোর্ট ও অডিট', icon: BarChart3 },
    { key: 'role_management', label: 'রোল ও RBAC পারমিশন', icon: Shield },
    { key: 'settings', label: 'সেটিংস ও ব্যাকআপ', icon: Settings },
  ];

  const visibleMenus = menuDefinitions.filter((m) => allowedMenus.includes(m.key));

  const appColumns: TableColumn<Application>[] = [
    {
      key: 'tracking_no',
      header: 'ট্র্যাকিং নং',
      minWidth: '125px',
      stickyLeft: true,
      render: (app) => (
        <span className="font-mono font-bold text-emerald-900">{app.tracking_no}</span>
      ),
    },
    {
      key: 'applicant',
      header: 'আবেদনকারী',
      minWidth: '145px',
      render: (app) => (
        <div>
          <div className="font-semibold text-slate-900">{app.applicant_name_bn}</div>
          <div className="text-[10px] text-slate-500">পিতা: {app.father_name_bn}</div>
        </div>
      ),
    },
    {
      key: 'service',
      header: 'সেবা',
      minWidth: '145px',
      render: (app) => <span className="text-slate-800 font-medium">{app.service_name_bn}</span>,
    },
    {
      key: 'unit',
      header: 'প্রতিষ্ঠান ও ওয়ার্ড',
      minWidth: '155px',
      render: (app) => {
        const u = institutions.find((i) => i.id === app.administrative_unit_id);
        return (
          <div>
            <div className="text-slate-800">{u?.name_bn || app.administrative_unit_id}</div>
            <div className="text-[10px] text-slate-500">{app.ward_no} নং ওয়ার্ড</div>
          </div>
        );
      },
    },
    {
      key: 'officer',
      header: 'দায়িত্বপ্রাপ্ত',
      minWidth: '130px',
      render: (app) => (
        <span className="text-slate-600">{app.assigned_officer || 'অনির্ধারিত'}</span>
      ),
    },
    {
      key: 'fee',
      header: 'ফি',
      align: 'right',
      minWidth: '80px',
      render: (app) => <span className="font-mono font-bold">৳{app.fee_amount}</span>,
    },
    {
      key: 'status',
      header: 'অবস্থা',
      align: 'center',
      minWidth: '130px',
      render: (app) => {
        const badge = APP_STATUS_BADGE[app.status] || { label: app.status, cls: 'bg-slate-100 text-slate-800' };
        return (
          <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] ${badge.cls}`}>
            {badge.label}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: 'পদক্ষেপ',
      align: 'right',
      minWidth: '140px',
      hideInMobileCard: true,
      render: (app) => (
        <button
          type="button"
          onClick={() => openApplicationModal(app)}
          className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-3 py-1.5 rounded-lg text-[11px] transition-colors shadow-2xs"
        >
          পর্যালোচনা ও পদক্ষেপ
        </button>
      ),
    },
  ];

  const instBreakdownCols: TableColumn<DashboardStatsResponse['institution_breakdown'][number]>[] = [
    {
      key: 'name',
      header: 'প্রতিষ্ঠানের নাম',
      minWidth: '170px',
      stickyLeft: true,
      render: (r) => <span className="font-bold text-slate-900">{r.name_bn}</span>,
    },
    {
      key: 'type',
      header: 'ধরন',
      minWidth: '110px',
      render: (r) => (
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
            r.type === 'municipality' ? 'bg-teal-100 text-teal-800' : 'bg-emerald-100 text-emerald-800'
          }`}
        >
          {r.type === 'municipality' ? 'পৌরসভা' : 'ইউনিয়ন পরিষদ'}
        </span>
      ),
    },
    {
      key: 'apps',
      header: 'মোট আবেদন',
      align: 'right',
      minWidth: '90px',
      render: (r) => <span className="font-mono font-bold">{r.applications}</span>,
    },
    {
      key: 'certs',
      header: 'ইস্যুকৃত সনদ',
      align: 'right',
      minWidth: '95px',
      render: (r) => <span className="font-mono font-bold text-emerald-800">{r.certificates}</span>,
    },
    {
      key: 'rev',
      header: 'সংগৃহীত ফি',
      align: 'right',
      minWidth: '100px',
      render: (r) => <span className="font-mono font-bold">৳{r.revenue}</span>,
    },
  ];

  const unitStaffOptions = staffMembers.filter(
    (s) => !selectedApp || s.administrative_unit_id === selectedApp.administrative_unit_id
  );

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="no-print w-full md:w-64 bg-emerald-950 text-slate-300 flex flex-col justify-between shrink-0 border-r border-emerald-900">
        <div>
          <div className="p-5 border-b border-emerald-900/80 bg-emerald-900/40">
            <div className="flex items-center gap-2 text-white">
              <Building2 className="w-5 h-5 text-emerald-400" />
              <div>
                <h2 className="text-sm font-bold leading-tight">PottoyonBD</h2>
                <p className="text-[11px] text-emerald-300 font-medium">প্রশাসনিক ড্যাশবোর্ড</p>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-emerald-800/60 text-xs">
              <span className="text-slate-400 block text-[10px]">দায়িত্বপ্রাপ্ত ইউনিট:</span>
              <span className="font-bold text-white block truncate">
                {isSuperOrUpazila ? 'পাবনা সদর (সকল ইউনিট)' : unit.name_bn}
              </span>
            </div>
          </div>

          <nav className="p-3 space-y-1 text-xs font-semibold flex md:block overflow-x-auto gap-1">
            {visibleMenus.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveMenu(item.key)}
                  className={`md:w-full shrink-0 flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl transition-colors whitespace-nowrap ${
                    activeMenu === item.key
                      ? 'bg-emerald-800 text-white font-bold shadow-xs'
                      : 'hover:bg-emerald-900/60 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </div>
                  {typeof item.badge === 'number' && item.badge > 0 && (
                    <span className="bg-amber-500 text-slate-950 text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="hidden md:flex p-4 border-t border-emerald-900 bg-emerald-950/60 items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-full bg-emerald-700 text-white flex items-center justify-center font-bold text-sm shrink-0">
              {userSession.name?.slice(0, 1) || 'ইউ'}
            </div>
            <div className="text-xs truncate">
              <span className="font-bold text-white block truncate">{userSession.name}</span>
              <span className="text-emerald-400 block text-[10px] truncate">{userSession.title_bn}</span>
            </div>
          </div>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              title="লগআউট"
              className="p-2 rounded-lg hover:bg-emerald-900 text-emerald-300 hover:text-white shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area (min-w-0 prevents flex child horizontal overflow on mobile!) */}
      <main className="flex-1 min-w-0 max-w-full overflow-x-hidden overflow-y-auto">
        {/* Top Navbar */}
        <div className="no-print bg-white px-4 sm:px-6 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 truncate">
              {isSuperOrUpazila ? 'সেন্ট্রাল কন্ট্রোল প্যানেল' : unit.name_bn}
            </h1>
            {isMuniRole && (
              <span className="text-[11px] bg-teal-100 text-teal-800 font-bold px-2.5 py-0.5 rounded-full">
                ১৫টি ওয়ার্ড • পৌর প্রশাসন
              </span>
            )}
            {userSession.assigned_wards && userSession.assigned_wards.length > 0 && (
              <span className="text-[11px] bg-blue-100 text-blue-800 font-bold px-2.5 py-0.5 rounded-full">
                ওয়ার্ড: {userSession.assigned_wards.join(', ')} নং
              </span>
            )}
            {userSession.assigned_departments && userSession.assigned_departments.length > 0 && (
              <span className="text-[11px] bg-indigo-100 text-indigo-800 font-bold px-2.5 py-0.5 rounded-full">
                বিভাগ: {userSession.assigned_departments.join(', ')}
              </span>
            )}
            <span
              className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                canAnyApproval
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {canAnyApproval ? 'অনুমোদন ক্ষমতাপ্রাপ্ত' : 'যাচাই / পরিচালনা / পর্যবেক্ষণ'}
            </span>
            {userSession.roles && userSession.roles.length > 1 && (
              <span className="text-[11px] bg-amber-100 text-amber-800 font-bold px-2.5 py-0.5 rounded-full">
                মাল্টি-রোল ({userSession.roles.length})
              </span>
            )}
            {isSuperOrUpazila && (
              <select
                value={selectedUnitFilter}
                onChange={(e) => setSelectedUnitFilter(e.target.value)}
                className="ml-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-50 text-xs font-bold text-slate-800"
              >
                <option value="all">সকল প্রতিষ্ঠান (১০ ইউপি + ১ পৌরসভা)</option>
                {institutions.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.name_bn}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center gap-2.5 text-xs relative">
            {(isServiceOperator || hasPerm('applications.create')) && onApplyNewService && (
              <button
                type="button"
                onClick={() => onApplyNewService('srv_warish', currentUnitId)}
                className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-2xs"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>নতুন আবেদন এন্ট্রি</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setNotifOpen((o) => !o)}
              className="p-2 rounded-full hover:bg-slate-100 text-slate-600 relative"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4" />
              {notifications.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center">
                  {notifications.length > 9 ? '9+' : notifications.length}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-11 w-80 bg-white border border-slate-200 rounded-2xl shadow-xl z-40 p-3 space-y-2 max-h-80 overflow-y-auto">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="font-bold text-slate-900">সাম্প্রতিক নোটিফিকেশন ({notifications.length})</span>
                  <button type="button" onClick={() => setNotifOpen(false)} className="text-slate-400 font-bold">
                    ✕
                  </button>
                </div>
                {notifications.slice(0, 8).map((n) => (
                  <div key={n.id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 space-y-0.5">
                    <div className="font-bold text-emerald-900 text-[11px]">{n.title_bn}</div>
                    <p className="text-[11px] text-slate-600">{n.message_bn}</p>
                  </div>
                ))}
                {notifications.length === 0 && (
                  <p className="text-center text-slate-400 py-4">কোনো নোটিফিকেশন নেই।</p>
                )}
              </div>
            )}

            <div className="text-right">
              <span className="font-bold text-slate-800 block">{userSession.name}</span>
              <span className="text-slate-500 block text-[11px]">{userSession.title_bn}</span>
            </div>

            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">লগআউট</span>
              </button>
            )}
          </div>
        </div>

        {/* Feedback Banners */}
        {actionSuccessMessage && (
          <div className="mx-4 sm:mx-6 mt-4 p-4 bg-emerald-100 border border-emerald-300 text-emerald-900 rounded-xl text-xs font-semibold flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>{actionSuccessMessage}</span>
            </div>
            <button type="button" onClick={() => setActionSuccessMessage('')} className="text-emerald-700 font-bold">
              ✕
            </button>
          </div>
        )}

        {lastIssuedInfo && (
          <div className="mx-4 sm:mx-6 mt-4 p-4 bg-white border-2 border-emerald-500 rounded-2xl shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-3">
              {lastIssuedInfo.cert.qr_data_url && (
                <img
                  src={lastIssuedInfo.cert.qr_data_url}
                  alt="Issued QR"
                  className="w-16 h-16 border border-slate-200 rounded-lg p-1 bg-white shrink-0"
                />
              )}
              <div className="space-y-1">
                <div className="font-bold text-emerald-900 flex items-center gap-1.5">
                  <QrCode className="w-4 h-4 text-emerald-700" />
                  <span>স্বয়ংক্রিয় QR ও PDF সনদ প্রস্তুত (সনদ নং: {lastIssuedInfo.cert.certificate_no})</span>
                </div>
                <div className="font-mono text-[11px] text-slate-600 break-all">
                  {lastIssuedInfo.verificationUrl}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {onNavigateVerify && (
                <button
                  type="button"
                  onClick={() => onNavigateVerify(lastIssuedInfo.token)}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-3 py-2 rounded-lg flex items-center gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>যাচাই পাতায় দেখুন</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => handleDownloadPdf(lastIssuedInfo.cert)}
                className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-3 py-2 rounded-lg flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button type="button" onClick={() => setLastIssuedInfo(null)} className="text-slate-400 px-2 py-1">
                ✕
              </button>
            </div>
          </div>
        )}

        {actionError && (
          <div className="mx-4 sm:mx-6 mt-4 p-4 bg-red-50 border border-red-300 text-red-900 rounded-xl text-xs font-semibold flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-700 shrink-0" />
              <span>{actionError}</span>
            </div>
            <button type="button" onClick={() => setActionError('')} className="text-red-700 font-bold">
              ✕
            </button>
          </div>
        )}

        {/* OVERVIEW TAB */}
        {activeMenu === 'overview' && (
          <div className="p-4 sm:p-6 space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 tabular-nums">
              <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs">
                <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-2">
                  <span>মোট আবেদন</span>
                  <div className="p-1.5 rounded-lg bg-blue-50 text-blue-700">
                    <FileText className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-black text-slate-900 font-mono">{totalApps}</div>
                <span className="text-[11px] text-slate-500 font-medium mt-1 block">
                  সক্রিয় ডাটাবেজ রেকর্ড
                </span>
              </div>

              <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs">
                <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-2">
                  <span>অপেক্ষমাণ / চলমান</span>
                  <div className="p-1.5 rounded-lg bg-amber-50 text-amber-700">
                    <Clock className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-black text-amber-700 font-mono">{pendingApps}</div>
                <span className="text-[11px] text-slate-500 font-medium mt-1 block">
                  যাচাই ও অনুমোদন অপেক্ষায়
                </span>
              </div>

              <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs">
                <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-2">
                  <span>অনুমোদিত ও ইস্যু</span>
                  <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700">
                    <CheckCircle className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-black text-emerald-800 font-mono">{approvedApps}</div>
                <span className="text-[11px] text-slate-500 font-medium mt-1 block">
                  বৈধ সনদ: {stats?.valid_certificates ?? 0} টি
                </span>
              </div>

              <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs">
                <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-2">
                  <span>সংগৃহীত রাজস্ব</span>
                  <div className="p-1.5 rounded-lg bg-purple-50 text-purple-700">
                    <CreditCard className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-black text-slate-900 font-mono">
                  ৳{totalRevenue.toLocaleString('bn-BD')}
                </div>
                <span className="text-[11px] text-emerald-700 font-semibold mt-1 block">
                  যাচাইকৃত অনলাইন পেমেন্ট
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Live Monthly Chart */}
              <div className="lg:col-span-7 bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-2xs">
                <div className="flex items-center justify-between mb-5 pb-2 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900">আবেদনের মাসিক পরিসংখ্যান (লাইভ ডাটা)</h3>
                  <span className="text-xs text-slate-500">মোট {totalApps}টি আবেদন</span>
                </div>

                {monthlyStats.length > 0 ? (
                  <div className="h-44 flex items-end justify-between gap-3 pt-6 px-2">
                    {monthlyStats.map((bar, i) => {
                      const pct = Math.max(12, Math.round((bar.count / maxMonthlyCount) * 100));
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group">
                          <span className="text-[11px] font-mono font-bold text-slate-700">
                            {bar.count}
                          </span>
                          <div
                            style={{ height: `${pct}%` }}
                            className="w-full max-w-10 bg-emerald-700 group-hover:bg-emerald-600 rounded-t-md transition-all"
                          />
                          <span className="text-[11px] text-slate-600 font-semibold">{bar.month}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="h-44 flex items-center justify-center text-xs text-slate-400">
                    পরিসংখ্যান প্রস্তুত হচ্ছে...
                  </div>
                )}
              </div>

              {/* Administrative Summary */}
              <div className="lg:col-span-5 bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
                <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
                  প্রশাসনিক সংক্ষেপ
                </h3>
                <div className="space-y-2.5 text-xs tabular-nums">
                  <div className="flex justify-between p-2.5 rounded-lg bg-slate-50">
                    <span className="text-slate-500">অধিক্ষেত্র:</span>
                    <span className="font-bold text-slate-900">
                      {isSuperOrUpazila && selectedUnitFilter === 'all' ? '১১টি প্রতিষ্ঠান (সকল)' : unit.name_bn}
                    </span>
                  </div>
                  <div className="flex justify-between p-2.5 rounded-lg bg-slate-50">
                    <span className="text-slate-500">সক্রিয় ট্রেড লাইসেন্স:</span>
                    <span className="font-bold text-slate-900 font-mono">
                      {stats?.active_trade_licenses ?? tradeLicenses.length}টি
                    </span>
                  </div>
                  <div className="flex justify-between p-2.5 rounded-lg bg-slate-50">
                    <span className="text-slate-500">বকেয়া হোল্ডিং ট্যাক্স:</span>
                    <span className="font-bold text-amber-700 font-mono">
                      ৳{stats?.holding_tax_due ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between p-2.5 rounded-lg bg-slate-50">
                    <span className="text-slate-500">ইস্যুকৃত সনদ (মোট / বাতিল):</span>
                    <span className="font-bold text-emerald-800 font-mono">
                      {stats?.total_certificates ?? 0} / {stats?.revoked_certificates ?? 0}
                    </span>
                  </div>
                </div>

                {isServiceOperator && onApplyNewService ? (
                  <button
                    type="button"
                    onClick={() => onApplyNewService('srv_warish', currentUnitId)}
                    className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-2.5 rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <PlusCircle className="w-4 h-4" />
                    <span>নতুন নাগরিক আবেদন এন্ট্রি (Intake)</span>
                  </button>
                ) : !isAccountant && hasPerm('applications.view') ? (
                  <button
                    type="button"
                    onClick={() => setActiveMenu('applications')}
                    className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-2.5 rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span>{isMonitoringOfficer ? 'আবেদন ও SLA পর্যবেক্ষণ করুন' : 'সকল আবেদন পর্যালোচনা করুন'}</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveMenu('payments')}
                    className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-2.5 rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span>রাজস্ব ও কর হিসাব দেখুন</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}

                {userSession.role === 'super_admin' && !canAnyApproval && (
                  <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                    <strong>নিরাপত্তা নীতি:</strong> সুপার অ্যাডমিন কারিগরি ও RBAC প্রশাসক; ডিফল্টভাবে সরাসরি সনদ স্বাক্ষর/অনুমোদন ক্ষমতা নেই।
                  </div>
                )}
              </div>
            </div>

            {/* Cross-Unit Institution Breakdown for Super Admin, UNO & Monitoring */}
            {isSuperOrUpazila && stats?.institution_breakdown && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">
                    প্রতিষ্ঠানভিত্তিক সেবা ও রাজস্ব সারাংশ (১০টি ইউনিয়ন + পাবনা পৌরসভা)
                  </h3>
                </div>
                <ResponsiveDataTable
                  data={stats.institution_breakdown}
                  columns={instBreakdownCols}
                  rowKey={(r) => r.unit_id}
                  mobileCardTitle={(r) => r.name_bn}
                />
              </div>
            )}

            {/* Recent Applications Table (hidden when applications.view is not granted) */}
            {hasPerm('applications.view') && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">সাম্প্রতিক আবেদনসমূহ</h3>
                  <button
                    type="button"
                    onClick={() => setActiveMenu('applications')}
                    className="text-xs text-emerald-700 hover:underline font-bold"
                  >
                    সব আবেদন দেখুন →
                  </button>
                </div>
                <ResponsiveDataTable
                  data={applications.slice(0, 6)}
                  columns={appColumns}
                  rowKey={(a) => a.id}
                  mobileCardTitle={(a) => `${a.service_name_bn} (${a.tracking_no})`}
                  mobileCardActions={(a) => (
                    <button
                      type="button"
                      onClick={() => openApplicationModal(a)}
                      className="bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-[11px]"
                    >
                      {isMonitoringOfficer ? 'পর্যবেক্ষণ দেখুন' : 'পর্যালোচনা ও পদক্ষেপ'}
                    </button>
                  )}
                />
              </div>
            )}
          </div>
        )}

        {/* APPLICATIONS TAB */}
        {activeMenu === 'applications' && (
          <div className="p-4 sm:p-6 space-y-5 min-w-0 max-w-full">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-900">আবেদন ব্যবস্থাপনা ও অনুমোদন</h2>
                <p className="text-xs text-slate-500">
                  নথি যাচাই, কর্মকর্তা নিয়োগ, সংশোধন অনুরোধ, ফরোয়ার্ড ও চূড়ান্ত QR সনদ অনুমোদন
                </p>
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold bg-white text-slate-800"
              >
                <option value="all">সকল অবস্থা ({applications.length})</option>
                <option value="pending_payment">পেমেন্ট অপেক্ষমাণ</option>
                <option value="paid">ফি পরিশোধিত</option>
                <option value="under_verification">যাচাই চলছে</option>
                <option value="correction_required">সংশোধন প্রয়োজন</option>
                <option value="forwarded_for_approval">অনুমোদনের জন্য প্রেরিত</option>
                <option value="certificate_issued">সনদ ইস্যুকৃত</option>
                <option value="rejected">বাতিল</option>
              </select>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
              <div className="p-4 border-b border-slate-100">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ট্র্যাকিং নম্বর, আবেদনকারী, সেবা অথবা কর্মকর্তা দিয়ে খুঁজুন..."
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-xs"
                />
              </div>

              <ResponsiveDataTable
                data={filteredApps}
                columns={appColumns}
                rowKey={(a) => a.id}
                mobileCardTitle={(a) => `${a.applicant_name_bn} — ${a.service_name_bn}`}
                mobileCardBadge={(a) => (
                  <span
                    className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                      APP_STATUS_BADGE[a.status]?.cls || 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {APP_STATUS_BADGE[a.status]?.label || a.status}
                  </span>
                )}
                mobileCardActions={(a) => (
                  <button
                    type="button"
                    onClick={() => openApplicationModal(a)}
                    className="bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-[11px]"
                  >
                    পর্যালোচনা ও অনুমোদন
                  </button>
                )}
              />
            </div>
          </div>
        )}

        {/* CERTIFICATES TAB */}
        {activeMenu === 'certificates' && (
          <CertificateManagementPanel
            userSession={userSession}
            institutions={institutions}
            services={services}
            canFinalApprove={canAnyApproval}
            isCrossUnit={isSuperOrUpazila}
            selectedUnitFilter={selectedUnitFilter}
            onPrintCertificate={onPrintCertificate}
            onNavigateVerify={onNavigateVerify}
            onRefreshDashboard={refreshServerData}
          />
        )}

        {/* MONITORING & SLA OBSERVATIONS TAB */}
        {activeMenu === 'monitoring' && (
          <div className="p-4 sm:p-6 space-y-5 min-w-0 max-w-full">
            <div>
              <h2 className="text-xl font-bold text-slate-900">উপজেলা মনিটরিং ও SLA পর্যবেক্ষণ</h2>
              <p className="text-xs text-slate-500">
                ১০টি ইউনিয়ন ও পাবনা পৌরসভার সেবার মান, পেন্ডিং জট ও সময়সীমা পর্যবেক্ষণ (সম্পূর্ণ Read-Only ও পর্যবেক্ষণ নোট)
              </p>
            </div>

            {hasPerm('monitoring.observe') && (
              <form
                onSubmit={handleCreateObservation}
                className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3 text-xs"
              >
                <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
                  নতুন পর্যবেক্ষণ নোট লিপিবদ্ধ করুন
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="font-bold block mb-1">প্রতিষ্ঠান *</label>
                    <select
                      value={obsUnitId}
                      onChange={(e) => setObsUnitId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white"
                    >
                      {institutions.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name_bn}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="font-bold block mb-1">গুরুত্ব / ধরন</label>
                    <select
                      value={obsSeverity}
                      onChange={(e) => setObsSeverity(e.target.value as typeof obsSeverity)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white"
                    >
                      <option value="info">সাধারণ তথ্য (Info)</option>
                      <option value="warning">সতর্কতা (Warning)</option>
                      <option value="overdue">সময়সীমা অতিক্রান্ত (Overdue)</option>
                      <option value="critical">জরুরি (Critical)</option>
                    </select>
                  </div>
                  <div>
                    <label className="font-bold block mb-1">সংশ্লিষ্ট আবেদন আইডি (ঐচ্ছিক)</label>
                    <input
                      type="text"
                      value={obsAppId}
                      onChange={(e) => setObsAppId(e.target.value)}
                      placeholder="যেমন: UP-2026-10025"
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="font-bold block mb-1">পর্যবেক্ষণ মন্তব্য *</label>
                  <textarea
                    rows={2}
                    required
                    value={obsText}
                    onChange={(e) => setObsText(e.target.value)}
                    placeholder="যেমন: নির্ধারিত ৩ কার্যদিবসের মধ্যে যাচাই প্রতিবেদন দাখিল নিশ্চিত করার পরামর্শ..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                  />
                </div>
                <button
                  type="submit"
                  disabled={obsBusy}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-4 py-2 rounded-xl"
                >
                  {obsBusy ? 'সংরক্ষণ হচ্ছে...' : 'পর্যবেক্ষণ দাখিল করুন'}
                </button>
              </form>
            )}

            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">
                দাখিলকৃত পর্যবেক্ষণসমূহ ({monitoringObservations.length})
              </h3>
              {monitoringObservations.length === 0 ? (
                <p className="text-xs text-slate-400">এখনো কোনো মনিটরিং পর্যবেক্ষণ দাখিল করা হয়নি।</p>
              ) : (
                <div className="space-y-2 text-xs">
                  {monitoringObservations.map((obs) => (
                    <div key={obs.id} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              obs.severity === 'critical' || obs.severity === 'overdue'
                                ? 'bg-red-100 text-red-800'
                                : obs.severity === 'warning'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {obs.severity}
                          </span>
                          <span className="font-bold text-slate-900">
                            {institutions.find((i) => i.id === obs.administrative_unit_id)?.name_bn ||
                              obs.administrative_unit_id}
                          </span>
                          {obs.application_id && (
                            <span className="font-mono text-[11px] text-emerald-800">
                              ({obs.application_id})
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-slate-500">
                          {new Date(obs.created_at).toLocaleString('bn-BD')}
                        </span>
                      </div>
                      <p className="text-slate-800">{obs.observation_bn}</p>
                      <div className="text-[11px] text-slate-500">পর্যবেক্ষক: {obs.officer_name_bn}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* PAYMENTS TAB */}
        {activeMenu === 'payments' && (
          <PaymentsPanel
            userSession={userSession}
            institutions={institutions}
            isCrossUnit={isSuperOrUpazila}
            canFinalApprove={canAnyApproval}
            currentUnit={unit}
            applications={applications}
            totalRevenue={totalRevenue}
            refundRequests={refundRequests}
            onSuccess={setActionSuccessMessage}
            onError={setActionError}
            onRefreshAll={refreshServerData}
          />
        )}

        {/* HOLDING TAX TAB */}
        {activeMenu === 'holding_tax' && (
          <HoldingTaxPanel
            userSession={userSession}
            institutions={institutions}
            isCrossUnit={isSuperOrUpazila}
            canFinalApprove={canAnyApproval}
            currentUnit={unit}
            holdingTaxes={holdingTaxes}
            onSuccess={setActionSuccessMessage}
            onError={setActionError}
            onRefreshAll={refreshServerData}
          />
        )}

        {/* TRADE LICENSE TAB */}
        {activeMenu === 'trade_license' && (
          <TradeLicensePanel
            userSession={userSession}
            institutions={institutions}
            isCrossUnit={isSuperOrUpazila}
            canFinalApprove={canAnyApproval}
            currentUnit={unit}
            tradeLicenses={tradeLicenses}
            onSuccess={setActionSuccessMessage}
            onError={setActionError}
            onRefreshAll={refreshServerData}
          />
        )}

        {/* STAFF DIRECTORY TAB */}
        {activeMenu === 'staff' && (
          <StaffPanel
            userSession={userSession}
            institutions={institutions}
            isCrossUnit={isSuperOrUpazila}
            canFinalApprove={canAnyApproval}
            currentUnit={unit}
            staff={staffMembers}
            onSuccess={setActionSuccessMessage}
            onError={setActionError}
            onRefreshAll={refreshServerData}
          />
        )}

        {/* WARDS / DEPARTMENTS & NOTICES TABS */}
        {(activeMenu === 'wards_depts' || activeMenu === 'notices') && (
          <WardsAndNoticesPanel
            mode={activeMenu}
            userSession={userSession}
            institutions={institutions}
            isCrossUnit={isSuperOrUpazila}
            canFinalApprove={canAnyApproval}
            currentUnit={unit}
            wardsDepts={wardsDepts}
            notices={notices}
            onSuccess={setActionSuccessMessage}
            onError={setActionError}
            onRefreshAll={refreshServerData}
          />
        )}

        {/* ROLE & RBAC PERMISSION MANAGEMENT TAB */}
        {activeMenu === 'role_management' && (
          <RoleManagementPanel
            userSession={userSession}
            institutions={institutions}
            services={services}
            onSuccess={setActionSuccessMessage}
            onError={setActionError}
          />
        )}

        {/* SERVICES CONFIG, REPORTS, AND SETTINGS TABS */}
        {(activeMenu === 'services_config' || activeMenu === 'reports' || activeMenu === 'settings') && (
          <ReportsAndSettingsPanel
            mode={activeMenu}
            userSession={userSession}
            institutions={institutions}
            isCrossUnit={isSuperOrUpazila}
            canFinalApprove={canAnyApproval}
            currentUnit={unit}
            templates={templates}
            events={events}
            verificationLogs={verificationLogs}
            inquiries={inquiries}
            rolePermissions={rolePermissions}
            systemSettings={systemSettings}
            services={services}
            onSuccess={setActionSuccessMessage}
            onError={setActionError}
            onRefreshAll={refreshServerData}
          />
        )}

        {/* APPLICATION REVIEW & WORKFLOW MODAL */}
        {selectedApp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="bg-white rounded-2xl max-w-2xl w-full p-5 sm:p-6 space-y-5 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto text-xs">
              <div className="flex items-start justify-between border-b border-slate-200 pb-3">
                <div>
                  <span className="font-mono font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    {selectedApp.tracking_no}
                  </span>
                  <h3 className="text-lg font-bold text-slate-900 mt-1">
                    {selectedApp.service_name_bn} — আবেদন পর্যালোচনা
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedApp(null)}
                  className="text-slate-400 hover:text-slate-700 p-1 rounded-full font-bold"
                >
                  ✕
                </button>
              </div>

              {/* Applicant Info Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-400 block">আবেদনকারী:</span>
                  <span className="font-bold text-slate-900">{selectedApp.applicant_name_bn}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">পিতা / মাতা:</span>
                  <span className="font-semibold text-slate-800">
                    {selectedApp.father_name_bn} / {selectedApp.mother_name_bn}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">এনআইডি / জন্ম নিবন্ধন:</span>
                  <span className="font-mono font-semibold text-slate-800">{selectedApp.nid_or_birth_reg}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">ওয়ার্ড ও ঠিকানা:</span>
                  <span className="font-semibold text-slate-800">
                    {selectedApp.ward_no} নং ওয়ার্ড, {selectedApp.village_or_area_bn}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">মোবাইল নম্বর:</span>
                  <span className="font-mono text-slate-800">{selectedApp.mobile}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">পরিশোধিত ফি:</span>
                  <span className="font-mono font-bold text-emerald-800">
                    ৳{selectedApp.fee_amount} ({selectedApp.payment_method?.toUpperCase() || '—'} {selectedApp.transaction_id || ''})
                  </span>
                </div>
              </div>

              {/* Assign Officer Row (only if applications.assign permitted) */}
              {hasPerm('applications.assign') && (
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center gap-2.5">
                  <div className="flex items-center gap-1.5 font-bold text-slate-800 shrink-0">
                    <UserPlus className="w-4 h-4 text-emerald-700" />
                    <span>কর্মকর্তা নিয়োগ:</span>
                  </div>
                  <select
                    value={assignStaffId}
                    onChange={(e) => setAssignStaffId(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
                  >
                    <option value="">কর্মকর্তা নির্বাচন করুন...</option>
                    {unitStaffOptions.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name_bn} ({st.designation_bn})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!assignStaffId || submitting}
                    onClick={handleAssignOfficer}
                    className="bg-slate-800 hover:bg-slate-900 disabled:opacity-40 text-white font-bold px-3.5 py-1.5 rounded-lg shrink-0"
                  >
                    দায়িত্ব অর্পণ
                  </button>
                </div>
              )}

              {/* Uploaded Attachments */}
              {selectedApp.attachments && selectedApp.attachments.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Paperclip className="w-3.5 h-3.5 text-emerald-700" />
                    <span>সংযুক্ত কাগজপত্র ({selectedApp.attachments.length})</span>
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedApp.attachments.map((att) => (
                      <a
                        key={att.id}
                        href={`/api/attachments/${encodeURIComponent(att.id)}?auth_token=${encodeURIComponent(
                          userSession.token || ''
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 font-semibold hover:bg-emerald-100 flex items-center gap-1.5"
                      >
                        <Paperclip className="w-3 h-3" />
                        <span>{att.original_name}</span>
                        <span className="text-[10px] text-slate-500">
                          ({(att.size_bytes / 1024).toFixed(1)} KB)
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Warish Heirs Table */}
              {selectedApp.heirs && selectedApp.heirs.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-bold text-slate-800">দাখিলকৃত ওয়ারিশগণের তালিকা:</h4>
                  <div className="border border-slate-200 rounded-xl overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-slate-100 text-slate-700 font-bold">
                        <tr>
                          <th className="py-1.5 px-3">নং</th>
                          <th className="py-1.5 px-3">নাম</th>
                          <th className="py-1.5 px-3">বয়স</th>
                          <th className="py-1.5 px-3">সম্পর্ক</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedApp.heirs.map((h, i) => (
                          <tr key={i}>
                            <td className="py-1.5 px-3 font-mono">{i + 1}</td>
                            <td className="py-1.5 px-3 font-semibold text-slate-900">{h.name}</td>
                            <td className="py-1.5 px-3 font-mono">{h.age} বছর</td>
                            <td className="py-1.5 px-3 text-slate-700">{h.relation}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Approval / Workflow History */}
              {selectedAppHistory.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-blue-700" />
                    <span>পূর্ববর্তী অনুমোদন ও যাচাই ইতিহাস</span>
                  </h4>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {selectedAppHistory.map((ap) => (
                      <div key={ap.id} className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex justify-between gap-2">
                        <span>
                          <strong className="text-emerald-900">{ap.decision}</strong> — {ap.officer_name_bn}: {ap.notes}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500 shrink-0">
                          {new Date(ap.approved_at).toLocaleDateString('bn-BD')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Review notes & validity input */}
              {(hasPerm('applications.verify') ||
                hasPerm('applications.forward') ||
                hasPerm('applications.recommend') ||
                hasPerm('applications.request_correction') ||
                hasPerm('applications.reject') ||
                hasApprovalAuthorityFor(selectedApp.administrative_unit_id, selectedApp.service_id)) && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="font-bold text-slate-700 block mb-1">
                      দাপ্তরিক যাচাই মন্তব্য (Review Notes):
                    </label>
                    <textarea
                      rows={2}
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                      placeholder="ওয়ার্ড সদস্যের প্রতিবেদন অনুযায়ী তথ্য সঠিক..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-1 focus:ring-emerald-600 focus:outline-hidden"
                    />
                  </div>
                  {hasApprovalAuthorityFor(selectedApp.administrative_unit_id, selectedApp.service_id) && (
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">মেয়াদ (দিন — ঐচ্ছিক):</label>
                      <input
                        type="number"
                        min={1}
                        value={expiresInDays}
                        onChange={(e) => setExpiresInDays(e.target.value)}
                        placeholder="স্থায়ী (খালি রাখুন)"
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono focus:ring-1 focus:ring-emerald-600 focus:outline-hidden"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Correction Request Box */}
              {showCorrectionInput && hasPerm('applications.request_correction') && (
                <div className="p-3.5 rounded-xl bg-orange-50 border border-orange-200 space-y-2">
                  <label className="font-bold text-orange-900 block">
                    সংশোধনের কারণ উল্লেখ করুন (নাগরিকের কাছে প্রেরণ করা হবে):
                  </label>
                  <textarea
                    rows={2}
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                    placeholder="যেমন: জাতীয় পরিচয়পত্রের স্পষ্ট কপি এবং পিতার নামের বানান সংশোধন করুন..."
                    className="w-full px-3 py-2 border border-orange-300 rounded-xl bg-white"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCorrectionInput(false)}
                      className="px-3 py-1 rounded-lg border border-slate-300 bg-white font-bold"
                    >
                      বাতিল
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleRequestCorrection}
                      className="px-3 py-1 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-bold"
                    >
                      নিশ্চিত সংশোধন ফেরত পাঠান
                    </button>
                  </div>
                </div>
              )}

              {!hasApprovalAuthorityFor(selectedApp.administrative_unit_id, selectedApp.service_id) && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900">
                  আপনার বর্তমান পদবি ও অনুমোদন সীমা (<strong>{userSession.title_bn}</strong>) অনুযায়ী এই আবেদনের চূড়ান্ত অনুমোদন ও সনদ স্বাক্ষরের ক্ষমতা নির্ধারিত নেই। কেবল নির্ধারিত চেয়ারম্যান / মেয়র / অনুমোদিত প্রশাসনিক কর্মকর্তা চূড়ান্ত অনুমোদন করতে পারবেন।
                </div>
              )}

              {/* Action Buttons (Strictly RBAC Gated) */}
              <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {hasPerm('applications.reject') && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleUpdateStatus('rejected')}
                      className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold px-3.5 py-2 rounded-xl transition-colors disabled:opacity-50"
                    >
                      আবেদন বাতিল
                    </button>
                  )}
                  {hasPerm('applications.request_correction') && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => setShowCorrectionInput((v) => !v)}
                      className="bg-orange-50 hover:bg-orange-100 text-orange-800 border border-orange-200 font-bold px-3.5 py-2 rounded-xl transition-colors flex items-center gap-1 disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>সংশোধন ফেরত</span>
                    </button>
                  )}
                  {hasPerm('monitoring.observe') && (
                    <button
                      type="button"
                      onClick={() => {
                        setObsUnitId(selectedApp.administrative_unit_id);
                        setObsAppId(selectedApp.tracking_no);
                        setSelectedApp(null);
                        setActiveMenu('monitoring');
                      }}
                      className="bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 font-bold px-3.5 py-2 rounded-xl transition-colors flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>মনিটরিং নোট যোগ</span>
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {hasPerm('applications.verify') && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleUpdateStatus('under_verification')}
                      className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold px-3.5 py-2 rounded-xl transition-colors disabled:opacity-50"
                    >
                      সরেজমিন যাচাই
                    </button>
                  )}

                  {(hasPerm('applications.forward') || hasPerm('applications.recommend')) &&
                    !hasApprovalAuthorityFor(selectedApp.administrative_unit_id, selectedApp.service_id) && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleUpdateStatus('forwarded_for_approval')}
                        className="bg-teal-700 hover:bg-teal-800 text-white font-bold px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
                      >
                        {hasPerm('applications.recommend') && !hasPerm('applications.forward')
                          ? 'সুপারিশ ও ফরোয়ার্ড'
                          : 'অনুমোদনের জন্য ফরোয়ার্ড'}
                      </button>
                    )}

                  {hasApprovalAuthorityFor(selectedApp.administrative_unit_id, selectedApp.service_id) && (
                    <button
                      type="button"
                      disabled={submitting || selectedApp.payment_status !== 'paid'}
                      onClick={() => handleUpdateStatus('certificate_issued')}
                      className="bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold px-5 py-2.5 rounded-xl transition-colors shadow-md flex items-center gap-1.5"
                    >
                      <Award className="w-4 h-4" />
                      <span>
                        {submitting
                          ? 'QR ও PDF তৈরি হচ্ছে...'
                          : selectedApp.payment_status !== 'paid'
                          ? 'ফি বকেয়া (ইস্যু অযোগ্য)'
                          : 'চূড়ান্ত অনুমোদন ও সনদ ইস্যু'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
