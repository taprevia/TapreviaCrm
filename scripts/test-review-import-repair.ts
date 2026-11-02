/**
 * Review Library import repair — isolated integration suite.
 *
 * Refuses any target other than a disposable MongoDB on 127.0.0.1:27019 with a
 * `taprevia_reviewimport_` database. Never touches the live `nfc-crm` database.
 *
 * Run with a local mongod on 27019 (replica set preferred so the transactional
 * write path is exercised).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { connectDB } from '@/lib/db';
import User from '@/models/User';
import ReviewCategory from '@/models/ReviewCategory';
import ReviewTemplate from '@/models/ReviewTemplate';
import { POST as importPOST } from '@/app/api/admin/review-library/import/route';
import { POST as previewPOST } from '@/app/api/admin/review-library/import/preview/route';
import { GET as exportGET } from '@/app/api/admin/review-library/export/route';
import {
  parseReviewLibraryImportText,
  toReviewLibraryImportBody,
} from '@/lib/review-library-import-payload';
import { getReviewTemplateSuggestions } from '@/lib/services/review-templates';

const URI = process.env.MONGODB_URI ?? '';
const DB = process.env.MONGODB_DB ?? '';
if (!URI.includes('127.0.0.1:27019') || !DB.startsWith('taprevia_reviewimport_')) {
  throw new Error(`Refusing non-isolated import test target: ${URI || '(unset)'} / ${DB || '(unset)'}`);
}
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const CATEGORY = {
  key: 'real-estate',
  name: 'Real Estate',
  active: true,
  languages: ['English'],
  scenarios: [
    { key: 'overall', name: 'Overall experience' },
    { key: 'agent-service', name: 'Agent and service' },
  ],
};

function realEstateTemplate(index: number) {
  return {
    key: `real-estate-overall-${index}`,
    categoryKey: 'real-estate',
    scenario: 'overall',
    language: 'English',
    text: `Property ${index}: {businessName} helped us find the right home.`,
    length: index % 3 === 0 ? 'short' : index % 3 === 1 ? 'medium' : 'detailed',
    style: index % 2 === 0 ? 'friendly' : 'professional',
    compatibleKeywords: ['property'],
    active: true,
  };
}

function realEstatePayload() {
  return { categories: [CATEGORY], templates: Array.from({ length: 100 }, (_, i) => realEstateTemplate(i + 1)) };
}

async function clearLibrary() {
  await ReviewCategory.deleteMany({});
  await ReviewTemplate.deleteMany({});
}

async function main() {
  await connectDB();
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  const transactional = Boolean(hello.setName || hello.msg === 'isdbgrid');
  console.log(`[review-import-test] transactional=${transactional}`);

  await clearLibrary();
  await User.deleteMany({ email: 'review-import-admin@test.invalid' });
  const admin = await User.create({
    name: 'Review Import Admin',
    email: 'review-import-admin@test.invalid',
    passwordHash: 'AdminPass123!',
    role: 'admin',
    status: 'active',
  });
  const token = jwt.sign(
    { userId: String(admin._id), role: 'admin' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );

  const call = async (
    handler: (request: NextRequest) => Promise<Response>,
    route: string,
    body?: unknown,
    raw?: string
  ) => {
    const request = new NextRequest(`http://localhost${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `token=${token}`,
      },
      body: raw ?? JSON.stringify(body ?? {}),
    });
    const response = await handler(request);
    const text = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
  };

  const importPayload = async (payload: unknown, overwrite = false) =>
    call(importPOST, '/api/admin/review-library/import', { ...(payload as object), overwrite });
  const previewPayload = async (payload: unknown, overwrite = false) =>
    call(previewPOST, '/api/admin/review-library/import/preview', { ...(payload as object), overwrite });
  const exportLibrary = async () => {
    const request = new NextRequest('http://localhost/api/admin/review-library/export', {
      headers: { cookie: `token=${token}` },
    });
    const response = await exportGET(request);
    const text = await response.text();
    return { status: response.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : null };
  };

  // 1. Previously exported Mobile Repair artifact (old export format).
  await clearLibrary();
  const mobileRaw = readFileSync(join(__dirname, 'data', 'review-library-mobile-repair.json'), 'utf8');
  const mobile = parseReviewLibraryImportText(mobileRaw);
  const mobileImport = await importPayload(toReviewLibraryImportBody(mobile));
  check(
    'old Mobile Repair export imports',
    mobileImport.status === 200 &&
      (mobileImport.json as any)?.imported?.categories === 1 &&
      (mobileImport.json as any)?.imported?.templates === 14,
    `status=${mobileImport.status}`
  );
  check(
    'old export persisted exact counts',
    (await ReviewCategory.countDocuments({})) === 1 &&
      (await ReviewTemplate.countDocuments({})) === 14
  );
  const mobileIds = {
    category: String((await ReviewCategory.findOne({ key: 'mobile-repair' }))?._id),
    templates: (await ReviewTemplate.find({ categoryKey: 'mobile-repair' }).select('_id').lean()).map((row) => String(row._id)).sort(),
  };

  // 2. Re-import without overwrite keeps IDs and text unchanged.
  const reimport = await importPayload(toReviewLibraryImportBody(mobile), false);
  const mobileIdsAfter = {
    category: String((await ReviewCategory.findOne({ key: 'mobile-repair' }))?._id),
    templates: (await ReviewTemplate.find({ categoryKey: 'mobile-repair' }).select('_id').lean()).map((row) => String(row._id)).sort(),
  };
  check(
    're-import without overwrite skips and preserves IDs',
    reimport.status === 200 &&
      (reimport.json as any)?.imported?.categories === 0 &&
      (reimport.json as any)?.imported?.templates === 0 &&
      (reimport.json as any)?.skipped?.categories === 1 &&
      (reimport.json as any)?.skipped?.templates === 14 &&
      mobileIds.category === mobileIdsAfter.category &&
      JSON.stringify(mobileIds.templates) === JSON.stringify(mobileIdsAfter.templates)
  );

  // 3. Explicit overwrite updates in place without replacing IDs.
  const overwrite = await importPayload(toReviewLibraryImportBody(mobile), true);
  const mobileIdsOverwrite = {
    category: String((await ReviewCategory.findOne({ key: 'mobile-repair' }))?._id),
    templates: (await ReviewTemplate.find({ categoryKey: 'mobile-repair' }).select('_id').lean()).map((row) => String(row._id)).sort(),
  };
  check(
    'explicit overwrite updates in place and preserves IDs',
    overwrite.status === 200 &&
      (overwrite.json as any)?.imported?.categories === 1 &&
      (overwrite.json as any)?.imported?.templates === 14 &&
      mobileIds.category === mobileIdsOverwrite.category &&
      JSON.stringify(mobileIds.templates) === JSON.stringify(mobileIdsOverwrite.templates)
  );

  // 4. 100 Real Estate templates.
  await clearLibrary();
  const estate = parseReviewLibraryImportText(JSON.stringify(realEstatePayload()));
  const estateImport = await importPayload(toReviewLibraryImportBody(estate));
  check(
    '100 Real Estate templates import',
    estateImport.status === 200 &&
      (estateImport.json as any)?.imported?.categories === 1 &&
      (estateImport.json as any)?.imported?.templates === 100,
    `status=${estateImport.status}`
  );
  check(
    'Real Estate counts and relationships persisted',
    (await ReviewCategory.countDocuments({ key: 'real-estate' })) === 1 &&
      (await ReviewTemplate.countDocuments({ categoryKey: 'real-estate' })) === 100 &&
      (await ReviewTemplate.countDocuments({ categoryKey: 'real-estate', scenario: 'overall' })) === 100
  );

  const suggestions = await getReviewTemplateSuggestions({
    card: {
      name: 'Real Estate Demo',
      reviewAssistant: {
        enabled: true,
        category: 'real-estate',
        languages: ['English'],
        preferredLength: 'short',
        writingStyle: 'friendly',
      },
    },
    language: 'English',
  });
  check('Engine A serves imported Real Estate templates', suggestions.length > 0, `${suggestions.length} suggestion(s)`);

  // 5. Export → re-import round trip.
  const exported = await exportLibrary();
  const exportedPayload = parseReviewLibraryImportText(JSON.stringify(exported.json));
  await clearLibrary();
  const roundTrip = await importPayload(toReviewLibraryImportBody(exportedPayload));
  check(
    'export → re-import round trip',
    exported.status === 200 &&
      roundTrip.status === 200 &&
      (roundTrip.json as any)?.imported?.categories === 1 &&
      (roundTrip.json as any)?.imported?.templates === 100 &&
      (await ReviewTemplate.countDocuments({ categoryKey: 'real-estate' })) === 100
  );

  // 6. Empty / malformed / missing-field payloads.
  const empty = await importPayload({ categories: [], templates: [] });
  check('empty payload rejected', empty.status === 400, `status=${empty.status}`);
  const malformed = await call(importPOST, '/api/admin/review-library/import', undefined, '{not-json');
  check('malformed JSON rejected', malformed.status === 400, `status=${malformed.status}`);
  const missing = await importPayload({ categories: [{ key: 'real-estate' }], templates: [] });
  check('missing required category fields rejected', missing.status === 400, `status=${missing.status}`);

  // 7. Duplicate keys reject before any write.
  await clearLibrary();
  const duplicate = await importPayload({
    categories: [CATEGORY, { ...CATEGORY, name: 'Real Estate Duplicate' }],
    templates: [realEstateTemplate(1)],
  });
  check(
    'duplicate category keys rejected with no writes',
    duplicate.status === 400 &&
      (await ReviewCategory.countDocuments({})) === 0 &&
      (await ReviewTemplate.countDocuments({})) === 0,
    `status=${duplicate.status}`
  );

  const duplicateTemplate = await importPayload({
    categories: [CATEGORY],
    templates: [realEstateTemplate(1), realEstateTemplate(1)],
  });
  check(
    'duplicate template keys rejected with no writes',
    duplicateTemplate.status === 400 &&
      (await ReviewCategory.countDocuments({})) === 0 &&
      (await ReviewTemplate.countDocuments({})) === 0,
    `status=${duplicateTemplate.status}`
  );

  // 8. Unsupported style/length reject before any write.
  const badStyle = await importPayload({
    categories: [CATEGORY],
    templates: [{ ...realEstateTemplate(1), style: 'formal' }],
  });
  const badLength = await importPayload({
    categories: [CATEGORY],
    templates: [{ ...realEstateTemplate(1), length: 'long' }],
  });
  check(
    'unsupported style/length rejected with no writes',
    badStyle.status === 400 &&
      badLength.status === 400 &&
      (await ReviewCategory.countDocuments({})) === 0 &&
      (await ReviewTemplate.countDocuments({})) === 0,
    `style=${badStyle.status} length=${badLength.status}`
  );

  // 9. Semantic failure does not partially write the valid sibling.
  await clearLibrary();
  const partialPayload = {
    categories: [CATEGORY],
    templates: [realEstateTemplate(1), { ...realEstateTemplate(2), scenario: 'missing-scenario' }],
  };
  const partialPreview = await previewPayload(partialPayload);
  const partialImport = await importPayload(partialPayload);
  check(
    'invalid template is caught by preview',
    partialPreview.status === 200 &&
      Array.isArray((partialPreview.json as any)?.preview?.invalid) &&
      (partialPreview.json as any).preview.invalid.length > 0
  );
  check(
    'failed import creates no partial category/template records',
    partialImport.status === 400 &&
      (await ReviewCategory.countDocuments({})) === 0 &&
      (await ReviewTemplate.countDocuments({})) === 0,
    `status=${partialImport.status}`
  );

  // 10. Existing records remain unchanged after a failed import.
  await clearLibrary();
  await importPayload(toReviewLibraryImportBody(estate));
  const beforeFailed = {
    categories: await ReviewCategory.countDocuments({}),
    templates: await ReviewTemplate.countDocuments({}),
    firstText: (await ReviewTemplate.findOne({}).lean<any>())?.text,
  };
  const failedAfterExisting = await importPayload({
    categories: [CATEGORY],
    templates: [
      {
        ...realEstateTemplate(1),
        key: 'real-estate-overall-new-invalid',
        scenario: 'missing-scenario',
      },
    ],
  });
  const afterFailed = {
    categories: await ReviewCategory.countDocuments({}),
    templates: await ReviewTemplate.countDocuments({}),
    firstText: (await ReviewTemplate.findOne({}).lean<any>())?.text,
  };
  check(
    'failed import leaves existing library untouched',
    failedAfterExisting.status === 400 &&
      beforeFailed.categories === afterFailed.categories &&
      beforeFailed.templates === afterFailed.templates &&
      beforeFailed.firstText === afterFailed.firstText,
    `status=${failedAfterExisting.status}`
  );

  console.log('\n=== REVIEW IMPORT INTEGRATION SUMMARY ===');
  console.log(JSON.stringify({ checks: passed + failed, passed, failed, transactional, failures }, null, 2));

  await clearLibrary();
  await User.deleteMany({ email: 'review-import-admin@test.invalid' });
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
