import { Schema, model, Document, Types } from 'mongoose';

export interface ISupportCategory {
  key: string;
  label: string;
  description?: string;
  // Ionicons glyph name, rendered as-is by the customer app
  icon: string;
  // true → the customer must pick which order it's about
  orderScoped: boolean;
  displayOrder: number;
  active: boolean;
}

// Singleton (one document, key "default") holding everything on the app's
// Help & Support screen that admins can change without a release: contact
// channels, working hours, the category list and the response-time promise.
export interface ISupportConfig extends Document {
  _id: Types.ObjectId;
  key: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  hours?: string;
  responseTime?: string;
  notice?: string;
  categories: ISupportCategory[];
  updatedAt: Date;
  createdAt: Date;
}

const categorySchema = new Schema<ISupportCategory>(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    description: { type: String },
    icon: { type: String, default: 'help-circle-outline' },
    orderScoped: { type: Boolean, default: false },
    displayOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { _id: false },
);

const supportConfigSchema = new Schema<ISupportConfig>(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    email: { type: String },
    phone: { type: String },
    whatsapp: { type: String },
    hours: { type: String },
    responseTime: { type: String },
    notice: { type: String },
    categories: { type: [categorySchema], default: [] },
  },
  { timestamps: true },
);

export const SupportConfig = model<ISupportConfig>('SupportConfig', supportConfigSchema);
