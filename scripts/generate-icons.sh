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

# Create a temporary image with white background for macOS
echo -e "${GREEN}Adding white background to base icon for macOS...${NC}"
TEMP_IMAGE_WITH_BG="/tmp/icon_with_bg_$$.png"

# Get image dimensions
IMAGE_WIDTH=$(sips -g pixelWidth "$SOURCE_IMAGE" | awk '/pixelWidth:/{print $2}')
IMAGE_HEIGHT=$(sips -g pixelHeight "$SOURCE_IMAGE" | awk '/pixelHeight:/{print $2}')

# Check if ImageMagick is available (preferred method)
if command -v convert &> /dev/null; then
    # Use ImageMagick to composite image on white background
    convert -size "${IMAGE_WIDTH}x${IMAGE_HEIGHT}" xc:white "$SOURCE_IMAGE" -gravity center -composite "$TEMP_IMAGE_WITH_BG"
    echo "  Created icon with white background using ImageMagick"
else
    # Fallback: Use sips to create white background and composite
    # Create a white image first using Python (usually available on macOS)
    if command -v python3 &> /dev/null; then
        python3 << EOF
from PIL import Image
import sys

# Create white background
bg = Image.new('RGB', ($IMAGE_WIDTH, $IMAGE_HEIGHT), 'white')

# Open source image
source = Image.open('$SOURCE_IMAGE')
if source.mode == 'RGBA':
    # Composite with alpha channel
    bg.paste(source, (0, 0), source)
else:
    # Paste without alpha
    bg.paste(source, (0, 0))

bg.save('$TEMP_IMAGE_WITH_BG')
EOF
        echo "  Created icon with white background using Python/PIL"
    else
        # Last resort: just use the original image (user will need to add white background manually)
        echo -e "${YELLOW}  Warning: Neither ImageMagick nor Python3 with PIL found.${NC}"
        echo -e "${YELLOW}  Using original image without white background.${NC}"
        echo -e "${YELLOW}  Install ImageMagick (brew install imagemagick) or Python PIL for white background support.${NC}"
        TEMP_IMAGE_WITH_BG="$SOURCE_IMAGE"
    fi
fi

# Use the image with white background for macOS icon generation
MACOS_ICON_SOURCE="$TEMP_IMAGE_WITH_BG"

# Function to resize image using sips (macOS built-in)
resize_image() {
    local size=$1
    local output=$2
    local source=$3
    echo "  Creating ${output} (${size}x${size})..."
    sips -z "$size" "$size" "$source" --out "$ICONS_DIR/$output" > /dev/null 2>&1
}

# Generate PNG icons (using original source for general icons)
echo -e "${GREEN}Generating PNG icons...${NC}"
resize_image 32 "32x32.png" "$SOURCE_IMAGE"
resize_image 128 "128x128.png" "$SOURCE_IMAGE"
resize_image 256 "128x128@2x.png" "$SOURCE_IMAGE"
resize_image 256 "256x256.png" "$SOURCE_IMAGE"
resize_image 512 "512x512.png" "$SOURCE_IMAGE"
resize_image 512 "icon.png" "$SOURCE_IMAGE"

# Generate macOS .icns file
echo -e "${GREEN}Generating macOS .icns file...${NC}"
ICONSET_DIR="$ICONS_DIR/icon.iconset"
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

