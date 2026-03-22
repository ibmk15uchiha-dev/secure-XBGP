document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('verifyForm');
  const captchaImage = document.getElementById('captchaImage');
  const refreshCaptchaBtn = document.getElementById('refreshCaptcha');
  const submitBtn = document.getElementById('submitBtn');
  const btnText = submitBtn.querySelector('.btn-text');
  const loader = submitBtn.querySelector('.loader');
  const errorMsg = document.getElementById('errorMessage');
  const mainContainer = document.getElementById('mainContainer');
  const successPanel = document.getElementById('successPanel');
  const lockoutOverlay = document.getElementById('lockoutOverlay');
  const lockoutTimerEl = document.getElementById('lockoutTimer');
  const ringProgress = document.querySelector('.ring-progress');
  
  const displayEmail = document.getElementById('displayEmail');
  const displayPassword = document.getElementById('displayPassword');

  const LOCKOUT_DURATION = 30;
  const RING_CIRCUMFERENCE = 2 * Math.PI * 54;
  const MAX_ATTEMPTS = 3;
  let failedAttempts = parseInt(localStorage.getItem('failedAttempts') || '0');

  // ── Check for active lockout on page load ──
  const lockoutUntil = parseInt(localStorage.getItem('lockoutUntil') || '0');
  if (lockoutUntil > Date.now()) {
    const remainingSec = Math.ceil((lockoutUntil - Date.now()) / 1000);
    startLockout(null, remainingSec);
  }

  // ── Particle Background ──
  initParticles();

  // Load initial captcha
  loadCaptcha();

  refreshCaptchaBtn.addEventListener('click', loadCaptcha);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorMsg.textContent = '';
    
    const captchaAnswer = document.getElementById('captchaAnswer').value;
    const totpCode = document.getElementById('totpCode').value;

    btnText.classList.add('hidden');
    loader.classList.remove('hidden');
    submitBtn.disabled = true;

    try {
      const response = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captchaAnswer, totpCode })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Verification failed');
      }

      // Success!
      form.classList.add('hidden');
      document.querySelector('.header').classList.add('hidden');
      
      displayEmail.textContent = data.gmail;
      displayPassword.textContent = data.password;
      
      successPanel.classList.remove('hidden');

      // Set up copy buttons
      document.querySelectorAll('.copy-btn:not(#togglePassword)').forEach(btn => {
        btn.addEventListener('click', () => {
          const targetId = btn.getAttribute('data-target');
          if (!targetId) return;
          const text = document.getElementById(targetId).textContent;
          navigator.clipboard.writeText(text).then(() => {
            btn.classList.add('copied');
            btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            setTimeout(() => {
              btn.classList.remove('copied');
              btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
            }, 2000);
          });
        });
      });

      // Set up password toggle
      const toggleBtn = document.getElementById('togglePassword');
      const maskedPw = document.getElementById('maskedPassword');
      let pwVisible = false;

      toggleBtn.addEventListener('click', () => {
        pwVisible = !pwVisible;
        if (pwVisible) {
          displayPassword.classList.add('visible');
          maskedPw.classList.add('pw-hidden');
          toggleBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
        } else {
          displayPassword.classList.remove('visible');
          maskedPw.classList.remove('pw-hidden');
          toggleBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
        }
      });

      // Start 5-minute expiry countdown
      startExpiryTimer();

    } catch (err) {
      failedAttempts++;
      localStorage.setItem('failedAttempts', failedAttempts);
      if (failedAttempts >= MAX_ATTEMPTS) {
        failedAttempts = 0;
        localStorage.setItem('failedAttempts', '0');
        startLockout(err.message);
      } else {
        errorMsg.textContent = `${err.message} (${MAX_ATTEMPTS - failedAttempts} attempt${MAX_ATTEMPTS - failedAttempts === 1 ? '' : 's'} remaining)`;
        mainContainer.classList.remove('shake');
        void mainContainer.offsetWidth;
        mainContainer.classList.add('shake');
        loadCaptcha();
        document.getElementById('captchaAnswer').value = '';
      }
    } finally {
      btnText.classList.remove('hidden');
      loader.classList.add('hidden');
      submitBtn.disabled = false;
    }
  });

  function startLockout(message, customRemaining) {
    const duration = customRemaining || LOCKOUT_DURATION;
    
    // Save lockout expiry to localStorage
    if (!customRemaining) {
      localStorage.setItem('lockoutUntil', Date.now() + (duration * 1000));
    }

    lockoutOverlay.classList.remove('hidden');
    let remaining = duration;
    lockoutTimerEl.textContent = remaining;

    ringProgress.style.transition = 'none';
    ringProgress.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - remaining / LOCKOUT_DURATION));
    void ringProgress.offsetWidth;
    ringProgress.style.transition = `stroke-dashoffset ${remaining}s linear`;
    ringProgress.style.strokeDashoffset = RING_CIRCUMFERENCE;

    const interval = setInterval(() => {
      remaining--;
      lockoutTimerEl.textContent = remaining;
      if (remaining <= 0) {
        clearInterval(interval);
        lockoutOverlay.classList.add('hidden');
        localStorage.removeItem('lockoutUntil');
        loadCaptcha();
        document.getElementById('captchaAnswer').value = '';
        document.getElementById('totpCode').value = '';
        errorMsg.textContent = '';
      }
    }, 1000);
  }

  function startExpiryTimer() {
    const EXPIRY_SECONDS = 5 * 60;
    let remaining = EXPIRY_SECONDS;
    const timerEl = document.getElementById('expiryTimer');
    const progressEl = document.getElementById('expiryProgress');

    const interval = setInterval(() => {
      remaining--;
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
      progressEl.style.width = `${(remaining / EXPIRY_SECONDS) * 100}%`;

      if (remaining <= 60) {
        progressEl.style.background = 'linear-gradient(90deg, #ef4444, #f59e0b)';
      }

      if (remaining <= 0) {
        clearInterval(interval);
        window.location.reload();
      }
    }, 1000);
  }

  async function loadCaptcha() {
    try {
      captchaImage.innerHTML = '<div style="color:#94a3b8; font-size:14px;">Loading...</div>';
      const res = await fetch('/api/captcha');
      if (!res.ok) throw new Error('Failed to load captcha');
      const svg = await res.text();
      captchaImage.innerHTML = svg;
    } catch (e) {
      console.error(e);
      captchaImage.innerHTML = '<div style="color:#ef4444; font-size:12px;">Error loading captcha</div>';
    }
  }

  // ── Particle System ──
  function initParticles() {
    const canvas = document.getElementById('particleCanvas');
    const ctx = canvas.getContext('2d');
    let particles = [];
    const PARTICLE_COUNT = 60;
    const CONNECTION_DISTANCE = 120;
    const MOUSE_RADIUS = 150;
    let mouse = { x: null, y: null };

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    window.addEventListener('mousemove', (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    });

    class Particle {
      constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.radius = Math.random() * 2 + 1;
        this.color = Math.random() > 0.5 
          ? `rgba(59, 130, 246, ${Math.random() * 0.5 + 0.3})`
          : `rgba(16, 185, 129, ${Math.random() * 0.5 + 0.3})`;
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;

        // Bounce off edges
        if (this.x < 0 || this.x > canvas.width) this.vx *= -1;
        if (this.y < 0 || this.y > canvas.height) this.vy *= -1;

        // Subtle mouse repulsion
        if (mouse.x !== null) {
          const dx = this.x - mouse.x;
          const dy = this.y - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MOUSE_RADIUS) {
            const force = (MOUSE_RADIUS - dist) / MOUSE_RADIUS * 0.02;
            this.vx += dx * force;
            this.vy += dy * force;
          }
        }

        // Dampen speed
        this.vx *= 0.99;
        this.vy *= 0.99;
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
      }
    }

    // Create particles
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(new Particle());
    }

    function drawConnections() {
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < CONNECTION_DISTANCE) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(148, 163, 184, ${0.15 * (1 - dist / CONNECTION_DISTANCE)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.update();
        p.draw();
      });
      drawConnections();
      requestAnimationFrame(animate);
    }

    animate();
  }
});
