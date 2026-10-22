# Firestore rules tests

Proves the security rules do what we think. Needs Node 18+ and Java 11+.

```bash
cd tests
npm install
npm test   # starts the Firestore emulator, runs rules.test.mjs, shuts it down
```
