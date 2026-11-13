import React from 'react';

interface BangladeshEmblemProps {
  className?: string;
  size?: number;
  watermark?: boolean;
}

export const BangladeshEmblem: React.FC<BangladeshEmblemProps> = ({
  className = '',
  size = 64,
  watermark = false,
}) => {
  if (watermark) {
    return (
      <div
        className={`pointer-events-none select-none flex items-center justify-center opacity-[0.07] ${className}`}
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 200 200" className="w-full h-full text-emerald-900 fill-current">
          <circle cx="100" cy="100" r="90" fill="none" stroke="currentColor" strokeWidth="6" />
          <circle cx="100" cy="100" r="82" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2" />
          {/* Water lily shapla */}
          <path d="M100 45 C95 70, 70 85, 65 105 C75 105, 90 95, 100 80 C110 95, 125 105, 135 105 C130 85, 105 70, 100 45 Z" />
          <path d="M100 70 C85 85, 55 95, 45 115 C60 115, 80 105, 100 95 C120 105, 140 115, 155 115 C145 95, 115 85, 100 70 Z" />
          {/* Water ripples */}
          <path d="M60 120 C80 115, 120 115, 140 120 M50 130 C75 125, 125 125, 150 130 M65 140 C85 135, 115 135, 135 140" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          {/* Rice sheaves */}
          <path d="M40 140 C30 100, 45 60, 80 40 M160 140 C170 100, 155 60, 120 40" fill="none" stroke="currentColor" strokeWidth="4" />
          {/* Stars */}
          <circle cx="85" cy="30" r="3" />
          <circle cx="95" cy="25" r="3" />
          <circle cx="105" cy="25" r="3" />
          <circle cx="115" cy="30" r="3" />
        </svg>
      </div>
    );
  }

  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-full bg-emerald-700 shadow-sm border-2 border-emerald-600 ${className}`}
      style={{ width: size, height: size }}
      title="গণপ্রজাতন্ত্রী বাংলাদেশ সরকার"
    >
      <div className="absolute inset-1 rounded-full bg-red-600 flex items-center justify-center">
        <svg viewBox="0 0 100 100" className="w-4/5 h-4/5 text-amber-300 fill-current">
          {/* Shapla center */}
          <path d="M50 20 C47 35, 32 45, 28 55 C34 55, 44 50, 50 42 C56 50, 66 55, 72 55 C68 45, 53 35, 50 20 Z" />
          <path d="M50 35 C42 45, 25 50, 20 62 C28 62, 40 56, 50 51 C60 56, 72 62, 80 62 C75 50, 58 45, 50 35 Z" />
          {/* Waves */}
          <path d="M25 68 C35 65, 65 65, 75 68 M20 74 C35 71, 65 71, 80 74" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          {/* Rice sheaves border */}
          <path d="M18 70 C12 48, 22 28, 42 16 M82 70 C88 48, 78 28, 58 16" fill="none" stroke="currentColor" strokeWidth="2.5" />
          {/* 4 Stars */}
          <circle cx="43" cy="11" r="1.8" />
          <circle cx="48" cy="9" r="1.8" />
          <circle cx="52" cy="9" r="1.8" />
          <circle cx="57" cy="11" r="1.8" />
        </svg>
      </div>
    </div>
  );
};
