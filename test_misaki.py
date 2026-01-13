import sys
from misaki import en

def main():
    if len(sys.argv) < 2:
        print("Usage: python test_misaki.py <text>")
        sys.exit(1)
    
    text = sys.argv[1]
    g2p = en.G2P(trf=False, british=False)
    phonemes, _ = g2p(text)
    print(phonemes)

if __name__ == "__main__":
    main()
