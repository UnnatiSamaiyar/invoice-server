import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
        },
      });

      const company = await (tx as any).company.create({
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

    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const membership = user.memberships[0];

    if (!membership) {
      throw new UnauthorizedException('No company is linked with this account');
    }

    return this.buildAuthResponse(user, membership.company, membership.role);
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
