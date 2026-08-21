import { NextResponse } from 'next/server';
import hostAuth from '@/lib/host-auth.cjs';

export async function POST(request) {
  const { username, password } = await request.json();
  if (!process.env.HOST_USERNAME || !process.env.HOST_PASSWORD || !process.env.SESSION_SECRET) {
    return NextResponse.json({ error: 'Host login has not been configured.' }, { status: 503 });
  }
  if (username !== process.env.HOST_USERNAME || password !== process.env.HOST_PASSWORD) {
    return NextResponse.json({ error: 'Incorrect username or password.' }, { status: 401 });
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set(hostAuth.COOKIE_NAME, hostAuth.createSession(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 12 });
  return response;
}
