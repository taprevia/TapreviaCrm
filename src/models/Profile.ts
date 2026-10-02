import mongoose, { Schema } from 'mongoose';

const SocialLinkSchema = new Schema({
  platform: { type: String, required: true },
  url: { type: String, required: true },
  label: { type: String, default: '' },
  clicks: { type: Number, default: 0 },
}, { _id: false });

/** @deprecated Kept only so legacy printed QRs keep resolving via /qr/[id]. New standees use the Standee collection. */
const StandeeQrSchema = new Schema({
  qrId: { type: String, default: '' },
  platform: { type: String, default: '' },
  destinationUrl: { type: String, default: '' },
  qrColor: { type: String, default: '#000000' },
}, { _id: false });

const ProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    cardId: { type: Schema.Types.ObjectId, ref: 'Card', default: null },
    // Code-registered card templates this customer may switch between.
    // Absent/empty ⇒ the DEFAULT_ALLOWED_TEMPLATES apply.
    allowedTemplates: { type: [String], default: [] },
    themeConfig: {
      accentColor: { type: String, default: '#3B82F6' },
      bgColor: { type: String, default: '#FFFFFF' },
      darkMode: { type: Boolean, default: false },
    },
    personalInfo: {
      fullName: { type: String, default: '' },
      jobTitle: { type: String, default: '' },
      phone: { type: String, default: '' },
      email: { type: String, default: '' },
      bio: { type: String, default: '' },
      avatarUrl: { type: String, default: '' },
    },
    companyInfo: {
      companyName: { type: String, default: '' },
      taxId: { type: String, default: '' },
      address: { type: String, default: '' },
      website: { type: String, default: '' },
      logoUrl: { type: String, default: '' },
    },
    socialLinks: [SocialLinkSchema],
    standeeQr: StandeeQrSchema,
  },
  { timestamps: true }
);

ProfileSchema.index({ 'standeeQr.qrId': 1 }, { sparse: true, unique: true });

export default mongoose.models.Profile || mongoose.model('Profile', ProfileSchema);
