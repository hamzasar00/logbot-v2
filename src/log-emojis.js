const fs = require('node:fs');
const path = require('node:path');
const { PermissionsBitField } = require('discord.js');

const MAX_EMOJI_BYTES = 256 * 1024;
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const CACHE_FILE = path.join(DATA_DIR, 'log-emojis.json');
const ASSET_DIR = path.resolve(__dirname, '..', 'assets', 'log-emojis');

const DEFINITIONS = Object.freeze({
  delete: { name: 'log_delete', file: 'delete.gif', fallback: '🗑️' },
  edit: { name: 'log_edit', file: 'edit.gif', fallback: '✏️' },
  join: { name: 'log_join', file: 'join.gif', fallback: '📥' },
  leave: { name: 'log_leave', file: 'leave.gif', fallback: '📤' },
  ban: { name: 'log_ban', file: 'ban.gif', fallback: '🔨' },
  unban: { name: 'log_unban', file: 'unban.gif', fallback: '🔓' },
  timeout: { name: 'log_timeout', file: 'timeout.gif', fallback: '⏳' },
  role: { name: 'log_role', file: 'role.gif', fallback: '🎭' },
  channel: { name: 'log_channel', file: 'channel.gif', fallback: '📍' },
  voice: { name: 'log_voice', file: 'voice.gif', fallback: '🔊' },
  user: { name: 'log_user', file: 'user.gif', fallback: '👤' },
  clock: { name: 'log_clock', file: 'clock.gif', fallback: '🕒' },
  boost: { name: 'log_user', file: 'user.gif', fallback: '💎' },
});

const warnedPermissionGuilds = new Set();
const warnedCacheWriteGuilds = new Set();
const provisioningNames = new Set();
const createdEmojiIds = new Set();
let cache = loadCache();

function loadCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveCache() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporaryFile = `${CACHE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(cache, null, 2)}\n`);
  fs.renameSync(temporaryFile, CACHE_FILE);
}

function findAnimatedEmoji(guild, definition, cachedId) {
  const cached = cachedId ? guild.emojis.cache.get(cachedId) : null;
  if (cached?.animated && cached.available !== false && cached.name === definition.name) {
    return cached;
  }

  return guild.emojis.cache.find(
    (emoji) => emoji.animated && emoji.available !== false && emoji.name === definition.name
  ) || null;
}

function getLogEmoji(guild, key) {
  const definition = DEFINITIONS[key] || DEFINITIONS.user;
  const cachedId = cache[guild?.id]?.[key];
  const emoji = guild ? findAnimatedEmoji(guild, definition, cachedId) : null;
  return emoji ? `<a:${emoji.name}:${emoji.id}>` : definition.fallback;
}

function hasCreateEmojiPermission(guild) {
  return Boolean(
    guild.members.me?.permissions?.has(PermissionsBitField.Flags.CreateGuildExpressions)
  );
}

function warnMissingPermissionOnce(guild) {
  if (warnedPermissionGuilds.has(guild.id)) return;
  warnedPermissionGuilds.add(guild.id);
  console.warn(
    `[${guild.name}] CreateGuildExpressions izni yok; eksik log emojileri için Unicode kullanılacak.`
  );
}

async function ensureLogEmojis(guild) {
  const report = { found: [], created: [], skipped: [] };
  await guild.emojis.fetch().catch(() => null);
  cache[guild.id] ||= {};

  for (const [key, definition] of Object.entries(DEFINITIONS)) {
    if (key === 'boost') continue;

    const existing = findAnimatedEmoji(guild, definition, cache[guild.id][key]);
    if (existing) {
      cache[guild.id][key] = existing.id;
      report.found.push(existing.name);
      continue;
    }

    const assetPath = path.join(ASSET_DIR, definition.file);
    let fileStats;
    try {
      fileStats = fs.statSync(assetPath);
    } catch {
      report.skipped.push(`${definition.name}: dosya yok`);
      continue;
    }

    if (!fileStats.isFile() || fileStats.size > MAX_EMOJI_BYTES) {
      report.skipped.push(`${definition.name}: GIF 256 KiB sınırını aşıyor`);
      continue;
    }

    if (!hasCreateEmojiPermission(guild)) {
      warnMissingPermissionOnce(guild);
      report.skipped.push(`${definition.name}: izin yok`);
      continue;
    }

    const animatedCount = guild.emojis.cache.filter((emoji) => emoji.animated).size;
    if (animatedCount >= guild.maximumEmojis) {
      report.skipped.push(`${definition.name}: emoji kapasitesi dolu`);
      continue;
    }

    provisioningNames.add(definition.name);
    try {
      const emoji = await guild.emojis.create({
        attachment: assetPath,
        name: definition.name,
        reason: 'Log sistemi hareketli emojisi',
      });
      createdEmojiIds.add(emoji.id);
      cache[guild.id][key] = emoji.id;
      report.created.push(emoji.name);
    } catch (error) {
      report.skipped.push(`${definition.name}: ${error.message}`);
    } finally {
      provisioningNames.delete(definition.name);
    }
  }

  try {
    saveCache();
  } catch (error) {
    if (!warnedCacheWriteGuilds.has(guild.id)) {
      warnedCacheWriteGuilds.add(guild.id);
      console.warn(`[${guild.name}] Log emoji ID önbelleği yazılamadı: ${error.message}`);
    }
  }
  return report;
}

function shouldSuppressEmojiCreate(emoji) {
  if (!emoji || !Object.values(DEFINITIONS).some((definition) => definition.name === emoji.name)) {
    return false;
  }

  if (createdEmojiIds.has(emoji.id)) {
    createdEmojiIds.delete(emoji.id);
    return true;
  }

  return provisioningNames.has(emoji.name);
}

module.exports = {
  ensureLogEmojis,
  getLogEmoji,
  shouldSuppressEmojiCreate,
};