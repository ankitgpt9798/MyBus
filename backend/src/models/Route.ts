import { InferSchemaType, Schema, model } from 'mongoose';

export const STOP_TYPES = ['boarding', 'via', 'dropping'] as const;

const stopSchema = new Schema(
  {
    name: { type: String, required: true },
    type: { type: String, enum: STOP_TYPES, required: true },
    offsetMinutes: { type: Number, required: true }, // minutes after the trip's departure
  },
  { _id: false },
);

const routeSchema = new Schema(
  {
    from: { type: String, required: true, trim: true },
    to: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true },
    distanceKm: { type: Number, required: true },
    durationMinutes: { type: Number, required: true },
    stops: { type: [stopSchema], default: [] },
    // Maintained by the reviews module (Phase 3).
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

routeSchema.index({ from: 1, to: 1 }, { unique: true });

export type RouteAttrs = InferSchemaType<typeof routeSchema>;
export const Route = model('Route', routeSchema);
