// ── DOM References ──────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

// Platform status badges (clickable for login/logout)
const igStatusEl = $('#ig-login-status');
const twStatusEl = $('#tw-login-status');
const fbStatusEl = $('#fb-login-status');
const liStatusEl = $('#li-login-status');

const inputUrl = $('#input-url');
const btnAdd = $('#btn-add');
const addError = $('#add-error');
const feedsList = $('#feeds-list');
const emptyState = $('#empty-state');
const feedCount = $('#feed-count');
const btnRefreshAll = $('#btn-refresh-all');
const btnCopyOpml = $('#btn-copy-opml');
const btnBlurToggle = $('#btn-blur-toggle');
let urlsBlurred = false;


// Tunnel elements
const tunnelStatusBadge = $('#tunnel-status-badge');
const tunnelStatusText = $('#tunnel-status-text');
const btnTunnelToggle = $('#btn-tunnel-toggle');
const btnTunnelSetup = $('#btn-tunnel-setup');
const logoLink = $('#logo-link');
const tunnelWizard = $('#tunnel-setup-wizard');
const btnCfLogin = $('#btn-cf-login');
const btnCfCreate = $('#btn-cf-create');
const btnCfDns = $('#btn-cf-dns');
const linkCloudflared = $('#link-cloudflared');

// Public Access overlay elements
const btnPublicAccess = $('#btn-public-access');
const publicAccessOverlay = $('#public-access-overlay');
const btnCloseOverlay = $('#btn-close-overlay');
let publicAccessOpen = false;
let currentTunnelStatus = 'stopped';

// Notification elements
const btnBell = $('#btn-bell');
const bellBadge = $('#bell-badge');
const notifPanel = $('#notification-panel');
const notifList = $('#notif-panel-list');
const btnNotifClear = $('#btn-notif-clear');
let notifPanelOpen = false;
let notifications = [];

let serverPort = 3845;
let igLoggedIn = false;
let twLoggedIn = false;
let fbLoggedIn = false;
let liLoggedIn = false;
let tunnelDomain = '';
let tunnelRunning = false;
let feedToken = '';
/** Resolved origin for local feed links (localhost or optional LAN base). */
let resolvedFeedBase = '';

// Active platform tab in feed list
let activeGroup = null;

// Labels & Filters modal state
let allLabels = [];
let modalTargetFeed = null;      // feed object currently being edited in a modal
let pendingLabels = [];          // labels being edited in the labels modal

// Global filter state
let globalFilterText = '';
let globalFilterActive = false;

// ── Init ────────────────────────────────────────────────────────────────

(async function init() {
  serverPort = await window.api.getServerPort();
  resolvedFeedBase = await window.api.getResolvedFeedBaseUrl();

  // Load notifications
  notifications = await window.api.getNotifications();
  renderNotifications();

  // Load feed token
  feedToken = await window.api.getFeedToken();
  updateTokenUI();

  // Load global labels
  allLabels = await window.api.getAllLabels();

  // Load HTTP cache setting
  updateCacheUI(await window.api.getHttpCacheEnabled());

  // Load scrape timeout settings
  updateScrapeTimeoutsUI(await window.api.getScrapeTimeouts());

  // Load auto-refresh setting
  const arSettings = await window.api.getAutoRefresh();
  updateAutoRefreshUI(arSettings);

  // Load smart-refresh setting
  const srSettings = await window.api.getSmartRefresh();
  updateSmartRefreshUI(srSettings);

  const feedPublicBaseInput = $('#feed-public-base-input');
  if (feedPublicBaseInput) {
    feedPublicBaseInput.value = await window.api.getFeedPublicBaseUrl();
  }

  // Load tunnel settings
  const tunnelSettings = await window.api.tunnelGetSettings();
  tunnelDomain = tunnelSettings.domain || '';
  updateDomainDisplay();

  // Populate domain input
  const domainInput = $('#tunnel-domain-input');
  if (domainInput) domainInput.value = tunnelDomain;
  const tunnelNameInput = $('#tunnel-name-input');
  if (tunnelNameInput) tunnelNameInput.value = tunnelSettings.tunnelName || 'unsocial-tunnel';

  $('#wizard-domain').textContent = tunnelDomain || '<your-domain>';
  $('#wizard-tunnel-name').textContent = tunnelSettings.tunnelName || 'unsocial-tunnel';

  // Check tunnel state
  const tState = await window.api.tunnelState();
  updateTunnelUI(tState.status);
  updatePublicAccessIcon();

  // Check logins
  await window.api.checkLogin();
  await window.api.checkTwitterLogin();
  await window.api.checkFacebookLogin();
  await window.api.checkLinkedInLogin();

  // Load feeds
  await renderFeeds();
})();

// ── Login Status Updates ────────────────────────────────────────────────

window.api.onLoginStatus(({ platform, loggedIn }) => {
  if (platform === 'twitter') {
    twLoggedIn = loggedIn;
    updatePlatformLoginUI('twitter', loggedIn);
  } else if (platform === 'facebook') {
    fbLoggedIn = loggedIn;
    updatePlatformLoginUI('facebook', loggedIn);
  } else if (platform === 'linkedin') {
    liLoggedIn = loggedIn;
    updatePlatformLoginUI('linkedin', loggedIn);
  } else {
    igLoggedIn = loggedIn;
    updatePlatformLoginUI('instagram', loggedIn);
  }
  // Re-render feeds so logged-out platforms show red background
  renderFeeds();
});

window.api.onTunnelStatus(({ status }) => {
  updateTunnelUI(status);
  // Update DNS step checkmark when tunnel connects
  if (status === 'running') {
    const dnsStatus = $('#step-dns-status');
    if (dnsStatus) {
      dnsStatus.textContent = '✓ Routed';
      dnsStatus.className = 'step-status ok';
      const dnsStep = $('#wizard-step-dns');
      if (dnsStep) dnsStep.classList.add('done');
    }
  }
});

// Auto-refresh: re-render feeds when main process refreshes them
if (window.api.onFeedsUpdated) {
  window.api.onFeedsUpdated(() => renderFeeds());
}

// Live notification updates from main process
if (window.api.onNotificationsUpdated) {
  window.api.onNotificationsUpdated((data) => {
    notifications = data;
    renderNotifications();
  });
}

function updateTunnelUI(status) {
  currentTunnelStatus = status;
  tunnelRunning = status === 'running';
  tunnelStatusText.textContent =
    status === 'running' ? 'Connected' :
    status === 'starting' ? 'Connecting…' :
    status === 'error' ? 'Error' : 'Stopped';
  tunnelStatusBadge.className =
    'status-badge ' + (status === 'running' ? 'online' : 'offline');
  btnTunnelToggle.textContent =
    status === 'running' ? '⏹ Stop Tunnel' :
    status === 'starting' ? '⏳ Connecting…' : '▶ Start Tunnel';
  btnTunnelToggle.disabled = status === 'starting';
  updateTunnelUrls();
  updatePublicAccessIcon();
}

