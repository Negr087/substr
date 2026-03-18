import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const response = await fetch(
      'https://mp.speechmatics.com/v1/api_keys?type=rt',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.SPEECHMATICS_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: 60 }),
      }
    );

    if (!response.ok) {
      throw new Error(`Speechmatics API error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json({ jwt: data.key_value });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
