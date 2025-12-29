# Publishing AuroraBook to Mac App Store

## Prerequisites

1. **Apple Developer Account** (enrolled, $99/year)
2. **Development Team ID**: `YOUR_TEAM_ID`
3. **Bundle ID**: `com.micheleyin.aurorabook`
4. **macOS with Xcode** installed and updated

## Step 1: Register App ID in Apple Developer Portal

1. Go to https://developer.apple.com/account
2. Navigate to **Certificates, Identifiers & Profiles**
3. Click **Identifiers** → **+** (Add)
4. Select **App IDs** → **Continue**
5. Select **App** → **Continue**
6. Fill in:
   - **Description**: AuroraBook
   - **Bundle ID**: `com.micheleyin.aurorabook` (Explicit)
7. Enable **App Sandbox** capability (required for Mac App Store)
8. Click **Continue** → **Register**

## Step 2: Create App in App Store Connect

1. Go to https://appstoreconnect.apple.com
2. Click **My Apps** → **+** → **New App**
3. Fill in:
   - **Platform**: macOS
   - **Name**: AuroraBook
   - **Primary Language**: English (or your choice)
   - **Bundle ID**: Select `com.micheleyin.aurorabook`
   - **SKU**: `aurorabook-macos-001` (unique identifier)
4. Click **Create**

## Step 3: Configure App Sandbox and Entitlements

The entitlements file has been created at:
`src-tauri/gen/apple/aurorabook_macOS/aurorabook_macOS.entitlements`

This includes:
- **App Sandbox** (required for Mac App Store)
- **User-selected file access** (read/write)
- **Network client** (for any network requests)
- **Downloads folder access**
- **Bookmarks** (for persistent file access)

Adjust entitlements based on your app's needs.

## Step 4: Build the App for Mac App Store

**Note**: Tauri doesn't generate an Xcode project for macOS (only for iOS). You must use the Tauri CLI to build macOS apps.

### Option A: Using the Automated Script (Easiest)

A script is provided that handles building, signing, and packaging automatically:

```bash
cd src-tauri
./build_appstore.sh
```

This script will:
1. Build the app using Tauri CLI
2. Check for required certificates
3. Sign the app with entitlements
4. Create the installer package (.pkg)
5. Verify all signatures

### Option B: Manual Build Process

If you prefer to do it step by step:

```bash
# Build for release (Apple Silicon)
cd src-tauri
bun tauri build --target aarch64-apple-darwin

# Or for universal binary (both Intel and Apple Silicon)
bun tauri build --target universal-apple-darwin

# Or for Intel Macs
bun tauri build --target x86_64-apple-darwin
```

The built app will be in: `src-tauri/target/release/bundle/macos/AuroraBook.app`

## Step 5: Sign the App for Mac App Store

Before creating the installer package, you need to sign the app with a **"3rd Party Mac Developer Application"** certificate.

### Get the Required Certificates

**IMPORTANT**: You need macOS-specific certificates. "Apple Distribution" is for iOS/iPadOS/tvOS, NOT for macOS App Store!

You need two certificates for Mac App Store distribution:

1. **Mac App Distribution** (for signing the app)
   - Go to https://developer.apple.com/account/resources/certificates/list
   - Click **+** (plus button) to create a new certificate
   - Under **Software**, select **Mac App Distribution**
   - Click **Continue**
   - Follow the instructions to create a Certificate Signing Request (CSR) if needed:
     - Open **Keychain Access** app
     - Go to **Keychain Access** → **Certificate Assistant** → **Request a Certificate From a Certificate Authority**
     - Enter your email and name
     - Select **Save to disk**
     - Upload the `.certSigningRequest` file
   - Click **Continue** → **Download**
   - Double-click the downloaded `.cer` file to install it in Keychain

2. **Mac Installer Distribution** (for signing the package - optional if not creating .pkg)
   - Same page, click **+** → Select **Mac Installer Distribution**
   - Follow the same CSR process if needed
   - Download and install the certificate

**Verify certificates are installed:**
```bash
# Check for Mac App Store certificates
security find-identity -v -p codesigning | grep "3rd Party Mac Developer"

# You should see:
# "3rd Party Mac Developer Application: Your Name (YOUR_TEAM_ID)"
# "3rd Party Mac Developer Installer: Your Name (YOUR_TEAM_ID)"
```

### Sign the App

```bash
# Navigate to the bundle directory
cd src-tauri/target/release/bundle/macos

# Find your app signing certificate
security find-identity -v -p codesigning | grep "3rd Party Mac Developer Application"

# Sign the app with entitlements (replace with your actual certificate name)
# First, navigate to the bundle directory
cd src-tauri/target/release/bundle/macos

# Use absolute path to entitlements (from project root)
# Replace /Users/micheleyin/Documents/tts-tauri with your actual project path
ENTITLEMENTS_PATH="/Users/micheleyin/Documents/tts-tauri/src-tauri/gen/apple/aurorabook_macOS/aurorabook_macOS.entitlements"

# Or use this if you're in the project root:
# ENTITLEMENTS_PATH="$(pwd)/src-tauri/gen/apple/aurorabook_macOS/aurorabook_macOS.entitlements"

codesign --force --deep --sign "3rd Party Mac Developer Application: Your Name (YOUR_TEAM_ID)" \
  --entitlements "$ENTITLEMENTS_PATH" \
  AuroraBook.app

# Note: If you see "Apple Distribution" in your certificates, that's for iOS.
# For macOS App Store, you need "3rd Party Mac Developer Application"

# Verify the signature
codesign --verify --verbose AuroraBook.app
```

