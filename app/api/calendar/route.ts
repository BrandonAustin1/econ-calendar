import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface FinnhubEvent {
  actual?: number | null;
  prev?: number | null;
  estimate?: number | null;
  country: string;
  event: string;
  impact: string;
  time: string; // e.g. "2026-09-16 07:00:00"
  unit?: string;
}

interface NormalizedEvent {
  title: string;
  currency: string;
  date: Date;
  impact: 'High' | 'Medium' | 'Low';
  forecast?: number | null;
  previous?: number | null;
  actual?: number | null;
  unit?: string;
}

const COUNTRY_TO_CURRENCY: Record<string, string> = {
  US: 'USD',
  GB: 'GBP',
  UK: 'GBP',
  JP: 'JPY',
  EU: 'EUR',
  EZ: 'EUR',
  DE: 'EUR',
  FR: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  AU: 'AUD',
  CA: 'CAD',
  CH: 'CHF',
  NZ: 'NZD',
};

const INVERTED_METRICS = [
  'unemployment',
  'jobless',
  'claimant',
  'deficit',
  'inventories',
];

function formatActualWithDeviation(
  title: string,
  actual?: number | null,
  forecast?: number | null,
  unit?: string,
  eventDate?: Date
): string {
  const unitStr = unit || '';

  // Handle qualitative/speech events with no numerical data
  if (actual == null && forecast == null) {
    if (eventDate && Date.now() > eventDate.getTime() + 30 * 60 * 1000) {
      return 'Status: Completed';
    }
    return 'Status: Scheduled';
  }

  if (actual == null) {
    if (eventDate && Date.now() > eventDate.getTime()) {
      return 'Actual: Awaiting Release';
    }
    return 'Actual: Pending';
  }

  const actualDisplay = `${actual}${unitStr}`;

  if (forecast == null) {
    return `Actual: ${actualDisplay}`;
  }

  const diff = actual - forecast;
  if (Math.abs(diff) < 0.0001) {
    return `Actual: ${actualDisplay} ⚪ In Line`;
  }

  const isInverted = INVERTED_METRICS.some(keyword => title.toLowerCase().includes(keyword));
  const isBeat = isInverted ? diff < 0 : diff > 0;

  return isBeat ? `Actual: ${actualDisplay} 🟢 ⬆️ Beat` : `Actual: ${actualDisplay} 🔴 ⬇️ Miss`;
}

