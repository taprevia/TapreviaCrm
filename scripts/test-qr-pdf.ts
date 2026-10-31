import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { generateQrPdf } from '@/lib/qr-pdf';

async function main() {
  const single = await generateQrPdf([
    { title: 'NFC Card — Profile', url: 'https://taprevia.com/r/abc123' },
  ]);
  assert.equal(single.type, 'application/pdf');
  const singleText = await single.text();
  assert.match(singleText, /^%PDF-1\.4/);
  assert.match(singleText, /%%EOF$/);
  assert.equal((singleText.match(/\/Type \/Page /g) ?? []).length, 1);
  assert.match(singleText, /taprevia\.com\/r\/abc123/);
  assert.match(singleText, /NFC Card/);

  const bulkItems = [
    { title: 'Standee — panel', url: 'https://taprevia.com/r/standee1' },
    { title: 'Standee — Instagram', url: 'https://taprevia.com/r/standee1/1' },
    {
      title: 'Long title that should wrap safely without clipping or breaking the layout of the PDF page',
      url: 'https://taprevia.com/r/standee1/2?destination=very-long-query-value-for-wrapping-verification',
    },
  ];
  const bulk = await generateQrPdf(bulkItems);
  const bulkText = await bulk.text();
  assert.equal((bulkText.match(/\/Type \/Page /g) ?? []).length, bulkItems.length);
  assert.match(bulkText, /\/Count 3/);

  writeFileSync('/private/var/folders/q6/sln_hq214ln5ss45p5667wcr0000gn/T/opencode/qr-single.pdf', Buffer.from(await single.arrayBuffer()));
  writeFileSync('/private/var/folders/q6/sln_hq214ln5ss45p5667wcr0000gn/T/opencode/qr-bulk.pdf', Buffer.from(await bulk.arrayBuffer()));

  // Forced generator failure must reject without producing a PDF, and a
  // subsequent retry must succeed (UI handlers re-enable on this path).
  const originalCreate = QRCode.create;
  QRCode.create = (() => { throw new Error('forced QR failure'); }) as typeof QRCode.create;
  await assert.rejects(() => generateQrPdf(bulkItems), /forced QR failure/);
  QRCode.create = originalCreate;
  const retry = await generateQrPdf(bulkItems);
  assert.equal((await retry.text()).match(/\/Type \/Page /g)?.length, bulkItems.length);

  console.log('QR PDF tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
