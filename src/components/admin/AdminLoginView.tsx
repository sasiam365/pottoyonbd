import React, { useState } from 'react';
import { Shield, Lock, KeyRound, CheckCircle2 } from 'lucide-react';
import { AdministrativeUnit, UserRole, UserSession } from '../../types';
import { api } from '../../services/api';

interface AdminLoginViewProps {
  institutions: AdministrativeUnit[];
  onLoginSuccess: (session: UserSession) => void;
  onCancel: () => void;
  lang?: 'bn' | 'en';
}

const MUNI_ROLES = new Set<UserRole>([
  'municipality_admin',
  'mayor',
  'executive_officer',
  'department_officer',
  'municipality_accountant',
  'municipality_service_operator',
]);

const GLOBAL_ROLES = new Set<UserRole>([
  'super_admin',
  'upazila_admin',
  'upazila_monitoring_officer',
  'citizen',
]);

function resolveDefaultUsername(role: UserRole, unitCode = 'goyeshpur'): string {
  switch (role) {
    case 'super_admin':
      return 'superadmin';
    case 'upazila_admin':
      return 'pabna.uno';
    case 'upazila_monitoring_officer':
      return 'pabna.monitor';
    case 'municipality_admin':
      return 'pabna.muni.admin';
    case 'mayor':
      return 'pabna.mayor';
    case 'executive_officer':
      return 'pabna.ceo';
    case 'department_officer':
      return 'pabna.dept';
    case 'municipality_accountant':
      return 'pabna.accountant';
    case 'municipality_service_operator':
      return 'pabna.operator';
    case 'union_admin':
      return `${unitCode}.admin`;
    case 'chairman':
      return `${unitCode}.chairman`;
    case 'secretary':
      return `${unitCode}.secretary`;
    case 'ward_member':
      return `${unitCode}.ward4`;
    case 'union_accountant':
      return `${unitCode}.accountant`;
    case 'union_service_operator':
      return `${unitCode}.operator`;
    case 'citizen':
      return 'citizen';
  }
}

