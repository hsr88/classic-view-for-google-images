# Privacy Policy for Classic View for Google Images™

Last updated: September 1, 2026

## 1. Overview

This policy covers the **Classic View for Google Images™ Chrome extension**. The marketing website at [classicview.cc](https://classicview.cc/) has a separate privacy policy that also describes website analytics: [classicview.cc/privacy](https://classicview.cc/privacy).

## 2. Information Collection and Storage

- **No Personal Data Collection:** The Extension does NOT collect, transmit, store, or share any personal data, search queries, browsing history, IP addresses, or user identifiers.
- **Local Settings Storage:** The Extension uses Chrome's native `chrome.storage.sync` API solely to save user-defined layout preferences (such as row height, gap spacing, hover zoom toggle, view image button toggle, size filter bar toggle, hide related searches toggle, AI image badge toggle, and hide detected AI images toggle). These preferences remain stored locally on your device and synced within your personal Google Chrome profile. AI image detection uses only information already present on the Google Images page and runs locally in the browser. No data is sent to external servers or third parties.

## 3. Third-Party Services

The Extension does not use any third-party analytics, tracking tools, advertisement networks, or external remote code scripts.

The classicview.cc website may use Google Analytics after visitor consent. That analytics applies to the website only and does not affect the Extension.

## 4. Permissions Usage

- `storage`: Required strictly for saving UI preferences locally.
- `activeTab`: Used only after the user opens the extension popup. It allows the "Report issue" button to include the current Google domain in a GitHub issue. The Extension does not include the full page URL, search query, or page content.
- Host permissions for supported Google country domains: Required exclusively to insert CSS and JavaScript styling that reorganizes results visually on Google Images pages. The complete list of supported domains is defined in `manifest.json`.

## 5. Contact

If you have any questions or concerns regarding this Privacy Policy, please contact the developer via the official Chrome Web Store extension support page.
