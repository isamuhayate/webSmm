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
      ['Kickoff', 49, JSON.stringify(['600–800+ real followers','Growth pods network','Guaranteed results','Real-time analytics','24/7 Live support','Hashtag optimization'])],
      ['Growth',  89, JSON.stringify(['800–1,200+ real followers','Hashtag & account targeting','Targeted AI growth','Real-time analytics','Priority support','Content strategy'])],
      ['Advanced',149, JSON.stringify(['1,200–1,600+ real followers','10x engagement tools','Turn followers into conversions','Real-time analytics','Priority support','Personal account manager','Advanced targeting'])]
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
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<link href="https://cdnjs.cloudflare.com/ajax/libs/aos/2.3.4/aos.css" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/aos/2.3.4/aos.js"></script>

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

<!-- Pricing preview (colorful & animated, includes tooltip wrappers) -->
<section class="py-16 bg-white" data-tooltip-boundary>
  <div class="max-w-7xl mx-auto px-4">
    <div class="text-center mb-8"><h2 class="text-3xl font-bold">Pick a Plan</h2><p class="text-gray-600">Transparent pricing with clear features</p></div>
    <div class="grid md:grid-cols-3 gap-6">
      ${plans.map((p,i)=> {
        const features = JSON.parse(p.features);
        const accent = i===1 ? 'bg-gradient-to-br from-green-400 to-emerald-500 text-white' : i===0 ? 'bg-gradient-to-br from-indigo-600 to-indigo-400 text-white' : 'bg-gradient-to-br from-yellow-400 to-orange-400 text-white';
        return `
        <div class="pricing-card p-6 ${i===1?'transform scale-100':''}">
          <div class="rounded-lg overflow-hidden border">
            <div class="p-6 ${accent}">
              <div class="flex items-center justify-between">
                <div><h3 class="text-xl font-bold">${escapeHtml(p.name)}</h3><div class="text-sm opacity-90">${i===1?'<span class="inline-block mt-2 px-3 py-1 bg-white/20 rounded-full text-xs">Most Popular</span>':''}</div></div>
                <div class="text-right">
                  <div class="text-3xl font-extrabold">${currency(p.price_usd)}</div>
                  <div class="text-xs opacity-90">/month</div>
                </div>
              </div>
            </div>
            <div class="p-6 bg-white">
              <ul class="space-y-2 text-slate-700">
                ${features.map(f=>`<li>• ${escapeHtml(f)}</li>`).join('')}
              </ul>
              <div class="mt-4 flex gap-3">
                <a href="/checkout?plan_id=${p.id}" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold btn-animated">Get Started</a>
                <div class="pricing-tooltip-wrapper relative inline-block ml-auto">
                  <button class="px-4 py-2 rounded-lg border border-slate-200 text-sm">Details</button>
                  <div class="pricing-tooltip" role="tooltip">
                    <div class="text-sm">Discounts available for quarterly/annual billing. Custom enterprise pricing on request.</div>
                    <div class="pricing-tooltip-arrow"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>
</section>

<!-- Testimonials -->
<section class="py-16 bg-gradient-to-br from-indigo-50 to-purple-50">
  <div class="max-w-7xl mx-auto px-4">
    <div class="text-center mb-8"><h2 class="text-3xl font-bold">Client Stories</h2><p class="text-gray-600">Real results from real people</p></div>
    <div class="grid md:grid-cols-3 gap-6">
      ${reviews.slice(0,3).map(r=>`
        <div class="bg-white p-6 rounded-2xl shadow">
          <div class="flex items-center gap-4 mb-3">
            <img src="${r.avatar||'https://i.pravatar.cc/150?img=1'}" class="w-12 h-12 rounded-full object-cover" />
            <div>
              <div class="font-bold">${escapeHtml(r.name)}</div>
              <div class="text-yellow-500">${'★'.repeat(r.stars)}</div>
            </div>
          </div>
          <div class="text-slate-700 italic">"${escapeHtml(r.content)}"</div>
        </div>
      `).join('')}
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
<section class="max-w-7xl mx-auto px-4 py-12">
  <h2 class="text-3xl font-bold mb-6">Pricing</h2>
  <div class="grid md:grid-cols-3 gap-6">
    ${plans.map((p,i)=>`
      <div class="p-6 rounded-2xl pricing-card bg-white border">
        <div class="${i===1 ? 'bg-emerald-500 text-white' : i===0 ? 'bg-indigo-600 text-white' : 'bg-orange-400 text-white'} p-6 rounded-t-xl">
          <h3 class="text-xl font-bold">${escapeHtml(p.name)}</h3>
          <div class="text-3xl font-extrabold mt-2">${currency(p.price_usd)} <span class="text-sm">/mo</span></div>
        </div>
        <div class="p-6">
          <ul class="space-y-2 text-slate-700">${JSON.parse(p.features).map(f=>`<li>• ${escapeHtml(f)}</li>`).join('')}</ul>
          <div class="mt-4 flex items-center gap-3">
            <a href="/checkout?plan_id=${p.id}" class="px-4 py-2 rounded bg-indigo-600 text-white">Choose</a>
            <div class="pricing-tooltip-wrapper relative">
              <button class="px-3 py-1 border rounded text-sm">More</button>
              <div class="pricing-tooltip">Annual billing saves up to 20% — contact sales for enterprise pricing.<div class="pricing-tooltip-arrow"></div></div>
            </div>
          </div>
        </div>
      </div>`).join('')}
  </div>
</section>
` }));
});
app.get('/checkout', (req,res)=>{
  const plan = db.prepare('SELECT * FROM plans WHERE id=?').get(Number(req.query.plan_id));
  if (!plan) return res.status(404).send('Plan not found');
  if (!req.user) return res.redirect('/login');
  res.send(layout({ title:'Checkout', user:req.user, content:`<section class="max-w-3xl mx-auto px-4 py-10"><h2 class="text-2xl">Checkout — ${escapeHtml(plan.name)}</h2><p class="mt-2">Price: <b>${currency(plan.price_usd)}/mo</b></p><p class="text-slate-600 mt-3">Demo mode: payments not integrated — this is a placeholder for Stripe/PayPal integration.</p></section>` }));
});
app.post('/checkout', (req,res)=>{
  if (!req.user) return res.redirect('/login');
  const plan = db.prepare('SELECT * FROM plans WHERE id=?').get(Number(req.query.plan_id));
  if (!plan) return res.status(404).send('Plan not found');
  // pretend payment succeeded and mark as 'paid' — in real app hook payment gateway
  db.prepare('INSERT INTO orders(user_id,plan_id,ig_username,notes,status) VALUES (?,?,?,?,?)').run(req.user.id, plan.id, req.body.ig_username||'', req.body.notes||'', 'paid');
  res.redirect(req.user.role==='admin'?'/dashboard':'/');
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
app.get('/about', (req,res)=> res.send(GenericView({ user:req.user, title:'About', body: `
  <h3>SMM Matrix — Redefining Social Media Excellence</h3>
  <p class="text-slate-700">At SMM Matrix, we're not just a social media marketing agency — we're your partners in digital success.</p>
  <p class="text-slate-700 mt-3">Founded by marketing experts with real-world results. We focus on data-driven strategies and authentic engagement.</p>
` })));
app.get('/faq', (req,res)=> {
  const faqHtml = `
    <div class="grid md:grid-cols-2 gap-4">
      <div class="border rounded-xl p-4 bg-white">
        <div class="font-bold">Are followers real?</div>
        <div class="text-slate-700 mt-2">Yes. We target real users using niche targeting, competitor analysis and hashtag matching. We do not use bot farms.</div>
      </div>
      <div class="border rounded-xl p-4 bg-white">
        <div class="font-bold">How do you measure success?</div>
        <div class="text-slate-700 mt-2">We track profile visits, follows, engagement rate, and conversions. Regular reports are sent to clients.</div>
      </div>
      <div class="border rounded-xl p-4 bg-white">
        <div class="font-bold">Do you provide guarantees?</div>
        <div class="text-slate-700 mt-2">We provide steady growth guarantees per plan terms. Details are included on plan pages.</div>
      </div>
      <div class="border rounded-xl p-4 bg-white">
        <div class="font-bold">How do I cancel?</div>
        <div class="text-slate-700 mt-2">Cancel anytime from your dashboard. Payments & refunds depend on payment processor policy.</div>
      </div>
    </div>
  `;
  res.send(layout({ title:'FAQ', user:req.user, content: `<section class='max-w-7xl mx-auto px-4 py-10'><h2 class='text-3xl font-bold'>Frequently Asked Questions</h2>${faqHtml}</section>` }));
});
app.get('/services', (req,res)=> res.send(GenericView({ user:req.user, title:'Services', body: `
  <h3>Our Services</h3>
  <ul class="list-disc ml-6 text-slate-700">
    <li><b>Instagram Growth</b> — organic followers, algorithm-optimized posting.</li>
    <li><b>Content Strategy</b> — calendars, reels playbook, creatives.</li>
    <li><b>Influencer Partnerships</b> — micro to macro matching and campaign management.</li>
    <li><b>Analytics & Reporting</b> — dashboards, conversion tracking, custom reports.</li>
  </ul>
` })));
app.get('/team', (req,res)=> res.send(GenericView({ user:req.user, title:'Team', body:`<p class="text-slate-700">Distributed team of growth strategists, creatives, data scientists and account managers.</p>` })));
app.get('/reviews', (req,res)=> {
  const reviews = db.prepare('SELECT * FROM reviews ORDER BY created_at DESC').all();
  res.send(layout({ title:'Reviews', user:req.user, content: `<section class='max-w-4xl mx-auto px-4 py-10'><h2 class='text-3xl font-bold'>Reviews</h2><div class='mt-4'>${reviews.map(r=>`<div class='p-3 border rounded mb-2'><b>${escapeHtml(r.name)}</b> • ${'★'.repeat(r.stars)}<div class='text-slate-700 mt-1'>${escapeHtml(r.content)}</div></div>`).join('')}</div></section>` }));
});
app.get('/terms', (req,res)=> res.send(GenericView({ user:req.user, title:'Terms', body:`<p class="text-slate-700">Terms placeholder — replace before production.</p>` })));
app.get('/privacy', (req,res)=> res.send(GenericView({ user:req.user, title:'Privacy Policy', body:`<p class="text-slate-700">Privacy placeholder — replace before production.</p>` })));
app.get('/refunds', (req,res)=> res.send(GenericView({ user:req.user, title:'Refunds', body:`<p class="text-slate-700">Refund policy placeholder.</p>` })));

// ------------------------ Start server -----------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`\n${APP_TITLE} running → http://127.0.0.1:${PORT} (DB: ${db.name || 'smm_matrix_complete.db'})`));
