/* Datas no fuso do bar (Europe/Lisbon), independentemente do fuso do servidor (o Render corre em UTC). */
const TZ = 'Europe/Lisbon';

/** Hora atual do servidor. Os testes podem trocar `clock.now` para fixar o momento. */
const clock = { now: () => Date.now() };

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const partsOf = (ms) => Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));

/** "2026-11-05" do dia em Lisboa no instante `ms`. */
function lisbonDateKey(ms = clock.now()) {
  const p = partsOf(ms);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Instante (ms) de um dia "2026-11-05" e hora "12:30" em Lisboa. */
function lisbonEpoch(key, hhmm) {
  const guess = Date.parse(`${key}T${hhmm}:00Z`);
  const p = partsOf(guess);
  const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return guess - (shown - guess);   // desfaz o desvio de Lisboa face a UTC (0 ou +1 h)
}

const toMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

module.exports = { clock, lisbonDateKey, lisbonEpoch, toMinutes };
