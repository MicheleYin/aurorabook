use fancy_regex::Regex;
use num2words::Num2Words;
use crate::token::{MToken, Underscore};
use crate::lexicon::Lexicon;
use std::collections::HashMap;
use crate::tagger::PerceptronTagger;

pub struct G2P {
    pub lexicon: Lexicon,
    pub unk: String,
    subtoken_regex: Regex,
    tagger: PerceptronTagger,
}

impl G2P {
    pub fn new(british: bool) -> Self {
        // Regex for subtokenization roughly matching the Python version
        let subtoken_regex = Regex::new(r"(?x)
            ^['‘’]+ |
            [[:upper:]](?=[[:upper:]][[:lower:]]) |
            (?:^-)?(?:\d?[,.]?\d)+ |
            [-_]+ |
            ['‘’]{2,} |
            [[:alpha:]]*?(?:['‘’][[:alpha:]])*?[[:lower:]](?=[[:upper:]]) |
            [[:alpha:]]+(?:['‘’][[:alpha:]])* |
            [^- _ [[:alpha:]] '‘’ \d] |
            ['‘’]+$
        ").unwrap();

        let weights_json = include_str!("resources/tagger/weights.json");
        let classes_txt = include_str!("resources/tagger/classes.txt");
        let tags_json = include_str!("resources/tagger/tags.json");

        Self {
            lexicon: Lexicon::new(british),
            unk: "❓".to_string(),
            subtoken_regex,
            tagger: PerceptronTagger::new(weights_json, classes_txt, tags_json),
        }
    }

    pub fn preprocess(&self, text: &str) -> (String, Vec<String>, HashMap<usize, String>) {
        // Simplified preprocess: just return the text and tokens for now
        // Python handles links like [text](phonemes), we'll skip that for simplicity unless needed
        let tokens: Vec<String> = text.split_whitespace().map(|s| s.to_string()).collect();
        (text.to_string(), tokens, HashMap::new())
    }

    pub fn tokenize(&self, text: &str) -> Vec<MToken> {
        let mut tokens = Vec::new();
        for mat in self.subtoken_regex.find_iter(text) {
            if let Ok(m) = mat {
                let sub = m.as_str();
                let tk = MToken::new(sub.to_string(), "NN".to_string(), " ".to_string());
                tokens.push(tk);
            }
        }
        tokens
    }

    fn subtokenize(&self, word: &str) -> Vec<String> {
        self.subtoken_regex.find_iter(word)
            .filter_map(|m| m.ok().map(|mat| mat.as_str().to_string()))
            .collect()
    }

    pub fn g2p(&self, text: &str) -> (String, Vec<MToken>) {
        let (processed_text, _, _) = self.preprocess(text);
        let mut tokens = self.tokenize(&processed_text);

        // Collect words for tagging
        let words_owned: Vec<String> = tokens.iter().map(|tk| tk.text.clone()).collect();
        let words: Vec<&str> = words_owned.iter().map(|s| s.as_str()).collect();
        let tags = self.tagger.tag(&words);

        for (tk, tag) in tokens.iter_mut().zip(tags.into_iter()) {
            tk.tag = tag.tag;
            if tk.phonemes.is_none() {
                let word = tk.text.clone();
                let tag = tk.tag.clone();
                
                // Try dictionary lookup
                if let Some((ps, _)) = self.lexicon.lookup(&word, &tag, None) {
                    tk.phonemes = Some(ps);
                } else if let Some((ps, _)) = self.lexicon.stem_s(&word, &tag, None) {
                    tk.phonemes = Some(ps);
                } else if let Some((ps, _)) = self.lexicon.stem_ed(&word, &tag, None) {
                    tk.phonemes = Some(ps);
                } else if let Some((ps, _)) = self.lexicon.stem_ing(&word, &tag, None) {
                    tk.phonemes = Some(ps);
                } else if self.is_number(&word) {
                    tk.phonemes = Some(self.convert_number(&word));
                } else {
                    // Final fallback to characters or unknown
                    tk.phonemes = Some(self.unk.clone());
                }
            }
        }

        let result = tokens.iter()
            .map(|tk| tk.phonemes.as_ref().unwrap_or(&self.unk).clone() + &tk.whitespace)
            .collect::<String>();

        (result, tokens)
    }

    fn is_number(&self, word: &str) -> bool {
        word.chars().all(|c| c.is_digit(10) || c == ',' || c == '.')
    }

    fn convert_number(&self, word: &str) -> String {
        let clean = word.replace(",", "");
        if let Ok(val) = clean.parse::<i64>() {
            if let Ok(spoken) = Num2Words::new(val).to_words() {
                 return spoken;
            }
        }
        word.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_g2p_basic() {
        let g2p = G2P::new();
        let (phonemes, _) = g2p.g2p("Hello, world!");
        println!("Phonemes: {}", phonemes);
        assert!(!phonemes.contains("❓"));
    }
}
