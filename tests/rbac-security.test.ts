import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../server/app.ts';
import { resetDbInstanceForTests } from '../server/db.ts';

let server: http.Server;
let baseUrl = '';
let tempDir = '';

async function reqJson(
  urlPath: string,
  options: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = {
    ...(options.headers || {}),
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, headers: res.headers, body: json, rawText: text };
}

async function loginAs(username: string, password: string, otp?: string): Promise<{ token: string; session: Record<string, unknown> }> {
  const res = await reqJson('/api/auth/login', {
    method: 'POST',
    body: { username, password, otp },
  });
  assert.equal(res.status, 200, `Expected 200 login for ${username}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return {
    token: String(res.body.token),
    session: res.body.session as Record<string, unknown>,
  };
}

async function getRoleToken(role: string, administrativeUnitId?: string, username?: string): Promise<{ token: string; session: Record<string, unknown> }> {
  const res = await reqJson('/api/auth/switch-role', {
    method: 'POST',
    body: { role, administrative_unit_id: administrativeUnitId, username },
  });
  assert.equal(res.status, 200, `Expected 200 switch-role for ${role}, got ${res.status}`);
  return {
    token: String(res.body.token),
    session: res.body.session as Record<string, unknown>,
  };
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pottoyonbd-rbac-'));
  process.env.POTTOYON_DB_PATH = path.join(tempDir, 'rbac.sqlite');
  process.env.POTTOYON_STORAGE_DIR = path.join(tempDir, 'storage');
  process.env.POTTOYON_VERIFY_RATE_LIMIT = '200';

  resetDbInstanceForTests();
  const app = await createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  resetDbInstanceForTests();
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('1. Cross-Union & Union-vs-Municipality strict tenant isolation', async () => {
  const { token: goyeshpurAdmin } = await getRoleToken('union_admin', 'unit_goyeshpur');
  const { token: bhararaAdmin } = await getRoleToken('union_admin', 'unit_bharara');
  const { token: muniAdmin } = await getRoleToken('municipality_admin', 'unit_pabna_muni');
  const { token: muniMayor } = await getRoleToken('mayor', 'unit_pabna_muni');

  // Create application in Goyeshpur Union
  const gAppRes = await reqJson('/api/applications', {
    method: 'POST',
    body: {
      administrative_unit_id: 'unit_goyeshpur',
      service_id: 'srv_warish',
      applicant_name_bn: 'মোঃ করিম মিয়া',
      father_name_bn: 'মোঃ রহিম উদ্দিন',
      mother_name_bn: 'মোছাঃ আমেনা বেগম',
      nid_or_birth_reg: '19910000111122223',
      mobile: '01755-111222',
      ward_no: 4,
      village_or_area_bn: 'গোয়েশপুর',
      post_office_bn: 'গোয়েশপুর',
    },
  });
  assert.equal(gAppRes.status, 201);
  const gAppId = String(gAppRes.body.id);

  // Create application in Pabna Municipality
  const mAppRes = await reqJson('/api/applications', {
    method: 'POST',
    body: {
      administrative_unit_id: 'unit_pabna_muni',
      service_id: 'srv_trade_license',
      applicant_name_bn: 'মোঃ শরিফুল ইসলাম',
      father_name_bn: 'মোঃ আজিজুল হক',
      mother_name_bn: 'মোছাঃ রোকসানা বেগম',
      nid_or_birth_reg: '19900000111122224',
      mobile: '01755-333444',
      ward_no: 2,
      village_or_area_bn: 'দিলালপুর',
      post_office_bn: 'পাবনা',
    },
  });
  assert.equal(mAppRes.status, 201);
  const mAppId = String(mAppRes.body.id);

  // Bharara Union Admin cannot access Goyeshpur application or seed certificate
  assert.equal((await reqJson(`/api/applications/${gAppId}`, { token: bhararaAdmin })).status, 403);
  assert.equal((await reqJson('/api/certificates/cert_10275626255', { token: bhararaAdmin })).status, 403);
  assert.equal((await reqJson('/api/certificates/cert_10275626255/pdf', { token: bhararaAdmin })).status, 403);
  assert.equal(
    (await reqJson('/api/holding-taxes', {
      method: 'POST',
      token: bhararaAdmin,
      body: { administrative_unit_id: 'unit_goyeshpur', holding_no: 'GP-999', ward_no: 1, owner_name_bn: 'Test', annual_tax: 500 },
    })).status,
    403
  );

  // Union Admin cannot touch Pabna Municipality application
  assert.equal((await reqJson(`/api/applications/${mAppId}`, { token: goyeshpurAdmin })).status, 403);
  assert.equal(
    (await reqJson(`/api/applications/${mAppId}/final-approve`, { method: 'POST', token: goyeshpurAdmin })).status,
    403
  );

  // Municipality Admin & Mayor cannot touch Goyeshpur Union application or certificate
  assert.equal((await reqJson(`/api/applications/${gAppId}`, { token: muniAdmin })).status, 403);
  assert.equal((await reqJson(`/api/applications/${gAppId}/final-approve`, { method: 'POST', token: muniMayor })).status, 403);
  assert.equal((await reqJson('/api/certificates/cert_10275626255', { token: muniAdmin })).status, 403);
});

test('2. Ward Member isolation & Municipal Department Officer isolation', async () => {
  const { token: ward1Token } = await getRoleToken('ward_member', 'unit_goyeshpur', 'goyeshpur.ward1');
  const { token: ward4Token } = await getRoleToken('ward_member', 'unit_goyeshpur', 'goyeshpur.ward4');
  const { token: deptOfficerToken } = await getRoleToken('department_officer', 'unit_pabna_muni', 'pabna.dept');

  // Create Ward 4 application in Goyeshpur with attachment
  const w4AppRes = await reqJson('/api/applications', {
    method: 'POST',
    body: {
      administrative_unit_id: 'unit_goyeshpur',
      service_id: 'srv_character',
      applicant_name_bn: 'মোঃ সাইফুল ইসলাম',
      father_name_bn: 'মোঃ মজিবুর রহমান',
      mother_name_bn: 'মোছাঃ রাবেয়া খাতুন',
      nid_or_birth_reg: '19930000111122225',
      mobile: '01755-555666',
      ward_no: 4,
      village_or_area_bn: 'গোয়েশপুর',
      post_office_bn: 'গোয়েশপুর',
    },
  });
  assert.equal(w4AppRes.status, 201);
  const w4AppId = String(w4AppRes.body.id);

  const attRes = await reqJson(`/api/applications/${w4AppId}/attachments`, {
    method: 'POST',
    body: {
      doc_type: 'nid',
      original_name: 'ward4_nid.pdf',
      mime_type: 'application/pdf',
      content_base64: Buffer.from('%PDF-1.4\n%ward4\n').toString('base64'),
    },
  });
  assert.equal(attRes.status, 201);
  const attId = String(attRes.body.id);

  // Ward 1 member CANNOT view Ward 4 application, edit status, or read attachment
  assert.equal((await reqJson(`/api/applications/${w4AppId}`, { token: ward1Token })).status, 403);
  assert.equal(
    (await reqJson(`/api/applications/${w4AppId}/status`, {
      method: 'PATCH',
      token: ward1Token,
      body: { status: 'under_verification', note: 'Cross ward attempt' },
    })).status,
    403
  );
  assert.equal((await reqJson(`/api/attachments/${attId}`, { token: ward1Token })).status, 403);

  // Ward 4 member CAN view & update Ward 4 application & attachment
  assert.equal((await reqJson(`/api/applications/${w4AppId}`, { token: ward4Token })).status, 200);
  assert.equal((await reqJson(`/api/attachments/${attId}`, { token: ward4Token })).status, 200);
  assert.equal(
    (await reqJson(`/api/applications/${w4AppId}/status`, {
      method: 'PATCH',
      token: ward4Token,
      body: { status: 'forwarded_for_approval', note: '৪ নং ওয়ার্ড সরেজমিন যাচাই সম্পন্ন' },
    })).status,
    200
  );

  // Municipal Department Officer ('licensing') can access srv_trade_license in Pabna Municipality,
  // but CANNOT access srv_warish in Pabna Municipality
  const tlApp = await reqJson('/api/applications', {
    method: 'POST',
    body: {
      administrative_unit_id: 'unit_pabna_muni',
      service_id: 'srv_trade_license',
      applicant_name_bn: 'মেসার্স পদ্মা এন্টারপ্রাইজ',
      mobile: '01755-777888',
      ward_no: 3,
    },
  });
  assert.equal(tlApp.status, 201);

  const warishMuniApp = await reqJson('/api/applications', {
    method: 'POST',
    body: {
      administrative_unit_id: 'unit_pabna_muni',
      service_id: 'srv_warish',
      applicant_name_bn: 'মোঃ হাবিবুর রহমান',
      mobile: '01755-999000',
      ward_no: 3,
    },
  });
  assert.equal(warishMuniApp.status, 201);

  assert.equal((await reqJson(`/api/applications/${tlApp.body.id}`, { token: deptOfficerToken })).status, 200);
  assert.equal((await reqJson(`/api/applications/${warishMuniApp.body.id}`, { token: deptOfficerToken })).status, 403);
});

test('3. Citizen IDOR protection & review_notes redaction', async () => {
  const { token: citizen1Token } = await loginAs('citizen', 'Pottoyon@2026!');
  const { token: citizen2Token } = await loginAs('citizen2', 'Pottoyon@2026!');

  // Citizen 2 submits an application
  const c2App = await reqJson('/api/applications', {
    method: 'POST',
    token: citizen2Token,
    body: {
      administrative_unit_id: 'unit_goyeshpur',
      service_id: 'srv_nationality',
      applicant_name_bn: 'মোছাঃ সালমা খাতুন',
      mobile: '01799-887766',
      ward_no: 2,
    },
  });
  assert.equal(c2App.status, 201);

  // Citizen 1 cannot query Citizen 2's portal mobile or application ID or seeded cert belonging to someone else
  assert.equal((await reqJson('/api/citizen/portal?mobile=01799-887766', { token: citizen1Token })).status, 403);
  assert.equal((await reqJson(`/api/applications/${c2App.body.id}`, { token: citizen1Token })).status, 403);

  // Citizen 2 cannot download Citizen 1's certificate PDF
  assert.equal((await reqJson('/api/certificates/cert_10275626255/pdf', { token: citizen2Token })).status, 403);

  // Citizen 1 portal succeeds for own mobile and redacts internal officer review_notes
  const c1Portal = await reqJson('/api/citizen/portal?mobile=01712-345678', { token: citizen1Token });
  assert.equal(c1Portal.status, 200);
  const apps = c1Portal.body.applications as Array<Record<string, unknown>>;
  assert.ok(apps.length >= 1);
  assert.deepEqual(apps[0].review_notes, ['আবেদনটি সিস্টেমে সংরক্ষিত রয়েছে এবং যাচাই প্রক্রিয়াধীন।']);
});

test('4. Service Operators, Accountants, Non-Approvers & Monitoring Officer strict permission boundaries', async () => {
  const { token: unionOp } = await getRoleToken('union_service_operator', 'unit_goyeshpur');
  const { token: muniOp } = await getRoleToken('municipality_service_operator', 'unit_pabna_muni');
  const { token: unionAcc } = await getRoleToken('union_accountant', 'unit_goyeshpur');
  const { token: muniAcc } = await getRoleToken('municipality_accountant', 'unit_pabna_muni');
  const { token: secretary } = await getRoleToken('secretary', 'unit_goyeshpur');
  const { token: ceo } = await getRoleToken('executive_officer', 'unit_pabna_muni');
  const { token: superAdmin } = await getRoleToken('super_admin');
  const { token: uno } = await getRoleToken('upazila_admin');
  const { token: monitor } = await getRoleToken('upazila_monitoring_officer');
  const { token: goyeshpurAdmin } = await getRoleToken('union_admin', 'unit_goyeshpur');

  // Union operator creates intake application -> allowed, can read own created app, CANNOT read unassigned seed app or approve
  const opApp = await reqJson('/api/applications', {
    method: 'POST',
    token: unionOp,
    body: {
      administrative_unit_id: 'unit_goyeshpur',
      service_id: 'srv_warish',
      applicant_name_bn: 'অপারেটর এন্ট্রিকৃত আবেদন',
      mobile: '01766-112233',
      ward_no: 4,
    },
  });
  assert.equal(opApp.status, 201);
  assert.equal((await reqJson(`/api/applications/${opApp.body.id}`, { token: unionOp })).status, 200);
  assert.equal((await reqJson('/api/applications/app_goyeshpur_00127', { token: unionOp })).status, 403);
  assert.equal((await reqJson(`/api/applications/${opApp.body.id}/final-approve`, { method: 'POST', token: unionOp })).status, 403);
  assert.equal((await reqJson('/api/holding-taxes', { token: unionOp })).status, 403);

  // Municipality operator cannot approve or delete notices
  assert.equal((await reqJson('/api/certificates/cert_10275626255/revoke', { method: 'POST', token: muniOp, body: { reason: 'x' } })).status, 403);

  // Union & Municipality Accountants cannot read application list/details, approve, or revoke
  assert.equal((await reqJson('/api/applications', { token: unionAcc })).status, 403);
  assert.equal((await reqJson(`/api/applications/${opApp.body.id}`, { token: unionAcc })).status, 403);
  assert.equal((await reqJson('/api/certificates/cert_10275626255/revoke', { method: 'POST', token: muniAcc, body: { reason: 'x' } })).status, 403);

  // Accountant CAN submit refund request; Union Admin approves refund
  const payOp = await reqJson('/api/payments/checkout', {
    method: 'POST',
    body: { applicationId: opApp.body.id, method: 'bkash', amount: 100 },
  });
  assert.equal(payOp.status, 200);

  const rrRes = await reqJson('/api/payments/refund-requests', {
    method: 'POST',
    token: unionAcc,
    body: { application_id: opApp.body.id, amount: 100, reason_bn: 'ডুপ্লিকেট পেমেন্ট রিফান্ড অনুরোধ' },
  });
  assert.equal(rrRes.status, 201);
  // Accountant cannot approve refund themselves
  assert.equal(
    (await reqJson(`/api/payments/refund-requests/${rrRes.body.id}/decision`, {
      method: 'POST',
      token: unionAcc,
      body: { decision: 'approved' },
    })).status,
    403
  );
  // Union Admin approves refund
  const rrApprove = await reqJson(`/api/payments/refund-requests/${rrRes.body.id}/decision`, {
    method: 'POST',
    token: goyeshpurAdmin,
    body: { decision: 'approved' },
  });
  assert.equal(rrApprove.status, 200);
  assert.equal(rrApprove.body.status, 'approved');

  // Prepare paid application in Goyeshpur for final-approve permission checks
  const paidApp = await reqJson('/api/applications', {
    method: 'POST',
    body: {
      administrative_unit_id: 'unit_goyeshpur',
      service_id: 'srv_warish',
      applicant_name_bn: 'মোঃ জামাল উদ্দিন',
      mobile: '01766-445566',
      ward_no: 4,
    },
  });
  assert.equal(paidApp.status, 201);
  await reqJson('/api/payments/checkout', {
    method: 'POST',
    body: { applicationId: paidApp.body.id, method: 'nagad', amount: 100 },
  });

  // Non-approvers MUST be rejected from final-approve
  for (const nonApproverToken of [secretary, ceo, superAdmin, uno, monitor]) {
    const denied = await reqJson(`/api/applications/${paidApp.body.id}/final-approve`, {
      method: 'POST',
      token: nonApproverToken,
    });
    assert.equal(denied.status, 403);
  }

  // Upazila Monitoring Officer CAN inspect across units and create monitoring observations, CANNOT mutate status
  assert.equal((await reqJson('/api/applications?unit_id=unit_goyeshpur', { token: monitor })).status, 200);
  assert.equal((await reqJson('/api/applications?unit_id=unit_pabna_muni', { token: monitor })).status, 200);
  const obsRes = await reqJson('/api/monitoring/observations', {
    method: 'POST',
    token: monitor,
    body: {
      administrative_unit_id: 'unit_goyeshpur',
      application_id: paidApp.body.id,
      observation_bn: 'SLA অনুযায়ী ৭২ ঘণ্টার মধ্যে নিষ্পত্তি পর্যবেক্ষণ',
      severity: 'overdue',
    },
  });
  assert.equal(obsRes.status, 201);
  assert.equal(
    (await reqJson(`/api/applications/${paidApp.body.id}/status`, {
      method: 'PATCH',
      token: monitor,
      body: { status: 'rejected', note: 'Not allowed' },
    })).status,
    403
  );
});

test('5. Service-specific Approval Authority, Conflict-of-Interest self-approval block & Super Admin backup export', async () => {
  const { token: chairmanToken } = await getRoleToken('chairman', 'unit_goyeshpur', 'goyeshpur.chairman');
  const { token: superToken } = await getRoleToken('super_admin');

  // Create srv_warish app (Chairman is authorized) and srv_income app (Chairman is NOT authorized by default)
  const warishApp = await reqJson('/api/applications', {
    method: 'POST',
    body: {
      administrative_unit_id: 'unit_goyeshpur',
      service_id: 'srv_warish',
      applicant_name_bn: 'মোঃ আকবর আলী',
      mobile: '01777-111111',
      ward_no: 4,
    },
  });
  await reqJson('/api/payments/checkout', {
    method: 'POST',
    body: { applicationId: warishApp.body.id, method: 'bkash', amount: 100 },
  });

  const incomeApp = await reqJson('/api/applications', {
    method: 'POST',
    body: {
      administrative_unit_id: 'unit_goyeshpur',
      service_id: 'srv_annual_income',
      applicant_name_bn: 'মোঃ বাবুল হোসেন',
      mobile: '01777-222222',
      ward_no: 4,
    },
  });
  assert.equal(incomeApp.status, 201);
  await reqJson('/api/payments/checkout', {
    method: 'POST',
    body: { applicationId: incomeApp.body.id, method: 'bkash', amount: 100 },
  });

  // Chairman approved warish -> 201
  const okApprove = await reqJson(`/api/applications/${warishApp.body.id}/final-approve`, {
    method: 'POST',
    token: chairmanToken,
    body: { notes: 'চেয়ারম্যান কর্তৃক অনুমোদিত' },
  });
  assert.equal(okApprove.status, 201);

  // Chairman denied on unauthorized service srv_income -> 403
  const deniedServiceApprove = await reqJson(`/api/applications/${incomeApp.body.id}/final-approve`, {
    method: 'POST',
    token: chairmanToken,
  });
  assert.equal(deniedServiceApprove.status, 403);

  // Conflict-of-interest: Grant Chairman temporary intake capability, Chairman creates an application himself, tries to approve it -> 403
  const intakeOverride = await reqJson('/api/rbac/users/off_goyeshpur_chairman/overrides', {
    method: 'POST',
    token: superToken,
    body: {
      permission_key: 'applications.create',
      scope: 'institution',
      effect: 'grant',
      reason_bn: 'স্বার্থের দ্বন্দ্ব যাচাই পরীক্ষা',
    },
  });
  assert.equal(intakeOverride.status, 201);

  const selfApp = await reqJson('/api/applications', {
    method: 'POST',
    token: chairmanToken,
    body: {
      administrative_unit_id: 'unit_goyeshpur',
      service_id: 'srv_warish',
      applicant_name_bn: 'স্বার্থের দ্বন্দ্ব পরীক্ষা',
      mobile: '01777-333333',
      ward_no: 4,
    },
  });
  assert.equal(selfApp.status, 201);
  await reqJson('/api/payments/checkout', {
    method: 'POST',
    body: { applicationId: selfApp.body.id, method: 'bkash', amount: 100 },
  });
  const selfApprove = await reqJson(`/api/applications/${selfApp.body.id}/final-approve`, {
    method: 'POST',
    token: chairmanToken,
  });
  assert.equal(selfApprove.status, 403);

  // Super Admin backup export works & non-super-admin is denied
  assert.equal((await reqJson('/api/backups/export', { token: chairmanToken })).status, 403);
  const backupRes = await reqJson('/api/backups/export', { token: superToken });
  assert.equal(backupRes.status, 200);
  assert.ok(Number(backupRes.body.institutions_count) === 11);
});

test('6. Anti-self-elevation, Permission Override Revoke/Expiry, Audit Logs & Restricted Endpoints', async () => {
  const { token: superToken } = await getRoleToken('super_admin');
  const { token: goyeshpurAdmin, session: gAdminSession } = await getRoleToken('union_admin', 'unit_goyeshpur');
  const { token: wardToken } = await getRoleToken('ward_member', 'unit_goyeshpur', 'goyeshpur.ward4');

  // Unauthorized access to system-settings, rbac/roles, audit-logs, staff
  assert.equal((await reqJson('/api/system-settings', { token: wardToken })).status, 403);
  assert.equal((await reqJson('/api/rbac/roles', { token: wardToken })).status, 403);
  assert.equal((await reqJson('/api/audit-logs', { token: wardToken })).status, 403);
  assert.equal((await reqJson('/api/staff', { token: wardToken })).status, 403);

  // Anti-self-elevation: Union Admin cannot assign Super Admin role or grant self override
  const selfRole = await reqJson(`/api/rbac/users/${gAdminSession.id}/roles`, {
    method: 'POST',
    token: goyeshpurAdmin,
    body: { role_slug: 'super_admin' },
  });
  assert.equal(selfRole.status, 403);

  const selfOverride = await reqJson(`/api/rbac/users/${gAdminSession.id}/overrides`, {
    method: 'POST',
    token: goyeshpurAdmin,
    body: { permission_key: 'backups.manage', scope: 'global', effect: 'grant' },
  });
  assert.equal(selfOverride.status, 403);

  // Super Admin revokes 'notices.manage' from Bharara Union Admin -> immediate 403
  const { token: bhararaAdmin } = await getRoleToken('union_admin', 'unit_bharara');
  const okNotice = await reqJson('/api/notices', {
    method: 'POST',
    token: bhararaAdmin,
    body: {
      administrative_unit_id: 'unit_bharara',
      title_bn: 'বৈধ নোটিশ',
      content_bn: 'ভারারা ইউনিয়ন পরিষদের জরুরি বিজ্ঞপ্তি।',
      category: 'notice',
    },
  });
  assert.equal(okNotice.status, 201);

  const revokeOverride = await reqJson('/api/rbac/users/off_bharara_head/overrides', {
    method: 'POST',
    token: superToken,
    body: {
      permission_key: 'notices.manage',
      scope: 'institution',
      effect: 'revoke',
      reason_bn: 'অস্থায়ীভাবে নোটিশ প্রকাশ স্থগিত',
    },
  });
  assert.equal(revokeOverride.status, 201);

  const deniedNotice = await reqJson('/api/notices', {
    method: 'POST',
    token: bhararaAdmin,
    body: {
      administrative_unit_id: 'unit_bharara',
      title_bn: 'নিষিদ্ধ নোটিশ',
      content_bn: 'প্রকাশ করার অনুমতি নেই।',
      category: 'notice',
    },
  });
  assert.equal(deniedNotice.status, 403);

  // Expired temporary grant stops working immediately
  const expiredGrant = await reqJson('/api/rbac/users/off_goyeshpur_ward1/overrides', {
    method: 'POST',
    token: superToken,
    body: {
      permission_key: 'notices.manage',
      scope: 'institution',
      effect: 'grant',
      expires_at: '2020-01-01T00:00:00.000Z',
      reason_bn: 'মেয়াদোত্তীর্ণ পরীক্ষা',
    },
  });
  assert.equal(expiredGrant.status, 201);

  const { token: w1Token } = await getRoleToken('ward_member', 'unit_goyeshpur', 'goyeshpur.ward1');
  const expiredNoticeAttempt = await reqJson('/api/notices', {
    method: 'POST',
    token: w1Token,
    body: {
      administrative_unit_id: 'unit_goyeshpur',
      title_bn: 'Expired grant',
      content_bn: 'Expired override test',
      category: 'notice',
    },
  });
  assert.equal(expiredNoticeAttempt.status, 403);

  // Audit logs record RBAC mutations & backup export
  const rbacLogs = await reqJson('/api/rbac/audit-logs', { token: superToken });
  assert.equal(rbacLogs.status, 200);
  const logItems = rbacLogs.body as unknown as Array<{ action_type: string }>;
  assert.ok(logItems.some((l) => l.action_type === 'permission_override_revoked'));
  assert.ok(logItems.some((l) => l.action_type === 'permission_override_granted'));
  assert.ok(logItems.some((l) => l.action_type === 'system_backup_exported'));
});

test('7. Auth Hardening: 2FA OTP, 5-attempt Lockout (423), Weak Password Rejection (400) & Password Reset Unlock', async () => {
  const { token: superToken } = await getRoleToken('super_admin');

  // Officer login without OTP -> 401 with mfa_required
  const missingOtp = await reqJson('/api/auth/login', {
    method: 'POST',
    body: { username: 'goyeshpur.secretary', password: 'Pottoyon@2026!' },
  });
  assert.equal(missingOtp.status, 401);
  assert.equal(missingOtp.body.mfa_required, true);

  // Wrong OTP -> 401
  const badOtp = await reqJson('/api/auth/login', {
    method: 'POST',
    body: { username: 'goyeshpur.secretary', password: 'Pottoyon@2026!', otp: '000000' },
  });
  assert.equal(badOtp.status, 401);

  // Valid OTP -> 200
  const okOfficer = await loginAs('goyeshpur.secretary', 'Pottoyon@2026!', '123456');
  assert.ok(okOfficer.token);

  // Admin creating user with weak password -> 400
  const weakCreate = await reqJson('/api/rbac/users', {
    method: 'POST',
    token: superToken,
    body: {
      username: 'weak.user',
      password: '123',
      name_bn: 'দুর্বল পাসওয়ার্ড পরীক্ষা',
      primary_role: 'citizen',
    },
  });
  assert.equal(weakCreate.status, 400);

  // 5 failed password attempts lock out account (423)
  for (let i = 1; i <= 4; i++) {
    const attempt = await reqJson('/api/auth/login', {
      method: 'POST',
      body: { username: 'bharara.secretary', password: `WrongPass${i}!` },
    });
    assert.equal(attempt.status, 401);
  }
  const fifthAttempt = await reqJson('/api/auth/login', {
    method: 'POST',
    body: { username: 'bharara.secretary', password: 'WrongPass5!' },
  });
  assert.equal(fifthAttempt.status, 423);

  // Even correct password is rejected with 423 while locked
  const lockedLogin = await reqJson('/api/auth/login', {
    method: 'POST',
    body: { username: 'bharara.secretary', password: 'Pottoyon@2026!', otp: '123456' },
  });
  assert.equal(lockedLogin.status, 423);

  // Password reset request + weak confirm rejected (400) + strong confirm unlocks account
  const resetReq = await reqJson('/api/auth/password-reset/request', {
    method: 'POST',
    body: { identifier: 'bharara.secretary' },
  });
  assert.equal(resetReq.status, 200);
  const resetToken = String(resetReq.body.reset_token_preview);
  assert.ok(resetToken.length > 10);

  const weakReset = await reqJson('/api/auth/password-reset/confirm', {
    method: 'POST',
    body: { token: resetToken, new_password: 'short' },
  });
  assert.equal(weakReset.status, 400);

  const strongReset = await reqJson('/api/auth/password-reset/confirm', {
    method: 'POST',
    body: { token: resetToken, new_password: 'NewStrong@2026' },
  });
  assert.equal(strongReset.status, 200);

  // Account is now unlocked and logs in with new password
  const unlockedLogin = await loginAs('bharara.secretary', 'NewStrong@2026', '123456');
  assert.ok(unlockedLogin.token);
});
