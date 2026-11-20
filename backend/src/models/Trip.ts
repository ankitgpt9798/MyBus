import { InferSchemaType, Schema, model } from 'mongoose';

export const TRIP_STATUSES = ['scheduled', 'cancelled'] as const;

const tripSchema = new Schema(
  {
    route: { type: Schema.Types.ObjectId, ref: 'Route', required: true },
    bus: { type: Schema.Types.ObjectId, ref: 'Bus', required: true },
    operator: { type: Schema.Types.ObjectId, ref: 'Operator', required: true },
    departureTime: { type: Date, required: true },
    arrivalTime: { type: Date, required: true },
    fare: { type: Number, required: true, min: 0 },
    status: { type: String, enum: TRIP_STATUSES, default: 'scheduled' },
    // Seats held by pending bookings or sold to confirmed ones. Updated atomically to prevent double booking.
    bookedSeats: { type: [String], default: [] },
  },
  { timestamps: true },
);

tripSchema.index({ route: 1, departureTime: 1 });
tripSchema.index({ departureTime: 1 });

export type TripAttrs = InferSchemaType<typeof tripSchema>;
export const Trip = model('Trip', tripSchema);
