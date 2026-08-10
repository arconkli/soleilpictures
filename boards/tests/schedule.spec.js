import { expect, test } from '@playwright/test';

// Schedule — the real-date calendar container card. Drives the pure bridge
// published under ?schedqa=1 (src/lib/schedQa.js) — the same schedDates /
// schedLayout math the editor uses — so we can assert the load-bearing
// behaviour (calendar-tuple date math, the slot-key grammar, month/week/day/
// hour tiling, hour-window widening, inline expand subdivision, and the graft
// key-rewrite) with zero backend.

test.describe('schedule — pure date math', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?schedqa=1');
    await page.waitForFunction(() => !!window.__soleilSchedTest);
  });

  test('parse/format round-trips and rejects impossible dates', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      return {
        ok: T.parseISO('2026-07-15'),
        badDay: T.parseISO('2026-02-30'),
        badShape: T.parseISO('2026-7-15'),
        fmt: T.formatISO(2026, 7, 5),
      };
    });
    expect(r.ok).toEqual({ y: 2026, m: 7, d: 15 });
    expect(r.badDay).toBeNull();
    expect(r.badShape).toBeNull();
    expect(r.fmt).toBe('2026-07-05');
  });

  test('leap years, month lengths, and addMonths day-clamping', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      return {
        feb26: T.daysInMonth(2026, 2), feb28: T.daysInMonth(2028, 2),
        clamp: T.addMonths('2026-01-31', 1),          // → Feb 28 (2026 not leap)
        leapClamp: T.addMonths('2028-01-31', 1),      // → Feb 29
        back: T.addMonths('2026-01-15', -2),          // year rollover backwards
        fwd: T.addMonths('2026-12-05', 1),
      };
    });
    expect(r.feb26).toBe(28);
    expect(r.feb28).toBe(29);
    expect(r.clamp).toBe('2026-02-28');
    expect(r.leapClamp).toBe('2028-02-29');
    expect(r.back).toBe('2025-11-15');
    expect(r.fwd).toBe('2027-01-05');
  });

  test('addDays crosses months/years; weeks are Monday-first', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      return {
        cross: T.addDays('2026-07-31', 1),
        year: T.addDays('2026-12-31', 1),
        backYear: T.addDays('2026-01-01', -1),
        // 2026-07-15 is a Wednesday → weekday index 2, week starts Mon 07-13
        wd: T.weekdayOf('2026-07-15'),
        sow: T.startOfWeek('2026-07-15'),
        sowOfMonday: T.startOfWeek('2026-07-13'),
        labels: T.WEEKDAYS,
      };
    });
    expect(r.cross).toBe('2026-08-01');
    expect(r.year).toBe('2027-01-01');
    expect(r.backYear).toBe('2025-12-31');
    expect(r.wd).toBe(2);
    expect(r.sow).toBe('2026-07-13');
    expect(r.sowOfMonday).toBe('2026-07-13');
    expect(r.labels[0]).toBe('Mon');
    expect(r.labels[6]).toBe('Sun');
  });

  test('titles and hour labels are deterministic English', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      return {
        month: T.monthTitle('2026-07-15'),
        day: T.dayTitle('2026-07-15'),
        week: T.weekTitle('2026-07-15'),
        weekSpan: T.weekTitle('2026-08-01'),          // Jul 27 – Aug 2 spans months
        h0: T.hourLabel(0), h9: T.hourLabel(9), h12: T.hourLabel(12), h23: T.hourLabel(23),
      };
    });
    expect(r.month).toBe('July 2026');
    expect(r.day).toBe('Wed, Jul 15, 2026');
    expect(r.week).toBe('Jul 13–19, 2026');
    expect(r.weekSpan).toBe('Jul 27 – Aug 2, 2026');
    expect(r.h0).toBe('12 AM');
    expect(r.h9).toBe('9 AM');
    expect(r.h12).toBe('12 PM');
    expect(r.h23).toBe('11 PM');
  });
});

