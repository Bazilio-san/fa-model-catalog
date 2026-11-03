function partsAt(time, timezone) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(time)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  );
}

function localTime(year, month, day, hour, timezone) {
  const target = Date.UTC(year, month - 1, day, hour);
  let time = target;
  for (let i = 0; i < 4; i++) {
    const p = partsAt(time, timezone);
    const shift = target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    if (!shift) {
      break;
    }
    time += shift;
  }
  return time;
}

export function nextRefreshTime({
  now = Date.now(),
  timezone = 'Europe/Moscow',
  random = Math.random,
  afterWindow = null,
} = {}) {
  const p = partsAt(now, timezone);
  for (let offset = 0; offset < 3; offset++) {
    const date = new Date(Date.UTC(p.year, p.month - 1, p.day + offset));
    for (const hour of [1, 13]) {
      const center = localTime(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, timezone);
      const windowId = center;
      if ((afterWindow !== null && windowId <= afterWindow) || center + 1200000 <= now) {
        continue;
      }
      const draw = random();
      if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
        throw new Error('The random number source must return a number between zero and one.');
      }
      const time = center - 1200000 + Math.floor(draw * 2400001);
      if (time > now) {
        return { time, windowId };
      }
    }
  }
  throw new Error('Could not select a refresh time.');
}
