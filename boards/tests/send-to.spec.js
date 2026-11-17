// send-to.spec.js
//
// Send to…: right-click a card, a selection or a cluster's row in the sidebar,
// pick who gets it in the sheet (components/SendSheet.jsx), and Send gives them
// view access and posts a message whose attachment is the card or cluster.
// The real signed-in app, every Supabase call answered by tests/sendApp.js
// (which records what the app sent).

import { expect, test } from '@playwright/test';
import { signedInForSend, BOARD, WS, CONV_MAYA, PRIYA } from './sendApp.js';

const menu = (page) => page.locator('.ctx-menu');
const dialog = (page) => page.getByRole('dialog', { name: 'Send to…' });
const toast = (page, text) => page.locator('.toast-msg').filter({ hasText: text });
const rowOf = (page, name) => dialog(page).getByRole('checkbox', { name });
const sendButton = (page) => dialog(page).getByRole('button', { name: 'Send', exact: true });
const EMPTY = { x: 1100, y: 640 };

async function openCluster(page, baseURL, opts) {
  const app = await signedInForSend(page, baseURL, opts);
  await page.goto(`/?board=${BOARD}`);
  await expect(page.locator('.canvas-wrap').first()).toBeVisible({ timeout: 60000 });
  return app;
}

// A note at a point of the canvas, left deselected.
async function makeNote(page, at, text) {
  await page.keyboard.press('n');
  await page.mouse.click(at.x, at.y);
  const editor = page.locator('.canvas-wrap .card .note-body[contenteditable="true"]').last();
  await editor.waitFor();
  await editor.click();
  await page.keyboard.type(text);
  await page.mouse.click(EMPTY.x, EMPTY.y);
  await expect(page.locator('.canvas-wrap .card .note-body[contenteditable="true"]')).toHaveCount(0);
  await expect(page.locator('.canvas-wrap .card').filter({ hasText: text })).toHaveCount(1);
}

// Right-click near the bottom-left of the nth card, clear of its editable body.
async function rightClickCard(page, n) {
  const box = await page.locator('.canvas-wrap .card').nth(n).boundingBox();
  await page.mouse.click(box.x + 12, box.y + box.height - 8, { button: 'right' });
}

async function openFromSidebar(page) {
  const row = page.locator(`.sb-tree-row[data-board-id="${BOARD}"]`);
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  await menu(page).getByRole('menuitem', { name: 'Send to…' }).click();
  await expect(dialog(page)).toBeVisible();
}

test('right-click a card, Send to…, pick a chat, Send: the cluster, the pick and a card attachment go out', async ({ page, baseURL }) => {
  const app = await openCluster(page, baseURL);
  await makeNote(page, { x: 500, y: 300 }, 'The corner, the title, the last light');
  await rightClickCard(page, 0);
  await menu(page).getByRole('menuitem', { name: 'Send to…' }).click();

  await expect(dialog(page)).toBeVisible();
  // The sheet shows what goes: the note's own words, and its kind and cluster.
  await expect(dialog(page).locator('.snd-th-note')).toContainText('The corner, the title');
  await expect(dialog(page).locator('.snd-wmt')).toHaveText('Note · Test Studio');
  const maya = rowOf(page, /Maya Reyes/);
  await expect(maya).toBeVisible();
  await maya.click();
  await expect(maya).toHaveAttribute('aria-checked', 'true');
  await expect(dialog(page).locator('.snd-access')).toContainText('Maya Reyes will be able to view Test Studio.');

  await sendButton(page).click();

  await expect.poll(() => app.sent.rpc('send_board_to').length).toBe(1);
  expect(app.sent.rpc('send_board_to')[0]).toMatchObject({
    p_board_id: BOARD, p_workspace_id: WS, p_user_ids: [], p_emails: [], p_conversation_ids: [CONV_MAYA],
  });
  await expect.poll(() => app.sent.messages.length).toBe(1);
  const msg = app.sent.messages[0];
  expect(msg.conversation_id).toBe(CONV_MAYA);
  expect(msg.attachments).toHaveLength(1);
  expect(msg.attachments[0]).toMatchObject({ kind: 'card', boardId: BOARD, snap: { v: 1, k: 'note' } });
  expect(msg.attachments[0].snap.text).toContain('The corner, the title, the last light');
  expect(typeof msg.attachments[0].cardId).toBe('string');

  await expect(dialog(page)).toHaveCount(0);
  await expect(toast(page, 'Sent to Maya Reyes')).toBeVisible();
  await expect(page.locator('.toast-action').filter({ hasText: 'Open chat' })).toBeVisible();
});

