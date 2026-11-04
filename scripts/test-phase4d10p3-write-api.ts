/**
 * Phase 4D.10 Gate P3.5 — write-API verification harness.
 *
 * Executes every POST/PATCH/PUT/DELETE route against a real local Next.js
 * server with synthetic MongoDB fixtures, then asserts database side effects.
 *
 * Requirements:
 *   - Local server built from the current tree, e.g. on :3502
 *   - MONGODB_URI=mongodb://localhost:27017 MONGODB_DB=taprevia_p35_audit
 *   - MEDIA_DRIVER=local UPLOAD_DIR=<tmp>
 *
 * Run:
 *   MONGODB_URI=mongodb://localhost:27017 MONGODB_DB=taprevia_p35_audit \
 *   P35_BASE=http://localhost:3502 \
 *   P35_STANDEE_BASE=http://localhost:3503 \
 *   npx tsx scripts/test-phase4d10p3-write-api.ts
 */

import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { connectDB } from '@/lib/db';
import { mintResetToken } from '@/lib/password-reset';
import User from '@/models/User';
import Profile from '@/models/Profile';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import CatalogProduct from '@/models/CatalogProduct';
import UserProduct from '@/models/UserProduct';
import ReviewCategory from '@/models/ReviewCategory';
import ReviewTemplate from '@/models/ReviewTemplate';
import Product from '@/models/Product';
import Appointment from '@/models/Appointment';
import Inquiry from '@/models/Inquiry';
import ProductEnquiry from '@/models/ProductEnquiry';
import Media from '@/models/Media';
import SystemSettings from '@/models/SystemSettings';

const BASE = process.env.P35_BASE || 'http://localhost:3502';
const STANDEE_BASE = process.env.P35_STANDEE_BASE || '';
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/p35-uploads';
const JWT_SECRET = process.env.JWT_SECRET as string;

if (!JWT_SECRET) {
  console.error('JWT_SECRET is required (source it from .env.local)');
  process.exit(1);
}

const oid = (suffix: string) => new mongoose.Types.ObjectId(`${'0'.repeat(24 - suffix.length)}${suffix}`);
const ID = {
  admin: oid('1'),
  owner: oid('2'),
  other: oid('3'),
  disposable: oid('4'),
  disposable2: oid('5'),
  suspended: oid('6'),
  registered: oid('7'),
} as const;

const P = {
  prem: oid('101'),
  biz: oid('102'),
  grc: oid('103'),
  plate: oid('104'),
  insta: oid('105'),
  standee: oid('106'),
  inactive: oid('107'),
};
const C = {
  prem: oid('201'),
  biz: oid('202'),
  grc: oid('203'),
  plate: oid('204'),
  insta: oid('205'),
  other: oid('206'),
  unassigned: oid('207'),
  disposable2: oid('208'),
  guarded: oid('209'),
};
const A = {
  prem: oid('401'),
  biz: oid('402'),
  grc: oid('403'),
  plate: oid('404'),
  insta: oid('405'),
  standee: oid('406'),
  other: oid('407'),
  disposableStandee: oid('409'),
};
const S = { owner: oid('301'), deleted: oid('302') };
const RC = { cafe: oid('601'), tempDelete: oid('602'), import: oid('603'), created: oid('604') };
const RT = { core: oid('701'), tempDelete: oid('702'), import: oid('703'), created: oid('704') };
const PR = { grc: oid('801'), disposable: oid('802'), other: oid('803') };
const AP = { owner: oid('901'), other: oid('902') };
const IQ = { owner: oid('a01'), other: oid('a02') };
const PE = { owner: oid('b01'), other: oid('b02') };
const MD = { owner: oid('c01'), other: oid('c02'), pending: oid('c03'), pendingOther: oid('c04') };

const OWNER_PASSWORD = 'OwnerPass123!';
const NEW_PASSWORD = 'NewOwnerPass456!';

const HOURS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(
  (day) => ({ day, enabled: true, from: '09:00', to: '17:00' })
);

type Result = {
  mid: string;
  id: string;
  method: string;
  route: string;
  kind: 'positive' | 'negative' | 'security';
  expected: number | number[];
  actual: number;
  pass: boolean;
  detail: string;
};

const results: Result[] = [];
const dbChecks: Array<{ name: string; pass: boolean }> = [];
let dbQueryCount = 0;
let dbSideEffectScenarios = 0;
let dbSideEffectScenariosPassed = 0;

// Count queries executed inside a test's post-request verify callback so the
// report can state exactly how many scenarios re-read persisted state.
const originalExec = mongoose.Query.prototype.exec;
(mongoose.Query.prototype as unknown as { exec: (...args: unknown[]) => unknown }).exec = function (
  this: mongoose.Query<unknown, unknown>,
  ...args: unknown[]
) {
  dbQueryCount += 1;
  return (originalExec as unknown as (...inner: unknown[]) => unknown).apply(this, args);
};
let ipCounter = 0;
const nextIp = () => `10.55.${Math.floor(ipCounter / 200)}.${(ipCounter++ % 200) + 1}`;

function tokenFor(userId: mongoose.Types.ObjectId, role = 'customer'): string {
  return jwt.sign({ userId: String(userId), role }, JWT_SECRET, { expiresIn: '1h' });
}

const TOKENS = {
  admin: tokenFor(ID.admin, 'admin'),
  owner: tokenFor(ID.owner),
  other: tokenFor(ID.other),
  disposable: tokenFor(ID.disposable),
};

