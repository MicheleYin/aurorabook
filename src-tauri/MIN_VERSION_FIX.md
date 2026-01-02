# Minimum System Version Error Fix

## The Problem

When uploading a `.pkg` file to App Store Connect using `altool`, you may encounter this error:

```
Validation failed (409) Invalid product archive. The lowest minimum system version in the product definition property list, none, must equal the LSMinimumSystemVersion value, 12.0.
```

## Root Cause

When using `productbuild --component` to create a macOS installer package, the tool automatically generates a `DistributionSummary.plist` file inside the package. However, this auto-generated file doesn't include a minimum system version, even though your app's `Info.plist` has `LSMinimumSystemVersion` set to `12.0`.

Apple's validation requires that:
- The package's DistributionSummary.plist must have a minimum system version
- This minimum system version must match the `LSMinimumSystemVersion` in your app's `Info.plist`

## The Solution

Instead of using `productbuild --component` (which doesn't allow you to specify the minimum system version), we use a two-step process:

1. **Create a component package** using `pkgbuild --component`
2. **Create the final package** using `productbuild --distribution` with a Distribution XML file that specifies the minimum system version

### Files Created/Modified

1. **`Distribution.xml`** - A new file that defines the package structure and includes `<os-version min="12.0"/>`
2. **`build_appstore.sh`** - Updated to use the two-step package creation process

### How It Works

The `Distribution.xml` file includes:
- Package metadata (title, organization, etc.)
- Product definition pointing to your app's `Info.plist`
- **`<os-version min="12.0"/>`** - This is the key fix that sets the minimum system version in the package

When `productbuild --distribution` processes this XML file, it creates a `DistributionSummary.plist` with the minimum system version set to `12.0`, which matches your app's `LSMinimumSystemVersion`.

## Usage

The build script (`build_appstore.sh`) has been updated to automatically:
1. Create the component package
2. Use the Distribution XML file to create the final package with the correct minimum system version

Just run:
```bash
cd src-tauri
./build_appstore.sh
```

## Verification

After building, you can verify the package has the correct minimum system version:

```bash
# Expand the package
pkgutil --expand AuroraBook.pkg /tmp/expanded_pkg

# Check the DistributionSummary.plist
plutil -p /tmp/expanded_pkg/DistributionSummary.plist | grep -i "minimum"
```

You should see the minimum system version set to `12.0`.

## Alternative: Upload .app Directly

**Note**: For Mac App Store uploads, you can actually upload the `.app` bundle directly to App Store Connect without creating a `.pkg` file. This avoids the minimum system version issue entirely, as the `.app` bundle's `Info.plist` already has `LSMinimumSystemVersion` set correctly.

However, if you need to create a `.pkg` file (for testing, direct distribution, or other reasons), the Distribution XML approach is the correct solution.

