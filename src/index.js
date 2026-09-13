const { Client, GatewayIntentBits, ChannelType, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Colors, REST, Routes, ChannelSelectMenuBuilder, StringSelectMenuBuilder, AuditLogEvent, PermissionsBitField } = require('discord.js');
const { entersState, getVoiceConnection, joinVoiceChannel, VoiceConnectionStatus } = require('@discordjs/voice');
const { config } = require('dotenv');
config();
const { PlainLogBuilder, formatPlainLog, NO_MENTIONS } = require('./plain-log');
const { ensureLogEmojis, shouldSuppressEmojiCreate } = require('./log-emojis');

const discordToken = process.env.DISCORD_TOKEN?.trim();
if (!discordToken || discordToken === 'your_discord_bot_token_here') {
  console.error('DISCORD_TOKEN bulunamadı. Proje klasöründeki .env dosyasını doldurun.');
  process.exit(1);
}

const {
  getLogDefinitions,
  ensureGuildDefaults,
  setLogEnabled,
  isLogEnabled,
  saveLogChannel,
  getLogChannel,
  saveMainCategoryId,
  saveCategoryId,
  getMainCategoryId,
  getCategoryId,
  LOG_GROUPS,
  saveBoostSetting,
  getBoostSetting,
} = require('./db');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildEmojisAndStickers,
  ],
});

const PREFIX = process.env.BOT_PREFIX?.trim() || '.';
const LOG_DEFINITIONS = getLogDefinitions();
const rest = new REST({ version: '10' }).setToken(discordToken);
const inviteSnapshots = new Map();
const inviteTotals = new Map();
const inFlightGuildTasks = new Map();
let lastReadyAt = 0;

function runGuildTaskOnce(taskKey, task) {
  const activeTask = inFlightGuildTasks.get(taskKey);
  if (activeTask) {
    return activeTask;
  }

  const currentTask = Promise.resolve().then(task);
  inFlightGuildTasks.set(taskKey, currentTask);
  currentTask.then(
    () => { if (inFlightGuildTasks.get(taskKey) === currentTask) inFlightGuildTasks.delete(taskKey); },
    () => { if (inFlightGuildTasks.get(taskKey) === currentTask) inFlightGuildTasks.delete(taskKey); }
  );
  return currentTask;
}

function getGuildInviteTotals(guildId) {
  if (!inviteTotals.has(guildId)) {
    inviteTotals.set(guildId, new Map());
  }

  return inviteTotals.get(guildId);
}

async function updateGuildInviteSnapshot(guild) {
  if (!guild) {
    return;
  }

  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) {
    return;
  }

  const snapshot = new Map();
  for (const invite of invites.values()) {
    snapshot.set(invite.code, {
      uses: invite.uses ?? 0,
      inviterId: invite.inviterId ?? null,
    });
  }

  inviteSnapshots.set(guild.id, snapshot);
}

async function getInviteJoinInfo(member) {
  try {
    const guild = member.guild;
    const currentInvites = await guild.invites.fetch().catch(() => null);
    const previousSnapshot = inviteSnapshots.get(guild.id) ?? new Map();

    if (!currentInvites) {
      return { inviter: 'Bilinmeyen', totalInvites: 0 };
    }

    let matchedInvite = null;

    for (const invite of currentInvites.values()) {
      const previous = previousSnapshot.get(invite.code);
      const previousUses = previous?.uses ?? 0;
      const currentUses = invite.uses ?? 0;

      if (currentUses > previousUses) {
        matchedInvite = invite;
        break;
      }
    }

    if (!matchedInvite) {
      return { inviter: 'Bilinmeyen', totalInvites: 0 };
    }

    const inviterId = matchedInvite.inviterId ?? null;
    const totals = getGuildInviteTotals(guild.id);
    const total = inviterId ? (totals.get(inviterId) ?? 0) + 1 : 0;

    if (inviterId) {
      totals.set(inviterId, total);
    }

    await updateGuildInviteSnapshot(guild);

    return {
      inviter: inviterId ? `<@${inviterId}>` : 'Bilinmeyen',
      totalInvites: total,
    };
  } catch (error) {
    return { inviter: 'Bilinmeyen', totalInvites: 0 };
  }
}

async function deleteOldDiscordCommands() {
  const clientId = process.env.CLIENT_ID || client.user?.id;
  if (!clientId) {
    console.log('CLIENT_ID bulunamadığı için eski slash komutları silinemedi.');
    return;
  }

  try {
    if (process.env.GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(clientId, process.env.GUILD_ID), { body: [] });
      console.log('Sunucu bazlı eski slash komutları silindi.');
    }

    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    console.log('Global eski slash komutları silindi.');
  } catch (error) {
    console.error('Eski slash komutları silinemedi:', error.message);
  }
}

function formatChannelValue(guild, channelId) {
  if (!channelId) {
    return 'Atanmamış';
  }

  const channel = guild.channels.cache.get(channelId) ?? null;
  return channel ? `<#${channel.id}>` : `Kanala erişilemedi (${channelId})`;
}

function buildLogPanel(guildId) {
  const guild = client.guilds.cache.get(guildId);
  const embed = new EmbedBuilder()
    .setTitle('📋 Log Kontrol Paneli')
    .setDescription('Her log türü bağımsızdır. Açık/kapalı ve kanal seçimi ayrı ayrı çalışır.')
    .setColor(Colors.Blurple);

  for (const definition of Object.values(LOG_DEFINITIONS)) {
    const enabled = isLogEnabled(guildId, definition.key);
    const assignedChannel = getLogChannel(guildId, definition.key);
    embed.addFields({
      name: `${enabled ? '🟢' : '⚪'} ${definition.label}`,
      value: `Durum: ${enabled ? 'AÇIK' : 'KAPALI'}\nKanal: ${formatChannelValue(guild, assignedChannel)}`,
      inline: false,
    });
  }

  return embed;
}