export const AdminLoginView: React.FC<AdminLoginViewProps> = ({
  institutions,
  onLoginSuccess,
  onCancel,
}) => {
  const [role, setRole] = useState<UserRole>('union_admin');
  const [institutionType, setInstitutionType] = useState<'union_parishad' | 'municipality'>('union_parishad');
  const [selectedUnitId, setSelectedUnitId] = useState('unit_goyeshpur');
  const [username, setUsername] = useState('goyeshpur.admin');
  const [password, setPassword] = useState('Pottoyon@2026!');
  const [twoFactorOtp, setTwoFactorOtp] = useState('123456');
  const [require2FA, setRequire2FA] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Password reset modal state
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetIdentifier, setResetIdentifier] = useState('goyeshpur.admin');
  const [resetToken, setResetToken] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetStep, setResetStep] = useState<1 | 2>(1);
  const [resetMessage, setResetMessage] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  const unions = institutions.filter((i) => i.type === 'union_parishad');
  const muni = institutions.find((i) => i.type === 'municipality');

  const getUnitCode = (unitId: string) =>
    institutions.find((u) => u.id === unitId)?.code || 'goyeshpur';

  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    setError('');
    if (MUNI_ROLES.has(newRole)) {
      setInstitutionType('municipality');
      setSelectedUnitId('unit_pabna_muni');
      setUsername(resolveDefaultUsername(newRole));
    } else if (GLOBAL_ROLES.has(newRole)) {
      setUsername(resolveDefaultUsername(newRole));
    } else {
      const targetUnit = selectedUnitId === 'unit_pabna_muni' ? 'unit_goyeshpur' : selectedUnitId;
      setInstitutionType('union_parishad');
      setSelectedUnitId(targetUnit);
      setUsername(resolveDefaultUsername(newRole, getUnitCode(targetUnit)));
    }
  };

  const handleUnitChange = (unitId: string) => {
    setSelectedUnitId(unitId);
    if (!MUNI_ROLES.has(role) && !GLOBAL_ROLES.has(role)) {
      setUsername(resolveDefaultUsername(role, getUnitCode(unitId)));
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username || !password) {
      setError('ইউজারনেম ও পাসওয়ার্ড প্রদান করুন।');
      return;
    }

    if (role !== 'citizen' && !require2FA) {
      setRequire2FA(true);
      return;
    }

    setLoading(true);
    try {
      const result = await api.login({
        role,
        administrative_unit_id: GLOBAL_ROLES.has(role) ? undefined : selectedUnitId,
        username: username.trim(),
        password,
        otp: role === 'citizen' ? undefined : twoFactorOtp || '123456',
      });
      onLoginSuccess(result.session);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'লগইন ব্যর্থ হয়েছে।';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');
    setResetMessage('');
    setResetBusy(true);
    try {
      const res = await api.requestPasswordReset(resetIdentifier.trim());
      setResetMessage(res.message_bn);
      if (res.reset_token_preview) {
        setResetToken(res.reset_token_preview);
      }
      setResetStep(2);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'রিসেট অনুরোধ ব্যর্থ হয়েছে।');
    } finally {
      setResetBusy(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');
    setResetMessage('');
    setResetBusy(true);
    try {
      const res = await api.confirmPasswordReset(resetToken.trim(), resetNewPassword);
      setResetMessage(res.message_bn);
      setPassword(resetNewPassword);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'পাসওয়ার্ড পরিবর্তন ব্যর্থ হয়েছে।');
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="py-12 bg-slate-100 min-h-screen flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full border border-slate-200 overflow-hidden animate-fadeIn">
        {/* Header */}
        <div className="bg-emerald-950 text-white p-6 text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-emerald-700/80 text-white flex items-center justify-center mx-auto mb-2 shadow-xs">
            <Shield className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">একীভূত নিরাপদ লগইন পোর্টাল (RBAC)</h2>
          <p className="text-xs text-emerald-300">
            পাবনা সদর উপজেলা • ১৬টি ভূমিকা ভিত্তিক নিরাপদ প্রবেশদ্বার ও 2FA সুরক্ষা
          </p>
        </div>

        {/* Form Body */}
        <form onSubmit={handleLoginSubmit} className="p-6 sm:p-8 space-y-4 text-xs">
          {/* Quick Preset Buttons */}
          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 space-y-1.5">
            <span className="font-bold text-emerald-900 block text-[11px]">
              দ্রুত টেস্টিং রোল প্রিসেট (ডিফল্ট পাসওয়ার্ড: <code className="font-mono">Pottoyon@2026!</code>):
            </span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { r: 'union_admin' as UserRole, label: 'ইউপি প্রশাসক' },
                { r: 'chairman' as UserRole, label: 'ইউপি চেয়ারম্যান' },
                { r: 'ward_member' as UserRole, label: 'ওয়ার্ড সদস্য' },
                { r: 'union_service_operator' as UserRole, label: 'ইউপি অপারেটর' },
                { r: 'municipality_admin' as UserRole, label: 'পৌর প্রশাসক' },
                { r: 'mayor' as UserRole, label: 'পৌর মেয়র' },
                { r: 'upazila_monitoring_officer' as UserRole, label: 'মনিটরিং কর্মকর্তা' },
                { r: 'super_admin' as UserRole, label: 'সুপার অ্যাডমিন' },
              ].map((p) => (
                <button
                  key={p.r}
                  type="button"
                  onClick={() => handleRoleChange(p.r)}
                  className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                    role === p.r
                      ? 'bg-emerald-800 text-white'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* User Role */}
          <div>
            <label className="font-bold text-slate-700 block mb-1">প্রশাসনিক পদবি / রোল (১৬টি) *</label>
            <select
              value={role}
              onChange={(e) => handleRoleChange(e.target.value as UserRole)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 font-semibold text-slate-900 bg-white focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
            >
              <optgroup label="গ্লোবাল ও উপজেলা প্রশাসন">
                <option value="super_admin">১. সুপার অ্যাডমিন (Super Admin — কারিগরি নিয়ন্ত্রণ)</option>
                <option value="upazila_admin">২. উপজেলা নির্বাহী কর্মকর্তা (UNO — তদারকি)</option>
                <option value="upazila_monitoring_officer">৩. উপজেলা মনিটরিং কর্মকর্তা (পর্যবেক্ষণ)</option>
              </optgroup>
              <optgroup label="ইউনিয়ন পরিষদ (১০টি ইউপি)">
                <option value="union_admin">৪. ইউনিয়ন প্রশাসক (Union Admin)</option>
                <option value="chairman">৫. ইউপি চেয়ারম্যান (Chairman — সনদ অনুমোদন)</option>
                <option value="secretary">৬. ইউনিয়ন পরিষদ সচিব (যাচাই ও ফরোয়ার্ড)</option>
                <option value="ward_member">৭. ওয়ার্ড সদস্য (কেবল নির্ধারিত ওয়ার্ড যাচাই)</option>
                <option value="union_accountant">৮. ইউনিয়ন হিসাব সহকারী (রাজস্ব ও রিফান্ড)</option>
                <option value="union_service_operator">৯. ইউনিয়ন সেবা অপারেটর (UDC আবেদন এন্ট্রি)</option>
              </optgroup>
              <optgroup label="পাবনা পৌরসভা (স্বতন্ত্র)">
                <option value="municipality_admin">১০. পৌর প্রশাসক (Municipality Admin)</option>
                <option value="mayor">১১. পৌর মেয়র (Mayor — সনদ অনুমোদন)</option>
                <option value="executive_officer">১২. প্রধান নির্বাহী কর্মকর্তা (CEO)</option>
                <option value="department_officer">১৩. পৌর বিভাগীয় কর্মকর্তা (বিভাগ-ভিত্তিক)</option>
                <option value="municipality_accountant">১৪. পৌর হিসাবরক্ষক (রাজস্ব ও রিফান্ড)</option>
                <option value="municipality_service_operator">১৫. পৌর সেবা অপারেটর (আবেদন এন্ট্রি)</option>
              </optgroup>
              <optgroup label="পাবলিক">
                <option value="citizen">১৬. সাধারণ নাগরিক (Citizen Account)</option>
              </optgroup>
            </select>
          </div>

          {/* Institution Selection */}
          {!GLOBAL_ROLES.has(role) && (
            <div className="space-y-3">
              <div>
                <label className="font-bold text-slate-700 block mb-1">প্রতিষ্ঠানের ধরন *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={MUNI_ROLES.has(role)}
                    onClick={() => {
                      setInstitutionType('union_parishad');
                      handleUnitChange('unit_goyeshpur');
                    }}
                    className={`p-2 rounded-xl border text-center font-bold disabled:opacity-60 ${
                      institutionType === 'union_parishad'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    ইউনিয়ন পরিষদ (১০টি)
                  </button>
                  <button
                    type="button"
                    disabled={!MUNI_ROLES.has(role)}
                    onClick={() => {
                      setInstitutionType('municipality');
                      handleUnitChange('unit_pabna_muni');
                    }}
                    className={`p-2 rounded-xl border text-center font-bold disabled:opacity-60 ${
                      institutionType === 'municipality'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    পাবনা পৌরসভা (স্বতন্ত্র)
                  </button>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">প্রতিষ্ঠান নির্বাচন করুন *</label>
                <select
                  value={selectedUnitId}
                  onChange={(e) => handleUnitChange(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 font-semibold text-slate-900 bg-white focus:ring-2 focus:ring-emerald-600"
                >
                  {institutionType === 'union_parishad'
                    ? unions.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name_bn}
                        </option>
                      ))
                    : muni && <option value={muni.id}>{muni.name_bn}</option>}
                </select>
              </div>
            </div>
          )}

          {/* Username / Employee ID */}
          <div>
            <label className="font-bold text-slate-700 block mb-1">
              ইউজারনেম অথবা সরকারি কর্মকর্তা আইডি *
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-slate-900 font-mono focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          {/* Password */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-bold text-slate-700">পাসওয়ার্ড *</label>
              <button
                type="button"
                onClick={() => {
                  setResetIdentifier(username);
                  setResetStep(1);
                  setResetError('');
                  setResetMessage('');
                  setResetModalOpen(true);
                }}
                className="text-emerald-700 hover:underline font-semibold flex items-center gap-1"
              >
                <KeyRound className="w-3 h-3" />
                <span>পাসওয়ার্ড ভুলে গেছেন?</span>
              </button>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-slate-900 font-mono focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          {/* 2FA Step */}
          {require2FA && role !== 'citizen' && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2 animate-fadeIn">
              <span className="font-bold text-amber-900 block">
                দ্বিমুখী প্রমাণীকরণ (2FA OTP কোড):
              </span>
              <p className="text-[11px] text-amber-700">
                নিরাপত্তা প্রটোকল অনুসারে কর্মকর্তা মোবাইলে প্রেরিত ৬ ডিজিটের ওটিপি দিন (স্যান্ডবক্স কোড: <code className="font-mono font-bold">123456</code>)
              </p>
              <input
                type="text"
                placeholder="123456"
                value={twoFactorOtp}
                onChange={(e) => setTwoFactorOtp(e.target.value)}
                className="w-full px-3 py-2 text-center tracking-widest text-base font-mono font-bold rounded-lg border border-amber-300 bg-white"
              />
            </div>
          )}

          {error && (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-red-700 font-medium">
              {error}
            </div>
          )}

          <div className="pt-2 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="w-1/3 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 transition-colors"
            >
              বাতিল
            </button>
            <button
              type="submit"
              disabled={loading}
              className="w-2/3 bg-emerald-800 hover:bg-emerald-900 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl transition-colors shadow-md flex items-center justify-center gap-1.5"
            >
              <Lock className="w-4 h-4" />
              <span>
                {loading
                  ? 'যাচাই হচ্ছে...'
                  : role !== 'citizen' && require2FA
                  ? '2FA নিশ্চিত করে প্রবেশ করুন'
                  : 'লগইন করুন'}
              </span>
            </button>
          </div>
        </form>

        <div className="p-3 bg-slate-50 border-t border-slate-200 text-center text-[10px] text-slate-500">
          🔒 scrypt পাসওয়ার্ড সুরক্ষা, ৫-বার ভুল লগইনে অ্যাকাউন্ট লক এবং RBAC সেশন টোকেন সক্রিয়
        </div>
      </div>

      {/* Password Reset Modal */}
      {resetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200 text-xs">
            <div className="flex items-start justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">পাসওয়ার্ড রিসেট ও পুনরুদ্ধার</h3>
                <p className="text-[11px] text-slate-500">কমপক্ষে ৮ অক্ষর এবং বর্ণ + সংখ্যা থাকতে হবে</p>
              </div>
              <button type="button" onClick={() => setResetModalOpen(false)} className="text-slate-500 font-bold">
                ✕
              </button>
            </div>

            {resetMessage && (
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <span>{resetMessage}</span>
              </div>
            )}

            {resetError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800">{resetError}</div>
            )}

            {resetStep === 1 ? (
              <form onSubmit={handleRequestReset} className="space-y-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">ইউজারনেম অথবা ইমেইল *</label>
                  <input
                    type="text"
                    required
                    value={resetIdentifier}
                    onChange={(e) => setResetIdentifier(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setResetModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-slate-300 font-bold"
                  >
                    বাতিল
                  </button>
                  <button
                    type="submit"
                    disabled={resetBusy}
                    className="px-4 py-2 rounded-xl bg-emerald-700 text-white font-bold"
                  >
                    {resetBusy ? 'পাঠানো হচ্ছে...' : 'রিসেট টোকেন পাঠান'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleConfirmReset} className="space-y-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">রিসেট টোকেন *</label>
                  <input
                    type="text"
                    required
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">নতুন পাসওয়ার্ড *</label>
                  <input
                    type="password"
                    required
                    value={resetNewPassword}
                    onChange={(e) => setResetNewPassword(e.target.value)}
                    placeholder="যেমন: PabnaGov@2027"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setResetModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-slate-300 font-bold"
                  >
                    বন্ধ করুন
                  </button>
                  <button
                    type="submit"
                    disabled={resetBusy}
                    className="px-4 py-2 rounded-xl bg-emerald-700 text-white font-bold"
                  >
                    {resetBusy ? 'সংরক্ষণ হচ্ছে...' : 'নতুন পাসওয়ার্ড সেট করুন'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
