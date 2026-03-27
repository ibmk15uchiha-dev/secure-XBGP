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

// ── Step 3: Get Credentials (after warning) ──
app.post('/api/get-credentials', (req, res) => {
  if (!req.session.passwordVerified) {
    logAccess(req, 'FAIL', 'Credentials request without password verification');
    return res.status(403).json({ error: 'Complete previous steps first.' });
  }

  req.session.totpVerified = false;
  req.session.passwordVerified = false;

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  logAccess(req, 'SUCCESS', `All necessary steps passed. Credentials revealed to IP: ${ip}`);
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
