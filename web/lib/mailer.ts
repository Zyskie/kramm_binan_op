// Gmail SMTP sender, same account/app-password scheme as the old
// run_local.ps1 runner (env var KRAMM_GMAIL_APP_PW).

import nodemailer from "nodemailer";

export type PendingEmail = { subject: string; body: string };

export async function sendEmails(emails: PendingEmail[]): Promise<void> {
  if (!emails.length) return;

  const user = process.env.KRAMM_GMAIL_USER;
  const pass = process.env.KRAMM_GMAIL_APP_PW;
  const to = process.env.KRAMM_ALERT_EMAIL_TO ?? user;

  if (!user || !pass) {
    throw new Error("Missing KRAMM_GMAIL_USER / KRAMM_GMAIL_APP_PW env vars.");
  }

  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  for (const email of emails) {
    await transport.sendMail({
      from: user,
      to,
      subject: email.subject,
      text: email.body,
    });
  }
}