async function call(
  method: string,
  route: string,
  opts: { token?: string; body?: unknown; raw?: string; base?: string; headers?: Record<string, string> } = {}
) {
  const origin = new URL(opts.base ?? BASE).origin;
  const headers: Record<string, string> = {
    'x-real-ip': nextIp(),
    ...(opts.token ? { cookie: `token=${opts.token}`, origin } : {}),
    ...(opts.headers ?? {}),
  };
  let body: string | undefined;
  if (opts.raw !== undefined) {
    headers['content-type'] = headers['content-type'] ?? 'application/json';
    body = opts.raw;
  } else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${opts.base ?? BASE}${route}`, {
    method,
    headers,
    body,
    redirect: 'manual',
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json, headers: res.headers };
}

async function test(
  mid: string,
  id: string,
  method: string,
  route: string,
  kind: Result['kind'],
  expected: number | number[],
  opts: {
    token?: string;
    body?: unknown;
    raw?: string;
    base?: string;
    headers?: Record<string, string>;
    verify?: (r: Awaited<ReturnType<typeof call>>) => Promise<boolean> | boolean;
    note?: string;
  } = {}
) {
  let actual = -1;
  let detail = '';
  let pass = false;
  try {
    const r = await call(method, route, opts);
    actual = r.status;
    const wanted = Array.isArray(expected) ? expected : [expected];
    pass = wanted.includes(actual);
    if (pass && opts.verify) {
      const before = dbQueryCount;
      pass = await opts.verify(r);
      if (dbQueryCount > before) {
        dbSideEffectScenarios += 1;
        if (pass) dbSideEffectScenariosPassed += 1;
      }
    }
    if (!pass) detail = `status=${actual} expected=${wanted.join('|')} body=${r.text.slice(0, 240)}`;
    else detail = opts.note ?? '';
  } catch (error) {
    detail = `request failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  results.push({ mid, id, method, route, kind, expected, actual, pass, detail });
  const label = `${id} ${method} ${route}`;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${pass ? '' : ` — ${detail}`}`);
  return pass;
}

async function dbCheck(name: string, fn: () => Promise<boolean> | boolean) {
  let pass = false;
  try {
    pass = await fn();
  } catch (error) {
    console.error(`DB CHECK ERROR ${name}:`, error);
  }
  dbChecks.push({ name, pass });
  if (!pass) console.log(`FAIL db: ${name}`);
  return pass;
}

const hash = (value: string) => bcrypt.hash(value, 10);

export async function seed() {
  await connectDB();
  await mongoose.connection.dropDatabase();

  // Ensure unique indexes exist so duplicate-key paths behave as in dev.
  await Promise.all([
    User.syncIndexes(),
    Card.syncIndexes(),
    CatalogProduct.syncIndexes(),
    ReviewCategory.syncIndexes(),
    ReviewTemplate.syncIndexes(),
  ]);

  const now = new Date();
  const active = { status: 'active', isActive: true, setupComplete: true, createdAt: now, updatedAt: now };

  await mongoose.connection.collection('users').insertMany([
    { _id: ID.admin, name: 'P35 Admin', email: 'admin@p35.test', role: 'admin', status: 'active', passwordHash: await hash('AdminPass123!'), createdAt: now, updatedAt: now },
    { _id: ID.owner, name: 'P35 Owner', email: 'owner@p35.test', role: 'customer', status: 'active', passwordHash: await hash(OWNER_PASSWORD), createdAt: now, updatedAt: now },
    { _id: ID.other, name: 'P35 Other', email: 'other@p35.test', role: 'customer', status: 'active', passwordHash: await hash('OtherPass123!'), createdAt: now, updatedAt: now },
    { _id: ID.disposable, name: 'P35 Disposable', email: 'disposable@p35.test', role: 'customer', status: 'active', passwordHash: await hash('Disposable123!'), createdAt: now, updatedAt: now },
    { _id: ID.disposable2, name: 'P35 Disposable Two', email: 'disposable2@p35.test', role: 'customer', status: 'active', passwordHash: await hash('Disposable123!'), createdAt: now, updatedAt: now },
    { _id: ID.suspended, name: 'P35 Suspended', email: 'suspended@p35.test', role: 'customer', status: 'suspended', passwordHash: await hash('SuspendedPass123!'), createdAt: now, updatedAt: now },
  ]);

  await mongoose.connection.collection('profiles').insertMany([
    { _id: oid('501'), userId: ID.owner, companyInfo: { companyName: 'P35 Owner Co' }, socialLinks: [], allowedTemplates: ['panthi-event'], cardId: C.prem, createdAt: now, updatedAt: now },
    { _id: oid('502'), userId: ID.other, companyInfo: { companyName: 'P35 Other Co' }, socialLinks: [], cardId: C.other, createdAt: now, updatedAt: now },
    { _id: oid('503'), userId: ID.disposable, companyInfo: { companyName: 'P35 Disposable Co' }, socialLinks: [], cardId: C.disposable2, createdAt: now, updatedAt: now },
  ]);

  await mongoose.connection.collection('catalogproducts').insertMany([
    { _id: P.prem, slug: 'premium-nfc-card', name: 'Premium NFC Card', category: 'card', kind: 'profile', active: true, priceMinor: 0, sortOrder: 1, createdAt: now, updatedAt: now },
    { _id: P.biz, slug: 'business-nfc-card', name: 'Business NFC Card', category: 'card', kind: 'profile', active: true, priceMinor: 0, sortOrder: 2, createdAt: now, updatedAt: now },
    { _id: P.grc, slug: 'google-review-card', name: 'Google Review Card', category: 'card', kind: 'review', active: true, priceMinor: 0, sortOrder: 3, createdAt: now, updatedAt: now },
    { _id: P.plate, slug: 'google-review-nfc-plate', name: 'Google Review NFC Plate', category: 'card', kind: 'review', active: true, priceMinor: 0, sortOrder: 4, createdAt: now, updatedAt: now },
    { _id: P.insta, slug: 'insta-card', name: 'Insta Card', category: 'card', kind: 'social', active: true, priceMinor: 0, sortOrder: 5, createdAt: now, updatedAt: now },
    { _id: P.standee, slug: 'google-review-standee', name: 'Google Review Standee', category: 'standee', kind: 'standee', active: true, priceMinor: 0, sortOrder: 6, createdAt: now, updatedAt: now },
    { _id: P.inactive, slug: 'inactive-card', name: 'Inactive Card', category: 'card', kind: 'profile', active: false, priceMinor: 0, sortOrder: 9, createdAt: now, updatedAt: now },
  ]);

  const reviewAssistant = {
    enabled: true,
    googleReviewUrl: 'https://example.test/grc',
    writingStyle: 'friendly',
    preferredLength: 'short',
    languages: ['English'],
    feedbackTopics: [],
    welcomeMessage: 'Welcome',
    category: 'cafe',
    employees: [],
    services: [],
    keywords: [],
  };

  await mongoose.connection.collection('cards').insertMany([
    { _id: C.prem, cardUid: 'P35-PREMIUM', slug: 'p35-premium', routeSlug: 'route-p35-premium', urlAlias: 'p35-premium', publicSlug: 'p35/premium', name: 'Premium Card', cardLabel: '', kind: 'profile', userId: ID.owner, assignedUserId: ID.owner, businessHours: HOURS, ...active },
    { _id: C.biz, cardUid: 'P35-BUSINESS', slug: 'p35-business', routeSlug: 'route-p35-business', urlAlias: 'p35-business', publicSlug: 'p35/business', name: 'Business Card', cardLabel: '', kind: 'profile', userId: ID.owner, assignedUserId: ID.owner, businessHours: HOURS, ...active },
    { _id: C.grc, cardUid: 'P35-GRC', slug: 'p35-grc', routeSlug: 'route-p35-grc', urlAlias: 'p35-grc', publicSlug: 'p35/grc', name: 'Google Review Card', cardLabel: '', kind: 'review', userId: ID.owner, assignedUserId: ID.owner, reviewAssistant, businessHours: HOURS, ...active },
    { _id: C.plate, cardUid: 'P35-PLATE', slug: 'p35-plate', routeSlug: 'route-p35-plate', urlAlias: 'p35-plate', publicSlug: 'p35/plate', name: 'Google Review Plate', cardLabel: '', kind: 'review', userId: ID.owner, assignedUserId: ID.owner, reviewAssistant: { ...reviewAssistant, googleReviewUrl: 'https://example.test/plate' }, businessHours: HOURS, ...active },
    { _id: C.insta, cardUid: 'P35-INSTA', slug: 'p35-insta', routeSlug: 'route-p35-insta', urlAlias: 'p35-insta', publicSlug: 'p35/insta', name: 'Insta Card', cardLabel: '', kind: 'social', redirectUrl: 'https://example.test/insta', userId: ID.owner, assignedUserId: ID.owner, businessHours: HOURS, ...active },
    { _id: C.other, cardUid: 'P35-OTHER', slug: 'p35-other', routeSlug: 'route-p35-other', urlAlias: 'p35-other', publicSlug: 'p35/other', name: 'Other Card', cardLabel: '', kind: 'profile', userId: ID.other, assignedUserId: ID.other, businessHours: HOURS, ...active },
    { _id: C.unassigned, cardUid: 'P35-UNASSIGNED', slug: 'p35-unassigned', routeSlug: 'route-p35-unassigned', urlAlias: 'p35-unassigned', publicSlug: 'p35/unassigned', name: 'Unassigned Card', cardLabel: '', kind: 'profile', userId: null, assignedUserId: null, status: 'unassigned', isActive: false, setupComplete: false, businessHours: HOURS, createdAt: now, updatedAt: now },
    { _id: C.disposable2, cardUid: 'P35-DISP2', slug: 'p35-disp2', routeSlug: 'route-p35-disp2', urlAlias: 'p35-disp2', publicSlug: 'p35/disp2', name: 'Disposable Two Card', cardLabel: '', kind: 'profile', userId: ID.disposable2, assignedUserId: ID.disposable2, businessHours: HOURS, ...active },
    { _id: C.guarded, cardUid: 'P35-GUARDED', slug: 'p35-guarded', routeSlug: 'route-p35-guarded', urlAlias: 'p35-guarded', publicSlug: 'p35/guarded', name: 'Guarded Card', cardLabel: '', kind: 'profile', userId: ID.owner, assignedUserId: ID.owner, businessHours: HOURS, ...active },
  ]);

  await mongoose.connection.collection('standees').insertMany([
    {
      _id: S.owner,
      userId: ID.owner,
      name: 'P35 Standee',
      displayName: 'P35 Standee',
      routeSlug: 'p35-standee',
      uid: 'p35-standee',
      publicSlug: 'p35/standee',
      productKey: 'GOOGLE_REVIEW_STANDEE',
      maxProfiles: 2,
      fixedProfiles: ['google_review', 'instagram'],
      panelQr: { qrId: 'panel-p35', qrColor: '#000000' },
      socialQrs: [
        { qrId: 'qr-p35-g', platform: 'google_review', label: 'Google Review', qrColor: '#000000', destinationUrl: 'https://example.test/standee-google' },
        { qrId: 'qr-p35-i', platform: 'instagram', label: 'Instagram', qrColor: '#000000', destinationUrl: 'https://example.test/standee-instagram' },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: S.deleted,
      userId: ID.disposable,
      name: 'P35 Delete Standee',
      displayName: 'P35 Delete Standee',
      routeSlug: 'p35-delete-standee',
      uid: 'p35-delete-standee',
      publicSlug: 'p35/delete-standee',
      productKey: 'GOOGLE_REVIEW_STANDEE',
      maxProfiles: 1,
      fixedProfiles: ['google_review'],
      panelQr: { qrId: 'panel-p35-del', qrColor: '#000000' },
      socialQrs: [
        { qrId: 'qr-p35-del', platform: 'google_review', label: 'Google Review', qrColor: '#000000', destinationUrl: 'https://example.test/delete-google' },
      ],
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await mongoose.connection.collection('userproducts').insertMany([
    { _id: A.prem, userId: ID.owner, catalogProductId: P.prem, cardId: C.prem, standeeId: null, quantity: 1, status: 'active', createdAt: now, updatedAt: now },
    { _id: A.biz, userId: ID.owner, catalogProductId: P.biz, cardId: C.biz, standeeId: null, quantity: 1, status: 'active', createdAt: now, updatedAt: now },
    { _id: A.grc, userId: ID.owner, catalogProductId: P.grc, cardId: C.grc, standeeId: null, quantity: 1, status: 'active', createdAt: now, updatedAt: now },
    { _id: A.plate, userId: ID.owner, catalogProductId: P.plate, cardId: C.plate, standeeId: null, quantity: 1, status: 'active', createdAt: now, updatedAt: now },
    { _id: A.insta, userId: ID.owner, catalogProductId: P.insta, cardId: C.insta, standeeId: null, quantity: 1, status: 'active', createdAt: now, updatedAt: now },
    { _id: A.standee, userId: ID.owner, catalogProductId: P.standee, cardId: null, standeeId: S.owner, quantity: 1, status: 'active', createdAt: now, updatedAt: now },
    { _id: A.other, userId: ID.other, catalogProductId: P.biz, cardId: C.other, standeeId: null, quantity: 1, status: 'active', createdAt: now, updatedAt: now },
    { _id: A.disposableStandee, userId: ID.disposable, catalogProductId: P.standee, cardId: null, standeeId: S.deleted, quantity: 1, status: 'active', createdAt: now, updatedAt: now },
    { _id: oid('410'), userId: ID.owner, catalogProductId: P.biz, cardId: C.guarded, standeeId: null, quantity: 1, status: 'active', createdAt: now, updatedAt: now },
  ]);

  await mongoose.connection.collection('reviewcategories').insertMany([
    { _id: RC.cafe, key: 'cafe', name: 'Cafe', active: true, languages: ['English'], scenarios: [{ key: 'service', name: 'Service' }], createdAt: now, updatedAt: now },
    { _id: RC.tempDelete, key: 'p35-temp-delete', name: 'P35 Temp Delete', active: true, languages: ['English'], scenarios: [{ key: 'service', name: 'Service' }], createdAt: now, updatedAt: now },
    { _id: RC.import, key: 'p35-import-existing', name: 'P35 Import Existing', active: true, languages: ['English'], scenarios: [{ key: 'service', name: 'Service' }], createdAt: now, updatedAt: now },
    { _id: RC.created, key: 'p35-created', name: 'P35 Created', active: true, languages: ['English'], scenarios: [{ key: 'service', name: 'Service' }], createdAt: now, updatedAt: now },
  ]);

  await mongoose.connection.collection('reviewtemplates').insertMany([
    { _id: RT.core, key: 'p35-core-tpl', categoryKey: 'cafe', scenario: 'service', language: 'English', text: 'Great service at {businessName}.', length: 'short', style: 'friendly', variables: ['businessName'], compatibleKeywords: [], active: true, usageCount: 0, lastShownAt: null, createdAt: now, updatedAt: now },
    { _id: RT.tempDelete, key: 'p35-temp-delete-tpl', categoryKey: 'p35-temp-delete', scenario: 'service', language: 'English', text: 'Temp delete {businessName}.', length: 'short', style: 'friendly', variables: ['businessName'], compatibleKeywords: [], active: true, usageCount: 0, lastShownAt: null, createdAt: now, updatedAt: now },
    { _id: RT.import, key: 'p35-import-existing-tpl', categoryKey: 'p35-import-existing', scenario: 'service', language: 'English', text: 'Existing import {businessName}.', length: 'short', style: 'friendly', variables: ['businessName'], compatibleKeywords: [], active: true, usageCount: 0, lastShownAt: null, createdAt: now, updatedAt: now },
    { _id: RT.created, key: 'p35-created-tpl', categoryKey: 'p35-created', scenario: 'service', language: 'English', text: 'Created {businessName}.', length: 'short', style: 'friendly', variables: ['businessName'], compatibleKeywords: [], active: true, usageCount: 0, lastShownAt: null, createdAt: now, updatedAt: now },
  ]);

  await mongoose.connection.collection('products').insertMany([
    { _id: PR.grc, userId: ID.owner, cardId: C.grc, title: 'P35 Product', description: '', priceMinor: 1000, currency: 'INR', category: '', imageUrl: '', active: true, enquiryCount: 0, createdAt: now, updatedAt: now },
    { _id: PR.disposable, userId: ID.owner, cardId: C.biz, title: 'P35 Delete Product', description: '', priceMinor: 500, currency: 'INR', category: '', imageUrl: '', active: true, enquiryCount: 0, createdAt: now, updatedAt: now },
    { _id: PR.other, userId: ID.other, cardId: C.other, title: 'Other Product', description: '', priceMinor: 100, currency: 'INR', category: '', imageUrl: '', active: true, enquiryCount: 0, createdAt: now, updatedAt: now },
  ]);

  await mongoose.connection.collection('reviewsettings').insertOne({
    _id: oid('650'),
    businessId: ID.owner,
    schemaVersion: 1,
    general: {
      enabled: true,
      googleReviewUrl: 'https://example.test/central-seeded',
      welcomeMessage: '',
    },
    content: {
      category: 'cafe',
      languages: ['English'],
      writingStyle: 'friendly',
      preferredLength: 'short',
      styleMode: 'fixed',
      lengthMode: 'fixed',
      feedbackTopics: [],
      services: [],
      employees: [],
      keywords: [],
    },
    updatedBy: ID.owner,
    createdAt: now,
    updatedAt: now,
    __v: 0,
  });

  await mongoose.connection.collection('appointments').insertMany([
    { _id: AP.owner, userId: ID.owner, cardId: C.grc, visitorName: 'Owner Visitor', visitorEmail: 'v1@example.test', visitorPhone: '', service: '', note: '', date: new Date('2027-06-15T00:00:00.000Z'), slot: '10:00 AM', status: 'pending', createdAt: now, updatedAt: now },
    { _id: AP.other, userId: ID.other, cardId: C.other, visitorName: 'Other Visitor', visitorEmail: 'v2@example.test', visitorPhone: '', service: '', note: '', date: new Date('2027-06-16T00:00:00.000Z'), slot: '10:00 AM', status: 'pending', createdAt: now, updatedAt: now },
  ]);

  await mongoose.connection.collection('inquiries').insertMany([
    { _id: IQ.owner, userId: ID.owner, cardId: C.grc, name: 'Owner Lead', email: 'lead1@example.test', phone: '', message: 'Hello', attachmentUrl: '', source: 'contact_form', status: 'new', notes: [], createdAt: now, updatedAt: now },
    { _id: IQ.other, userId: ID.other, cardId: C.other, name: 'Other Lead', email: 'lead2@example.test', phone: '', message: 'Hello', attachmentUrl: '', source: 'contact_form', status: 'new', notes: [], createdAt: now, updatedAt: now },
  ]);

  await mongoose.connection.collection('productenquiries').insertMany([
    { _id: PE.owner, userId: ID.owner, cardId: C.grc, productId: PR.grc, productTitle: 'P35 Product', quantity: 1, name: 'Owner Buyer', note: '', status: 'new', createdAt: now, updatedAt: now },
    { _id: PE.other, userId: ID.other, cardId: C.other, productId: PR.other, productTitle: 'Other Product', quantity: 1, name: 'Other Buyer', note: '', status: 'new', createdAt: now, updatedAt: now },
  ]);

  // Ready media rows used by the uploads tests.
  mkdirSync(path.join(UPLOAD_DIR, String(ID.owner)), { recursive: true });
  const ownerKey = `${ID.owner}/p35/owner-ready.webp`;
  const ownerFull = path.resolve(UPLOAD_DIR, ownerKey);
  mkdirSync(path.dirname(ownerFull), { recursive: true });
  writeFileSync(ownerFull, Buffer.from('ready-bytes'));

  const confirmKey = `${ID.owner}/p35/confirm-me.webp`;
  const confirmFull = path.resolve(UPLOAD_DIR, confirmKey);
  mkdirSync(path.dirname(confirmFull), { recursive: true });
  writeFileSync(confirmFull, Buffer.from('confirm-bytes'));

  await mongoose.connection.collection('media').insertMany([
    { _id: MD.owner, userId: ID.owner, category: 'avatar', key: ownerKey, url: `/media/${ownerKey}`, bytes: 11, mime: 'image/webp', status: 'ready', createdAt: now, updatedAt: now },
    { _id: MD.other, userId: ID.other, category: 'avatar', key: `${ID.other}/p35/other.webp`, url: `/media/${ID.other}/p35/other.webp`, bytes: 4, mime: 'image/webp', status: 'ready', createdAt: now, updatedAt: now },
    { _id: MD.pending, userId: ID.owner, category: 'avatar', key: confirmKey, url: `/media/${confirmKey}`, bytes: 0, mime: 'image/webp', status: 'pending', createdAt: now, updatedAt: now },
    { _id: MD.pendingOther, userId: ID.other, category: 'avatar', key: `${ID.other}/p35/pending.webp`, url: `/media/${ID.other}/p35/pending.webp`, bytes: 0, mime: 'image/webp', status: 'pending', createdAt: now, updatedAt: now },
  ]);

  console.log('Seeded P3.5 synthetic fixtures.');
}

async function main() {
  if (!/p3[5-9]_/.test(process.env.MONGODB_DB ?? '')) {
    console.error(`Refusing to run against MONGODB_DB=${process.env.MONGODB_DB}; expected a *p35–p39* test database.`);
    process.exit(1);
  }
  await seed();

  // ── Generic unauthenticated checks for every protected write route ────────
  const unauthRoutes: Array<[string, string, string]> = [
    ['W01', 'PUT', '/api/admin/card-templates'],
    ['W03', 'DELETE', `/api/admin/review-library/categories/${RC.tempDelete}`],
    ['W04', 'POST', '/api/admin/review-library/import/preview'],
    ['W05', 'POST', '/api/admin/review-library/import'],
    ['W06', 'POST', '/api/admin/review-library'],
    ['W07', 'DELETE', '/api/admin/review-library/templates/does-not-exist'],
    ['W08', 'DELETE', '/api/admin/standee-qr'],
    ['W09', 'PATCH', '/api/admin/templates/panthi-event'],
    ['W10', 'PUT', `/api/admin/users/${ID.owner}/products/${A.prem}/card`],
    ['W11', 'POST', `/api/admin/users/${ID.disposable}/products`],
    ['W12', 'DELETE', `/api/admin/users/${ID.disposable}/products`],
    ['W13', 'POST', `/api/admin/users/${ID.disposable}/reset-password`],
    ['W14', 'PATCH', `/api/admin/users/${ID.disposable}`],
    ['W15', 'PUT', `/api/admin/users/${ID.disposable}`],
    ['W16', 'POST', `/api/admin/users/${ID.disposable}/standy`],
    ['W17', 'DELETE', `/api/admin/users/${ID.disposable}/standy`],
    ['W18', 'PUT', `/api/admin/users/${ID.disposable}/templates`],
    ['W19', 'POST', '/api/admin/users'],
    ['W20', 'PATCH', `/api/appointments/${AP.owner}`],
    ['W26', 'POST', `/api/cards/${C.biz}/products`],
    ['W27', 'PATCH', `/api/cards/${C.biz}`],
    ['W28', 'DELETE', `/api/cards/${C.unassigned}`],
    ['W29', 'POST', '/api/cards'],
    ['W30', 'PATCH', '/api/customer/settings'],
    ['W31', 'PATCH', `/api/inquiries/${IQ.owner}`],
    ['W32', 'PATCH', `/api/my/products/${A.insta}/config`],
    ['W33', 'PATCH', `/api/my/products/${A.grc}`],
    ['W34', 'PATCH', `/api/product-enquiries/${PE.owner}`],
    ['W35', 'PATCH', `/api/products/${PR.grc}`],
    ['W36', 'DELETE', `/api/products/${PR.disposable}`],
    ['W37', 'PUT', '/api/profile/change-password'],
    ['W38', 'PUT', '/api/profile/social-links'],
    ['W50', 'PATCH', `/api/review-management/products/${A.grc}`],
    ['W51', 'PATCH', '/api/review-management'],
    ['W52', 'PATCH', '/api/settings'],
    ['W53', 'POST', '/api/uploads/confirm'],
    ['W54', 'POST', '/api/uploads/presign'],
    ['W55', 'POST', '/api/uploads'],
    ['W56', 'DELETE', '/api/uploads?key=x'],
  ];
  for (const [mid, method, route] of unauthRoutes) {
    await test(mid, `${mid}-UNAUTH`, method, route, 'security', 401, { body: {} });
  }

  // Generic customer token must be rejected on every admin route.
  const adminRoutes: Array<[string, string, string]> = [
    ['W01', 'PUT', '/api/admin/card-templates'],
    ['W03', 'DELETE', `/api/admin/review-library/categories/p35-nope`],
    ['W04', 'POST', '/api/admin/review-library/import/preview'],
    ['W05', 'POST', '/api/admin/review-library/import'],
    ['W06', 'POST', '/api/admin/review-library'],
    ['W07', 'DELETE', '/api/admin/review-library/templates/nope'],
    ['W08', 'DELETE', '/api/admin/standee-qr'],
    ['W09', 'PATCH', '/api/admin/templates/panthi-event'],
    ['W10', 'PUT', `/api/admin/users/${ID.owner}/products/${A.prem}/card`],
    ['W11', 'POST', `/api/admin/users/${ID.disposable}/products`],
    ['W12', 'DELETE', `/api/admin/users/${ID.disposable}/products`],
    ['W13', 'POST', `/api/admin/users/${ID.disposable}/reset-password`],
    ['W14', 'PATCH', `/api/admin/users/${ID.disposable}`],
    ['W15', 'PUT', `/api/admin/users/${ID.disposable}`],
    ['W16', 'POST', `/api/admin/users/${ID.disposable}/standy`],
    ['W17', 'DELETE', `/api/admin/users/${ID.disposable}/standy`],
    ['W18', 'PUT', `/api/admin/users/${ID.disposable}/templates`],
    ['W19', 'POST', '/api/admin/users'],
  ];
  for (const [mid, method, route] of adminRoutes) {
    await test(mid, `${mid}-ROLE`, method, route, 'security', 403, { token: TOKENS.owner, body: {} });
  }

  // ── W01 card templates ─────────────────────────────────────────────────────
  await test('W01', 'W01-P', 'PUT', '/api/admin/card-templates', 'positive', 200, {
    token: TOKENS.admin,
    body: { names: { 'panthi-event': 'P35 Event Template' } },
    verify: async () => {
      const doc = await SystemSettings.findOne({ key: 'global' }).lean<any>();
      return (doc as { cardTemplateNames?: Record<string, string> })?.cardTemplateNames?.['panthi-event'] === 'P35 Event Template';
    },
  });
  await dbCheck('W01 system settings template name persisted', async () => {
    const doc = await SystemSettings.findOne({ key: 'global' }).lean<any>();
    return (doc as { cardTemplateNames?: Record<string, string> })?.cardTemplateNames?.['panthi-event'] === 'P35 Event Template';
  });

  // ── W02 catalog create is intentionally disabled ──────────────────────────
  await test('W02', 'W02-P', 'POST', '/api/admin/catalog', 'positive', 403, {
    token: TOKENS.admin,
    body: { name: 'Should Not Exist' },
    note: 'Intentional design: catalog products are code-defined.',
    verify: async () => (await CatalogProduct.countDocuments({ name: 'Should Not Exist' })) === 0,
  });

  // ── W03 category delete ────────────────────────────────────────────────────
  await test('W03', 'W03-N1', 'DELETE', '/api/admin/review-library/categories/p35-temp-delete', 'negative', 409, {
    token: TOKENS.admin,
    note: 'Non-cascade delete blocked while templates reference the category.',
  });
  await test('W03', 'W03-P', 'DELETE', `/api/admin/review-library/categories/p35-temp-delete?cascade=true`, 'positive', 200, {
    token: TOKENS.admin,
    verify: async () => (await ReviewCategory.countDocuments({ key: 'p35-temp-delete' })) === 0 && (await ReviewTemplate.countDocuments({ key: 'p35-temp-delete-tpl' })) === 0,
  });
  await test('W03', 'W03-N2', 'DELETE', '/api/admin/review-library/categories/p35-temp-delete', 'negative', 404, { token: TOKENS.admin });

  // ── W04 import preview ─────────────────────────────────────────────────────
  const importBody = {
    categories: [{ key: 'p35-preview-only', name: 'P35 Preview Only', scenarios: [{ key: 'service', name: 'Service' }] }],
    templates: [{ key: 'p35-preview-tpl', categoryKey: 'p35-preview-only', scenario: 'service', language: 'English', text: 'Preview {businessName}.', length: 'short' }],
  };
  await test('W04', 'W04-P', 'POST', '/api/admin/review-library/import/preview', 'positive', 200, {
    token: TOKENS.admin,
    body: importBody,
    verify: async () => (await ReviewCategory.countDocuments({ key: 'p35-preview-only' })) === 0,
    note: 'Preview is read-only (verified no DB mutation).',
  });
  await test('W04', 'W04-N', 'POST', '/api/admin/review-library/import/preview', 'negative', 400, {
    token: TOKENS.admin,
    body: { categories: [{ key: 'BAD KEY' }] },
  });

  // ── W05 import ─────────────────────────────────────────────────────────────
  await test('W05', 'W05-P1', 'POST', '/api/admin/review-library/import', 'positive', 200, {
    token: TOKENS.admin,
    body: importBody,
    verify: async () => (await ReviewCategory.countDocuments({ key: 'p35-preview-only' })) === 1 && (await ReviewTemplate.countDocuments({ key: 'p35-preview-tpl' })) === 1,
  });
  await test('W05', 'W05-P2', 'POST', '/api/admin/review-library/import', 'positive', 200, {
    token: TOKENS.admin,
    body: {
      overwrite: true,
      categories: [],
      templates: [{ key: 'p35-preview-tpl', categoryKey: 'p35-preview-only', scenario: 'service', language: 'English', text: 'Overwritten {businessName}.', length: 'short' }],
    },
    verify: async () => (await ReviewTemplate.findOne({ key: 'p35-preview-tpl' }).lean<any>())?.text === 'Overwritten {businessName}.',
  });
  await test('W05', 'W05-N', 'POST', '/api/admin/review-library/import', 'negative', 400, {
    token: TOKENS.admin,
    raw: '{not-json',
  });

  // ── W06 review library upsert ──────────────────────────────────────────────
  await test('W06', 'W06-P1', 'POST', '/api/admin/review-library', 'positive', 201, {
    token: TOKENS.admin,
    body: { type: 'category', mode: 'create', payload: { key: 'p35-new-cat', name: 'P35 New Cat', scenarios: [{ key: 'service', name: 'Service' }] } },
  });
  await test('W06', 'W06-P2', 'POST', '/api/admin/review-library', 'positive', 200, {
    token: TOKENS.admin,
    body: { type: 'template', mode: 'create', payload: { key: 'p35-new-tpl', categoryKey: 'p35-new-cat', scenario: 'service', language: 'English', text: 'New template {businessName}.', length: 'short' } },
    verify: async () => (await ReviewTemplate.countDocuments({ key: 'p35-new-tpl' })) === 1,
  });
  await test('W06', 'W06-N1', 'POST', '/api/admin/review-library', 'negative', 409, {
    token: TOKENS.admin,
    body: { type: 'category', mode: 'create', payload: { key: 'p35-new-cat', name: 'Duplicate' } },
  });
  await test('W06', 'W06-N2', 'POST', '/api/admin/review-library', 'negative', 400, {
    token: TOKENS.admin,
    body: { type: 'template', mode: 'create', payload: { key: 'p35-bad-tpl', categoryKey: 'p35-new-cat', scenario: 'missing', language: 'English', text: 'Bad.', length: 'short' } },
  });

  // ── W07 template delete ────────────────────────────────────────────────────
  await test('W07', 'W07-P', 'DELETE', '/api/admin/review-library/templates/p35-new-tpl', 'positive', 200, {
    token: TOKENS.admin,
    verify: async () => (await ReviewTemplate.countDocuments({ key: 'p35-new-tpl' })) === 0,
  });
  await test('W07', 'W07-N', 'DELETE', '/api/admin/review-library/templates/p35-new-tpl', 'negative', 404, { token: TOKENS.admin });

  // ── W08 global standee delete ──────────────────────────────────────────────
  await test('W08', 'W08-N', 'DELETE', '/api/admin/standee-qr', 'negative', 400, { token: TOKENS.admin, body: {} });
  await test('W08', 'W08-P', 'DELETE', '/api/admin/standee-qr', 'positive', 200, {
    token: TOKENS.admin,
    body: { standeeId: S.deleted },
    verify: async () => (await Standee.countDocuments({ _id: S.deleted })) === 0 && (await UserProduct.findOne({ _id: A.disposableStandee }).lean<any>())?.status === 'removed',
  });

  // ── W09 template rename ────────────────────────────────────────────────────
  await test('W09', 'W09-P', 'PATCH', '/api/admin/templates/panthi-event', 'positive', 200, {
    token: TOKENS.admin,
    body: { name: 'P35 Renamed Template' },
    verify: async () => {
      const doc = await SystemSettings.findOne({ key: 'global' }).lean<any>();
      return (doc as { cardTemplateNames?: Record<string, string> })?.cardTemplateNames?.['panthi-event'] === 'P35 Renamed Template';
    },
  });
  await test('W09', 'W09-N1', 'PATCH', '/api/admin/templates/panthi-event', 'negative', 400, { token: TOKENS.admin, body: { name: '   ' } });
  await test('W09', 'W09-N2', 'PATCH', '/api/admin/templates/not-a-template', 'negative', 404, { token: TOKENS.admin, body: { name: 'Nope' } });

  // ── W10 physical card replacement ──────────────────────────────────────────
  await test('W10', 'W10-N1', 'PUT', `/api/admin/users/${ID.owner}/products/${A.prem}/card`, 'negative', 409, {
    token: TOKENS.admin,
    body: { cardUid: 'P35-BUSINESS' },
    note: 'UID already bound to another card.',
  });
  await test('W10', 'W10-P', 'PUT', `/api/admin/users/${ID.owner}/products/${A.prem}/card`, 'positive', 200, {
    token: TOKENS.admin,
    body: { cardUid: 'P35-PREMIUM-NEW' },
    verify: async () => {
      const card = await Card.findById(C.prem).lean<any>();
      return card?.cardUid === 'P35-PREMIUM-NEW' && (card?.previousCardUids ?? []).includes('P35-PREMIUM');
    },
  });

  // ── W11 admin product assignment ───────────────────────────────────────────
  await test('W11', 'W11-N1', 'POST', `/api/admin/users/${ID.disposable}/products`, 'negative', 404, {
    token: TOKENS.admin,
    body: { catalogProductId: oid('999'), quantity: 1 },
  });
  await test('W11', 'W11-N2', 'POST', `/api/admin/users/${ID.disposable}/products`, 'negative', 400, {
    token: TOKENS.admin,
    body: { catalogProductId: P.inactive, quantity: 1 },
  });
  let disposableCardId = '';
  await test('W11', 'W11-P', 'POST', `/api/admin/users/${ID.disposable}/products`, 'positive', 201, {
    token: TOKENS.admin,
    body: { catalogProductId: P.insta, quantity: 1 },
    verify: async (r) => {
      const body = r.json as { card?: { _id?: string }; userProduct?: { _id?: string; cardId?: string } };
      disposableCardId = String(body?.userProduct?.cardId ?? body?.card?._id ?? '');
      return Boolean(disposableCardId) && Boolean(body?.userProduct?._id) && (await UserProduct.countDocuments({ userId: ID.disposable, catalogProductId: P.insta, status: 'active' })) === 1;
    },
  });
  const disposableAssignment = (await UserProduct.findOne({ userId: ID.disposable, catalogProductId: P.insta, status: 'active' }).lean<any>())?._id;
  const disposableCard = await Card.findById(disposableCardId).lean<any>();
  await test('W11', 'W11-N3', 'POST', `/api/admin/users/${ID.disposable}/products`, 'negative', 409, {
    token: TOKENS.admin,
    body: { catalogProductId: P.insta, quantity: 1, cardUid: disposableCard?.cardUid },
    note: 'Same physical card cannot create a second active assignment.',
  });

  // ── W12 assignment removal ─────────────────────────────────────────────────
  await test('W12', 'W12-N1', 'DELETE', `/api/admin/users/${ID.owner}/products`, 'negative', 404, {
    token: TOKENS.admin,
    body: { userProductId: disposableAssignment },
    note: 'Right assignment, wrong owner.',
  });
  await test('W12', 'W12-P', 'DELETE', `/api/admin/users/${ID.disposable}/products`, 'positive', 200, {
    token: TOKENS.admin,
    body: { userProductId: disposableAssignment },
    verify: async () => (await UserProduct.findOne({ _id: disposableAssignment }).lean<any>())?.status === 'removed',
  });

  // ── W13 admin reset password ───────────────────────────────────────────────
  await test('W13', 'W13-N1', 'POST', `/api/admin/users/${ID.disposable}/reset-password`, 'negative', 400, {
    token: TOKENS.admin,
    body: { mode: 'temp' },
  });
  await test('W13', 'W13-N2', 'POST', `/api/admin/users/${ID.suspended}/reset-password`, 'negative', 400, {
    token: TOKENS.admin,
    body: { mode: 'temp', password: 'TempPass123!' },
  });
  await test('W13', 'W13-P', 'POST', `/api/admin/users/${ID.disposable}/reset-password`, 'positive', 200, {
    token: TOKENS.admin,
    body: { mode: 'temp', password: 'TempPass123!' },
    verify: async () => {
      const login = await call('POST', '/api/auth/login', { body: { email: 'disposable@p35.test', password: 'TempPass123!' } });
      return login.status === 200;
    },
  });

  // ── W14 admin user credentials ─────────────────────────────────────────────
  await test('W14', 'W14-N1', 'PATCH', `/api/admin/users/${ID.disposable}`, 'negative', 409, {
    token: TOKENS.admin,
    body: { email: 'owner@p35.test' },
  });
  await test('W14', 'W14-N2', 'PATCH', `/api/admin/users/${ID.disposable}`, 'negative', 400, {
    token: TOKENS.admin,
    body: { email: 'not-an-email' },
  });
  await test('W14', 'W14-P', 'PATCH', `/api/admin/users/${ID.disposable}`, 'positive', 200, {
    token: TOKENS.admin,
    body: { name: 'P35 Disposable Renamed' },
    verify: async () => (await User.findById(ID.disposable).lean<any>())?.name === 'P35 Disposable Renamed',
  });

  // ── W15 admin status/delete ────────────────────────────────────────────────
  await test('W15', 'W15-P1', 'PUT', `/api/admin/users/${ID.disposable}`, 'positive', 200, {
    token: TOKENS.admin,
    body: { action: 'updateStatus', status: 'suspended' },
    verify: async () => {
      const user = await User.findById(ID.disposable).lean<any>();
      const card = await Card.findById(disposableCardId).lean<any>();
      return user?.status === 'suspended' && card?.status === 'suspended';
    },
  });
  await test('W15', 'W15-P2', 'PUT', `/api/admin/users/${ID.disposable}`, 'positive', 200, {
    token: TOKENS.admin,
    body: { action: 'updateStatus', status: 'active' },
    verify: async () => (await User.findById(ID.disposable).lean<any>())?.status === 'active',
  });
  await test('W15', 'W15-P3', 'PUT', `/api/admin/users/${ID.disposable2}`, 'positive', 200, {
    token: TOKENS.admin,
    body: { action: 'delete' },
    verify: async () => {
      const user = await User.countDocuments({ _id: ID.disposable2 });
      const card = await Card.findById(C.disposable2).lean<any>();
      const profile = await Profile.countDocuments({ userId: ID.disposable2 });
      return user === 0 && profile === 0 && card?.assignedUserId === null && card?.status === 'unassigned';
    },
  });
  await test('W15', 'W15-N', 'PUT', `/api/admin/users/${ID.disposable}`, 'negative', 400, {
    token: TOKENS.admin,
    body: { action: 'explode' },
  });

  // ── W16/W17 standee assignment ─────────────────────────────────────────────
  await test('W16', 'W16-N1', 'POST', `/api/admin/users/${ID.disposable}/standy`, 'negative', 400, {
    token: TOKENS.admin,
    body: { catalogProductId: P.biz },
  });
  await test('W16', 'W16-N2', 'POST', `/api/admin/users/${ID.disposable}/standy`, 'negative', 404, {
    token: TOKENS.admin,
    body: { catalogProductId: oid('998') },
  });
  let createdStandeeId = '';
  await test('W16', 'W16-P', 'POST', `/api/admin/users/${ID.disposable}/standy`, 'positive', 201, {
    token: TOKENS.admin,
    body: { catalogProductId: P.standee },
    verify: async (r) => {
      const body = r.json as { standee?: { _id?: string } };
      createdStandeeId = String(body?.standee?._id ?? '');
      return Boolean(createdStandeeId) && (await Standee.countDocuments({ _id: createdStandeeId })) === 1;
    },
  });
  await test('W17', 'W17-P', 'DELETE', `/api/admin/users/${ID.disposable}/standy`, 'positive', 200, {
    token: TOKENS.admin,
    body: { standeeId: createdStandeeId },
    verify: async () => (await Standee.countDocuments({ _id: createdStandeeId })) === 0,
  });
  await test('W17', 'W17-N', 'DELETE', `/api/admin/users/${ID.disposable}/standy`, 'negative', 404, {
    token: TOKENS.admin,
    body: { standeeId: createdStandeeId },
  });

  // ── W18 allowed templates ──────────────────────────────────────────────────
  await test('W18', 'W18-N', 'PUT', `/api/admin/users/${ID.disposable}/templates`, 'negative', 400, {
    token: TOKENS.admin,
    body: { allowedTemplates: ['not-registered'] },
  });
  await test('W18', 'W18-P', 'PUT', `/api/admin/users/${ID.disposable}/templates`, 'positive', 200, {
    token: TOKENS.admin,
    body: { allowedTemplates: ['panthi-event', 'professional-profile'] },
    verify: async () => {
      const profile = await Profile.findOne({ userId: ID.disposable }).lean<any>();
      const allowed = (profile as { allowedTemplates?: string[] })?.allowedTemplates ?? [];
      return allowed.includes('panthi-event') && allowed.includes('professional-profile');
    },
  });

  // ── W19 admin customer creation ────────────────────────────────────────────
  await test('W19', 'W19-N1', 'POST', '/api/admin/users', 'negative', 409, {
    token: TOKENS.admin,
    body: { name: 'Duplicate', email: 'owner@p35.test', password: 'ValidPass123!', products: [{ catalogProductId: P.biz }] },
  });
  await test('W19', 'W19-N2', 'POST', '/api/admin/users', 'negative', 400, {
    token: TOKENS.admin,
    body: { name: 'No Product', email: 'noproduct@p35.test', password: 'ValidPass123!', products: [{ catalogProductId: oid('997') }] },
  });
  await test('W19', 'W19-P', 'POST', '/api/admin/users', 'positive', 201, {
    token: TOKENS.admin,
    body: { name: 'P35 Created Customer', email: 'created-customer@p35.test', password: 'ValidPass123!', products: [{ catalogProductId: P.biz, quantity: 1 }] },
    verify: async () => {
      const user = await User.findOne({ email: 'created-customer@p35.test' }).lean<any>();
      if (!user) return false;
      const profile = await Profile.findOne({ userId: user._id }).lean<any>();
      const cards = await Card.countDocuments({ userId: user._id, assignedUserId: user._id });
      return Boolean(profile) && cards === 1;
    },
  });

  // ── W20 appointment transition ─────────────────────────────────────────────
  await test('W20', 'W20-N1', 'PATCH', `/api/appointments/${AP.owner}`, 'negative', 403, {
    token: TOKENS.other,
    body: { status: 'confirmed' },
  });
  await test('W20', 'W20-N2', 'PATCH', '/api/appointments/not-an-id', 'negative', 404, {
    token: TOKENS.owner,
    body: { status: 'confirmed' },
  });
  await test('W20', 'W20-P', 'PATCH', `/api/appointments/${AP.owner}`, 'positive', 200, {
    token: TOKENS.owner,
    body: { status: 'confirmed' },
    verify: async () => (await Appointment.findById(AP.owner).lean<any>())?.status === 'confirmed',
  });
  await test('W20', 'W20-N3', 'PATCH', `/api/appointments/${AP.owner}`, 'negative', 400, {
    token: TOKENS.owner,
    body: { status: 'pending' },
    note: 'Illegal reverse transition.',
  });

  // ── W21 forgot password ────────────────────────────────────────────────────
  let forgotKnown = '';
  await test('W21', 'W21-P1', 'POST', '/api/auth/forgot-password', 'positive', 200, {
    body: { email: 'owner@p35.test' },
    verify: (r) => {
      forgotKnown = r.text;
      return true;
    },
  });
  await test('W21', 'W21-P2', 'POST', '/api/auth/forgot-password', 'positive', 200, {
    body: { email: 'nobody@p35.test' },
    verify: (r) => r.text === forgotKnown,
    note: 'Enumeration-safe identical response.',
  });
  await test('W21', 'W21-N', 'POST', '/api/auth/forgot-password', 'negative', 400, { body: { email: 'bad' } });

  // ── W22 login ──────────────────────────────────────────────────────────────
  let loginToken = '';
  await test('W22', 'W22-P', 'POST', '/api/auth/login', 'positive', 200, {
    body: { email: 'owner@p35.test', password: OWNER_PASSWORD },
    verify: (r) => {
      const cookie = r.headers.get('set-cookie') ?? '';
      loginToken = /token=([^;]+)/.exec(cookie)?.[1] ?? '';
      return Boolean(loginToken) && !r.text.includes('passwordHash');
    },
  });
  await test('W22', 'W22-N1', 'POST', '/api/auth/login', 'negative', 401, { body: { email: 'owner@p35.test', password: 'wrong-password' } });
  await test('W22', 'W22-N2', 'POST', '/api/auth/login', 'negative', 401, { body: { email: 'ghost@p35.test', password: 'whatever' } });
  await test('W22', 'W22-N3', 'POST', '/api/auth/login', 'negative', 400, { body: { email: 'owner@p35.test' } });
  await test('W22', 'W22-S1', 'POST', '/api/auth/login', 'security', 403, { body: { email: 'suspended@p35.test', password: 'SuspendedPass123!' } });

  // ── W23 logout ─────────────────────────────────────────────────────────────
  await test('W23', 'W23-P', 'POST', '/api/auth/logout', 'positive', 200, {
    token: loginToken,
    verify: (r) => /token=;/.test(r.headers.get('set-cookie') ?? '') || /Max-Age=0/i.test(r.headers.get('set-cookie') ?? ''),
  });

  // ── W24 register ───────────────────────────────────────────────────────────
  await test('W24', 'W24-N1', 'POST', '/api/auth/register', 'negative', 409, {
    body: { name: 'Dup', email: 'owner@p35.test', password: 'ValidPass123!' },
  });
  await test('W24', 'W24-N2', 'POST', '/api/auth/register', 'negative', 400, {
    body: { name: 'Weak', email: 'weak@p35.test', password: 'short' },
  });
  await test('W24', 'W24-P', 'POST', '/api/auth/register', 'positive', 201, {
    body: { name: 'P35 Registered', email: 'registered@p35.test', password: 'ValidPass123!' },
    verify: async () => (await User.countDocuments({ email: 'registered@p35.test' })) === 1,
  });

  // ── W25 reset password ─────────────────────────────────────────────────────
  const minted = await mintResetToken(String(ID.owner));
  await test('W25', 'W25-N', 'POST', '/api/auth/reset-password', 'negative', 400, {
    body: { token: 'invalid-token', newPassword: 'ValidPass123!' },
  });
  await test('W25', 'W25-P', 'POST', '/api/auth/reset-password', 'positive', 200, {
    body: { token: minted.token, newPassword: 'ResetPass123!' },
    verify: async () => {
      const login = await call('POST', '/api/auth/login', { body: { email: 'owner@p35.test', password: 'ResetPass123!' } });
      if (login.status !== 200) return false;
      // restore the fixture password for the remaining tests
      const restore = await call('PUT', '/api/profile/change-password', { token: TOKENS.owner, body: { currentPassword: 'ResetPass123!', newPassword: OWNER_PASSWORD } });
      return restore.status === 200;
    },
  });

  // ── W26 card catalogue product create ──────────────────────────────────────
  await test('W26', 'W26-N1', 'POST', `/api/cards/${C.other}/products`, 'negative', 403, {
    token: TOKENS.owner,
    body: { title: 'Cross Tenant', priceMinor: 100 },
  });
  await test('W26', 'W26-N2', 'POST', `/api/cards/${C.biz}/products`, 'negative', 400, {
    token: TOKENS.owner,
    body: { priceMinor: 100 },
  });
  await test('W26', 'W26-P', 'POST', `/api/cards/${C.biz}/products`, 'positive', 201, {
    token: TOKENS.owner,
    body: { title: 'P35 Card Product', priceMinor: 2500, currency: 'INR' },
    verify: async () => (await Product.countDocuments({ cardId: C.biz, title: 'P35 Card Product' })) === 1,
  });

  // ── W27 card update ────────────────────────────────────────────────────────
  await test('W27', 'W27-N1', 'PATCH', `/api/cards/${C.grc}`, 'negative', 403, {
    token: TOKENS.owner,
    note: 'urlAlias is immutable after creation and cannot be reassigned.',
    body: { urlAlias: 'p35-other' },
  });
  await test('W27', 'W27-P0', 'PATCH', `/api/cards/${C.grc}`, 'positive', 200, {
    token: TOKENS.owner,
    note: 'Idempotent same-value alias is tolerated for legacy clients.',
    body: { urlAlias: 'p35-grc' },
    verify: async () => {
      const card = await Card.findById(C.grc).lean<any>();
      return card?.urlAlias === 'p35-grc';
    },
  });
  await test('W27', 'W27-N2', 'PATCH', `/api/cards/${C.grc}`, 'negative', 403, {
    token: TOKENS.owner,
    body: { kind: 'profile' },
  });
  await test('W27', 'W27-N3', 'PATCH', `/api/cards/${C.grc}`, 'negative', 400, {
    token: TOKENS.owner,
    body: { themeConfig: { accentColor: 'red' } },
  });
  await test('W27', 'W27-P', 'PATCH', `/api/cards/${C.grc}`, 'positive', 200, {
    token: TOKENS.owner,
    body: { name: 'P35 Updated Review Card', config: { hideStickyBar: true } },
    verify: async () => {
      const card = await Card.findById(C.grc).lean<any>();
      return card?.name === 'P35 Updated Review Card' && card?.config?.hideStickyBar === true;
    },
  });

  // ── W28 card delete ────────────────────────────────────────────────────────
  await test('W28', 'W28-N1', 'DELETE', `/api/cards/${C.guarded}`, 'negative', 403, {
    token: TOKENS.owner,
    note: 'Assigned cards cannot be deleted by customers.',
  });
  await test('W28', 'W28-P1', 'DELETE', `/api/cards/${C.unassigned}`, 'positive', 200, {
    token: TOKENS.admin,
    verify: async () => (await Card.countDocuments({ _id: C.unassigned })) === 0,
  });
  await test('W28', 'W28-P2', 'DELETE', `/api/cards/${C.guarded}`, 'positive', 200, {
    token: TOKENS.admin,
    body: {},
    verify: async () => (await Card.countDocuments({ _id: C.guarded })) === 0,
    note: 'Admin deletes a disposable assigned card; synthetic fixture only.',
  });
  await test('W28', 'W28-N2', 'DELETE', `/api/cards/${C.guarded}`, 'negative', 404, { token: TOKENS.admin });

  // ── W29 card create ────────────────────────────────────────────────────────
  await test('W29', 'W29-N', 'POST', '/api/cards', 'negative', 403, {
    token: TOKENS.owner,
    body: { name: 'Customer Card' },
  });
  await test('W29', 'W29-P', 'POST', '/api/cards', 'positive', 201, {
    token: TOKENS.admin,
    body: { name: 'P35 Admin Card', urlAlias: 'p35-admin-card' },
    verify: async () => {
      const card = await Card.findOne({ urlAlias: 'p35-admin-card' }).lean<any>();
      // Permanent route must be minted at creation, never later.
      return Boolean(card && card.routeSlug && card.uid === card.routeSlug);
    },
  });

  // ── W30 customer settings ──────────────────────────────────────────────────
  await test('W30', 'W30-N', 'PATCH', '/api/customer/settings', 'negative', 400, { token: TOKENS.owner, body: { isNewsletterEnabled: 'yes' } });
  await test('W30', 'W30-P', 'PATCH', '/api/customer/settings', 'positive', 200, {
    token: TOKENS.owner,
    body: { isNewsletterEnabled: true },
    verify: async () => (await User.findById(ID.owner).lean<any>())?.isNewsletterEnabled === true,
  });

  // ── W31 inquiry transition ─────────────────────────────────────────────────
  await test('W31', 'W31-N1', 'PATCH', `/api/inquiries/${IQ.other}`, 'negative', 403, { token: TOKENS.owner, body: { status: 'contacted' } });
  await test('W31', 'W31-N2', 'PATCH', `/api/inquiries/${IQ.owner}`, 'negative', 400, { token: TOKENS.owner, body: { status: 'won' } });
  await test('W31', 'W31-P', 'PATCH', `/api/inquiries/${IQ.owner}`, 'positive', 200, {
    token: TOKENS.owner,
    body: { status: 'contacted', note: 'P35 follow-up' },
    verify: async () => {
      const inquiry = await Inquiry.findById(IQ.owner).lean<any>();
      return inquiry?.status === 'contacted' && (inquiry?.notes ?? []).some((n: { text?: string }) => n.text === 'P35 follow-up');
    },
  });

  // ── W32 product config ─────────────────────────────────────────────────────
  await test('W32', 'W32-N1', 'PATCH', `/api/my/products/${A.other}/config`, 'negative', 404, {
    token: TOKENS.owner,
    body: { destinationUrl: 'https://example.test/x' },
  });
  await test('W32', 'W32-N2', 'PATCH', `/api/my/products/${A.insta}/config`, 'negative', 400, {
    token: TOKENS.owner,
    body: { destinationUrl: 'javascript:alert(1)' },
  });
  await test('W32', 'W32-P1', 'PATCH', `/api/my/products/${A.insta}/config`, 'positive', 200, {
    token: TOKENS.owner,
    body: { destinationUrl: 'https://example.test/insta-updated' },
    verify: async () => (await Card.findById(C.insta).lean<any>())?.redirectUrl === 'https://example.test/insta-updated',
  });
  await test('W32', 'W32-P2', 'PATCH', `/api/my/products/${A.grc}/config`, 'positive', 200, {
    token: TOKENS.owner,
    body: { googleReview: { googleReviewUrl: 'https://example.test/grc-updated', businessName: 'P35 Owner Co' } },
    verify: async () => {
      const card = await Card.findById(C.grc).lean<any>();
      return card?.reviewAssistant?.googleReviewUrl === 'https://example.test/grc-updated' && card?.reviewAssistant?.enabled === true;
    },
  });

  // ── W33 product rename ─────────────────────────────────────────────────────
  await test('W33', 'W33-N', 'PATCH', `/api/my/products/${A.other}`, 'negative', 404, { token: TOKENS.owner, body: { title: 'Nope' } });
  await test('W33', 'W33-P', 'PATCH', `/api/my/products/${A.grc}`, 'positive', 200, {
    token: TOKENS.owner,
    body: { title: 'P35 Renamed Review Product' },
    verify: async () => {
      const card = await Card.findById(C.grc).lean<any>();
      const log = await mongoose.connection.collection('producttitlelogs').findOne({ userProductId: A.grc, newTitle: 'P35 Renamed Review Product' });
      return card?.cardLabel === 'P35 Renamed Review Product' && Boolean(log);
    },
  });

  // ── W34 product enquiry status ─────────────────────────────────────────────
  await test('W34', 'W34-N1', 'PATCH', `/api/product-enquiries/${PE.other}`, 'negative', 403, { token: TOKENS.owner, body: { status: 'contacted' } });
  await test('W34', 'W34-P', 'PATCH', `/api/product-enquiries/${PE.owner}`, 'positive', 200, {
    token: TOKENS.owner,
    body: { status: 'contacted' },
    verify: async () => (await ProductEnquiry.findById(PE.owner).lean<any>())?.status === 'contacted',
  });
  await test('W34', 'W34-N2', 'PATCH', `/api/product-enquiries/${PE.owner}`, 'negative', 400, {
    token: TOKENS.owner,
    body: { status: 'bogus' },
  });

  // ── W35 product update ─────────────────────────────────────────────────────
  await test('W35', 'W35-N1', 'PATCH', `/api/products/${PR.other}`, 'negative', 403, { token: TOKENS.owner, body: { title: 'Hijack' } });
  await test('W35', 'W35-N2', 'PATCH', `/api/products/${PR.grc}`, 'negative', 400, { token: TOKENS.owner, body: { priceMinor: -1 } });
  await test('W35', 'W35-P', 'PATCH', `/api/products/${PR.grc}`, 'positive', 200, {
    token: TOKENS.owner,
    body: { title: 'P35 Product Updated', priceMinor: 2000 },
    verify: async () => {
      const product = await Product.findById(PR.grc).lean<any>();
      return product?.title === 'P35 Product Updated' && product?.priceMinor === 2000;
    },
  });

  // ── W36 product delete ─────────────────────────────────────────────────────
  await test('W36', 'W36-P', 'DELETE', `/api/products/${PR.disposable}`, 'positive', 200, {
    token: TOKENS.owner,
    verify: async () => (await Product.countDocuments({ _id: PR.disposable })) === 0,
  });
  await test('W36', 'W36-N', 'DELETE', `/api/products/${PR.disposable}`, 'negative', 404, { token: TOKENS.owner });

  // ── W37 change password ────────────────────────────────────────────────────
  await test('W37', 'W37-N', 'PUT', '/api/profile/change-password', 'negative', 400, {
    token: TOKENS.owner,
    body: { currentPassword: 'wrong', newPassword: 'AnotherPass123!' },
  });
  await test('W37', 'W37-P1', 'PUT', '/api/profile/change-password', 'positive', 200, {
    token: TOKENS.owner,
    body: { currentPassword: OWNER_PASSWORD, newPassword: NEW_PASSWORD },
    verify: async () => (await call('POST', '/api/auth/login', { body: { email: 'owner@p35.test', password: NEW_PASSWORD } })).status === 200,
  });
  await test('W37', 'W37-P2', 'PUT', '/api/profile/change-password', 'positive', 200, {
    token: TOKENS.owner,
    body: { currentPassword: NEW_PASSWORD, newPassword: OWNER_PASSWORD },
    note: 'Restore fixture password.',
  });

  // ── W38 social links ───────────────────────────────────────────────────────
  await test('W38', 'W38-N1', 'PUT', '/api/profile/social-links', 'negative', 403, {
    token: TOKENS.other,
    body: { socialLinks: [{ platform: 'instagram', url: 'https://example.test/i' }] },
  });
  await test('W38', 'W38-N2', 'PUT', '/api/profile/social-links', 'negative', 400, {
    token: TOKENS.owner,
    body: { socialLinks: 'nope' },
  });
  await test('W38', 'W38-P', 'PUT', '/api/profile/social-links', 'positive', 200, {
    token: TOKENS.owner,
    body: { socialLinks: [{ platform: 'instagram', url: 'https://example.test/instagram' }, { platform: 'google_review', url: 'https://example.test/google' }] },
    verify: async () => {
      const profile = await Profile.findOne({ userId: ID.owner }).lean<any>();
      return (profile?.socialLinks ?? []).length === 2;
    },
  });

  // ── W39 public appointment booking ─────────────────────────────────────────
  await test('W39', 'W39-N1', 'POST', '/api/public/cards/p35-grc/appointments', 'negative', 400, {
    body: { visitorName: 'V', visitorEmail: 'bad', date: '2027-06-15', slot: '10:00 AM' },
  });
  await test('W39', 'W39-N2', 'POST', '/api/public/cards/nope-alias/appointments', 'negative', 404, {
    body: { visitorName: 'V', visitorEmail: 'v@example.test', date: '2027-06-15', slot: '10:00 AM' },
  });
  await test('W39', 'W39-P', 'POST', '/api/public/cards/p35-grc/appointments', 'positive', 201, {
    body: { visitorName: 'P35 Booking', visitorEmail: 'booking@p35.test', date: '2027-06-15', slot: '11:00 AM', note: 'synthetic' },
    verify: async () => (await Appointment.countDocuments({ cardId: C.grc, visitorEmail: 'booking@p35.test', slot: '11:00 AM' })) === 1,
  });
  await test('W39', 'W39-N3', 'POST', '/api/public/cards/p35-grc/appointments', 'negative', 400, {
    body: { visitorName: 'P35 Duplicate', visitorEmail: 'booking2@p35.test', date: '2027-06-15', slot: '11:00 AM' },
    note: 'Slot already taken → slot-unavailable validation.',
  });

  // ── W40 public inquiry ─────────────────────────────────────────────────────
  await test('W40', 'W40-N1', 'POST', '/api/public/cards/p35-grc/inquiries', 'negative', 400, { body: { email: 'x@example.test' } });
  await test('W40', 'W40-N2', 'POST', '/api/public/cards/nope-alias/inquiries', 'negative', 404, { body: { name: 'X' } });
  await test('W40', 'W40-P', 'POST', '/api/public/cards/p35-grc/inquiries', 'positive', 201, {
    body: { name: 'P35 Public Lead', email: 'public-lead@p35.test', message: 'Synthetic enquiry', source: 'contact_form' },
    verify: async () => (await Inquiry.countDocuments({ cardId: C.grc, name: 'P35 Public Lead' })) === 1,
  });

  // ── W41 newsletter ─────────────────────────────────────────────────────────
  await test('W41', 'W41-N', 'POST', '/api/public/cards/p35-grc/newsletter', 'negative', 400, { body: { email: 'bad' } });
  await test('W41', 'W41-P1', 'POST', '/api/public/cards/p35-grc/newsletter', 'positive', 201, {
    body: { email: 'subscriber@p35.test' },
    verify: async () => (await mongoose.connection.collection('newslettersubscribers').countDocuments({ cardId: C.grc, email: 'subscriber@p35.test' })) === 1,
  });
  await test('W41', 'W41-P2', 'POST', '/api/public/cards/p35-grc/newsletter', 'positive', 200, {
    body: { email: 'subscriber@p35.test' },
    verify: (r) => Boolean((r.json as { alreadySubscribed?: boolean })?.alreadySubscribed),
  });

  // ── W42 product enquiry ────────────────────────────────────────────────────
  await test('W42', 'W42-N', 'POST', '/api/public/cards/p35-grc/product-enquiries', 'negative', 404, {
    body: { productId: PR.other, name: 'X' },
  });
  await test('W42', 'W42-P', 'POST', '/api/public/cards/p35-grc/product-enquiries', 'positive', 201, {
    body: { productId: PR.grc, name: 'P35 Buyer', note: 'Synthetic' },
    verify: async () => {
      const product = await Product.findById(PR.grc).lean<any>();
      return (await ProductEnquiry.countDocuments({ cardId: C.grc, name: 'P35 Buyer' })) === 1 && product?.enquiryCount === 1;
    },
  });

  // ── W43 review copied ──────────────────────────────────────────────────────
  await test('W43', 'W43-N', 'POST', '/api/public/reviews/p35-grc/copied', 'negative', 400, {
    body: { templateId: '000000000000000000000000', copyId: 'short' },
  });
  await test('W43', 'W43-P1', 'POST', '/api/public/reviews/p35-grc/copied', 'positive', 201, {
    body: { templateId: RT.core, copyId: 'p35-copy-id-0001' },
    verify: async () => (await mongoose.connection.collection('reviewrotationevents').countDocuments({ copyId: 'p35-copy-id-0001' })) === 1,
  });
  await test('W43', 'W43-P2', 'POST', '/api/public/reviews/p35-grc/copied', 'positive', 200, {
    body: { templateId: RT.core, copyId: 'p35-copy-id-0001' },
    verify: (r) => Boolean((r.json as { duplicate?: boolean })?.duplicate),
    note: 'Idempotent duplicate copy.',
  });

  // ── W44 AI generate fallback (no live provider) ────────────────────────────
  await test('W44', 'W44-N', 'POST', '/api/public/reviews/p35-grc/generate', 'negative', 400, {
    body: { feedback: 'x' },
  });
  await test('W44', 'W44-P', 'POST', '/api/public/reviews/p35-grc/generate', 'positive', 503, {
    body: { feedback: 'The coffee was excellent and the staff were kind.' },
    verify: (r) => Boolean((r.json as { code?: string })?.code === 'UNAVAILABLE'),
    note: 'AI unconfigured → clean 503, no provider call.',
  });

  // ── W45 suggestions ────────────────────────────────────────────────────────
  await test('W45', 'W45-N', 'POST', '/api/public/reviews/nope-alias/suggestions', 'negative', 404, { body: {} });
  await test('W45', 'W45-P', 'POST', '/api/public/reviews/p35-grc/suggestions', 'positive', 200, {
    body: { init: true, language: 'English', length: 'short' },
    verify: async (r) => {
      const body = r.json as { mode?: string; suggestions?: unknown[] };
      const logged = await mongoose.connection.collection('analyticslogs').countDocuments({ cardId: C.grc, action: 'review_suggestions_shown' });
      return body?.mode === 'template' && (body?.suggestions?.length ?? 0) > 0 && logged > 0;
    },
  });

  // ── W46-W48 Standee review APIs (gate OFF expected denial) ────────────────
  await test('W46', 'W46-GATE', 'POST', '/api/public/standee-reviews/p35-standee/copied', 'negative', 404, {
    body: { templateId: RT.core, copyId: 'p35-standee-copy-0001' },
    note: 'STANDEE_REVIEW_ASSISTANT_ENABLED=false → legacy redirect path preserved.',
  });
  await test('W47', 'W47-GATE', 'POST', '/api/public/standee-reviews/p35-standee/generate', 'negative', 404, {
    body: { feedback: 'The service was great.' },
    note: 'Gate OFF.',
  });
  await test('W48', 'W48-GATE', 'POST', '/api/public/standee-reviews/p35-standee/suggestions', 'negative', 404, {
    body: {},
    note: 'Gate OFF.',
  });

  if (STANDEE_BASE) {
    await test('W46', 'W46-P', 'POST', '/api/public/standee-reviews/p35-standee/copied', 'positive', 201, {
      base: STANDEE_BASE,
      body: { templateId: RT.core, copyId: 'p35-standee-copy-0001' },
      verify: async () => (await mongoose.connection.collection('reviewrotationevents').countDocuments({ copyId: 'p35-standee-copy-0001' })) === 1,
    });
    await test('W47', 'W47-P', 'POST', '/api/public/standee-reviews/p35-standee/generate', 'positive', 503, {
      base: STANDEE_BASE,
      body: { feedback: 'The service was great and quick.' },
      verify: (r) => (r.json as { code?: string })?.code === 'UNAVAILABLE',
    });
    await test('W48', 'W48-P', 'POST', '/api/public/standee-reviews/p35-standee/suggestions', 'positive', 200, {
      base: STANDEE_BASE,
      body: { init: true },
      verify: (r) => (r.json as { mode?: string; data?: { mode?: string } })?.mode === 'template' || (r.json as { data?: { mode?: string } })?.data?.mode === 'template',
    });
  }

  // ── W49 tracking ───────────────────────────────────────────────────────────
  await test('W49', 'W49-N', 'POST', '/api/public/track', 'negative', 200, {
    body: { action: 'not-an-action' },
    verify: (r) => Boolean((r.json as { skipped?: boolean })?.skipped),
    note: 'Invalid payload is silently skipped by contract.',
  });
  const tapsBefore = (await Card.findById(C.biz).lean<any>())?.stats?.taps ?? 0;
  await test('W49', 'W49-P', 'POST', '/api/public/track', 'positive', 202, {
    body: { alias: 'p35-business', action: 'tap', metadata: 'p35' },
    verify: async () => {
      const after = (await Card.findById(C.biz).lean<any>())?.stats?.taps ?? 0;
      const logged = await mongoose.connection.collection('analyticslogs').countDocuments({ cardId: C.biz, action: 'tap' });
      return after === tapsBefore + 1 && logged >= 1;
    },
  });

  // ── W51 central review settings (needed before W50) ────────────────────────
  await test('W51', 'W51-N1', 'PATCH', '/api/review-management', 'negative', 400, { token: TOKENS.owner, body: {} });
  await test('W51', 'W51-N2', 'PATCH', '/api/review-management', 'negative', 400, {
    token: TOKENS.owner,
    raw: '{"__proto__":{"polluted":true},"general":{"enabled":true}}',
  });
  let centralRevision = 0;
  await test('W51', 'W51-P', 'PATCH', '/api/review-management', 'positive', 200, {
    token: TOKENS.owner,
    body: {
      general: { enabled: true, googleReviewUrl: 'https://example.test/central' },
      content: { category: 'cafe', languages: ['English'], writingStyle: 'friendly', preferredLength: 'short' },
    },
    verify: async (r) => {
      const body = r.json as { revision?: string | number; data?: { revision?: string | number } };
      centralRevision = Number(body?.revision ?? body?.data?.revision ?? 0);
      const settings = await mongoose.connection.collection('reviewsettings').findOne({ businessId: ID.owner });
      return Boolean(settings) && (settings as { general?: { enabled?: boolean } })?.general?.enabled === true;
    },
  });
  await test('W51', 'W51-N3', 'PATCH', '/api/review-management', 'negative', 409, {
    token: TOKENS.owner,
    body: { general: { enabled: true }, revision: 0 },
    note: 'Stale revision rejected.',
  });
  await dbCheck('W51 stale revision did not overwrite settings', async () => {
    const settings = await mongoose.connection.collection('reviewsettings').findOne({ businessId: ID.owner });
    return (settings as { general?: { googleReviewUrl?: string } })?.general?.googleReviewUrl === 'https://example.test/central';
  });

  // ── W50 product connection ─────────────────────────────────────────────────
  await test('W50', 'W50-N1', 'PATCH', `/api/review-management/products/${A.other}`, 'negative', 404, {
    token: TOKENS.owner,
    body: { source: 'central' },
  });
  await test('W50', 'W50-N2', 'PATCH', `/api/review-management/products/${A.grc}`, 'negative', 409, {
    token: TOKENS.owner,
    body: { source: 'central', revision: 999 },
    note: 'Stale product revision rejected.',
  });
  const productRevision = Number((await Card.findById(C.grc).lean<any>())?.reviewSettingsVersion ?? 0);
  await test('W50', 'W50-P', 'PATCH', `/api/review-management/products/${A.grc}`, 'positive', 200, {
    token: TOKENS.owner,
    body: { source: 'hybrid', overrides: { category: 'cafe', googleReviewUrl: 'https://example.test/grc-hybrid' }, revision: productRevision },
    verify: async () => {
      const card = await Card.findById(C.grc).lean<any>();
      return card?.reviewSettingsSource === 'hybrid' && card?.reviewOverrides?.googleReviewUrl === 'https://example.test/grc-hybrid';
    },
  });

  // ── W52 tenant settings ────────────────────────────────────────────────────
  await test('W52', 'W52-N', 'PATCH', '/api/settings', 'negative', 400, { token: TOKENS.owner, body: { general: { currency: 'usd' } } });
  await test('W52', 'W52-P', 'PATCH', '/api/settings', 'positive', 200, {
    token: TOKENS.owner,
    body: { general: { newsletterModalDelaySeconds: 5 }, openai: { enabled: false, model: 'gpt-4o-mini' } },
    verify: async (r) => {
      const text = r.text;
      const settings = await mongoose.connection.collection('tenantsettings').findOne({ userId: ID.owner });
      return !text.includes('apiKeyEnc') && (settings as { general?: { newsletterModalDelaySeconds?: number } })?.general?.newsletterModalDelaySeconds === 5;
    },
  });

  // ── W53 uploads confirm ────────────────────────────────────────────────────
  await test('W53', 'W53-N1', 'POST', '/api/uploads/confirm', 'negative', 404, {
    token: TOKENS.owner,
    body: { key: 'missing-key', bytes: 10 },
  });
  await test('W53', 'W53-N2', 'POST', '/api/uploads/confirm', 'negative', 404, {
    token: TOKENS.other,
    body: { key: `${ID.owner}/p35/confirm-me.webp`, bytes: 13 },
  });
  await test('W53', 'W53-P', 'POST', '/api/uploads/confirm', 'positive', 200, {
    token: TOKENS.owner,
    body: { key: `${ID.owner}/p35/confirm-me.webp`, bytes: 13 },
    verify: async () => {
      const media = await Media.findById(MD.pending).lean<any>();
      return media?.status === 'ready' && media?.bytes === Buffer.byteLength('confirm-bytes');
    },
  });

  // ── W54 presign (local driver → proxy) ─────────────────────────────────────
  await test('W54', 'W54-N', 'POST', '/api/uploads/presign', 'negative', 400, {
    token: TOKENS.owner,
    body: { category: 'not-a-category', file: { name: 'a.png', size: 10, type: 'image/png' } },
  });
  await test('W54', 'W54-P', 'POST', '/api/uploads/presign', 'positive', 200, {
    token: TOKENS.owner,
    body: { category: 'avatar', file: { name: 'a.png', size: 100, type: 'image/png' } },
    verify: (r) => (r.json as { mode?: string })?.mode === 'proxy',
  });

  // ── W55 multipart upload ───────────────────────────────────────────────────
  const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 30, g: 120, b: 200, alpha: 1 } } })
    .png()
    .toBuffer();
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'p35.png');
  form.append('category', 'avatar');
  const uploadRes = await fetch(`${BASE}/api/uploads`, {
    method: 'POST',
    headers: { cookie: `token=${TOKENS.owner}`, origin: BASE, 'x-real-ip': nextIp() },
    body: form,
  });
  const uploadJson = (await uploadRes.json().catch(() => null)) as { key?: string; data?: { key?: string } } | null;
  const uploadedKey = String(uploadJson?.key ?? uploadJson?.data?.key ?? '');
  results.push({
    mid: 'W55',
    id: 'W55-P',
    method: 'POST',
    route: '/api/uploads',
    kind: 'positive',
    expected: 201,
    actual: uploadRes.status,
    pass: uploadRes.status === 201 && Boolean(uploadedKey) && existsSync(path.resolve(UPLOAD_DIR, uploadedKey)) && (await Media.countDocuments({ key: uploadedKey })) === 1,
    detail: uploadRes.status === 201 ? '' : await uploadRes.text().catch(() => ''),
  });
  console.log(`${results[results.length - 1].pass ? 'PASS' : 'FAIL'} W55-P POST /api/uploads`);
  if (results[results.length - 1].pass) {
    dbSideEffectScenarios += 1;
    dbSideEffectScenariosPassed += 1;
  }
  await test('W55', 'W55-N', 'POST', '/api/uploads', 'negative', 400, { token: TOKENS.owner, raw: '' });

  // ── W56 media delete ───────────────────────────────────────────────────────
  await test('W56', 'W56-N1', 'DELETE', '/api/uploads', 'negative', 400, { token: TOKENS.owner });
  await test('W56', 'W56-N2', 'DELETE', `/api/uploads?key=${encodeURIComponent(String((await Media.findById(MD.owner).lean<any>())?.key ?? ''))}`, 'negative', 403, {
    token: TOKENS.other,
  });
  await test('W56', 'W56-P', 'DELETE', `/api/uploads?key=${encodeURIComponent(uploadedKey)}`, 'positive', 200, {
    token: TOKENS.owner,
    verify: async () => (await Media.countDocuments({ key: uploadedKey })) === 0 && !existsSync(path.resolve(UPLOAD_DIR, uploadedKey)),
  });

  // ── Concurrency / idempotency scenarios ────────────────────────────────────
  const currentSettings = await call('GET', '/api/review-management', { token: TOKENS.owner });
  const currentRevision = Number(
    (currentSettings.json as { revision?: string | number; data?: { revision?: string | number } })?.revision ??
      (currentSettings.json as { data?: { revision?: string | number } })?.data?.revision ??
      0
  );
  const concurrentSettings = await Promise.all([
    call('PATCH', '/api/review-management', { token: TOKENS.owner, body: { general: { welcomeMessage: 'Concurrent A' }, revision: currentRevision } }),
    call('PATCH', '/api/review-management', { token: TOKENS.owner, body: { general: { welcomeMessage: 'Concurrent B' }, revision: currentRevision } }),
  ]);
  const settingsStatuses = concurrentSettings.map((r) => r.status).sort();
  results.push({
    mid: 'W51', id: 'W51-CONCURRENCY', method: 'PATCH', route: '/api/review-management', kind: 'positive',
    expected: [200, 409], actual: settingsStatuses[0], pass: settingsStatuses[0] === 200 && settingsStatuses[1] === 409,
    detail: `statuses=${settingsStatuses.join(',')} bodies=${concurrentSettings.map((r) => r.text.slice(0, 80)).join(' || ')}`,
  });
  console.log(`${results[results.length - 1].pass ? 'PASS' : 'FAIL'} W51-CONCURRENCY PATCH /api/review-management (${settingsStatuses.join(',')})`);

  const concurrentBooking = await Promise.all([
    call('POST', '/api/public/cards/p35-grc/appointments', { body: { visitorName: 'Race A', visitorEmail: 'racea@p35.test', date: '2027-06-15', slot: '1:00 PM' } }),
    call('POST', '/api/public/cards/p35-grc/appointments', { body: { visitorName: 'Race B', visitorEmail: 'raceb@p35.test', date: '2027-06-15', slot: '1:00 PM' } }),
  ]);
  const bookingStatuses = concurrentBooking.map((r) => r.status).sort();
  results.push({
    mid: 'W39', id: 'W39-CONCURRENCY', method: 'POST', route: '/api/public/cards/p35-grc/appointments', kind: 'positive',
    expected: [201, 409], actual: bookingStatuses[0], pass: bookingStatuses[0] === 201 && bookingStatuses[1] === 409,
    detail: `statuses=${bookingStatuses.join(',')}`,
  });
  console.log(`${results[results.length - 1].pass ? 'PASS' : 'FAIL'} W39-CONCURRENCY appointment slot race (${bookingStatuses.join(',')})`);

  // ── Summary ────────────────────────────────────────────────────────────────
  const methodIds = [...new Set(results.map((r) => r.mid))].sort();
  const failed = results.filter((r) => !r.pass);
  const failedMethods = [...new Set(failed.map((r) => r.mid))];
  const dbFailed = dbChecks.filter((c) => !c.pass);

  const summary = {
    writeMethodsDiscovered: 56,
    writeMethodsTested: methodIds.length,
    writeMethodsPassed: methodIds.filter((m) => !failedMethods.includes(m)).length,
    writeMethodsFailed: failedMethods.length,
    writeMethodsBlocked: STANDEE_BASE ? 0 : 3,
    writeMethodsNotTested: 0,
    scenarios: results.length,
    positiveScenarios: results.filter((r) => r.kind === 'positive').length,
    negativeScenarios: results.filter((r) => r.kind === 'negative').length,
    securityScenarios: results.filter((r) => r.kind === 'security').length,
    dbChecks: dbChecks.length,
    dbChecksPassed: dbChecks.filter((c) => c.pass).length,
    dbSideEffectScenarios,
    dbSideEffectScenariosPassed,
    failedTests: failed,
    failedMethods,
    dbFailed,
  };
  console.log('\n=== P3.5 WRITE API SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('\nScenarios:');
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id} ${r.method} ${r.route} [${r.kind}] ${r.actual}`);
  console.log('\nDB checks:');
  for (const c of dbChecks) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}`);

  await mongoose.disconnect();
  process.exit(failed.length === 0 && dbFailed.length === 0 ? 0 : 1);
}

if (process.argv[1]?.includes('test-phase4d10p3-write-api')) {
  main().catch(async (error) => {
    console.error(error);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
}

export { ID, P, C, A, S, RC, RT, PR, AP, IQ, PE, MD };
