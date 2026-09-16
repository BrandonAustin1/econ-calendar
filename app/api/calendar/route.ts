import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface FFEvent {
  title: string;
  country: string;
  date: string; // ISO format e.g. 2026-09-16T08:30:00-04:00
  impact: string;
  forecast?: string;
  previous?: string;
  actual?: string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // Defaults configured for USD, GBP, JPY and High + Medium folders
  const currencies = (searchParams.get('currencies') || 'USD,GBP,JPY')
    .toUpperCase()
    .split(',');
  const impacts = (searchParams.get('impacts') || 'High,Medium')
    .split(',')
    .map(i => i.toLowerCase());

  try {
    const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      next: { revalidate: 300 }, // Cache upstream data for 5 minutes
    });

    if (!res.ok) {
      return new NextResponse('Failed to fetch economic calendar data', { status: 502 });
    }

    const events: FFEvent[] = await res.json();

    const filtered = events.filter(e => {
      const matchCurrency = currencies.includes(e.country?.toUpperCase());
      const matchImpact = impacts.includes(e.impact?.toLowerCase());
      return matchCurrency && matchImpact;
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

    for (const ev of filtered) {
      const start = new Date(ev.date);
      if (isNaN(start.getTime())) continue;

      // 5-minute event duration
      const end = new Date(start.getTime() + 5 * 60 * 1000);
      const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

      const icon = ev.impact.toLowerCase() === 'high' ? '🔴' : '🟠';
      const uid = `ff-${ev.country}-${ev.title}-${start.getTime()}`.replace(/[^a-zA-Z0-9]/g, '_');

      // Description contains actual (when released), forecast, and prior figures
      const desc = [
        `Impact: ${ev.impact}`,
        `Currency: ${ev.country}`,
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
        'TRANSP:TRANSPARENT', // Marks calendar slot as Free
        'STATUS:CONFIRMED',
        'END:VEVENT'
      );
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
