import type { MailMessage } from '../../lib/mailer.js';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    char =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!
  );

export function passwordResetEmail(params: {
  to: string;
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}): MailMessage {
  const { to, name, resetUrl, expiresInMinutes } = params;

  return {
    to,
    subject: 'Reset your Evernote Replica password',
    text: [
      `Hi ${name},`,
      '',
      'We received a request to reset your password. Open the link below to choose a new one:',
      resetUrl,
      '',
      `The link expires in ${expiresInMinutes} minutes. If you didn't ask for this, you can ignore this email.`,
    ].join('\n'),
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>We received a request to reset your password.</p>
      <p><a href="${escapeHtml(resetUrl)}">Choose a new password</a></p>
      <p>The link expires in ${expiresInMinutes} minutes. If you didn't ask for this, you can ignore this email.</p>
    `,
  };
}
