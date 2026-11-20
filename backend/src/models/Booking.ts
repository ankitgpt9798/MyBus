import { InferSchemaType, Schema, model } from 'mongoose';

// pending   -> seats held, waiting for payment (expires after SEAT_HOLD_MINUTES)
// confirmed -> paid, PNR issued
// completed -> trip arrived (set automatically); unlocks reviews in Phase 3
// cancelled -> cancelled by user/admin, seats released, refund computed
// expired   -> hold ran out before payment, seats released
export const BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'expired'] as const;
export const PAYMENT_METHODS = ['upi', 'card', 'netbanking'] as const;
export const GENDERS = ['male', 'female', 'other'] as const;

const passengerSchema = new Schema(
  {
    seat: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    age: { type: Number, required: true, min: 1, max: 120 },
    gender: { type: String, enum: GENDERS, required: true },
  },
  { _id: false },
);

const pointSchema = new Schema(
  { name: { type: String, required: true }, offsetMinutes: { type: Number, required: true } },
  { _id: false },
);

// Snapshot of the journey for tickets and history; times are kept in sync when an admin reschedules the trip.
const journeySchema = new Schema(
  {
    from: { type: String, required: true },
    to: { type: String, required: true },
    departureTime: { type: Date, required: true },
    arrivalTime: { type: Date, required: true },
    operatorName: { type: String, required: true },
    busName: { type: String, required: true },
    busType: { type: String, required: true },
    ac: { type: Boolean, required: true },
  },
  { _id: false },
);

const bookingSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    trip: { type: Schema.Types.ObjectId, ref: 'Trip', required: true },
    route: { type: Schema.Types.ObjectId, ref: 'Route', required: true },
    pnr: { type: String, unique: true, sparse: true },
    status: { type: String, enum: BOOKING_STATUSES, default: 'pending' },
    seats: { type: [String], required: true },
    passengers: { type: [passengerSchema], required: true },
    contact: {
      email: { type: String, required: true, lowercase: true, trim: true },
      phone: { type: String, required: true, trim: true },
    },
    boardingPoint: { type: pointSchema, required: true },
    droppingPoint: { type: pointSchema, required: true },
    journey: { type: journeySchema, required: true },
    farePerSeat: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    holdExpiresAt: { type: Date },
    payment: {
      method: { type: String, enum: PAYMENT_METHODS },
      transactionId: String,
      paidAt: Date,
      status: { type: String, enum: ['unpaid', 'paid', 'refunded', 'partially_refunded'], default: 'unpaid' },
    },
    cancellation: {
      cancelledAt: Date,
      by: { type: String, enum: ['user', 'admin', 'system'] },
      reason: String,
      refundPercent: Number,
      refundAmount: Number,
    },
    completedAt: Date,
  },
  { timestamps: true },
);

bookingSchema.index({ user: 1, 'journey.departureTime': -1 });
bookingSchema.index({ status: 1, 'journey.arrivalTime': 1 });
bookingSchema.index({ status: 1, holdExpiresAt: 1 });
bookingSchema.index({ trip: 1, status: 1 });

export type BookingAttrs = InferSchemaType<typeof bookingSchema>;
export const Booking = model('Booking', bookingSchema);
