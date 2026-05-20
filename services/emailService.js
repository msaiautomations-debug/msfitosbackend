const nodemailer = require('nodemailer');
const axios = require('axios');
const { assertNoRawIpv6Host, configureIpv4OnlyNetworking, ipv4OnlyLookup } = require('../utils/network');

// Conditionally import Resend only when needed
let Resend;
if (process.env.EMAIL_PROVIDER === 'resend') {
  try {
    Resend = require('resend').Resend;
  } catch (e) {
    console.warn('⚠️ Resend package not installed. Run: npm install resend');
  }
}

configureIpv4OnlyNetworking();

// Email provider configuration
const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || 'smtp').toLowerCase();
const isResend = EMAIL_PROVIDER === 'resend';
const isBrevo = EMAIL_PROVIDER === 'brevo' || EMAIL_PROVIDER === 'sendinblue';
const isSmtp = EMAIL_PROVIDER === 'smtp' || EMAIL_PROVIDER === 'gmail';

const port = Number(process.env.EMAIL_PORT || 587);
const secureEnv = String(process.env.EMAIL_SECURE || '').toLowerCase();
const secure = secureEnv === 'true' || port === 465;

// Render-specific configuration
const isRender = process.env.RENDER || process.env.NODE_ENV === 'production';
const smtpHost = process.env.EMAIL_HOST;

if (smtpHost) {
  assertNoRawIpv6Host('EMAIL_HOST', smtpHost);
}

function getEmailConfigIssues() {
  const issues = [];
  
  if (isResend) {
    if (!process.env.RESEND_API_KEY) issues.push('RESEND_API_KEY');
  } else if (isBrevo) {
    if (!process.env.BREVO_API_KEY) issues.push('BREVO_API_KEY');
    if (!process.env.EMAIL_FROM) issues.push('EMAIL_FROM');
  } else {
    // Gmail/SMTP config
    if (!process.env.EMAIL_HOST) issues.push('EMAIL_HOST');
    if (!process.env.EMAIL_USER) issues.push('EMAIL_USER');
    if (!process.env.EMAIL_PASS) issues.push('EMAIL_PASS');
    if (!process.env.EMAIL_FROM) issues.push('EMAIL_FROM');
  }
  
  return issues;
}

function parseSender(sender) {
  if (!sender) return undefined;
  const match = sender.match(/^(.*)<([^>]+)>$/);
  if (!match) return { email: sender.trim() };
  return {
    name: match[1].trim().replace(/^"|"$/g, ''),
    email: match[2].trim(),
  };
}

// Initialize Resend client if using Resend
let resend;
if (isResend && Resend && process.env.RESEND_API_KEY) {
  resend = new Resend(process.env.RESEND_API_KEY);
  console.log('📧 Email provider: Resend', {
    isRender,
    timestamp: new Date().toISOString(),
  });
}

// Initialize nodemailer transporter for SMTP (Gmail, Hostinger, etc.)
let transporter;
if (isSmtp && smtpHost) {
  transporter = nodemailer.createTransport({
    host: smtpHost,
    port,
    secure,
    family: 4,
    ...(smtpHost ? { lookup: ipv4OnlyLookup } : {}),
    auth: {
      user: process.env.EMAIL_USER?.trim(),
      pass: process.env.EMAIL_PASS?.trim(),
    },
    tls: {
      rejectUnauthorized: false,
      // Try different TLS versions
      minVersion: 'TLSv1',
    },
    // Force PLAIN authentication
    authMethod: 'PLAIN',
    connectionTimeout: 60000,
    greetingTimeout: 30000,
    socketTimeout: 60000,
    pool: true,
    maxConnections: isRender ? 2 : 5,
    maxMessages: isRender ? 10 : 100,
    debug: true,
  });

  // Verify transporter on startup
  transporter.verify((error, success) => {
    if (error) {
      console.error('🚨 SMTP transporter verification failed:', {
        error: error.message,
        code: error.code,
        host: process.env.EMAIL_HOST,
        port: port,
        secure: secure,
        isRender: isRender,
        timestamp: new Date().toISOString(),
      });
    } else {
      console.log('✅ SMTP transporter is ready to send messages', {
        host: process.env.EMAIL_HOST,
        port: port,
        secure: secure,
        isRender: isRender,
        timestamp: new Date().toISOString(),
      });
    }
  });
}

