# Downloading MFA G2P Models

## Option 1: Using MFA Command Line (Recommended)

1. **Install MFA** (if not already installed):
   ```bash
   pip install montreal-forced-aligner
   ```

2. **Download the English (UK) G2P model**:
   ```bash
   mfa model download g2p english_uk_mfa
   ```

3. **Find where MFA stores the model**:
   ```bash
   # On macOS/Linux:
   ls ~/Documents/MFA/pretrained_models/g2p/english_uk_mfa/
   
   # The model file should be something like:
   # english_uk_mfa.zip or a .fst file
   ```

4. **Extract and locate the .fst file**:
   - MFA stores models in compressed format
   - You'll need to extract the `.fst` file from the downloaded package
   - The FST file is what `phonetisaurus-g2p` needs

## Option 2: Direct Download from GitHub

1. **Navigate to the MFA Models repository**:
   - Go to: https://github.com/MontrealCorpusTools/mfa-models
   
2. **Find the model in the repository**:
   - Navigate to: `g2p/english/uk_mfa/v2.2.1/`
   - Download the `.fst` file directly

3. **Or use the release page**:
   - Check the model's documentation page for direct download links
   - Look for "Download from the release page" link

## Setting Up the Model in Your Project

After downloading, you have two options:

### Option A: Copy to `models/` directory (Current Implementation)

1. Create a `models/` directory in your project root:
   ```bash
   mkdir -p models
   ```

2. Copy the `.fst` file to the models directory:
   ```bash
   # For English UK
   cp ~/Documents/MFA/pretrained_models/g2p/english_uk_mfa/*.fst models/en-gb.fst
   
   # For English US (if needed)
   mfa model download g2p english_us_mfa
   cp ~/Documents/MFA/pretrained_models/g2p/english_us_mfa/*.fst models/en-us.fst
   ```

### Option B: Update Code to Use MFA's Model Directory

Update the code to look in MFA's default location:
- macOS/Linux: `~/Documents/MFA/pretrained_models/g2p/{model_name}/`
- Windows: `%USERPROFILE%\Documents\MFA\pretrained_models\g2p\{model_name}\`

## Language Code Mapping

The code currently expects:
- `"en"` or `"en-us"` → `models/en-us.fst`
- `"en-gb"` → `models/en-gb.fst`

Make sure your model file names match these language codes, or update the mapping in the code.

## Available English Models

- **English (US)**: `mfa model download g2p english_us_mfa`
- **English (UK)**: `mfa model download g2p english_uk_mfa`
- **English (India)**: `mfa model download g2p english_india_mfa`
- **English (Nigeria)**: `mfa model download g2p english_nigeria_mfa`

