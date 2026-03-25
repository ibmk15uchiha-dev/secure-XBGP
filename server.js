require('dotenv').config();
const express = require('express');
const session = require('express-session');
const svgCaptcha = require('svg-captcha');
const { verifySync } = require('otplib');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// ── Master Password (hardcoded constant) ──
const MASTER_PASSWORD = '(OgXXX9#c"cw?twez%0-09|~gZ?wdSAScv2(*.';

// ── Ensure logs directory exists ──
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// ── One-Time View: Track used TOTP codes ──
const usedCodes = new Map(); // code -> expiry timestamp
function cleanupUsedCodes() {
  const now = Date.now();
  for (const [code, expiry] of usedCodes) {
    if (now > expiry) usedCodes.delete(code);
  }
}
setInterval(cleanupUsedCodes, 30000); // cleanup every 30s

// ── One-Time Email: Track emails that already accessed credentials (persisted) ──
const usedEmailsFile = path.join(logsDir, 'used_emails.json');
let usedEmails = new Set();
try {
  if (fs.existsSync(usedEmailsFile)) {
    usedEmails = new Set(JSON.parse(fs.readFileSync(usedEmailsFile, 'utf-8')));
  }
} catch (e) { /* ignore corrupt file */ }

function saveUsedEmails() {
  fs.writeFileSync(usedEmailsFile, JSON.stringify([...usedEmails], null, 2));
}

// Trust proxy (needed for localtunnel / reverse proxies)
app.set('trust proxy', 1);

// ── Rate Limiters ──
const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: { error: 'Too many attempts. Please wait 1 minute before trying again.' }
});

const passwordLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: { error: 'Too many password attempts. Please wait 1 minute.' }
});

const emailLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many email requests. Please wait 1 minute.' });
  }
});

// ── IP Logging Helper ──
function logAccess(req, status, detail) {
  const timestamp = new Date().toISOString();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'unknown';
  const line = `[${timestamp}] IP: ${ip} | Status: ${status} | Detail: ${detail} | UA: ${userAgent}\n`;
  fs.appendFileSync(path.join(logsDir, 'access.log'), line);
  console.log(line.trim());
}

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'super_secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// ── Step 1: Captcha + TOTP Verification ──
app.get('/api/captcha', (req, res) => {
  const captcha = svgCaptcha.createMathExpr({
    mathMin: 1,
    mathMax: 9,
    mathOperator: '+',
    color: true,
    noise: 2
  });
  
  req.session.captchaAnswer = captcha.text;
  
  res.type('svg');
  res.status(200).send(captcha.data);
});

app.post('/api/verify', verifyLimiter, (req, res) => {
  const { captchaAnswer, totpCode } = req.body;
  
  // 1. Verify Captcha
  if (!req.session.captchaAnswer || captchaAnswer !== req.session.captchaAnswer) {
    logAccess(req, 'FAIL', `Incorrect captcha | TOTP: ${totpCode || 'N/A'}`);
    return res.status(401).json({ error: 'Incorrect Captcha' });
  }

  // 2. Verify TOTP
  const secret = process.env.TOTP_SECRET;
  if (!secret) {
    logAccess(req, 'ERROR', 'TOTP_SECRET not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const result = verifySync({ secret, token: totpCode });
  
  if (!result.valid) {
    req.session.captchaAnswer = null;
    logAccess(req, 'FAIL', `Incorrect 2FA code | TOTP: ${totpCode}`);
    return res.status(401).json({ error: 'Incorrect 2FA Code' });
  }

  // 3. One-Time View: Check if code was already used
  if (usedCodes.has(totpCode)) {
    req.session.captchaAnswer = null;
    logAccess(req, 'FAIL', `Code already used (one-time view) | TOTP: ${totpCode}`);
    return res.status(401).json({ error: 'This code has already been used. Wait for a new code.' });
  }

  // Mark code as used for 90 seconds
  usedCodes.set(totpCode, Date.now() + 90000);

  // Success — mark session as TOTP verified (don't return credentials yet)
  req.session.captchaAnswer = null;
  req.session.totpVerified = true;
  logAccess(req, 'STEP1_OK', `TOTP verified | TOTP: ${totpCode}`);
  res.json({ success: true, message: 'TOTP verified. Enter the master password.' });
});

// ── Step 2: Master Password Verification ──
app.post('/api/verify-password', passwordLimiter, (req, res) => {
  if (!req.session.totpVerified) {
    logAccess(req, 'FAIL', 'Password attempt without TOTP verification');
    return res.status(403).json({ error: 'Complete TOTP verification first.' });
  }

  const { password } = req.body;

  if (password !== MASTER_PASSWORD) {
    logAccess(req, 'FAIL', 'Incorrect master password');
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  req.session.passwordVerified = true;
  logAccess(req, 'STEP2_OK', 'Master password verified');
  res.json({ success: true, message: 'Password verified. Proceed to email verification.' });
});

// ── Step 3a: Send Email Verification Code ──
app.post('/api/send-email-code', emailLimiter, async (req, res) => {
  if (!req.session.passwordVerified) {
    logAccess(req, 'FAIL', 'Email code request without password verification');
    return res.status(403).json({ error: 'Complete password verification first.' });
  }

  const { email } = req.body;

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  // One-time email: check if this email was already used
  if (usedEmails.has(email.toLowerCase())) {
    logAccess(req, 'FAIL', `Email already used: ${email}`);
    return res.status(403).json({ error: 'This email has already been used to access credentials.' });
  }

  // Generate 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  req.session.emailCode = code;
  req.session.emailCodeExpiry = Date.now() + 5 * 60 * 1000; // 5 min expiry
  req.session.verificationEmail = email;

  try {
    const response = await fetch(process.env.GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: email,
        subject: '🔐 Your Verification Code — Secure Credentials Portal',
        htmlBody: `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #0f172a; color: #f8fafc; border-radius: 16px; overflow: hidden;">
            <div style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); padding: 32px; text-align: center;">
              <h2 style="margin: 0; color: #ffffff; font-size: 24px;">Verification Required</h2>
            </div>
            <div style="padding: 32px; background: #1e293b;">
              <p style="font-size: 16px; color: #cbd5e1; line-height: 1.5;">You requested access to the secure credentials portal. Please use the following 6-digit verification code to proceed:</p>
              <div style="background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 16px; text-align: center; margin: 24px 0;">
                <span style="font-family: monospace; font-size: 32px; font-weight: bold; color: #38bdf8; letter-spacing: 4px;">${code}</span>
              </div>
              <p style="font-size: 14px; color: #94a3b8; text-align: center; margin-bottom: 0;">This code expires in 5 minutes.</p>
            </div>
          </div>
        `
      })
    });

    const result = await response.json();
    if (result.error) throw new Error(result.error);

    logAccess(req, 'STEP3_SENT', `Email code sent to ${email} (via App Script)`);
    res.json({ success: true, message: 'Verification code sent! Check your inbox.' });
  } catch (err) {
    console.error('Email send error:', err);
    logAccess(req, 'ERROR', `Failed to send email to ${email}: ${err.message}`);
    res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }
});

