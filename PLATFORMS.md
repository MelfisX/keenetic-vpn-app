# Запуск на любой платформе

## Десктоп (Windows, macOS, Linux)

### Windows 10 / 11
- **Разработка:** `npm start` или `npm run dev`
- **Сборка:** `npm run build:win` → в `dist/` появятся установщик (NSIS) и portable-версия

### macOS (Intel и Apple Silicon)
- **Разработка:** `npm start` или `npm run dev`
- **Сборка:** `npm run build:mac` → в `dist/` появятся .dmg и .zip
- **Универсальный бинарь (Intel + Apple):** `npm run build:mac:universal` (сборка только на macOS)

### Linux
- **Разработка:** `npm start` или `npm run dev`
- **Сборка:** `npm run build:linux` → в `dist/` появится AppImage (запуск без установки)

### Сборка под все десктоп-платформы
- **`npm run build:all`** — создаёт сборки для Windows, macOS и Linux (Linux и Windows — на любой ОС; macOS — только на Mac)

---

## Мобильные и браузер (Android, iOS, любой ПК)

Веб-версия работает в браузере. Можно добавить её на главный экран как приложение (PWA).

1. На компьютере в той же Wi‑Fi сети, что и роутер, запустите:
   ```bash
   npm run web
   ```
2. **На этом ПК:** откройте в браузере **http://localhost:3000**
3. **С телефона/планшета** (в той же Wi‑Fi): откройте **http://IP_ПК:3000**  
   (IP ПК — в настройках сети, например 192.168.1.100)

### Установка как приложение (Android / iOS)
- **Android (Chrome):** Меню → «Установить приложение» / «Добавить на главный экран»
- **iOS (Safari):** Поделиться → «На экран Домой»

Настройки и закреплённые устройства хранятся в браузере (localStorage). Запросы к роутеру идут через этот же сервер (CORS не мешает).

---

## Где хранятся настройки (десктоп)

- **Windows:** `%APPDATA%\keenetic-vpn-manager\`
- **macOS:** `~/Library/Application Support/keenetic-vpn-manager/`
- **Linux:** `~/.config/keenetic-vpn-manager/`

Файлы: `settings.json`, `pinned.json`.