test.describe('schedule — slot-key grammar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?schedqa=1');
    await page.waitForFunction(() => !!window.__soleilSchedTest);
  });

  test('keys build, parse, and classify correctly', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      const day = T.dayKey('2026-07-15');
      const hour = T.hourKey('2026-07-15', 9);
      const minute = T.minuteKey('2026-07-15', 9, 15);
      const item = T.mintItemKey(hour, 'abc123');
      return {
        day, hour, minute, item,
        pDay: T.parseSlotKey(day), pHour: T.parseSlotKey(hour), pMin: T.parseSlotKey(minute),
        pItem: T.parseSlotKey(item),                    // item keys are NOT slots
        pGarbage: T.parseSlotKey('c1'),                 // a grid leaf id is not a slot
        pBadHour: T.parseSlotKey('d:2026-07-15/h:25'),
        isItem: T.isItemKey(item), isNotItem: T.isItemKey(hour),
        slotOf: T.slotOfItem(item), slotOfSlot: T.slotOfItem(day),
      };
    });
    expect(r.day).toBe('d:2026-07-15');
    expect(r.hour).toBe('d:2026-07-15/h:09');
    expect(r.minute).toBe('d:2026-07-15/h:09/m:15');
    expect(r.item).toBe('d:2026-07-15/h:09/i:abc123');
    expect(r.pDay).toEqual({ kind: 'day', date: '2026-07-15' });
    expect(r.pHour).toEqual({ kind: 'hour', date: '2026-07-15', hour: 9 });
    expect(r.pMin).toEqual({ kind: 'minute', date: '2026-07-15', hour: 9, minute: 15 });
    expect(r.pItem).toBeNull();
    expect(r.pGarbage).toBeNull();
    expect(r.pBadHour).toBeNull();
    expect(r.isItem).toBe(true);
    expect(r.isNotItem).toBe(false);
    expect(r.slotOf).toBe('d:2026-07-15/h:09');
    expect(r.slotOfSlot).toBe('d:2026-07-15');
  });

  test('itemsForSlot: direct vs deep aggregation, chronological', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      const keys = [
        'd:2026-07-15/i:zz',
        'd:2026-07-15/h:14/i:b',
        'd:2026-07-15/h:09/i:a',
        'd:2026-07-15/h:09/m:15/i:m',
        'd:2026-07-16/i:other',
        'd:2026-07-15/h:09',            // a bare slot path is not an item
      ];
      return {
        direct: T.itemsForSlot('d:2026-07-15', keys),
        deep: T.itemsForSlot('d:2026-07-15', keys, { deep: true }),
        hourDirect: T.itemsForSlot('d:2026-07-15/h:09', keys),
      };
    });
    expect(r.direct).toEqual(['d:2026-07-15/i:zz']);
    expect(r.deep).toEqual([
      'd:2026-07-15/h:09/i:a',
      'd:2026-07-15/h:09/m:15/i:m',
      'd:2026-07-15/h:14/i:b',
      'd:2026-07-15/i:zz',
    ]);
    expect(r.hourDirect).toEqual(['d:2026-07-15/h:09/i:a']);
  });
});

