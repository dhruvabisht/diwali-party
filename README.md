# 🪔 Diwali Night: party invite + RSVP

A single, very festive page to invite friends to a Diwali party. Guests can RSVP in two taps. It's hosted free on GitHub Pages.

It has a marigold toran and swinging akash kandils, tap-anywhere fireworks, a sparkler trail, a light-the-diyas game with a rangoli surprise, a live countdown, temple-bell sounds (off by default), "Diwali in 60 seconds" flip cards, and a mini Hindi phrasebook for friends new to Diwali.

---

## How your private details stay private

| What | Where it lives | Who can read it |
|---|---|---|
| Address, phone, RSVP link | `private/secrets.json`, **git-ignored and never uploaded** | Only you |
| Encrypted copy of the above | `sealed.js` (in the repo) | Nobody without the key: it's AES-GCM ciphertext |
| The key | Only in the invite link, after `#k=` | Whoever you send the link to |
| RSVPs | A Google Sheet in **your own** Google account | Only you |

- Browsers never send the part of a link after `#` to any server, so not even GitHub sees the key.
- Anyone who opens the site **without** the key (e.g. after finding this repo) only sees a "this invite is for special guests" lock screen.
- There are no third-party services, analytics, cookies or trackers, and fonts are self-hosted. A Content-Security-Policy stops the page talking to anything except your own Google Apps Script.
- RSVPs are sent with no cookies and no referrer. The Apps Script checks a secret token, escapes spreadsheet formulas, and **never sends the guest list back out**.
- `tools/leak-check.mjs` runs before every commit and blocks the commit if any private detail shows up in a file that would be published.

> Keep a backup of the `private/` folder (e.g. in your password manager). It holds the key. Lose it and you'd need to re-seal, which gives you a new link.

---

## One-time setup: your RSVP sheet (about 3 minutes)

1. Open **https://sheets.new** to create a new Google Sheet. Call it something like *Diwali RSVPs*.
2. In the Sheet menu: **Extensions → Apps Script**. Delete the sample code and paste **everything** from `private/Code.gs`. That copy has your secret token filled in; `apps-script/Code.gs` is only the blank template. Click 💾 **Save**.
3. In the toolbar's function dropdown pick **`setup`**, then click **▶ Run**. Google asks for permission:
   **Review permissions** → pick your account → *"Google hasn't verified this app"* → **Advanced** → **Go to … (unsafe)** → **Allow**.
   (It says "unverified" only because it's your own private script.) You'll get an email: *"Your Diwali RSVP book is set up"*.
4. **Deploy → New deployment** → click ⚙ → **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
5. Put that URL in `private/secrets.json` → `"rsvpUrl"`, then:
   ```sh
   node tools/seal.mjs
   git add sealed.js && git commit -m "Connect RSVP sheet" && git push
   ```

Until step 5 is done, the RSVP buttons fall back to a pre-filled WhatsApp message to you, so nothing gets lost.

**Notifications:** every RSVP (and every change) emails you from your own Google account. Turn on Gmail notifications on your phone and they arrive instantly. To stop the emails, set `SEND_EMAIL = false` in the script and redeploy (**Deploy → Manage deployments → ✏️ → Version: New version**).

---

## Sending the invite

Your link is in `private/invite-link.txt`. Paste it into WhatsApp, a group chat or anywhere else. Everyone uses the same link and nobody has to type a key.

## Changing a detail (address, time, phone…)

```sh
# edit private/secrets.json, then:
node tools/seal.mjs
git add sealed.js && git commit -m "Update invite details" && git push
```

The link stays the same.

## Preview locally

```sh
python3 -m http.server 8000
# then open http://localhost:8000/#k=<your key from private/invite-link.txt>
```

## Safety net (pre-commit hook)

```sh
printf '#!/bin/sh\nnode tools/leak-check.mjs\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

---

## Files

| File | What it is |
|---|---|
| `index.html`, `style.css` | The page and its look |
| `app.js` | Unlocking, RSVP, maps, calendar, countdown, games |
| `fx.js` | Fireworks, sparklers, synthesised bells, and the diya, lantern, toran and rangoli artwork |
| `sealed.js` | Your encrypted details (generated) |
| `apps-script/Code.gs` | Template of the Google Apps Script RSVP receiver |
| `tools/seal.mjs` | Encrypts `private/secrets.json` → `sealed.js` |
| `tools/leak-check.mjs` | Blocks commits that would publish private details |
| `tools/og.html`, `tools/icon.html` | Sources for the link-preview image and home-screen icon |
| `fonts/` | Yatra One, Poppins and Kalam, subset and self-hosted (SIL Open Font License) |