function createToggleButtons(guildId) {
  const rows = [];
  const logKeys = Object.keys(LOG_DEFINITIONS);

  for (let index = 0; index < logKeys.length; index += 5) {
    const chunk = logKeys.slice(index, index + 5);
    const row = new ActionRowBuilder();

    for (const logKey of chunk) {
      const definition = LOG_DEFINITIONS[logKey];
      const enabled = isLogEnabled(guildId, definition.key);
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`toggle:${definition.key}`)
          .setLabel(`${enabled ? '🟢' : '⚪'} ${definition.label}`)
          .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      );
    }

    rows.push(row);
  }

  return rows;
}

function createChannelSelectionMenus() {
  const rows = [];
  const logKeys = Object.keys(LOG_DEFINITIONS);

  for (const logKey of logKeys) {
    const definition = LOG_DEFINITIONS[logKey];
    const row = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`channel-select:${definition.key}`)
        .setPlaceholder(`${definition.label} kanalını seç`)
        .setMinValues(0)
        .setMaxValues(1)
    );
    rows.push(row);
  }

  return rows;
}

function truncateText(value, maxLength = 1000) {
  if (!value) return 'Belirtilmedi';
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

async function sendLog(guildId, logGroupKey, logEntry) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild || !isLogEnabled(guildId, logGroupKey)) {
    return;
  }

  const channelId = getLogChannel(guildId, logGroupKey);
  if (!channelId) {
    return;
  }

  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel || !channel.isTextBased()) {
    return;
  }

  const formattedLog = formatPlainLog(logEntry, guild, logGroupKey);
  await channel.send({
    content: formattedLog,
    allowedMentions: NO_MENTIONS,
  });
}

async function getAuditLogInfo(guild, targetId, eventTypes) {
  if (!guild || !targetId || !eventTypes) {
    return { executor: 'Bilinmeyen', reason: 'Sebep belirtilmedi' };
  }

  const typeList = Array.isArray(eventTypes) ? eventTypes : [eventTypes];

  for (const eventType of typeList) {
    try {
      const auditLogs = await guild.fetchAuditLogs({ type: eventType, limit: 10 });
      const entry = auditLogs.entries.find((item) => item.target && item.target.id === targetId);

      if (entry) {
        return {
          executor: entry.executor ? `<@${entry.executor.id}>` : 'Bilinmeyen',
          reason: entry.reason || 'Sebep belirtilmedi',
        };
      }
    } catch (error) {
      continue;
    }
  }

  return { executor: 'Bilinmeyen', reason: 'Sebep belirtilmedi' };
}

function buildBoostNotificationEmbed(member) {
  const title = getBoostSetting(member.guild.id, 'title') || 'Thank You Buddy';
  const message = getBoostSetting(member.guild.id, 'message') || 'Welcome To Real CLR LEAK\nLEAK Buddy';
  const gifUrl = getBoostSetting(member.guild.id, 'gif_url');
  const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 128 });

  const embed = new PlainLogBuilder()
    .setColor(Colors.Red)
    .setAuthor({ name: member.user.username, iconURL: avatarUrl })
    .setTitle(title)
    .setDescription('<@' + member.user.id + '> ' + message)
    .setThumbnail(avatarUrl)
    .setTimestamp();

  if (gifUrl) {
    embed.setImage(gifUrl);
  }

  return embed;
}

function hasManageBoostPermission(message) {
  return message.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild) ||
    message.member?.permissions?.has(PermissionsBitField.Flags.ManageChannels);
}

function isVoiceChannel(channel) {
  return [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel?.type);
}

function createVoiceChannelPicker(userId) {
  return new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(`voice-join:${userId}`)
      .setPlaceholder('Ses veya Stage kanalı seç')
      .setChannelTypes([ChannelType.GuildVoice, ChannelType.GuildStageVoice])
      .setMinValues(1)
      .setMaxValues(1)
  );
}

async function connectToVoiceChannel(guild, channel, reply) {
  if (!isVoiceChannel(channel)) {
    await reply('❌ Seçilen kanal bir ses veya Stage kanalı değil.');
    return;
  }

  const botPermissions = channel.permissionsFor(guild.members.me);
  if (!botPermissions?.has(PermissionsBitField.Flags.ViewChannel) ||
      !botPermissions?.has(PermissionsBitField.Flags.Connect)) {
    await reply('❌ Botun bu kanalda **Kanalı Görüntüle** ve **Bağlan** izinlerine ihtiyacı var. Kanal ayarlarından bot rolüne de izin ver.');
    return;
  }

  const existingConnection = getVoiceConnection(guild.id);
  existingConnection?.destroy();

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: true,
  });
  connection.on('error', (error) => {
    console.error(`[${guild.name}] Ses bağlantısı hatası:`, error.message);
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    await reply(`✅ ${channel} ses kanalına bağlandım.`);
  } catch (error) {
    connection.destroy();
    console.error(
      `[${guild.name}] Ses kanalına bağlanma hatası (${connection.state.status}):`,
      error.message
    );
    await reply('❌ Ses kanalına bağlanamadım. Bot rolünde ve kanalın özel izinlerinde **Kanalı Görüntüle + Bağlan** açık olduğundan emin ol.');
  }
}