function updatePublicAccessIcon() {
  const hasErrors = notifications.some(n => !n.resolved && n.type === 'error');
  btnPublicAccess.classList.remove('status-green', 'status-yellow', 'status-red');

  if (hasErrors) {
    btnPublicAccess.classList.add('status-red');
  } else if (currentTunnelStatus === 'running') {
    btnPublicAccess.classList.add('status-green');
  } else if (currentTunnelStatus === 'starting') {
    btnPublicAccess.classList.add('status-yellow');
  }
}

function updateDomainDisplay() {
  const wizardDomain = $('#wizard-domain');
  if (wizardDomain) wizardDomain.textContent = tunnelDomain || '<your-domain>';
}

function tokenQueryString(prefix) {
  if (!feedToken) return '';
  return prefix + 'token=' + feedToken;
}

function updateTunnelUrls() {
  const urlsEl = $('#tunnel-urls');
  if (!urlsEl) return;
  const tokenSuffix = tokenQueryString('?');
  const localUrl = `${resolvedFeedBase || `http://localhost:${serverPort}`}/feed/<username>${tokenSuffix}`;
  const publicUrl = tunnelDomain ? `https://${tunnelDomain}/feed/<username>${tokenSuffix}` : 'Set a domain above to enable public URLs';
  urlsEl.innerHTML = `
    <div class="tunnel-url-row">
      <span class="tunnel-url-label">Local:</span>
      <a class="tunnel-url-value tunnel-url-local" title="Click to copy">${escapeHtml(localUrl)}</a>
    </div>
    <div class="tunnel-url-row">
      <span class="tunnel-url-label">Public:</span>
      <span class="tunnel-url-value tunnel-url-public ${tunnelRunning ? 'active' : 'inactive'}" title="${tunnelRunning ? 'Click to copy' : 'Start tunnel to activate'}">${escapeHtml(publicUrl)}</span>
    </div>
  `;
  urlsEl.querySelector('.tunnel-url-local')?.addEventListener('click', () => {
    copyToClipboard(localUrl);
    toast('Local URL copied!', 'success');
  });
  if (tunnelDomain) {
    urlsEl.querySelector('.tunnel-url-public')?.addEventListener('click', () => {
      if (tunnelRunning) {
        copyToClipboard(`https://${tunnelDomain}/feed/<username>${tokenSuffix}`);
        toast('Public URL copied!', 'success');
      }
    });
  }
}

function updatePlatformLoginUI(platform, loggedIn) {
  if (platform === 'twitter') {
    twStatusEl.className = 'status-badge platform-clickable ' + (loggedIn ? 'online' : 'offline');
  } else if (platform === 'facebook') {
    fbStatusEl.className = 'status-badge platform-clickable ' + (loggedIn ? 'online' : 'offline');
  } else if (platform === 'linkedin') {
    liStatusEl.className = 'status-badge platform-clickable ' + (loggedIn ? 'online' : 'offline');
  } else {
    igStatusEl.className = 'status-badge platform-clickable ' + (loggedIn ? 'online' : 'offline');
  }
}

// ── Event Listeners ─────────────────────────────────────────────────────

// Click platform badge: login if offline, confirm logout if online
igStatusEl.addEventListener('click', () => {
  if (igLoggedIn) {
    if (confirm('Log out of Instagram?')) window.api.logout();
  } else {
    window.api.openLogin();
  }
});

twStatusEl.addEventListener('click', () => {
  if (twLoggedIn) {
    if (confirm('Log out of Twitter / X?')) window.api.logoutTwitter();
  } else {
    window.api.openTwitterLogin();
  }
});

fbStatusEl.addEventListener('click', () => {
  if (fbLoggedIn) {
    if (confirm('Log out of Facebook?')) window.api.logoutFacebook();
  } else {
    window.api.openFacebookLogin();
  }
});

liStatusEl.addEventListener('click', () => {
  if (liLoggedIn) {
    if (confirm('Log out of LinkedIn?')) window.api.logoutLinkedIn();
  } else {
    window.api.openLinkedInLogin();
  }
});

// Right-click platform badge: force reset (clears all cookies & storage)
for (const [el, platform, name] of [
  [igStatusEl, 'instagram', 'Instagram'],
  [twStatusEl, 'twitter', 'Twitter / X'],
  [fbStatusEl, 'facebook', 'Facebook'],
  [liStatusEl, 'linkedin', 'LinkedIn'],
]) {
  el.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (confirm(`Force reset ${name}? This will clear ALL cookies and stored data for ${name}. You will need to log in again.`)) {
      await window.api.forceResetPlatform(platform);
      toast(`${name} fully reset`, 'success');
    }
  });
  el.title += ' · Right-click to force reset';
}

btnAdd.addEventListener('click', addFeed);
inputUrl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addFeed();
});

btnRefreshAll.addEventListener('click', refreshAll);
btnCopyOpml.addEventListener('click', exportOpml);

btnBlurToggle.addEventListener('click', () => {
  urlsBlurred = !urlsBlurred;
  document.getElementById('app').classList.toggle('urls-blurred', urlsBlurred);
  btnBlurToggle.classList.toggle('is-active', urlsBlurred);
  btnBlurToggle.dataset.state = urlsBlurred ? 'on' : 'off';
  btnBlurToggle.title = urlsBlurred ? 'Show URLs' : 'Blur URLs';
  btnBlurToggle.setAttribute('aria-label', urlsBlurred ? 'Show URLs' : 'Blur URLs');
});

logoLink.addEventListener('click', (e) => {
  e.preventDefault();
  window.api.openExternal('https://github.com/pynbbz/UnSocial');
});

// ── Notification Bell ────────────────────────────────────────────────────────

btnBell.addEventListener('click', (e) => {
  e.stopPropagation();
  notifPanelOpen = !notifPanelOpen;
  notifPanel.style.display = notifPanelOpen ? '' : 'none';
});

// Close panel when clicking outside
document.addEventListener('click', (e) => {
  if (notifPanelOpen && !e.target.closest('.notification-wrapper')) {
    notifPanelOpen = false;
    notifPanel.style.display = 'none';
  }
});

btnNotifClear.addEventListener('click', async () => {
  notifications = await window.api.clearNotifications();
  renderNotifications();
});

// ── Public Access Overlay ───────────────────────────────────────────────────

btnPublicAccess.addEventListener('click', (e) => {
  e.stopPropagation();
  publicAccessOpen = true;
  publicAccessOverlay.style.display = '';
});

