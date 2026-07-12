// DEV-only Schedule QA bridge (see localMode.isSchedQaMode). Pure calendar
// date math + slot-key grammar + layout + graft helpers, published on
// window.__soleilSchedTest by main.jsx under ?schedqa=1 so the Playwright spec
// (tests/schedule.spec.js) can assert the load-bearing behaviour — real-date
// month/week/day/hour tiling, hour-window widening, inline expand subdivision,
// and the graft key-rewrite — with no backend. Mirrors lib/gridQa.js.
import {
  MONTHS, MONTHS_SHORT, WEEKDAYS, pad2, daysInMonth, parseISO, formatISO,
  todayISO, weekdayOf, firstWeekdayOfMonth, addDays, addMonths, startOfWeek,
  isToday, monthTitle, weekTitle, dayTitle, hourLabel, hourTitle, monthMatrix,
} from './schedDates.js';
import {
  SCHED_TUNING, dayKey, hourKey, minuteKey, isItemKey, slotOfItem, mintItemKey,
  newUid, parseSlotKey, itemsForSlot, hourWindowForDay, computeSchedSlots,
  chipCapacity, graftKeyMap, schedItems, schedLegacyRows,
} from './schedLayout.js';
import { isCellFilled, cellsWeight, cardWeight } from './gridCount.js';

export function makeSchedTestBridge() {
  return {
    MONTHS, MONTHS_SHORT, WEEKDAYS, pad2, daysInMonth, parseISO, formatISO,
    todayISO, weekdayOf, firstWeekdayOfMonth, addDays, addMonths, startOfWeek,
    isToday, monthTitle, weekTitle, dayTitle, hourLabel, hourTitle, monthMatrix,
    SCHED_TUNING, dayKey, hourKey, minuteKey, isItemKey, slotOfItem, mintItemKey,
    newUid, parseSlotKey, itemsForSlot, hourWindowForDay, computeSchedSlots,
    chipCapacity, graftKeyMap, schedItems, schedLegacyRows,
    isCellFilled, cellsWeight, cardWeight,
  };
}