async function sendEmail({ to, subject, html, text }) {
  if (!to) throw new Error('Missing email recipient');
  
  const configIssues = getEmailConfigIssues();
  if (configIssues.length) {
    throw new Error(`Missing email configuration: ${configIssues.join(', ')}`);
  }

  const startTime = Date.now();

  try {
    console.log('📧 Attempting to send email:', {
      to,
      subject,
      provider: EMAIL_PROVIDER,
      isRender,
      timestamp: new Date().toISOString(),
    });

    let info;

    if (isResend && resend) {
      // Use Resend API - use default sender if custom domain not verified
      const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev';
      
      // Check if using custom domain (not Resend's default)
      const isCustomDomain = !fromEmail.includes('resend.dev');
      
      const { data, error } = await resend.emails.send({
        from: isCustomDomain ? 'onboarding@resend.dev' : fromEmail,
        to: Array.isArray(to) ? to : [to],
        subject: subject,
        html: html,
        text: text,
      });

      if (error) {
        throw new Error(`Resend error: ${error.message}`);
      }

      info = { messageId: data?.id };
      console.log('✅ Email sent successfully via Resend:', {
        messageId: data?.id,
        to,
        subject,
        duration: `${Date.now() - startTime}ms`,
        timestamp: new Date().toISOString(),
      });
    } else if (isBrevo) {
      const sender = parseSender(process.env.EMAIL_FROM);
      const toRecipients = Array.isArray(to)
        ? to.map((recipient) => (typeof recipient === 'string' ? { email: recipient } : recipient))
        : [{ email: to }];

      const requestBody = {
        sender,
        to: toRecipients,
        subject,
        htmlContent: html,
        textContent: text,
      };

      if (process.env.EMAIL_REPLY_TO) {
        requestBody.replyTo = parseSender(process.env.EMAIL_REPLY_TO);
      }

      const response = await axios.post(
        'https://api.brevo.com/v3/smtp/email',
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'api-key': process.env.BREVO_API_KEY?.trim(),
          },
          timeout: 30000,
        }
      );

      info = {
        messageId:
          response.data?.messageId ||
          response.data?.message_uuid ||
          response.data?.messageUuid ||
          undefined,
      };
      console.log('✅ Email sent successfully via Brevo:', {
        messageId: info.messageId,
        status: response.status,
        responseData: response.data,
        requestBody: {
          sender,
          to: toRecipients,
          subject,
        },
        to,
        subject,
        duration: `${Date.now() - startTime}ms`,
        provider: EMAIL_PROVIDER,
        timestamp: new Date().toISOString(),
      });
    } else if (isSmtp && smtpHost) {
      // Use Gmail/SMTP
      info = await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to,
        subject,
        html,
        text,
      });

      console.log('✅ Email sent successfully via Gmail:', {
        messageId: info.messageId,
        to,
        subject,
        duration: `${Date.now() - startTime}ms`,
        host: process.env.EMAIL_HOST,
        port: port,
        timestamp: new Date().toISOString(),
      });
    } else {
      throw new Error(`Email provider '${EMAIL_PROVIDER}' not configured properly`);
    }

    return info;
  } catch (error) {
    const duration = Date.now() - startTime;

    console.error('❌ Email sending failed:', {
      error: error.message,
      code: error.code,
      provider: EMAIL_PROVIDER,
      to,
      subject,
      duration: `${duration}ms`,
      isRender,
      timestamp: new Date().toISOString(),
    });

    throw new Error(`Failed to send email: ${error.message}`);
  }
}

module.exports = { sendEmail, getEmailConfigIssues, EMAIL_PROVIDER };