test.describe('schedule — layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?schedqa=1');
    await page.waitForFunction(() => !!window.__soleilSchedTest);
  });

  test('month view tiles full weeks with outside days and a single today', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      // July 2026 starts on a Wednesday → 5 week rows, Jun 29/30 + Aug 1/2 outside.
      const { slots, weekdayLabels } = T.computeSchedSlots({
        view: 'month', anchor: '2026-07-15', w: 420, h: 380, todayIso: '2026-07-11',
      });
      const days = slots.filter((s) => s.kind === 'day');
      return {
        n: days.length,
        outside: days.filter((s) => s.outside).map((s) => s.date),
        today: days.filter((s) => s.isToday).map((s) => s.date),
        first: days[0], last: days[days.length - 1],
        cols: new Set(days.map((s) => Math.round(s.rect.x))).size,
        weekdayLabels,
        allInside: days.every((s) => s.rect.x >= -0.01 && s.rect.y >= -0.01
          && s.rect.x + s.rect.w <= 420.01 && s.rect.y + s.rect.h <= 380.01),
      };
    });
    expect(r.n).toBe(35);
    expect(r.outside).toEqual(['2026-06-29', '2026-06-30', '2026-08-01', '2026-08-02']);
    expect(r.today).toEqual(['2026-07-11']);
    expect(r.first.date).toBe('2026-06-29');
    expect(r.first.label).toBe('29');
    expect(r.last.date).toBe('2026-08-02');
    expect(r.cols).toBe(7);
    expect(r.weekdayLabels).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(r.allInside).toBe(true);
  });

  test('week view is one Monday-first row of 7', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      const { slots } = T.computeSchedSlots({
        view: 'week', anchor: '2026-07-15', w: 420, h: 170, todayIso: '2026-07-15',
      });
      const days = slots.filter((s) => s.kind === 'day');
      return {
        dates: days.map((s) => s.date),
        sameY: new Set(days.map((s) => Math.round(s.rect.y))).size,
        today: days.filter((s) => s.isToday).length,
        outside: days.filter((s) => s.outside).length,
      };
    });
    expect(r.dates[0]).toBe('2026-07-13');
    expect(r.dates[6]).toBe('2026-07-19');
    expect(r.sameY).toBe(1);
    expect(r.today).toBe(1);
    expect(r.outside).toBe(0);
  });

  test('day view: all-day band + default 8–18 hour window, widened by content', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      const base = T.computeSchedSlots({ view: 'day', anchor: '2026-07-15', w: 300, h: 420 });
      const widened = T.computeSchedSlots({
        view: 'day', anchor: '2026-07-15', w: 300, h: 420,
        cellKeys: ['d:2026-07-15/h:22/i:x', 'd:2026-07-15/h:03/i:y'],
      });
      const hours = (out) => out.slots.filter((s) => s.kind === 'hour').map((s) => s.hour);
      const band = base.slots.find((s) => s.kind === 'day');
      return {
        baseHours: hours(base), widenedHours: hours(widened),
        band: { key: band.key, band: band.band, label: band.label, h: band.rect.h },
        win: T.hourWindowForDay('2026-07-15', ['d:2026-07-15/h:22/i:x']),
      };
    });
    expect(r.baseHours).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(r.widenedHours[0]).toBe(3);
    expect(r.widenedHours[r.widenedHours.length - 1]).toBe(22);
    expect(r.band.key).toBe('d:2026-07-15');
    expect(r.band.band).toBe(true);
    expect(r.band.label).toBe('All day');
    expect(r.win).toEqual({ from: 8, to: 23 });
  });

  test('hour view: whole-hour band + 60/MINUTE_STEP minute rows', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      const { slots } = T.computeSchedSlots({
        view: 'hour', anchor: '2026-07-15', anchorHour: 9, w: 280, h: 300,
      });
      const minutes = slots.filter((s) => s.kind === 'minute');
      const band = slots.find((s) => s.kind === 'hour');
      return {
        n: minutes.length, keys: minutes.map((s) => s.key), labels: minutes.map((s) => s.label),
        band: { key: band.key, band: band.band },
        step: T.SCHED_TUNING.MINUTE_STEP,
      };
    });
    expect(r.n).toBe(60 / r.step);
    expect(r.keys[0]).toBe('d:2026-07-15/h:09/m:00');
    expect(r.keys[1]).toBe('d:2026-07-15/h:09/m:15');
    expect(r.labels[1]).toBe(':15');
    expect(r.band.key).toBe('d:2026-07-15/h:09');
    expect(r.band.band).toBe(true);
  });

  test('an expanded day subdivides inline into hour rows contained by its cell', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      const { slots } = T.computeSchedSlots({
        view: 'month', anchor: '2026-07-15', w: 420, h: 380, todayIso: '2026-07-11',
        expand: { 'd:2026-07-15': 'hours' },
      });
      const day = slots.find((s) => s.kind === 'day' && s.date === '2026-07-15');
      const hours = slots.filter((s) => s.kind === 'hour' && s.date === '2026-07-15');
      const contained = hours.every((s) =>
        s.rect.x >= day.rect.x - 0.01 && s.rect.y >= day.rect.y - 0.01
        && s.rect.x + s.rect.w <= day.rect.x + day.rect.w + 0.01
        && s.rect.y + s.rect.h <= day.rect.y + day.rect.h + 0.01);
      // hour rows start below the date strip
      const belowLabel = hours.every((s) => s.rect.y >= day.rect.y + T.SCHED_TUNING.DAY_LABEL_H - 0.01);
      return { expanded: day.expanded, n: hours.length, contained, belowLabel };
    });
    expect(r.expanded).toBe('hours');
    expect(r.n).toBe(10); // default 8–18 window
    expect(r.contained).toBe(true);
    expect(r.belowLabel).toBe(true);
  });

  test('an expanded hour inside an expanded day subdivides into minute rows', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      const { slots } = T.computeSchedSlots({
        view: 'month', anchor: '2026-07-15', w: 700, h: 620, todayIso: '2026-07-11',
        expand: { 'd:2026-07-15': 'hours', 'd:2026-07-15/h:09': 'minutes' },
      });
      const hour = slots.find((s) => s.kind === 'hour' && s.hour === 9);
      const minutes = slots.filter((s) => s.kind === 'minute');
      const contained = minutes.every((s) =>
        s.rect.y >= hour.rect.y - 0.01 && s.rect.y + s.rect.h <= hour.rect.y + hour.rect.h + 0.01);
      return { expanded: hour.expanded, n: minutes.length, contained };
    });
    expect(r.expanded).toBe('minutes');
    expect(r.n).toBe(4);
    expect(r.contained).toBe(true);
  });

  test('chipCapacity grows with height and floors at 0 for slivers', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      return {
        sliver: T.chipCapacity({ x: 0, y: 0, w: 60, h: 10 }, 'day'),
        small: T.chipCapacity({ x: 0, y: 0, w: 60, h: 50 }, 'day'),
        big: T.chipCapacity({ x: 0, y: 0, w: 60, h: 120 }, 'day'),
        hourRow: T.chipCapacity({ x: 0, y: 0, w: 200, h: 20 }, 'hour'),
      };
    });
    expect(r.sliver).toBe(0);
    expect(r.small).toBeGreaterThanOrEqual(1);
    expect(r.big).toBeGreaterThan(r.small);
    expect(r.hourRow).toBeGreaterThanOrEqual(1);
  });
});

