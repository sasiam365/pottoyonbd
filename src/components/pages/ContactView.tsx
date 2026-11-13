import React, { useState } from 'react';
import { MapPin, Phone, Mail, Clock, Send, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../../services/api';

export const ContactView: React.FC = () => {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim() || !phone.trim() || !message.trim()) {
      setError('অনুগ্রহ করে নাম, মোবাইল নম্বর এবং বিস্তারিত বার্তা প্রদান করুন।');
      return;
    }
    setSubmitting(true);
    try {
      await api.submitContactInquiry({
        name: name.trim(),
        phone: phone.trim(),
        subject: subject.trim() || 'সাধারণ জিজ্ঞাসা',
        message: message.trim(),
      });
      setSubmitted(true);
      setName('');
      setPhone('');
      setSubject('');
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'বার্তা পাঠাতে সমস্যা হয়েছে। পুনরায় চেষ্টা করুন।');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="py-12 bg-slate-50 min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center space-y-2 mb-10">
          <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
            যোগাযোগ ও নাগরিক সহায়তা
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 max-w-lg mx-auto">
            যেকোনো তথ্য, আবেদন সংক্রান্ত জিজ্ঞাসা বা কারিগরি সহায়তার জন্য আমাদের সাথে যোগাযোগ করুন
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Contact Details */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
                পাবনা সদর উপজেলা কার্যালয়
              </h3>

              <div className="space-y-3 text-xs text-slate-600">
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-800 block">ঠিকানা:</span>
                    <span>উপজেলা পরিষদ কমপ্লেক্স, পাবনা সদর, পাবনা - ৬৬০০, বাংলাদেশ</span>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Phone className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-800 block">হেল্পলাইন ও হটলাইন:</span>
                    <span>০১৭০০-০০০০০০ / ০৭৩১-৬৫৮৭৭</span>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Mail className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-800 block">ইমেইল:</span>
                    <span>info@pottoyonbd.gov.bd</span>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Clock className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-800 block">অফিস সময়সূচি:</span>
                    <span>রবিবার হতে বৃহস্পতিবার (সকাল ৯:০০ - বিকাল ৫:০০)</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-5 bg-emerald-50 rounded-2xl border border-emerald-100 text-xs space-y-2">
              <span className="font-bold text-emerald-950 block">জরুরি হেল্পলাইন নম্বর:</span>
              <p className="text-slate-600 leading-relaxed">
                জাতীয় তথ্য সেবা: <strong>৩৩৩</strong> • জরুরি সেবা: <strong>৯৯৯</strong> • নারী ও শিশু নির্যাতন প্রতিরোধ: <strong>১০৯</strong>
              </p>
            </div>
          </div>

          {/* Form */}
          <div className="lg:col-span-7 bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-sm">
            {submitted ? (
              <div className="py-12 text-center space-y-3 animate-fadeIn">
                <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
                <h3 className="text-xl font-bold text-slate-900">আপনার বার্তা সফলভাবে সংরক্ষিত ও পাঠানো হয়েছে!</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  উপজেলা তথ্য কর্মকর্তা আপনার বার্তাটি পর্যবেক্ষণ করে দ্রুত প্রদত্ত ফোন নম্বরে যোগাযোগ করবেন।
                </p>
                <button
                  type="button"
                  onClick={() => setSubmitted(false)}
                  className="mt-4 bg-emerald-700 text-white font-bold px-5 py-2 rounded-xl text-xs"
                >
                  নতুন বার্তা পাঠান
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4 text-xs">
                <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
                  অনলাইন বার্তা বা জিজ্ঞাসা পাঠান
                </h3>

                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 font-semibold flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <div>
                  <label className="font-bold text-slate-700 block mb-1">আপনার নাম *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="আপনার পুরো নাম"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 focus:ring-2 focus:ring-emerald-600"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">মোবাইল নম্বর *</label>
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="01XXXXXXXXX"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 font-mono focus:ring-2 focus:ring-emerald-600"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">জিজ্ঞাসার বিষয় *</label>
                  <input
                    type="text"
                    required
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="যেমন: ওয়ারিশ সনদ সংক্রান্ত জিজ্ঞাসা"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 focus:ring-2 focus:ring-emerald-600"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">বিস্তারিত বার্তা *</label>
                  <textarea
                    rows={4}
                    required
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="আপনার বার্তা বা প্রশ্ন এখানে লিখুন..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 focus:ring-2 focus:ring-emerald-600"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 text-sm"
                >
                  <Send className="w-4 h-4" />
                  <span>{submitting ? 'পাঠানো হচ্ছে...' : 'বার্তা প্রেরণ করুন'}</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
