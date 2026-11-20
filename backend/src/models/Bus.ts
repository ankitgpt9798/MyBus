import { InferSchemaType, Schema, model } from 'mongoose';

export const BUS_TYPES = ['seater', 'sleeper'] as const;
export const AMENITIES = ['wifi', 'charging', 'water', 'blanket', 'snacks', 'tv', 'reading_light', 'cctv', 'gps'] as const;

const seatSchema = new Schema(
  {
    number: { type: String, required: true },
    deck: { type: String, enum: ['lower', 'upper'], default: 'lower' },
    row: { type: Number, required: true },
    col: { type: Number, required: true },
    kind: { type: String, enum: BUS_TYPES, required: true },
  },
  { _id: false },
);

const busSchema = new Schema(
  {
    operator: { type: Schema.Types.ObjectId, ref: 'Operator', required: true },
    name: { type: String, required: true, trim: true },
    registrationNumber: { type: String, required: true, unique: true },
    type: { type: String, enum: BUS_TYPES, required: true },
    ac: { type: Boolean, default: false },
    amenities: [{ type: String, enum: AMENITIES }],
    seats: { type: [seatSchema], default: [] },
    totalSeats: { type: Number, required: true },
  },
  { timestamps: true },
);

export type BusAttrs = InferSchemaType<typeof busSchema>;
export const Bus = model('Bus', busSchema);
