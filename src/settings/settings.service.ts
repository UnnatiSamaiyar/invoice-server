import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, verifyPassword } from '../auth/auth.utils';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^[0-9+\-\s()]{6,20}$/;
const dataImageRegex = /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/i;

const companyFields = [
  'name',
  'legalName',
  'businessType',
  'country',
  'currency',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'workEmail',
  'phone',
  'website',
  'registrationNumber',
  'taxNumber',
  'taxRegion',
  'defaultInvoiceTitle',
  'defaultPaymentTerms',
  'defaultTermsAndConditions',
  'defaultInvoiceFooter',
  'footerNote',
  'bankName',
  'accountHolderName',
  'bankAccountNumber',
  'bankIfscOrSwift',
  'upiId',
  'paymentNote',
  'showBankDetailsOnInvoice',
  'showQrCodeOnInvoice',
  'invoicePrefix',
  'invoiceStartingNumber',
  'manualInvoiceNumberEnabled',
  'logoDataUrl',
  'signatureDataUrl',
  'qrCodeDataUrl',
] as const;

const profileFields = [
  'name',
  'email',
  'phone',
  'avatarDataUrl',
  'timezone',
  'language',
  'emailNotifications',
  'securityNotifications',
] as const;

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(userId: string) {
    const membership = await this.getMembership(userId);
    const nextInvoiceNumber = await this.getNextInvoiceNumberPreview(membership.companyId, membership.company);

    return {
      profile: this.serializeUser(membership.user),
      company: this.serializeCompany(membership.company, membership.role),
      permissions: this.permissionsForRole(membership.role),
      invoiceNumbering: {
        prefix: membership.company.invoicePrefix,
        startingNumber: membership.company.invoiceStartingNumber,
        nextInvoiceNumber,
        manualInvoiceNumberEnabled: Boolean(membership.company.manualInvoiceNumberEnabled),
      },
    };
  }

  async updateProfile(userId: string, body: Record<string, unknown> = {}) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Invalid profile payload');
    }

    const membership = await this.getMembership(userId);
    const data: Record<string, unknown> = {};

    for (const field of profileFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        data[field] = this.normalizeProfileField(field, body[field]);
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No profile fields were provided');
    }

    if (typeof data.email === 'string') {
      const existingUser = await (this.prisma as any).user.findUnique({ where: { email: data.email } });
      if (existingUser && existingUser.id !== userId) {
        throw new ConflictException('This email is already used by another account');
      }
    }

    const user = await (this.prisma as any).user.update({ where: { id: userId }, data });
    return {
      profile: this.serializeUser(user),
      company: this.serializeCompany(membership.company, membership.role),
      permissions: this.permissionsForRole(membership.role),
    };
  }

  async updateCompany(userId: string, body: Record<string, unknown> = {}) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Invalid company settings payload');
    }

    const membership = await this.getMembership(userId);
    this.assertCompanyManager(membership.role);

    const data: Record<string, unknown> = {};
    for (const field of companyFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        data[field] = this.normalizeCompanyField(field, body[field]);
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No company settings fields were provided');
    }

    if (typeof data.name === 'string' && data.name.trim().length < 2) {
      throw new BadRequestException('Company name is required');
    }

    if (typeof data.workEmail === 'string' && data.workEmail && !emailRegex.test(data.workEmail)) {
      throw new BadRequestException('Valid company email is required');
    }

    if (typeof data.phone === 'string' && data.phone && !phoneRegex.test(data.phone)) {
      throw new BadRequestException('Valid company phone number is required');
    }

    const company = await (this.prisma as any).company.update({ where: { id: membership.companyId }, data });

    const templateData: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(data, 'showBankDetailsOnInvoice')) templateData.showBankDetails = data.showBankDetailsOnInvoice;
    if (Object.prototype.hasOwnProperty.call(data, 'showQrCodeOnInvoice')) templateData.showQrCode = data.showQrCodeOnInvoice;
    if (Object.prototype.hasOwnProperty.call(data, 'defaultInvoiceTitle')) templateData.documentTitle = data.defaultInvoiceTitle;

    if (Object.keys(templateData).length) {
      await (this.prisma as any).invoiceTemplateSetting.upsert({
        where: { companyId: membership.companyId },
        create: { companyId: membership.companyId, ...templateData },
        update: templateData,
      });
    }

    const nextInvoiceNumber = await this.getNextInvoiceNumberPreview(membership.companyId, company);

    return {
      profile: this.serializeUser(membership.user),
      company: this.serializeCompany(company, membership.role),
      permissions: this.permissionsForRole(membership.role),
      invoiceNumbering: {
        prefix: company.invoicePrefix,
        startingNumber: company.invoiceStartingNumber,
        nextInvoiceNumber,
        manualInvoiceNumberEnabled: Boolean(company.manualInvoiceNumberEnabled),
      },
    };
  }

  async changePassword(userId: string, body: Record<string, unknown> = {}) {
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    const confirmPassword = String(body.confirmPassword || '');

    if (!currentPassword || !newPassword || !confirmPassword) {
      throw new BadRequestException('Current password, new password and confirmation are required');
    }

    if (newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }

    if (newPassword !== confirmPassword) {
      throw new BadRequestException('New password and confirmation do not match');
    }

    const user = await (this.prisma as any).user.findUnique({ where: { id: userId } });
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    await (this.prisma as any).user.update({
      where: { id: userId },
      data: { passwordHash: hashPassword(newPassword) },
    });

    return { message: 'Password updated successfully' };
  }

  async removeAsset(userId: string, assetType: string) {
    const membership = await this.getMembership(userId);

    const fieldMap: Record<string, string> = {
      logo: 'logoDataUrl',
      signature: 'signatureDataUrl',
      qr: 'qrCodeDataUrl',
      qrcode: 'qrCodeDataUrl',
      avatar: 'avatarDataUrl',
    };
    const field = fieldMap[assetType.toLowerCase()];
    if (!field) {
      throw new BadRequestException('Unsupported asset type');
    }

    if (field === 'avatarDataUrl') {
      const user = await (this.prisma as any).user.update({ where: { id: userId }, data: { avatarDataUrl: null } });
      return { profile: this.serializeUser(user), message: 'Profile photo removed' };
    }

    this.assertCompanyManager(membership.role);
    const company = await (this.prisma as any).company.update({ where: { id: membership.companyId }, data: { [field]: null } });
    return { company: this.serializeCompany(company, membership.role), message: 'Asset removed' };
  }

  async resetInvoiceNumbering(userId: string, body: Record<string, unknown> = {}) {
    const membership = await this.getMembership(userId);
    this.assertCompanyManager(membership.role);

    const confirmText = String(body.confirmText || '');
    if (confirmText !== 'RESET') {
      throw new BadRequestException('Type RESET to confirm invoice numbering reset');
    }

    const invoicePrefix = this.normalizeCompanyField('invoicePrefix', body.invoicePrefix ?? membership.company.invoicePrefix) as string;
    const invoiceStartingNumber = this.normalizeCompanyField('invoiceStartingNumber', body.invoiceStartingNumber ?? 1001) as number;

    const duplicateNumber = `${invoicePrefix}${invoiceStartingNumber}`;
    const existing = await (this.prisma as any).invoice.findFirst({
      where: { companyId: membership.companyId, invoiceNumber: duplicateNumber },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(`Invoice number ${duplicateNumber} already exists. Choose another starting number.`);
    }

    const company = await (this.prisma as any).company.update({
      where: { id: membership.companyId },
      data: { invoicePrefix, invoiceStartingNumber },
    });

    return {
      company: this.serializeCompany(company, membership.role),
      invoiceNumbering: {
        prefix: company.invoicePrefix,
        startingNumber: company.invoiceStartingNumber,
        nextInvoiceNumber: await this.getNextInvoiceNumberPreview(membership.companyId, company),
        manualInvoiceNumberEnabled: Boolean(company.manualInvoiceNumberEnabled),
      },
      message: 'Invoice numbering updated',
    };
  }

  private async getMembership(userId: string) {
    const membership = await (this.prisma as any).companyMember.findFirst({
      where: { userId },
      include: { user: true, company: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!membership) {
      throw new NotFoundException('Company not found for this user');
    }

    return membership;
  }

  private assertCompanyManager(role: string) {
    if (!['OWNER', 'ADMIN'].includes(role)) {
      throw new ForbiddenException('Only Owner/Admin can update company settings');
    }
  }

  private permissionsForRole(role: string) {
    const companyManager = ['OWNER', 'ADMIN'].includes(role);
    return {
      role,
      canManageProfile: true,
      canManageCompany: companyManager,
      canManagePayment: companyManager,
      canManageInvoiceNumbering: companyManager,
      canManageBranding: companyManager,
      canManageSecurity: true,
      canLogout: true,
    };
  }

  private normalizeProfileField(field: string, value: unknown) {
    if (['emailNotifications', 'securityNotifications'].includes(field)) return Boolean(value);
    if (field === 'email') {
      const email = String(value || '').trim().toLowerCase();
      if (!email || !emailRegex.test(email)) throw new BadRequestException('Valid email is required');
      return email;
    }
    if (field === 'phone') {
      const phone = String(value || '').trim();
      if (phone && !phoneRegex.test(phone)) throw new BadRequestException('Valid phone number is required');
      return phone || null;
    }
    if (field === 'avatarDataUrl') {
      const image = String(value || '').trim();
      if (image && !dataImageRegex.test(image)) throw new BadRequestException('Profile photo must be a valid image data URL');
      return image || null;
    }
    const trimmed = String(value || '').trim();
    return trimmed || null;
  }

  private normalizeCompanyField(field: string, value: unknown) {
    if (['showBankDetailsOnInvoice', 'showQrCodeOnInvoice', 'manualInvoiceNumberEnabled'].includes(field)) return Boolean(value);
    if (field === 'invoiceStartingNumber') {
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue) || numberValue <= 0) throw new BadRequestException('Starting invoice number must be numeric');
      return Math.floor(numberValue);
    }
    if (field === 'invoicePrefix') {
      const prefix = String(value || '').trim().toUpperCase();
      if (!prefix) throw new BadRequestException('Invoice prefix cannot be empty');
      return prefix;
    }
    if (field === 'defaultInvoiceTitle') {
      const title = String(value || 'INVOICE').trim().toUpperCase();
      if (!['INVOICE', 'TAX_INVOICE', 'BILL'].includes(title)) throw new BadRequestException('Invalid invoice title');
      return title;
    }
    if (['logoDataUrl', 'signatureDataUrl', 'qrCodeDataUrl'].includes(field)) {
      const image = String(value || '').trim();
      if (image && !dataImageRegex.test(image)) throw new BadRequestException('Uploaded asset must be a valid image file');
      return image || null;
    }
    if (field === 'workEmail') {
      const email = String(value || '').trim().toLowerCase();
      if (email && !emailRegex.test(email)) throw new BadRequestException('Valid company email is required');
      return email || null;
    }
    if (field === 'phone') {
      const phone = String(value || '').trim();
      if (phone && !phoneRegex.test(phone)) throw new BadRequestException('Valid company phone number is required');
      return phone || null;
    }
    const trimmed = String(value ?? '').trim();
    return trimmed || null;
  }

  private async getNextInvoiceNumberPreview(companyId: string, company: any) {
    const invoices = await (this.prisma as any).invoice.findMany({
      where: { companyId, invoiceNumber: { startsWith: company.invoicePrefix || 'INV-' } },
      select: { invoiceNumber: true },
      take: 500,
    });

    const prefix = company.invoicePrefix || 'INV-';
    const highest = invoices.reduce((max: number, invoice: { invoiceNumber: string }) => {
      const numericPart = invoice.invoiceNumber.replace(prefix, '').replace(/\D/g, '');
      const parsed = Number(numericPart);
      return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
    }, Number(company.invoiceStartingNumber || 1001) - 1);

    return `${prefix}${highest + 1}`;
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

  private serializeCompany(company: any, role: string) {
    return {
      id: company.id,
      name: company.name,
      legalName: company.legalName,
      businessType: company.businessType,
      country: company.country,
      currency: company.currency,
      addressLine1: company.addressLine1,
      addressLine2: company.addressLine2,
      city: company.city,
      state: company.state,
      postalCode: company.postalCode,
      workEmail: company.workEmail,
      phone: company.phone,
      website: company.website,
      registrationNumber: company.registrationNumber,
      taxRegion: company.taxRegion,
      taxNumber: company.taxNumber,
      defaultInvoiceTitle: company.defaultInvoiceTitle,
      defaultPaymentTerms: company.defaultPaymentTerms,
      defaultTermsAndConditions: company.defaultTermsAndConditions,
      defaultInvoiceFooter: company.defaultInvoiceFooter,
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
      role,
      updatedAt: company.updatedAt,
    };
  }
}
