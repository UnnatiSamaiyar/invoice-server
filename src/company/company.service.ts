import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const allowedCompanyFields = [
  'name',
  'legalName',
  'manualInvoiceNumberEnabled',
  'showQrCodeOnInvoice',
  'showBankDetailsOnInvoice',
  'paymentNote',
  'upiId',
  'accountHolderName',
  'footerNote',
  'defaultTermsAndConditions',
  'defaultPaymentTerms',
  'defaultInvoiceTitle',
  'registrationNumber',
  'businessType',
  'workEmail',
  'phone',
  'website',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'country',
  'currency',
  'taxRegion',
  'taxNumber',
  'bankName',
  'bankAccountNumber',
  'bankIfscOrSwift',
  'invoicePrefix',
  'invoiceStartingNumber',
  'defaultInvoiceFooter',
  'logoDataUrl',
  'signatureDataUrl',
  'qrCodeDataUrl',
  'isOnboarded',
] as const;

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyCompany(userId: string) {
    const membership = await this.findMembership(userId);
    return this.serializeCompany(membership.company, membership.role);
  }

  async updateMyCompany(userId: string, body: Record<string, unknown> = {}) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Invalid company payload');
    }

    const membership = await this.findMembership(userId);
    const data: Record<string, unknown> = {};

    for (const field of allowedCompanyFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        data[field] = this.normalizeField(field, body[field]);
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No company fields were provided');
    }

    if (typeof data.name === 'string' && data.name.trim().length < 2) {
      throw new BadRequestException('Company name must be at least 2 characters');
    }

    const updatedCompany = await (this.prisma as any).company.update({
      where: { id: membership.companyId },
      data,
    });

    return this.serializeCompany(updatedCompany, membership.role);
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

  private normalizeField(field: string, value: unknown) {
    if (value === undefined) {
      return undefined;
    }

    if (field === 'invoiceStartingNumber') {
      const numberValue = Number(value);
      return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : 1001;
    }

    if (['isOnboarded', 'showBankDetailsOnInvoice', 'showQrCodeOnInvoice', 'manualInvoiceNumberEnabled'].includes(field)) {
      return Boolean(value);
    }

    if (field === 'defaultInvoiceTitle') {
      const title = String(value || 'INVOICE').trim().toUpperCase();
      return ['INVOICE', 'TAX_INVOICE', 'BILL'].includes(title) ? title : 'INVOICE';
    }

    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  private serializeCompany(company: any, role: string) {
    return {
      id: company.id,
      name: company.name,
      legalName: company.legalName,
      businessType: company.businessType,
      registrationNumber: company.registrationNumber,
      defaultInvoiceTitle: company.defaultInvoiceTitle,
      defaultPaymentTerms: company.defaultPaymentTerms,
      defaultTermsAndConditions: company.defaultTermsAndConditions,
      footerNote: company.footerNote,
      accountHolderName: company.accountHolderName,
      upiId: company.upiId,
      paymentNote: company.paymentNote,
      showBankDetailsOnInvoice: Boolean(company.showBankDetailsOnInvoice),
      showQrCodeOnInvoice: Boolean(company.showQrCodeOnInvoice),
      manualInvoiceNumberEnabled: Boolean(company.manualInvoiceNumberEnabled),
      workEmail: company.workEmail,
      phone: company.phone,
      website: company.website,
      addressLine1: company.addressLine1,
      addressLine2: company.addressLine2,
      city: company.city,
      state: company.state,
      postalCode: company.postalCode,
      country: company.country,
      currency: company.currency,
      taxRegion: company.taxRegion,
      taxNumber: company.taxNumber,
      bankName: company.bankName,
      bankAccountNumber: company.bankAccountNumber,
      bankIfscOrSwift: company.bankIfscOrSwift,
      invoicePrefix: company.invoicePrefix,
      invoiceStartingNumber: company.invoiceStartingNumber,
      defaultInvoiceFooter: company.defaultInvoiceFooter,
      logoDataUrl: company.logoDataUrl,
      signatureDataUrl: company.signatureDataUrl,
      qrCodeDataUrl: company.qrCodeDataUrl,
      isOnboarded: company.isOnboarded,
      role,
      updatedAt: company.updatedAt,
    };
  }
}
