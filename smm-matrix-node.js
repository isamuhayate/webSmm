/**
 * smm-matrix-node.js
 * Single-file fullstack app (Node.js + Express + SQLite)
 * Final enhanced version:
 * - Fixed SQL quoting (no more no such column "cancelled")
 * - Role-based dashboards (admin / staff / user)
 * - Staff UI: create staff, promote/demote, delete users
 * - Staff panel: user-list hides when user detail expanded
 * - Admin dashboard: total accounting, users, pending offers, declined/cancelled, subscribers
 * - Improved homepage (hero image, features, testimonials with avatars)
 * - Colorful animated pricing with tooltip positioning script included
 * - Additional seeded blog posts & reviews
 *
 * Run:
 *   npm i express better-sqlite3 cookie-session marked
 *   node smm-matrix-node.js
 */

const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const cookieSession = require('cookie-session');
const { marked } = require('marked');

const app = express();
const db = new Database(process.env.DB_FILE || 'smm_matrix_complete.db');
const APP_TITLE = 'SMM Matrix';

// Use a reliable unsplash hero in case other host blocks
const HERO_MAIN = 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?q=80&w=1400&auto=format&fit=crop';
const HERO_MASK = 'https://images.unsplash.com/photo-1504198458649-3128b932f49f?q=80&w=1400&auto=format&fit=crop';

// -------------------------- Middlewares --------------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(cookieSession({
  name: 'smm_sess',
  secret: process.env.SMM_SECRET || 'devsecret',
  httpOnly: true,
  maxAge: 24 * 60 * 60 * 1000
}));

// -------------------------- Helpers --------------------------
function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }
function currency(v, ccy = 'USD') {
  const rates = { USD: 1, EUR: 0.92, GBP: 0.78 };
  const symbols = { USD: '$', EUR: '€', GBP: '£' };
  const x = Number(v || 0) * (rates[ccy] || 1);
  return `${symbols[ccy] || '$'}${Number.isInteger(x) ? x : x.toFixed(2)}`;
}
function authed(req) {
  return req.session && req.session.uid ? db.prepare('SELECT * FROM users WHERE id=?').get(req.session.uid) : null;
}
function requireRole(req, res, roles) {
  const u = authed(req);
  if (!u || !roles.includes(u.role)) {
    if (req.headers.accept && req.headers.accept.includes('text/html')) return res.redirect('/login');
    return res.status(403).send('Forbidden');
  }
  return u;
}

// -------------------------- DB Schema & Seeding ------------------------
function initDb() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT,
    role TEXT DEFAULT 'user',
    instagram TEXT,
    unsubscribed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT,
    image TEXT,
    excerpt TEXT,
    body TEXT,
    views INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    price_usd REAL,
    features TEXT
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    plan_id INTEGER,
    ig_username TEXT,
    notes TEXT,
    status TEXT DEFAULT 'pending', -- pending, paid, declined, cancelled
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    stars INTEGER,
    content TEXT,
    avatar TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    email TEXT,
    instagram TEXT,
    subject TEXT,
    message TEXT,
    status TEXT DEFAULT 'open',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    likes INTEGER DEFAULT 0,
    follows INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    niche TEXT,
    competitors TEXT,
    hashtags TEXT,
    geo TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS statuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE,
    following_status TEXT DEFAULT 'Select status',
    like_enabled INTEGER DEFAULT 0,
    follow_enabled INTEGER DEFAULT 1,
    comment_enabled INTEGER DEFAULT 0,
    dm_enabled INTEGER DEFAULT 0,
    hashtags TEXT DEFAULT '',
    team_complaint TEXT DEFAULT '',
    client_complaint TEXT DEFAULT '',
    complaint_explanation TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  `);

  // seed demo users
  const ensure = db.prepare('INSERT OR IGNORE INTO users(email,password_hash,name,role,instagram) VALUES (?,?,?,?,?)');
  ensure.run('admin@smm.local', sha256('admin123'), 'Admin', 'admin', '@admin');
  ensure.run('staff@smm.local', sha256('staff123'), 'Team Member', 'staff', '@staff');
  ensure.run('user@smm.local',  sha256('user123'),  'Demo User', 'user', '@demouser');

  // seed plans
if (!db.prepare('SELECT COUNT(*) c FROM plans').get().c) {
  const seed = db.prepare('INSERT INTO plans(name,price_usd,features) VALUES (?,?,?)');
  [
    ['Kickoff Plan', 49, JSON.stringify(['600 - 800+ Real followers','Growth pods network','Guaranteed results','Real-time growth analytics','24/7 Live support'])],
    ['Growth Plan', 69, JSON.stringify(['800 - 1,200+ Real & Organic followers','Growth pods network','Targeted AI growth','Account and hashtag targeting','Guaranteed results','Real-time growth analytics','24/7 Live support'])],
    ['Advanced Plan', 129, JSON.stringify(['1,200 - 1,600+ Real & Organic followers','Growth pods network','Targeted AI growth','Account and hashtag targeting','10x your engagement','Turn followers into conversions','Guaranteed results'])]
  ].forEach(p => seed.run(...p));
}

  // seed posts (add more)
  if (!db.prepare('SELECT COUNT(*) c FROM posts').get().c) {
    const seedP = db.prepare('INSERT INTO posts(title,author,image,excerpt,body) VALUES (?,?,?,?,?)');
    const posts = [
      ['AI-Powered Instagram Growth: The Future is Now','Sarah Chen','https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200','Discover how AI is revolutionizing Instagram marketing with predictive analytics and automated optimization.','# The AI Revolution\n\nAI optimizes hashtags, posting time and audience segments.'],
      ['From 1K to 100K: Real Growth Stories','Marcus Rodriguez','https://images.unsplash.com/photo-1611224923853-80b023f02d71?w=1200','Real case studies of accounts that achieved massive organic growth using our strategies.','# Case Studies\n\nFashion brand scaled from 1.2k to 95k followers.'],
      ['Instagram Algorithm Mastery Guide 2024','Emma Johnson','https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=1200','Inside look at Instagram\'s algorithm and how to make it work for your growth.','# Algorithm Guide\n\nEngagement, consistency, reels — the pillars.'],
      ['Turning Followers into Customers: Conversion Strategies','David Park','https://images.unsplash.com/photo-1556761175-b413da4baf72?w=1200','Learn how to transform your Instagram following into a profitable customer base.','# Conversion Strategies\n\nStory CTAs, product tags & landing pages.'],
      ['Influencer Marketing: Partnership Strategies','Lisa Thompson','https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=1200','Building authentic partnerships that drive real results.','# Partnerships\n\nMicro-influencers often outperform macros on ROI.'],
      ['Reels That Go Viral: Creative Playbook','Hannah Lee','https://images.unsplash.com/photo-1504593811423-6dd665756598?w=1200','Structure, sound, and hooks that make Reels perform.','# Reels Playbook\n\nHook — Visual — CTA: Repeatable pattern for virality.']
    ];
    posts.forEach(p => seedP.run(...p));
  }

  // seed reviews with avatars
  if (!db.prepare('SELECT COUNT(*) c FROM reviews').get().c) {
    const seedR = db.prepare('INSERT INTO reviews(name,stars,content,avatar) VALUES (?,?,?,?)');
    [
      ['Alexandra Johnson', 5, 'SMM Matrix transformed our Instagram presence: 2K → 15K followers in 3 months.', 'https://i.pravatar.cc/150?img=11'],
      ['Michael Chen', 5, 'Great hashtag strategy and timing. Reach up 400% in month 1.', 'https://i.pravatar.cc/150?img=12'],
      ['Sarah Williams', 5, 'Professional service with real results and responsive support.', 'https://i.pravatar.cc/150?img=13'],
      ['David Rodriguez', 4, 'Good communication and steady organic growth.', 'https://i.pravatar.cc/150?img=14'],
      ['Emily Davis', 5, 'My travel blog blew up — 25K followers in 4 months!', 'https://i.pravatar.cc/150?img=15'],
      ['Robert Kim', 5, 'Dedicated manager and tailored strategy — highly recommended.', 'https://i.pravatar.cc/150?img=16']
    ].forEach(r => seedR.run(...r));
  }

  // ensure statuses/targets/metrics for each user
  const ids = db.prepare('SELECT id FROM users').all().map(r => r.id);
  const insStatus = db.prepare('INSERT OR IGNORE INTO statuses(user_id) VALUES (?)');
  const insTargets = db.prepare('INSERT OR IGNORE INTO targets(user_id,niche,competitors,hashtags,geo,notes) VALUES(?,?,?,?,?,?)');
  const insMetrics = db.prepare('INSERT OR IGNORE INTO metrics(user_id,likes,follows) VALUES (?,?,?)');
  ids.forEach(id => {
    insStatus.run(id);
    insTargets.run(id, 'Fitness & Wellness', '@nike @adidas', '#fitness #workout', 'United States', 'Target: 18-35 health conscious');
    insMetrics.run(id, Math.floor(Math.random()*200)+50, Math.floor(Math.random()*100)+20);
  });
}
initDb();

// -------------------------- Layout ---------------------------
function layout({ title = 'Home', user, content, meta = {} }) {
  const year = new Date().getFullYear();
  const desc = meta.description || 'Grow your social media with real followers and ethical tactics.';
  const img = meta.image || HERO_MAIN;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} • ${APP_TITLE}</title>
<meta name="description" content="${escapeHtml(desc)}" />
<meta property="og:title" content="${escapeHtml(title)} • ${APP_TITLE}" />
<meta property="og:description" content="${escapeHtml(desc)}" />
<meta property="og:image" content="${img}" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><text y='48' font-size='48'>📈</text></svg>">
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js" defer></script>

<style>
  /* Reusable visuals */
  .hero-thumbs{ width:420px; height:420px; border-radius:18px; overflow:hidden; display:block; background-repeat:no-repeat; background-position:center; background-size:cover; transition:transform 0.35s ease; }
  .hero-thumbs:hover{ transform:scale(1.035); }
  @media (max-width:768px){ .hero-thumbs{ width:320px; height:320px } }
  .gradient-text { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  .floating { animation: floating 3s ease-in-out infinite; }
  @keyframes floating { 0% { transform: translate(0, 0px); } 50% { transform: translate(0, -10px); } 100% { transform: translate(0, -0px); } }
  .glow-card { transition: all 0.28s ease; }
  .glow-card:hover { box-shadow: 0 18px 30px rgba(99,102,241,0.12); transform: translateY(-6px); }
  .pricing-card { transition: transform .25s ease, box-shadow .25s ease; border-radius: 16px; overflow: hidden; }
  .pricing-card:hover { transform: translateY(-8px); box-shadow: 0 30px 50px rgba(2,6,23,0.12); }
  /* tooltip visuals */
  .pricing-tooltip { position: absolute; left: 50%; transform: translateX(-50%); min-width: 180px; padding: 10px; border-radius: 8px; background: #111827; color: #fff; opacity: 0; visibility: hidden; transition: opacity .15s ease; z-index: 50; }
  .pricing-tooltip[data-tooltip-position="top"] { bottom: calc(100% + 8px); }
  .pricing-tooltip[data-tooltip-position="bottom"] { top: calc(100% + 8px); }
  .pricing-tooltip-arrow { width: 10px; height: 10px; position: absolute; left: calc(50% - 5px); transform: rotate(45deg); background: #111827; }
  .pricing-tooltip-arrow[data-tooltip-position="top"] { bottom: -6px; }
  .pricing-tooltip-arrow[data-tooltip-position="bottom"] { top: -6px; }
  /* animation helpers */
  .btn-animated { transition: transform .18s ease, box-shadow .18s ease; }
  .btn-animated:active { transform: translateY(2px) scale(.995); box-shadow: none; }
  /* Pricing Design Styles */
.billing-toggle {
  display: flex;
  justify-content: center;
  margin-bottom: 40px;
}

.toggle-group {
  background: #000;
  border-radius: 25px;
  padding: 4px;
  display: flex;
}

.toggle-btn {
  padding: 8px 20px;
  border: none;
  border-radius: 20px;
  background: transparent;
  color: #999;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.3s ease;
}

.toggle-btn.active {
  background: #fff;
  color: #000;
}

.pricing-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
  margin-top: 40px;
}

.pricing-card {
  background: #fff;
  border-radius: 20px;
  padding: 30px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  position: relative;
  border: 2px solid transparent;
  transition: transform .25s ease, box-shadow .25s ease;
}

.pricing-card.featured {
  border: 2px solid #00ff88;
  transform: scale(1.05);
}

.plan-badge {
  display: inline-block;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: bold;
  text-transform: uppercase;
  margin-bottom: 20px;
}

.kickoff-badge {
  background: #007bff;
  color: white;
}

.growth-badge {
  background: #00ff88;
  color: #000;
}

.advanced-badge {
  background: #ffc107;
  color: #000;
}

.plan-description {
  color: #666;
  font-size: 14px;
  margin-bottom: 30px;
  line-height: 1.5;
}

.price {
  font-size: 48px;
  font-weight: bold;
  color: #000;
  margin-bottom: 5px;
}

.price-period {
  color: #666;
  font-size: 18px;
}

.price-note {
  color: #999;
  font-size: 12px;
  margin-bottom: 30px;
}

.cta-button {
  width: 100%;
  padding: 15px;
  background: #000;
  color: #fff;
  border: none;
  border-radius: 50px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  margin-bottom: 30px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: all 0.3s ease;
}

.cta-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(0,0,0,0.2);
}

.cta-arrow {
  background: #00ff88;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: #000;
}

.features-list {
  list-style: none;
}

.feature-item {
  display: flex;
  align-items: center;
  margin-bottom: 15px;
  font-size: 14px;
}

.feature-check {
  width: 20px;
  height: 20px;
  background: #00ff88;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
  flex-shrink: 0;
}

.feature-check::after {
  content: "✓";
  color: #000;
  font-size: 12px;
  font-weight: bold;
}

.feature-info {
  width: 20px;
  height: 20px;
  background: #f0f0f0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  cursor: pointer;
  color: #999;
  font-size: 12px;
}

.flame-icon {
  position: absolute;
  top: -10px;
  right: 20px;
  font-size: 30px;
}
</style>

</head>
<body class="text-slate-900 antialiased bg-white">
  <nav class="sticky top-0 z-50 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 text-white backdrop-blur-md bg-opacity-95">
    <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
      <a href="/" class="font-extrabold text-xl gradient-text">📈 ${APP_TITLE}</a>
      <div class="hidden sm:flex gap-6 font-semibold">
        ${['/','/about','/faq','/blogs','/services','/contact','/pricing'].map(h=>`<a class="hover:text-purple-200 transition-colors" href="${h}">${h.replace('/','').toUpperCase()||'HOME'}</a>`).join('')}
      </div>
      <div class="flex gap-2">
        ${user?`<a class='px-4 py-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors' href='${user.role==='admin'?'/dashboard':user.role==='staff'?'/staff':'/'}'>${user.role==='admin'?'Dashboard':user.role==='staff'?'Control Panel':'My Account'}</a><a class='px-4 py-2 rounded-lg bg-black/30 hover:bg-black/40 transition-colors' href='/logout'>Logout</a>`:`<a class='px-4 py-2 rounded-lg bg-black/30 hover:bg-black/40 transition-colors' href='/login'>Login</a>`}
      </div>
    </div>
  </nav>

  ${content}

  <footer class="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-slate-300 mt-16">
    <div class="max-w-7xl mx-auto px-4 py-12 grid md:grid-cols-5 gap-8">
      <div>
        <div class="font-bold text-white text-xl gradient-text">${APP_TITLE}</div>
        <div class="text-sm mt-2">🌍 Global Presence</div>
        <div class="text-sm">London • New York • Singapore</div>
        <div class="text-xs mt-4 opacity-75">© <span id="yr">${year}</span> ${APP_TITLE}. All rights reserved.</div>
      </div>
      <div>
        <div class="text-xs uppercase tracking-wide text-slate-400 mb-3">Contact Info</div>
        <div class="space-y-1 text-sm">
          <div>🇬🇧 +44 020 8050 4027</div>
          <div>🇺🇸 +1 (332) 900-7872</div>
          <div>📧 hello@smmmatrix.com</div>
          <div>💬 24/7 Live Support</div>
        </div>
      </div>
      <div>
        <div class="text-xs uppercase tracking-wide text-slate-400 mb-3">Company</div>
        <div class="space-y-2 text-sm">
          <a href="/team" class="block hover:text-purple-300 transition-colors">Our Team</a>
          <a href="/reviews" class="block hover:text-purple-300 transition-colors">Reviews</a>
          <a href="/contact" class="block hover:text-purple-300 transition-colors">Contact Us</a>
          <a href="/careers" class="block hover:text-purple-300 transition-colors">Careers</a>
        </div>
      </div>
      <div>
        <div class="text-xs uppercase tracking-wide text-slate-400 mb-3">Legal</div>
        <div class="space-y-2 text-sm">
          <a href="/terms" class="block hover:text-purple-300 transition-colors">Terms of Service</a>
          <a href="/privacy" class="block hover:text-purple-300 transition-colors">Privacy Policy</a>
          <a href="/refunds" class="block hover:text-purple-300 transition-colors">Refund Policy</a>
          <a href="/cookies" class="block hover:text-purple-300 transition-colors">Cookie Policy</a>
        </div>
      </div>
      <div>
        <div class="text-xs uppercase tracking-wide text-slate-400 mb-3">Stay Updated</div>
        <form method="post" action="/subscribe" class="space-y-3">
          <input name="email" placeholder="Enter your email" class="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 focus:border-purple-500 focus:outline-none transition-colors" />
          <button class="w-full px-3 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-600 text-white hover:from-purple-600 hover:to-indigo-700 transition-all">Subscribe</button>
        </form>
        <div class="text-xs mt-2 opacity-75">Get weekly marketing tips & updates</div>
      </div>
    </div>
  </footer>

<script>
  document.getElementById('yr').textContent = new Date().getFullYear();
  AOS.init({ duration: 700, once: true });

  // Simple button click animation helper
  document.addEventListener('click', function(e){
    const t = e.target.closest('.btn-animated');
    if (t) {
      t.classList.add('active');
      setTimeout(()=> t.classList.remove('active'), 180);
    }
  });

  // Pricing tooltip behaviour (from your snippet)
  window.addEventListener('load', function() {
    const tooltipWrappers = document.querySelectorAll('.pricing-tooltip-wrapper, .compare-pricing-tooltip-wrapper');
    tooltipWrappers.forEach(wrapper => {
      const tooltip = wrapper.querySelector('.pricing-tooltip, .compare-pricing-tooltip');
      const holder = wrapper.querySelector('.pricing-tooltip-holder, .compare-pricing-tooltip-holder');
      const arrow = wrapper.querySelector('.pricing-tooltip-arrow, .compare-pricing-tooltip-arrow');
      if (!tooltip) return;
      const resetTooltipPosition = () => {
        tooltip.removeAttribute('data-tooltip-position');
        if (arrow) arrow.removeAttribute('data-tooltip-position');
        if (holder) holder.removeAttribute('data-tooltip-position');
      };
      wrapper.addEventListener('mouseenter', function() {
        requestAnimationFrame(() => {
          resetTooltipPosition();
          const rect = wrapper.getBoundingClientRect();
          const tooltipHeight = tooltip.offsetHeight;
          const spaceBelow = window.innerHeight - rect.bottom;
          const spaceAbove = rect.top;
          let parentWrapper = wrapper.closest('[data-tooltip-boundary]');
          let wrapperBottomLimit = parentWrapper ? parentWrapper.getBoundingClientRect().bottom : window.innerHeight;
          const fitsBelowScreen = spaceBelow >= tooltipHeight;
          const fitsAboveScreen = spaceAbove >= tooltipHeight;
          const fitsBelowWrapper = rect.bottom + tooltipHeight <= wrapperBottomLimit;
          const position = (!fitsBelowScreen || !fitsBelowWrapper) && fitsAboveScreen ? 'top' : 'bottom';
          tooltip.setAttribute('data-tooltip-position', position);
          if (arrow) arrow.setAttribute('data-tooltip-position', position);
          if (holder) holder.setAttribute('data-tooltip-position', position);
          tooltip.style.opacity = "1";
          tooltip.style.visibility = "visible";
        });
      });
      wrapper.addEventListener('mouseleave', function() {
        tooltip.style.opacity = "0";
        tooltip.style.visibility = "hidden";
      });
    });
  });
</script>

</body>
</html>
`;
}

