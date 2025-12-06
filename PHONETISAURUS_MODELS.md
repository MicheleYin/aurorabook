# Phonetisaurus-G2P Compatible Models

This guide helps you find and use models compatible with the `phonetisaurus-g2p` Rust crate.

## Model Requirements

The `phonetisaurus-g2p` crate requires:
- **Format**: FST (Finite State Transducer) files (`.fst` extension)
- **Training**: Models must be trained with Phonetisaurus
- **Compatibility**: Any Phonetisaurus-trained FST model should work

## Available Pre-Trained Models

### 1. Montreal Forced Aligner (MFA) Models (Currently Used)

**Status**: ✅ Already compatible - you're using these!

**Download via MFA CLI**:
```bash
# Install MFA (if not already installed)
pip install montreal-forced-aligner

# Download English models
mfa model download g2p english_us_mfa
mfa model download g2p english_uk_mfa
mfa model download g2p english_india_mfa
mfa model download g2p english_nigeria_mfa
```

**Model Location** (after download):
- macOS/Linux: `~/Documents/MFA/pretrained_models/g2p/{model_name}/`
- Windows: `%USERPROFILE%\Documents\MFA\pretrained_models\g2p\{model_name}\`

**Direct GitHub Download**:
- Repository: https://github.com/MontrealCorpusTools/mfa-models
- Navigate to: `g2p/english/{dialect}_mfa/v{version}/`
- Download the `model.fst` file

**Note**: MFA models use a mixed ARPABET/IPA phoneme set, which is why we implemented ARPABET-to-IPA conversion.

### 2. Other Pre-Trained Models

#### Gruut Models
- **Source**: https://github.com/rhasspy/gruut
- **Format**: Trained with Phonetisaurus, should be compatible
- **Languages**: Multiple languages available
- **Note**: May require format conversion

#### CMU Pronouncing Dictionary Models
- **Source**: CMU Pronouncing Dictionary
- **Training**: Can be trained into Phonetisaurus FST format
- **Format**: ARPABET (would need conversion like MFA models)

### 3. Training Your Own Model

If you need a model with pure IPA output or for a specific domain:

**Requirements**:
1. Pronunciation lexicon (word → phonemes)
2. Phonetisaurus toolkit
3. Training script

**Basic Steps**:
```bash
# 1. Prepare lexicon.txt (word phoneme1 phoneme2 ...)
# example ɪɡˈzæmpəl

# 2. Train with Phonetisaurus
phonetisaurus-train --corpus g2p.corpus --model g2p.fst lexicon.txt

# 3. Use the resulting g2p.fst with phonetisaurus-g2p crate
```

**Resources**:
- Phonetisaurus: https://github.com/AdolfVonKleist/Phonetisaurus
- Gruut documentation: https://rhasspy.github.io/gruut/

## Model Comparison

| Model Source | Phoneme Format | IPA Compatibility | Notes |
|-------------|----------------|-------------------|-------|
| MFA Models | Mixed ARPABET/IPA | ✅ (with conversion) | Currently used, requires ARPABET→IPA conversion |
| Custom Trained | Configurable | ✅ (if trained with IPA) | Best for specific needs, requires training |
| CMU-based | ARPABET | ⚠️ (needs conversion) | Would need similar conversion as MFA |

## Recommended Approach

### For Best IPA Compatibility:

1. **Option A: Use MFA models with conversion** (Current)
   - ✅ Already working
   - ✅ Pre-trained and tested
   - ⚠️ Requires ARPABET→IPA conversion (already implemented)

2. **Option B: Train custom IPA model**
   - ✅ Pure IPA output
   - ✅ Can be tailored to your needs
   - ⚠️ Requires training data and time

3. **Option C: Find IPA-only pre-trained models**
   - ✅ Pure IPA output
   - ⚠️ Limited availability
   - ⚠️ May need format verification

## Using Models in Your Project

### Current Setup (MFA Models)

Your models are located at:
```
src-tauri/resources/english_us_mfa/model.fst
src-tauri/resources/english_uk_mfa/model.fst
```

The code automatically finds these models when using:
```rust
Phonemizer::new_with_g2p("a", None)  // en-us
Phonemizer::new_with_g2p("b", None)  // en-gb
```

### Adding New Models

1. Download or train the `.fst` model file
2. Place it in `src-tauri/resources/{model_name}/model.fst`
3. Update the language mapping in `find_g2p_model()` if needed

## Model Sources Summary

### Direct Download Links:

1. **MFA Models** (Recommended for English):
   - GitHub: https://github.com/MontrealCorpusTools/mfa-models
   - Documentation: https://mfa-models.readthedocs.io/
   - CLI: `mfa model download g2p {model_name}`

2. **Gruut Models**:
   - GitHub: https://github.com/rhasspy/gruut
   - May need format verification

3. **Phonetisaurus Repository**:
   - GitHub: https://github.com/AdolfVonKleist/Phonetisaurus
   - Contains training tools and examples

## Testing Model Compatibility

To test if a model is compatible:

```rust
use phonetisaurus_g2p::PhonetisaurusModel;
use std::path::Path;

fn test_model(path: &str) {
    match PhonetisaurusModel::try_from(Path::new(path)) {
        Ok(model) => {
            println!("✅ Model loaded successfully!");
            match model.phonemize_word("test") {
                Ok(result) => println!("Phonemes: {}", result.phonemes),
                Err(e) => println!("⚠️  Model loaded but phonemization failed: {}", e),
            }
        }
        Err(e) => println!("❌ Model incompatible: {}", e),
    }
}
```

## Next Steps

1. **If you want better IPA compatibility**: Consider training a custom model with pure IPA phonemes
2. **If current models work**: Continue using MFA models with the ARPABET→IPA conversion
3. **If you need other languages**: Check MFA models for your target language or train custom models