function parseFinnhubTime(timeStr: string): Date {
  if (!timeStr) return new Date(NaN);
  const iso = timeStr.includes('T') ? timeStr : timeStr.replace(' ', 'T');
  return new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return new NextResponse('FINNHUB_API_KEY is not configured in environment variables.', { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const currencies = (searchParams.get('currencies') || 'USD,GBP,JPY')
    .toUpperCase()
    .split(',');
  const impacts = (searchParams.get('impacts') || 'High,Medium')
    .split(',')
    .map(i => i.toLowerCase());
  const shouldGroup = searchParams.get('group') !== 'false';

  // Rolling window: 7 days in the past through 10 days in the future
  const now = new Date();
  const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const future = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

  const fromStr = past.toISOString().split('T')[0];
  const toStr = future.toISOString().split('T')[0];

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/calendar/economic?from=${fromStr}&to=${toStr}&token=${apiKey}`,
      { cache: 'no-store' }
    );

    if (!res.ok) {
      return new NextResponse(`Finnhub error: ${res.statusText}`, { status: res.status });
    }

    const data = await res.json();
    const rawEvents: FinnhubEvent[] = data.economicCalendar || [];

    const normalizedEvents: NormalizedEvent[] = rawEvents
      .map(e => {
        let impact: 'High' | 'Medium' | 'Low' = 'Low';
        const rawImp = (e.impact || '').toLowerCase();
        if (rawImp === 'high') impact = 'High';
        else if (rawImp === 'med' || rawImp === 'medium') impact = 'Medium';

        const curr = COUNTRY_TO_CURRENCY[e.country?.toUpperCase()] || e.country?.toUpperCase() || '';
        const date = parseFinnhubTime(e.time);

        return {
          title: e.event,
          currency: curr,
          date,
          impact,
          forecast: e.estimate,
          previous: e.prev,
          actual: e.actual,
          unit: e.unit,
        };
      })
      .filter(e => {
        const matchCurr = currencies.includes(e.currency);
        const matchImpact = impacts.includes(e.impact.toLowerCase());
        const validDate = !isNaN(e.date.getTime());
        return matchCurr && matchImpact && validDate;
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
      const groups = new Map<string, { currency: string; date: Date; events: NormalizedEvent[] }>();

      for (const ev of normalizedEvents) {
        const groupKey = `${ev.currency}_${ev.date.getTime()}`;
        if (!groups.has(groupKey)) {
          groups.set(groupKey, { currency: ev.currency, date: ev.date, events: [] });
        }
        groups.get(groupKey)!.events.push(ev);
      }

      for (const [key, group] of groups.entries()) {
        const start = group.date;
        const end = new Date(start.getTime() + 5 * 60 * 1000);

        const hasHigh = group.events.some(e => e.impact === 'High');
        const icon = hasHigh ? '🔴' : '🟠';

        let summary = `${icon} [${group.currency}] ${group.events[0].title}`;
        if (group.events.length > 1) {
          summary += ` (+${group.events.length - 1} releases)`;
        }

        const uid = `fh-group-${key}@econfeed.local`;

        const descSections = group.events.map((e, idx) => {
          const impactTag = e.impact === 'High' ? '🔴 High' : '🟠 Medium';
          const actualLine = formatActualWithDeviation(e.title, e.actual, e.forecast, e.unit, e.date);
          const fcast = e.forecast != null ? `${e.forecast}${e.unit || ''}` : 'N/A';
          const prev = e.previous != null ? `${e.previous}${e.unit || ''}` : 'N/A';

          return [
            `${idx + 1}. ${e.title} [${impactTag}]`,
            `   • ${actualLine}`,
            `   • Forecast: ${fcast} | Previous: ${prev}`,
          ].join('\\n');
        });

        const fullDescription = descSections.join('\\n-------------------------\\n');
        const hasActual = group.events.some(e => e.actual != null);

        lines.push(
          'BEGIN:VEVENT',
          `UID:${uid}`,
          `DTSTAMP:${nowIso}`,
          `LAST-MODIFIED:${nowIso}`,
          `SEQUENCE:${hasActual ? 1 : 0}`,
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
      for (const ev of normalizedEvents) {
        const start = ev.date;
        const end = new Date(start.getTime() + 5 * 60 * 1000);
        const icon = ev.impact === 'High' ? '🔴' : '🟠';
        const uid = `fh-single-${ev.currency}-${ev.title.toLowerCase().replace(/[^a-z0-9]/g, '')}-${start.getTime()}@econfeed.local`;

        const actualLine = formatActualWithDeviation(ev.title, ev.actual, ev.forecast, ev.unit, ev.date);
        const fcast = ev.forecast != null ? `${ev.forecast}${ev.unit || ''}` : 'N/A';
        const prev = ev.previous != null ? `${ev.previous}${ev.unit || ''}` : 'N/A';

        const desc = [
          `Impact: ${ev.impact}`,
          `Currency: ${ev.currency}`,
          `Forecast: ${fcast}`,
          `Previous: ${prev}`,
          actualLine,
        ].join('\\n');

        lines.push(
          'BEGIN:VEVENT',
          `UID:${uid}`,
          `DTSTAMP:${nowIso}`,
          `LAST-MODIFIED:${nowIso}`,
          `SEQUENCE:${ev.actual != null ? 1 : 0}`,
          `DTSTART:${fmt(start)}`,
          `DTEND:${fmt(end)}`,
          `SUMMARY:${icon} [${ev.currency}] ${ev.title}`,
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
    return new NextResponse('Error generating Finnhub calendar feed', { status: 500 });
  }
}