# Create all required sizes for .icns (using white background version for macOS)
# Use direct paths for iconset files since resize_image prepends ICONS_DIR
echo "  Creating icon_16x16.png (16x16)..."
sips -z 16 16 "$MACOS_ICON_SOURCE" --out "$ICONSET_DIR/icon_16x16.png" > /dev/null 2>&1
echo "  Creating icon_16x16@2x.png (32x32)..."
sips -z 32 32 "$MACOS_ICON_SOURCE" --out "$ICONSET_DIR/icon_16x16@2x.png" > /dev/null 2>&1
echo "  Creating icon_32x32.png (32x32)..."
sips -z 32 32 "$MACOS_ICON_SOURCE" --out "$ICONSET_DIR/icon_32x32.png" > /dev/null 2>&1
echo "  Creating icon_32x32@2x.png (64x64)..."
sips -z 64 64 "$MACOS_ICON_SOURCE" --out "$ICONSET_DIR/icon_32x32@2x.png" > /dev/null 2>&1
echo "  Creating icon_128x128.png (128x128)..."
sips -z 128 128 "$MACOS_ICON_SOURCE" --out "$ICONSET_DIR/icon_128x128.png" > /dev/null 2>&1
echo "  Creating icon_128x128@2x.png (256x256)..."
sips -z 256 256 "$MACOS_ICON_SOURCE" --out "$ICONSET_DIR/icon_128x128@2x.png" > /dev/null 2>&1
echo "  Creating icon_256x256.png (256x256)..."
sips -z 256 256 "$MACOS_ICON_SOURCE" --out "$ICONSET_DIR/icon_256x256.png" > /dev/null 2>&1
echo "  Creating icon_256x256@2x.png (512x512)..."
sips -z 512 512 "$MACOS_ICON_SOURCE" --out "$ICONSET_DIR/icon_256x256@2x.png" > /dev/null 2>&1
echo "  Creating icon_512x512.png (512x512)..."
sips -z 512 512 "$MACOS_ICON_SOURCE" --out "$ICONSET_DIR/icon_512x512.png" > /dev/null 2>&1
echo "  Creating icon_512x512@2x.png (1024x1024)..."
sips -z 1024 1024 "$MACOS_ICON_SOURCE" --out "$ICONSET_DIR/icon_512x512@2x.png" > /dev/null 2>&1

# Generate .icns using iconutil
iconutil -c icns "$ICONSET_DIR" -o "$ICONSET_DIR/../icon.icns"
echo "  Created icon.icns"

# Generate Windows .ico file
echo -e "${GREEN}Generating Windows .ico file...${NC}"
# Check if ImageMagick is available (better for ICO)
if command -v convert &> /dev/null; then
    echo "  Using ImageMagick to create icon.ico..."
    # Create temporary 16x16 size for ICO
    resize_image 16 "$ICONS_DIR/16x16.png" "$SOURCE_IMAGE"
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
resize_image 30 "Square30x30Logo.png" "$SOURCE_IMAGE"
resize_image 44 "Square44x44Logo.png" "$SOURCE_IMAGE"
resize_image 71 "Square71x71Logo.png" "$SOURCE_IMAGE"
resize_image 89 "Square89x89Logo.png" "$SOURCE_IMAGE"
resize_image 107 "Square107x107Logo.png" "$SOURCE_IMAGE"
resize_image 142 "Square142x142Logo.png" "$SOURCE_IMAGE"
resize_image 150 "Square150x150Logo.png" "$SOURCE_IMAGE"
resize_image 284 "Square284x284Logo.png" "$SOURCE_IMAGE"
resize_image 310 "Square310x310Logo.png" "$SOURCE_IMAGE"
resize_image 50 "StoreLogo.png" "$SOURCE_IMAGE"  # Store logo is typically 50x50

# Wide Start menu tile (310x150) — center the 150x150 logo on a white canvas
echo -e "${GREEN}Generating Windows Store wide tile (310x150)...${NC}"
if command -v convert &> /dev/null; then
    echo "  Creating Wide310x150Logo.png (310x150)..."
    convert -size 310x150 xc:white "$ICONS_DIR/Square150x150Logo.png" -gravity center -composite "$ICONS_DIR/Wide310x150Logo.png"
elif command -v magick &> /dev/null; then
    echo "  Creating Wide310x150Logo.png (310x150)..."
    magick -size 310x150 xc:white "$ICONS_DIR/Square150x150Logo.png" -gravity center -composite "$ICONS_DIR/Wide310x150Logo.png"
else
    echo -e "${YELLOW}  Warning: ImageMagick not found; skipping Wide310x150Logo.png${NC}"
    echo -e "${YELLOW}  On Windows run: node scripts/generate-wide-tile.cjs${NC}"
fi

# Clean up temporary file
if [ -f "$TEMP_IMAGE_WITH_BG" ] && [ "$TEMP_IMAGE_WITH_BG" != "$SOURCE_IMAGE" ]; then
    rm -f "$TEMP_IMAGE_WITH_BG"
fi

echo -e "${GREEN}✓ All icons generated successfully!${NC}"
echo -e "${GREEN}Icons location: ${ICONS_DIR}${NC}"