// -------------------------- Views ---------------------------

// Login / Signup
function LoginView({ user, error }) {
  return layout({ title: 'Login', user, content: `
<section class="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center py-12">
  <div class="max-w-md w-full mx-4">
    <div class="bg-white rounded-2xl shadow-xl p-8 border border-gray-100" data-aos="zoom-in">
      <div class="text-center mb-8">
        <h2 class='text-3xl font-bold text-gray-900'>Welcome Back</h2>
        <p class="text-gray-600 mt-2">Sign in to your SMM Matrix account</p>
      </div>
      ${error ? `<div class='mb-6 p-4 bg-red-50 border border-red-200 rounded-lg'><div class="text-sm font-medium text-red-700">${escapeHtml(error)}</div></div>` : ''}
      <form method="post" class="space-y-4">
        <div>
          <label class="text-sm font-medium text-gray-700">Email</label>
          <input name="email" type="email" required class="w-full mt-1 px-4 py-2 rounded-xl border focus:ring-2 focus:ring-indigo-200" />
        </div>
        <div>
          <label class="text-sm font-medium text-gray-700">Password</label>
          <input name="password" type="password" required class="w-full mt-1 px-4 py-2 rounded-xl border focus:ring-2 focus:ring-indigo-200" />
        </div>
        <button class="w-full px-4 py-3 rounded-xl bg-indigo-600 text-white font-bold btn-animated">Sign In</button>
      </form>
      <div class="text-center mt-4 text-sm text-gray-500">
        No account? <a href="/signup" class="text-indigo-600 hover:underline">Create one</a>
      </div>
    </div>
  </div>
</section>
` });
}

function SignupView({ user, error }) {
  return layout({ title: 'Sign Up', user, content: `
<section class='min-h-screen flex items-center justify-center bg-gradient-to-br from-white to-indigo-50 py-12'>
  <div class='max-w-md w-full mx-4'>
    <div class='bg-white p-8 rounded-2xl shadow border border-gray-100' data-aos="zoom-in">
      <h2 class='text-2xl font-bold mb-4'>Create Account</h2>
      ${error?`<div class='mb-3 p-3 bg-rose-50 border border-rose-100 text-rose-700 rounded'>${escapeHtml(error)}</div>`:''}
      <form method='post' class='space-y-3'>
        <input name='name' placeholder='Name' class='w-full px-3 py-2 rounded-xl border' />
        <input name='email' type='email' placeholder='Email' class='w-full px-3 py-2 rounded-xl border' />
        <input name='instagram' placeholder='Instagram handle (optional)' class='w-full px-3 py-2 rounded-xl border' />
        <input name='password' type='password' placeholder='Password' class='w-full px-3 py-2 rounded-xl border' />
        <button class='w-full px-4 py-3 rounded-xl bg-indigo-600 text-white font-bold btn-animated'>Create</button>
      </form>
      <div class='text-xs text-gray-500 mt-3'>Created accounts are regular users. Admins create staff from admin/staff panel.</div>
    </div>
  </div>
</section>
` });
}