## Step 6: Create Installer Package (.pkg) - OPTIONAL

**You don't need a .pkg for App Store Connect!** You can upload the `.app` bundle directly.

The `.pkg` is only needed if you want to distribute outside the App Store. For App Store Connect, skip to Step 8.

**If you do want to create a .pkg (for direct distribution):**
```bash
# Make sure you're in the bundle directory
cd src-tauri/target/release/bundle/macos

# Find your installer certificate name
security find-identity -v -p codesigning | grep "3rd Party Mac Developer Installer"

# Create a .pkg file (replace with your actual certificate name from above)
# IMPORTANT: You MUST use "3rd Party Mac Developer Installer" (not Application)
productbuild \
  --component AuroraBook.app /Applications \
  --sign "3rd Party Mac Developer Installer: Your Name (YOUR_TEAM_ID)" \
  AuroraBook.pkg

# If you don't have the installer certificate yet, create it at:
# https://developer.apple.com/account/resources/certificates/list
# Select "Mac Installer Distribution" when creating

# Verify the package signature
pkgutil --check-signature AuroraBook.pkg
```

**Important Notes**: 
- For Mac App Store, you **must** use **"3rd Party Mac Developer Installer"**
- For distribution outside App Store, use **"Developer ID Installer"** (different certificate)
- The `--sign` parameter needs the full certificate name, not just the Team ID
- Make sure the app is signed before creating the package

## Step 7: Notarize Your App (Optional)

**For App Store Connect**: Notarization is handled automatically during upload, so you can skip this step.

**For direct distribution** (outside App Store): You need to notarize manually.

### Option A: Notarize Before Upload (Only for direct distribution)

```bash
# Notarize the app bundle (for direct distribution)
xcrun notarytool submit AuroraBook.app \
  --apple-id "your-apple-id@example.com" \
  --team-id "YOUR_TEAM_ID" \
  --password "app-specific-password" \
  --wait

# Or notarize a package
xcrun notarytool submit AuroraBook.pkg \
  --apple-id "your-apple-id@example.com" \
  --team-id "YOUR_TEAM_ID" \
  --password "app-specific-password" \
  --wait

# Check notarization status
xcrun notarytool history \
  --apple-id "your-apple-id@example.com" \
  --team-id "YOUR_TEAM_ID" \
  --password "app-specific-password"
```

**Note**: You'll need to create an App-Specific Password:
1. Go to https://appleid.apple.com
2. Sign in → **App-Specific Passwords**
3. Generate a new password for "App Store Connect API"

### Option B: Let Upload Handle Notarization (Recommended for App Store)

The upload process will automatically notarize your app, so you can skip manual notarization.

## Step 8: Upload to App Store Connect

Since you can't use Xcode for macOS, you'll use command-line tools to upload.

**You can upload the `.app` bundle directly - no .pkg needed!**

### Using altool (Deprecated but still works)

```bash
# Make sure you're in the bundle directory
cd src-tauri/target/release/bundle/macos

# Upload the app bundle directly
xcrun altool --upload-app \
  --type macos \
  --file AuroraBook.app \
  --apiKey "YOUR_API_KEY" \
  --apiIssuer "YOUR_ISSUER_ID"
```

### Using App Store Connect API (Recommended)

First, create an API key:
1. Go to https://appstoreconnect.apple.com/access/api
2. Click **Keys** → **+** (Generate API Key)
3. Download the `.p8` key file
4. Note the **Key ID** and **Issuer ID**

Then upload:

```bash
# Upload the app bundle using the API key
cd src-tauri/target/release/bundle/macos

xcrun altool --upload-app \
  --type macos \
  --file AuroraBook.app \
  --apiKey "YOUR_API_KEY" \
  --apiIssuer "YOUR_ISSUER_ID"
```

**Alternative**: You can also use `xcrun altool` with your Apple ID:

```bash
cd src-tauri/target/release/bundle/macos

xcrun altool --upload-app \
  --type macos \
  --file AuroraBook.app \
  --username "your-apple-id@example.com" \
  --password "app-specific-password"
```

**Note**: You can also upload through the App Store Connect web interface:
1. Go to https://appstoreconnect.apple.com
2. Select your app → **App Store** tab → **macOS App**
3. Click **+ Version** or **+ Build**
4. Upload the `.app` bundle directly

## Step 8: Configure App Store Listing

In App Store Connect:

1. **App Information**:
   - App Name: AuroraBook
   - Subtitle (optional)
   - Category: Books or Productivity
   - Privacy Policy URL (required)

2. **Pricing and Availability**:
   - Set price or make it free
   - Select availability countries