test.describe('schedule — graft key-rewrite', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?schedqa=1');
    await page.waitForFunction(() => !!window.__soleilSchedTest);
  });

  test('a day card grafts onto a month day: prefixes rewritten, expansion carried', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      return T.graftKeyMap(
        {
          'd:2026-07-10/i:allday1': { type: 'text', html: '<div>call sheet</div>' },
          'd:2026-07-10/h:09/i:a': { type: 'image', src: 'r2:x' },
          'd:2026-07-10/h:09/m:15/i:m': { type: 'board', boardId: 'b1' },
        },
        { 'd:2026-07-10/h:09': 'minutes' },
        'd:2026-07-10',
        'd:2026-07-15'
      );
    });
    expect(Object.keys(r.cells).sort()).toEqual([
      'd:2026-07-15/h:09/i:a',
      'd:2026-07-15/h:09/m:15/i:m',
      'd:2026-07-15/i:allday1',
    ]);
    expect(r.cells['d:2026-07-15/h:09/i:a']).toEqual({ type: 'image', src: 'r2:x' });
    expect(r.expand).toEqual({ 'd:2026-07-15/h:09': 'minutes' });
    expect(r.strays).toEqual([]);
  });

  test('an hour card grafts onto an hour slot', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      return T.graftKeyMap(
        { 'd:2026-07-10/h:14/m:30/i:x': { type: 'text', html: '<div>pickup</div>' } },
        {},
        'd:2026-07-10/h:14',
        'd:2026-07-15/h:09'
      );
    });
    expect(Object.keys(r.cells)).toEqual(['d:2026-07-15/h:09/m:30/i:x']);
    expect(r.strays).toEqual([]);
  });

  test('content outside the source prefix is reported as strays (graft must refuse)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      return T.graftKeyMap(
        {
          'd:2026-07-10/h:09/i:a': { type: 'image', src: 'r2:x' },
          'd:2026-07-11/i:elsewhere': { type: 'text', html: '<div>other day</div>' },
        },
        {},
        'd:2026-07-10',
        'd:2026-07-15'
      );
    });
    expect(r.strays).toEqual(['d:2026-07-11/i:elsewhere']);
  });
});

test.describe('schedule — summary reads', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?schedqa=1');
    await page.waitForFunction(() => !!window.__soleilSchedTest);
  });

  test('schedItems flattens chronologically; schedLegacyRows synthesizes day/what/loc', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      const cells = {
        'd:2026-07-16/h:09/i:b': { type: 'board', boardId: 'b1', name: 'Locations' },
        'd:2026-07-15/i:a': { type: 'text', html: '<div>Call sheet</div>' },
        'd:2026-07-16/h:09/m:15/i:c': { type: 'link', title: 'Permits', source: 'https://x.com' },
        'd:2026-07-17/i:ghost': { type: 'empty' },
        'd:2026-07-18': { type: 'text', html: 'not an item key' },
      };
      const items = T.schedItems(cells);
      return { items, rows: T.schedLegacyRows(items) };
    });
    expect(r.items.map((i) => i.key)).toEqual([
      'd:2026-07-15/i:a',
      'd:2026-07-16/h:09/i:b',
      'd:2026-07-16/h:09/m:15/i:c',
    ]);
    expect(r.rows).toEqual([
      { day: 'Jul 15', what: 'Call sheet', loc: '' },
      { day: 'Jul 16', what: 'Locations', loc: '9 AM' },
      { day: 'Jul 16', what: 'Permits', loc: '9:15 AM' },
    ]);
  });
});

