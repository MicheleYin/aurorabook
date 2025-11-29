#!/bin/bash

# Script to generate all required app icons from image.png
# Usage: ./scripts/generate-icons.sh

set -e

SOURCE_IMAGE="image.png"
ICONS_DIR="src-tauri/icons"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Generating app icons from ${SOURCE_IMAGE}...${NC}"

# Check if source image exists
if [ ! -f "$SOURCE_IMAGE" ]; then
    echo -e "${YELLOW}Error: ${SOURCE_IMAGE} not found!${NC}"
    exit 1
fi

# Create icons directory if it doesn't exist
mkdir -p "$ICONS_DIR"

# Function to resize image using sips (macOS built-in)
resize_image() {
    local size=$1
    local output=$2
    echo "  Creating ${output} (${size}x${size})..."
    sips -z "$size" "$size" "$SOURCE_IMAGE" --out "$ICONS_DIR/$output" > /dev/null 2>&1
}

# Generate PNG icons
echo -e "${GREEN}Generating PNG icons...${NC}"
resize_image 32 "32x32.png"
resize_image 128 "128x128.png"
resize_image 256 "128x128@2x.png"
resize_image 256 "256x256.png"
resize_image 512 "512x512.png"
resize_image 512 "icon.png"

# Generate macOS .icns file
echo -e "${GREEN}Generating macOS .icns file...${NC}"
ICONSET_DIR="$ICONS_DIR/icon.iconset"
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

# Create all required sizes for .icns
# Use direct paths for iconset files since resize_image prepends ICONS_DIR
echo "  Creating icon_16x16.png (16x16)..."
sips -z 16 16 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_16x16.png" > /dev/null 2>&1
echo "  Creating icon_16x16@2x.png (32x32)..."
sips -z 32 32 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_16x16@2x.png" > /dev/null 2>&1
echo "  Creating icon_32x32.png (32x32)..."
sips -z 32 32 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_32x32.png" > /dev/null 2>&1
echo "  Creating icon_32x32@2x.png (64x64)..."
sips -z 64 64 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_32x32@2x.png" > /dev/null 2>&1
echo "  Creating icon_128x128.png (128x128)..."
sips -z 128 128 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_128x128.png" > /dev/null 2>&1
echo "  Creating icon_128x128@2x.png (256x256)..."
sips -z 256 256 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_128x128@2x.png" > /dev/null 2>&1
echo "  Creating icon_256x256.png (256x256)..."
sips -z 256 256 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_256x256.png" > /dev/null 2>&1
echo "  Creating icon_256x256@2x.png (512x512)..."
sips -z 512 512 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_256x256@2x.png" > /dev/null 2>&1
echo "  Creating icon_512x512.png (512x512)..."
sips -z 512 512 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_512x512.png" > /dev/null 2>&1
echo "  Creating icon_512x512@2x.png (1024x1024)..."
sips -z 1024 1024 "$SOURCE_IMAGE" --out "$ICONSET_DIR/icon_512x512@2x.png" > /dev/null 2>&1

# Generate .icns using iconutil
iconutil -c icns "$ICONSET_DIR" -o "$ICONSET_DIR/../icon.icns"
echo "  Created icon.icns"

# Generate Windows .ico file
echo -e "${GREEN}Generating Windows .ico file...${NC}"
# Check if ImageMagick is available (better for ICO)
if command -v convert &> /dev/null; then
    echo "  Using ImageMagick to create icon.ico..."
    # Create temporary 16x16 size for ICO
    resize_image 16 "$ICONS_DIR/16x16.png"
    convert "$ICONS_DIR/16x16.png" "$ICONS_DIR/32x32.png" "$ICONS_DIR/128x128.png" "$ICONS_DIR/256x256.png" "$ICONS_DIR/512x512.png" "$ICONS_DIR/icon.ico" 2>/dev/null || {
        echo -e "${YELLOW}  Warning: ImageMagick conversion had issues, using fallback${NC}"
        cp "$ICONS_DIR/256x256.png" "$ICONS_DIR/icon.ico"
    }
    rm -f "$ICONS_DIR/16x16.png"
else
    echo -e "${YELLOW}  ImageMagick not found. Creating .ico using sips (may have limited resolutions)...${NC}"
    # Create a basic ICO using sips (will only have one resolution)
    # For a proper multi-resolution ICO, ImageMagick or another tool is recommended
    cp "$ICONS_DIR/256x256.png" "$ICONS_DIR/icon.ico"
    echo -e "${YELLOW}  Note: Install ImageMagick (brew install imagemagick) for multi-resolution .ico support${NC}"
fi

# Generate Windows Store logos (if needed)
echo -e "${GREEN}Generating Windows Store logos...${NC}"
resize_image 30 "Square30x30Logo.png"
resize_image 44 "Square44x44Logo.png"
resize_image 71 "Square71x71Logo.png"
resize_image 89 "Square89x89Logo.png"
resize_image 107 "Square107x107Logo.png"
resize_image 142 "Square142x142Logo.png"
resize_image 150 "Square150x150Logo.png"
resize_image 284 "Square284x284Logo.png"
resize_image 310 "Square310x310Logo.png"
resize_image 50 "StoreLogo.png"  # Store logo is typically 50x50

echo -e "${GREEN}✓ All icons generated successfully!${NC}"
echo -e "${GREEN}Icons location: ${ICONS_DIR}${NC}"

