# Anaxios – Moderator

A mobile **Werewolf-style game moderator** built with Expo / React Native. The moderator runs the whole game from one phone: it hands the device around so each player can see their secret role, walks through the night roles one by one, runs the day discussion timer and voting, announces the winner and keeps a rating for every player.

## Features

- **New Game** – pick players, set role counts (auto-suggested), hand the phone around to reveal roles, then start.
- **Players Library** – add, rename, delete players, upload a picture, see each player's rating.
- **Available Roles** – fully customizable roles (name, team, picture, description, night action, rating points, special rules).
- **Night / Day cycle** – the moderator wakes each role one by one, then the night summary shows what happened. Day has a discussion timer and select-then-confirm voting.
- **Default roles** – Villager, Doctor, Seer, Jester, Avenger, Werewolf, Police, Mayor, Hunter, Vampire, Bodyguard, Transporter, Veteran, Executioner, Retributionist, Hexer.
- **Win logic** – Townies or Villains win; the Jester (voted out) and the Executioner (target voted out) share the win.
- **Ratings** – players only ever gain points; saved when the moderator taps "Save ratings…" at the end of a game.
- **Impostor mode** – a separate party game: pick players, pick word categories, choose how many impostors (up to everyone), then pass the phone so each player sees the secret word or "IMPOSTOR".
- **Music and sound effects**, animations, screen kept awake during a game.
- All data (players, roles, ratings) is stored **on the device** (AsyncStorage). Nothing is sent to a server.

---

## 1. Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | LTS (v20 or newer) | https://nodejs.org – check with `node -v` and `npm -v` |
| Git | any | https://git-scm.com (needed to clone) |
| Code editor | any | VS Code recommended |
| Phone | Android or iOS | with the **Expo Go** app installed (Play Store / App Store) |
| Expo account | free | only needed to build an installable app (section 5) |

The phone and the PC must be on the **same Wi-Fi network** to test with Expo Go.

> Android Studio / Xcode are **not** required. Expo Go on a real phone is the easiest way to test.

---

## 2. Get the project

```bash
git clone <your-repository-url>
cd <your-repository-folder>
npm install
```

If you are creating the project from scratch instead (see "Starting from a blank folder" at the bottom), skip to that section.

---

## 3. Run the app (development)

```bash
npx expo start
```

1. A QR code appears in the terminal (scroll up if it was pushed off screen).
2. **Android:** open **Expo Go** and tap *Scan QR code*.
   **iOS:** open the normal **Camera** app, scan the QR code, tap the banner.
3. The app opens and reloads automatically whenever you save `App.js`.

Useful commands while the server is running:

| Key | Action |
|---|---|
| `r` | reload the app |
| `a` | open on an Android emulator (if installed) |
| `shift + m` | more tools |
| `Ctrl + C` | stop the server |

### Troubleshooting

| Problem | Fix |
|---|---|
| Phone can't connect / QR scan times out | `npx expo start --tunnel` (works across networks / strict Wi-Fi) |
| Old version still showing, odd errors | `npx expo start -c` (clears the cache) |
| "Project is incompatible with this version of Expo Go" | The project SDK must match the Expo Go app. Run `npx expo install --fix`, or create a fresh project with the latest SDK (see the bottom section) |
| `npm install` says `ENOENT ... package.json` | You are in the wrong folder. `cd` into the folder that contains `package.json` |
| Windows firewall prompt | Allow Node.js on **private** networks |
| No sound | Check the phone is not on silent mode and the in-app mute button is off |
| Terminal shows no QR code | Use `npx expo start --tunnel`, or type the `exp://...` address into Expo Go manually |

---

## 4. Project structure

```
.
├── App.js                      # the whole app (screens, game logic, roles, sounds)
├── impostorWords.js            # word lists for the Impostor game (edit this to add words / categories)
├── app.json                    # app name, icon, plugins
├── package.json
└── assets/
    ├── icon.png                # app icon (1024x1024)
    ├── adaptive-icon.png       # Android adaptive icon
    ├── anaxios-main-wallpaper.jpg   # main menu wallpaper
    ├── audio/
    │   ├── the_clue_march.m4a  # menu / setup music
    │   ├── night.m4a           # night music
    │   ├── day_strategy.m4a    # day music
    │   ├── proceed.wav         # button: go forward
    │   ├── deny.wav            # button: cancel / back
    │   ├── killed.wav          # someone died at night
    │   ├── victory.wav         # Townies win
    │   └── villain.wav         # Villains win
    └── roles/
        ├── default.png         # used for custom roles without a picture
        ├── villager.png, doctor.png, seer.png, jester.png, avenger.png,
        ├── werewolf.png, police.png, mayor.png, hunter.png, vampire.png,
        ├── bodyguard.png, transporter.png
        └── veteran.png, executioner.png, retributionist.png, hexer.png   # placeholders – replace with final art
```

**Replacing art / sounds:** overwrite the file with a new one using the **same file name** (the code loads them by name). Replace the four placeholder role images the same way.

**Required packages** (installed with `npx expo install`, which picks versions matching your SDK):

```bash
npx expo install @react-native-async-storage/async-storage expo-image-picker expo-keep-awake expo-status-bar expo-audio
```

### `app.json`

Make sure it contains the app name, icon and the image-picker permission text, for example:

```json
{
  "expo": {
    "name": "Anaxios - Moderator",
    "slug": "anaxios-moderator",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "dark",
    "plugins": [
      ["expo-image-picker", { "photosPermission": "Allow Anaxios to access your photos to set player and role pictures." }]
    ],
    "android": {
      "package": "com.yourname.anaxiosmoderator",
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#14162b"
      }
    },
    "ios": {
      "bundleIdentifier": "com.yourname.anaxiosmoderator",
      "supportsTablet": true
    }
  }
}
```

