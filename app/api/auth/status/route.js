import { NextResponse } from 'next/server';
import hostAuth from '@/lib/host-auth.cjs';

export async function GET(request) {
  return NextResponse.json({ authenticated: hostAuth.isAuthorizedCookie(request.headers.get('cookie')) });
}
