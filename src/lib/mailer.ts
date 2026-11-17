import nodemailer, { type Transporter } from 'nodemailer';

import { env } from '../config/env.js';
import { logger } from './logger.js';

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;

  transporter = env.SMTP_HOST
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER
          ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
          : undefined,
      })
    : null;

  return transporter;
}

/**
 * Sends an email over SMTP (works with Resend, SendGrid, Postmark, Mailtrap...).
 * Without SMTP configured, development logs the message so links can be
 * copied; production only logs a warning (never the content — it may hold
 * secrets such as reset tokens).
 */
export async function sendMail(message: MailMessage): Promise<void> {
  const transport = getTransporter();

  if (!transport) {
    if (env.isProduction) {
      logger.warn(
        { to: message.to, subject: message.subject },
        'SMTP is not configured; email was not sent'
      );
    } else {
      logger.info(
        {
          mail: {
            to: message.to,
            subject: message.subject,
            text: message.text,
          },
        },
        'SMTP is not configured; logging email instead'
      );
    }
    return;
  }

  await transport.sendMail({ from: env.MAIL_FROM, ...message });
}
