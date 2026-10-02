import mongoose, { Schema } from 'mongoose';

const AppointmentSchema = new Schema(
  {
    cardId: { type: Schema.Types.ObjectId, ref: 'Card', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    visitorName: { type: String, required: true, trim: true },
    visitorEmail: { type: String, required: true, trim: true, lowercase: true },
    visitorPhone: { type: String, default: '', trim: true },
    date: { type: Date, required: true },
    slot: { type: String, required: true },
    service: { type: String, default: '' },
    note: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'cancelled', 'completed'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

AppointmentSchema.index(
  { cardId: 1, date: 1, slot: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending', 'confirmed'] } },
  }
);

export default mongoose.models.Appointment ||
  mongoose.model('Appointment', AppointmentSchema);
