# Logbot v2

Türkçe Discord sunucuları için geliştirilmiş log, rol menüsü ve özel ses odası botu.

## Özellikler

- `.setup` ile log kategorileri ve kanalları otomatik kurulur.
- Üye, mesaj, rol, kanal, ses, moderasyon ve sunucu logları ayrı ayrı açılıp kapatılabilir.
- `.log` ile butonlu log kontrol paneli açılır.
- Mesaj düzenleme/silme, üye giriş/çıkış, rol ve kanal değişiklikleri, ses hareketleri, ban/kick ve sunucu olayları Türkçe embed olarak kaydedilir.
- Davet kullanan kişi takibi, rol seçim menüsü ve özel ses odası yönetimi içerir.
- JSON ayarları geçici dosya + yeniden adlandırma yöntemiyle atomik kaydedilir; yarım yazma riski azaltılır.
- Prefix `BOT_PREFIX`, veri klasörü `DATA_DIR` ile değiştirilebilir.
- SIGINT/SIGTERM ve beklenmeyen Node.js hatalarında güvenli kapanış uygulanır.

## Gereksinimler

- Node.js 22 LTS veya 24 LTS
- Discord bot tokenı
- Discord Developer Portal'da gerekli Gateway Intent izinleri

## Kurulum

```bash
npm install
cp .env.example .env
npm start
```

Windows'ta `kurulum.bat` ve ardından `baslat.bat` kullanılabilir.

## Ortam değişkenleri

| Değişken | Açıklama | Varsayılan |
|---|---|---|
| `DISCORD_TOKEN` | Discord bot tokenı | Zorunlu |
| `CLIENT_ID` | Discord uygulama ID'si | Önerilir |
| `GUILD_ID` | Test sunucusu ID'si | İsteğe bağlı |
| `BOT_PREFIX` | Komut prefix'i | `.` |
| `DATA_DIR` | JSON veri klasörü | `./data` |

Tokenı repoya commit etmeyin. Gerçek değerleri yalnızca yerel `.env` dosyasında veya deployment secret alanında tutun.

## Komutlar

- `.setup` — Log kategorilerini ve kanallarını kurar.
- `.log` — Log kontrol panelini açar.
- `.oda` — Özel ses odası panelini kurar.

## Kontrol

```bash
npm run check
```

## Lisans

MIT
