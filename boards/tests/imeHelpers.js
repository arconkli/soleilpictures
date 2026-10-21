// Korean typing over CDP, for any field: Chromium's own IME path driven the
// way a Korean keyboard drives it. A syllable is built jamo by jamo (ㅎ, 하, 한)
// with Input.imeSetComposition and lands when Input.insertText commits it; an
// Enter pressed with a syllable still in the IME is the keydown Chrome on
// macOS sends there (isComposing, keyCode 229), then the IME's commit. A real
// Enter after that is the user's next one. Chromium only.

const LEADS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
// What the IME shows on the way to a syllable: 한 is ㅎ, 하, 한. Not Hangul: [].
export function stages(ch) {
  const c = ch.charCodeAt(0) - 0xac00;
  if (c < 0 || c > 11171) return [];
  const open = String.fromCharCode(0xac00 + c - (c % 28));
  return [LEADS[Math.floor(c / 588)], ...(open !== ch ? [open] : []), ch];
}

export async function korean(page) {
  const cdp = await page.context().newCDPSession(page);
  const compose = async (ch) => {
    for (const s of stages(ch)) {
      await cdp.send('Input.imeSetComposition', { text: s, selectionStart: s.length, selectionEnd: s.length });
    }
  };
  const commit = (text) => cdp.send('Input.insertText', { text });
  // Each syllable composed, then committed; anything else goes in as it is.
  const type = async (text) => {
    for (const ch of text) {
      if (stages(ch).length) await compose(ch);
      await commit(ch);
    }
  };
  // `text` typed with its last syllable left in the IME, then Enter pressed
  // there: the keydown Chrome sends mid-syllable, and the IME's commit.
  const typeThenEnterMidSyllable = async (text) => {
    const chars = [...text];
    const last = chars.pop();
    await type(chars.join(''));
    await compose(last);
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229,
    });
    await commit(last);
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    });
  };
  return { type, typeThenEnterMidSyllable };
}
