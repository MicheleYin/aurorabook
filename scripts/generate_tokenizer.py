#!/usr/bin/env python3
"""
Script to generate tokenizer.json from HuggingFace model
"""
import sys
import os

def generate_tokenizer(model_name, output_dir):
    try:
        from transformers import AutoTokenizer
        print(f"Downloading tokenizer from {model_name}...")
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        print(f"Saving tokenizer to {output_dir}...")
        tokenizer.save_pretrained(output_dir)
        
        tokenizer_json = os.path.join(output_dir, 'tokenizer.json')
        if os.path.exists(tokenizer_json):
            size = os.path.getsize(tokenizer_json)
            print(f"✓ tokenizer.json created successfully ({size:,} bytes)")
            return True
        else:
            print("✗ tokenizer.json not found after saving")
            return False
    except ImportError:
        print("✗ transformers library not installed")
        print("  Install it with: pip install transformers")
        return False
    except Exception as e:
        print(f"✗ Error: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 generate_tokenizer.py <model_name> <output_dir>")
        sys.exit(1)
    
    model_name = sys.argv[1]
    output_dir = sys.argv[2]
    
    os.makedirs(output_dir, exist_ok=True)
    success = generate_tokenizer(model_name, output_dir)
    sys.exit(0 if success else 1)