async function handleVoiceJoinCommand(message, args) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }

  if (!message.member?.permissions?.has(PermissionsBitField.Flags.ManageChannels)) {
    await message.reply('❌ Bu komut için Kanalları Yönet izni gerekir.');
    return;
  }

  const mentionedChannel = message.mentions.channels.first();
  const requestedChannelId = mentionedChannel?.id || args[0]?.match(/^\d+$/)?.[0] || args[0];
  const channel = requestedChannelId
    ? message.guild.channels.cache.get(requestedChannelId) ||
      await message.guild.channels.fetch(requestedChannelId).catch(() => null)
    : mentionedChannel;

  if (!isVoiceChannel(channel)) {
    await message.reply({
      content: 'Ses kanalını aşağıdaki menüden seç veya kanal ID’si kullan: `.ses-gir 123456789012345678`',
      components: [createVoiceChannelPicker(message.author.id)],
    });
    return;
  }

  await connectToVoiceChannel(message.guild, channel, (content) => message.reply(content));
}

async function handleBoostChannelCommand(message) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }

  if (!hasManageBoostPermission(message)) {
    await message.reply('❌ Bu ayar için Sunucuyu Yönet veya Kanalları Yönet izni gerekir.');
    return;
  }

  const channel = message.mentions.channels.first();
  if (!channel || !channel.isTextBased()) {
    await message.reply('Kullanım: .boost-kanal #kanal');
    return;
  }

  saveLogChannel(message.guild.id, 'boost', channel.id);
  await message.reply('✅ Boost bildirim kanalı ' + channel + ' olarak ayarlandı.');
}

async function handleBoostGifCommand(message, args) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }

  if (!hasManageBoostPermission(message)) {
    await message.reply('❌ Bu ayar için Sunucuyu Yönet veya Kanalları Yönet izni gerekir.');
    return;
  }

  const firstArg = args[0]?.toLocaleLowerCase('tr-TR');
  if (firstArg === 'kaldır' || firstArg === 'kaldir') {
    saveBoostSetting(message.guild.id, 'gif_url', null);
    await message.reply('✅ Boost GIF bağlantısı kaldırıldı.');
    return;
  }

  const gifUrl = args[0] || message.attachments.first()?.url;
  if (!gifUrl) {
    await message.reply('Kullanım: .boost-gif https://... veya GIF dosyasını mesaja ekle.');
    return;
  }

  try {
    const parsedUrl = new URL(gifUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('invalid protocol');
  } catch {
    await message.reply('❌ Geçerli bir HTTP/HTTPS GIF bağlantısı veya dosyası kullan.');
    return;
  }

  saveBoostSetting(message.guild.id, 'gif_url', gifUrl);
  await message.reply('✅ Boost GIF bağlantısı kaydedildi.');
}

async function handleBoostTestCommand(message) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }

  if (!hasManageBoostPermission(message)) {
    await message.reply('❌ Bu test için Sunucuyu Yönet veya Kanalları Yönet izni gerekir.');
    return;
  }

  const channelId = getLogChannel(message.guild.id, 'boost');
  if (!channelId) {
    await message.reply('❌ Önce .boost-kanal #kanal ile boost kanalını ayarla.');
    return;
  }

  const channel = message.guild.channels.cache.get(channelId) ||
    await message.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    await message.reply('❌ Kayıtlı boost kanalı bulunamadı. .boost-kanal #kanal ile tekrar ayarla.');
    return;
  }

  try {
    const formattedLog = formatPlainLog(buildBoostNotificationEmbed(message.member), message.guild, 'boost');
    await channel.send({
      content: formattedLog,
      allowedMentions: NO_MENTIONS,
    });
    await message.reply('✅ Test boost bildirimi ' + channel + ' kanalına gönderildi.');
  } catch (error) {
    console.error('Boost test gönderme hatası:', error);
    await message.reply('❌ Test bildirimi gönderilemedi. Botun kanalda Mesaj Gönder ve Embed Links izinlerini kontrol et.');
  }
}

async function handleBoostTitleCommand(message, args) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }
  if (!hasManageBoostPermission(message)) {
    await message.reply('❌ Bu ayar için Sunucuyu Yönet veya Kanalları Yönet izni gerekir.');
    return;
  }

  const title = args.join(' ').trim();
  if (!title) {
    await message.reply('Kullanım: .boost-baslik Thank You Buddy');
    return;
  }

  saveBoostSetting(message.guild.id, 'title', title.slice(0, 256));
  await message.reply('✅ Boost başlığı kaydedildi.');
}

async function handleBoostMessageCommand(message, args) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }
  if (!hasManageBoostPermission(message)) {
    await message.reply('❌ Bu ayar için Sunucuyu Yönet veya Kanalları Yönet izni gerekir.');
    return;
  }

  const text = args.join(' ').trim();
  if (!text) {
    await message.reply('Kullanım: .boost-mesaj Welcome To Real CLR LEAK | LEAK Buddy');
    return;
  }

  saveBoostSetting(message.guild.id, 'message', text.replace(/\s*\|\s*/g, '\n').slice(0, 4096));
  await message.reply('✅ Boost mesajı kaydedildi.');
}