btnCloseOverlay.addEventListener('click', () => {
  publicAccessOpen = false;
  publicAccessOverlay.style.display = 'none';
});

publicAccessOverlay.addEventListener('click', (e) => {
  if (e.target === publicAccessOverlay) {
    publicAccessOpen = false;
    publicAccessOverlay.style.display = 'none';
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && publicAccessOpen) {
    publicAccessOpen = false;
    publicAccessOverlay.style.display = 'none';
  }
});

function renderNotifications() {
  const unresolved = notifications.filter(n => !n.resolved);
  const unresolvedErrors = unresolved.filter(n => n.type === 'error');

  // Update badge
  if (unresolved.length > 0) {
    bellBadge.style.display = '';
    bellBadge.textContent = unresolved.length;
  } else {
    bellBadge.style.display = 'none';
  }

  // Pulse bell if active errors
  if (unresolvedErrors.length > 0) {
    btnBell.classList.add('has-errors');
  } else {
    btnBell.classList.remove('has-errors');
  }

  updatePublicAccessIcon();

  // Render list
  if (notifications.length === 0) {
    notifList.innerHTML = '<div class="notif-empty">No notifications</div>';
    return;
  }

  notifList.innerHTML = '';
  for (const n of notifications) {
    const item = document.createElement('div');
    item.className = 'notif-item' + (n.resolved ? ' resolved' : '');
    const icon = n.type === 'error' ? '❌' : n.type === 'warning' ? '⚠️' : 'ℹ️';
    const timeStr = formatNotifTime(n.timestamp);
    item.innerHTML = `
      <span class="notif-icon">${icon}</span>
      <div class="notif-body">
        <div class="notif-message">${escapeHtml(n.message)}</div>
        <div class="notif-time">${timeStr}</div>
      </div>
      ${!n.resolved ? '<button class="notif-dismiss" title="Dismiss">✕</button>' : ''}
    `;
    if (!n.resolved) {
      item.querySelector('.notif-dismiss').addEventListener('click', async (e) => {
        e.stopPropagation();
        notifications = await window.api.resolveNotification(n.id);
        renderNotifications();
      });
    }
    notifList.appendChild(item);
  }
}

function formatNotifTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString();
}



// Tunnel controls
btnTunnelToggle.addEventListener('click', async () => {
  const state = await window.api.tunnelState();
  if (state.status === 'running' || state.status === 'starting') {
    await window.api.tunnelStop();
    updateTunnelUI('stopped');
    toast('Tunnel stopped', 'success');
  } else {
    await window.api.tunnelStart();
    updateTunnelUI('starting');
    toast('Starting tunnel…', 'success');
  }
});

btnTunnelSetup.addEventListener('click', () => {
  const wizard = tunnelWizard;
  if (wizard.style.display === 'none') {
    wizard.style.display = '';
    runSetupChecks();
  } else {
    wizard.style.display = 'none';
  }
});

