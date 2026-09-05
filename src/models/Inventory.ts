import { Schema, model, Document, Types } from 'mongoose';

export interface IInventory extends Document {
  _id: Types.ObjectId;
  locationId: Types.ObjectId;
  storeId: Types.ObjectId;
  productId: Types.ObjectId;
  currentStock: number;
  reservedStock: number;
  minimumStock: number;
  maximumStock: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  availableStock: number;
}

const inventorySchema = new Schema<IInventory>(
  {
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'InstamartProduct', required: true, index: true },
    currentStock: { type: Number, required: true, default: 0, min: 0 },
    reservedStock: { type: Number, required: true, default: 0, min: 0 },
    minimumStock: { type: Number, default: 5 },
    maximumStock: { type: Number, default: 1000 },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  },
  { timestamps: true },
);

inventorySchema.virtual('availableStock').get(function (this: IInventory) {
  return this.currentStock - this.reservedStock;
});

inventorySchema.set('toJSON', { virtuals: true });
inventorySchema.index({ storeId: 1, productId: 1 }, { unique: true });

export const Inventory = model<IInventory>('Inventory', inventorySchema);