async function ensureSetupInternal(guild) {
  if (!guild) {
    return;
  }

  ensureGuildDefaults(guild.id);

  const mainCategoryName = 'LOGLAR';
  let mainCategory = null;
  const savedMainCategoryId = getMainCategoryId(guild.id);
  const savedMainCategory = savedMainCategoryId ? guild.channels.cache.get(savedMainCategoryId) : null;

  if (savedMainCategory?.type === ChannelType.GuildCategory) {
    mainCategory = savedMainCategory;
  }

  if (!mainCategory) {
    mainCategory = guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildCategory && channel.name === mainCategoryName
    );
  }

  if (!mainCategory) {
    mainCategory = await guild.channels.create({
      name: mainCategoryName,
      type: ChannelType.GuildCategory,
      reason: 'Ana log kategorisi oluşturuluyor.',
    });
  }

  saveMainCategoryId(guild.id, mainCategory.id);

  for (const group of Object.values(LOG_GROUPS)) {
    let channel = null;
    const savedChannelId = getLogChannel(guild.id, group.key);
    const savedChannel = savedChannelId ? guild.channels.cache.get(savedChannelId) : null;

    if (savedChannel?.type === ChannelType.GuildText) {
      channel = savedChannel;
    }

    if (!channel) {
      channel = guild.channels.cache.find(
        (item) => item.parentId === mainCategory.id && item.name === group.channelName && item.type === ChannelType.GuildText
      );
    }

    if (!channel) {
      channel = await guild.channels.create({
        name: group.channelName,
        type: ChannelType.GuildText,
        parent: mainCategory.id,
        reason: `${group.label} kanalı oluşturuluyor.`,
      });
    }

    saveLogChannel(guild.id, group.key, channel.id);
  }

  const emojiReport = await ensureLogEmojis(guild);
  console.log(
    `[${guild.name}] Log emojileri: ${emojiReport.found.length} bulundu, ` +
    `${emojiReport.created.length} yüklendi, ${emojiReport.skipped.length} atlandı.`
  );
}

async function ensureSetup(guild) {
  if (!guild) return;
  return runGuildTaskOnce(`setup:${guild.id}`, () => ensureSetupInternal(guild));
}

async function handleSetupCommand(message) {
  if (!message.guild) { await message.reply('Bu komut bir sunucuda kullanılmalıdır.'); return; }
  await ensureSetup(message.guild);
  const embed = new EmbedBuilder().setTitle('✅ Log Sistemi Ayarlandı').setDescription('LOGLAR kategorisi ve log kanalları hazırlandı. Boost bildirimleri için .boost-kanal #kanal komutunu kullanabilirsin.').setColor(Colors.Green).addFields({ name: '📁 Hazırlanan kanallar', value: 'uye-log, mesaj-log, rol-log, kanal-log, ses-log, moderasyon-log, sunucu-log ve boost-log', inline: false });
  await message.reply({ embeds: [embed] });
}

async function handleLogCommand(message) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }

  const embed = buildLogPanel(message.guild.id);
  const rows = [
    ...createToggleButtons(message.guild.id),
    ...createChannelSelectionMenus(),
  ];

  await message.reply({ embeds: [embed], components: rows });
}

function buildHelpEmbed() {
  return new EmbedBuilder().setTitle('🆘 Log Botu Yardım').setDescription('Bu bot sunucudaki olayları ayrı log kanallarına kaydeder ve boost bildirimleri gönderir.').setColor(Colors.Blurple).addFields(
    { name: '.setup', value: 'Log kategorisini ve tüm log kanallarını oluşturur.', inline: false },
    { name: '.log', value: 'Log türlerini açıp kapatabileceğin ve kanal seçebileceğin paneli açar.', inline: false },
    { name: '.boost-kanal #kanal', value: 'Boost bildirimlerinin gönderileceği kanalı ayarlar.', inline: false },
    { name: '.boost-gif bağlantı', value: 'Boost GIF bağlantısını ayarlar; kaldırmak için .boost-gif kaldır yaz.', inline: false },
    { name: '.boost-baslik metin', value: 'Boost bildirim başlığını ayarlar.', inline: false },
    { name: '.boost-mesaj metin', value: 'Boost bildirim mesajını ayarlar. | işareti yeni satır oluşturur.', inline: false },
    { name: '.boost-test', value: 'Mevcut ayarlarla test boost bildirimi gönderir.', inline: false },
    { name: '.ses-gir #kanal', value: 'Botu seçilen ses veya Stage kanalına bağlar.', inline: false },
    { name: '.yardım', value: 'Bu yardım mesajını gösterir.', inline: false },
  );
}

async function handleHelpCommand(message) {
  await message.reply({ embeds: [buildHelpEmbed()] });
}

client.on(Events.ClientReady, async () => {
  lastReadyAt = Date.now();
  client.user.setPresence({ status: 'dnd', activities: [{ name: 'Logları izliyor', type: 3 }] });
  console.log('Bot aktif: ' + client.user.tag + ' | Sunucu sayısı: ' + client.guilds.cache.size);
  for (const guild of client.guilds.cache.values()) { try { await updateGuildInviteSnapshot(guild); } catch (error) { console.error('[' + guild.name + '] başlangıç ayarı tamamlanamadı:', error.message); } }
  console.log('Discord bağlantısı hazır. Prefix komutları kullanılabilir.');
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;
  const content = message.content.slice(PREFIX.length).trim();
  const [command, ...args] = content.split(/\s+/);
  if (command === 'setup') return handleSetupCommand(message);
  if (command === 'log') return handleLogCommand(message);
  if (command === 'boost-kanal') return handleBoostChannelCommand(message);
  if (command === 'boost-gif') return handleBoostGifCommand(message, args);
  if (command === 'boost-test') return handleBoostTestCommand(message);
  if (command === 'boost-baslik') return handleBoostTitleCommand(message, args);
  if (command === 'boost-mesaj') return handleBoostMessageCommand(message, args);
  if (command === 'ses-gir') return handleVoiceJoinCommand(message, args);
  if (command === 'help' || command === 'yardım' || command === 'yardim') return handleHelpCommand(message);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('voice-join:')) {
    const ownerId = interaction.customId.replace('voice-join:', '');
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: '❌ Bu ses kanalı menüsü başka bir kullanıcıya ait.', ephemeral: true });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels)) {
      await interaction.reply({ content: '❌ Bu komut için Kanalları Yönet izni gerekir.', ephemeral: true });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({ content: 'Bu seçim bir sunucuda kullanılmalıdır.', ephemeral: true });
      return;
    }

    const channel = interaction.guild.channels.cache.get(interaction.values[0]) ||
      await interaction.guild.channels.fetch(interaction.values[0]).catch(() => null);
    await connectToVoiceChannel(
      interaction.guild,
      channel,
      (content) => interaction.reply({ content, ephemeral: true })
    );
    return;
  }

  if (interaction.isButton()) {
    if (!interaction.customId.startsWith('toggle:')) return;
    const guild = interaction.guild, logKey = interaction.customId.replace('toggle:', '');
    if (!guild || !LOG_DEFINITIONS[logKey]) return;
    try { setLogEnabled(guild.id, logKey, !isLogEnabled(guild.id, logKey)); await interaction.update({ embeds: [buildLogPanel(guild.id)], components: [...createToggleButtons(guild.id), ...createChannelSelectionMenus()] }); }
    catch (error) { if (error?.code !== 10062 && error?.status !== 404) console.error('Log paneli güncellenemedi:', error); }
    return;
  }
  if (!interaction.isChannelSelectMenu() || !interaction.customId.startsWith('channel-select:')) return;
  const guild = interaction.guild, logKey = interaction.customId.replace('channel-select:', '');
  if (!guild || !LOG_DEFINITIONS[logKey]) return;
  saveLogChannel(guild.id, logKey, interaction.channels.first()?.id ?? null);
  try { await interaction.update({ embeds: [buildLogPanel(guild.id)], components: [...createToggleButtons(guild.id), ...createChannelSelectionMenus()] }); }
  catch (error) { if (error?.code !== 10062 && error?.status !== 404) console.error('Log kanalı güncellenemedi:', error); }
});