3. **Version Information**:
   - Version: `0.1.0`
   - What's New: Describe your app features
   - Screenshots: Upload required screenshots
     - **Required sizes**:
       - 1280 x 800 pixels (for 13" MacBook Pro)
       - 1440 x 900 pixels (for 15" MacBook Pro)
       - 2560 x 1600 pixels (for Retina displays)
       - 2880 x 1800 pixels (for Retina 15")
     - At least one screenshot is required
   - App Preview (optional video)
   - Description: Detailed app description (up to 4000 characters)
   - Keywords: Relevant search keywords (up to 100 characters)
   - Support URL: Your support website
   - Marketing URL (optional)

4. **App Privacy**:
   - Complete privacy questionnaire
   - Declare data collection practices

5. **App Review Information**:
   - Contact information
   - Demo account (if needed)
   - Notes for reviewer

## Step 9: Submit for Review

1. In App Store Connect, go to your app
2. Click **+ Version or Platform** if needed
3. Fill in all required information (marked with *)
4. Upload screenshots and metadata
5. Click **Add for Review**
6. Answer export compliance questions
7. Click **Submit for Review**

## Step 10: Monitor Review Status

- Check status in App Store Connect
- Respond to any review feedback
- App typically reviewed within 24-48 hours for macOS apps

## Troubleshooting

### Code Signing Issues

**Problem: "3rd Party Mac Developer Application" certificate not found**

If `security find-identity -v -p codesigning` doesn't show the required certificate:

1. **Check what you have:**
   ```bash
   security find-identity -v -p codesigning
   ```
   - If you see "Apple Distribution" → This is for iOS, NOT macOS!
   - You need "3rd Party Mac Developer Application" for macOS App Store

2. **Create the certificate:**
   - Go to https://developer.apple.com/account/resources/certificates/list
   - Click **+** → Select **Mac App Distribution** (NOT "Apple Distribution")
   - If prompted, create a Certificate Signing Request (CSR):
     - Open **Keychain Access**
     - **Keychain Access** → **Certificate Assistant** → **Request a Certificate From a Certificate Authority**
     - Enter your email and name
     - Select **Save to disk**
     - Upload the `.certSigningRequest` file
   - Download the `.cer` file and double-click to install

3. **Verify installation:**
   ```bash
   security find-identity -v -p codesigning | grep "3rd Party Mac Developer"
   ```

**Other code signing issues:**

1. In Xcode: **Preferences** → **Accounts**
2. Add your Apple ID
3. Download certificates automatically
4. Ensure provisioning profiles are valid
5. Make sure certificates are in **System** keychain, not just **login** keychain:
   ```bash
   # Move certificate to System keychain (requires admin password)
   security import /path/to/certificate.cer -k /Library/Keychains/System.keychain
   ```

### App Sandbox Issues

- Ensure `com.apple.security.app-sandbox` is enabled in entitlements
- Check that all required entitlements are present
- Test your app with sandbox enabled before submitting

### Notarization Errors

- Ensure you're using the correct signing identity
- Check that all binaries are properly signed
- Verify entitlements are correct

### Build Errors

- Ensure all dependencies are compatible with macOS
- Check that minimum macOS version (10.13) is supported
- Verify all resources are included in the bundle
- Ensure Rust toolchain supports your target architecture

### Upload Errors

**Error: "Certificate Revoked"**
- If you see this error, your certificate has been revoked by Apple
- Go to https://developer.apple.com/account/resources/certificates/list
- Revoke the old certificate (if it still appears)
- Create a new "Mac App Distribution" or "Mac Installer Distribution" certificate
- Download and install the new certificate
- Rebuild and re-sign your app

**Error: "LSApplicationCategoryType key missing"**
- Add `LSApplicationCategoryType` to your `Info.plist` file
- Valid categories: `public.app-category.books`, `public.app-category.productivity`, etc.
- See: https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/LaunchServicesKeys.html#//apple_ref/doc/uid/TP40009250-SW8

**Error: "Invalid bundle. The app supports arm64 but not Intel-based Mac computers"**
- If building arm64-only, set `minimumSystemVersion` to `12.0` or higher in `tauri.conf.json`
- Or build a universal binary: `bun tauri build --target universal-apple-darwin`

**Other upload errors:**
- Ensure you're using the correct bundle ID
- Check that version number is incremented
- Verify app is properly signed and notarized
- For `altool`, you need a `.pkg` file, not a `.app` bundle

## Current Configuration

- **Bundle ID**: `com.micheleyin.aurorabook`
- **Development Team**: `YOUR_TEAM_ID`
- **Minimum macOS**: 12.0 (required for arm64-only builds)
- **App Sandbox**: Enabled
- **Hardened Runtime**: Enabled
- **App Store**: Enabled
- **App Category**: Books (`LSApplicationCategoryType`: `public.app-category.books`)

## Additional Resources

- [Tauri macOS Distribution Guide](https://v2.tauri.app/distribute/app-store/)
- [Apple Mac App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [App Store Connect Help](https://help.apple.com/app-store-connect/)
- [App Sandbox Documentation](https://developer.apple.com/documentation/security/app_sandbox)