// Home view (improved)
function HomeView({ user, plans, reviews, posts }) {
  const stats = { clients: 2847, projects: 15420, advisors: 156, years: 8 };
  const brands = [
    { name: 'Nike', logo: 'https://logo.clearbit.com/nike.com' },
    { name: 'Spotify', logo: 'https://logo.clearbit.com/spotify.com' },
    { name: 'Airbnb', logo: 'https://logo.clearbit.com/airbnb.com' },
    { name: 'Uber', logo: 'https://logo.clearbit.com/uber.com' },
    { name: 'Shopify', logo: 'https://logo.clearbit.com/shopify.com' },
    { name: 'Tesla', logo: 'https://logo.clearbit.com/tesla.com' }
  ];

  return layout({
    title: 'Home',
    user,
    meta: { description: 'Transform Your Social Media Presence with AI-Powered Growth, Real Results, Authentic Engagement' },
    content: `
<!-- Hero -->
<section class="bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 text-white overflow-hidden relative">
  <div class="absolute inset-0 bg-black/7"></div>
  <div class="max-w-7xl mx-auto px-4 py-20 grid lg:grid-cols-2 gap-12 items-center relative z-10">
    <div data-aos="fade-right">
      <span class="inline-block px-4 py-2 rounded-full bg-white/20 backdrop-blur-sm text-white font-bold border border-white/30 mb-6 floating">✨ WE ARE SMM MATRIX</span>
      <h1 class="text-5xl lg:text-6xl font-extrabold leading-tight mb-4">Transform Your Social Presence — <span class="gradient-text">Real Followers. Real Growth.</span></h1>
      <p class="text-lg text-white/90 max-w-2xl mb-8">AI-driven Instagram growth, influencer matching, content strategy and analytics. We focus on sustainable, authentic growth that turns followers into customers.</p>
      <div class="flex gap-4 mb-6">
        <a href="/pricing" class="px-6 py-3 rounded-2xl bg-white text-indigo-600 font-bold btn-animated">🚀 Start Now</a>
        <a href="/contact" class="px-6 py-3 rounded-2xl border-2 border-white/30 bg-white/10">📞 Book Demo</a>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-6">
        <div class="text-center">
          <div class="text-2xl font-bold counter" data-target="${stats.clients}">0</div>
          <div class="text-sm text-white/80">Happy Clients</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold counter" data-target="${stats.projects}">0</div>
          <div class="text-sm text-white/80">Campaigns</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold counter" data-target="${stats.advisors}">0</div>
          <div class="text-sm text-white/80">Experts</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold counter" data-target="${stats.years}">0</div>
          <div class="text-sm text-white/80">Years</div>
        </div>
      </div>
    </div>
    <div data-aos="fade-left" class="flex justify-center items-center">
      <div class="hero-thumbs floating" style="background-image:url('${HERO_MAIN}');"></div>
    </div>
  </div>
</section>

<!-- Trusted -->
<section class="py-10 bg-white">
  <div class="max-w-7xl mx-auto px-4 text-center">
    <div class="text-gray-500 mb-6">Trusted by enterprise & creator brands</div>
    <div class="grid grid-cols-3 md:grid-cols-6 gap-6 items-center">
      ${brands.map(b=>`<div class="opacity-80"><img src="${b.logo}" alt="${b.name}" class="h-8 mx-auto object-contain"></div>`).join('')}
    </div>
  </div>
</section>

<!-- Services -->
<section class="py-16 bg-gray-50">
  <div class="max-w-7xl mx-auto px-4">
    <div class="text-center mb-10">
      <h2 class="text-3xl font-bold">What We Do</h2>
      <p class="text-gray-600">Full social growth & marketing: organic growth, content, influencer partnerships, analytics and strategy.</p>
    </div>
    <div class="grid md:grid-cols-3 gap-8">
      <div class="p-6 bg-white rounded-2xl glow-card">
        <div class="text-3xl mb-3">📱</div>
        <h3 class="font-bold text-lg">Instagram Growth</h3>
        <p class="text-gray-700 mt-2">Targeted follower growth using AI and niche matching for real engagement.</p>
      </div>
      <div class="p-6 bg-white rounded-2xl glow-card">
        <div class="text-3xl mb-3">📊</div>
        <h3 class="font-bold text-lg">Analytics & Dashboards</h3>
        <p class="text-gray-700 mt-2">Actionable insights and weekly reports to optimize performance and conversions.</p>
      </div>
      <div class="p-6 bg-white rounded-2xl glow-card">
        <div class="text-3xl mb-3">🤝</div>
        <h3 class="font-bold text-lg">Influencer Partnerships</h3>
        <p class="text-gray-700 mt-2">Find creators who match your brand and drive conversions.</p>
      </div>
    </div>
  </div>
</section>

<!-- Pricing preview -->
<section class="py-16 bg-gray-50">
  <div class="max-w-7xl mx-auto px-4">
    <div class="billing-toggle">
      <div class="toggle-group">
        <button class="toggle-btn active">Monthly</button>
        <button class="toggle-btn">Quarterly</button>
        <button class="toggle-btn">Yearly</button>
      </div>
    </div>
    
    <div class="pricing-grid">
      ${plans.map((p,i)=> {
        const features = JSON.parse(p.features);
        const badges = ['kickoff-badge', 'growth-badge', 'advanced-badge'];
        const badgeTexts = ['KICKOFF PLAN', 'GROWTH PLAN', 'ADVANCED PLAN'];
        const descriptions = [
          'Put your Instagram growth on autopilot. Perfect for personal accounts.',
          'Organic Instagram growth designed to connect you with your ideal audience.',
          'Advanced tools to drive conversion rates. Ideal for influencers and businesses.'
        ];
        const dailyRates = ['1.63', '2.30', '4.30'];
        
        return `
        <div class="pricing-card ${i===1?'featured':''}">
          ${i===1?'<div class="flame-icon">🔥</div>':''}
          <div class="plan-badge ${badges[i]}">${badgeTexts[i]}</div>
          <p class="plan-description">${descriptions[i]}</p>
          
          <div class="price">$${p.price_usd}<span class="price-period">/mo</span></div>
          <div class="price-note">(only $${dailyRates[i]}/day)</div>
          
          <button class="cta-button" onclick="handleCheckout(${p.id})">
            <span>Get Started Today</span>
            <div class="cta-arrow">→</div>
          </button>
          
          <ul class="features-list">
            ${features.map(f=>`
              <li class="feature-item">
                <div class="feature-check"></div>
                <span>${escapeHtml(f).replace(/(Real|Real & Organic)/g, '<strong>$1</strong>')}</span>
                <div class="feature-info">?</div>
              </li>
            `).join('')}
          </ul>
        </div>`;
      }).join('')}
    </div>
  </div>
</section>
</div>
  </div>
</section>

<!-- Add this script right after the pricing section -->
<script>
  // Toggle functionality for homepage pricing
  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const active = document.querySelector('.toggle-btn.active');
        if (active) active.classList.remove('active');
        this.classList.add('active');
        
        // Update prices based on selection
        const period = this.textContent;
        const prices = document.querySelectorAll('.price');
        const notes = document.querySelectorAll('.price-note');
        
        if (period === 'Quarterly') {
          // 10% discount for quarterly
          prices[0].innerHTML = '$44<span class="price-period">/mo</span>';
          prices[1].innerHTML = '$62<span class="price-period">/mo</span>';
          prices[2].innerHTML = '$116<span class="price-period">/mo</span>';
          notes[0].textContent = '(only $1.47/day, billed quarterly)';
          notes[1].textContent = '(only $2.07/day, billed quarterly)';
          notes[2].textContent = '(only $3.87/day, billed quarterly)';
        } else if (period === 'Yearly') {
          // 20% discount for yearly
          prices[0].innerHTML = '$39<span class="price-period">/mo</span>';
          prices[1].innerHTML = '$55<span class="price-period">/mo</span>';
          prices[2].innerHTML = '$103<span class="price-period">/mo</span>';
          notes[0].textContent = '(only $1.30/day, billed annually)';
          notes[1].textContent = '(only $1.83/day, billed annually)';
          notes[2].textContent = '(only $3.43/day, billed annually)';
        } else {
          // Monthly (original prices)
          prices[0].innerHTML = '$49<span class="price-period">/mo</span>';
          prices[1].innerHTML = '$69<span class="price-period">/mo</span>';
          prices[2].innerHTML = '$129<span class="price-period">/mo</span>';
          notes[0].textContent = '(only $1.63/day)';
          notes[1].textContent = '(only $2.30/day)';
          notes[2].textContent = '(only $4.30/day)';
        }
      });
    });
  });
</script>
</div>
  </div>
  
  <script>
    // Toggle functionality for homepage pricing
    document.addEventListener('DOMContentLoaded', function() {
      document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', function() {
          const active = document.querySelector('.toggle-btn.active');
          if (active) active.classList.remove('active');
          this.classList.add('active');
          
          // Update prices based on selection
          const period = this.textContent;
          const prices = document.querySelectorAll('.price');
          const notes = document.querySelectorAll('.price-note');
          
          if (period === 'Quarterly') {
            prices[0].innerHTML = '$44<span class="price-period">/mo</span>';
            prices[1].innerHTML = '$62<span class="price-period">/mo</span>';
            prices[2].innerHTML = '$116<span class="price-period">/mo</span>';
            notes[0].textContent = '(only $1.47/day, billed quarterly)';
            notes[1].textContent = '(only $2.07/day, billed quarterly)';
            notes[2].textContent = '(only $3.87/day, billed quarterly)';
          } else if (period === 'Yearly') {
            prices[0].innerHTML = '$39<span class="price-period">/mo</span>';
            prices[1].innerHTML = '$55<span class="price-period">/mo</span>';
            prices[2].innerHTML = '$103<span class="price-period">/mo</span>';
            notes[0].textContent = '(only $1.30/day, billed annually)';
            notes[1].textContent = '(only $1.83/day, billed annually)';
            notes[2].textContent = '(only $3.43/day, billed annually)';
          } else {
            prices[0].innerHTML = '$49<span class="price-period">/mo</span>';
            prices[1].innerHTML = '$69<span class="price-period">/mo</span>';
            prices[2].innerHTML = '$129<span class="price-period">/mo</span>';
            notes[0].textContent = '(only $1.63/day)';
            notes[1].textContent = '(only $2.30/day)';
            notes[2].textContent = '(only $4.30/day)';
          }
        });
      });
      
      // Checkout handler function
      window.handleCheckout = function(planId) {
        fetch('/checkout?plan_id=' + planId)
          .then(response => {
            if (response.ok) {
              window.location.href = '/checkout?plan_id=' + planId;
            } else {
              alert('Checkout coming soon! Plan ID: ' + planId + ' selected. Contact support to complete order.');
            }
          })
          .catch(error => {
            alert('Checkout system is being set up. Contact support for Plan #' + planId);
          });
      };
    });
    
  </script>


<!-- Testimonials -->
<!-- What do our customers say -->
<section class="py-16 bg-gray-50">
  <div class="max-w-7xl mx-auto px-4">
    <div class="grid lg:grid-cols-2 gap-12">
      <!-- Left side - Reviews info -->
      <div>
        <h2 class="text-3xl font-bold mb-6">What do our customers say?</h2>
        <p class="text-gray-600 mb-8">Social Boost helps 3,000+ active customers to build their audience servicing customers in over 140 countries in a variety of industries from individuals to Fortune 500 companies, and everything in-between!</p>
        
        <div class="space-y-4">
          <div class="flex items-center gap-3">
            <div class="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
              <span class="text-white text-sm">✓</span>
            </div>
            <span class="text-gray-700">Real, Organic and Engaged Instagram Followers</span>
          </div>
          <div class="flex items-center gap-3">
            <div class="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
              <span class="text-white text-sm">✓</span>
            </div>
            <span class="text-gray-700">24/7 Live Chat and Phone Support in UK & US</span>
          </div>
          <div class="flex items-center gap-3">
            <div class="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
              <span class="text-white text-sm">✓</span>
            </div>
            <span class="text-gray-700">100% No risk, all plans include our Instagram Growth Guarantee!</span>
          </div>
        </div>
      </div>
      
      <!-- Right side - Customer reviews -->
      <div class="space-y-6">
        <div class="bg-white p-6 rounded-xl shadow-sm border">
          <div class="flex items-center gap-3 mb-4">
            <img src="https://i.pravatar.cc/50?img=20" class="w-12 h-12 rounded-full" alt="Gregg Lomas">
            <div>
              <div class="font-semibold">Gregg Lomas</div>
              <div class="text-yellow-500">★★★★★</div>
            </div>
          </div>
          <p class="text-gray-600 italic">"Service is really easy to use. They understand your target market and I saw growth and engagement immediately."</p>
        </div>
        
        <div class="bg-white p-6 rounded-xl shadow-sm border">
          <div class="flex items-center gap-3 mb-4">
            <img src="https://i.pravatar.cc/50?img=21" class="w-12 h-12 rounded-full" alt="Veronika Bergaric">
            <div>
              <div class="font-semibold">Veronika Bergaric</div>
              <div class="text-yellow-500">★★★★★</div>
            </div>
          </div>
          <p class="text-gray-600 italic">"I'm really impressed! Especially with the fact that it wasn't all fake users adding me up! Hope to work with you more!"</p>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- Trust section with brand logos -->
<section class="py-12 bg-white border-t border-b">
  <div class="max-w-7xl mx-auto px-4 text-center">
    <h3 class="text-xl font-semibold mb-2">#1 Instagram Marketing Agency</h3>
    <p class="text-gray-600 mb-8">Grow your Instagram with <strong>real followers</strong> that will like, comment and engage with your content</p>
    
<div class="flex justify-center gap-4 mb-6">
  <a href="/contact" class="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition-colors inline-block">
    Chat with us →
  </a>
  <a href="#" onclick="window.scrollTo({top: 0, behavior: 'smooth'}); return false;" class="bg-green-500 text-white px-6 py-3 rounded-lg hover:bg-green-600 transition-colors inline-block">
    Growth Estimation →
  </a>
</div>
    
    <p class="text-sm text-gray-500 mb-8">We've managed over 23,000 Instagram Accounts</p>
    
    <!-- Brand logos -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-8 items-center opacity-60">
      <div class="flex justify-center">
        <span class="text-2xl font-bold text-gray-400">Mashable</span>
      </div>
      <div class="flex justify-center">
        <span class="text-2xl font-bold text-gray-400">Forbes</span>
      </div>
      <div class="flex justify-center">
        <span class="text-2xl font-bold text-gray-400">HUFFPOST</span>
      </div>
      <div class="flex justify-center">
        <span class="text-2xl font-bold text-gray-400">Entrepreneur</span>
      </div>
      <div class="flex justify-center">
        <span class="text-2xl font-bold text-gray-400">BuzzFeed</span>
      </div>
      <div class="flex justify-center md:col-start-2">
        <span class="text-xl font-bold text-gray-400">Medium</span>
      </div>
      <div class="flex justify-center">
        <span class="text-xl font-bold text-gray-400">Product Hunt</span>
      </div>
      <div class="flex justify-center">
        <span class="text-xl font-bold text-gray-400">TechCrunch</span>
      </div>
      <div class="flex justify-center">
        <span class="text-xl font-bold text-gray-400">VICE</span>
      </div>
    </div>
    
    <!-- Customer testimonial -->
    <div class="mt-12 max-w-2xl mx-auto">
      <p class="text-gray-600 italic mb-4">"Social Boost has been a huge help in growing our Instagram account organically. The targeting has been excellent and the followers are real and engaged. So, if you want to get Instagram followers, you need to try them."</p>
      <div class="flex items-center justify-center gap-3">
        <img src="https://i.pravatar.cc/50?img=22" class="w-12 h-12 rounded-full" alt="Levon Sirbol">
        <div>
          <div class="font-semibold">Levon Sirbol</div>
          <div class="text-sm text-gray-500">Head Of Marketing, Torenti Clothing</div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- Latest posts -->
<section class="py-16 bg-white">
  <div class="max-w-7xl mx-auto px-4">
    <div class="text-center mb-8"><h2 class="text-3xl font-bold">Latest Insights</h2><p class="text-gray-600">Helpful posts from our experts</p></div>
    <div class="grid md:grid-cols-3 gap-6">
      ${posts.slice(0,3).map(p=>`
        <article class="bg-white border rounded-2xl overflow-hidden hover:shadow-lg">
          <img src="${escapeHtml(p.image)}" class="w-full h-44 object-cover" />
          <div class="p-4">
            <div class="text-xs text-gray-500">${new Date(p.created_at).toLocaleDateString()}</div>
            <h3 class="font-bold text-lg mt-2"><a href="/blog/${p.id}" class="hover:text-indigo-600">${escapeHtml(p.title)}</a></h3>
            <p class="text-gray-600 mt-2">${escapeHtml(p.excerpt)}</p>
          </div>
        </article>`).join('')}
    </div>
  </div>
</section>

<!-- CTA -->
<section class="py-16 bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
  <div class="max-w-4xl mx-auto px-4 text-center">
    <h2 class="text-3xl lg:text-4xl font-bold mb-3">Ready to grow your Instagram?</h2>
    <p class="text-lg mb-6">Start a demo or create an account — our team will build your custom growth plan.</p>
    <div class="flex gap-4 justify-center">
      <a href="/signup" class="px-6 py-3 rounded-2xl bg-white text-indigo-600 font-bold btn-animated">Sign up — Free Demo</a>
      <a href="/contact" class="px-6 py-3 rounded-2xl border-2 border-white/30">Schedule Call</a>
    </div>
  </div>
</section>

<script>
// Counter animation
document.addEventListener('DOMContentLoaded', function() {
  const counters = document.querySelectorAll('.counter');
  const animateCounter = (counter) => {
    const target = parseInt(counter.getAttribute('data-target'));
    const increment = target / 100;
    let current = 0;
    
    const updateCounter = () => {
      if (current < target) {
        current += increment;
        counter.textContent = Math.floor(current).toLocaleString();
        requestAnimationFrame(updateCounter);
      } else {
        counter.textContent = target.toLocaleString();
      }
    };
    updateCounter();
  };
  
  // Start animation when counters are visible
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        observer.unobserve(entry.target);
      }
    });
  });
  
  counters.forEach(counter => observer.observe(counter));
});
</script>
` });
}

