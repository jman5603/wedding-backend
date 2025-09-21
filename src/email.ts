import dotenv from 'dotenv';
dotenv.config();

// Use require to avoid missing type declarations for mailgun.js/form-data
const formData = require('form-data');
const Mailgun = require('mailgun.js');

const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;

if (!MAILGUN_API_KEY) {
  // Do not throw at import time in case tests or other environments don't have env set.
  // Functions will throw meaningful errors if called without configuration.
  // console.warn('Mailgun not configured. Set MAILGUN_API_KEY and MAILGUN_DOMAIN to enable email sending.');
}

const mailgun = new Mailgun(formData);
const mgClient: any = MAILGUN_API_KEY ? mailgun.client({ username: 'api', key: MAILGUN_API_KEY }) : null;

export async function sendEmail(to: string, subject: string, text: string, html?: string) {
  if (!mgClient) {
    throw new Error('Mailgun client not configured. Set MAILGUN_API_KEY and MAILGUN_DOMAIN environment variables.');
  }
  if (!to) throw new Error('Recipient email required');

  const message: any = {
    from: "Juliette and Jacob <noreply@julietteandjacob.com>",
    to,
    subject,
    text,
  };
  if (html) message.html = html;

  try {
    const result = await mgClient.messages.create("julietteandjacob.com", message);
    return result;
  } catch (err: any) {
    // Re-throw so caller can handle/log
    throw err;
  }
}

export async function sendRsvpConfirmation(to: string, guestName: string, partyName?: string) {
  const subject = 'Your RSVP confirmation';
  const text = `Hi ${guestName},\n\nThanks for submitting your RSVP${partyName ? ` for ${partyName}` : ''}. We look forward to seeing you!\n\n— Jacob & Juliette`;
  const html = `<p>Hi ${guestName},</p><p>Thanks for submitting your RSVP${partyName ? ` for <strong>${partyName}</strong>` : ''}.</p><p>We look forward to seeing you!</p><p>— Jacob &amp; Juliette</p>`;
  return sendEmail(to, subject, text, html);
}
