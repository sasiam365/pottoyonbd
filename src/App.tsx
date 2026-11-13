import React, { useState, useEffect, useCallback } from 'react';
import { FileCheck2, ArrowRight, RotateCcw, AlertTriangle } from 'lucide-react';
import { Header } from './components/common/Header';
import { Footer } from './components/common/Footer';
import { MobileBottomNav } from './components/common/MobileBottomNav';
import { HeroSection } from './components/home/HeroSection';
import { InstitutionSelector } from './components/home/InstitutionSelector';
import { PopularServices } from './components/home/PopularServices';
import { NoticeBoardCard } from './components/home/NoticeBoardCard';
import { QuickActionBanner } from './components/home/QuickActionBanner';
import { AllServicesView } from './components/services/AllServicesView';
import { InstitutionDirectoryView } from './components/institutions/InstitutionDirectoryView';
import { InstitutionDetailView } from './components/institutions/InstitutionDetailView';
import { ApplicationWizard } from './components/application/ApplicationWizard';
import { ApplicationTrackingView } from './components/tracking/ApplicationTrackingView';
import { CertificateVerificationView } from './components/verification/CertificateVerificationView';
import { WarishCertificateView } from './components/certificate/WarishCertificateView';
import { CertificatePrintPage } from './components/certificate/CertificatePrintPage';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { AdminLoginView } from './components/admin/AdminLoginView';
import { CitizenDashboard } from './components/citizen/CitizenDashboard';
import { AboutView } from './components/pages/AboutView';
import { NoticesView } from './components/pages/NoticesView';
import { ContactView } from './components/pages/ContactView';
import { LegalView } from './components/pages/LegalView';
import { storage } from './services/storage';
import { api } from './services/api';
import {
  AdministrativeUnit,
  Service,
  Certificate,
  Application,
  Notice,
  UserRole,
  UserSession,
} from './types';

