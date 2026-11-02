import { redirect } from 'next/navigation';

/**
 * Standee QR management moved to the authorized customer record.
 *
 * Permanent NFC/QR entry links are privileged metadata and are displayed only
 * at Admin → Users → User Details, alongside the customer's assigned products.
 * The legacy route is preserved as a redirect so bookmarks do not 404.
 */
export default function AdminStandeeQrPage() {
  redirect('/admin/users');
}