client.on(Events.GuildMemberAdd, async (member) => {
  const inviteInfo = await getInviteJoinInfo(member);
  const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
  const embed = new PlainLogBuilder()
    .setColor(Colors.Green)
    .setAuthor({ name: 'Üye Katıldı', iconURL: avatarUrl })
    .setDescription('**' + member.user.tag + '** sunucuya katıldı.')
    .setThumbnail(avatarUrl)
    .addFields(
      { name: 'Kullanıcı', value: '<@' + member.user.id + '>', inline: true },
      { name: 'Davet Eden', value: inviteInfo.inviter, inline: true },
      { name: 'Toplam Davet', value: String(inviteInfo.totalInvites), inline: true },
      { name: 'Kullanıcı ID', value: '`' + member.user.id + '`', inline: false },
    )
    .setFooter({ text: 'Üye Logu' })
    .setTimestamp();
  await sendLog(member.guild.id, 'member', embed);
});

client.on(Events.GuildMemberRemove, async (member) => {
  const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
  const embed = new PlainLogBuilder()
    .setColor(Colors.Red)
    .setAuthor({ name: 'Üye Ayrıldı', iconURL: avatarUrl })
    .setDescription('**' + member.user.tag + '** sunucudan ayrıldı.')
    .setThumbnail(avatarUrl)
    .addFields(
      { name: 'Kullanıcı', value: '<@' + member.user.id + '>', inline: true },
      { name: 'Kullanıcı ID', value: '`' + member.user.id + '`', inline: true },
    )
    .setFooter({ text: 'Üye Logu' })
    .setTimestamp();
  await sendLog(member.guild.id, 'member', embed);
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const startedBoosting = !oldMember.premiumSinceTimestamp && Boolean(newMember.premiumSinceTimestamp);
  if (startedBoosting) await sendLog(newMember.guild.id, 'boost', buildBoostNotificationEmbed(newMember));
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const oldDisplay = oldMember.displayName;
  const newDisplay = newMember.displayName;

  if (oldDisplay !== newDisplay) {
    const embed = new PlainLogBuilder()
      .setTitle('✏️ Üye Bilgisi Değişti')
      .setColor(Colors.Orange)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${newMember.user.id}>`, inline: true },
        { name: '🆔 Kullanıcı ID', value: `\`${newMember.user.id}\``, inline: true },
        { name: '📜 Eski Ad', value: oldDisplay || 'Belirtilmedi', inline: true },
        { name: '📜 Yeni Ad', value: newDisplay || 'Belirtilmedi', inline: true },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(newMember.guild.id, 'member', embed);
  }

  const timeoutChanged = oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp;
  if (timeoutChanged && newMember.communicationDisabledUntilTimestamp) {
    const { executor, reason } = await getAuditLogInfo(newMember.guild, newMember.user.id, AuditLogEvent.MemberUpdate);
    const embed = new PlainLogBuilder()
      .setTitle('⏱️ Kullanıcı Timeout Alındı')
      .setColor(Colors.Yellow)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${newMember.user.id}>`, inline: true },
        { name: '🆔 Kullanıcı ID', value: `\`${newMember.user.id}\``, inline: true },
        { name: '🛡️ Yetkili', value: executor, inline: true },
        { name: '📝 Sebep', value: reason, inline: false },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(newMember.guild.id, 'moderation', embed);
  }

  if (!oldMember.roles.cache.equals(newMember.roles.cache)) {
    const added = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id)).map((role) => role.name);
    const removed = oldMember.roles.cache.filter((role) => !newMember.roles.cache.has(role.id)).map((role) => role.name);

    const embed = new PlainLogBuilder()
      .setTitle('🎭 Rol Verme/Alma')
      .setColor(Colors.Blurple)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${newMember.user.id}>`, inline: true },
        { name: '🆔 Kullanıcı ID', value: `\`${newMember.user.id}\``, inline: true },
        { name: '➕ Eklenen Roller', value: added.length ? added.join(', ') : 'Yok', inline: false },
        { name: '➖ Alınan Roller', value: removed.length ? removed.join(', ') : 'Yok', inline: false },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(newMember.guild.id, 'role', embed);
  }
});

