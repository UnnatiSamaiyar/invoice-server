import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, signAuthToken, verifyPassword } from './auth.utils';

type SignupInput = {
  companyName?: string;
  name?: string;
  email?: string;
  password?: string;
};

type LoginInput = {
  email?: string;
  password?: string;
};

type GoogleStartInput = {
  mode?: string;
  companyName?: string;
};

type GoogleCallbackInput = {
  code?: string;
  state?: string;
  error?: string;
};

type GoogleStatePayload = {
  mode: 'login' | 'signup';
  companyName?: string | null;
  issuedAt: number;
};

type GoogleUserInfo = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  hd?: string;
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_SCOPES = ['openid', 'email', 'profile'];
const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async signup(input: SignupInput = {}) {
    const companyName = input.companyName?.trim();
    const email = input.email?.trim().toLowerCase();
    const password = input.password || '';
    const name = input.name?.trim() || null;

    if (!companyName || companyName.length < 2) {
      throw new BadRequestException('Company name is required');
    }

    if (!email || !emailRegex.test(email)) {
      throw new BadRequestException('Valid work email is required');
    }

    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const existingUser = await (this.prisma as any).user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('An account with this email already exists');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await (tx as any).user.create({
        data: {
          name,
          email,
          passwordHash: hashPassword(password),
          authProvider: 'EMAIL',
          emailVerified: false,
        },
      });

      const company = await this.createDefaultCompany(tx, companyName, email);

      await (tx as any).companyMember.create({
        data: {
          userId: user.id,
          companyId: company.id,
          role: 'OWNER',
        },
      });

      return { user, company };
    });

    return this.buildAuthResponse(result.user, result.company, 'OWNER');
  }

  async login(input: LoginInput = {}) {
    const email = input.email?.trim().toLowerCase();
    const password = input.password || '';

    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    const user = await (this.prisma as any).user.findUnique({
      where: { email },
      include: {
        memberships: {
          include: { company: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });

    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const membership = user.memberships[0];

    if (!membership) {
      throw new UnauthorizedException('No company is linked with this account');
    }

    return this.buildAuthResponse(user, membership.company, membership.role);
  }

  getGoogleAuthUrl(input: GoogleStartInput = {}) {
    const config = this.getGoogleConfig();
    const mode = input.mode === 'signup' ? 'signup' : 'login';
    const companyName = input.companyName?.trim() || null;

    if (mode === 'signup' && (!companyName || companyName.length < 2)) {
      throw new BadRequestException('Company name is required before Google signup');
    }

    const state = this.signGoogleState({
      mode,
      companyName,
      issuedAt: Date.now(),
    });

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'select_account',
      state,
    });

    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async handleGoogleCallback(input: GoogleCallbackInput = {}) {
    if (input.error) {
      throw new UnauthorizedException(`Google sign-in cancelled: ${input.error}`);
    }

    if (!input.code || !input.state) {
      throw new BadRequestException('Google authorization code or state is missing');
    }

    const state = this.verifyGoogleState(input.state);
    const config = this.getGoogleConfig();
    const tokenPayload = await this.exchangeGoogleCode(input.code, config);
    const accessToken = tokenPayload.access_token;

    if (!accessToken) {
      throw new UnauthorizedException('Google did not return an access token');
    }

    const googleUser = await this.fetchGoogleUserInfo(accessToken);

    if (!googleUser.sub || !googleUser.email || !emailRegex.test(googleUser.email)) {
      throw new UnauthorizedException('Google account did not return a valid email');
    }

    if (googleUser.email_verified === false) {
      throw new UnauthorizedException('Google email is not verified');
    }

    const normalizedEmail = googleUser.email.trim().toLowerCase();
    const result = await this.findOrCreateGoogleUser(googleUser, normalizedEmail, state);
    return this.buildAuthResponse(result.user, result.company, result.role);
  }

  getFrontendGoogleCallbackUrl(response: { token: string; company: { isOnboarded?: boolean } }) {
    const frontendUrl = this.getFrontendUrl();
    const params = new URLSearchParams({
      token: response.token,
      onboarded: String(Boolean(response.company?.isOnboarded)),
    });
    return `${frontendUrl}/auth/google/callback?${params.toString()}`;
  }

  getFrontendGoogleErrorUrl(message: string) {
    const frontendUrl = this.getFrontendUrl();
    const params = new URLSearchParams({ error: message });
    return `${frontendUrl}/auth/google/callback?${params.toString()}`;
  }

  async me(userId: string) {
    const user = await (this.prisma as any).user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          include: { company: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const membership = user.memberships[0];

    return {
      user: this.serializeUser(user),
      company: membership ? this.serializeCompany(membership.company) : null,
      role: membership?.role || null,
    };
  }

  private async findOrCreateGoogleUser(
    googleUser: GoogleUserInfo,
    normalizedEmail: string,
    state: GoogleStatePayload,
  ) {
    const userByGoogleId = await (this.prisma as any).user.findUnique({
      where: { googleId: googleUser.sub },
      include: {
        memberships: {
          include: { company: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });

    if (userByGoogleId) {
      const membership = userByGoogleId.memberships[0];
      if (!membership) throw new UnauthorizedException('No company is linked with this Google account');
      return { user: userByGoogleId, company: membership.company, role: membership.role };
    }

    const userByEmail = await (this.prisma as any).user.findUnique({
      where: { email: normalizedEmail },
      include: {
        memberships: {
          include: { company: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });

    if (userByEmail) {
      if (userByEmail.googleId && userByEmail.googleId !== googleUser.sub) {
        throw new ConflictException('This email is already linked with another Google account');
      }

      const linkedUser = await (this.prisma as any).user.update({
        where: { id: userByEmail.id },
        data: {
          googleId: googleUser.sub,
          emailVerified: true,
          name: userByEmail.name || googleUser.name || null,
          avatarDataUrl: userByEmail.avatarDataUrl || googleUser.picture || null,
        },
        include: {
          memberships: {
            include: { company: true },
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
        },
      });

      const membership = linkedUser.memberships[0];
      if (!membership) throw new UnauthorizedException('No company is linked with this Google account');
      return { user: linkedUser, company: membership.company, role: membership.role };
    }

    const companyName = this.inferGoogleCompanyName(state.companyName, googleUser);
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await (tx as any).user.create({
        data: {
          name: googleUser.name || null,
          email: normalizedEmail,
          googleId: googleUser.sub,
          authProvider: 'GOOGLE',
          emailVerified: true,
          avatarDataUrl: googleUser.picture || null,
          passwordHash: hashPassword(randomBytes(24).toString('hex')),
        },
      });

      const company = await this.createDefaultCompany(tx, companyName, normalizedEmail);

      await (tx as any).companyMember.create({
        data: {
          userId: user.id,
          companyId: company.id,
          role: 'OWNER',
        },
      });

      return { user, company };
    });

    return { user: result.user, company: result.company, role: 'OWNER' };
  }

  private async createDefaultCompany(tx: any, companyName: string, email: string) {
    return (tx as any).company.create({
      data: {
        name: companyName,
        legalName: companyName,
        workEmail: email,
        country: 'India',
        currency: 'INR',
        invoicePrefix: 'INV-',
        invoiceStartingNumber: 1001,
        defaultPaymentTerms: 'Net 30',
        defaultInvoiceTitle: 'INVOICE',
        showBankDetailsOnInvoice: true,
        showQrCodeOnInvoice: true,
        defaultInvoiceFooter:
          'Thank you for your business. Please include the invoice number in your payment reference.',
      },
    });
  }

  private async exchangeGoogleCode(code: string, config: ReturnType<AuthService['getGoogleConfig']>) {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.callbackUrl,
        grant_type: 'authorization_code',
      }),
    });

    const payload = (await response.json()) as Record<string, any>;
    if (!response.ok) {
      throw new UnauthorizedException(payload.error_description || payload.error || 'Google token exchange failed');
    }

    return payload;
  }

  private async fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const payload = (await response.json()) as GoogleUserInfo & { error?: string; error_description?: string };
    if (!response.ok) {
      throw new UnauthorizedException(payload.error_description || payload.error || 'Unable to read Google profile');
    }

    return payload;
  }

  private getGoogleConfig() {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    const callbackUrl =
      process.env.GOOGLE_CALLBACK_URL?.trim() || `${process.env.BACKEND_URL || 'http://localhost:4000'}/auth/google/callback`;

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException('Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
    }

    return { clientId, clientSecret, callbackUrl };
  }

  private getFrontendUrl() {
    return (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  }

  private signGoogleState(payload: GoogleStatePayload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.getGoogleStateSecret()).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  private verifyGoogleState(state: string): GoogleStatePayload {
    const [body, signature] = state.split('.');
    if (!body || !signature) throw new UnauthorizedException('Invalid Google sign-in state');

    const expectedSignature = createHmac('sha256', this.getGoogleStateSecret()).update(body).digest('base64url');
    const supplied = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);

    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new UnauthorizedException('Invalid Google sign-in state');
    }

    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as GoogleStatePayload;
      if (!['login', 'signup'].includes(payload.mode)) throw new Error('Invalid mode');
      if (!payload.issuedAt || Date.now() - payload.issuedAt > GOOGLE_STATE_TTL_MS) {
        throw new Error('Expired state');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Expired or invalid Google sign-in state');
    }
  }

  private getGoogleStateSecret() {
    return `${process.env.AUTH_TOKEN_SECRET || 'invoicepro-local-dev-secret-change-before-production'}:google-oauth-state`;
  }

  private inferGoogleCompanyName(companyName: string | null | undefined, googleUser: GoogleUserInfo) {
    if (companyName && companyName.trim().length >= 2) return companyName.trim();

    const domain = googleUser.hd || googleUser.email.split('@')[1] || '';
    const domainName = domain.split('.')[0]?.replace(/[-_]/g, ' ').trim();
    if (domainName) return this.toTitleCase(domainName);

    if (googleUser.name) return `${googleUser.name}'s Company`;
    return 'My Company';
  }

  private toTitleCase(value: string) {
    return value
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  private buildAuthResponse(user: any, company: any, role: string) {
    return {
      token: signAuthToken({ sub: user.id, email: user.email }),
      user: this.serializeUser(user),
      company: this.serializeCompany(company),
      role,
    };
  }

  private serializeUser(user: any) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatarDataUrl: user.avatarDataUrl,
      timezone: user.timezone || 'Asia/Kolkata',
      language: user.language || 'en',
      emailNotifications: Boolean(user.emailNotifications),
      securityNotifications: Boolean(user.securityNotifications),
      authProvider: user.authProvider || 'EMAIL',
      emailVerified: Boolean(user.emailVerified),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private serializeCompany(company: any) {
    return {
      id: company.id,
      name: company.name,
      legalName: company.legalName,
      country: company.country,
      currency: company.currency,
      businessType: company.businessType,
      workEmail: company.workEmail,
      phone: company.phone,
      website: company.website,
      addressLine1: company.addressLine1,
      addressLine2: company.addressLine2,
      city: company.city,
      state: company.state,
      postalCode: company.postalCode,
      taxRegion: company.taxRegion,
      taxNumber: company.taxNumber,
      registrationNumber: company.registrationNumber,
      defaultInvoiceTitle: company.defaultInvoiceTitle,
      defaultPaymentTerms: company.defaultPaymentTerms,
      defaultTermsAndConditions: company.defaultTermsAndConditions,
      footerNote: company.footerNote,
      bankName: company.bankName,
      accountHolderName: company.accountHolderName,
      bankAccountNumber: company.bankAccountNumber,
      bankIfscOrSwift: company.bankIfscOrSwift,
      upiId: company.upiId,
      paymentNote: company.paymentNote,
      showBankDetailsOnInvoice: Boolean(company.showBankDetailsOnInvoice),
      showQrCodeOnInvoice: Boolean(company.showQrCodeOnInvoice),
      invoicePrefix: company.invoicePrefix,
      invoiceStartingNumber: company.invoiceStartingNumber,
      manualInvoiceNumberEnabled: Boolean(company.manualInvoiceNumberEnabled),
      logoDataUrl: company.logoDataUrl,
      signatureDataUrl: company.signatureDataUrl,
      qrCodeDataUrl: company.qrCodeDataUrl,
      isOnboarded: company.isOnboarded,
    };
  }
}
