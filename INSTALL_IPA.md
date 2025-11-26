# Installing AuroraBook IPA on iOS Device

## Prerequisites

1. **Enable Developer Mode on your iPhone:**
   - Go to **Settings** → **Privacy & Security** → **Developer Mode**
   - Toggle **Developer Mode** ON
   - Your device will restart
   - After restart, confirm the Developer Mode prompt

2. **Trust your computer:**
   - Connect your iPhone via USB
   - On your iPhone, tap "Trust This Computer" when prompted
   - Enter your passcode if asked

## Method 1: Command Line (Recommended)

Once Developer Mode is enabled, run:

```bash
cd /Users/micheleyin/Documents/tts-tauri
xcrun devicectl device install app \
  --device 701C3218-1399-58C7-8E8F-0950F1188483 \
  src-tauri/gen/apple/build/arm64/AuroraBook.ipa
```

Or if you only have one device connected:

```bash
cd /Users/micheleyin/Documents/tts-tauri
xcrun devicectl device install app src-tauri/gen/apple/build/arm64/AuroraBook.ipa
```

## Method 2: Using Xcode (Easiest)

1. Open Xcode
2. Go to **Window** → **Devices and Simulators** (or press `Cmd+Shift+2`)
3. Select your iPhone from the left sidebar
4. Click the **+** button under "Installed Apps"
5. Navigate to and select: `src-tauri/gen/apple/build/arm64/AuroraBook.ipa`
6. Click **Open**

## Method 3: Using Finder (macOS Catalina+)

1. Connect your iPhone via USB
2. Open **Finder**
3. Your iPhone should appear in the sidebar under "Locations"
4. Click on your iPhone
5. Go to the **Files** tab
6. Drag and drop `AuroraBook.ipa` into the Finder window
7. The app will install automatically

## Method 4: Using Apple Configurator 2

1. Download **Apple Configurator 2** from the Mac App Store (free)
2. Connect your iPhone via USB
3. Open Apple Configurator 2
4. Select your device
5. Click **Add** → **Apps**
6. Select `AuroraBook.ipa`
7. Click **Add**

## Troubleshooting

### "Developer Mode is disabled" error
- Enable Developer Mode: Settings → Privacy & Security → Developer Mode
- Restart your device after enabling

### "Untrusted Developer" error
- Go to Settings → General → VPN & Device Management
- Tap on your developer certificate
- Tap "Trust [Your Name]"
- Tap "Trust" to confirm

### "Could not install" error
- Make sure your device is unlocked
- Check that you have enough storage space
- Try disconnecting and reconnecting the USB cable
- Restart both your Mac and iPhone

### App won't launch
- Make sure Developer Mode is enabled
- Trust the developer certificate in Settings → General → VPN & Device Management
- The app should appear on your home screen after installation

## Notes

- The IPA file is located at: `src-tauri/gen/apple/build/arm64/AuroraBook.ipa`
- Your device identifier: `701C3218-1399-58C7-8E8F-0950F1188483` (iPhone 15 Pro Max)
- With a Personal Team (free account), apps expire after 7 days and need to be reinstalled
- For longer-term installation, consider using TestFlight or a paid Apple Developer account