Change `com.yourname...` to your own unique id (it can never be changed after you publish to a store). The `name` is what appears under the app icon on the phone.

---

## 5. Build an installable app

Expo Go is only for testing. To get a real app you can install on any phone, use **EAS Build** (Expo's cloud build service – you do not need Android Studio).

### 5.1 One-time setup

```bash
npm install -g eas-cli
eas login            # create a free account at https://expo.dev first
eas build:configure  # creates eas.json
```

### 5.2 Android APK (easy, for sharing / testing)

Open `eas.json` and make sure it has a profile that outputs an APK:

```json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "production": {
      "android": { "buildType": "app-bundle" }
    }
  }
}
```

Then build:

```bash
eas build -p android --profile preview
```

- The build runs in the cloud and takes roughly 10–20 minutes (free accounts may queue).
- When it finishes you get a **download link / QR code** for the `.apk`.
- On the phone: open the link, download, allow *Install unknown apps* if asked, install.
- Sharing the link lets friends install the same app.

### 5.3 Google Play Store (AAB)

```bash
eas build -p android --profile production
eas submit -p android      # optional, uploads to Play Console
```

Requires a Google Play developer account (one-time fee).

### 5.4 iOS

```bash
eas build -p ios --profile preview     # internal / TestFlight style builds
```

iOS builds need a paid **Apple Developer Program** membership. A Mac is **not** required for EAS builds.

### 5.5 Local Android build (optional, advanced)

Requires Android Studio, the Android SDK and JDK 17:

```bash
npx expo prebuild
npx expo run:android
```

---

## 6. Updating the app

1. Edit `App.js` (and add/replace files in `assets/` if needed).
2. Test with `npx expo start`.
3. Bump `"version"` in `app.json`.
4. Build again (section 5) and reinstall.

Saved players, roles and ratings stay on the phone when you install a newer version on top of the old one. Uninstalling the app deletes them.

---

## 7. How to play (moderator guide)

1. **Players Library** – add everyone who plays (the defaults are Player 1–4).
2. **New Game** – tick the players taking part → **Next**.
3. **Assign roles** – set how many of each role. The total must equal the number of players and there must be **at least one Townie and one Villain**.
4. **Reveal roles** – pass the phone to each player in turn; they tap to see their role and hand it back. Executioners also see their target.
5. **Start the game** – confirm on the final screen.
6. **Night** – the app wakes each role in order (for example Veteran → Police → Transporter → Werewolf → Vampire → Hexer → Hunter → Bodyguard → Doctor → Retributionist → Seer → Avenger). Read the prompt out loud and tap the chosen player. When done, check the **night summary** and tap **Turn to Day**.
7. **Day** – the discussion timer runs. Afterwards tap a player to **select** them, then press **Vote out** to confirm (or **Bring back** to undo a mistake). Long-press a player to see their role description. Roles are hidden unless you tap **Show roles**.
8. The game ends when the Townies or the Villains win. Tap **Save ratings & play again** to store the points.

### Special role rules

| Role | Rule |
|---|---|
| Jester | If voted out, the game continues; he shares the win with whichever team wins. |
| Executioner | Gets a random target. If the target is voted out, the Executioner shares the win. If the target dies at night, he becomes a Villager. |
| Avenger | After dying, on a later night he can kill one player. Once only. |
| Hunter | Shoots every night. Hitting a Vampire is safe; hitting a Townie means the Hunter dies the next day. |
| Veteran | Can go on alert once. Anyone who visits him that night dies. |
| Retributionist | Can revive one dead player. Once only. |
| Hexer | From night 2, can cure a Vampire (becomes a Villager). Twice in total. |

All of these (uses, first night, rating points, and so on) can be changed in **Available Roles**.

### Rating points (defaults)

Jester +40 · Executioner +30 · Werewolf +25 · Townie roles +15 · Vampire +10. Points only go up and are saved when you tap **Save ratings…** on the game-over screen. Each role's points can be edited in **Available Roles**.

---

### Impostor mode (how to play)

1. Main menu → **Impostor** → tick the players (minimum 3).
2. Choose one or more **categories**. The secret word is picked at random from them. Tap **Edit my own words** to type your own list (saved on the device).
3. Choose the **number of impostors** (1 up to everyone). Optional: let impostors see the category hint, or know each other.
4. Pass the phone: each player taps *Show my card*, sees either the secret word or **IMPOSTOR**, then hides it and passes it on.
5. Everyone gives one clue about the word without saying it, then vote. Tap **Reveal the impostors** to see the result, then **Play again** for a new word.

**Where the words are stored:** in `impostorWords.js`, bundled inside the app. No internet or API is needed, it works offline and never changes unexpectedly. To add words, edit that file (add to a category's `words` array, or add a new category object) and rebuild or reload the app. Words typed in-app under *My words* are stored on the phone.

---

## 8. Starting from a blank folder (no repository yet)

```bash
npx create-expo-app@latest anaxios-moderator --template blank
cd anaxios-moderator
npx expo install @react-native-async-storage/async-storage expo-image-picker expo-keep-awake expo-status-bar expo-audio
```

Then:

1. Replace the generated `App.js` with this project's `App.js` and copy `impostorWords.js` next to it.
2. Copy the whole `assets/` folder into the project.
3. Update `app.json` as shown in section 4 (do not copy a `package.json` from elsewhere; the one created by `create-expo-app` already matches your SDK).
4. Run `npx expo start`.

---

## 9. Suggested `.gitignore`

```
node_modules/
.expo/
dist/
web-build/
*.apk
*.aab
.env
```

Commit `App.js`, `app.json`, `package.json`, `package-lock.json`, `eas.json` and the `assets/` folder.

---

## License

Add your preferred license here.