test.describe('schedule — demo-cap weight parity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?schedqa=1');
    await page.waitForFunction(() => !!window.__soleilSchedTest);
  });

  test('a schedule weighs its filled items; a legacy rows card weighs 1', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      return {
        legacy: T.cardWeight('schedule'),
        empty: T.cardWeight('schedule', {}),
        filled: T.cardWeight('schedule', {
          'd:2026-07-15/i:a': { type: 'image', src: 'r2:1' },
          'd:2026-07-15/h:09/i:b': { type: 'board', boardId: 'b1' },
          'd:2026-07-16/i:c': { type: 'empty' },
        }),
      };
    });
    expect(r.legacy).toBe(1);
    expect(r.empty).toBe(1);
    expect(r.filled).toBe(2);
  });
});

test.describe('schedule — weekend flag + month matrix (peek/date-jump foundations)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?schedqa=1');
    await page.waitForFunction(() => !!window.__soleilSchedTest);
  });

  test('month/week day slots carry a weekend flag for Sat/Sun only', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      const month = T.computeSchedSlots({
        view: 'month', anchor: '2026-07-15', w: 420, h: 380, todayIso: '2026-07-11',
      }).slots.filter((s) => s.kind === 'day');
      const week = T.computeSchedSlots({
        view: 'week', anchor: '2026-07-15', w: 420, h: 170, todayIso: '2026-07-15',
      }).slots.filter((s) => s.kind === 'day');
      const day = T.computeSchedSlots({ view: 'day', anchor: '2026-07-18', w: 300, h: 420 });
      return {
        monthWeekend: month.filter((s) => s.weekend).map((s) => s.date),
        weekWeekend: week.filter((s) => s.weekend).map((s) => s.date),
        bandWeekend: !!day.slots.find((s) => s.kind === 'day').weekend,
      };
    });
    // July 2026 grid runs Mon 06-29 … Sun 08-02: ten Sat/Sun cells.
    expect(r.monthWeekend).toEqual([
      '2026-07-04', '2026-07-05', '2026-07-11', '2026-07-12', '2026-07-18',
      '2026-07-19', '2026-07-25', '2026-07-26', '2026-08-01', '2026-08-02',
    ]);
    expect(r.weekWeekend).toEqual(['2026-07-18', '2026-07-19']);
    expect(r.bandWeekend).toBe(false);
  });

  test('monthMatrix tiles full Monday-first weeks matching computeSchedSlots', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      const cells = T.monthMatrix('2026-07-15');
      const slots = T.computeSchedSlots({
        view: 'month', anchor: '2026-07-15', w: 420, h: 380, todayIso: '2026-07-11',
      }).slots.filter((s) => s.kind === 'day');
      return {
        n: cells.length,
        first: cells[0], last: cells[cells.length - 1],
        outside: cells.filter((c) => c.outside).map((c) => c.date),
        sameOrder: cells.every((c, i) => c.date === slots[i].date && !!c.outside === !!slots[i].outside),
      };
    });
    expect(r.n).toBe(35);
    expect(r.n % 7).toBe(0);
    expect(r.first).toEqual({ date: '2026-06-29', outside: true });
    expect(r.last).toEqual({ date: '2026-08-02', outside: true });
    expect(r.outside).toEqual(['2026-06-29', '2026-06-30', '2026-08-01', '2026-08-02']);
    expect(r.sameOrder).toBe(true);
  });

  test('monthMatrix handles a leap February', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      const cells = T.monthMatrix('2028-02-10');
      return {
        n: cells.length,
        first: cells[0].date, last: cells[cells.length - 1].date,
        outsideN: cells.filter((c) => c.outside).length,
        has29: cells.some((c) => c.date === '2028-02-29' && !c.outside),
      };
    });
    // Feb 2028: Feb 1 is a Tuesday → grid Mon 01-31 … Sun 03-05 (35 cells, 6 outside).
    expect(r.n).toBe(35);
    expect(r.first).toBe('2028-01-31');
    expect(r.last).toBe('2028-03-05');
    expect(r.outsideN).toBe(6);
    expect(r.has29).toBe(true);
  });

  test('SCHED_TUNING carries the peek panel + LOD constants', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      const { PEEK_W, PEEK_ROW_H, PEEK_MINUTE_ROW_H, PEEK_MAX_H,
              ROW_CHIP_H, LOD_NUM_PX, LOD_DOT_PX, LOD_COUNT_PX, LOD_TITLE_PX } = T.SCHED_TUNING;
      return { PEEK_W, PEEK_ROW_H, PEEK_MINUTE_ROW_H, PEEK_MAX_H,
               ROW_CHIP_H, LOD_NUM_PX, LOD_DOT_PX, LOD_COUNT_PX, LOD_TITLE_PX };
    });
    expect(r).toEqual({
      PEEK_W: 380, PEEK_ROW_H: 48, PEEK_MINUTE_ROW_H: 60, PEEK_MAX_H: 560,
      ROW_CHIP_H: 22, LOD_NUM_PX: 13, LOD_DOT_PX: 4, LOD_COUNT_PX: 10, LOD_TITLE_PX: 13,
    });
  });
});

