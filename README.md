# 🛡️ Secure Credentials Portal

A robust, animated, and highly secure web portal designed to protect sensitive credentials (like emails and passwords) behind a multi-layered verification system. 

Credentials are encrypted serverside and strictly gated behind an active Captcha challenge and a time-based Google Authenticator (TOTP) code. Built with maximum security and a premium "glassmorphism" user experience.

## ✨ Features

- **Multi-Factor Authentication (MFA)**: Requires a dynamic math captcha + 6-digit TOTP code via an Authenticator App.
- **One-Time Code Locking**: Once a TOTP code is used successfully, it cannot be reused (prevents replay attacks).
- **Anti-Bruteforce Lockout**: After 3 failed attempts, the frontend locks down entirely with a 30-second animated timer.
- **Server Rate Limiting**: Max 5 attempts per minute per IP to block automated cracking.
- **Time-Bomb Sessions**: Credentials auto-expire and hide themselves after 5 minutes of viewing.
- **Dynamic Particles**: Beautiful, physics-based canvas background that reacts to cursor proximity.
- **Access Logging**: Every single verification attempt (success or failure) is logged serverside with timestamps and IP addresses.
- **HTTPS & Copy Tools**: Built-in support for encrypted HTTPS out-of-the-box, plus hidden password toggles and encrypted clipboard copy buttons.

---

## 🚀 Setup & Installation

### 1. Clone the repository
\`\`\`bash
git clone https://github.com/your-username/secure-portal.git
cd secure-portal
\`\`\`

### 2. Install Dependencies
\`\`\`bash
npm install
\`\`\`

### 3. Generate your TOTP Secret
Run the setup script to generate a unique Google Authenticator secret and QR code.
\`\`\`bash
node setup.js
\`\`\`
*(Scan the QR code printed in the terminal using your Google Authenticator or Authy app)*

### 4. Configure Environment
Copy the example environment file:
\`\`\`bash
cp .env.example .env
\`\`\`
Then, edit the \`.env\` file to match the output from the \`setup.js\` script along with the actual credentials you want to protect:

\`\`\`env
# The secret string given to you by node setup.js
TOTP_SECRET=your_secret_here

# The credentials you are hiding behind the portal
GMAIL=your_email@gmail.com
PASSWORD=your_super_secret_password

# A random string to sign cookies
SESSION_SECRET=super_secret_session_key
\`\`\`

---

## 🏃‍♂️ Running the Server

Start the node server (this automatically generates self-signed SSL certs for HTTPS):
\`\`\`bash
node server.js
\`\`\`

The portal is now running locally!
- HTTP: \`http://localhost:3000\`
- HTTPS: \`https://localhost:3443\`

---

## ☁️ Deploying to Render (24/7 Cloud)

1. Fork or upload this repository to your own GitHub account (**Do NOT upload your `.env` file!**).
2. Go to [Render.com](https://render.com) and create a **Web Service**.
3. Link your GitHub repository.
4. Set Build Command: \`npm install\`
5. Set Start Command: \`node server.js\`
6. Go to **Advanced** > **Environment Variables** and add your 4 secrets (\`GMAIL\`, \`PASSWORD\`, \`TOTP_SECRET\`, \`SESSION_SECRET\`).
7. Deploy! Your portal is now public and protected 24/7.

---
*Built tightly for personal remote credential sharing.*
