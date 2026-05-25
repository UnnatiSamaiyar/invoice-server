//@ts-nocheck
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const templateStyles = ['CLASSIC', 'MODERN', 'PREMIUM'] as const;
const documentTitles = ['INVOICE', 'TAX_INVOICE', 'BILL'] as const;

const defaultSettings = {
  templateStyle: 'CLASSIC',
  documentTitle: 'INVOICE',
  brandColor: '#0B57D0',
  showLogo: true,
  showSignature: false,
  showQrCode: true,
  showBankDetails: true,
};

@Injectable()
export class InvoiceTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(userId: string) {
    const membership = await this.findMembership(userId);
    const settings = await this.getOrCreateSettings(membership.companyId);
    return this.serializeSettings(settings);
  }

  async updateSettings(userId: string, body: Record<string, unknown> = {}) {
    const membership = await this.findMembership(userId);
    const data = this.normalizePayload(body);

    const settings = await (this.prisma as any).invoiceTemplateSetting.upsert({
      where: { companyId: membership.companyId },
      create: {
        companyId: membership.companyId,
        ...defaultSettings,
        ...data,
      },
      update: data,
    });

    return this.serializeSettings(settings);
  }

  async getDefaultSettingsForCompany(companyId: string) {
    const settings = await this.getOrCreateSettings(companyId);
    return this.serializeSettings(settings);
  }

  private async getOrCreateSettings(companyId: string) {
    const existing = await (this.prisma as any).invoiceTemplateSetting.findUnique({
      where: { companyId },
    });

    if (existing) return existing;

    return (this.prisma as any).invoiceTemplateSetting.create({
      data: {
        companyId,
        ...defaultSettings,
      },
    });
  }

  private normalizePayload(body: Record<string, unknown>) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Invalid template settings payload');
    }

    const data: Record<string, unknown> = {};

    if (Object.prototype.hasOwnProperty.call(body, 'templateStyle')) {
      data.templateStyle = this.normalizeEnum(body.templateStyle, templateStyles, 'Template style');
    }

    if (Object.prototype.hasOwnProperty.call(body, 'documentTitle')) {
      data.documentTitle = this.normalizeEnum(body.documentTitle, documentTitles, 'Document title');
    }

    if (Object.prototype.hasOwnProperty.call(body, 'brandColor')) {
      data.brandColor = this.normalizeBrandColor(body.brandColor);
    }

    for (const field of ['showLogo', 'showSignature', 'showQrCode', 'showBankDetails']) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        data[field] = Boolean(body[field]);
      }
    }

    if (!Object.keys(data).length) {
      throw new BadRequestException('No template settings were provided');
    }

    return data;
  }

  private normalizeEnum(value: unknown, allowed: readonly string[], label: string) {
    const normalized = String(value || '').trim().toUpperCase();
    if (!allowed.includes(normalized)) {
      throw new BadRequestException(`${label} must be one of: ${allowed.join(', ')}`);
    }
    return normalized;
  }

  private normalizeBrandColor(value: unknown) {
    const color = String(value || '').trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
      throw new BadRequestException('Brand color must be a valid hex color, for example #0B57D0');
    }
    return color.toUpperCase();
  }

  private async findMembership(userId: string) {
    const membership = await (this.prisma as any).companyMember.findFirst({
      where: { userId },
      include: { company: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!membership) {
      throw new NotFoundException('Company not found for this user');
    }

    return membership;
  }

  private serializeSettings(settings: any) {
    return {
      id: settings.id,
      companyId: settings.companyId,
      templateStyle: settings.templateStyle || defaultSettings.templateStyle,
      documentTitle: settings.documentTitle || defaultSettings.documentTitle,
      brandColor: settings.brandColor || defaultSettings.brandColor,
      showLogo: settings.showLogo ?? defaultSettings.showLogo,
      showSignature: settings.showSignature ?? defaultSettings.showSignature,
      showQrCode: settings.showQrCode ?? defaultSettings.showQrCode,
      showBankDetails: settings.showBankDetails ?? defaultSettings.showBankDetails,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }
}
