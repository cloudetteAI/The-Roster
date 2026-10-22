// Firestore security-rules tests for The Roster (run with: cd tests && npm test)
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, addDoc, collection } from 'firebase/firestore';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-the-roster',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const card = (over = {}) => ({ name: 'Velvet Storm', allowFlags: true, flagPresets: ['Love-bombing'], categories: ['Kind'], photo: PNG, tags: ['tall'], fields: [], ...over });
const share = (uid, c) => ({ ownerUid: uid, personId: 'p1', rosterId: 'r1', card: c, createdAt: Date.now() });

// ---- R-01: stored XSS via share-card photo ----
test('owner can create a share with a real image photo', async () => {
  const db = env.authenticatedContext('alice').firestore();
  await assertSucceeds(setDoc(doc(db, 'shares', 'code1'), share('alice', card())));
});
test('XSS payload in photo is rejected', async () => {
  const db = env.authenticatedContext('alice').firestore();
  await assertFails(setDoc(doc(db, 'shares', 'evil1'), share('alice', card({ photo: 'x)" onmouseover="alert(document.cookie)' }))));
  await assertFails(setDoc(doc(db, 'shares', 'evil2'), share('alice', card({ photo: 'data:image/png;base64,AAAA)" onmouseover="alert(1)' }))));
  await assertFails(setDoc(doc(db, 'shares', 'evil3'), share('alice', card({ photo: 'data:image/svg+xml;base64,PHN2Zz4=' }))));
  await assertFails(setDoc(doc(db, 'shares', 'evil4'), share('alice', card({ photo: 'javascript:alert(1)' }))));
});
test('oversized photo is rejected', async () => {
  const db = env.authenticatedContext('alice').firestore();
  await assertFails(setDoc(doc(db, 'shares', 'big'), share('alice', card({ photo: 'data:image/jpeg;base64,' + 'A'.repeat(700001) }))));
});
test('unknown card keys and wrong types are rejected', async () => {
  const db = env.authenticatedContext('alice').firestore();
  await assertFails(setDoc(doc(db, 'shares', 'k1'), share('alice', card({ script: '<img onerror=alert(1)>' }))));
  await assertFails(setDoc(doc(db, 'shares', 'k2'), share('alice', card({ name: 42 }))));
  await assertFails(setDoc(doc(db, 'shares', 'k3'), share('alice', card({ name: 'x'.repeat(201) }))));
  await assertFails(setDoc(doc(db, 'shares', 'k4'), { ...share('alice', card()), extra: true }));
});
test('cannot create a share owned by someone else', async () => {
  const db = env.authenticatedContext('mallory').firestore();
  await assertFails(setDoc(doc(db, 'shares', 'c2'), share('alice', card())));
});
test('owner cannot update a share into an XSS payload', async () => {
  const db = env.authenticatedContext('alice').firestore();
  await assertSucceeds(setDoc(doc(db, 'shares', 'code1'), share('alice', card())));
  await assertFails(setDoc(doc(db, 'shares', 'code1'), share('alice', card({ photo: 'x)" onload="alert(1)' }))));
});

// ---- R-03 bug: feedback with a red flag ----
async function seedShare() {
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'shares', 'code1'), share('alice', card())); });
}
const fb = (over = {}) => ({ knows: true, votes: { Kind: 'up' }, comment: 'Seems sweet', from: 'Bestie', at: Date.now(), ...over });
test('friend feedback WITH a flag is accepted', async () => {
  await seedShare();
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(addDoc(collection(db, 'shares', 'code1', 'feedback'), fb({ flag: { label: 'Love-bombing', sev: 'red' } })));
  await assertSucceeds(addDoc(collection(db, 'shares', 'code1', 'feedback'), fb({ flag: { label: 'Bad texter', sev: 'yellow' } })));
});
test('friend feedback without a flag is still accepted', async () => {
  await seedShare();
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(addDoc(collection(db, 'shares', 'code1', 'feedback'), fb()));
});
test('malformed flags are rejected', async () => {
  await seedShare();
  const db = env.unauthenticatedContext().firestore();
  const col = collection(db, 'shares', 'code1', 'feedback');
  await assertFails(addDoc(col, fb({ flag: { label: 'x', sev: 'purple" onclick="alert(1)' } })));
  await assertFails(addDoc(col, fb({ flag: { label: '', sev: 'red' } })));
  await assertFails(addDoc(col, fb({ flag: { label: 'x'.repeat(201), sev: 'red' } })));
  await assertFails(addDoc(col, fb({ flag: { label: 'ok', sev: 'red', html: '<b>' } })));
  await assertFails(addDoc(col, fb({ flag: 'just a string' })));
});
test('only the owner can read feedback back', async () => {
  await seedShare();
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'shares', 'code1', 'feedback', 'f1'), fb()); });
  await assertSucceeds(getDoc(doc(env.authenticatedContext('alice').firestore(), 'shares', 'code1', 'feedback', 'f1')));
  await assertFails(getDoc(doc(env.authenticatedContext('mallory').firestore(), 'shares', 'code1', 'feedback', 'f1')));
});
