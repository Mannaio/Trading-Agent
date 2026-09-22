import nodemailer from 'nodemailer';
import type { SmtpConfig } from './watch-config.js';

export function createMailer(smtp: SmtpConfig): (msg: { subject: string; text: string }) => Promise<void> {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });

  return async (msg) => {
    await transport.sendMail({
      from: smtp.user,
      to: smtp.to,
      subject: msg.subject,
      text: msg.text,
    });
  };
}