// Domain & tunnel name save
const btnSaveTunnelSettings = $('#btn-save-tunnel-settings');
if (btnSaveTunnelSettings) {
  btnSaveTunnelSettings.addEventListener('click', async () => {
    const domainInput = $('#tunnel-domain-input');
    const tunnelNameInput = $('#tunnel-name-input');
    const newDomain = (domainInput?.value || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const newTunnelName = (tunnelNameInput?.value || '').trim() || 'unsocial-tunnel';
    await window.api.tunnelSaveSettings({ domain: newDomain, tunnelName: newTunnelName });
    tunnelDomain = newDomain;
    updateDomainDisplay();
    updateTunnelUrls();
    $('#wizard-tunnel-name').textContent = newTunnelName;
    await renderFeeds();
    toast('Tunnel settings saved!', 'success');
  });
}

linkCloudflared.addEventListener('click', (e) => {
  e.preventDefault();
  window.api.openExternal('https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
});

// ── Token Authentication ────────────────────────────────────────────────

const tokenDisplay = $('#token-display');
const tokenStatus = $('#token-status');
const btnTokenGenerate = $('#btn-token-generate');
const btnTokenCopy = $('#btn-token-copy');
const btnTokenClear = $('#btn-token-clear');

function updateTokenUI() {
  if (feedToken) {
    tokenDisplay.value = feedToken;
    tokenStatus.textContent = 'Enabled';
    tokenStatus.className = 'token-status enabled';
    btnTokenClear.style.display = '';
    btnTokenCopy.style.display = '';
  } else {
    tokenDisplay.value = '';
    tokenDisplay.placeholder = 'No token set — feeds are public';
    tokenStatus.textContent = 'Disabled';
    tokenStatus.className = 'token-status disabled';
    btnTokenClear.style.display = 'none';
    btnTokenCopy.style.display = 'none';
  }
  updateTunnelUrls();
}

btnTokenGenerate.addEventListener('click', async () => {
  feedToken = await window.api.generateFeedToken();
  updateTokenUI();
  await renderFeeds();
  toast('Token generated — feed URLs now require authentication', 'success');
});

btnTokenCopy.addEventListener('click', () => {
  if (feedToken) {
    copyToClipboard(feedToken);
    toast('Token copied!', 'success');
  }
});

btnTokenClear.addEventListener('click', async () => {
  if (!confirm('Remove authentication token? All feed URLs will become publicly accessible.')) return;
  feedToken = '';
  await window.api.setFeedToken('');
  updateTokenUI();
  await renderFeeds();
  toast('Token removed — feeds are now public', 'success');
});

// ── Smart Staggered Refresh ───────────────────────────────────────────────

const smartRefreshStatus  = $('#smart-refresh-status');
const smartMinInput       = $('#smart-min-input');
const smartMaxInput       = $('#smart-max-input');
const smartStaleInput     = $('#smart-stale-input');
const btnSmartSave        = $('#btn-smart-refresh-save');
const btnSmartToggle      = $('#btn-smart-refresh-toggle');

function updateSmartRefreshUI({ enabled, minMinutes, maxMinutes, staleCapHours }) {
  smartMinInput.value   = minMinutes;
  smartMaxInput.value   = maxMinutes;
  smartStaleInput.value = staleCapHours;
  if (enabled) {
    smartRefreshStatus.textContent = 'Activado';
    smartRefreshStatus.className   = 'token-status enabled';
    btnSmartToggle.textContent     = 'Desactivar';
    btnSmartToggle.className       = 'btn btn-outline btn-sm';
  } else {
    smartRefreshStatus.textContent = 'Desactivado';
    smartRefreshStatus.className   = 'token-status disabled';
    btnSmartToggle.textContent     = 'Activar';
    btnSmartToggle.className       = 'btn btn-primary btn-sm';
  }
}

btnSmartSave.addEventListener('click', async () => {
  const current = await window.api.getSmartRefresh();
  const result = await window.api.setSmartRefresh({
    enabled: current.enabled,
    minMinutes: parseInt(smartMinInput.value, 10) || 25,
    maxMinutes: parseInt(smartMaxInput.value, 10) || 65,
    staleCapHours: parseInt(smartStaleInput.value, 10) || 6,
  });
  updateSmartRefreshUI(result);
  toast('Configuración del Smart Refresh guardada', 'success');
});

btnSmartToggle.addEventListener('click', async () => {
  const current = await window.api.getSmartRefresh();
  const result = await window.api.setSmartRefresh({ enabled: !current.enabled });
  updateSmartRefreshUI(result);
  toast(result.enabled ? 'Smart Refresh activado' : 'Smart Refresh desactivado', 'success');
});

// ── Auto Refresh ─────────────────────────────────────────────────────────

const btnAutoRefreshToggle = $('#btn-auto-refresh-toggle');
const autoRefreshStatus   = $('#auto-refresh-status');
const autoRefreshInterval = $('#auto-refresh-interval');
const autoRefreshCountdown = $('#auto-refresh-countdown');
const autoRefreshTimer    = $('#auto-refresh-timer');

let countdownInterval = null;
let nextRefreshAt = null;

function updateAutoRefreshUI({ enabled, intervalMinutes, nextAt }) {
  autoRefreshInterval.value = intervalMinutes || 30;
  nextRefreshAt = nextAt || null;

  if (enabled) {
    autoRefreshStatus.textContent = 'Activado';
    autoRefreshStatus.className = 'token-status enabled';
    btnAutoRefreshToggle.textContent = 'Desactivar';
    btnAutoRefreshToggle.className = 'btn btn-outline btn-sm';
    autoRefreshInterval.disabled = true;
    autoRefreshCountdown.style.display = '';
    startCountdown();
  } else {
    autoRefreshStatus.textContent = 'Desactivado';
    autoRefreshStatus.className = 'token-status disabled';
    btnAutoRefreshToggle.textContent = 'Activar';
    btnAutoRefreshToggle.className = 'btn btn-primary btn-sm';
    autoRefreshInterval.disabled = false;
    autoRefreshCountdown.style.display = 'none';
    stopCountdown();
  }
}

function startCountdown() {
  stopCountdown();
  countdownInterval = setInterval(() => {
    if (!nextRefreshAt) { autoRefreshTimer.textContent = '--:--'; return; }
    const diffMs = new Date(nextRefreshAt).getTime() - Date.now();
    if (diffMs <= 0) { autoRefreshTimer.textContent = '00:00'; return; }
    const totalSec = Math.floor(diffMs / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    autoRefreshTimer.textContent = h > 0
      ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
      : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }, 1000);
}

function stopCountdown() {
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
}

btnAutoRefreshToggle.addEventListener('click', async () => {
  const current = await window.api.getAutoRefresh();
  const minutes = parseInt(autoRefreshInterval.value, 10) || 30;
  const result = await window.api.setAutoRefresh({ enabled: !current.enabled, intervalMinutes: minutes });
  updateAutoRefreshUI(result);
  toast(result.enabled
    ? `Actualización automática cada ${minutes} min activada`
    : 'Actualización automática desactivada', 'success');
});

window.api.onAutoRefreshTick(({ nextAt }) => {
  nextRefreshAt = nextAt;
  if (nextAt) {
    autoRefreshCountdown.style.display = '';
    startCountdown();
    renderFeeds();
  }
});

// ── Test Feed ────────────────────────────────────────────────────────────

$('#btn-test-feed-copy').addEventListener('click', () => {
  const url = `http://localhost:${serverPort}/feed/test`;
  copyToClipboard(url);
  toast('URL de prueba copiada!', 'success');
});

$('#btn-test-feed-open').addEventListener('click', () => {
  window.api.openExternal(`http://localhost:${serverPort}/feed/test`);
});

// ── HTTP Cache Toggle ────────────────────────────────────────────────────

const btnCacheToggle = $('#btn-cache-toggle');
const cacheStatus = $('#cache-status');

function updateCacheUI(enabled) {
  if (enabled) {
    cacheStatus.textContent = 'Activado';
    cacheStatus.className = 'token-status enabled';
    btnCacheToggle.textContent = 'Desactivar cache';
    btnCacheToggle.className = 'btn btn-outline btn-sm';
  } else {
    cacheStatus.textContent = 'Desactivado';
    cacheStatus.className = 'token-status disabled';
    btnCacheToggle.textContent = 'Activar cache';
    btnCacheToggle.className = 'btn btn-primary btn-sm';
  }
}

btnCacheToggle.addEventListener('click', async () => {
  const current = await window.api.getHttpCacheEnabled();
  const next = !current;
  await window.api.setHttpCacheEnabled(next);
  updateCacheUI(next);
  toast(next ? 'Cache HTTP activado' : 'Cache HTTP desactivado — los lectores RSS recibirán siempre el XML completo', 'success');
});

// ── Scrape Timeouts ───────────────────────────────────────────────────────

const timeoutInstagramInput = $('#timeout-instagram-input');
const timeoutTwitterInput   = $('#timeout-twitter-input');
const timeoutFacebookInput  = $('#timeout-facebook-input');
const timeoutLinkedInInput  = $('#timeout-linkedin-input');
const btnScrapeTimeoutsSave  = $('#btn-scrape-timeouts-save');
const btnScrapeTimeoutsReset = $('#btn-scrape-timeouts-reset');

const TIMEOUT_DEFAULTS = { instagram: 60000, twitter: 35000, facebook: 60000, linkedin: 45000 };

function updateScrapeTimeoutsUI({ instagram, twitter, facebook, linkedin }) {
  timeoutInstagramInput.value = instagram;
  timeoutTwitterInput.value   = twitter;
  timeoutFacebookInput.value  = facebook;
  timeoutLinkedInInput.value  = linkedin;
}

btnScrapeTimeoutsSave.addEventListener('click', async () => {
  const result = await window.api.setScrapeTimeouts({
    instagram: parseInt(timeoutInstagramInput.value, 10) || TIMEOUT_DEFAULTS.instagram,
    twitter:   parseInt(timeoutTwitterInput.value,   10) || TIMEOUT_DEFAULTS.twitter,
    facebook:  parseInt(timeoutFacebookInput.value,  10) || TIMEOUT_DEFAULTS.facebook,
    linkedin:  parseInt(timeoutLinkedInInput.value,  10) || TIMEOUT_DEFAULTS.linkedin,
  });
  updateScrapeTimeoutsUI(result);
  toast('Timeouts de scraping guardados', 'success');
});

btnScrapeTimeoutsReset.addEventListener('click', async () => {
  const result = await window.api.setScrapeTimeouts(TIMEOUT_DEFAULTS);
  updateScrapeTimeoutsUI(result);
  toast('Timeouts restaurados a valores predeterminados', 'success');
});

const btnSaveFeedPublicBase = $('#btn-save-feed-public-base');
if (btnSaveFeedPublicBase) {
  btnSaveFeedPublicBase.addEventListener('click', async () => {
    const inp = $('#feed-public-base-input');
    await window.api.setFeedPublicBaseUrl((inp && inp.value) || '');
    if (inp) inp.value = await window.api.getFeedPublicBaseUrl();
    resolvedFeedBase = await window.api.getResolvedFeedBaseUrl();
    updateTunnelUrls();
    await renderFeeds();
    toast('LAN base URL saved. Refresh feeds to rewrite RSS/Atom files.', 'success');
  });
}

btnCfLogin.addEventListener('click', async () => {
  btnCfLogin.disabled = true;
  btnCfLogin.textContent = '⏳ Running…';
  const r = await window.api.tunnelRunSetup('login');
  $('#step-login-status').textContent = r.success ? '✓ Done' : '✗ Failed';
  $('#step-login-status').className = 'step-status ' + (r.success ? 'ok' : 'fail');
  btnCfLogin.disabled = false;
  btnCfLogin.textContent = 'Run Login';
  if (r.success) runSetupChecks();
});

btnCfCreate.addEventListener('click', async () => {
  btnCfCreate.disabled = true;
  btnCfCreate.textContent = '⏳ Creating…';
  const r = await window.api.tunnelRunSetup('create');
  $('#step-create-status').textContent = r.success ? '✓ Created' : r.output.includes('already exists') ? '✓ Already exists' : '✗ Failed';
  $('#step-create-status').className = 'step-status ' + (r.success || r.output.includes('already exists') ? 'ok' : 'fail');
  btnCfCreate.disabled = false;
  btnCfCreate.textContent = 'Create Tunnel';
  runSetupChecks();
});

btnCfDns.addEventListener('click', async () => {
  btnCfDns.disabled = true;
  btnCfDns.textContent = '⏳ Routing…';
  const r = await window.api.tunnelRunSetup('dns');
  $('#step-dns-status').textContent = r.success ? '✓ Routed' : r.output.includes('already exists') ? '✓ Already routed' : '✗ Failed';
  $('#step-dns-status').className = 'step-status ' + (r.success || r.output.includes('already exists') ? 'ok' : 'fail');
  btnCfDns.disabled = false;
  btnCfDns.textContent = 'Route DNS';
});

async function runSetupChecks() {
  // Step 1: Check cloudflared installed
  const installed = await window.api.tunnelCheckInstalled();
  const installStatus = $('#step-install-status');
  installStatus.textContent = installed.installed ? `✓ ${installed.version}` : '✗ Not found';
  installStatus.className = 'step-status ' + (installed.installed ? 'ok' : 'fail');
  if (installed.installed) {
    $('#wizard-step-install').classList.add('done');
  }

  if (installed.installed) {
    // Step 2: Check authentication (cert.pem exists)
    const auth = await window.api.tunnelCheckAuthenticated();
    if (auth.authenticated) {
      $('#step-login-status').textContent = '✓ Authenticated';
      $('#step-login-status').className = 'step-status ok';
      $('#wizard-step-login').classList.add('done');
    }

    // Step 3: Check tunnel exists
    const setup = await window.api.tunnelCheckSetup();
    if (setup.exists) {
      $('#step-create-status').textContent = '✓ Exists';
      $('#step-create-status').className = 'step-status ok';
      $('#wizard-step-create').classList.add('done');
    }

    // Step 4: If tunnel is running or was previously set up, DNS is routed
    // (DNS route is idempotent and auto-run on every launch by main process)
    if (setup.exists && auth.authenticated) {
      const tState = await window.api.tunnelState();
      if (tState.status === 'running' || tState.status === 'starting') {
        $('#step-dns-status').textContent = '✓ Routed';
        $('#step-dns-status').className = 'step-status ok';
        $('#wizard-step-dns').classList.add('done');
      }
    }
  }
}

// ── Add Feed ────────────────────────────────────────────────────────────

async function addFeed() {
  const url = inputUrl.value.trim();
  if (!url) return;

  addError.textContent = '';
  setBtnLoading(btnAdd, true);

  try {
    await window.api.addFeed(url);
    inputUrl.value = '';
    await renderFeeds();
    toast('Feed added successfully!', 'success');
  } catch (err) {
    addError.textContent = err.message || 'Failed to add feed';
    toast(err.message || 'Failed to add feed', 'error');
  } finally {
    setBtnLoading(btnAdd, false);
    // Re-ensure input is interactive after hidden scraper windows close
    inputUrl.disabled = false;
    inputUrl.style.pointerEvents = 'auto';
    window.focus();
  }
}

// ── Render Feeds ────────────────────────────────────────────────────────

async function renderFeeds() {
  const allFeeds = await window.api.getFeeds();

  // Apply global search filter
  const feeds = globalFilterText
    ? allFeeds.filter(f =>
        (f.alias || '').toLowerCase().includes(globalFilterText) ||
        (f.username || '').toLowerCase().includes(globalFilterText) ||
        (f.labels || []).some(l => l.toLowerCase().includes(globalFilterText))
      )
    : allFeeds;

  feedCount.textContent = `${allFeeds.length} feed${allFeeds.length !== 1 ? 's' : ''}`;

  if (feeds.length === 0) {
    feedsList.innerHTML = '';
    feedsList.appendChild(createEmptyState());
    return;
  }

  feedsList.innerHTML = '';

  // Group feeds by platform category
  const groups = {};
  const groupOrder = ['Instagram', 'Twitter', 'Facebook', 'LinkedIn', 'Custom', 'Text'];
  for (const feed of feeds) {
    const platform = feed.platform || 'instagram';
    const category = platform === 'twitter' ? 'Twitter' :
      platform === 'facebook' ? 'Facebook' :
      platform === 'linkedin' ? 'LinkedIn' :
      platform === 'txt' ? 'Text' :
      platform === 'custom' ? 'Custom' : 'Instagram';
    if (!groups[category]) groups[category] = [];
    groups[category].push(feed);
  }

  // Build label-based groups from feeds that have labels
  const labelGroups = {};
  for (const feed of feeds) {
    for (const label of (feed.labels || [])) {
      if (!labelGroups[label]) labelGroups[label] = [];
      labelGroups[label].push(feed);
    }
  }

  // Render in defined order, then any extras
  const orderedCategories = groupOrder.filter(c => groups[c]);
  for (const cat of Object.keys(groups)) {
    if (!orderedCategories.includes(cat)) orderedCategories.push(cat);
  }
  // Add label tabs after platform tabs (prefixed with '#' to distinguish)
  const labelTabKeys = Object.keys(labelGroups).sort().map(l => `#${l}`);
  const allCategories = [...orderedCategories, ...labelTabKeys];

  if (!activeGroup || !allCategories.includes(activeGroup)) {
    activeGroup = allCategories[0];
  }

  const tabs = document.createElement('div');
  tabs.className = 'feed-tabs';

  for (const category of orderedCategories) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'feed-tab' + (category === activeGroup ? ' is-active' : '');
    tab.innerHTML = `
      <span class="feed-tab-label">${category}</span>
      <span class="feed-group-count">${groups[category].length}</span>
    `;
    tab.addEventListener('click', () => {
      activeGroup = category;
      renderFeeds();
    });
    tabs.appendChild(tab);
  }

  // Label tabs
  for (const labelKey of labelTabKeys) {
    const label = labelKey.slice(1); // remove '#'
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'feed-tab feed-tab-label-tag' + (labelKey === activeGroup ? ' is-active' : '');
    tab.innerHTML = `
      <span class="feed-tab-label">🏷 ${escapeHtml(label)}</span>
      <span class="feed-group-count">${labelGroups[label].length}</span>
    `;
    tab.addEventListener('click', () => {
      activeGroup = labelKey;
      renderFeeds();
    });
    tabs.appendChild(tab);
  }

  feedsList.appendChild(tabs);

  const activeFeedsGrid = document.createElement('div');
  activeFeedsGrid.className = 'group-feeds-grid';

  // Resolve which feeds to show for the active tab
  let activeFeedsToRender;
  if (activeGroup && activeGroup.startsWith('#')) {
    activeFeedsToRender = labelGroups[activeGroup.slice(1)] || [];
  } else {
    activeFeedsToRender = groups[activeGroup] || [];
  }

  for (const feed of activeFeedsToRender) {
    const card = buildFeedCard(feed);
    activeFeedsGrid.appendChild(card);
  }

  feedsList.appendChild(activeFeedsGrid);
}

function buildFeedCard(feed) {
    const card = document.createElement('div');
    card.className = 'feed-card';
    card.dataset.username = feed.username;
    const platform = feed.platform || 'instagram';
    card.dataset.platform = platform;

    // Detect stale (>6h), errored feeds, or logged-out platform
    const lastCheckedMs = feed.lastChecked ? new Date(feed.lastChecked).getTime() : 0;
    const isStale = (Date.now() - lastCheckedMs) > 6 * 60 * 60 * 1000;
    const hasError = notifications.some(n => !n.resolved && n.type === 'error' && n.message.includes(`@${feed.username}`));
    const platformLoggedOut = (platform === 'instagram' && !igLoggedIn) ||
                              (platform === 'twitter' && !twLoggedIn) ||
                              (platform === 'facebook' && !fbLoggedIn) ||
                              (platform === 'linkedin' && !liLoggedIn);
    // txt and custom feeds never require login, so only mark stale for actual staleness/errors
    if (isStale || hasError || (platformLoggedOut && platform !== 'txt' && platform !== 'custom')) {
      card.classList.add('feed-stale');
    }

    const customSourceUrl = feed.fullUrl || feed.url || '';
    const customFavicon = getDomainFaviconUrl(customSourceUrl);
    const customFallbackLogo = 'https://cdn-icons-png.flaticon.com/512/1006/1006771.png';
    const platformLogo = platform === 'twitter'
      ? 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
      : platform === 'facebook'
        ? 'https://www.facebook.com/images/fb_icon_325x325.png'
        : platform === 'linkedin'
          ? 'https://upload.wikimedia.org/wikipedia/commons/c/ca/LinkedIn_logo_initials.png'
          : platform === 'txt'
            ? 'https://cdn-icons-png.flaticon.com/512/337/337956.png'
            : platform === 'custom'
              ? (customFavicon || customFallbackLogo)
              : 'https://cdn-icons-png.flaticon.com/512/2111/2111463.png';
    const isGroup = feed.username.startsWith('groups/');
    const isEvent = feed.username.startsWith('events/') || feed.username === 'events';
    const platformLabel = platform === 'twitter' ? 'Twitter' :
                          platform === 'facebook' ? (isGroup ? 'FB Group' : isEvent ? 'FB Event' : 'Facebook') :
                          platform === 'linkedin' ? 'LinkedIn' :
                          platform === 'txt' ? 'Text' :
                          platform === 'custom' ? 'Custom' : 'Instagram';
    const feedKey = feed.feedKey || feed.username.replace(/\//g, '-');
    const tokenSuffix = tokenQueryString('?');
    const publicUrl = `https://${tunnelDomain}/feed/${feedKey}${tokenSuffix}`;
    const timeAgo = formatTimeAgo(feed.lastChecked);

    card.innerHTML = `
      <div class="feed-card-content">
        <div class="feed-card-header">
          <div class="feed-avatar">
            <img src="${platformLogo}" alt="${platformLabel}" data-fallback="${platform === 'custom' ? customFallbackLogo : ''}" style="width:36px;height:36px;border-radius:8px;" onerror="if(this.dataset.fallback && this.src !== this.dataset.fallback){this.src=this.dataset.fallback;return;}this.style.display='none';this.nextElementSibling.style.display=''">
            <span style="display:none">${feed.alias?.charAt(0)?.toUpperCase() || '@'}</span>
          </div>
          <div class="feed-info">
            <div class="feed-name">
              <span class="feed-alias-text">${escapeHtml(feed.alias || feed.username)}</span>
            </div>
            <div class="feed-meta">
              <a class="feed-username-link" href="#" data-url="${escapeHtml(feed.url)}" title="Open in browser">@${escapeHtml(feed.username)}</a>
            </div>
          </div>
        </div>
        <div class="feed-card-body">
          <div class="feed-meta">
            <span>${feed.postCount || 0} posts</span>
            <span>Updated ${timeAgo}</span>
          </div>
          <div class="feed-meta">
            <span style="font-weight:bold">Latest post ${formatTimeAgo(feed.latestPostDate)}</span>
          </div>
          <div class="feed-labels-row">
            ${(feed.labels || []).map(l => `<span class="label-chip">${escapeHtml(l)}</span>`).join('')}
            ${hasActiveFilters(feed.filters) ? '<span class="filter-badge" title="Tiene filtros activos">⚗</span>' : ''}
          </div>
          <div class="feed-urls">
            <a class="feed-url feed-url-public" title="Click to copy public URL">${publicUrl}</a>
          </div>
        </div>
      </div>
      <div class="feed-actions">
        <button class="btn btn-outline btn-icon-action feed-action-btn btn-rename" title="Rename" aria-label="Rename feed">
          <span class="btn-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
            </svg>
          </span>
        </button>
        <button class="btn btn-outline btn-icon-action feed-action-btn btn-labels" title="Etiquetas" aria-label="Editar etiquetas">
          <span class="btn-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
              <line x1="7" y1="7" x2="7.01" y2="7"/>
            </svg>
          </span>
        </button>
        <button class="btn btn-outline btn-icon-action feed-action-btn btn-filters${hasActiveFilters(feed.filters) ? ' btn-filters-active' : ''}" title="Filtros" aria-label="Editar filtros">
          <span class="btn-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
            </svg>
          </span>
        </button>
        <button class="btn btn-outline btn-icon-action feed-action-btn btn-refresh" title="Refresh" aria-label="Refresh feed">
          <span class="btn-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 2v6h-6"/>
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
              <path d="M3 22v-6h6"/>
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
            </svg>
          </span>
          <span class="btn-spinner" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M21 12a9 9 0 1 1-2.64-6.36"/>
            </svg>
          </span>
        </button>
        <button class="btn btn-outline btn-icon-action feed-action-btn btn-remove" title="Remove" aria-label="Remove feed">
          <span class="btn-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </span>
        </button>
      </div>
    `;

    // Open source URL in user's browser on username click
    card.querySelector('.feed-username-link').addEventListener('click', (e) => {
      e.preventDefault();
      window.api.openExternal(feed.url);
    });

    // Copy URL on click
    card.querySelector('.feed-url-public').addEventListener('click', (e) => {
      e.preventDefault();
      copyToClipboard(publicUrl);
      toast('RSS URL copied!', 'success');
    });

    card.querySelector('.btn-rename').addEventListener('click', async () => {
      const aliasEl = card.querySelector('.feed-alias-text');
      const currentAlias = feed.alias || feed.username;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentAlias;
      input.className = 'rename-input';
      input.style.cssText = 'font-size:inherit;padding:2px 6px;border:1px solid var(--accent);border-radius:4px;background:var(--bg-card);color:var(--text);width:200px;';
      aliasEl.replaceWith(input);
      input.focus();
      input.select();

      const doRename = async () => {
        const newAlias = input.value.trim();
        if (newAlias && newAlias !== currentAlias) {
          await window.api.renameFeed(feed.username, platform, newAlias);
          toast('Feed renamed!', 'success');
        }
        await renderFeeds();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doRename();
        if (e.key === 'Escape') renderFeeds();
      });
      input.addEventListener('blur', doRename);
    });

    card.querySelector('.btn-labels').addEventListener('click', () => {
      openLabelsModal(feed);
    });

    card.querySelector('.btn-filters').addEventListener('click', () => {
      openFiltersModal(feed);
    });

    card.querySelector('.btn-refresh').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setBtnLoading(btn, true);
      try {
        await window.api.refreshFeed(feed.username, platform);
        toast(`@${feed.username} refreshed!`, 'success');
        await renderFeeds();
      } catch (err) {
        toast(`Failed to refresh @${feed.username}`, 'error');
      } finally {
        setBtnLoading(btn, false);
        window.focus();
      }
    });

    card.querySelector('.btn-remove').addEventListener('click', async () => {
      if (!confirm(`Remove feed @${feed.username}?`)) return;
      await window.api.removeFeed(feed.username, platform);
      toast(`@${feed.username} removed`, 'success');
      await renderFeeds();
      window.focus();
    });

    return card;
}

function getDomainFaviconUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname;
    if (!host) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
  } catch {
    return null;
  }
}

function createEmptyState() {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.id = 'empty-state';
  div.innerHTML = `
    <div class="empty-icon">📡</div>
    <p>No feeds yet.</p>
    <p class="subtle">Login to a platform, then add a profile URL above — or paste any website URL to create a custom feed.</p>
  `;
  return div;
}

// ── Global Filter ────────────────────────────────────────────────────────

const btnGlobalFilter = $('#btn-global-filter');
const globalFilterBar = $('#global-filter-bar');
const globalFilterInput = $('#global-filter-input');
const btnClearGlobalFilter = $('#btn-clear-global-filter');

btnGlobalFilter.addEventListener('click', () => {
  globalFilterActive = !globalFilterActive;
  globalFilterBar.style.display = globalFilterActive ? 'flex' : 'none';
  btnGlobalFilter.classList.toggle('btn-filter-active', globalFilterActive);
  if (globalFilterActive) {
    globalFilterInput.focus();
  } else {
    globalFilterText = '';
    globalFilterInput.value = '';
    renderFeeds();
  }
});

globalFilterInput.addEventListener('input', () => {
  globalFilterText = globalFilterInput.value.trim().toLowerCase();
  renderFeeds();
});

globalFilterInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    globalFilterActive = false;
    globalFilterText = '';
    globalFilterInput.value = '';
    globalFilterBar.style.display = 'none';
    btnGlobalFilter.classList.remove('btn-filter-active');
    renderFeeds();
  }
});

btnClearGlobalFilter.addEventListener('click', () => {
  globalFilterText = '';
  globalFilterInput.value = '';
  globalFilterInput.focus();
  renderFeeds();
});

// ── Labels & Filters Helpers ────────────────────────────────────────────

function hasActiveFilters(filters) {
  if (!filters) return false;
  return (
    (filters.includeKeywords && filters.includeKeywords.length > 0) ||
    (filters.excludeKeywords && filters.excludeKeywords.length > 0) ||
    filters.mediaOnly === true ||
    (filters.minLikes && filters.minLikes > 0)
  );
}

// ── Labels Modal ─────────────────────────────────────────────────────────

function openLabelsModal(feed) {
  modalTargetFeed = feed;
  pendingLabels = [...(feed.labels || [])];
  renderLabelsChips();
  $('#new-label-input').value = '';
  $('#labels-modal-overlay').style.display = 'flex';
  $('#new-label-input').focus();
}

function closeLabelsModal() {
  $('#labels-modal-overlay').style.display = 'none';
  modalTargetFeed = null;
  pendingLabels = [];
}

