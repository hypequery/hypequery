import crypto from 'crypto';
import { cookies } from 'next/headers';

export const CMS_SESSION_COOKIE = 'hq-cms-session';

function getCmsPassword() {
  return process.env.CMS_ADMIN_PASSWORD ?? '';
}

function getCmsSecret() {
  return process.env.CMS_SESSION_SECRET ?? getCmsPassword();
}

function createSessionValue() {
  return crypto
    .createHash('sha256')
    .update(`${getCmsPassword()}:${getCmsSecret()}`)
    .digest('hex');
}

function timingSafeMatch(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function isCmsConfigured() {
  return getCmsPassword().length > 0;
}

export function validateCmsPassword(password: string) {
  const configuredPassword = getCmsPassword();
  if (!configuredPassword) {
    return false;
  }

  return timingSafeMatch(password, configuredPassword);
}

export async function isCmsAuthenticated() {
  const cookieStore = await cookies();
  const session = cookieStore.get(CMS_SESSION_COOKIE)?.value;

  if (!session || !isCmsConfigured()) {
    return false;
  }

  return timingSafeMatch(session, createSessionValue());
}

export async function createCmsSession() {
  const cookieStore = await cookies();
  cookieStore.set(CMS_SESSION_COOKIE, createSessionValue(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 14,
  });
}

export async function clearCmsSession() {
  const cookieStore = await cookies();
  cookieStore.delete(CMS_SESSION_COOKIE);
}
