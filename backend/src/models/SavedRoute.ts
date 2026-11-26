import { HydratedDocument, InferSchemaType, Schema, model } from 'mongoose';

/** Most routes one user can keep. */
export const MAX_SAVED_ROUTES = 20;

const placeSchema = new Schema(
  {
    label: { type: String, required: true, maxlength: 120 },
    lat: { type: Number, required: true },
    lon: { type: Number, required: true },
  },
  { _id: false },
);

/** A route planner plan a user saved for quick access (start, destination and stops). */
const savedRouteSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, maxlength: 60 },
    start: { type: placeSchema, required: true },
    end: { type: placeSchema, required: true },
    waypoints: { type: [placeSchema], default: [] },
    // Rounded coordinates of start, stops and end: the same plan cannot be saved twice.
    signature: { type: String, required: true },
    useCount: { type: Number, default: 0 },
    lastUsedAt: Date,
  },
  { timestamps: true },
);

savedRouteSchema.index({ user: 1, signature: 1 }, { unique: true });
savedRouteSchema.index({ user: 1, useCount: -1, lastUsedAt: -1 });

export type SavedRouteAttrs = InferSchemaType<typeof savedRouteSchema>;
export type SavedRouteDoc = HydratedDocument<SavedRouteAttrs>;
export const SavedRoute = model('SavedRoute', savedRouteSchema);
