/**
 * Minimal outbound mail abstraction — one facade, two transports.
 *
 *  - Development (NODE_ENV !== 'production'): the reset URL is printed to the
 *    server console so local flows work with zero email setup. No Resend key
 *    is required to develop the application.
 *  - Production: transactional email is delivered through Resend using the
 *    configured RESEND_API_KEY and the verified sender in EMAIL_FROM.
 *
 * Provider failures are captured and logged server-side and never thrown or
 * surfaced to callers, so forgot-password stays enumeration-safe. The raw
 * reset token is only ever logged on the development console; credentials are
 * never logged.
 *
 * The password-reset flow imports only sendPasswordResetEmail — Resend details
 * do not leak into the rest of the application.
 */

import { Resend } from 'resend';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface SendMailResult {
  ok: boolean;
  transport: 'console' | 'resend';
  message: MailMessage;
}

export interface MailTransportResult {
  ok: boolean;
}

export interface MailTransport {
  send(mail: MailMessage): Promise<MailTransportResult>;
}

export interface MailConfig {
  apiKey: string | null;
  from: string | null;
}

/**
 * Reads the mail credentials from the environment — never hard-coded. Follows
 * the same convention as the S3/R2 credentials consumed directly from
 * process.env in the non-edge storage module.
 */
export function getMailConfig(): MailConfig {
  return {
    apiKey: process.env.RESEND_API_KEY ?? null,
    from: process.env.EMAIL_FROM ?? null,
  };
}

function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`;
}

function resetUrlFor(resetToken: string): string {
  return `${appBaseUrl()}/reset-password?token=${encodeURIComponent(resetToken)}`;
}

/** Assembles the password-reset message. Pure — reuses in the facade and tests. */
export function buildPasswordResetMail(to: string, resetToken: string): MailMessage {
  return {
    to,
    subject: 'Reset your Taprevia password',
    text: [
      'Hi,',
      '',
      'We received a request to reset your Taprevia password.',
      'Open the link below to choose a new password (valid for 30 minutes):',
      '',
      resetUrlFor(resetToken),
      '',
      "If you didn't request this, you can safely ignore this email.",
    ].join('\n'),
  };
}

/**
 * Resend-backed transport. Credentials are read at send time, so a production
 * key is only required when production actually delivers mail. Resend's error
 * object is logged (name+message, which never contain the API key or the raw
 * token) and converted into a safe boolean result.
 */
export function resendTransport(): MailTransport {
  return {
    async send(mail) {
      const { apiKey, from } = getMailConfig();
      if (!apiKey || !from) {
        const missing = [apiKey ? '' : 'RESEND_API_KEY', from ? '' : 'EMAIL_FROM']
          .filter(Boolean)
          .join(', ');
        console.error(`[mail] Missing ${missing} — password reset email to ${mail.to} was NOT sent.`);
        return { ok: false };
      }

      const resend = new Resend(apiKey);
      try {
        const { error } = await resend.emails.send({
          from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
        });
        if (error) {
          console.error(`[mail] Resend rejected password reset to ${mail.to}: ${error.name} ${error.message}`);
          return { ok: false };
        }
        return { ok: true };
      } catch (error) {
        console.error(
          `[mail] Resend send threw for ${mail.to}:`,
          error instanceof Error ? error.message : String(error)
        );
        return { ok: false };
      }
    },
  };
}

export async function sendPasswordResetEmail(
  to: string,
  resetToken: string,
  transport: MailTransport = resendTransport()
): Promise<SendMailResult> {
  const message = buildPasswordResetMail(to, resetToken);

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[mail:dev] password reset for ${to}: ${resetUrlFor(resetToken)}`);
    return { ok: true, transport: 'console', message };
  }

  const result = await transport.send(message).catch((error: unknown) => {
    // A throwing provider must never leak past the facade — forgot-password
    // depends on the generic response reaching the customer regardless.
    console.error(
      `[mail] Transport send threw for ${message.to}:`,
      error instanceof Error ? error.message : String(error)
    );
    return { ok: false };
  });
  return { ok: result.ok, transport: 'resend', message };
}