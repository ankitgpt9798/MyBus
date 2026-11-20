import { InferSchemaType, Schema, model } from 'mongoose';

const operatorSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
  },
  { timestamps: true },
);

export type OperatorAttrs = InferSchemaType<typeof operatorSchema>;
export const Operator = model('Operator', operatorSchema);
