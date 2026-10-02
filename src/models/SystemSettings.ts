import mongoose, { Schema } from 'mongoose';

/**
 * SystemSettings — app-wide (global) configuration singleton.
 *
 * Unlike `TenantSettings` (per customer), settings here apply platform-wide and
 * are only mutated by admins. Currently stores custom display names for the
 * code-registered card templates (admin Template Access → Rename), so the
 * builder picker and public renders can show business-facing names.
 */

const SystemSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    // templateKey → display name override. Absent keys fall back to the
    // catalog defaults in src/lib/card-templates.ts.
    cardTemplateNames: { type: Map, of: String, default: () => ({}) },
  },
  { timestamps: true }
);

export default mongoose.models.SystemSettings ||
  mongoose.model('SystemSettings', SystemSettingsSchema);