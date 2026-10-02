import mongoose, { Schema } from 'mongoose';

const AdminAuditLogSchema = new Schema(
  {
    adminId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: {
      type: String,
      enum: ['export'],
      required: true,
    },
    resource: { type: String, default: '' },
    metadata: { type: String, default: '' },
    ip: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

AdminAuditLogSchema.index({ adminId: 1, createdAt: -1 });
AdminAuditLogSchema.index({ createdAt: -1 });
// Audit rows are retained for a year, then auto-purged — compliance-relevant
// window without unbounded collection growth.
AdminAuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });

export default mongoose.models.AdminAuditLog ||
  mongoose.model('AdminAuditLog', AdminAuditLogSchema);