/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('node:crypto');

const COOKIE_NAME = 'hotspot_host_session';

function secret() {
  return process.env.SESSION_SECRET || '';
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

function createSession() {
  const value = `host.${Date.now()}`;
  return `${value}.${sign(value)}`;
}

function isValidSession(value) {
  if (!secret() || !value) return false;
  const lastDot = value.lastIndexOf('.');
  if (lastDot < 1) return false;
  const payload = value.slice(0, lastDot);
  const signature = value.slice(lastDot + 1);
  const expected = sign(payload);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function getCookie(cookieHeader) {
  return cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
}

function isAuthorizedCookie(cookieHeader) {
  return isValidSession(getCookie(cookieHeader));
}

module.exports = { COOKIE_NAME, createSession, isAuthorizedCookie };
