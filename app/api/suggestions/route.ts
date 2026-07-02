import { NextRequest, NextResponse } from 'next/server';

// This route runs on the server only — RESEND_API_KEY never reaches the
// browser. It takes a suggestion someone typed in the app and emails it
// straight to you via Resend (https://resend.com).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = (body?.message || '').toString().trim();
    const name = (body?.name || '').toString().trim().slice(0, 60);

    if (!message) {
      return NextResponse.json({ error: 'Write something before sending.' }, { status: 400 });
    }
    if (message.length > 2000) {
      return NextResponse.json(
        { error: "That's a bit long — keep it under 2000 characters." },
        { status: 400 }
      );
    }

    const apiKey = process.env.RESEND_API_KEY;
    const toEmail = process.env.SUGGESTIONS_TO_EMAIL;
    const fromEmail = process.env.SUGGESTIONS_FROM_EMAIL || 'Agora Online <onboarding@resend.dev>';

    if (!apiKey || !toEmail) {
      console.error('[suggestions] Missing RESEND_API_KEY or SUGGESTIONS_TO_EMAIL env vars.');
      return NextResponse.json(
        { error: 'Suggestions are not set up on this deployment yet.' },
        { status: 500 }
      );
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject: `Agora Online suggestion${name ? ' from ' + name : ''}`,
        text: `${message}\n\n— ${name || 'Someone using the app'}\nSent ${new Date().toLocaleString()}`,
      }),
    });

    if (!resendRes.ok) {
      const detail = await resendRes.text();
      console.error('[suggestions] Resend error:', detail);
      return NextResponse.json(
        { error: 'Could not send that just now — please try again in a moment.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[suggestions] Unexpected error:', e);
    return NextResponse.json({ error: 'Something went wrong — please try again.' }, { status: 500 });
  }
}
