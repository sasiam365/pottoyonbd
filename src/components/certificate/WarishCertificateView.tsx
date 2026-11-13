import React, { useEffect, useRef, useState } from 'react';
import {
  Printer,
  Download,
  CheckCircle,
  Share2,
  ArrowLeft,
  Ban,
  Clock,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  FileText,
  Eye,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { Certificate, AdministrativeUnit } from '../../types';
import { BangladeshEmblem } from '../common/BangladeshEmblem';
import { api } from '../../services/api';

interface WarishCertificateViewProps {
  certificate: Certificate;
  institution?: AdministrativeUnit;
  authToken?: string;
  trackingNo?: string;
  onBack?: () => void;
  onOpenPrintRoute?: (cert: Certificate, trackingNo?: string) => void;
  isModalContext?: boolean;
  isDedicatedPrintRoute?: boolean;
  autoPrint?: boolean;
  lang?: 'bn' | 'en';
}

export const WarishCertificateView: React.FC<WarishCertificateViewProps> = ({
  certificate,
  institution,
  authToken,
  trackingNo,
  onBack,
  onOpenPrintRoute,
  isModalContext = false,
  isDedicatedPrintRoute = false,
  autoPrint = false,
}) => {
  const printRef = useRef<HTMLDivElement>(null);
  const [previewMode, setPreviewMode] = useState<'a4' | 'pdf'>('a4');
  const [zoom, setZoom] = useState<number>(100);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [pdfLoading, setPdfLoading] = useState<boolean>(false);
  const [pdfError, setPdfError] = useState<string>('');
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string>('');

  const canAccessServerPdf = Boolean(authToken || trackingNo || certificate.application_tracking_no);
  const effectiveTracking = trackingNo || certificate.application_tracking_no;

  const handlePrint = () => {
    if (!isDedicatedPrintRoute && onOpenPrintRoute) {
      onOpenPrintRoute(certificate, effectiveTracking);
      return;
    }
    if (isModalContext) {
      document.body.classList.add('printing-certificate-modal');
    }
    const cleanup = () => {
      document.body.classList.remove('printing-certificate-modal');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  useEffect(() => {
    if (autoPrint) {
      const timer = setTimeout(() => {
        if (isModalContext) {
          document.body.classList.add('printing-certificate-modal');
        }
        const cleanup = () => {
          document.body.classList.remove('printing-certificate-modal');
          window.removeEventListener('afterprint', cleanup);
        };
        window.addEventListener('afterprint', cleanup);
        window.print();
      }, 280);
      return () => clearTimeout(timer);
    }
  }, [autoPrint, isModalContext]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    if (previewMode === 'pdf' && canAccessServerPdf) {
      setPdfLoading(true);
      setPdfError('');
      const url = api.getPdfDownloadUrl(certificate.id, {
        authToken,
        trackingNo: effectiveTracking,
        inline: true,
      });
      fetch(url)
        .then(async (res) => {
          if (!res.ok) {
            throw new Error('অফিসিয়াল PDF লোড করা যায়নি। অনুগ্রহ করে অনুমোদন সেশন নিশ্চিত করুন।');
          }
          return res.blob();
        })
        .then((blob) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setPdfBlobUrl(objectUrl);
          setPdfLoading(false);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setPdfError(err instanceof Error ? err.message : 'PDF লোড ব্যর্থ হয়েছে।');
          setPdfLoading(false);
        });
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewMode, certificate.id, authToken, effectiveTracking, canAccessServerPdf]);

  const handleDownloadPdf = () => {
    const pdfUrl = api.getPdfDownloadUrl(certificate.id, {
      authToken,
      trackingNo: effectiveTracking,
    });
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = `PottoyonBD_${effectiveTracking || 'Cert'}_${certificate.certificate_number || certificate.certificate_no}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyLink = () => {
    navigator.clipboard?.writeText(certificate.verification_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const unitNameBn = certificate.issuing_unit_bn || institution?.name_bn || 'গোয়েশপুর ইউনিয়ন পরিষদ';
  const upazilaDistrictBn = `${institution?.upazila_bn || 'পাবনা সদর'}, ${institution?.district_bn || 'পাবনা'}, বাংলাদেশ`;
  const certNo = certificate.certificate_number || certificate.certificate_no;

  return (
    <div
      className={`certificate-print-shell ${
        isFullscreen
          ? 'fixed inset-0 z-[100] bg-slate-900/95 overflow-y-auto p-3 sm:p-6'
          : isModalContext
          ? 'bg-slate-100 p-3 sm:p-6 min-h-full'
          : 'py-6 px-3 sm:px-6 bg-slate-100 min-h-screen'
      }`}
    >
      {/* Dedicated Preview Action Toolbar (Completely Hidden on Print) */}
      <div className="max-w-5xl mx-auto mb-5 no-print bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-slate-950 bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{isModalContext ? 'বন্ধ করুন' : 'পূর্ববর্তী পাতা'}</span>
              </button>
            )}

            {certificate.status === 'valid' && (
              <span className="flex items-center gap-1 text-xs font-bold bg-emerald-100 text-emerald-800 px-3 py-1.5 rounded-lg">
                <CheckCircle className="w-4 h-4 text-emerald-700" />
                <span>বৈধ ডিজিটাল সনদ (VALID)</span>
              </span>
            )}
            {certificate.status === 'revoked' && (
              <span className="flex items-center gap-1 text-xs font-bold bg-red-100 text-red-800 px-3 py-1.5 rounded-lg">
                <Ban className="w-4 h-4 text-red-700" />
                <span>বাতিলকৃত সনদ (REVOKED)</span>
              </span>
            )}
            {certificate.status === 'expired' && (
              <span className="flex items-center gap-1 text-xs font-bold bg-amber-100 text-amber-800 px-3 py-1.5 rounded-lg">
                <Clock className="w-4 h-4 text-amber-700" />
                <span>মেয়াদোত্তীর্ণ সনদ (EXPIRED)</span>
              </span>
            )}

            <span className="text-xs text-slate-600 font-mono font-bold tabular-nums">
              সনদ নং: {certNo}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Mode Switch: A4 Template vs Generated PDF Viewer (hidden on dedicated print route) */}
            {!isDedicatedPrintRoute && canAccessServerPdf && (
              <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setPreviewMode('a4')}
                  className={`px-2.5 py-1 rounded flex items-center gap-1 transition-colors ${
                    previewMode === 'a4' ? 'bg-white text-emerald-900 shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>A4 প্রিভিউ</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('pdf')}
                  className={`px-2.5 py-1 rounded flex items-center gap-1 transition-colors ${
                    previewMode === 'pdf' ? 'bg-white text-emerald-900 shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>PDF ভিউয়ার</span>
                </button>
              </div>
            )}

            {/* Zoom Controls (A4 View) */}
            {!isDedicatedPrintRoute && previewMode === 'a4' && (
              <div className="hidden sm:flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200 text-xs font-mono">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(60, z - 10))}
                  className="p-1 hover:bg-white rounded text-slate-700"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="px-1.5 font-bold text-slate-700 tabular-nums">{zoom}%</span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(130, z + 10))}
                  className="p-1 hover:bg-white rounded text-slate-700"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {!isDedicatedPrintRoute && (
              <button
                type="button"
                onClick={() => setIsFullscreen((f) => !f)}
                className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-2.5 py-2 rounded-lg transition-colors"
                title="পূর্ণ স্ক্রিন"
              >
                {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                <span className="hidden md:inline">{isFullscreen ? 'স্বাভাবিক' : 'পূর্ণ স্ক্রিন'}</span>
              </button>
            )}

            {!isDedicatedPrintRoute && (
              <button
                type="button"
                onClick={handleCopyLink}
                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3 py-2 rounded-lg transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Share2 className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{copied ? 'কপি হয়েছে' : 'লিংক কপি'}</span>
              </button>
            )}

            {canAccessServerPdf && (
              <button
                type="button"
                onClick={handleDownloadPdf}
                className="flex items-center gap-1.5 bg-[#064E32] hover:bg-[#08783F] text-white text-xs font-bold px-3.5 py-2 rounded-lg transition-colors shadow-sm"
              >
                <Download className="w-4 h-4" />
                <span>PDF ডাউনলোড</span>
              </button>
            )}

            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors shadow-sm"
            >
              <Printer className="w-4 h-4" />
              <span>শুধুমাত্র সনদ প্রিন্ট</span>
            </button>
          </div>
        </div>
      </div>

      {/* Mode 1: Actual Generated PDF Embedded Preview */}
      {previewMode === 'pdf' && (
        <div className="max-w-5xl mx-auto no-print bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
          {pdfLoading ? (
            <div className="h-[720px] flex flex-col items-center justify-center gap-3 text-slate-500 text-xs">
              <div className="w-10 h-10 border-4 border-emerald-200 border-t-emerald-700 rounded-full animate-spin" />
              <span>অফিসিয়াল জেনারেটেড A4 PDF লোড হচ্ছে...</span>
            </div>
          ) : pdfError ? (
            <div className="p-10 text-center space-y-3">
              <AlertTriangle className="w-10 h-10 text-amber-600 mx-auto" />
              <p className="text-sm font-bold text-slate-800">{pdfError}</p>
              <button
                type="button"
                onClick={() => setPreviewMode('a4')}
                className="bg-emerald-700 text-white text-xs font-bold px-4 py-2 rounded-lg"
              >
                A4 প্রিভিউতে ফিরে যান
              </button>
            </div>
          ) : (
            <iframe
              src={pdfBlobUrl}
              title={`Certificate PDF ${certNo}`}
              className="w-full h-[78vh] min-h-[640px] border-0"
            />
          )}
        </div>
      )}

      {/* Mode 2 (and ALWAYS used as the clean Printable DOM): Official A4 Certificate Paper */}
      <div className={previewMode === 'pdf' && !isDedicatedPrintRoute ? 'hidden print:block certificate-print-scroll-wrap' : 'block overflow-x-auto pb-4 certificate-print-scroll-wrap'}>
        <div
          ref={printRef}
          id="printable-certificate"
          className="max-w-[820px] mx-auto bg-white text-slate-900 shadow-2xl p-5 sm:p-10 print:p-0 print:shadow-none print:border-0 relative overflow-hidden select-text border border-slate-300 origin-top transition-transform"
          style={{
            minHeight: '1050px',
            transform: !isDedicatedPrintRoute && zoom !== 100 ? `scale(${zoom / 100})` : undefined,
            marginBottom: !isDedicatedPrintRoute && zoom > 100 ? `${(zoom - 100) * 10}px` : undefined,
          }}
        >
          {/* Subtle Watermark Emblem in background */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.06]">
            <BangladeshEmblem size={440} watermark={true} />
          </div>

          {certificate.status === 'revoked' && (
            <div className="mb-4 bg-red-50 border-2 border-red-400 text-red-800 text-center py-2 px-4 rounded-lg text-xs font-black">
              বাতিলকৃত সনদ / REVOKED — কারণ: {certificate.revocation_reason || 'প্রশাসনিক আদেশে বাতিল'}
            </div>
          )}

          {/* Double-line Decorative Outer & Inner Border */}
          <div className="relative border-4 border-emerald-900 p-2 sm:p-3 h-full rounded-xs">
            <div className="border border-emerald-800/80 p-5 sm:p-8 h-full flex flex-col justify-between">
              {/* Top Header */}
              <div>
                <div className="text-center space-y-1 mb-4">
                  <div className="flex justify-center mb-2">
                    <BangladeshEmblem size={68} />
                  </div>
                  <h1 className="text-xl sm:text-3xl font-black text-emerald-950 tracking-tight">
                    {unitNameBn}
                  </h1>
                  <p className="text-xs sm:text-sm font-semibold text-slate-700">
                    {upazilaDistrictBn}
                  </p>
                  <div className="pt-2">
                    <span className="inline-block border-b-2 border-emerald-900 pb-0.5 text-lg sm:text-2xl font-bold text-emerald-900 tracking-wide">
                      {certificate.certificate_title_bn || 'ওয়ারিশ সনদ'}
                    </span>
                  </div>
                </div>

                {/* Certificate Number & Issue Date strip */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm font-semibold text-slate-800 pt-3 pb-4 border-b border-slate-200">
                  <div>
                    <span className="text-slate-600">সনদ নং: </span>
                    <span className="font-bold font-mono text-emerald-900 text-base tabular-nums">{certNo}</span>
                  </div>
                  <div className="text-right">
                    <div>
                      <span className="text-slate-600">ইস্যুর তারিখ: </span>
                      <span className="font-bold text-slate-900">
                        {certificate.issue_date_bn || '১২ই নভেম্বর ২০২৬'}
                      </span>
                    </div>
                    {certificate.expires_at && (
                      <div className="text-[11px] text-slate-600">
                        মেয়াদোত্তীর্ণ:{' '}
                        {new Intl.DateTimeFormat('bn-BD', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        }).format(new Date(certificate.expires_at))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Main Bengali Body Paragraph */}
                <div className="pt-5 text-justify text-sm sm:text-[15px] leading-relaxed text-slate-800 font-normal space-y-3">
                  <p>
                    এই মর্মে প্রত্যয়ন করা যাইতেছে যে,{' '}
                    <strong className="font-bold text-slate-950 underline decoration-slate-400 underline-offset-2">
                      {certificate.applicant_name_bn}
                    </strong>
                    , পিতা/স্বামী:{' '}
                    <strong className="font-semibold text-slate-900">
                      {certificate.father_name_bn}
                    </strong>
                    , মাতা:{' '}
                    <strong className="font-semibold text-slate-900">
                      {certificate.mother_name_bn}
                    </strong>{' '}
                    অত্র এলাকার একজন স্থায়ী বাসিন্দা। তাহার স্থায়ী ঠিকানা:{' '}
                    <span>{certificate.permanent_address_bn}</span>
                  </p>

                  <p>
                    বর্তমান ঠিকানা: <span>{certificate.present_address_bn}</span>
                  </p>

                  {certificate.heirs && certificate.heirs.length > 0 && (
                    <p className="font-medium pt-1">
                      উল্লিখিত ব্যক্তির পরিবারের সদস্যদের তালিকা নিম্নরূপ:
                    </p>
                  )}
                </div>

                {/* Warish Heirs Table */}
                {certificate.heirs && certificate.heirs.length > 0 && (
                  <>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full border-collapse border border-slate-400 text-xs sm:text-sm text-center tabular-nums">
                        <thead>
                          <tr className="bg-emerald-50/70 text-slate-900 font-bold">
                            <th className="border border-slate-400 py-2 px-2 w-16">ক্রমিক নং</th>
                            <th className="border border-slate-400 py-2 px-3 text-left">নাম</th>
                            <th className="border border-slate-400 py-2 px-3 w-28">জন্ম তারিখ</th>
                            <th className="border border-slate-400 py-2 px-2 w-16">বয়স</th>
                            <th className="border border-slate-400 py-2 px-3 w-24">সম্পর্ক</th>
                          </tr>
                        </thead>
                        <tbody>
                          {certificate.heirs.map((heir, idx) => (
                            <tr key={idx}>
                              <td className="border border-slate-400 py-1.5 px-2 font-mono">
                                {(idx + 1).toLocaleString('bn-BD')}
                              </td>
                              <td className="border border-slate-400 py-1.5 px-3 text-left font-semibold text-slate-900">
                                {heir.name}
                              </td>
                              <td className="border border-slate-400 py-1.5 px-3 font-mono">
                                {heir.dob}
                              </td>
                              <td className="border border-slate-400 py-1.5 px-2 font-mono">
                                {heir.age}
                              </td>
                              <td className="border border-slate-400 py-1.5 px-3 font-semibold text-slate-800">
                                {heir.relation}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-3 text-[11px] sm:text-xs text-slate-600 leading-tight text-justify">
                      <p>
                        উল্লিখিত সদস্য/সদস্যগণ ছাড়া আর কোনো সদস্য নাই। আবেদনকারী ইচ্ছাকৃতভাবে কোনো সদস্য বাদ দিয়ে থাকলে অনুমোদনকারী কোনো অংশে দায়ী থাকিবেন না এবং উক্ত সনদটি বাতিল বলিয়া গণ্য হইবে।
                      </p>
                    </div>
                  </>
                )}
              </div>

              {/* Bottom Footer Section (QR on Left, Signatory on Right) */}
              <div className="mt-12 pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-6 items-end">
                {/* Bottom Left: Automatic QR code & Issuing Institution */}
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    {certificate.qr_data_url ? (
                      <img
                        src={certificate.qr_data_url}
                        alt="Verification QR Code"
                        className="w-20 h-20 sm:w-24 sm:h-24 border border-slate-300 p-1 bg-white shadow-2xs shrink-0"
                      />
                    ) : (
                      <div className="w-20 h-20 sm:w-24 sm:h-24 border border-dashed border-emerald-700 bg-emerald-50 flex items-center justify-center text-[10px] text-emerald-800 text-center p-1 shrink-0">
                        QR Code
                      </div>
                    )}
                    <div className="text-[11px] sm:text-xs text-slate-700 leading-tight min-w-0">
                      <span className="font-bold text-emerald-950 block">ইস্যুকারী প্রতিষ্ঠান:</span>
                      <span className="font-semibold block">{unitNameBn}</span>
                      <span className="text-slate-500 block">{upazilaDistrictBn}</span>
                      <span className="text-[10px] text-slate-500 block pt-1 font-mono break-all">
                        {certificate.verification_url}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Bottom Right: Authorized Signatory */}
                <div className="text-center sm:text-right space-y-1">
                  <div className="inline-block text-center pr-2">
                    <div className="h-10 px-3 flex items-center justify-center mb-1 border border-dashed border-slate-300 rounded text-[10px] text-slate-500 bg-slate-50">
                      [অনুমোদিত ডিজিটাল স্বাক্ষর]
                    </div>
                    <div className="border-t border-slate-400 pt-1">
                      <p className="text-xs sm:text-sm font-bold text-slate-900">
                        {certificate.officer_name_bn}
                      </p>
                      <p className="text-[11px] sm:text-xs text-slate-600 font-medium">
                        {certificate.officer_title_bn}
                      </p>
                      <p className="text-[10px] sm:text-[11px] text-slate-500 font-semibold">
                        {unitNameBn}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Verification Note */}
              <div className="mt-4 pt-2 border-t border-slate-100 text-center text-[10px] text-slate-400">
                টেমপ্লেট: {certificate.template_version_id || 'tpl_up_general_v1'} | সনদটি অনলাইনে যাচাইয়ের জন্য কিউআর কোড স্ক্যান করুন অথবা pottoyonbd.gov.bd/verify ভিজিট করুন।
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
