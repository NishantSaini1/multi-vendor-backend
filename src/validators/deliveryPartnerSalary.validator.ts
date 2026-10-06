import { z } from 'zod';

const objectId = z.string().length(24);

export const partnerIdParamSchema = z.object({
  params: z.object({ partnerId: objectId }),
});

export const recordIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

// PUT /delivery-partner-salaries/configs/:partnerId
export const upsertSalaryConfigSchema = z.object({
  params: z.object({ partnerId: objectId }),
  body: z
    .object({
      monthlySalary: z.number().nonnegative(),
      hasOwnVehicle: z.boolean().optional(),
      perKmRate: z.number().nonnegative().optional(),
      notes: z.string().trim().optional(),
    })
    .refine(
      (d) => {
        if (d.hasOwnVehicle && (d.perKmRate === undefined || d.perKmRate === 0)) return false;
        return true;
      },
      { message: 'perKmRate must be > 0 when hasOwnVehicle is true' },
    ),
});

// GET /delivery-partner-salaries/configs
export const listSalaryConfigsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    locationId: objectId.optional(),
    partnerId: objectId.optional(),
  }),
});

// POST /delivery-partner-salaries/records/generate
export const generateSalaryRecordsSchema = z.object({
  body: z.object({
    year: z.number().int().min(2020).max(2100),
    month: z.number().int().min(1).max(12),
    // If omitted, generates for all configured partners (optionally in a location).
    deliveryPartnerId: objectId.optional(),
    locationId: objectId.optional(),
  }),
});

// GET /delivery-partner-salaries/records
export const listSalaryRecordsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    locationId: objectId.optional(),
    deliveryPartnerId: objectId.optional(),
    year: z.string().optional(),
    month: z.string().optional(),
    status: z.enum(['PENDING', 'PAID']).optional(),
  }),
});

// PATCH /delivery-partner-salaries/records/:id/pay
export const markSalaryPaidSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    transactionReference: z.string().trim().min(1),
  }),
});
