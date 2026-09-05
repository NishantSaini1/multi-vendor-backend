import { z } from 'zod';

const objectId = z.string().length(24);

export const upsertVehicleSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    type: z.enum(['BICYCLE', 'BIKE', 'SCOOTER', 'CAR']),
    make: z.string().optional(),
    vehicleModel: z.string().optional(),
    registrationNumber: z.string().min(3),
  }),
});