// ── Step 3b: Verify Email Code ──
app.post('/api/verify-email-code', (req, res) => {
  if (!req.session.passwordVerified) {
    logAccess(req, 'FAIL', 'Email code verify without password verification');
    return res.status(403).json({ error: 'Complete previous steps first.' });
  }

  const { code } = req.body;

  // Check expiry
  if (!req.session.emailCode || Date.now() > req.session.emailCodeExpiry) {
    logAccess(req, 'FAIL', 'Email code expired or missing');
    return res.status(401).json({ error: 'Code expired. Please request a new one.' });
  }

  if (code !== req.session.emailCode) {
    logAccess(req, 'FAIL', `Incorrect email code | Submitted: ${code}`);
    return res.status(401).json({ error: 'Incorrect verification code.' });
  }

  // All steps passed! Mark email as used and return credentials
  const verifiedEmail = req.session.verificationEmail;
  usedEmails.add(verifiedEmail.toLowerCase());
  saveUsedEmails();
  req.session.emailCode = null;
  req.session.totpVerified = false;
  req.session.passwordVerified = false;

  logAccess(req, 'SUCCESS', `All 3 steps passed. Credentials revealed to ${verifiedEmail}`);
  res.json({
    gmail: process.env.GMAIL || 'not_configured@gmail.com',
    password: process.env.PASSWORD || 'not_configured'
  });
});

// ── Start HTTP Server ──
http.createServer(app).listen(PORT, () => {
  console.log(`  HTTP  → http://localhost:${PORT}`);
});

// ── Start HTTPS Server (self-signed) ──
(async () => {
  try {
    const selfsigned = require('selfsigned');
    const certDir = path.join(__dirname, 'certs');
    const certPath = path.join(certDir, 'cert.pem');
    const keyPath = path.join(certDir, 'key.pem');

    let cert, key;

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      cert = fs.readFileSync(certPath, 'utf-8');
      key = fs.readFileSync(keyPath, 'utf-8');
    } else {
      console.log('  Generating self-signed SSL certificate...');
      const attrs = [{ name: 'commonName', value: 'localhost' }];
      const pems = await selfsigned.generate(attrs, { days: 365 });

      if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });

      cert = pems.cert || pems.certificate;
      key = pems.private || pems.key || pems.clientprivate;

      fs.writeFileSync(certPath, cert);
      fs.writeFileSync(keyPath, key);
    }

    https.createServer({ cert, key }, app).listen(HTTPS_PORT, () => {
      console.log(`  HTTPS → https://localhost:${HTTPS_PORT}`);
    });
  } catch (e) {
    console.log('  HTTPS error:', e.message);
  }
})();