test('two cards selected: "Send 2 cards to…", and the message carries two card attachments', async ({ page, baseURL }) => {
  const app = await openCluster(page, baseURL);
  await makeNote(page, { x: 400, y: 300 }, 'First note');
  await makeNote(page, { x: 800, y: 300 }, 'Second note');
  await expect(page.locator('.canvas-wrap .card')).toHaveCount(2);

  await page.mouse.click(EMPTY.x, EMPTY.y, { button: 'right' });
  await menu(page).getByRole('menuitem', { name: 'Select all' }).click();
  await expect(page.locator('.canvas-wrap .card.is-selected')).toHaveCount(2);
  await rightClickCard(page, 0);
  await menu(page).getByRole('menuitem', { name: 'Send 2 cards to…' }).click();

  await expect(dialog(page)).toBeVisible();
  await rowOf(page, /Maya Reyes/).click();
  await sendButton(page).click();

  await expect.poll(() => app.sent.messages.length).toBe(1);
  const atts = app.sent.messages[0].attachments;
  expect(atts).toHaveLength(2);
  for (const a of atts) expect(a).toMatchObject({ kind: 'card', boardId: BOARD });
  expect(new Set(atts.map((a) => a.cardId)).size).toBe(2);
});

test('right-click the cluster in the sidebar: Send to… names it and posts a cluster attachment', async ({ page, baseURL }) => {
  const app = await openCluster(page, baseURL);
  await openFromSidebar(page);
  await expect(dialog(page).locator('.snd-wnm')).toHaveText('Test Studio');
  await expect(dialog(page).locator('.snd-wmt')).toContainText('Cluster in Test Studio');
  await rowOf(page, /Maya Reyes/).click();
  await sendButton(page).click();

  await expect.poll(() => app.sent.rpc('send_board_to').length).toBe(1);
  expect(app.sent.rpc('send_board_to')[0]).toMatchObject({ p_board_id: BOARD, p_conversation_ids: [CONV_MAYA] });
  await expect.poll(() => app.sent.messages.length).toBe(1);
  expect(app.sent.messages[0].attachments[0]).toMatchObject({ kind: 'board', boardId: BOARD, snap: { v: 1, k: 'cluster' } });
});

test('a viewer cannot send to a new email: the row is off and the line names who cannot open it', async ({ page, baseURL }) => {
  const app = await openCluster(page, baseURL, { canGrant: false, closed: [PRIYA] });
  await openFromSidebar(page);

  const search = dialog(page).getByRole('textbox', { name: 'Name or email' });
  await search.fill('newperson@example.com');
  const email = rowOf(page, /newperson@example\.com/);
  await expect(email).toBeVisible();
  // the answer to send_to_status arrives a moment after the sheet opens
  await expect(email).toHaveAttribute('aria-disabled', 'true');
  await expect(email).toContainText('Only people who can edit Test Studio can send it to a new email.');
  await email.click({ force: true });
  await expect(email).toHaveAttribute('aria-checked', 'false');

  // a person the cluster is closed to: the line says they won't be able to open it
  await search.fill('');
  const priya = rowOf(page, /Priya Nair/);
  await priya.click();
  await expect(priya).toHaveAttribute('aria-checked', 'true');
  await expect(dialog(page).locator('.snd-access')).toContainText("Priya Nair won't be able to open it: only its editors can let people in.");
  expect(app.sent.rpc('send_board_to')).toHaveLength(0);
});

test('Escape closes the sheet and nothing is sent', async ({ page, baseURL }) => {
  const app = await openCluster(page, baseURL);
  await makeNote(page, { x: 500, y: 300 }, 'Not going anywhere');
  await rightClickCard(page, 0);
  await menu(page).getByRole('menuitem', { name: 'Send to…' }).click();
  await expect(dialog(page)).toBeVisible();
  const maya = rowOf(page, /Maya Reyes/);
  await maya.click();
  await expect(maya).toHaveAttribute('aria-checked', 'true');

  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(toast(page, 'Sent to')).toHaveCount(0);
  expect(app.sent.rpc('send_board_to')).toHaveLength(0);
  expect(app.sent.messages).toHaveLength(0);
});