test.describe('schedule — LOD tiers + day counts (zoomed-out foundations)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?schedqa=1');
    await page.waitForFunction(() => !!window.__soleilSchedTest);
  });

  test('schedLodTier picks full/mid/far per view from on-screen size', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      const t = (view, w, h, scale) => T.schedLodTier({ view, w, h, scale });
      return {
        // Default month card 420×380 — full at zoom 1, mid at 0.6, far at 0.3.
        monthFull: t('month', 420, 380, 1),
        monthMid: t('month', 420, 380, 0.6),
        monthFar: t('month', 420, 380, 0.3),
        // Default week card is deliberately short (420×170) — must stay FULL at zoom 1.
        weekFull: t('week', 420, 170, 1),
        weekMid: t('week', 420, 170, 0.55),
        weekFar: t('week', 420, 170, 0.3),
        dayFull: t('day', 300, 420, 1),
        hourFull: t('hour', 280, 300, 1),
        // Threshold edges are inclusive-full / inclusive-mid (strict < demotes).
        monthEdgeFull: t('month', 330, 240, 1),
        monthJustMid: t('month', 329, 240, 1),
        monthEdgeMid: t('month', 150, 240, 1),
        monthJustFar: t('month', 149, 240, 1),
      };
    });
    expect(r.monthFull).toBe('full');
    expect(r.monthMid).toBe('mid');
    expect(r.monthFar).toBe('far');
    expect(r.weekFull).toBe('full');
    expect(r.weekMid).toBe('mid');
    expect(r.weekFar).toBe('far');
    expect(r.dayFull).toBe('full');
    expect(r.hourFull).toBe('full');
    expect(r.monthEdgeFull).toBe('full');
    expect(r.monthJustMid).toBe('mid');
    expect(r.monthEdgeMid).toBe('mid');
    expect(r.monthJustFar).toBe('far');
  });

  test('schedDayCounts groups valid items by date at any depth', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      return T.schedDayCounts({
        'd:2026-07-15/i:a': { type: 'text', html: 'call sheet' },
        'd:2026-07-15/h:09/i:b': { type: 'board', boardId: 'b1' },
        'd:2026-07-15/h:09/m:15/i:c': { type: 'link', source: 'https://x' },
        'd:2026-07-16/i:d': { type: 'empty' },              // tombstone — excluded
        'd:2026-07-17/i:e': { type: 'image' },               // src-less image — excluded
        'd:2026-07-18/i:f': { type: 'image', src: 'r2:ok' },
      });
    });
    expect(r).toEqual({ '2026-07-15': 3, '2026-07-18': 1 });
  });

  test('chipCapacity accepts an opt-in chip height (2-arg callers unchanged)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilSchedTest;
      const rect = { x: 0, y: 0, w: 200, h: 70 };
      return {
        def: T.chipCapacity(rect, 'hour'),
        tall: T.chipCapacity(rect, 'hour', { chipH: T.SCHED_TUNING.ROW_CHIP_H }),
      };
    });
    expect(r.def).toBe(3);   // 18px chips
    expect(r.tall).toBe(2);  // 22px chips fit fewer
  });
});
