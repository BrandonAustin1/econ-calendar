import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface FFEvent {
  title: string;
  country: string;
  date: string; // ISO 8601 string
  impact: string;
  forecast?: string;
  previous?: string;
  actual?: string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const currencies = (searchParams.get('currencies') || 'USD,GBP,JPY')
    .toUpperCase()
    .split(',');
  const impacts = (searchParams.get('impacts') || 'High,Medium')
    .split(',')
    .map(i => i.toLowerCase());
  const shouldGroup = searchParams.get('group') !== 'false'; // Default to true

  try {
    const [thisWeekRes, nextWeekRes] = await Promise.all([
      fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { next: { revalidate: 300 } }),
      fetch('https://nfs.faireconomy.media/ff_calendar_nextweek.json', { next: { revalidate: 1800 } }),
    ]);

    const thisWeek: FFEvent[] = thisWeekRes.ok ? await thisWeekRes.json() : [];
    const nextWeek: FFEvent[] = nextWeekRes.ok ? await nextWeekRes.json() : [];
    const rawEvents = [...thisWeek, ...nextWeek];

    // 1. Filter by currency and impact
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

    if (shouldGroup) {
      // 2. Group by Currency + Timestamp bucket
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

      // 3. Build single calendar event per group
      for (const [key, group] of groups.entries()) {
        const start = group.date;
        const end = new Date(start.getTime() + 5 * 60 * 1000); // 5-min duration

        // Red icon takes precedence if any event in the cluster is High impact
        const hasHigh = group.events.some(e => e.impact.toLowerCase() === 'high');
        const icon = hasHigh ? '🔴' : '🟠';

        // Scannable iOS title: "🔴 [USD] CPI m/m (+2 releases)" or just single event title
        let summary = `${icon} [${group.currency}] ${group.events[0].title}`;
        if (group.events.length > 1) {
          summary += ` (+${group.events.length - 1} releases)`;
        }

        // Persistent UID for iOS sync updates
        const uid = `group-${key}@econfeed.local`;

        // Format multi-release description
        const descSections = group.events.map((e, idx) => {
          const impactTag = e.impact.toLowerCase() === 'high' ? '🔴 High' : '🟠 Medium';
          const actualText = e.actual ? `Actual: ${e.actual}` : 'Actual: Pending';
          return [
            `${idx + 1}. ${e.title} [${impactTag}]`,
            `   • ${actualText}`,
            `   • Forecast: ${e.forecast || 'N/A'} | Previous: ${e.previous || 'N/A'}`,
          ].join('\\n');
        });

        const fullDescription = descSections.join('\\n-------------------------\\n');

        lines.push(
          'BEGIN:VEVENT',
          `UID:${uid}`,
          `DTSTAMP:${fmt(new Date())}`,
          `DTSTART:${fmt(start)}`,
          `DTEND:${fmt(end)}`,
          `SUMMARY:${summary}`,
          `DESCRIPTION:${fullDescription}`,
          'TRANSP:TRANSPARENT', // Free availability
          'STATUS:CONFIRMED',
          'END:VEVENT'
        );
      }
    } else {
      // Individual events fallback
      for (const ev of filtered) {
        const start = new Date(ev.date);
        if (isNaN(start.getTime())) continue;

        const end = new Date(start.getTime() + 5 * 60 * 1000);
        const icon = ev.impact.toLowerCase() === 'high' ? '🔴' : '🟠';
        const uid = `single-${ev.country}-${ev.title}-${start.getTime()}`.replace(/[^a-zA-Z0-9]/g, '_');

        const desc = [
          `Impact: ${ev.impact}`,
          `Forecast: ${ev.forecast || 'N/A'}`,
          `Previous: ${ev.previous || 'N/A'}`,
          ev.actual ? `Actual: ${ev.actual}` : 'Actual: Pending',
        ].join('\\n');

        lines.push(
          'BEGIN:VEVENT',
          `UID:${uid}@econfeed.local`,
          `DTSTAMP:${fmt(new Date())}`,
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
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch {
    return new NextResponse('Calendar feed generation error', { status: 500 });
  }
}