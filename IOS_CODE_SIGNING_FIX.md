# iOS Code Signing Fix

## Current Issue
The build is failing because:
1. **No Account for Team "YOUR_OLD_TEAM_ID"** - The development team is not added to Xcode
2. **No provisioning profiles** - No profiles exist for bundle ID `com.bigemperor26.tauri`

## Solution Steps

### Option 1: Add Account in Xcode (Recommended)
1. Open Xcode
2. Go to **Xcode → Settings** (or **Preferences** on older versions)
3. Click on **Accounts** tab
4. Click the **+** button to add an account
5. Sign in with your Apple ID that has access to team "YOUR_OLD_TEAM_ID"
6. Select the team from the dropdown

### Option 2: Use Automatic Signing
1. Open the Xcode project: `bun run ios:xcode`
2. Select the **aurorabook_iOS** target
3. Go to **Signing & Capabilities** tab
4. Check **"Automatically manage signing"**
5. Select your team from the dropdown
6. Xcode will automatically create a provisioning profile

### Option 3: Build for Simulator (No Code Signing Required)
If you just want to test the build process without code signing:
```bash
bun run build:ios:sim
```
This builds for the iOS Simulator and doesn't require code signing.

### Option 4: Use Personal Team (Free Account)
If you don't have a paid Apple Developer account:
1. Use your personal Apple ID
2. Xcode will create a free development provisioning profile
3. Note: This has limitations (7-day expiration, device limits)

## After Fixing Code Signing

Once code signing is set up, the build should proceed. The architecture issue has been resolved, so the build should complete successfully.

## Verify Setup
After adding the account, you can verify by:
1. Opening Xcode project
2. Checking that the team appears in Signing & Capabilities
3. Seeing a green checkmark next to "Automatically manage signing"

