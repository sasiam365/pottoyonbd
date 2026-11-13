import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import type { AdministrativeUnit, WarishMember } from '../src/types/index.ts';

const FONT_BN_REG = '/usr/share/fonts/truetype/noto/NotoSansBengali-Regular.ttf';
const FONT_BN_BOLD = '/usr/share/fonts/truetype/noto/NotoSansBengali-Bold.ttf';
const FONT_LATIN_REG = '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf';
const FONT_LATIN_BOLD = '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf';
const FONT_MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf';

export function getCertificateStorageRoot(): string {
  return process.env.POTTOYON_STORAGE_DIR
    ? path.resolve(process.env.POTTOYON_STORAGE_DIR)
    : path.resolve(process.cwd(), 'storage', 'certificates');
}

export interface CertificatePdfPayload {
  certificateNumber: string;
  certificateTitleBn: string;
  issueDateBn: string;
  issueDateEn: string;
  expiresAtIso?: string | null;
  applicantNameBn: string;
  fatherNameBn: string;
  motherNameBn: string;
  permanentAddressBn: string;
  presentAddressBn: string;
  heirs?: WarishMember[];
  unit: AdministrativeUnit;
  officerNameBn: string;
  officerTitleBn: string;
  verificationUrl: string;
  templateVersionId: string;
  status?: 'valid' | 'revoked' | 'expired';
}

export async function generateQrDataUrl(verificationUrl: string): Promise<string> {
  return QRCode.toDataURL(verificationUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 220,
    color: {
      dark: '#064E32',
      light: '#FFFFFF',
    },
  });
}

