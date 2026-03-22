const { generateSecret, generateURI } = require('otplib');
const qrcode = require('qrcode');

// Generate a random base32 secret
const secret = generateSecret();

console.log('==================================================');
console.log('STEP 1: Save this secret exactly as it is to your .env file:');
console.log(`TOTP_SECRET=${secret}`);
console.log('==================================================');
console.log('');
console.log('STEP 2: Scan the QR code below with your Google Authenticator App:');

const user = 'Admin';
const service = 'XBGP port';
const otpauth = generateURI({ issuer: service, label: user, secret });

// Generate QR code to terminal
qrcode.toString(otpauth, { type: 'terminal', small: true }, function (err, url) {
  if (err) {
    console.error('Error generating QR code', err);
    return;
  }
  console.log(url);
  console.log('==================================================');
  console.log('Once you have saved the TOTP_SECRET in .env and scanned the QR code,');
  console.log('you can start the server with: node server.js');
  console.log('==================================================');
});