function renderLabelsChips() {
  const container = $('#labels-chips-container');
  container.innerHTML = '';
  for (const label of pendingLabels) {
    const chip = document.createElement('span');
    chip.className = 'label-chip label-chip-removable';
    chip.innerHTML = `${escapeHtml(label)} <button class="label-chip-remove" title="Quitar etiqueta" data-label="${escapeHtml(label)}">×</button>`;
    chip.querySelector('.label-chip-remove').addEventListener('click', () => {
      pendingLabels = pendingLabels.filter(l => l !== label);
      renderLabelsChips();
    });
    container.appendChild(chip);
  }
  if (pendingLabels.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'labels-empty-hint';
    empty.textContent = 'Sin etiquetas aún.';
    container.appendChild(empty);
  }
}

$('#btn-add-label-confirm').addEventListener('click', () => {
  const input = $('#new-label-input');
  const val = input.value.trim();
  if (val && !pendingLabels.includes(val)) {
    pendingLabels.push(val);
    renderLabelsChips();
    // Also add to global labels list if not already there
    if (!allLabels.includes(val)) {
      allLabels.push(val);
      window.api.setAllLabels(allLabels);
    }
  }
  input.value = '';
  input.focus();
});

$('#new-label-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-add-label-confirm').click();
  if (e.key === 'Escape') closeLabelsModal();
});