// Blogs listing & blog view
function BlogsView({ user, posts }) {
  return layout({ title: 'Blogs', user, content: `
<section class="py-16 bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
  <div class="max-w-7xl mx-auto px-4 text-center"><h1 class="text-4xl font-bold">Insights & Tips</h1><p class="mt-2">Stay ahead with our expert content</p></div>
</section>
<section class="max-w-7xl mx-auto px-4 py-16">
  <div class="grid md:grid-cols-3 gap-8">
    ${posts.map(p=>`
      <article class="bg-white rounded-2xl overflow-hidden shadow">
        <img src="${escapeHtml(p.image)}" class="w-full h-48 object-cover" />
        <div class="p-6">
          <div class="text-xs text-gray-500 mb-2">${new Date(p.created_at).toLocaleDateString()}</div>
          <h3 class="font-bold text-lg"><a href="/blog/${p.id}" class="hover:text-indigo-600">${escapeHtml(p.title)}</a></h3>
          <p class="text-gray-600 mt-2">${escapeHtml(p.excerpt)}</p>
        </div>
      </article>`).join('')}
  </div>
</section>
` });
}

function BlogView({ user, post }) {
  return layout({ title: post.title, user, content: `
<section class="max-w-4xl mx-auto px-4 py-16">
  <a class="text-sm text-indigo-600" href="/blogs">&larr; Back</a>
  <h1 class="text-3xl font-bold mt-4 mb-4">${escapeHtml(post.title)}</h1>
  <div class="text-sm text-gray-500 mb-6">by ${escapeHtml(post.author||'Unknown')} • ${new Date(post.created_at).toLocaleDateString()}</div>
  ${post.image ? `<img src="${escapeHtml(post.image)}" class="w-full rounded-2xl shadow mb-8" />` : ''}
  <article class="prose max-w-none">${marked.parse(post.body||'')}</article>
</section>
` });
}

// Generic small page
function GenericView({ user, title, body }) {
  return layout({ title, user, content: `<section class='max-w-7xl mx-auto px-4 py-10'><h2 class='text-3xl font-bold'>${escapeHtml(title)}</h2><div class='mt-4 text-slate-700'>${body||''}</div></section>` });
}

// -------------------------- Admin/Staff Views ---------------------------

