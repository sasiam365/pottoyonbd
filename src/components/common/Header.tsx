import React, { useState } from 'react';
import {
  MapPin,
  ChevronDown,
  User,
  Home,
  FileText,
  Search,
  Bell,
  Building2,
  Shield,
  RotateCcw,
  Menu,
  X,
  LogIn,
  LayoutGrid,
  QrCode,
  Phone,
  Briefcase
} from 'lucide-react';
import { BangladeshEmblem } from './BangladeshEmblem';
import { AdministrativeUnit, UserRole, UserSession } from '../../types';

interface HeaderProps {
  currentView: string;
  onNavigate: (view: string, param?: string) => void;
  onSearchServices: (query: string) => void;
  lang: 'bn' | 'en';
  onToggleLang: () => void;
  institutions: AdministrativeUnit[];
  userSession: UserSession;
  onSwitchRole: (role: UserRole, unitId?: string, username?: string) => void;
  onLogout?: () => void;
  onResetData: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentView,
  onNavigate,
  onSearchServices,
  lang,
  onToggleLang,
  institutions,
  userSession,
  onSwitchRole,
  onLogout,
  onResetData,
}) => {
  const [unionDropdownOpen, setUnionDropdownOpen] = useState(false);
  const [servicesDropdownOpen, setServicesDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [locationMenuOpen, setLocationMenuOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');

  const unions = institutions.filter((i) => i.type === 'union_parishad');
  const muni = institutions.find((i) => i.type === 'municipality');

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchServices(searchInput);
  };

  const getRoleDisplayName = (session: UserSession) => {
    if (session.role === 'citizen') return lang === 'bn' ? 'নাগরিক' : 'Citizen';
    if (session.role === 'super_admin') return 'Super Admin';
    if (session.role === 'upazila_admin') return 'UNO (উপজেলা)';
    if (session.role === 'upazila_monitoring_officer') return 'মনিটরিং কর্মকর্তা';
    if (session.role === 'municipality_admin') return 'পৌর প্রশাসক';
    if (session.role === 'mayor') return 'পৌর মেয়র';
    if (session.role === 'municipality_service_operator') return 'পৌর অপারেটর';
    if (session.role === 'union_service_operator') return 'ইউপি অপারেটর';
    return session.title_bn || 'ইউপি প্রশাসক';
  };

  return (
    <header className="no-print sticky top-0 z-50 bg-white border-b border-slate-200 select-none">
      {/* Top Dark Green Utility Bar (#064E32) matching mobile & desktop references */}
      <div className="bg-[#064E32] text-white text-[11px] sm:text-xs px-3 sm:px-6 py-1.5 border-b border-[#053D27]">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
          {/* Left: System Title + Compact Role Switcher */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <span className="font-semibold text-emerald-50 whitespace-nowrap truncate">
              {lang === 'bn' ? 'অনলাইন সার্টিফিকেট সিস্টেম' : 'Online Certificate System'}
            </span>

            {/* Preserved Role Switcher for Testing */}
            <div className="relative inline-block">
              <button
                onClick={() => setRoleMenuOpen(!roleMenuOpen)}
                className="flex items-center gap-1 bg-white/10 hover:bg-white/20 text-emerald-100 px-2 py-0.5 rounded text-[11px] transition-colors whitespace-nowrap"
                title="Switch active testing role"
              >
                <Shield className="w-3 h-3 text-emerald-300" />
                <span>{getRoleDisplayName(userSession)}</span>
                <ChevronDown className="w-3 h-3 opacity-80" />
              </button>

              {roleMenuOpen && (
                <div
                  onMouseLeave={() => setRoleMenuOpen(false)}
                  className="absolute left-0 mt-1.5 w-72 max-h-[75vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-50 py-1.5 text-slate-200"
                >
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 border-b border-slate-800 flex items-center justify-between">
                    <span>১৬টি রোল পরিবর্তন করুন</span>
                    <button
                      onClick={() => {
                        onResetData();
                        setRoleMenuOpen(false);
                      }}
                      className="text-amber-300 hover:underline flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>রিসেট</span>
                    </button>
                  </div>

                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-slate-950/60">
                    পাবলিক
                  </div>
                  <button
                    onClick={() => {
                      onSwitchRole('citizen', undefined, 'citizen');
                      setRoleMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-emerald-800/50 flex items-center justify-between ${
                      userSession.role === 'citizen' ? 'text-emerald-400 font-bold bg-slate-800' : ''
                    }`}
                  >
                    <span>১৬. সাধারণ নাগরিক (Citizen)</span>
                    {userSession.role === 'citizen' && <span>সক্রিয়</span>}
                  </button>

                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-slate-950/60 border-t border-slate-800">
                    ইউনিয়ন পরিষদ (১০টি ইউপি)
                  </div>
                  {[
                    { role: 'union_admin' as UserRole, unit: 'unit_goyeshpur', label: '৪. ইউনিয়ন প্রশাসক (গোয়েশপুর)', active: userSession.role === 'union_admin' && userSession.administrative_unit_id === 'unit_goyeshpur' },
                    { role: 'chairman' as UserRole, unit: 'unit_goyeshpur', label: '৫. ইউপি চেয়ারম্যান (গোয়েশপুর)', active: userSession.role === 'chairman' && userSession.administrative_unit_id === 'unit_goyeshpur' },
                    { role: 'secretary' as UserRole, unit: 'unit_goyeshpur', label: '৬. ইউপি সচিব (গোয়েশপুর)', active: userSession.role === 'secretary' },
                    { role: 'ward_member' as UserRole, unit: 'unit_goyeshpur', label: '৭. ওয়ার্ড সদস্য — ৪নং (গোয়েশপুর)', active: userSession.role === 'ward_member' },
                    { role: 'union_accountant' as UserRole, unit: 'unit_goyeshpur', label: '৮. ইউনিয়ন হিসাব সহকারী', active: userSession.role === 'union_accountant' },
                    { role: 'union_service_operator' as UserRole, unit: 'unit_goyeshpur', label: '৯. ইউনিয়ন সেবা অপারেটর (UDC)', active: userSession.role === 'union_service_operator' },
                    { role: 'union_admin' as UserRole, unit: 'unit_bharara', label: 'অন্য ইউপি: ভাঁড়ারা ইউপি প্রশাসক', active: userSession.administrative_unit_id === 'unit_bharara' },
                  ].map((item) => (
                    <button
                      key={`${item.role}_${item.unit}`}
                      onClick={() => {
                        onSwitchRole(item.role, item.unit);
                        setRoleMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-emerald-800/50 flex items-center justify-between ${
                        item.active ? 'text-emerald-400 font-bold bg-slate-800' : ''
                      }`}
                    >
                      <span>{item.label}</span>
                      {item.active && <span>সক্রিয়</span>}
                    </button>
                  ))}

                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-teal-400 bg-slate-950/60 border-t border-slate-800">
                    পাবনা পৌরসভা (স্বতন্ত্র)
                  </div>
                  {[
                    { role: 'municipality_admin' as UserRole, label: '১০. পৌর প্রশাসক (Municipality Admin)' },
                    { role: 'mayor' as UserRole, label: '১১. পৌর মেয়র (Mayor)' },
                    { role: 'executive_officer' as UserRole, label: '১২. প্রধান নির্বাহী কর্মকর্তা (CEO)' },
                    { role: 'department_officer' as UserRole, label: '১৩. পৌর বিভাগীয় কর্মকর্তা (লাইসেন্স)' },
                    { role: 'municipality_accountant' as UserRole, label: '১৪. পৌর হিসাবরক্ষক' },
                    { role: 'municipality_service_operator' as UserRole, label: '১৫. পৌর সেবা অপারেটর' },
                  ].map((item) => (
                    <button
                      key={item.role}
                      onClick={() => {
                        onSwitchRole(item.role, 'unit_pabna_muni');
                        setRoleMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-emerald-800/50 flex items-center justify-between ${
                        userSession.role === item.role ? 'text-emerald-400 font-bold bg-slate-800' : ''
                      }`}
                    >
                      <span>{item.label}</span>
                      {userSession.role === item.role && <span>সক্রিয়</span>}
                    </button>
                  ))}

                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300 bg-slate-950/60 border-t border-slate-800">
                    উপজেলা ও গ্লোবাল
                  </div>
                  {[
                    { role: 'upazila_admin' as UserRole, label: '২. উপজেলা প্রশাসক (UNO)' },
                    { role: 'upazila_monitoring_officer' as UserRole, label: '৩. উপজেলা মনিটরিং কর্মকর্তা' },
                    { role: 'super_admin' as UserRole, label: '১. সুপার অ্যাডমিন (Super Admin)' },
                  ].map((item) => (
                    <button
                      key={item.role}
                      onClick={() => {
                        onSwitchRole(item.role);
                        setRoleMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-emerald-800/50 flex items-center justify-between ${
                        userSession.role === item.role ? 'text-emerald-400 font-bold bg-slate-800' : ''
                      }`}
                    >
                      <span>{item.label}</span>
                      {userSession.role === item.role && <span>সক্রিয়</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Account shortcuts, Language Toggle & Red Login Button */}
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <button
              onClick={() => onNavigate('citizen_dashboard')}
              className="hidden sm:flex items-center gap-1 text-emerald-100 hover:text-white transition-colors whitespace-nowrap"
            >
              <User className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'নাগরিক ড্যাশবোর্ড' : 'Citizen Portal'}</span>
            </button>

            <button
              onClick={() => onNavigate('admin_login')}
              className="hidden md:flex items-center gap-1 text-emerald-100 hover:text-white transition-colors whitespace-nowrap"
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'প্রশাসনিক একাউন্ট' : 'Admin Account'}</span>
            </button>

            {/* Language switcher */}
            <button
              onClick={onToggleLang}
              className="bg-white/10 hover:bg-white/20 text-white px-2 py-0.5 rounded font-semibold transition-colors whitespace-nowrap"
            >
              {lang === 'bn' ? 'EN' : 'বাংলা'}
            </button>

            {/* Red Login / Dashboard + Logout Button */}
            {userSession.role === 'citizen' && !userSession.token ? (
              <button
                onClick={() => onNavigate('admin_login')}
                className="flex items-center gap-1 bg-[#DC2626] hover:bg-red-700 text-white px-2.5 sm:px-3 py-0.5 sm:py-1 rounded font-bold transition-colors shadow-2xs whitespace-nowrap"
              >
                <LogIn className="w-3 h-3" />
                <span>{lang === 'bn' ? 'লগইন' : 'Login'}</span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                {userSession.role !== 'citizen' && (
                  <button
                    onClick={() => onNavigate('admin_dashboard')}
                    className="flex items-center gap-1 bg-[#08783F] hover:bg-emerald-600 text-white px-2.5 sm:px-3 py-0.5 sm:py-1 rounded font-bold transition-colors border border-emerald-400/40 whitespace-nowrap"
                  >
                    <Building2 className="w-3 h-3" />
                    <span>{lang === 'bn' ? 'ড্যাশবোর্ড' : 'Dashboard'}</span>
                  </button>
                )}
                {onLogout && userSession.token && (
                  <button
                    onClick={onLogout}
                    className="bg-red-700 hover:bg-red-800 text-white px-2 py-0.5 sm:py-1 rounded font-bold transition-colors whitespace-nowrap"
                  >
                    {lang === 'bn' ? 'লগআউট' : 'Logout'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main White Brand + Location + Search Header */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-4">
        {/* Brand Lockup */}
        <div
          onClick={() => onNavigate('home')}
          className="flex items-center gap-2.5 sm:gap-3 cursor-pointer shrink-0 group"
        >
          <BangladeshEmblem size={42} />
          <div>
            <div className="text-xl sm:text-2xl font-black tracking-tight leading-none">
              <span className="text-[#064E32] group-hover:text-[#08783F] transition-colors">Pottoyon</span>
              <span className="text-[#DC2626]">BD</span>
            </div>
            <p className="text-[11px] sm:text-xs font-semibold text-slate-600 leading-tight mt-0.5">
              {lang === 'bn' ? 'স্থানীয় সরকার ডিজিটাল সেবা' : 'Digital Local Government Services'}
            </p>
          </div>
        </div>

        {/* Desktop Center Location Marker */}
        <div className="hidden lg:flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-[#F3F6F4] px-3.5 py-2 rounded-lg border border-slate-200/80 whitespace-nowrap">
          <MapPin className="w-4 h-4 text-[#08783F] shrink-0" />
          <span>{lang === 'bn' ? 'পাবনা সদর উপজেলা, পাবনা' : 'Pabna Sadar Upazila, Pabna'}</span>
        </div>

        {/* Desktop Right Search Bar & Notification Bell */}
        <div className="hidden lg:flex items-center gap-3 flex-1 max-w-md justify-end">
          <form onSubmit={handleSearchSubmit} className="relative flex-1 flex items-center">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={lang === 'bn' ? 'সেবা, ফরম বা তথ্য খুঁজুন...' : 'Search services, forms or info...'}
              className="w-full pl-4 pr-12 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[#08783F]"
            />
            <button
              type="submit"
              aria-label="Search"
              className="absolute right-1 top-1 bottom-1 px-3 rounded-md bg-[#08783F] hover:bg-[#064E32] text-white transition-colors flex items-center justify-center"
            >
              <Search className="w-4 h-4" />
            </button>
          </form>

          <button
            onClick={() => onNavigate('notices')}
            aria-label="Notifications"
            className="relative p-2 rounded-lg border border-slate-200 bg-[#F3F6F4] hover:bg-emerald-50 text-slate-700 hover:text-[#08783F] transition-colors"
            title={lang === 'bn' ? 'নোটিশ ও বিজ্ঞপ্তি' : 'Notices'}
          >
            <Bell className="w-4 h-4" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#DC2626] border-2 border-white"></span>
          </button>
        </div>

        {/* Mobile Right Controls: Bell + Hamburger */}
        <div className="flex items-center gap-1.5 lg:hidden shrink-0">
          <button
            onClick={() => onNavigate('notices')}
            aria-label="Notifications"
            className="relative p-2.5 rounded-lg text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <Bell className="w-5 h-5" />
            <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#DC2626]"></span>
          </button>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2.5 rounded-lg text-slate-800 hover:bg-slate-100 transition-colors"
            aria-label="Open navigation menu"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Location & Search Strip (matches mobile reference screenshot!) */}
      <div className="lg:hidden bg-white border-t border-slate-100 px-3 pb-2.5 pt-1.5 space-y-2">
        <div className="relative">
          <button
            onClick={() => setLocationMenuOpen(!locationMenuOpen)}
            className="w-full flex items-center justify-between text-xs font-semibold text-slate-700 py-1 px-1"
          >
            <span className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-[#08783F]" />
              <span>{lang === 'bn' ? 'পাবনা সদর উপজেলা, পাবনা' : 'Pabna Sadar Upazila, Pabna'}</span>
            </span>
            <ChevronDown className="w-4 h-4 text-slate-400" />
          </button>

          {locationMenuOpen && (
            <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-40 py-1.5 max-h-60 overflow-y-auto">
              <button
                onClick={() => {
                  onNavigate('institution_detail', 'unit_pabna_muni');
                  setLocationMenuOpen(false);
                }}
                className="w-full text-left px-3.5 py-2 text-xs font-bold text-[#08783F] hover:bg-emerald-50 border-b border-slate-100 flex items-center justify-between"
              >
                <span>পাবনা পৌরসভা (স্বতন্ত্র)</span>
                <span className="text-[10px] text-slate-500">১৫টি ওয়ার্ড</span>
              </button>
              {unions.map((u) => (
                <button
                  key={u.id}
                  onClick={() => {
                    onNavigate('institution_detail', u.id);
                    setLocationMenuOpen(false);
                  }}
                  className="w-full text-left px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-emerald-50 flex items-center justify-between"
                >
                  <span>{u.name_bn}</span>
                  <span className="text-[10px] text-slate-400">৯টি ওয়ার্ড</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={handleSearchSubmit} className="relative flex items-center">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={lang === 'bn' ? 'সেবা, ফরম বা তথ্য খুঁজুন...' : 'Search services, forms...'}
            className="w-full pl-3.5 pr-11 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[#08783F]"
          />
          <button
            type="submit"
            aria-label="Search"
            className="absolute right-0.5 top-0.5 bottom-0.5 px-3 rounded-md bg-[#064E32] hover:bg-[#08783F] text-white transition-colors flex items-center justify-center"
          >
            <Search className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* Desktop Navigation Row matching reference */}
      <nav className="hidden lg:block bg-white border-t border-slate-200/80">
        <div className="max-w-7xl mx-auto px-6 py-1.5 flex items-center justify-between text-sm font-semibold text-slate-700">
          <div className="flex items-center gap-2">
            {/* Home Button (Active green pill matching screenshot) */}
            <button
              onClick={() => onNavigate('home')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                currentView === 'home'
                  ? 'bg-[#08783F] text-white font-bold shadow-xs'
                  : 'text-slate-700 hover:text-[#08783F] hover:bg-[#F3F6F4]'
              }`}
            >
              <Home className="w-4 h-4" />
              <span>{lang === 'bn' ? 'প্রথম পাতা' : 'Home'}</span>
            </button>

            {/* Services Dropdown */}
            <div className="relative">
              <button
                onClick={() => onNavigate('services')}
                onMouseEnter={() => setServicesDropdownOpen(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  currentView === 'services'
                    ? 'bg-[#08783F] text-white font-bold'
                    : 'text-slate-700 hover:text-[#08783F] hover:bg-[#F3F6F4]'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
                <span>{lang === 'bn' ? 'সেবাসমূহ' : 'Services'}</span>
                <ChevronDown className="w-3.5 h-3.5 opacity-70" />
              </button>

              {servicesDropdownOpen && (
                <div
                  onMouseLeave={() => setServicesDropdownOpen(false)}
                  className="absolute left-0 top-full mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-xl py-2 z-50 text-xs"
                >
                  <button
                    onClick={() => {
                      onNavigate('services', 'citizen_personal');
                      setServicesDropdownOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 hover:bg-emerald-50 font-semibold text-slate-800"
                  >
                    নাগরিক ও ব্যক্তিগত সনদ (১৮টি)
                  </button>
                  <button
                    onClick={() => {
                      onNavigate('services', 'financial_social');
                      setServicesDropdownOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 hover:bg-emerald-50 font-semibold text-slate-800"
                  >
                    আর্থিক ও সামাজিক সনদ (১৩টি)
                  </button>
                  <button
                    onClick={() => {
                      onNavigate('services', 'nid_voter');
                      setServicesDropdownOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 hover:bg-emerald-50 font-semibold text-slate-800"
                  >
                    জাতীয় পরিচয় ও ভোটার (৫টি)
                  </button>
                  <button
                    onClick={() => {
                      onNavigate('services', 'licensing');
                      setServicesDropdownOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 hover:bg-emerald-50 font-semibold text-slate-800"
                  >
                    ট্রেড ও অন্যান্য লাইসেন্স (৩টি)
                  </button>
                  <div className="border-t border-slate-100 mt-1 pt-1">
                    <button
                      onClick={() => {
                        onNavigate('services', 'all');
                        setServicesDropdownOpen(false);
                      }}
                      className="w-full text-left px-4 py-2 text-[#08783F] font-bold hover:bg-emerald-50"
                    >
                      সকল ৪৭টি সেবা দেখুন →
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Union Parishad Dropdown */}
            <div className="relative">
              <button
                onClick={() => setUnionDropdownOpen(!unionDropdownOpen)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  unionDropdownOpen || currentView === 'union_directory'
                    ? 'bg-[#08783F] text-white font-bold'
                    : 'text-slate-700 hover:text-[#08783F] hover:bg-[#F3F6F4]'
                }`}
              >
                <Building2 className="w-4 h-4" />
                <span>{lang === 'bn' ? 'ইউনিয়ন পরিষদ' : 'Union Parishad'}</span>
                <ChevronDown className="w-3.5 h-3.5 opacity-70" />
              </button>

              {unionDropdownOpen && (
                <div
                  onMouseLeave={() => setUnionDropdownOpen(false)}
                  className="absolute left-0 top-full mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-xl py-2 z-50 divide-y divide-slate-100"
                >
                  <div className="px-3.5 py-1.5 text-xs font-bold text-slate-500 bg-[#F3F6F4]">
                    {lang === 'bn' ? 'পাবনা সদর উপজেলার ১০টি ইউনিয়ন' : '10 Unions of Pabna Sadar'}
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {unions.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => {
                          onNavigate('institution_detail', u.id);
                          setUnionDropdownOpen(false);
                        }}
                        className="w-full text-left px-3.5 py-2 text-xs hover:bg-emerald-50 hover:text-[#08783F] flex items-center justify-between transition-colors"
                      >
                        <span className="font-semibold text-slate-800">{u.name_bn}</span>
                        <span className="text-[11px] text-slate-400">৯টি ওয়ার্ড</span>
                      </button>
                    ))}
                  </div>
                  <div className="p-2 bg-[#F3F6F4] text-center">
                    <button
                      onClick={() => {
                        onNavigate('union_directory');
                        setUnionDropdownOpen(false);
                      }}
                      className="text-xs text-[#08783F] hover:underline font-bold"
                    >
                      {lang === 'bn' ? 'সব ইউনিয়নের বিবরণী দেখুন →' : 'View All Unions →'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Municipality */}
            <button
              onClick={() => onNavigate('institution_detail', muni?.id || 'unit_pabna_muni')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                currentView === 'institution_detail'
                  ? 'text-[#08783F] bg-[#F3F6F4] font-bold'
                  : 'text-slate-700 hover:text-[#08783F] hover:bg-[#F3F6F4]'
              }`}
            >
              <span>{lang === 'bn' ? 'পৌরসভা' : 'Municipality'}</span>
            </button>

            {/* Application Tracking */}
            <button
              onClick={() => onNavigate('tracking')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                currentView === 'tracking'
                  ? 'bg-[#08783F] text-white font-bold'
                  : 'text-slate-700 hover:text-[#08783F] hover:bg-[#F3F6F4]'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>{lang === 'bn' ? 'আবেদনের অবস্থা' : 'Application Tracking'}</span>
            </button>

            {/* Certificate Verification */}
            <button
              onClick={() => onNavigate('verify')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                currentView === 'verify'
                  ? 'bg-[#08783F] text-white font-bold'
                  : 'text-slate-700 hover:text-[#08783F] hover:bg-[#F3F6F4]'
              }`}
            >
              <QrCode className="w-4 h-4" />
              <span>{lang === 'bn' ? 'সনদ যাচাইকরণ' : 'Verify Certificate'}</span>
            </button>

            {/* Contact */}
            <button
              onClick={() => onNavigate('contact')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                currentView === 'contact'
                  ? 'bg-[#08783F] text-white font-bold'
                  : 'text-slate-700 hover:text-[#08783F] hover:bg-[#F3F6F4]'
              }`}
            >
              <Phone className="w-4 h-4" />
              <span>{lang === 'bn' ? 'যোগাযোগ' : 'Contact'}</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-white border-t border-slate-200 px-4 py-4 space-y-3 shadow-lg">
          <div className="grid grid-cols-2 gap-2 text-xs font-semibold">
            <button
              onClick={() => {
                onNavigate('home');
                setMobileMenuOpen(false);
              }}
              className="p-3 rounded-xl bg-[#F3F6F4] text-left hover:bg-emerald-50 text-slate-800"
            >
              প্রথম পাতা
            </button>
            <button
              onClick={() => {
                onNavigate('services');
                setMobileMenuOpen(false);
              }}
              className="p-3 rounded-xl bg-[#F3F6F4] text-left hover:bg-emerald-50 text-slate-800"
            >
              সেবাসমূহ (৪৭টি)
            </button>
            <button
              onClick={() => {
                onNavigate('union_directory');
                setMobileMenuOpen(false);
              }}
              className="p-3 rounded-xl bg-[#F3F6F4] text-left hover:bg-emerald-50 text-slate-800"
            >
              ১০টি ইউনিয়ন পরিষদ
            </button>
            <button
              onClick={() => {
                onNavigate('institution_detail', 'unit_pabna_muni');
                setMobileMenuOpen(false);
              }}
              className="p-3 rounded-xl bg-[#F3F6F4] text-left hover:bg-emerald-50 text-slate-800"
            >
              পাবনা পৌরসভা
            </button>
            <button
              onClick={() => {
                onNavigate('tracking');
                setMobileMenuOpen(false);
              }}
              className="p-3 rounded-xl bg-[#F3F6F4] text-left hover:bg-emerald-50 text-slate-800"
            >
              আবেদনের অবস্থা
            </button>
            <button
              onClick={() => {
                onNavigate('verify');
                setMobileMenuOpen(false);
              }}
              className="p-3 rounded-xl bg-[#F3F6F4] text-left hover:bg-emerald-50 text-slate-800"
            >
              সনদ যাচাই (QR)
            </button>
            <button
              onClick={() => {
                onNavigate('notices');
                setMobileMenuOpen(false);
              }}
              className="p-3 rounded-xl bg-[#F3F6F4] text-left hover:bg-emerald-50 text-slate-800"
            >
              নোটিশ বোর্ড
            </button>
            <button
              onClick={() => {
                onNavigate('contact');
                setMobileMenuOpen(false);
              }}
              className="p-3 rounded-xl bg-[#F3F6F4] text-left hover:bg-emerald-50 text-slate-800"
            >
              যোগাযোগ
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