$('#btn-save-labels').addEventListener('click', async () => {
  if (!modalTargetFeed) return;
  await window.api.setFeedLabels(modalTargetFeed.username, modalTargetFeed.platform || 'instagram', pendingLabels);
  toast('Etiquetas guardadas', 'success');
  closeLabelsModal();
  await renderFeeds();
});

$('#btn-cancel-labels').addEventListener('click', closeLabelsModal);
$('#btn-close-labels-modal').addEventListener('click', closeLabelsModal);
$('#labels-modal-overlay').addEventListener('click', (e) => {
  if (e.target === $('#labels-modal-overlay')) closeLabelsModal();
});

// ── Filters Modal ─────────────────────────────────────────────────────────

function openFiltersModal(feed) {
  modalTargetFeed = feed;
  const f = feed.filters || {};
  $('#filter-include-input').value = (f.includeKeywords || []).join(', ');
  $('#filter-exclude-input').value = (f.excludeKeywords || []).join(', ');
  $('#filter-media-only').checked = f.mediaOnly || false;
  $('#filter-min-likes').value = f.minLikes || 0;
  $('#filters-modal-overlay').style.display = 'flex';
  $('#filter-include-input').focus();
}

function closeFiltersModal() {
  $('#filters-modal-overlay').style.display = 'none';
  modalTargetFeed = null;
}

function parseKeywords(str) {
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

$('#btn-save-filters').addEventListener('click', async () => {
  if (!modalTargetFeed) return;
  const filters = {
    includeKeywords: parseKeywords($('#filter-include-input').value),
    excludeKeywords: parseKeywords($('#filter-exclude-input').value),
    mediaOnly: $('#filter-media-only').checked,
    minLikes: parseInt($('#filter-min-likes').value, 10) || 0,
  };
  await window.api.setFeedFilters(modalTargetFeed.username, modalTargetFeed.platform || 'instagram', filters);
  toast('Filtros guardados. Actualizando feed...', 'success');
  closeFiltersModal();
  // Regenerate the feed immediately so filters take effect
  try {
    await window.api.refreshFeed(modalTargetFeed.username, modalTargetFeed.platform || 'instagram');
  } catch (_) { /* non-critical */ }
  await renderFeeds();
});

$('#btn-clear-filters').addEventListener('click', async () => {
  if (!modalTargetFeed) return;
  await window.api.setFeedFilters(modalTargetFeed.username, modalTargetFeed.platform || 'instagram', {
    includeKeywords: [], excludeKeywords: [], mediaOnly: false, minLikes: 0,
  });
  toast('Filtros eliminados', 'success');
  closeFiltersModal();
  await renderFeeds();
});

$('#btn-cancel-filters').addEventListener('click', closeFiltersModal);
$('#btn-close-filters-modal').addEventListener('click', closeFiltersModal);
$('#filters-modal-overlay').addEventListener('click', (e) => {
  if (e.target === $('#filters-modal-overlay')) closeFiltersModal();
});

// ── Refresh All ─────────────────────────────────────────────────────────

async function refreshAll() {
  setBtnLoading(btnRefreshAll, true);
  try {
    const results = await window.api.refreshAll();
    const ok = results.filter((r) => r.success).length;
    const fail = results.filter((r) => !r.success).length;
    toast(`Refreshed ${ok} feed(s)${fail ? `, ${fail} failed` : ''}`, fail ? 'error' : 'success');
    await renderFeeds();
  } catch (err) {
    toast('Failed to refresh feeds', 'error');
  } finally {
    setBtnLoading(btnRefreshAll, false);
  }
}

// ── Export OPML ─────────────────────────────────────────────────────────

async function exportOpml() {
  setBtnLoading(btnCopyOpml, true);
  try {
    const feeds = await window.api.getFeeds();
    if (feeds.length === 0) {
      toast('No feeds to export', 'error');
      return;
    }

    // Group feeds by platform
    const groups = {};
    for (const feed of feeds) {
      const platform = feed.platform || 'instagram';
      const category = platform === 'twitter' ? 'Twitter' :
        platform === 'facebook' ? 'Facebook' :
        platform === 'linkedin' ? 'LinkedIn' :
        platform === 'txt' ? 'Text' :
        platform === 'custom' ? 'Custom' : 'Instagram';
      if (!groups[category]) groups[category] = [];
      groups[category].push(feed);
    }

    const result = await window.api.exportOpml(groups, tunnelDomain);
    if (result.canceled) {
      // User dismissed the dialog — do nothing
    } else if (result.success) {
      toast(`OPML exportado correctamente`, 'success');
      pulseSuccess(btnCopyOpml);
    } else {
      toast(result.error || 'Export failed', 'error');
    }
  } finally {
    setBtnLoading(btnCopyOpml, false);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function setBtnLoading(btn, loading, loadingText) {
  if (!btn) return;
  btn.classList.toggle('is-busy', loading);
  if (loading) {
    btn.disabled = true;
    if (loadingText) {
      const text = btn.querySelector('.btn-text');
      if (text) text.textContent = loadingText;
    }
    const spinner = btn.querySelector('.btn-spinner');
    const text = btn.querySelector('.btn-text');
    if (spinner) spinner.style.display = '';
    if (text) text.style.display = 'none';
  } else {
    btn.disabled = false;
    if (loadingText) {
      const text = btn.querySelector('.btn-text');
      if (text) text.textContent = loadingText;
    }
    const spinner = btn.querySelector('.btn-spinner');
    const text = btn.querySelector('.btn-text');
    if (spinner) spinner.style.display = 'none';
    if (text) text.style.display = '';
  }
}

function pulseSuccess(btn) {
  btn.classList.add('is-success');
  setTimeout(() => btn.classList.remove('is-success'), 700);
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {
    // Fallback
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  });
}

function formatTimeAgo(isoString) {
  if (!isoString) return 'never';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}