client.on(Events.MessageDelete, async (message) => {
  if (message.author?.bot) {
    return;
  }

  const attachment = message.attachments.first();
  const directMediaUrl = typeof message.content === 'string'
    ? message.content.match(/https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp|avif|mp4|mov|mp3|wav|ogg)(?:\?[^\s]*)?/i)?.[0]
    : null;
  const embedPreviewUrl = attachment?.url || directMediaUrl || message.embeds?.[0]?.image?.url || message.embeds?.[0]?.thumbnail?.url;
  const shouldHideContent = Boolean(attachment || embedPreviewUrl || directMediaUrl || message.embeds?.length);
  const visibleMessage = shouldHideContent ? 'Medya dosyası silindi' : `\`${truncateText(message.content)}\``;

  const embed = new PlainLogBuilder()
    .setTitle('🗑️ Mesaj Silindi')
    .setColor(Colors.Red)
    .addFields(
      { name: '👤 Kullanıcı', value: message.author ? `<@${message.author.id}>` : 'Bilinmeyen', inline: true },
      { name: '📍 Kanal', value: message.channel ? `<#${message.channel.id}>` : 'Bilinmeyen', inline: true },
      { name: '💬 Mesaj', value: visibleMessage, inline: false },
      { name: '🆔 Mesaj ID', value: `\`${message.id}\``, inline: true },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: true }
    );

  if (embedPreviewUrl) {
    embed.setImage(embedPreviewUrl);
  }

  await sendLog(message.guild.id, 'message', embed);
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (oldMessage.author?.bot || newMessage.author?.bot) {
    return;
  }

  if (oldMessage.content === newMessage.content) {
    return;
  }

  const embed = new PlainLogBuilder()
    .setTitle('✏️ Mesaj Düzenlendi')
    .setColor(Colors.Orange)
    .addFields(
      { name: '👤 Kullanıcı', value: `<@${newMessage.author.id}>`, inline: true },
      { name: '📍 Kanal', value: `<#${newMessage.channel.id}>`, inline: true },
      { name: '📝 Eski Mesaj', value: `\`${truncateText(oldMessage.content)}\``, inline: false },
      { name: '📝 Yeni Mesaj', value: `\`${truncateText(newMessage.content)}\``, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(newMessage.guild.id, 'message', embed);
});

