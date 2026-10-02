/** Platforms offered as printed QR codes on a physical standee. */
export const STANDEE_PLATFORMS = [
  { id: 'instagram', name: 'Instagram' },
  { id: 'google_review', name: 'Google Review' },
  { id: 'whatsapp', name: 'WhatsApp' },
  { id: 'facebook', name: 'Facebook' },
] as const;

export type StandeePlatformId = typeof STANDEE_PLATFORMS[number]['id'];

export function getStandeePlatformById(id: string) {
  return STANDEE_PLATFORMS.find(p => p.id === id);
}
