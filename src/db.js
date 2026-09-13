const fs = require('fs');
const path = require('path');

const dataDirectory = process.env.DATA_DIR?.trim()
  ? path.resolve(process.env.DATA_DIR.trim())
  : path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDirectory, 'bot-data.json');

fs.mkdirSync(dataDirectory, { recursive: true });

const LOG_GROUPS = Object.freeze({
  member: { key: 'member', label: 'Üye Log', channelName: 'uye-log', defaultEnabled: true },
  message: { key: 'message', label: 'Mesaj Log', channelName: 'mesaj-log', defaultEnabled: true },
  role: { key: 'role', label: 'Rol Log', channelName: 'rol-log', defaultEnabled: true },
  channel: { key: 'channel', label: 'Kanal Log', channelName: 'kanal-log', defaultEnabled: true },
  voice: { key: 'voice', label: 'Ses Log', channelName: 'ses-log', defaultEnabled: true },
  moderation: { key: 'moderation', label: 'Moderasyon Log', channelName: 'moderasyon-log', defaultEnabled: true },
  guild: { key: 'guild', label: 'Sunucu Log', channelName: 'sunucu-log', defaultEnabled: true },
});

function createEmptyState() {
  return {
    version: 1,
    guild_log_settings: {},
    guild_log_channels: {},
    guild_setup: {},
    guild_category_ids: {},
    guild_roles: {},
    role_menu_storage: {},
  };
}

function normalizeState(value) {
  const emptyState = createEmptyState();
  const source = value && typeof value === 'object' ? value : {};
  for (const key of Object.keys(emptyState)) {
    if (key === 'version') continue;
    if (!source[key] || typeof source[key] !== 'object' || Array.isArray(source[key])) {
      source[key] = emptyState[key];
    }
  }
  source.version = 1;
  return source;
}

let state = createEmptyState();

function loadState() {
  try {
    if (fs.existsSync(dataFile)) {
      state = normalizeState(JSON.parse(fs.readFileSync(dataFile, 'utf8')));
    }
  } catch (error) {
    console.error('Veritabanı dosyası okunamadı, temiz ayarlarla devam ediliyor:', error.message);
    state = createEmptyState();
  }
}

function saveState() {
  const temporaryFile = `${dataFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(temporaryFile, dataFile);
}

function initDatabase() {
  loadState();
  saveState();
}

function ensureGuildDefaults(guildId) {
  if (!state.guild_log_settings[guildId]) {
    state.guild_log_settings[guildId] = {};
  }

  let changed = false;
  for (const key of Object.keys(LOG_GROUPS)) {
    if (typeof state.guild_log_settings[guildId][key] !== 'boolean') {
      state.guild_log_settings[guildId][key] = Boolean(LOG_GROUPS[key].defaultEnabled);
      changed = true;
    }
  }

  if (changed) saveState();
}

function setLogEnabled(guildId, logKey, enabled) {
  ensureGuildDefaults(guildId);
  state.guild_log_settings[guildId][logKey] = Boolean(enabled);
  saveState();
}

function isLogEnabled(guildId, logKey) {
  ensureGuildDefaults(guildId);
  return state.guild_log_settings[guildId][logKey] !== false;
}

function saveLogChannel(guildId, logKey, channelId) {
  if (!state.guild_log_channels[guildId]) state.guild_log_channels[guildId] = {};
  state.guild_log_channels[guildId][logKey] = channelId;
  saveState();
}

function getLogChannel(guildId, logKey) {
  return state.guild_log_channels[guildId]?.[logKey] || null;
}

function saveMainCategoryId(guildId, categoryId) {
  state.guild_setup[guildId] = {
    ...(state.guild_setup[guildId] || {}),
    main_category_id: categoryId,
    updated_at: new Date().toISOString(),
  };
  saveState();
}

function saveCategoryId(guildId, categoryName, categoryId) {
  if (!state.guild_category_ids[guildId]) state.guild_category_ids[guildId] = {};
  state.guild_category_ids[guildId][categoryName] = categoryId;
  saveState();
}

function getMainCategoryId(guildId) {
  return state.guild_setup[guildId]?.main_category_id || null;
}

function getCategoryId(guildId, categoryName) {
  return state.guild_category_ids[guildId]?.[categoryName] || null;
}

function getLogDefinitions() {
  return { ...LOG_GROUPS };
}

function addRoleToMenu(guildId, roleId, emoji) {
  if (!state.guild_roles[guildId]) state.guild_roles[guildId] = {};
  state.guild_roles[guildId][roleId] = emoji;
  saveState();
}

function removeRoleFromMenu(guildId, roleId) {
  if (!state.guild_roles[guildId]) return;
  delete state.guild_roles[guildId][roleId];
  saveState();
}

function getMenuRoles(guildId) {
  return Object.entries(state.guild_roles[guildId] || {})
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([role_id, emoji]) => ({ role_id, emoji }));
}

function getRoleEmoji(guildId, roleId) {
  return state.guild_roles[guildId]?.[roleId] || null;
}

function saveRoleMenuMessage(guildId, channelId, messageId) {
  state.role_menu_storage[guildId] = { channel_id: channelId, message_id: messageId };
  saveState();
}

function getRoleMenuMessage(guildId) {
  const value = state.role_menu_storage[guildId];
  return value ? { channelId: value.channel_id, messageId: value.message_id } : null;
}

initDatabase();

module.exports = {
  initDatabase,
  ensureGuildDefaults,
  getLogDefinitions,
  setLogEnabled,
  isLogEnabled,
  saveLogChannel,
  getLogChannel,
  saveMainCategoryId,
  saveCategoryId,
  getMainCategoryId,
  getCategoryId,
  LOG_GROUPS,
  addRoleToMenu,
  removeRoleFromMenu,
  getMenuRoles,
  getRoleEmoji,
  saveRoleMenuMessage,
  getRoleMenuMessage,
};