client.on(Events.MessageBulkDelete, async (messages) => {
  const collection = messages.filter((message) => !message.author?.bot);
  const count = collection.size;
  if (count === 0) {
    return;
  }

  const firstMessage = collection.first();
  const embed = new PlainLogBuilder()
    .setTitle('🧹 Toplu Mesaj Silindi')
    .setColor(Colors.Red)
    .addFields(
      { name: '📍 Kanal', value: firstMessage ? `<#${firstMessage.channel.id}>` : 'Bilinmeyen', inline: true },
      { name: '🧮 Toplam', value: `${count}`, inline: true },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(firstMessage.guild.id, 'message', embed);
});

client.on(Events.GuildBanAdd, async (ban) => {
  const { executor, reason } = await getAuditLogInfo(ban.guild, ban.user.id, AuditLogEvent.MemberBanAdd);

  const embed = new PlainLogBuilder()
    .setTitle('🔨 Kullanıcı Yasaklandı')
    .setColor(Colors.Red)
    .addFields(
      { name: '👤 Kullanıcı', value: `<@${ban.user.id}>`, inline: true },
      { name: '🆔 Kullanıcı ID', value: `\`${ban.user.id}\``, inline: true },
      { name: '🛡️ Yasaklayan', value: executor, inline: true },
      { name: '📝 Sebep', value: reason || (ban.reason ? `${ban.reason}` : 'Sebep belirtilmedi'), inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(ban.guild.id, 'moderation', embed);
});

client.on(Events.GuildBanRemove, async (ban) => {
  const { executor, reason } = await getAuditLogInfo(ban.guild, ban.user.id, AuditLogEvent.MemberBanRemove);

  const embed = new PlainLogBuilder()
    .setTitle('🔓 Kullanıcının Yasağı Kaldırıldı')
    .setColor(Colors.Green)
    .addFields(
      { name: '👤 Kullanıcı', value: `<@${ban.user.id}>`, inline: true },
      { name: '🆔 Kullanıcı ID', value: `\`${ban.user.id}\``, inline: true },
      { name: '🛡️ Kaldıran', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(ban.guild.id, 'moderation', embed);
});

client.on(Events.GuildAuditLogEntryCreate, async (auditLogEntry) => {
  if (!auditLogEntry.guild || !auditLogEntry.target) {
    return;
  }

  const targetUser = auditLogEntry.target;
  const executor = auditLogEntry.executor ? `<@${auditLogEntry.executor.id}>` : 'Bilinmeyen';
  const reason = auditLogEntry.reason || 'Sebep belirtilmedi';

  if (auditLogEntry.action === AuditLogEvent.MemberKick) {
    const embed = new PlainLogBuilder()
      .setTitle('👢 Kullanıcı Atıldı')
      .setColor(Colors.Orange)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${targetUser.id}>`, inline: true },
        { name: '🛡️ Yetkili', value: executor, inline: true },
        { name: '📝 Sebep', value: reason, inline: false },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(auditLogEntry.guild.id, 'moderation', embed);
    return;
  }

  if (auditLogEntry.action === AuditLogEvent.MemberBanAdd) {
    const embed = new PlainLogBuilder()
      .setTitle('🔨 Kullanıcı Yasaklandı')
      .setColor(Colors.Red)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${targetUser.id}>`, inline: true },
        { name: '🛡️ Yetkili', value: executor, inline: true },
        { name: '📝 Sebep', value: reason, inline: false },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(auditLogEntry.guild.id, 'moderation', embed);
    return;
  }

  if (auditLogEntry.action === AuditLogEvent.MemberBanRemove) {
    const embed = new PlainLogBuilder()
      .setTitle('🔓 Kullanıcının Yasağı Kaldırıldı')
      .setColor(Colors.Green)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${targetUser.id}>`, inline: true },
        { name: '🛡️ Yetkili', value: executor, inline: true },
        { name: '📝 Sebep', value: reason, inline: false },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(auditLogEntry.guild.id, 'moderation', embed);
    return;
  }

  if (auditLogEntry.action === AuditLogEvent.MemberUpdate) {
    const hasTimeoutChange = auditLogEntry.changes?.some((change) => change.key === 'communication_disabled_until');

    if (!hasTimeoutChange) {
      return;
    }

    const embed = new PlainLogBuilder()
      .setTitle('⏱️ Kullanıcı Timeout Alındı')
      .setColor(Colors.Yellow)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${targetUser.id}>`, inline: true },
        { name: '🛡️ Yetkili', value: executor, inline: true },
        { name: '📝 Sebep', value: reason, inline: false },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(auditLogEntry.guild.id, 'moderation', embed);
  }
});

client.on(Events.RoleCreate, async (role) => {
  const { executor, reason } = await getAuditLogInfo(role.guild, role.id, AuditLogEvent.RoleCreate);

  const embed = new PlainLogBuilder()
    .setTitle('🟢 Rol Oluşturuldu')
    .setColor(Colors.Green)
    .addFields(
      { name: '🎭 Rol', value: `${role}`, inline: true },
      { name: '🆔 Rol ID', value: `\`${role.id}\``, inline: true },
      { name: '🛡️ Oluşturan', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(role.guild.id, 'role', embed);
});

client.on(Events.RoleDelete, async (role) => {
  const { executor, reason } = await getAuditLogInfo(role.guild, role.id, AuditLogEvent.RoleDelete);

  const embed = new PlainLogBuilder()
    .setTitle('🔴 Rol Silindi')
    .setColor(Colors.Red)
    .addFields(
      { name: '🎭 Rol', value: role.name || 'Bilinmeyen', inline: true },
      { name: '🆔 Rol ID', value: `\`${role.id}\``, inline: true },
      { name: '🛡️ Silen', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(role.guild.id, 'role', embed);
});

client.on(Events.RoleUpdate, async (oldRole, newRole) => {
  const { executor, reason } = await getAuditLogInfo(newRole.guild, newRole.id, AuditLogEvent.RoleUpdate);

  const embed = new PlainLogBuilder()
    .setTitle('✏️ Rol Değiştirildi')
    .setColor(Colors.Orange)
    .addFields(
      { name: '🎭 Rol', value: `${newRole}`, inline: true },
      { name: '🆔 Rol ID', value: `\`${newRole.id}\``, inline: true },
      { name: '🛡️ Değiştiren', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(newRole.guild.id, 'role', embed);
});

client.on(Events.ChannelCreate, async (channel) => {
  if (!channel.guild) {
    return;
  }

  const { executor, reason } = await getAuditLogInfo(channel.guild, channel.id, AuditLogEvent.ChannelCreate);

  const embed = new PlainLogBuilder()
    .setTitle('🟢 Kanal Oluşturuldu')
    .setColor(Colors.Green)
    .addFields(
      { name: '📍 Kanal', value: `<#${channel.id}>`, inline: true },
      { name: '🆔 Kanal ID', value: `\`${channel.id}\``, inline: true },
      { name: '🛡️ Oluşturan', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(channel.guild.id, 'channel', embed);
});

client.on(Events.ChannelDelete, async (channel) => {
  if (!channel.guild) {
    return;
  }

  const { executor, reason } = await getAuditLogInfo(channel.guild, channel.id, AuditLogEvent.ChannelDelete);

  const embed = new PlainLogBuilder()
    .setTitle('🔴 Kanal Silindi')
    .setColor(Colors.Red)
    .addFields(
      { name: '📍 Kanal', value: channel.name || 'Bilinmeyen', inline: true },
      { name: '🆔 Kanal ID', value: `\`${channel.id}\``, inline: true },
      { name: '🛡️ Silen', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(channel.guild.id, 'channel', embed);
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (oldChannel.name === newChannel.name && oldChannel.type === newChannel.type) {
    return;
  }

  const { executor, reason } = await getAuditLogInfo(newChannel.guild, newChannel.id, AuditLogEvent.ChannelUpdate);

  const embed = new PlainLogBuilder()
    .setTitle('✏️ Kanal Değiştirildi')
    .setColor(Colors.Orange)
    .addFields(
      { name: '📍 Kanal', value: `<#${newChannel.id}>`, inline: true },
      { name: '🆔 Kanal ID', value: `\`${newChannel.id}\``, inline: true },
      { name: '🛡️ Değiştiren', value: executor, inline: true },
      { name: '📜 Eski Ad', value: oldChannel.name || 'Bilinmeyen', inline: true },
      { name: '📜 Yeni Ad', value: newChannel.name || 'Bilinmeyen', inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(newChannel.guild.id, 'channel', embed);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (!newState.guild) {
    return;
  }

  if (!oldState.channelId && newState.channelId) {
    const embed = new PlainLogBuilder()
      .setTitle('🔊 Ses Kanalına Girdi')
      .setColor(Colors.Green)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${newState.member?.user?.id ?? '0'}>`, inline: true },
        { name: '📍 Kanal', value: `<#${newState.channelId}>`, inline: true },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(newState.guild.id, 'voice', embed);
    return;
  }

  if (oldState.channelId && !newState.channelId) {
    const embed = new PlainLogBuilder()
      .setTitle('🔇 Ses Kanalından Ayrıldı')
      .setColor(Colors.Red)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${oldState.member?.user?.id ?? '0'}>`, inline: true },
        { name: '📍 Kanal', value: `<#${oldState.channelId}>`, inline: true },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(oldState.guild.id, 'voice', embed);
    return;
  }

  if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    const embed = new PlainLogBuilder()
      .setTitle('🔄 Ses Kanalı Değişti')
      .setColor(Colors.Orange)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${newState.member?.user?.id ?? '0'}>`, inline: true },
        { name: '🕘 Eski Kanal', value: `<#${oldState.channelId}>`, inline: true },
        { name: '🕘 Yeni Kanal', value: `<#${newState.channelId}>`, inline: true },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(newState.guild.id, 'voice', embed);
  }
});

client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
  if (oldGuild.name === newGuild.name) {
    return;
  }

  const { executor, reason } = await getAuditLogInfo(newGuild, newGuild.id, AuditLogEvent.GuildUpdate);

  const embed = new PlainLogBuilder()
    .setTitle('⚙️ Sunucu Değiştirildi')
    .setColor(Colors.Blurple)
    .addFields(
      { name: '🧾 Eski İsim', value: oldGuild.name || 'Bilinmeyen', inline: true },
      { name: '🧾 Yeni İsim', value: newGuild.name || 'Bilinmeyen', inline: true },
      { name: '🛡️ Değiştiren', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(newGuild.id, 'guild', embed);
});

client.on(Events.GuildEmojiCreate, async (emoji) => {
  if (shouldSuppressEmojiCreate(emoji)) {
    return;
  }

  const { executor, reason } = await getAuditLogInfo(emoji.guild, emoji.id, AuditLogEvent.EmojiCreate);

  const embed = new PlainLogBuilder()
    .setTitle('😀 Emoji Oluşturuldu')
    .setColor(Colors.Green)
    .addFields(
      { name: '🧩 Emoji', value: `${emoji}`, inline: true },
      { name: '🆔 Emoji ID', value: `\`${emoji.id}\``, inline: true },
      { name: '🛡️ Oluşturan', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(emoji.guild.id, 'guild', embed);
});

client.on(Events.GuildEmojiDelete, async (emoji) => {
  const { executor, reason } = await getAuditLogInfo(emoji.guild, emoji.id, AuditLogEvent.EmojiDelete);

  const embed = new PlainLogBuilder()
    .setTitle('😀 Emoji Silindi')
    .setColor(Colors.Red)
    .addFields(
      { name: '🧩 Emoji', value: `${emoji.name || 'Bilinmeyen'}`, inline: true },
      { name: '🆔 Emoji ID', value: `\`${emoji.id}\``, inline: true },
      { name: '🛡️ Silen', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(emoji.guild.id, 'guild', embed);
});

client.on(Events.GuildStickerCreate, async (sticker) => {
  const { executor, reason } = await getAuditLogInfo(sticker.guild, sticker.id, AuditLogEvent.StickerCreate);

  const embed = new PlainLogBuilder()
    .setTitle('🖼️ Sticker Oluşturuldu')
    .setColor(Colors.Green)
    .addFields(
      { name: '🧩 Sticker', value: sticker.name || 'Bilinmeyen', inline: true },
      { name: '🆔 Sticker ID', value: `\`${sticker.id}\``, inline: true },
      { name: '🛡️ Oluşturan', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(sticker.guild.id, 'guild', embed);
});

client.on(Events.GuildStickerDelete, async (sticker) => {
  const { executor, reason } = await getAuditLogInfo(sticker.guild, sticker.id, AuditLogEvent.StickerDelete);

  const embed = new PlainLogBuilder()
    .setTitle('🖼️ Sticker Silindi')
    .setColor(Colors.Red)
    .addFields(
      { name: '🧩 Sticker', value: sticker.name || 'Bilinmeyen', inline: true },
      { name: '🆔 Sticker ID', value: `\`${sticker.id}\``, inline: true },
      { name: '🛡️ Silen', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(sticker.guild.id, 'guild', embed);
});

client.on('error', (error) => {
  console.error('Discord istemci hatası:', error.message);
});

client.on('warn', (message) => {
  console.warn('Discord uyarısı:', message);
});

client.on('shardDisconnect', (closeEvent, shardId) => {
  console.error(`Discord bağlantısı koptu (shard ${shardId}). Kod: ${closeEvent?.code ?? 'bilinmiyor'}`);
});

client.on('shardReconnecting', (shardId) => {
  console.warn(`Discord bağlantısı yeniden kuruluyor (shard ${shardId})...`);
});

client.on('invalidated', () => {
  console.error('Discord oturumu geçersiz hale geldi; supervisor yeniden başlatacak.');
  void shutdown('invalidated');
});

let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n${signal} alındı, Discord bağlantısı güvenli biçimde kapatılıyor...`);
  try {
    client.destroy();
  } finally {
    const exitCode = ['uncaughtException', 'invalidated', 'connection-watchdog'].includes(signal) ? 1 : 0;
    process.exit(exitCode);
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('Yakalanmamış Promise hatası:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('Yakalanmamış uygulama hatası:', error);
  void shutdown('uncaughtException');
});

const connectionWatchdog = setInterval(() => {
  const disconnectedTooLong = lastReadyAt > 0 && !client.isReady() && Date.now() - lastReadyAt > 120000;
  if (disconnectedTooLong) {
    console.error('Discord bağlantısı 120 saniyeden uzun süredir hazır değil; supervisor yeniden başlatacak.');
    void shutdown('connection-watchdog');
  }
}, 60000);
connectionWatchdog.unref?.();

client.login(discordToken).catch((error) => {
  console.error('Bot giriş başarısız:', error.message);
  const isCredentialError = /invalid token|token.*invalid|4004/i.test(error.message || '');
  process.exit(isCredentialError ? 78 : 1);
});
