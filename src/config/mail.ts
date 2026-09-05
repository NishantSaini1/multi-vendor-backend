import nodemailer, { Transporter } from 'nodemailer';
import { env } from './env';
import { logger } from '../utils/logger';

let transporter: Transporter | null = null;

export function getMailTransporter(): Transporter | null {
  if (transporter) return transporter;

  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    logger.warn('SMTP credentials not configured; email sending disabled');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  return transporter;
}
