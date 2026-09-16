import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface FFEvent {
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast?: string;
  previous?: string;
  actual?: string;
}

// Strip units/commas and convert K, M, B, % to raw numbers
function parseEconValue(raw?: string): number | null {
  if (!raw || raw.trim() === '' || raw.toLowerCase() === 'n/a') return null;

  const cleaned = raw.replace(/,/g, '').trim();
  const match = cleaned.match(/^([-+]?[0-9]*\.?[0-9]+)\s*([KkMmBb%]?)/);
  if (!match) return null;

  let value = parseFloat(match[1]);
  if (isNaN(value)) return null;

  const suffix = match[2].toUpperCase();
  if (suffix === 'K') value *= 1_000;
  if (suffix === 'M') value *= 1_000_000;
  if (suffix === 'B') value *= 1_000_000_000;

  return value;
}

const INVERTED_METRICS = [
  'unemployment',
  'jobless',
  'claimant',
  'deficit',
  'inventories',
];

function formatActualWithDeviation(title: string, actualStr?: string, forecastStr?: string): string {
  if (!actualStr || actualStr.trim() === '') {
    return 'Actual: Pending';
  }

  const actualNum = parseEconValue(actualStr);
  const forecastNum = parseEconValue(forecastStr);

  if (actualNum === null || forecastNum === null) {
    return `Actual: ${actualStr}`;
  }

  const diff = actualNum - forecastNum;
  if (Math.abs(diff) < 0.0001) {
    return `Actual: ${actualStr} ⚪ In Line`;
  }

  const isInverted = INVERTED_METRICS.some(keyword => title.toLowerCase().includes(keyword));
  const isBeat = isInverted ? diff < 0 : diff > 0;

  return isBeat ? `Actual: ${actualStr} 🟢 ⬆️ Beat` : `Actual: ${actualStr} 🔴 ⬇️ Miss`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const currencies = (searchParams.get('currencies') || 'USD,GBP,JPY')
    .toUpperCase()
    .split(',');
  const impacts = (searchParams.get('impacts') || 'High,Medium')
    .split(',')
    .map(i => i.toLowerCase());
  const shouldGroup = searchParams.get('group') !== 'false';

  try {
    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    };

    // Clean URLs without query parameters to prevent CDN 403s
    const [thisWeekRes, nextWeekRes] = await Promise.all([
      fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
        headers: fetchHeaders,
        cache: 'no-store',
      }),
      fetch('https://nfs.faireconomy.media/ff_calendar_nextweek.json', {
        headers: fetchHeaders,
        cache: 'no-store',
      }),
    ]);

    if (!thisWeekRes.ok) {
      return new NextResponse('Forex Factory upstream unavailable', { status: 502 });
    }

    const thisWeek: FFEvent[] = await thisWeekRes.json();
    const nextWeek: FFEvent[] = nextWeekRes.ok ? await nextWeekRes.json() : [];
    const rawEvents = [...thisWeek, ...nextWeek];

    const filtered = rawEvents.filter(e => {
      const matchCurr = currencies.includes(e.country?.toUpperCase());
      const matchImpact = impacts.includes(e.impact?.toLowerCase());
      return matchCurr && matchImpact;
    });

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//EconCalendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Economic News',
      'X-WR-TIMEZONE:UTC',
      'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
      'X-PUBLISHED-TTL:PT15M',
    ];

    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const nowIso = fmt(new Date());

    if (shouldGroup) {
      const groups = new Map<string, { currency: string; date: Date; events: FFEvent[] }>();

      for (const ev of filtered) {
        const date = new Date(ev.date);
        if (isNaN(date.getTime())) continue;

        const groupKey = `${ev.country.toUpperCase()}_${date.getTime()}`;
        if (!groups.has(groupKey)) {
          groups.set(groupKey, { currency: ev.country.toUpperCase(), date, events: [] });
        }
        groups.get(groupKey)!.events.push(ev);
      }

      for (const [key, group] of groups.entries()) {
        const start = group.date;
        const end = new Date(start.getTime() + 5 * 60 * 1000);

        const hasHigh = group.events.some(e => e.impact.toLowerCase() === 'high');
        const icon = hasHigh ? '🔴' : '🟠';

        let summary = `${icon} [${group.currency}] ${group.events[0].title}`;
        if (group.events.length > 1) {
          summary += ` (+${group.events.length - 1} releases)`;
        }

        // PERMANENT STABLE UID: Never changes across requests
        const uid = `group-${key}@econfeed.local`;

        const descSections = group.events.map((e, idx) => {
          const impactTag = e.impact.toLowerCase() === 'high' ? '🔴 High' : '🟠 Medium';
          const actualLine = formatActualWithDeviation(e.title, e.actual, e.forecast);

          return [
            `${idx + 1}. ${e.title} [${impactTag}]`,
            `   • ${actualLine}`,
            `   • Forecast: ${e.forecast || 'N/A'} | Previous: ${e.previous || 'N/A'}`,
          ].join('\\n');
        });

        const fullDescription = descSections.join('\\n-------------------------\\n');

        // Increment SEQUENCE when actual figures arrive to signal Apple Calendar to update
        const releasedCount = group.events.filter(e => e.actual && e.actual.trim() !== '').length;

        lines.push(
          'BEGIN:VEVENT',
          `UID:${uid}`,
          `DTSTAMP:${nowIso}`,
          `LAST-MODIFIED:${nowIso}`,
          `SEQUENCE:${releasedCount}`,
          `DTSTART:${fmt(start)}`,
          `DTEND:${fmt(end)}`,
          `SUMMARY:${summary}`,
          `DESCRIPTION:${fullDescription}`,
          'TRANSP:TRANSPARENT',
          'STATUS:CONFIRMED',
          'END:VEVENT'
        );
      }
    } else {
      for (const ev of filtered) {
        const start = new Date(ev.date);
        if (isNaN(start.getTime())) continue;

        const end = new Date(start.getTime() + 5 * 60 * 1000);
        const icon = ev.impact.toLowerCase() === 'high' ? '🔴' : '🟠';
        const uid = `single-${ev.country}-${ev.title}-${start.getTime()}`.replace(/[^a-zA-Z0-9-]/g, '_');

        const actualLine = formatActualWithDeviation(ev.title, ev.actual, ev.forecast);
        const desc = [
          `Impact: ${ev.impact}`,
          `Forecast: ${ev.forecast || 'N/A'}`,
          `Previous: ${ev.previous || 'N/A'}`,
          actualLine,
        ].join('\\n');

        const hasActual = Boolean(ev.actual && ev.actual.trim() !== '');

        lines.push(
          'BEGIN:VEVENT',
          `UID:${uid}@econfeed.local`,
          `DTSTAMP:${nowIso}`,
          `LAST-MODIFIED:${nowIso}`,
          `SEQUENCE:${hasActual ? 1 : 0}`,
          `DTSTART:${fmt(start)}`,
          `DTEND:${fmt(end)}`,
          `SUMMARY:${icon} [${ev.country}] ${ev.title}`,
          `DESCRIPTION:${desc}`,
          'TRANSP:TRANSPARENT',
          'STATUS:CONFIRMED',
          'END:VEVENT'
        );
      }
    }

    lines.push('END:VCALENDAR');

    return new NextResponse(lines.join('\r\n'), {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="calendar.ics"',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      },
    });
  } catch (err) {
    return new NextResponse('Calendar feed generation error', { status: 500 });
  }
}