export default function App() {
  const [lang, setLang] = useState<'bn' | 'en'>('bn');
  const [currentView, setCurrentView] = useState<string>('home');
  const [viewParam, setViewParam] = useState<string | undefined>(undefined);
  const [servicesInitialCategory, setServicesInitialCategory] = useState<string>('all');
  const [servicesSearchQuery, setServicesSearchQuery] = useState<string>('');
  const [selectedServiceId, setSelectedServiceId] = useState<string>('srv_warish');
  const [selectedUnitId, setSelectedUnitId] = useState<string>('unit_goyeshpur');
  const [activeCertificate, setActiveCertificate] = useState<Certificate | null>(null);
  const [activeCertificateTrackingNo, setActiveCertificateTrackingNo] = useState<string | undefined>(
    undefined
  );
  const [printCertificateId, setPrintCertificateId] = useState<string | undefined>(undefined);
  const [printAutoTrigger, setPrintAutoTrigger] = useState<boolean>(false);
  const [printReturnView, setPrintReturnView] = useState<string>('home');

  // Accessible Reset Database Confirmation Modal state (replaces banned window.confirm)
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  // User session state
  const [userSession, setUserSession] = useState<UserSession>({
    role: 'citizen',
    name: 'সাধারণ নাগরিক',
    title_bn: 'নাগরিক সেবা ব্যবহারকারী',
  });

  // Live data state (seeded immediately, synced with backend API)
  const [institutions, setInstitutions] = useState<AdministrativeUnit[]>(() => storage.getInstitutions());
  const [services, setServices] = useState<Service[]>(() => storage.getServices());
  const [notices, setNotices] = useState<Notice[]>(() => storage.getNotices());

  const refreshPlatformData = useCallback(async () => {
    try {
      const [instRes, srvList, noticeList] = await Promise.all([
        fetch('/api/institutions').then((r) => (r.ok ? r.json() : null)),
        api.listServices().catch(() => null),
        api.listNotices().catch(() => null),
      ]);
      if (Array.isArray(instRes) && instRes.length > 0) setInstitutions(instRes);
      if (Array.isArray(srvList) && srvList.length > 0) setServices(srvList);
      if (Array.isArray(noticeList) && noticeList.length > 0) setNotices(noticeList);
    } catch {
      // keep initial seed fallback cleanly
    }
  }, []);

  useEffect(() => {
    refreshPlatformData();
  }, [refreshPlatformData]);

  // URL path detector for /verify/{token} and /certificates/{id}/print
  useEffect(() => {
    const syncFromPath = () => {
      const path = window.location.pathname;
      const certPrintMatch = path.match(/^\/certificates\/([^/]+)\/print\/?$/);
      if (certPrintMatch) {
        const certId = decodeURIComponent(certPrintMatch[1]);
        const qs = new URLSearchParams(window.location.search);
        const trackingParam = qs.get('tracking_no') || undefined;
        const autoPrintParam = qs.get('autoprint') !== '0';
        setPrintCertificateId(certId);
        if (trackingParam) setActiveCertificateTrackingNo(trackingParam);
        setPrintAutoTrigger(autoPrintParam);
        setCurrentView('certificate_print');
        return;
      }

      if (path.startsWith('/verify/')) {
        const token = decodeURIComponent(path.slice('/verify/'.length)).replace(/\/+$/, '');
        if (token) {
          setCurrentView('verify');
          setViewParam(token);
        }
      } else if (path === '/verify') {
        setCurrentView('verify');
      } else {
        setCurrentView((prev) => (prev === 'certificate_print' ? printReturnView : prev));
      }
    };
    syncFromPath();
    window.addEventListener('popstate', syncFromPath);
    return () => window.removeEventListener('popstate', syncFromPath);
  }, [printReturnView]);

  const handleNavigate = (view: string, param?: string) => {
    if (window.location.pathname !== '/') {
      window.history.pushState({}, '', '/');
    }
    setCurrentView(view);
    setViewParam(param);
    if (view === 'services') {
      setServicesInitialCategory(param || 'all');
      if (!param) setServicesSearchQuery('');
    }
    if (view === 'institution_detail' && param) {
      setSelectedUnitId(param);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSearchServices = (query: string) => {
    setServicesInitialCategory('all');
    setServicesSearchQuery(query);
    setCurrentView('services');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleToggleLang = () => {
    const next = lang === 'bn' ? 'en' : 'bn';
    setLang(next);
    document.documentElement.lang = next;
  };

  const handleSwitchRole = async (role: UserRole, unitId?: string, username?: string) => {
    const isMuni =
      role === 'municipality_admin' ||
      role === 'mayor' ||
      role === 'executive_officer' ||
      role === 'department_officer' ||
      role === 'municipality_accountant' ||
      role === 'municipality_service_operator';

    const targetUnitId = isMuni
      ? 'unit_pabna_muni'
      : role === 'super_admin' ||
        role === 'upazila_admin' ||
        role === 'upazila_monitoring_officer' ||
        role === 'citizen'
      ? undefined
      : unitId || 'unit_goyeshpur';

    try {
      const result = await api.switchRole(role, targetUnitId, username);
      setUserSession(result.session);
      setCurrentView(role === 'citizen' ? 'citizen_dashboard' : 'admin_dashboard');
    } catch {
      if (role === 'citizen') {
        setUserSession({
          role: 'citizen',
          name: 'সাধারণ নাগরিক',
          title_bn: 'নাগরিক সেবা ব্যবহারকারী',
        });
        setCurrentView('citizen_dashboard');
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setUserSession({
      role: 'citizen',
      name: 'সাধারণ নাগরিক',
      title_bn: 'নাগরিক সেবা ব্যবহারকারী',
    });
    setCurrentView('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleConfirmResetData = async () => {
    setResetBusy(true);
    try {
      await api.resetDatabase();
    } catch {
      // ignore network fallback
    }
    storage.resetDatabase();
    setInstitutions(storage.getInstitutions());
    setServices(storage.getServices());
    setNotices(storage.getNotices());
    await refreshPlatformData();
    setResetBusy(false);
    setResetModalOpen(false);
    setCurrentView('home');
  };

  const handleApplyService = (serviceId: string, unitId?: string) => {
    setSelectedServiceId(serviceId);
    if (unitId) setSelectedUnitId(unitId);
    setCurrentView('apply');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleApplicationCompleted = (app: Application) => {
    storage.saveApplication(app);
  };

  const handleViewCertificate = (cert: Certificate, trackingNo?: string) => {
    setActiveCertificate(cert);
    setActiveCertificateTrackingNo(trackingNo);
    setCurrentView('certificate_view');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenCertificatePrintRoute = (
    cert: Certificate,
    trackingNo?: string,
    autoPrint = true
  ) => {
    const effectiveTracking = trackingNo || cert.application_tracking_no;
    setPrintReturnView(currentView === 'certificate_print' ? printReturnView : currentView);
    setActiveCertificate(cert);
    setActiveCertificateTrackingNo(effectiveTracking);
    setPrintCertificateId(cert.id);
    setPrintAutoTrigger(autoPrint);
    const qs = new URLSearchParams();
    if (effectiveTracking) qs.set('tracking_no', effectiveTracking);
    qs.set('autoprint', autoPrint ? '1' : '0');
    const targetUrl = `/certificates/${encodeURIComponent(cert.id)}/print?${qs.toString()}`;
    window.history.pushState({ view: 'certificate_print', certId: cert.id }, '', targetUrl);
    setCurrentView('certificate_print');
    window.scrollTo({ top: 0 });
  };

  const handleExitCertificatePrintRoute = () => {
    if (window.location.pathname.startsWith('/certificates/')) {
      window.history.pushState({}, '', '/');
    }
    setCurrentView(printReturnView || 'home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const selectedInstitution =
    institutions.find((i) => i.id === selectedUnitId) || institutions[0];

  // Dedicated standalone certificate print route (/certificates/:id/print)
  // Renders ONLY the A4 certificate document without any site headers, sidebars, footers, or dashboard UI.
  if (currentView === 'certificate_print' && printCertificateId) {
    return (
      <CertificatePrintPage
        certificateId={printCertificateId}
        initialCertificate={activeCertificate}
        institutions={institutions}
        authToken={userSession.token}
        trackingNo={activeCertificateTrackingNo}
        autoPrint={printAutoTrigger}
        onBack={handleExitCertificatePrintRoute}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F3F6F4] text-slate-800">
      {/* Universal Top Header */}
      <div className="print-hide-when-modal no-print">
        <Header
          currentView={currentView}
          onNavigate={handleNavigate}
          onSearchServices={handleSearchServices}
          lang={lang}
          onToggleLang={handleToggleLang}
          institutions={institutions}
          userSession={userSession}
          onSwitchRole={handleSwitchRole}
          onLogout={handleLogout}
          onResetData={() => setResetModalOpen(true)}
        />
      </div>

      {/* Main View Router */}
      <div className="flex-1 min-w-0">
        {/* 1. HOMEPAGE */}
        {currentView === 'home' && (
          <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 items-start">
              <div className="lg:col-span-8 space-y-6">
                <HeroSection
                  onApplyClick={() => handleApplyService('srv_warish')}
                  onTrackClick={() => handleNavigate('tracking')}
                  lang={lang}
                />

                <PopularServices
                  onSelectService={(serviceId) => handleApplyService(serviceId)}
                  onViewAllServices={() => handleNavigate('services', 'all')}
                  lang={lang}
                />
              </div>

              <div className="lg:col-span-4 space-y-5">
                <section className="hidden lg:flex bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs items-start gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-[#08783F] flex items-center justify-center shrink-0 border border-emerald-100">
                    <FileCheck2 className="w-7 h-7" />
                  </div>
                  <div className="space-y-2 flex-1">
                    <h2 className="text-lg font-bold text-slate-900 leading-tight">
                      {lang === 'bn' ? 'উত্তরাধিকার সনদ' : 'Inheritance Certificate'}
                    </h2>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {lang === 'bn'
                        ? 'অনলাইনে আবেদন করে সহজেই সংগ্রহ করুন।'
                        : 'Apply online and collect your verified certificate easily.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleApplyService('srv_inheritance')}
                      className="inline-flex items-center gap-1.5 bg-[#08783F] hover:bg-[#064E32] text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors shadow-2xs cursor-pointer"
                    >
                      <span>{lang === 'bn' ? 'আবেদন করুন' : 'Apply Now'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </section>

                <InstitutionSelector
                  institutions={institutions}
                  onSelectInstitution={(unitId) => handleApplyService('srv_warish', unitId)}
                  onViewDetails={(unitId) => handleNavigate('institution_detail', unitId)}
                  lang={lang}
                />

                <NoticeBoardCard
                  notices={notices}
                  onViewAllNotices={() => handleNavigate('notices')}
                  onSelectNotice={() => handleNavigate('notices')}
                  lang={lang}
                />
              </div>
            </div>

            <QuickActionBanner
              onNavigateServices={(cat) => handleNavigate('services', cat)}
              onApplyHoldingTax={() => handleApplyService('srv_holding_tax')}
              lang={lang}
            />
          </main>
        )}

        {/* 2. ALL SERVICES (47 Services) */}
        {currentView === 'services' && (
          <AllServicesView
            services={services}
            onApplyService={(serviceId) => handleApplyService(serviceId)}
            lang={lang}
            initialCategory={servicesInitialCategory}
            initialSearchQuery={servicesSearchQuery}
          />
        )}

        {/* 3. UNION DIRECTORY */}
        {currentView === 'union_directory' && (
          <InstitutionDirectoryView
            institutions={institutions}
            onSelectInstitution={(unitId) => handleNavigate('institution_detail', unitId)}
            lang={lang}
          />
        )}

        {/* 4. INSTITUTION DETAIL */}
        {currentView === 'institution_detail' && (
          <InstitutionDetailView
            institution={selectedInstitution}
            services={services}
            onApplyService={(serviceId, unitId) => handleApplyService(serviceId, unitId)}
            onBack={() => handleNavigate('union_directory')}
            lang={lang}
          />
        )}

        {/* 5. ONLINE APPLICATION 4-STEP WIZARD */}
        {currentView === 'apply' && (
          <ApplicationWizard
            initialServiceId={selectedServiceId}
            initialUnitId={selectedUnitId}
            institutions={institutions}
            services={services}
            authToken={userSession.token}
            onComplete={handleApplicationCompleted}
            onCancel={() =>
              handleNavigate(
                userSession.role === 'union_service_operator' ||
                  userSession.role === 'municipality_service_operator'
                  ? 'admin_dashboard'
                  : 'home'
              )
            }
            lang={lang}
          />
        )}

        {/* 6. APPLICATION TRACKING */}
        {currentView === 'tracking' && (
          <ApplicationTrackingView
            onViewCertificate={handleViewCertificate}
            onPrintCertificate={(cert, trackingNo) => handleOpenCertificatePrintRoute(cert, trackingNo, true)}
            lang={lang}
          />
        )}

        {/* 7. CERTIFICATE VERIFICATION (QR & Token) */}
        {currentView === 'verify' && (
          <CertificateVerificationView
            initialToken={viewParam || '10275626255'}
            onNavigateHome={() => handleNavigate('home')}
            lang={lang}
          />
        )}

        {/* 8. FULL WARISH CERTIFICATE PRINT/VIEW */}
        {currentView === 'certificate_view' && activeCertificate && (
          <WarishCertificateView
            certificate={activeCertificate}
            institution={institutions.find((i) => i.id === activeCertificate.administrative_unit_id)}
            authToken={userSession.token}
            trackingNo={activeCertificateTrackingNo}
            onOpenPrintRoute={(cert, trackingNo) => handleOpenCertificatePrintRoute(cert, trackingNo, true)}
            onBack={() =>
              handleNavigate(
                userSession.role === 'citizen' ? 'citizen_dashboard' : 'admin_dashboard'
              )
            }
            lang={lang}
          />
        )}

        {/* 9. CITIZEN SELF-SERVICE DASHBOARD */}
        {currentView === 'citizen_dashboard' && (
          <CitizenDashboard
            userSession={userSession}
            institutions={institutions}
            onApplyNew={() => handleApplyService('srv_warish')}
            onNavigateVerify={(token) => handleNavigate('verify', token)}
            onNavigateTracking={() => handleNavigate('tracking')}
            onNavigateAdminLogin={() => handleNavigate('admin_login')}
            onPrintCertificate={(cert, trackingNo) => handleOpenCertificatePrintRoute(cert, trackingNo, true)}
            onLogout={handleLogout}
          />
        )}

        {/* 10. ADMINISTRATIVE DASHBOARD */}
        {currentView === 'admin_dashboard' && (
          <AdminDashboard
            userSession={userSession}
            institutions={institutions}
            services={services}
            onViewCertificate={(cert) => handleViewCertificate(cert)}
            onPrintCertificate={(cert, trackingNo) => handleOpenCertificatePrintRoute(cert, trackingNo, true)}
            onNavigateVerify={(token) => handleNavigate('verify', token)}
            onRefreshPlatformData={refreshPlatformData}
            onApplyNewService={(serviceId, unitId) => handleApplyService(serviceId || 'srv_warish', unitId)}
            onLogout={handleLogout}
            lang={lang}
          />
        )}

        {/* 11. ADMINISTRATIVE LOGIN */}
        {currentView === 'admin_login' && (
          <AdminLoginView
            institutions={institutions}
            onLoginSuccess={(session) => {
              setUserSession(session);
              setCurrentView('admin_dashboard');
            }}
            onCancel={() => handleNavigate('home')}
            lang={lang}
          />
        )}

        {/* 12. ABOUT PAGE */}
        {currentView === 'about' && (
          <AboutView onApplyClick={() => handleApplyService('srv_warish')} lang={lang} />
        )}

        {/* 13. NOTICES */}
        {currentView === 'notices' && <NoticesView />}

        {/* 14. CONTACT */}
        {currentView === 'contact' && <ContactView />}

        {/* 15. LEGAL (Privacy & Terms) */}
        {currentView === 'privacy' && <LegalView type="privacy" />}
        {currentView === 'terms' && <LegalView type="terms" />}
      </div>

      {/* Universal Footer */}
      <div className="print-hide-when-modal no-print">
        <Footer onNavigate={handleNavigate} lang={lang} />
      </div>

      {/* Mobile Fixed 5-Item Bottom Navigation */}
      <div className="print-hide-when-modal no-print">
        <MobileBottomNav
          currentView={currentView}
          onNavigate={(view) => handleNavigate(view)}
          userSession={userSession}
          lang={lang}
        />
      </div>

      {/* Custom Accessible Database Reset Confirmation Modal (replaces window.confirm) */}
      {resetModalOpen && (
        <div className="no-print fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200 text-xs">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">ডেমো ডাটাবেজ রিসেট নিশ্চিত করুন</h3>
                <p className="text-slate-600 mt-1 leading-relaxed">
                  আপনি কি নিশ্চিত যে সকল ডেমো আবেদন, সনদ ও অডিট লগ প্রাথমিক অবস্থায় ফিরিয়ে নিতে চান?
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={resetBusy}
                onClick={() => setResetModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-bold"
              >
                বাতিল
              </button>
              <button
                type="button"
                disabled={resetBusy}
                onClick={handleConfirmResetData}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{resetBusy ? 'রিসেট হচ্ছে...' : 'হ্যাঁ, রিসেট করুন'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