function AdminDashboardView({ me, stats, posts, orders }) {
  return layout({ title: 'Admin Dashboard', user:me, content: `
<section class='max-w-7xl mx-auto px-4 py-10'>
  <div class='flex items-center justify-between'>
    <h2 class='text-2xl font-bold'>Admin Dashboard</h2>
    <div class='text-sm text-slate-600'>Signed in as <b>${escapeHtml(me.email)}</b></div>
  </div>

  <div class='grid md:grid-cols-5 gap-4 mt-6'>
    <div class='col-span-1 p-4 rounded-xl bg-white border'>
      <div class='text-xs text-slate-500'>Total Accounting</div>
      <div class='text-2xl font-extrabold'>${currency(stats.totalAccounting)}</div>
      <div class='text-xs text-slate-400 mt-1'>Estimate from paid orders</div>
    </div>
    <div class='col-span-1 p-4 rounded-xl bg-white border'>
      <div class='text-xs text-slate-500'>Number of Users</div>
      <div class='text-2xl font-extrabold'>${stats.users}</div>
    </div>
    <div class='col-span-1 p-4 rounded-xl bg-white border'>
      <div class='text-xs text-slate-500'>Pending Offers</div>
      <div class='text-2xl font-extrabold'>${stats.pendingOrders}</div>
    </div>
    <div class='col-span-1 p-4 rounded-xl bg-white border'>
      <div class='text-xs text-slate-500'>Declined / Cancelled</div>
      <div class='text-2xl font-extrabold'>${stats.declinedCount}</div>
    </div>
    <div class='col-span-1 p-4 rounded-xl bg-white border'>
      <div class='text-xs text-slate-500'>Subscribers</div>
      <div class='text-2xl font-extrabold'>${stats.subscribers}</div>
    </div>
  </div>

  <div class='grid md:grid-cols-3 gap-6 mt-6'>
    <div class='md:col-span-2 bg-white border rounded-xl p-4'>
      <h3 class='font-bold'>Recent Posts</h3>
      <ul class='list-disc ml-6 mt-3'>${posts.map(p=>`<li><a href='/blog/${p.id}' class='text-indigo-600 underline'>${escapeHtml(p.title)}</a> • ${p.created_at.slice(0,10)}</li>`).join('')}</ul>

      <h3 class='font-bold mt-6'>Recent Orders</h3>
      <ul class='list-disc ml-6 mt-3'>${orders.map(o=>`<li>#${o.id} • ${escapeHtml(o.plan||'N/A')} • ${escapeHtml(o.status)}</li>`).join('')}</ul>
    </div>

    <div class='bg-white border rounded-xl p-4'>
      <h3 class='font-bold'>Create New Blog Post</h3>
      <form method='post' action='/admin/create_post' class='space-y-2 mt-2'>
        <input name='title' placeholder='Title' class='w-full px-3 py-2 rounded-xl border' />
        <input name='image' placeholder='Image URL' class='w-full px-3 py-2 rounded-xl border' />
        <input name='excerpt' placeholder='Short excerpt' class='w-full px-3 py-2 rounded-xl border' />
        <textarea name='body' rows='6' placeholder='Body (Markdown ok)' class='w-full px-3 py-2 rounded-xl border'></textarea>
        <button class='px-3 py-2 rounded-xl bg-indigo-600 text-white'>Create Post</button>
      </form>

      <hr class='my-4' />
      <h4 class='font-bold'>User Role Management</h4>
      <form method='post' action='/admin/assign_role' class='space-y-2 mt-2'>
        <input name='email' placeholder='User email' class='w-full px-3 py-2 rounded-xl border' />
        <select name='role' class='w-full px-3 py-2 rounded-xl border'>
          <option value='user'>user</option>
          <option value='staff'>staff</option>
          <option value='admin'>admin</option>
        </select>
        <button class='px-3 py-2 rounded-xl bg-emerald-500 text-white'>Assign Role</button>
      </form>
    </div>
  </div>
</section>
` });
}

// Staff control panel view (improved behaviour)
function StaffPanelView({ me, users }) {
  return layout({ title: 'Staff Panel', user:me, content: `
<section class="max-w-7xl mx-auto px-4 py-10">
  <div class="flex items-center justify-between"><h2 class="text-2xl font-bold">Staff Control Panel</h2><div class="text-sm text-slate-600">Signed in as <b>${escapeHtml(me.email)}</b></div></div>

  <div class="grid md:grid-cols-3 gap-6 mt-6">
    <div class="md:col-span-2">
      <div class="bg-white border rounded-xl p-4">
        <h3 class="font-bold">Users (click a user to view details)</h3>
        <div id="users-list" class="mt-4 space-y-3">
          ${users.map(u=>`
            <div class="p-3 border rounded user-row" data-id="${u.id}">
              <div class="flex items-center justify-between">
                <div>
                  <div class="font-semibold">#${u.id} • ${escapeHtml(u.email)}</div>
                  <div class="text-xs text-slate-500">${escapeHtml(u.role)} • IG: ${escapeHtml(u.instagram||'—')}</div>
                </div>
                <div class="flex gap-2">
                  ${u.role !== 'staff' ? `<form method="post" action="/staff/promote" style="display:inline"><input type="hidden" name="id" value="${u.id}"><button class="px-3 py-1 rounded bg-green-600 text-white">Promote</button></form>` : `<form method="post" action="/staff/demote" style="display:inline"><input type="hidden" name="id" value="${u.id}"><button class="px-3 py-1 rounded bg-amber-500 text-white">Demote</button></form>`}
                  <form method="post" action="/staff/delete" style="display:inline" onsubmit="return confirm('Delete user?')"><input type="hidden" name="id" value="${u.id}"><button class="px-3 py-1 rounded bg-rose-600 text-white">Delete</button></form>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div id="user-detail-area" class="hidden mt-4"></div>
    </div>

    <div class="bg-white border rounded-xl p-4">
      <h3 class="font-bold">Add Staff</h3>
      <form method="post" action="/staff/add" class="mt-3 space-y-2">
        <input name="email" placeholder="Email" class="w-full px-3 py-2 rounded border" />
        <input name="password" placeholder="Password" class="w-full px-3 py-2 rounded border" />
        <input name="name" placeholder="Name" class="w-full px-3 py-2 rounded border" />
        <button class="px-3 py-2 rounded bg-green-600 text-white">Create Staff Account</button>
      </form>
    </div>
  </div>

<script>
  // When clicking a user row: hide list, load detail HTML into #user-detail-area
  document.querySelectorAll('.user-row').forEach(row=>{
    row.addEventListener('click', (e)=>{
      if (e.target.closest('form') || e.target.tagName === 'BUTTON') return;
      const id = row.getAttribute('data-id');
      const usersList = document.getElementById('users-list');
      const detailArea = document.getElementById('user-detail-area');
      // Hide list
      usersList.style.display = 'none';
      // show loading then fetch detail fragment (we will render inline via route)
      detailArea.classList.remove('hidden');
      detailArea.innerHTML = '<div class="p-6 bg-white border rounded-xl">Loading...</div>';
      fetch('/staff/user_detail/' + id).then(r=>r.text()).then(html=>{
        detailArea.innerHTML = html + '<div class="mt-4"><button id="backToList" class="px-3 py-2 rounded bg-slate-200">Back to list</button></div>';
        document.getElementById('backToList').addEventListener('click', ()=>{ detailArea.classList.add('hidden'); usersList.style.display = ''; detailArea.innerHTML=''; window.scrollTo({top:0, behavior:"smooth"}); });
      });
    });
  });
</script>
</section>
` });
}

// -------------------------- Routes ---------------------------
app.use((req,res,next)=>{ req.user = authed(req); next(); });

// Home
app.get('/', (req,res)=>{
  const plans = db.prepare('SELECT * FROM plans').all();
  const reviews = db.prepare('SELECT * FROM reviews ORDER BY created_at DESC').all();
  const posts = db.prepare('SELECT * FROM posts ORDER BY created_at DESC').all();
  res.send(HomeView({ user:req.user, plans, reviews, posts }));
});

// Blogs
app.get('/blogs', (req,res)=>{
  const posts = db.prepare('SELECT * FROM posts ORDER BY created_at DESC').all();
  res.send(BlogsView({ user:req.user, posts }));
});
app.get('/blog/:id', (req,res)=>{
  const id = Number(req.params.id);
  db.prepare('UPDATE posts SET views = views + 1 WHERE id=?').run(id);
  const post = db.prepare('SELECT * FROM posts WHERE id=?').get(id);
  if (!post) return res.status(404).send('Not found');
  res.send(BlogView({ user:req.user, post }));
});

// Login/signup
app.get('/login', (req,res)=> res.send(LoginView({ user:req.user })));
app.post('/login', (req,res)=>{
  const lockedUntil = req.session.login_locked_until;
  if (lockedUntil && Date.now() < lockedUntil) {
    const waitSec = Math.ceil((lockedUntil - Date.now()) / 1000);
    return res.send(LoginView({ user:req.user, error:`Too many attempts — try again in ${waitSec} seconds.` }));
  }
  const { email, password } = req.body;
  const row = db.prepare('SELECT * FROM users WHERE email=?').get(String(email||'').toLowerCase());
  if (row && row.password_hash === sha256(password)) {
    req.session.failed_login = 0;
    req.session.login_locked_until = null;
    req.session.uid = row.id;
    if (row.role === 'admin') return res.redirect('/dashboard');
    if (row.role === 'staff') return res.redirect('/staff');
    return res.redirect('/');
  }
  req.session.failed_login = (req.session.failed_login || 0) + 1;
  if (req.session.failed_login >= 6) {
    req.session.login_locked_until = Date.now() + 5 * 60 * 1000;
  }
  return res.send(LoginView({ user:req.user, error:'Invalid credentials' }));
});
app.get('/logout', (req,res)=>{ req.session = null; res.redirect('/'); });

app.get('/signup', (req,res)=> res.send(SignupView({ user:req.user })));
app.post('/signup', (req,res)=>{
  const { name, email, instagram, password } = req.body;
  if (!email || !password) return res.send(SignupView({ user:req.user, error:'Email & password required' }));
  try {
    db.prepare('INSERT INTO users(email,password_hash,name,instagram,role) VALUES (?,?,?,?,?)')
      .run(String(email).toLowerCase(), sha256(password), name||'', instagram||'', 'user');
    const uid = db.prepare('SELECT id FROM users WHERE email=?').get(String(email).toLowerCase()).id;
    db.prepare('INSERT OR IGNORE INTO statuses(user_id) VALUES(?)').run(uid);
    db.prepare('INSERT OR IGNORE INTO targets(user_id,niche,competitors,hashtags,geo,notes) VALUES(?,?,?,?,?,?)').run(uid,'','','','','');
    db.prepare('INSERT OR IGNORE INTO metrics(user_id,likes,follows) VALUES (?,?,?)').run(uid,10,8);
    req.session.uid = uid;
    res.redirect('/');
  } catch(e) {
    return res.send(SignupView({ user:req.user, error:'Email already exists' }));
  }
});

// Contact, ticket & subscribe
app.get('/contact', (req,res)=> res.send(GenericView({ user:req.user, title:'Contact', body: `
  <h3>Contact Us</h3>
  <p class="text-slate-700">Send us a message using the form. We'll reply within 24 hours.</p>
  <form method="post" action="/contact_submit" class="mt-4 space-y-3">
    <input name="name" placeholder="Your name" class="w-full px-3 py-2 rounded border" />
    <input name="email" placeholder="Your email" class="w-full px-3 py-2 rounded border" />
    <input name="instagram" placeholder="Instagram (optional)" class="w-full px-3 py-2 rounded border" />
    <textarea name="message" rows="6" placeholder="Message" class="w-full px-3 py-2 rounded border"></textarea>
    <button class="px-4 py-2 rounded bg-indigo-600 text-white">Send Message</button>
  </form>
` })));
app.post('/contact_submit', (req,res)=>{
  const { name, email, instagram, message } = req.body;
  db.prepare('INSERT INTO tickets(user_id,email,instagram,subject,message) VALUES (?,?,?,?,?)').run(null, email||'', instagram||'', `Contact: ${name||'Guest'}`, message||'');
  res.redirect('/contact');
});
app.post('/ticket', (req,res)=>{
  if (!req.user) return res.status(403).send('Forbidden');
  const { subject, message } = req.body;
  db.prepare('INSERT INTO tickets(user_id,email,instagram,subject,message) VALUES (?,?,?,?,?)').run(req.user.id, req.user.email, req.user.instagram, subject, message);
  res.redirect(req.get('Referer')||'/');
});
app.post('/subscribe', (req,res)=>{
  const email = String(req.body.email||'').trim();
  if (email) {
    try { db.prepare('INSERT INTO subscribers(email) VALUES (?)').run(email); } catch(e){}
  }
  res.redirect(req.get('Referer')||'/');
});

// Pricing & checkout
app.get('/pricing', (req,res)=>{
  const plans = db.prepare('SELECT * FROM plans').all();
  res.send(layout({ title:'Pricing', user:req.user, content: `
<section class="py-16 bg-gray-50">
  <div class="max-w-7xl mx-auto px-4">
    <div class="billing-toggle">
      <div class="toggle-group">
        <button class="toggle-btn active">Monthly</button>
        <button class="toggle-btn">Quarterly</button>
        <button class="toggle-btn">Yearly</button>
      </div>
    </div>
    
    <div class="pricing-grid">
      ${plans.map((p,i)=> {
        const features = JSON.parse(p.features);
        const badges = ['kickoff-badge', 'growth-badge', 'advanced-badge'];
        const badgeTexts = ['KICKOFF PLAN', 'GROWTH PLAN', 'ADVANCED PLAN'];
        const descriptions = [
          'Put your Instagram growth on autopilot. Perfect for personal accounts.',
          'Organic Instagram growth designed to connect you with your ideal audience.',
          'Advanced tools to drive conversion rates. Ideal for influencers and businesses.'
        ];
        const dailyRates = ['1.63', '2.30', '4.30'];
        
        return `
        <div class="pricing-card ${i===1?'featured':''}">
          ${i===1?'<div class="flame-icon">🔥</div>':''}
          <div class="plan-badge ${badges[i]}">${badgeTexts[i]}</div>
          <p class="plan-description">${descriptions[i]}</p>
          
          <div class="price">$${p.price_usd}<span class="price-period">/mo</span></div>
          <div class="price-note">(only $${dailyRates[i]}/day)</div>
          
          <button class="cta-button" onclick="handleCheckout(${p.id})">
            <span>Get Started Today</span>
            <div class="cta-arrow">→</div>
          </button>
          
          <ul class="features-list">
            ${features.map(f=>`
              <li class="feature-item">
                <div class="feature-check"></div>
                <span>${escapeHtml(f).replace(/(Real|Real & Organic)/g, '<strong>$1</strong>')}</span>
                <div class="feature-info">?</div>
              </li>
            `).join('')}
          </ul>
        </div>`;
      }).join('')}
    </div>
  </div>
</section>
<script>
  // Toggle functionality with price updates
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const active = document.querySelector('.toggle-btn.active');
      if (active) active.classList.remove('active');
      this.classList.add('active');
      
      // Update prices based on selection
      const period = this.textContent;
      const prices = document.querySelectorAll('.price');
      const notes = document.querySelectorAll('.price-note');
      
      if (period === 'Quarterly') {
        prices[0].innerHTML = '$44<span class="price-period">/mo</span>';
        prices[1].innerHTML = '$62<span class="price-period">/mo</span>';
        prices[2].innerHTML = '$116<span class="price-period">/mo</span>';
        notes[0].textContent = '(only $1.47/day, billed quarterly)';
        notes[1].textContent = '(only $2.07/day, billed quarterly)';
        notes[2].textContent = '(only $3.87/day, billed quarterly)';
      } else if (period === 'Yearly') {
        prices[0].innerHTML = '$39<span class="price-period">/mo</span>';
        prices[1].innerHTML = '$55<span class="price-period">/mo</span>';
        prices[2].innerHTML = '$103<span class="price-period">/mo</span>';
        notes[0].textContent = '(only $1.30/day, billed annually)';
        notes[1].textContent = '(only $1.83/day, billed annually)';
        notes[2].textContent = '(only $3.43/day, billed annually)';
      } else {
        prices[0].innerHTML = '$49<span class="price-period">/mo</span>';
        prices[1].innerHTML = '$69<span class="price-period">/mo</span>';
        prices[2].innerHTML = '$129<span class="price-period">/mo</span>';
        notes[0].textContent = '(only $1.63/day)';
        notes[1].textContent = '(only $2.30/day)';
        notes[2].textContent = '(only $4.30/day)';
      }
    });
  });
  
  // Checkout handler function
  function handleCheckout(planId) {
    fetch('/checkout?plan_id=' + planId)
      .then(response => {
        if (response.ok) {
          window.location.href = '/checkout?plan_id=' + planId;
        } else {
          alert('Checkout coming soon! Plan ID: ' + planId + ' selected. Contact support to complete order.');
        }
      })
      .catch(error => {
        alert('Checkout system is being set up. Contact support for Plan #' + planId);
      });
  }
</script>

` }));
});

// -------------------------- Admin routes --------------------------
app.get('/dashboard', (req,res)=>{
  const me = requireRole(req,res,['admin']); if (!me || res.headersSent) return;
  // Use double-quoted JS strings with single quotes in SQL to avoid confusion
  const stats = {
    users: db.prepare("SELECT COUNT(*) c FROM users").get().c,
    pendingOrders: db.prepare("SELECT COUNT(*) c FROM orders WHERE status='pending'").get().c,
    declinedCount: db.prepare("SELECT COUNT(*) c FROM orders WHERE status='declined' OR status='cancelled'").get().c,
    subscribers: db.prepare("SELECT COUNT(*) c FROM subscribers").get().c,
    totalAccounting: db.prepare("SELECT SUM(p.price_usd) s FROM orders o JOIN plans p ON p.id=o.plan_id WHERE o.status='paid'").get().s || 0
  };
  const posts = db.prepare('SELECT id,title,created_at FROM posts ORDER BY created_at DESC LIMIT 8').all();
  const orders = db.prepare('SELECT o.*, p.name as plan FROM orders o LEFT JOIN plans p ON p.id=o.plan_id ORDER BY o.id DESC LIMIT 8').all();
  res.send(AdminDashboardView({ me, stats, posts, orders }));
});

app.post('/admin/create_post', (req,res)=>{
  const me = requireRole(req,res,['admin']); if (!me || res.headersSent) return;
  const { title, image, excerpt, body } = req.body;
  if (!title) return res.redirect('/dashboard');
  db.prepare('INSERT INTO posts(title,author,image,excerpt,body) VALUES (?,?,?,?,?)').run(title, me.name||me.email, image||'', excerpt||'', body||'');
  res.redirect('/dashboard');
});

// Admin role assign
app.post('/admin/assign_role', (req,res)=>{
  const me = requireRole(req,res,['admin']); if (!me || res.headersSent) return;
  const email = String(req.body.email||'').toLowerCase();
  const role = String(req.body.role||'user');
  if (!email) return res.redirect('/dashboard');
  db.prepare('UPDATE users SET role=? WHERE email=?').run(role, email);
  res.redirect('/dashboard');
});

// -------------------------- Staff routes --------------------------
app.get('/staff', (req,res)=>{
  const me = requireRole(req,res,['staff','admin']); if (!me || res.headersSent) return;
  const users = db.prepare('SELECT id,email,role,instagram FROM users ORDER BY id DESC').all();
  res.send(StaffPanelView({ me, users }));
});

// Provide user detail fragment endpoint used by client-side fetch
app.get('/staff/user_detail/:id', (req,res)=>{
  const me = requireRole(req,res,['staff','admin']); if (!me || res.headersSent) return;
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!user) return res.send('<div class="p-4 bg-white border rounded">User not found</div>');
  const metrics = db.prepare('SELECT * FROM metrics WHERE user_id=? ORDER BY id DESC').all(id);
  const latest = metrics[metrics.length-1] || {likes:0,follows:0};
  // render a small detail panel HTML
  res.send(`
    <div class="bg-white border rounded-xl p-4">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-bold">${escapeHtml(user.email)} <span class="text-xs text-slate-500">#${user.id}</span></div>
          <div class="text-xs text-slate-500">${escapeHtml(user.role)} • IG: ${escapeHtml(user.instagram||'—')}</div>
        </div>
        <div>
          <form method="post" action="/staff/toggle_unsubscribe" style="display:inline">
            <input type="hidden" name="id" value="${user.id}" />
            <button class="px-3 py-1 rounded ${user.unsubscribed? 'bg-yellow-500':'bg-slate-200'}">${user.unsubscribed? 'Unsubscribed':'Subscribed'}</button>
          </form>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-2 gap-4">
        <div class="bg-slate-50 p-3 rounded">
          <div class="text-xs text-slate-500">Latest Likes</div>
          <div class="text-xl font-bold">${latest.likes}</div>
        </div>
        <div class="bg-slate-50 p-3 rounded">
          <div class="text-xs text-slate-500">Latest Follows</div>
          <div class="text-xl font-bold">${latest.follows}</div>
        </div>
      </div>

      <div class="mt-4">
        <form method="post" action="/staff/metrics" class="grid grid-cols-2 gap-2">
          <input type="hidden" name="user_id" value="${user.id}" />
          <input name="add_likes" type="number" placeholder="Add likes" class="px-3 py-2 rounded border" />
          <input name="add_follows" type="number" placeholder="Add follows" class="px-3 py-2 rounded border" />
          <div class="col-span-2 mt-2"><button class="px-3 py-2 rounded bg-indigo-600 text-white">Update Metrics</button></div>
        </form>
      </div>
    </div>
  `);
});

app.post('/staff/add', (req,res)=>{
  const me = requireRole(req,res,['staff','admin']); if (!me || res.headersSent) return;
  const { email, password, name } = req.body;
  if (!email || !password) return res.redirect('/staff');
  try {
    db.prepare('INSERT INTO users(email,password_hash,name,role) VALUES (?,?,?,?)').run(String(email).toLowerCase(), sha256(password), name||'', 'staff');
    const id = db.prepare('SELECT id FROM users WHERE email=?').get(String(email).toLowerCase()).id;
    db.prepare('INSERT OR IGNORE INTO statuses(user_id) VALUES (?)').run(id);
    db.prepare('INSERT OR IGNORE INTO metrics(user_id,likes,follows) VALUES (?,?,?)').run(id, 0, 0);
  } catch(e) { /* ignore duplicates */ }
  res.redirect('/staff');
});

app.post('/staff/promote', (req,res)=>{
  const me = requireRole(req,res,['staff','admin']); if (!me || res.headersSent) return;
  const id = Number(req.body.id);
  db.prepare('UPDATE users SET role=? WHERE id=?').run('staff', id);
  res.redirect('/staff');
});
app.post('/staff/demote', (req,res)=>{
  const me = requireRole(req,res,['staff','admin']); if (!me || res.headersSent) return;
  const id = Number(req.body.id);
  db.prepare('UPDATE users SET role=? WHERE id=?').run('user', id);
  res.redirect('/staff');
});
app.post('/staff/delete', (req,res)=>{
  const me = requireRole(req,res,['staff','admin']); if (!me || res.headersSent) return;
  const id = Number(req.body.id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  db.prepare('DELETE FROM targets WHERE user_id=?').run(id);
  db.prepare('DELETE FROM statuses WHERE user_id=?').run(id);
  db.prepare('DELETE FROM metrics WHERE user_id=?').run(id);
  res.redirect('/staff');
});
app.post('/staff/metrics', (req,res)=>{
  const me = requireRole(req,res,['staff','admin']); if (!me || res.headersSent) return;
  const user_id = Number(req.body.user_id);
  const add_likes = Math.max(0, Number(req.body.add_likes || 0));
  const add_follows = Math.max(0, Number(req.body.add_follows || 0));
  if (!user_id) return res.redirect('/staff');
  db.prepare('INSERT INTO metrics(user_id,likes,follows) VALUES (?,?,?)').run(user_id, add_likes, add_follows);
  res.redirect('/staff');
});

app.post('/staff/toggle_unsubscribe', (req,res)=>{
  const me = requireRole(req,res,['staff','admin']); if (!me || res.headersSent) return;
  const id = Number(req.body.id);
  const u = db.prepare('SELECT unsubscribed FROM users WHERE id=?').get(id);
  if (u) {
    db.prepare('UPDATE users SET unsubscribed=? WHERE id=?').run(u.unsubscribed ? 0 : 1, id);
  }
  res.redirect('/staff');
});

// Performance charts (safe fixed sizes and maintainAspectRatio false to avoid animation growth)
app.get('/performance', (req,res)=>{
  const me = requireRole(req,res,['staff','admin']); if (!me || res.headersSent) return;
  const userId = me.id;
  const rows = db.prepare('SELECT * FROM metrics WHERE user_id=? ORDER BY id').all(userId);
  if (!rows.length) { for (let i=0;i<6;i++) db.prepare('INSERT INTO metrics(user_id,likes,follows) VALUES (?,?,?)').run(userId, 10+i*5, 8+i*3); }
  const rows2 = db.prepare('SELECT * FROM metrics WHERE user_id=? ORDER BY id').all(userId);
  const chart = { labels: rows2.map((_,i)=>`P${i+1}`), likes: rows2.map(r=>r.likes), follows: rows2.map(r=>r.follows) };
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  res.send(layout({ title:'Performance', user:me, content: `
<section class='max-w-4xl mx-auto px-4 py-10'>
  <h2 class='text-2xl font-bold'>Performance — ${escapeHtml(user.email)}</h2>
  <div style="height:320px;"><canvas id='chart' width="800" height="320"></canvas></div>
  <script>
    const d = ${JSON.stringify(chart)};
    new Chart(document.getElementById('chart'), {
      type: 'line',
      data: {
        labels: d.labels,
        datasets: [
          { label:'Likes', data:d.likes, tension:.3, fill:false },
          { label:'Follows', data:d.follows, tension:.3, fill:false }
        ]
      },
      options: { responsive:true, maintainAspectRatio:false, animation:{duration:600} }
    });
  </script>
</section>
` })); 
});

// performance for a specific user (admin/staff)
app.get('/performance/:userId', (req,res)=>{
  const me = requireRole(req,res,['staff','admin']); if (!me || res.headersSent) return;
  const userId = Number(req.params.userId || me.id);
  const rows = db.prepare('SELECT * FROM metrics WHERE user_id=? ORDER BY id').all(userId);
  if (!rows.length) { for (let i=0;i<6;i++) db.prepare('INSERT INTO metrics(user_id,likes,follows) VALUES (?,?,?)').run(userId, 10+i*5, 8+i*3); }
  const rows2 = db.prepare('SELECT * FROM metrics WHERE user_id=? ORDER BY id').all(userId);
  const chart = { labels: rows2.map((_,i)=>`P${i+1}`), likes: rows2.map(r=>r.likes), follows: rows2.map(r=>r.follows) };
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  res.send(layout({ title:`Performance ${userId}`, user:me, content: `
<section class='max-w-4xl mx-auto px-4 py-10'>
  <h2 class='text-2xl font-bold'>Performance — ${escapeHtml(user.email)}</h2>
  <div style="height:320px;"><canvas id='chart' width="800" height="320"></canvas></div>
  <script>
    const d = ${JSON.stringify(chart)};
    new Chart(document.getElementById('chart'), {
      type: 'line',
      data: {
        labels: d.labels,
        datasets: [
          { label:'Likes', data:d.likes, tension:.3, fill:false },
          { label:'Follows', data:d.follows, tension:.3, fill:false }
        ]
      },
      options: { responsive:true, maintainAspectRatio:false, animation:{duration:600} }
    });
  </script>
</section>
` })); 
});

// Static pages
app.get('/about', (req,res)=> {
  const aboutContent = `
    <!-- Hero Section -->
    <section class="py-16 bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
      <div class="max-w-7xl mx-auto px-4 text-center">
        <h1 class="text-4xl font-bold">About Us</h1>
        <div class="flex items-center justify-center gap-2 mt-4">
          <a href="/" class="text-purple-200 hover:text-white">Home</a>
          <span class="text-purple-200">›</span>
          <span>About Us</span>
        </div>
      </div>
    </section>

    <!-- Main Content -->
    <section class="py-16 bg-gray-50">
      <div class="max-w-7xl mx-auto px-4">
        <div class="grid lg:grid-cols-2 gap-12 items-center">
          <!-- Left Content -->
          <div>
            <div class="text-sm text-indigo-600 font-semibold mb-4">ABOUT US</div>
            <h2 class="text-3xl font-bold mb-6">SMM Matrix — Redefining Social Media Excellence</h2>
            <p class="text-gray-600 mb-6">At SMM Matrix, we're not just a social media marketing agency — we're your partners in digital success. Established with a mission for providing businesses to new heights through strategic social presence, we bring a unique blend of creativity, data-driven strategies, and authentic engagement.</p>
            
            <div class="space-y-6">
              <!-- Strategic Brilliance -->
              <div class="flex gap-4">
                <div class="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span class="text-indigo-600 text-xl">🎯</span>
                </div>
                <div>
                  <h3 class="font-bold text-lg">Strategic Brilliance</h3>
                  <p class="text-gray-600">We don't just create content; we craft strategies. Our team of experts analyzes your brand's unique identity, studies your target audience's preferences, and develops content campaigns that foster meaningful connections with your target audience.</p>
                </div>
              </div>
              
              <!-- Time Efficiency -->
              <div class="flex gap-4">
                <div class="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span class="text-purple-600 text-xl">⏰</span>
                </div>
                <div>
                  <h3 class="font-bold text-lg">Time Efficiency</h3>
                  <p class="text-gray-600">In the fast-paced world of social media, timing is everything. Our streamlined processes and efficient teamwork guarantee optimized social post scheduling and strategic management.</p>
                </div>
              </div>
            </div>
            
            <button class="mt-8 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
              Contact Us
            </button>
          </div>
          
          <!-- Right Images -->
          <div class="space-y-4">
            <img src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?q=80&w=600&auto=format&fit=crop" 
                 class="w-full rounded-xl shadow-lg" alt="Team meeting">
            <img src="https://images.unsplash.com/photo-1556761175-b413da4baf72?q=80&w=600&auto=format&fit=crop" 
                 class="w-full rounded-xl shadow-lg" alt="Social media strategy">
          </div>
        </div>
      </div>
    </section>

    <!-- Features Cards -->
    <section class="py-16 bg-white">
      <div class="max-w-7xl mx-auto px-4">
        <div class="grid md:grid-cols-3 gap-8">
          <!-- Card 1 -->
          <div class="bg-slate-900 text-white p-8 rounded-xl">
            <div class="w-12 h-12 bg-yellow-500 rounded-full flex items-center justify-center mb-4">
              <span class="text-slate-900 text-xl">⚡</span>
            </div>
            <h3 class="text-xl font-bold mb-3">Save Your Time</h3>
            <p class="text-gray-300">Stop wasting hours posting and let our skilled team accelerate business growth through strategic SMM management.</p>
          </div>
          
          <!-- Card 2 -->
          <div class="bg-slate-900 text-white p-8 rounded-xl">
            <div class="w-12 h-12 bg-yellow-500 rounded-full flex items-center justify-center mb-4">
              <span class="text-slate-900 text-xl">📊</span>
            </div>
            <h3 class="text-xl font-bold mb-3">Best Strategy</h3>
            <p class="text-gray-300">Our years of experience and best-developed analytics guides craft effective social media strategies aligned with marketing standards.</p>
          </div>
          
          <!-- Card 3 -->
          <div class="bg-indigo-600 text-white p-8 rounded-xl">
            <div class="w-12 h-12 bg-white rounded-full flex items-center justify-center mb-4">
              <span class="text-indigo-600 text-xl">💼</span>
            </div>
            <h3 class="text-xl font-bold mb-3">Affordable Price For You</h3>
            <p class="text-gray-100">Get the best value with our competitive pricing and exceptional service quality.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- FAQ Section -->
    <section class="py-16 bg-gray-50">
      <div class="max-w-4xl mx-auto px-4">
        <div class="text-center mb-12">
          <h2 class="text-3xl font-bold mb-4">What services does your SMM website offer?</h2>
          <p class="text-gray-600">We provide a comprehensive range of social media marketing services, including strategy development, content creation, audience engagement, and analytics reporting designed for businesses of all industries.</p>
        </div>
        
        <div class="grid md:grid-cols-2 gap-6">
          <div>
            <h3 class="text-xl font-bold mb-6">Any Questions? We Have Answers!</h3>
            <p class="text-gray-600 mb-6">SocialSprint is a cutting-edge communication platform designed to streamline conversations for individuals and businesses. It offers a range of features to enhance collaboration and connectivity.</p>
            <button class="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
              Contact Us
            </button>
          </div>
          
          <div class="space-y-4">
<div class="space-y-4">
  <div class="bg-white p-4 rounded-lg border" x-data="{ open: false }">
    <div class="flex items-center justify-between cursor-pointer" @click="open = !open">
      <span class="font-medium">How can I get started with your SMM services?</span>
      <button class="w-6 h-6 bg-indigo-100 text-indigo-600 rounded flex items-center justify-center transform transition-transform" :class="{ 'rotate-45': open }">+</button>
    </div>
    <div x-show="open" x-transition class="mt-4 text-gray-600">
      <p>Getting started is simple! Visit our pricing page, choose a plan, and our team will reach out within 24 hours to begin your growth strategy.</p>
    </div>
  </div>
  
  <div class="bg-white p-4 rounded-lg border" x-data="{ open: false }">
    <div class="flex items-center justify-between cursor-pointer" @click="open = !open">
      <span class="font-medium">What social media platforms do you specialize in?</span>
      <button class="w-6 h-6 bg-indigo-100 text-indigo-600 rounded flex items-center justify-center transform transition-transform" :class="{ 'rotate-45': open }">+</button>
    </div>
    <div x-show="open" x-transition class="mt-4 text-gray-600">
      <p>We specialize in Instagram, Facebook, Twitter, LinkedIn, TikTok, and YouTube. Our primary focus is Instagram growth and engagement.</p>
    </div>
  </div>
  
  <div class="bg-white p-4 rounded-lg border" x-data="{ open: false }">
    <div class="flex items-center justify-between cursor-pointer" @click="open = !open">
      <span class="font-medium">How do you create content for social media?</span>
      <button class="w-6 h-6 bg-indigo-100 text-indigo-600 rounded flex items-center justify-center transform transition-transform" :class="{ 'rotate-45': open }">+</button>
    </div>
    <div x-show="open" x-transition class="mt-4 text-gray-600">
      <p>We create custom content calendars, design engaging visuals, write compelling captions, and optimize posting schedules for maximum reach.</p>
    </div>
  </div>
  
  <div class="bg-white p-4 rounded-lg border" x-data="{ open: false }">
    <div class="flex items-center justify-between cursor-pointer" @click="open = !open">
      <span class="font-medium">Can I track the performance of my social media campaigns?</span>
      <button class="w-6 h-6 bg-indigo-100 text-indigo-600 rounded flex items-center justify-center transform transition-transform" :class="{ 'rotate-45': open }">+</button>
    </div>
    <div x-show="open" x-transition class="mt-4 text-gray-600">
      <p>Yes! We provide detailed analytics reports, real-time dashboards, and weekly performance summaries with conversion metrics.</p>
    </div>
  </div>
  
  <div class="bg-white p-4 rounded-lg border" x-data="{ open: false }">
    <div class="flex items-center justify-between cursor-pointer" @click="open = !open">
      <span class="font-medium">Is my information secure when using your services?</span>
      <button class="w-6 h-6 bg-indigo-100 text-indigo-600 rounded flex items-center justify-center transform transition-transform" :class="{ 'rotate-45': open }">+</button>
    </div>
    <div x-show="open" x-transition class="mt-4 text-gray-600">
      <p>Absolutely. All client data is encrypted, we use secure API connections, and we never share your information with third parties.</p>
    </div>
  </div>
</div>
    </section>
  `;
  
  res.send(layout({ title: 'About Us', user: req.user, content: aboutContent }));
});
app.get('/faq', (req,res)=> {
  const faqContent = `
    <!-- Hero Section -->
    <section class="py-16 bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
      <div class="max-w-7xl mx-auto px-4 text-center">
        <h1 class="text-4xl font-bold">Faq</h1>
        <div class="flex items-center justify-center gap-2 mt-4">
          <a href="/" class="text-purple-200 hover:text-white">Home</a>
          <span class="text-purple-200">›</span>
          <span>Faq</span>
        </div>
      </div>
    </section>

    <!-- FAQ Content -->
    <section class="py-16 bg-gray-50">
      <div class="max-w-6xl mx-auto px-4">
        <div class="grid lg:grid-cols-2 gap-12">
          <!-- Left Side -->
          <div>
            <div class="text-sm text-indigo-600 font-semibold mb-4">F A Q S</div>
            <h2 class="text-3xl font-bold mb-6">Any Questions? We Have Answers!</h2>
            <p class="text-gray-600 mb-8">SocialSprint is a cutting-edge communication platform designed to streamline conversations for individuals and businesses. It offers a range of features to enhance collaboration and connectivity.</p>
            
            <a href="/contact" class="inline-block px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
              Contact Us
            </a>
          </div>

          <!-- Right Side - FAQ Items -->
          <div class="space-y-4">
            <div class="bg-white p-6 rounded-lg shadow-sm border" x-data="{ open: false }">
              <div class="flex items-center justify-between cursor-pointer" @click="open = !open">
                <span class="font-semibold">What services does your SMM website offer?</span>
                <button class="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center transform transition-transform" :class="{ 'rotate-45': open }">+</button>
              </div>
              <div x-show="open" x-collapse class="mt-4 text-gray-600">
                <p>We offer comprehensive social media marketing services including Instagram growth, content strategy, influencer partnerships, analytics reporting, and brand management across all major platforms.</p>
              </div>
            </div>

            <div class="bg-white p-6 rounded-lg shadow-sm border" x-data="{ open: false }">
              <div class="flex items-center justify-between cursor-pointer" @click="open = !open">
                <span class="font-semibold">How can I get started with your SMM services?</span>
                <button class="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center transform transition-transform" :class="{ 'rotate-45': open }">+</button>
              </div>
              <div x-show="open" x-collapse class="mt-4 text-gray-600">
                <p>Getting started is simple! Visit our 'Get Started' page, fill out the form, and our team will reach out to you promptly to discuss your goals and tailor a strategy to meet your specific needs.</p>
              </div>
            </div>

            <div class="bg-white p-6 rounded-lg shadow-sm border" x-data="{ open: false }">
              <div class="flex items-center justify-between cursor-pointer" @click="open = !open">
                <span class="font-semibold">What social media platforms do you specialize in?</span>
                <button class="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center transform transition-transform" :class="{ 'rotate-45': open }">+</button>
              </div>
              <div x-show="open" x-collapse class="mt-4 text-gray-600">
                <p>We specialize in Instagram, Facebook, Twitter, LinkedIn, TikTok, and YouTube. Our primary focus is Instagram growth and engagement, but we provide comprehensive strategies across all platforms.</p>
              </div>
            </div>

            <div class="bg-white p-6 rounded-lg shadow-sm border" x-data="{ open: false }">
              <div class="flex items-center justify-between cursor-pointer" @click="open = !open">
                <span class="font-semibold">How do you create content for social media?</span>
                <button class="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center transform transition-transform" :class="{ 'rotate-45': open }">+</button>
              </div>
              <div x-show="open" x-collapse class="mt-4 text-gray-600">
                <p>Our content creation process involves analyzing your brand, target audience, and competitors. We create custom content calendars, design engaging visuals, write compelling captions, and optimize posting schedules for maximum reach.</p>
              </div>
            </div>

            <div class="bg-white p-6 rounded-lg shadow-sm border" x-data="{ open: false }">
              <div class="flex items-center justify-between cursor-pointer" @click="open = !open">
                <span class="font-semibold">Can I track the performance of my social media campaigns?</span>
                <button class="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center transform transition-transform" :class="{ 'rotate-45': open }">+</button>
              </div>
              <div x-show="open" x-collapse class="mt-4 text-gray-600">
                <p>Absolutely! We provide detailed analytics reports showing follower growth, engagement rates, reach, impressions, and conversion metrics. You'll have access to real-time dashboards and weekly performance summaries.</p>
              </div>
            </div>

            <div class="bg-white p-6 rounded-lg shadow-sm border" x-data="{ open: false }">
              <div class="flex items-center justify-between cursor-pointer" @click="open = !open">
                <span class="font-semibold">Is my information secure when using your services?</span>
                <button class="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center transform transition-transform" :class="{ 'rotate-45': open }">+</button>
              </div>
              <div x-show="open" x-collapse class="mt-4 text-gray-600">
                <p>Yes, we take security seriously. All client data is encrypted, we use secure API connections, and we never share your information with third parties. Your account credentials and personal data are fully protected.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
  
  res.send(layout({ title: 'FAQ', user: req.user, content: faqContent }));
});
app.get('/services', (req,res)=> {
  const servicesContent = `
    <!-- Hero Section -->
    <section class="py-16 bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
      <div class="max-w-7xl mx-auto px-4 text-center">
        <h1 class="text-4xl font-bold">Our Services</h1>
        <p class="mt-4 text-lg text-purple-100">Complete social media marketing solutions for modern businesses</p>
      </div>
    </section>

    <!-- Main Services -->
    <section class="py-16 bg-gray-50">
      <div class="max-w-7xl mx-auto px-4">
        <div class="text-center mb-12">
          <h2 class="text-3xl font-bold mb-4">What We Offer</h2>
          <p class="text-gray-600 max-w-2xl mx-auto">From organic growth to conversion optimization, we provide end-to-end social media marketing services that deliver real results for your business.</p>
        </div>

        <!-- Service Grid -->
        <div class="grid lg:grid-cols-2 gap-8 mb-16">
          <!-- Instagram Growth -->
          <div class="bg-white rounded-2xl p-8 shadow-sm hover:shadow-lg transition-shadow">
            <div class="w-16 h-16 bg-gradient-to-br from-pink-500 to-purple-600 rounded-2xl flex items-center justify-center mb-6">
              <span class="text-white text-2xl">📱</span>
            </div>
            <h3 class="text-2xl font-bold mb-4">Instagram Growth</h3>
            <p class="text-gray-600 mb-6">Organic follower growth using AI-powered targeting, niche analysis, and competitor research. We focus on real, engaged followers who convert.</p>
            <ul class="space-y-3 mb-6">
              <li class="flex items-center gap-3">
                <div class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <span class="text-white text-xs">✓</span>
                </div>
                <span class="text-gray-700">Real, targeted followers</span>
              </li>
              <li class="flex items-center gap-3">
                <div class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <span class="text-white text-xs">✓</span>
                </div>
                <span class="text-gray-700">Hashtag optimization</span>
              </li>
              <li class="flex items-center gap-3">
                <div class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <span class="text-white text-xs">✓</span>
                </div>
                <span class="text-gray-700">Engagement automation</span>
              </li>
              <li class="flex items-center gap-3">
                <div class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <span class="text-white text-xs">✓</span>
                </div>
                <span class="text-gray-700">Growth pods network access</span>
              </li>
            </ul>
            <a href="/pricing" class="inline-block px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-600 text-white rounded-lg hover:from-pink-600 hover:to-purple-700 transition-all">Get Started</a>
          </div>

          <!-- Content Strategy -->
          <div class="bg-white rounded-2xl p-8 shadow-sm hover:shadow-lg transition-shadow">
            <div class="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center mb-6">
              <span class="text-white text-2xl">📊</span>
            </div>
            <h3 class="text-2xl font-bold mb-4">Content Strategy</h3>
            <p class="text-gray-600 mb-6">Data-driven content planning with custom calendars, viral reels playbook, and brand-aligned creatives that engage your audience.</p>
            <ul class="space-y-3 mb-6">
              <li class="flex items-center gap-3">
                <div class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <span class="text-white text-xs">✓</span>
                </div>
                <span class="text-gray-700">Custom content calendars</span>
              </li>
              <li class="flex items-center gap-3">
                <div class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <span class="text-white text-xs">✓</span>
                </div>
                <span class="text-gray-700">Viral reels templates</span>
              </li>
              <li class="flex items-center gap-3">
                <div class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <span class="text-white text-xs">✓</span>
                </div>
                <span class="text-gray-700">Brand voice development</span>
              </li>
              <li class="flex items-center gap-3">
                <div class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <span class="text-white text-xs">✓</span>
                </div>
                <span class="text-gray-700">Trending topic integration</span>
              </li>
            </ul>
            <a href="/contact" class="inline-block px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-all">Learn More</a>
          </div>

          <!-- Influencer Partnerships -->
          <div class="bg-white rounded-2xl p-8 shadow-sm hover:shadow-lg transition-shadow">
            <div class="w-16 h-16 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl flex items-center justify-center mb-6">
              <span class="text-white text-2xl">🤝</span>
            </div>
            <h3 class="text-2xl font-bold mb-4">Influencer Partnerships</h3>
            <p class="text-gray-600 mb-6">Connect with micro and macro influencers who match your brand values and drive real conversions through authentic partnerships.</p>
            <ul class="space-y-3 mb-6">
              <li class="flex items-center gap-3">
                <div class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <span class="text-white text-xs">✓</span>
                </div>
                <span class="text-gray-700">Influencer matching</span>
              </li>
              <li class="flex items-center gap-3">
                <div class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <span class="text-white text-xs">✓</span>
                </div>
                <span class="text-gray-700">Campaign management</span>
              </li>
              <li class="flex items-center gap-3">
                <div class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <span class="text-white text-xs">✓</span>
                </div>
                <span class="text-gray-700">Contract negotiations</span>
              </li>
              <li class="flex items-center gap-3">
                <div class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <span class="text-white text-xs">✓</span>
                </div>
                <span class="text-gray-700">Performance tracking</span>
              </li>
            </ul>
            <a href="/contact" class="inline-block px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all">Get Matched</a>
          </div>

          <!-- Analytics & Reporting -->
          <div class="bg-white rounded-2xl p-8 shadow-sm hover:shadow-lg transition-shadow">
            <div class="w-16 h-16 bg-gradient-to-br from-orange-500 to-red-600 rounded-2xl flex items-center justify-center mb-6">
              <span class="text-white text-2xl">📈</span>
            </div>
            <h3 class="text-2xl font-bold mb-4">Analytics & Reporting</h3>
            <p class="text-gray-600 mb-6">Comprehensive analytics dashboards with actionable insights, conversion tracking, and custom reports to optimize your ROI.</p>
            <ul class="space-y-3 mb-6">
              <li class="flex items-center gap-3">
                <div class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <span class="text-white text-xs">✓</span>
                </div>
                <span class="text-gray-700">Real-time dashboards</span>
              </li>
              <li class="flex items-center gap-3">
                <div class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <span class="text-white text-xs">✓</span>
                </div>
                <span class="text-gray-700">Conversion tracking</span>
              </li>
              <li class="flex items-center gap-3">
                <div class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <span class="text-white text-xs">✓</span>
                </div>
                <span class="text-gray-700">Weekly reports</span>
              </li>
              <li class="flex items-center gap-3">
                <div class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <span class="text-white text-xs">✓</span>
                </div>
                <span class="text-gray-700">Competitive analysis</span>
              </li>
            </ul>
            <a href="/performance" class="inline-block px-6 py-3 bg-gradient-to-r from-orange-500 to-red-600 text-white rounded-lg hover:from-orange-600 hover:to-red-700 transition-all">View Analytics</a>
          </div>
        </div>
      </div>
    </section>

    <!-- Process Section -->
    <section class="py-16 bg-white">
      <div class="max-w-7xl mx-auto px-4">
        <div class="text-center mb-12">
          <h2 class="text-3xl font-bold mb-4">Our Process</h2>
          <p class="text-gray-600">How we deliver results in 4 simple steps</p>
        </div>
        
        <div class="grid md:grid-cols-4 gap-8">
          <div class="text-center">
            <div class="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span class="text-indigo-600 text-2xl font-bold">1</span>
            </div>
            <h3 class="font-bold text-lg mb-2">Strategy</h3>
            <p class="text-gray-600 text-sm">We analyze your brand, audience, and competitors to create a custom growth strategy.</p>
          </div>
          
          <div class="text-center">
            <div class="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span class="text-purple-600 text-2xl font-bold">2</span>
            </div>
            <h3 class="font-bold text-lg mb-2">Setup</h3>
            <p class="text-gray-600 text-sm">We configure targeting parameters and begin organic growth campaigns.</p>
          </div>
          
          <div class="text-center">
            <div class="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span class="text-green-600 text-2xl font-bold">3</span>
            </div>
            <h3 class="font-bold text-lg mb-2">Growth</h3>
            <p class="text-gray-600 text-sm">Watch your followers, engagement, and reach grow with real, targeted users.</p>
          </div>
          
          <div class="text-center">
            <div class="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span class="text-blue-600 text-2xl font-bold">4</span>
            </div>
            <h3 class="font-bold text-lg mb-2">Optimize</h3>
            <p class="text-gray-600 text-sm">We continuously analyze and optimize campaigns for maximum ROI.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA Section -->
    <section class="py-16 bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
      <div class="max-w-4xl mx-auto px-4 text-center">
        <h2 class="text-3xl font-bold mb-4">Ready to Transform Your Social Media?</h2>
        <p class="text-lg mb-8">Join 2,800+ businesses already growing with SMM Matrix</p>
        <div class="flex gap-4 justify-center">
          <a href="/pricing" class="px-8 py-4 bg-white text-indigo-600 rounded-lg font-bold hover:bg-gray-100 transition-colors">View Pricing</a>
          <a href="/contact" class="px-8 py-4 border-2 border-white/30 rounded-lg hover:bg-white/10 transition-colors">Schedule Consultation</a>
        </div>
      </div>
    </section>
  `;
  
  res.send(layout({ title: 'Services', user: req.user, content: servicesContent }));
});


// ------------------------ Start server (only local) -----------------------
if (require.main === module) {
  // Running locally with: node smm-matrix-node.js
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () =>
    console.log(`\n${APP_TITLE} running → http://127.0.0.1:${PORT} (DB: ${db.name || 'smm_matrix_complete.db'})`)
  );
}

// For Vercel (export the app as a handler)
module.exports = app;