export async function generateAndStoreCertificatePdf(
  payload: CertificatePdfPayload
): Promise<{ pdfPath: string; qrDataUrl: string; byteLength: number }> {
  const storageRoot = getCertificateStorageRoot();
  const safeUnitDir = payload.unit.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeCertNo = payload.certificateNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
  const targetDir = path.join(storageRoot, safeUnitDir);
  fs.mkdirSync(targetDir, { recursive: true });

  const pdfPath = path.join(targetDir, `${safeCertNo}.pdf`);

  const [qrBuffer, qrDataUrl] = await Promise.all([
    QRCode.toBuffer(payload.verificationUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
      color: {
        dark: '#064E32',
        light: '#FFFFFF',
      },
    }),
    generateQrDataUrl(payload.verificationUrl),
  ]);

  const doc = new PDFDocument({
    size: 'A4',
    margin: 36,
    info: {
      Title: `${payload.certificateTitleBn} - ${payload.certificateNumber}`,
      Author: payload.unit.name_en,
      Subject: 'PottoyonBD Official Digital Certificate',
      Creator: 'PottoyonBD Certificate Issuance Engine',
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const pdfDone = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const hasBnReg = fs.existsSync(FONT_BN_REG);
  const hasBnBold = fs.existsSync(FONT_BN_BOLD);
  const hasLatinReg = fs.existsSync(FONT_LATIN_REG);
  const hasLatinBold = fs.existsSync(FONT_LATIN_BOLD);
  const hasMono = fs.existsSync(FONT_MONO);

  if (hasBnReg) doc.registerFont('BnReg', FONT_BN_REG);
  if (hasBnBold) doc.registerFont('BnBold', FONT_BN_BOLD);
  if (hasLatinReg) doc.registerFont('LatinReg', FONT_LATIN_REG);
  if (hasLatinBold) doc.registerFont('LatinBold', FONT_LATIN_BOLD);
  if (hasMono) doc.registerFont('Mono', FONT_MONO);

  const bnReg = hasBnReg ? 'BnReg' : 'Helvetica';
  const bnBold = hasBnBold ? 'BnBold' : 'Helvetica-Bold';
  const latinReg = hasLatinReg ? 'LatinReg' : 'Helvetica';
  const monoFont = hasMono ? 'Mono' : 'Courier';

  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;

  // Outer & Inner Official Double Border
  doc.save();
  doc.lineWidth(2.5).strokeColor('#064E32').rect(24, 24, pageWidth - 48, pageHeight - 48).stroke();
  doc.lineWidth(0.8).strokeColor('#08783F').rect(31, 31, pageWidth - 62, pageHeight - 62).stroke();
  doc.restore();

  // Subtle Watermark (clean typographic watermark, no fabricated government seal)
  doc.save();
  doc.fillColor('#08783F').fillOpacity(0.05);
  doc.font(latinReg).fontSize(54).rotate(-30, { origin: [pageWidth / 2, pageHeight / 2] });
  doc.text('POTTOYONBD', pageWidth / 2 - 190, pageHeight / 2 - 20, { lineBreak: false });
  doc.restore();

  // Revoked banner if revoked
  if (payload.status === 'revoked') {
    doc.save();
    doc.fillColor('#DC2626').fillOpacity(0.14);
    doc.rect(42, 42, pageWidth - 84, 26).fill();
    doc.fillOpacity(1).font(bnBold).fontSize(11).fillColor('#B91C1C');
    doc.text('বাতিলকৃত সনদ / REVOKED CERTIFICATE', 42, 49, {
      width: pageWidth - 84,
      align: 'center',
    });
    doc.restore();
  }

  // Header Block
  const headerTop = payload.status === 'revoked' ? 78 : 54;
  doc
    .font(bnBold)
    .fontSize(20)
    .fillColor('#064E32')
    .text(payload.unit.name_bn, 48, headerTop, {
      width: pageWidth - 96,
      align: 'center',
    });

  doc
    .font(bnReg)
    .fontSize(10.5)
    .fillColor('#334155')
    .text(`${payload.unit.upazila_bn}, ${payload.unit.district_bn}, বাংলাদেশ`, 48, doc.y + 2, {
      width: pageWidth - 96,
      align: 'center',
    });

  doc
    .font(latinReg)
    .fontSize(8.5)
    .fillColor('#64748B')
    .text(`${payload.unit.name_en} | ${payload.unit.upazila_en}, ${payload.unit.district_en}`, 48, doc.y + 1, {
      width: pageWidth - 96,
      align: 'center',
    });

  // Certificate Title
  const titleY = doc.y + 10;
  doc
    .font(bnBold)
    .fontSize(17)
    .fillColor('#064E32')
    .text(payload.certificateTitleBn, 48, titleY, {
      width: pageWidth - 96,
      align: 'center',
    });
  const titleRuleY = doc.y + 3;
  doc
    .moveTo(pageWidth / 2 - 90, titleRuleY)
    .lineTo(pageWidth / 2 + 90, titleRuleY)
    .lineWidth(1.5)
    .strokeColor('#064E32')
    .stroke();

  // Certificate Number & Dates Strip
  const metaY = titleRuleY + 14;
  doc.font(bnBold).fontSize(10).fillColor('#0F172A');
  doc.text(`সনদ নং: ${payload.certificateNumber}`, 52, metaY, {
    width: (pageWidth - 104) / 2,
    align: 'left',
  });
  doc.text(`ইস্যুর তারিখ: ${payload.issueDateBn}`, pageWidth / 2, metaY, {
    width: (pageWidth - 104) / 2,
    align: 'right',
  });

  let afterMetaY = metaY + 18;
  if (payload.expiresAtIso) {
    const expBn = new Intl.DateTimeFormat('bn-BD', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(payload.expiresAtIso));
    doc.font(bnReg).fontSize(9).fillColor('#475569');
    doc.text(`মেয়াদোত্তীর্ণের তারিখ: ${expBn}`, pageWidth / 2, afterMetaY, {
      width: (pageWidth - 104) / 2,
      align: 'right',
    });
    afterMetaY += 14;
  }

  doc
    .moveTo(52, afterMetaY + 4)
    .lineTo(pageWidth - 52, afterMetaY + 4)
    .lineWidth(0.75)
    .strokeColor('#CBD5E1')
    .stroke();

  // Main Body Paragraph
  let bodyY = afterMetaY + 16;
  doc.font(bnReg).fontSize(11).fillColor('#1E293B');
  const mainBodyText =
    `এই মর্মে প্রত্যয়ন করা যাইতেছে যে, ${payload.applicantNameBn}, ` +
    `পিতা/স্বামী: ${payload.fatherNameBn}, মাতা: ${payload.motherNameBn} ` +
    `অত্র এলাকার একজন স্থায়ী বাসিন্দা। তাহার স্থায়ী ঠিকানা: ${payload.permanentAddressBn}`;

  doc.text(mainBodyText, 52, bodyY, {
    width: pageWidth - 104,
    align: 'justify',
    lineGap: 4,
  });

  doc.moveDown(0.5);
  doc.text(`বর্তমান ঠিকানা: ${payload.presentAddressBn}`, 52, doc.y, {
    width: pageWidth - 104,
    align: 'left',
    lineGap: 3,
  });

  // Heirs / Family Members Table if present
  if (payload.heirs && payload.heirs.length > 0) {
    doc.moveDown(0.7);
    doc.font(bnBold).fontSize(10.5).fillColor('#0F172A');
    doc.text('উল্লিখিত ব্যক্তির পরিবারের সদস্য/ওয়ারিশগণের তালিকা নিম্নরূপ:', 52, doc.y);

    const tableTop = doc.y + 6;
    const colWidths = [46, 190, 95, 55, 105];
    const colX = [52];
    for (let i = 0; i < colWidths.length - 1; i++) {
      colX.push(colX[i] + colWidths[i]);
    }
    const totalTableW = colWidths.reduce((a, b) => a + b, 0);
    const rowH = 22;

    // Header Row
    doc.save();
    doc.fillColor('#ECFDF5').rect(52, tableTop, totalTableW, rowH).fill();
    doc.strokeColor('#64748B').lineWidth(0.6).rect(52, tableTop, totalTableW, rowH).stroke();
    doc.restore();

    const headers = ['ক্রমিক', 'নাম', 'জন্ম তারিখ', 'বয়স', 'সম্পর্ক'];
    doc.font(bnBold).fontSize(9.5).fillColor('#0F172A');
    headers.forEach((h, idx) => {
      doc.text(h, colX[idx] + 4, tableTop + 6, {
        width: colWidths[idx] - 8,
        align: idx === 1 ? 'left' : 'center',
      });
    });

    let curY = tableTop + rowH;
    const maxRows = Math.min(payload.heirs.length, 10);
    for (let r = 0; r < maxRows; r++) {
      const heir = payload.heirs[r];
      doc.strokeColor('#94A3B8').lineWidth(0.5).rect(52, curY, totalTableW, rowH).stroke();
      for (let c = 1; c < colX.length; c++) {
        doc.moveTo(colX[c], tableTop).lineTo(colX[c], curY + rowH).stroke();
      }
      doc.font(bnReg).fontSize(9.2).fillColor('#1E293B');
      const cells = [
        String(r + 1),
        heir.name || '-',
        heir.dob || '-',
        String(heir.age ?? '-'),
        heir.relation || '-',
      ];
      cells.forEach((val, idx) => {
        doc.text(val, colX[idx] + 4, curY + 6, {
          width: colWidths[idx] - 8,
          align: idx === 1 ? 'left' : 'center',
        });
      });
      curY += rowH;
    }

    doc.y = curY + 10;
    doc.font(bnReg).fontSize(8.8).fillColor('#475569').text(
      'উল্লিখিত সদস্যগণ ব্যতীত আর কোনো বৈধ ওয়ারিশ নাই। আবেদনকারীর প্রদত্ত তথ্য অসত্য প্রমাণিত হইলে উক্ত সনদ বাতিল বলিয়া গণ্য হইবে।',
      52,
      doc.y,
      { width: pageWidth - 104, align: 'justify' }
    );
  } else {
    doc.moveDown(1);
    doc.font(bnReg).fontSize(10).fillColor('#334155').text(
      'সরেজমিন তদন্ত ও স্থানীয় রেকর্ডের ভিত্তিতে অত্র প্রত্যয়নপত্র অনুমোদন ও ইস্যু করা হইল।',
      52,
      doc.y,
      { width: pageWidth - 104 }
    );
  }

  // Footer Region: Lower-Left QR + Issuing Unit | Lower-Right Authorized Officer Signature
  const footerY = pageHeight - 178;
  doc
    .moveTo(52, footerY - 10)
    .lineTo(pageWidth - 52, footerY - 10)
    .lineWidth(0.7)
    .strokeColor('#CBD5E1')
    .stroke();

  // Lower-Left: QR Code + Issuing Union Parishad / Municipality Name
  doc.image(qrBuffer, 52, footerY, { width: 88, height: 88 });
  doc.rect(52, footerY, 88, 88).lineWidth(0.6).strokeColor('#CBD5E1').stroke();

  const qrTextX = 150;
  doc.font(bnBold).fontSize(9).fillColor('#064E32').text('ইস্যুকারী প্রতিষ্ঠান:', qrTextX, footerY + 4, {
    width: 190,
  });
  doc.font(bnBold).fontSize(10).fillColor('#0F172A').text(payload.unit.name_bn, qrTextX, footerY + 18, {
    width: 195,
  });
  doc.font(bnReg).fontSize(8.5).fillColor('#475569').text(
    `${payload.unit.upazila_bn}, ${payload.unit.district_bn}, বাংলাদেশ`,
    qrTextX,
    footerY + 34,
    { width: 195 }
  );
  doc.font(monoFont).fontSize(6.6).fillColor('#475569').text(payload.verificationUrl, qrTextX, footerY + 50, {
    width: 195,
  });

  // Lower-Right: Authorized Officer Name, Designation & Approved Signature Placeholder
  const sigBoxX = pageWidth - 228;
  const sigBoxW = 176;
  doc.save();
  doc
    .rect(sigBoxX + 18, footerY + 6, sigBoxW - 36, 30)
    .dash(3, { space: 2 })
    .lineWidth(0.7)
    .strokeColor('#94A3B8')
    .stroke();
  doc.restore();

  doc.font(bnReg).fontSize(7.5).fillColor('#64748B').text('[অনুমোদিত ডিজিটাল স্বাক্ষর]', sigBoxX, footerY + 16, {
    width: sigBoxW,
    align: 'center',
  });

  doc
    .moveTo(sigBoxX + 10, footerY + 44)
    .lineTo(sigBoxX + sigBoxW - 10, footerY + 44)
    .lineWidth(0.8)
    .strokeColor('#475569')
    .stroke();

  doc.font(bnBold).fontSize(10).fillColor('#0F172A').text(payload.officerNameBn, sigBoxX, footerY + 49, {
    width: sigBoxW,
    align: 'center',
  });
  doc.font(bnReg).fontSize(8.8).fillColor('#334155').text(payload.officerTitleBn, sigBoxX, footerY + 64, {
    width: sigBoxW,
    align: 'center',
  });
  doc.font(bnReg).fontSize(8.5).fillColor('#475569').text(payload.unit.name_bn, sigBoxX, footerY + 78, {
    width: sigBoxW,
    align: 'center',
  });

  // Micro-footer at bottom (two clean single-font centered lines)
  const microY = pageHeight - 62;
  doc
    .font(bnReg)
    .fontSize(7.5)
    .fillColor('#64748B')
    .text('কিউআর কোড স্ক্যান করে অথবা নিচের পোর্টালে সনদের সত্যতা যাচাই করুন।', 48, microY, {
      width: pageWidth - 96,
      align: 'center',
    });
  doc
    .font(latinReg)
    .fontSize(7.2)
    .fillColor('#64748B')
    .text(`Template: ${payload.templateVersionId}  |  Verify: https://pottoyonbd.gov.bd/verify`, 48, microY + 11, {
      width: pageWidth - 96,
      align: 'center',
    });

  doc.end();

  const pdfBuffer = await pdfDone;
  if (!pdfBuffer || pdfBuffer.byteLength < 1000) {
    throw new Error('Generated PDF buffer is invalid or empty');
  }

  fs.writeFileSync(pdfPath, pdfBuffer);

  return {
    pdfPath,
    qrDataUrl,
    byteLength: pdfBuffer.byteLength,
  };
}
