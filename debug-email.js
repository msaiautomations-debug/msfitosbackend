// Email debugging script for Render
const nodemailer = require('nodemailer');
const dns = require('dns');
require('dotenv').config();

function ipv4FirstLookup(hostname, options, callback) {
  const normalizedOptions = typeof options === 'function' ? {} : (options || {});
  const done = typeof options === 'function' ? options : callback;

  dns.resolve4(hostname, (resolveErr, addresses) => {
    if (!resolveErr && Array.isArray(addresses) && addresses.length > 0) {
      done(null, addresses[0], 4);
      return;
    }

    dns.lookup(hostname, { ...normalizedOptions, family: 4 }, (lookupErr, address, family) => {
      if (!lookupErr) {
        done(null, address, family);
        return;
      }

      dns.lookup(hostname, normalizedOptions, done);
    });
  });
}

async function debugEmailConnection() {
  console.log('🔍 Starting email connection debug...');
  console.log('Environment:', {
    NODE_ENV: process.env.NODE_ENV,
    RENDER: process.env.RENDER,
    EMAIL_HOST: process.env.EMAIL_HOST,
    EMAIL_PORT: process.env.EMAIL_PORT,
    EMAIL_SECURE: process.env.EMAIL_SECURE,
    EMAIL_USER: process.env.EMAIL_USER ? 'SET' : 'NOT SET',
    EMAIL_PASS: process.env.EMAIL_PASS ? 'SET' : 'NOT SET',
  });

  const port = Number(process.env.EMAIL_PORT || 587);
  const secureEnv = String(process.env.EMAIL_SECURE || '').toLowerCase();
  const secure = secureEnv === 'true' || port === 465;
  const isRender = process.env.RENDER || process.env.NODE_ENV === 'production';

  console.log('Configuration:', {
    port,
    secure,
    isRender,
    tlsFamily: 4,
    connectionTimeout: isRender ? 30000 : 60000,
    pool: !isRender,
  });

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port,
    secure,
    family: isRender ? 4 : undefined,
    ...(process.env.EMAIL_HOST ? { lookup: ipv4FirstLookup } : {}),
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    tls: {
      rejectUnauthorized: false,
    },
    connectionTimeout: isRender ? 30000 : 60000,
    greetingTimeout: isRender ? 15000 : 30000,
    socketTimeout: isRender ? 30000 : 60000,
    pool: !isRender,
    maxConnections: isRender ? 1 : 5,
    debug: true,
    logger: true,
  });

  try {
    console.log('⏳ Testing transporter verification...');
    const result = await transporter.verify();
    console.log('✅ Transporter verification successful:', result);

    console.log('⏳ Testing actual email send...');
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_USER, // Send to self for testing
      subject: 'Render Email Test',
      text: 'This is a test email from Render deployment.',
      html: '<p>This is a <strong>test email</strong> from Render deployment.</p>',
    });

    console.log('✅ Email sent successfully:', {
      messageId: info.messageId,
      response: info.response,
    });

  } catch (error) {
    console.error('❌ Email test failed:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall,
      hostname: error.hostname,
      command: error.command,
      stack: error.stack,
    });

    // Additional debugging for common issues
    if (error.code === 'ECONNREFUSED') {
      console.log('💡 ECONNREFUSED: Check if SMTP port is blocked by Render');
    } else if (error.code === 'ENOTFOUND') {
      console.log('💡 ENOTFOUND: DNS resolution failed for SMTP host');
    } else if (error.code === 'ETIMEDOUT') {
      console.log('💡 ETIMEDOUT: Connection timeout - network or firewall issue');
    } else if (error.code === 'EAUTH') {
      console.log('💡 EAUTH: Authentication failed - check email credentials');
    }
  }
}

debugEmailConnection();
