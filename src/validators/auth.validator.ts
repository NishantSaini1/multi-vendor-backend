import { z } from 'zod';

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Invalid phone number');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const sendOtpSchema = z.object({
  body: z.object({ phone: phoneSchema }),
});

export const verifyOtpSchema = z.object({
  body: z.object({
    phone: phoneSchema,
    otp: z.string().trim().length(6, 'OTP must be 6 digits'),
  }),
});

export const resendOtpSchema = sendOtpSchema;

export const refreshTokenSchema = z.object({
  body: z.object({ refreshToken: z.string().min(10) }),
});

export const changePhoneSchema = z.object({
  body: z.object({
    newPhone: phoneSchema,
    otp: z.string().trim().length(6),
  }),
});

export const vendorLoginSchema = z.object({
  body: z.object({
    identifier: z.string().min(3),
    password: z.string().min(1),
  }),
});

export const deliveryLoginSchema = z.object({
  body: z.object({
    phone: phoneSchema,
    password: z.string().min(1),
  }),
});

export const adminLoginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
});

export const changePasswordSchema = z.object({
  body: z
    .object({
      currentPassword: z.string().min(1),
      newPassword: passwordSchema,
    })
    .refine((data) => data.currentPassword !== data.newPassword, {
      message: 'New password must be different from current password',
      path: ['newPassword'],
    }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    identifier: z.string().min(3),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    resetToken: z.string().min(10),
    newPassword: passwordSchema,
  }),
});

export const sessionParamsSchema = z.object({
  params: z.object({ sessionId: z.string().min(1) }),
});
