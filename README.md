[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# IncogAgent™ Mail (Open Source Edition)

IncogAgent Mail is a Chrome extension that provides AI-powered email summarization with zero-trust privacy protection for Gmail users. 

Built with a local-first philosophy, it intercepts and sanitizes your sensitive data (PII) entirely on-device *before* any text is sent to the cloud for AI processing.

## Highlights
- **Zero-Trust Summarization:** Get AI-assisted summaries of your Gmail threads without exposing sensitive identifiers.
- **Local-First Masking:** Uses a lightweight, on-device NLP pipeline (`compromise.js` + Regex) to mask names, emails, phone numbers, and IDs.
- **Context Restoration:** Intelligently maps and restores placeholders (e.g., `{{PERSON_1}}`) back to their original values locally after the AI returns the summary.
- **Frictionless UI:** A clean, lightweight popup integrated directly into your Gmail workflow via content scripts.

## How It Works
1. **Extraction:** The content script reads the currently viewed Gmail thread.
2. **Sanitization:** Sensitive fields are masked locally within the browser.
3. **Processing:** The background service worker requests an AI summary using only the masked, anonymized text.
4. **Restoration:** The extension reconstructs the original context and displays the summary in the popup UI.

## Installation & Configuration
Because this extension requires access to the Gmail API, you must configure your own Google Cloud Project to generate an OAuth Client ID. 

We have designed the repository with a **Fixed Open-Source Extension ID** to make this setup as seamless as possible.

👉 **[Click here for the complete Step-by-Step Setup Guide](SETUP_GUIDE.md)**

## Privacy & Data Handling
IncogAgent Mail is designed to eliminate the "Privacy Paradox" of the GenAI era. Actual masking rules live in the extension code and run locally. No unmasked data ever leaves your device for summarization purposes. You can audit the complete masking pipeline in the `privacyMasking.js` file.

## Project Structure
- `background.js` - Background service worker handling OAuth and API calls.
- `content.js` - Gmail DOM extraction.
- `popup.html` / `popup.js` - Extension popup UI and logic.
- `privacyMasking.js` - Core privacy masking orchestrator.
- `lib/anonymizer.js` - Custom anonymization utilities.
- `lib/compromise.js` - Third-party local NLP entity extraction.

## Permissions Justification
- `identity`: Required for the OAuth 2.0 flow to authenticate with your Google account.
- `storage`: Required to persist extension settings and temporary mapping dictionaries.
- `https://gmail.googleapis.com/*`: Required to fetch email thread data.
- `<all_urls>`: Required for the content script to extract text directly from the active Gmail DOM.

## License & Notices
Distributed under the MIT License. See [LICENSE](LICENSE) for more information.  
For third-party libraries, see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).