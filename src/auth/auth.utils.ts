import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

function base64Url(input: Buffer | string) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function getSecret() {
  return process.env.AUTH_TOKEN_SECRET || 'invoicepro-local-dev-secret-change-before-production';
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [salt, hash] = storedHash.split(':');

  if (!salt || !hash) {
    return false;
  }

  const suppliedHash = scryptSync(password, salt, 64);
  const storedHashBuffer = Buffer.from(hash, 'hex');

  if (storedHashBuffer.length !== suppliedHash.length) {
    return false;
  }

  return timingSafeEqual(storedHashBuffer, suppliedHash);
}

export type AuthTokenPayload = {
  sub: string;
  email: string;
  iat: number;
  exp: number;
};

export function signAuthToken(payload: Pick<AuthTokenPayload, 'sub' | 'email'>) {
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload: AuthTokenPayload = {
    ...payload,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };

  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64Url(JSON.stringify(tokenPayload));
  const signature = base64Url(
    createHmac('sha256', getSecret()).update(`${header}.${body}`).digest(),
  );

  return `${header}.${body}.${signature}`;
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  const [header, body, signature] = token.split('.');

  if (!header || !body || !signature) {
    return null;
  }

  const expectedSignature = base64Url(
    createHmac('sha256', getSecret()).update(`${header}.${body}`).digest(),
  );

  if (signature !== expectedSignature) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(body)) as AuthTokenPayload;

    if (!payload.sub || !payload.email || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
