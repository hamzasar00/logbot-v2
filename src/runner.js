const { spawn } = require('child_process');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const token = process.env.DISCORD_TOKEN?.trim();
if (!token || token === 'your_discord_bot_token_here') {
  console.error('[supervisor] DISCORD_TOKEN bulunamadı. .env dosyasını doldurun.');
  process.exit(78);
}

const childPath = path.join(__dirname, 'index.js');
const MAX_DELAY_MS = 30000;
const STABLE_RUN_MS = 60000;
let child = null;
let restartTimer = null;
let stableTimer = null;
let stopping = false;
let restartCount = 0;

function startBot() {
  if (stopping) return;
  console.log('[supervisor] Discord botu başlatılıyor...');
  child = spawn(process.execPath, [childPath], { stdio: 'inherit', env: process.env, windowsHide: false });
  stableTimer = setTimeout(() => {
    restartCount = 0;
    stableTimer = null;
    console.log('[supervisor] Bot 60 saniyedir stabil; yeniden başlatma sayacı sıfırlandı.');
  }, STABLE_RUN_MS);
  stableTimer.unref();
  child.once('error', (error) => { console.error('[supervisor] Alt süreç başlatılamadı:', error.message); });
  child.once('exit', (code, signal) => {
    if (stableTimer) clearTimeout(stableTimer);
    stableTimer = null;
    child = null;
    if (stopping) return;
    if (code === 78) {
      console.error('[supervisor] Yapılandırma veya token hatası var; yeniden deneme yapılmayacak.');
      process.exit(78);
    }
    const delay = Math.min(MAX_DELAY_MS, 5000 * (2 ** Math.min(restartCount, 6)));
    restartCount += 1;
    console.error('[supervisor] Bot durdu (kod: ' + (code ?? 'yok') + ', sinyal: ' + (signal ?? 'yok') + '). ' + (delay / 1000) + ' saniye sonra yeniden başlatılacak.');
    restartTimer = setTimeout(startBot, delay);
  });
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  if (stableTimer) clearTimeout(stableTimer);
  if (!child) { process.exit(0); return; }
  child.kill(signal);
  const forceExit = setTimeout(() => { if (child) child.kill('SIGKILL'); }, 10000);
  forceExit.unref();
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
startBot();
