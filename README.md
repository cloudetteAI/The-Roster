# 🗂️ The Roster

Build **any** roster — Dating (featured), Sports Team, Friends, Babysitters, or Custom. Rank people, tag & group them, track custom fields, and ask friends for feedback via a limited share card.

**Live:** https://cloudetteai.github.io/The-Roster/

Static single-page app (vanilla JS, no build step) + Firebase Auth (Google & Apple) + Firestore.

## Demo mode
Until `firebase-config.js` is filled in, the app runs in **DEMO MODE** (badge in header): both sign-in buttons log into a local demo account, and everything (rosters, photos as resized data URLs, share links, friend feedback) is stored in this browser's `localStorage`. Share links work only in the same browser in demo mode.

## Features
- Templates with prefilled fields; add/edit/remove custom fields (text, notes, select, rating, checkbox, date)
- Dating: photos, LinkedIn/Facebook/Instagram links, seen-on-a-dating-app + which app, first-date rating + notes, notes, tags (filter / group by any tag), overall ranking, physical-preference thumbs (arms, stomach, hair, face, overall looks, clothing/style, smell, vibe)
- Sports, Friends, Babysitter templates
- **Get feedback**: owner picks which fields a friend sees (ranking/notes hidden by default); friend marks "I know this person personally", votes 👍/👎 per category, comments; feedback flows back to the owner's card

## Turning on real Google / Apple login
1. Go to https://console.firebase.google.com → **Add project** (e.g. `the-roster`).
2. **Build → Authentication → Get started → Sign-in method**:
   - Enable **Google** (choose a support email). Done.
   - Enable **Apple**. ⚠️ Requires a paid **Apple Developer account** ($99/yr). In Apple Developer: create an App ID with *Sign in with Apple*, a **Services ID** (this is the Firebase "Service ID"), and a **Sign in with Apple key** (.p8). Add the return URL Firebase shows (`https://YOUR_PROJECT.firebaseapp.com/__/auth/handler`) and domain to the Services ID. Paste Services ID, Team ID, Key ID and private key into Firebase.
3. **Authentication → Settings → Authorized domains** → add `cloudetteai.github.io`.
4. **Build → Firestore Database → Create database** (production mode). Open **Rules**, paste the contents of [`firestore.rules`](firestore.rules), **Publish**.
5. **Project settings → General → Your apps → Web (</>)** → register app → copy the `firebaseConfig` object into [`firebase-config.js`](firebase-config.js), replacing the placeholders. Commit & push; Pages redeploys.

(The Firebase web config is not secret — security comes from the rules.)

## Data & privacy
- `users/{uid}` — the user's whole roster, readable/writable only by that uid.
- `shares/{code}` — a limited card the owner chose to share; fetchable only by exact code (no listing), editable only by owner.
- `shares/{code}/feedback/{id}` — anyone with the link can *create* feedback; only the owner can read it.
- Photos are resized (~640px) and stored inside the user doc. For many/full-size photos, switch to Firebase Storage (Firestore docs cap at 1 MB).

## Local dev
`python3 -m http.server` then open http://localhost:8000
