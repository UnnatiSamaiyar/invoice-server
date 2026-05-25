//@ts-nocheck
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type InvoiceStatusValue =
  | 'DRAFT'
  | 'FINALIZED'
  | 'SENT'
  | 'PAID'
  | 'PARTIALLY_PAID'
  | 'OVERDUE'
  | 'CANCELLED';

type DiscountTypeValue = 'AMOUNT' | 'PERCENT';
type PaymentModeValue = 'CASH' | 'BANK_TRANSFER' | 'UPI' | 'CARD' | 'CHEQUE' | 'ONLINE' | 'OTHER';
type TaxCalculationModeValue = 'EXCLUSIVE' | 'INCLUSIVE';
type TaxApplicationLevelValue = 'ITEM_LEVEL' | 'INVOICE_LEVEL';
type InvoiceTemplateStyleValue = 'CLASSIC' | 'MODERN' | 'PREMIUM';
type InvoiceDocumentTitleValue = 'INVOICE' | 'TAX_INVOICE' | 'BILL';

type InvoiceLinePayload = {
  productItemId?: string | null;
  taxProfileId?: string | null;
  itemName?: string;
  description?: string;
  hsnSacSku?: string;
  unit?: string;
  quantity?: number | string;
  rate?: number | string;
  discountType?: DiscountTypeValue;
  discountValue?: number | string;
  taxRate?: number | string;
  isInterState?: boolean;
};

type PaymentPayload = {
  amountReceived?: number | string;
  paymentDate?: string;
  paymentMode?: PaymentModeValue;
  referenceNumber?: string;
  notes?: string;
};

type InvoicePayload = {
  clientId?: string | null;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string | null;
  status?: InvoiceStatusValue;
  currency?: string;
  notes?: string;
  terms?: string;
  discountType?: DiscountTypeValue;
  discountValue?: number | string;
  taxCalculationMode?: TaxCalculationModeValue;
  taxApplicationLevel?: TaxApplicationLevelValue;
  invoiceLevelTaxProfileId?: string | null;
  isInterState?: boolean;
  templateStyle?: InvoiceTemplateStyleValue;
  documentTitle?: InvoiceDocumentTitleValue;
  brandColor?: string;
  showLogo?: boolean;
  showSignature?: boolean;
  showQrCode?: boolean;
  showBankDetails?: boolean;
  items?: InvoiceLinePayload[];
};

type InvoiceQuery = {
  search?: string;
  status?: string;
};

const invoiceStatuses: InvoiceStatusValue[] = [
  'DRAFT',
  'FINALIZED',
  'SENT',
  'PAID',
  'PARTIALLY_PAID',
  'OVERDUE',
  'CANCELLED',
];

const discountTypes: DiscountTypeValue[] = ['AMOUNT', 'PERCENT'];
const paymentModes: PaymentModeValue[] = ['CASH', 'BANK_TRANSFER', 'UPI', 'CARD', 'CHEQUE', 'ONLINE', 'OTHER'];
const taxCalculationModes: TaxCalculationModeValue[] = ['EXCLUSIVE', 'INCLUSIVE'];
const taxApplicationLevels: TaxApplicationLevelValue[] = ['ITEM_LEVEL', 'INVOICE_LEVEL'];
const invoiceTemplateStyles: InvoiceTemplateStyleValue[] = ['CLASSIC', 'MODERN', 'PREMIUM'];
const invoiceDocumentTitles: InvoiceDocumentTitleValue[] = ['INVOICE', 'TAX_INVOICE', 'BILL'];

const defaultTemplateSettings = {
  templateStyle: 'CLASSIC' as InvoiceTemplateStyleValue,
  documentTitle: 'INVOICE' as InvoiceDocumentTitleValue,
  brandColor: '#0B57D0',
  showLogo: true,
  showSignature: false,
  showQrCode: true,
  showBankDetails: true,
};

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async listInvoices(userId: string, query: InvoiceQuery = {}) {
    const membership = await this.findMembership(userId);
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const requestedStatus = typeof query.status === 'string' ? query.status.toUpperCase() : '';

    const where: Record<string, unknown> = {
      companyId: membership.companyId,
    };

    if (invoiceStatuses.includes(requestedStatus as InvoiceStatusValue)) {
      where.status = requestedStatus;
    }

    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { client: { companyName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [invoices, counts, totalGrandTotal, unpaidGrandTotal] = await this.prisma.$transaction([
      (this.prisma as any).invoice.findMany({
        where,
        include: {
          client: true,
          lineItems: { orderBy: { lineNo: 'asc' } },
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 50,
      }),
      (this.prisma as any).invoice.groupBy({
        by: ['status'],
        where: { companyId: membership.companyId },
        _count: { _all: true },
      }),
      (this.prisma as any).invoice.aggregate({
        where: { companyId: membership.companyId },
        _sum: { grandTotal: true },
      }),
      (this.prisma as any).invoice.aggregate({
        where: {
          companyId: membership.companyId,
          status: { in: ['FINALIZED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
        },
        _sum: { amountDue: true },
      }),
    ]);

    const statusCounts = invoiceStatuses.reduce<Record<string, number>>((acc, status) => {
      acc[status] = 0;
      return acc;
    }, {});

    for (const row of counts as Array<{ status: string; _count: { _all: number } }>) {
      statusCounts[row.status] = row._count._all;
    }

    return {
      invoices: invoices.map((invoice: any) => this.serializeInvoice(invoice)),
      summary: {
        totalCount: Object.values(statusCounts).reduce((sum, count) => sum + count, 0),
        draftCount: statusCounts.DRAFT,
        finalizedCount: statusCounts.FINALIZED,
        sentCount: statusCounts.SENT,
        paidCount: statusCounts.PAID,
        partiallyPaidCount: statusCounts.PARTIALLY_PAID,
        overdueCount: statusCounts.OVERDUE,
        cancelledCount: statusCounts.CANCELLED,
        totalGrandTotal: this.numberValue((totalGrandTotal as any)._sum.grandTotal),
        unpaidGrandTotal: this.numberValue((unpaidGrandTotal as any)._sum.amountDue),
      },
    };
  }

  async getNextInvoiceNumber(userId: string) {
    const membership = await this.findMembership(userId);
    return {
      invoiceNumber: await this.generateInvoiceNumber(membership.company),
    };
  }

  async getInvoice(userId: string, invoiceId: string) {
    const membership = await this.findMembership(userId);
    const invoice = await this.findInvoiceForCompany(invoiceId, membership.companyId);
    return this.serializeInvoice(invoice);
  }

  async createInvoice(userId: string, body: InvoicePayload = {}) {
    const membership = await this.findMembership(userId);
    const prepared = await this.prepareInvoiceData(membership, body, false);

    const invoice = await (this.prisma as any).invoice.create({
      data: {
        ...prepared.invoiceData,
        companyId: membership.companyId,
        lineItems: {
          create: prepared.lines,
        },
      },
      include: this.invoiceInclude(),
    });

    return this.serializeInvoice(invoice);
  }

  async updateInvoice(userId: string, invoiceId: string, body: InvoicePayload = {}) {
    const membership = await this.findMembership(userId);
    const existing = await this.findInvoiceForCompany(invoiceId, membership.companyId);

    if (['PAID', 'CANCELLED'].includes(existing.status)) {
      throw new BadRequestException('Paid or cancelled invoices cannot be edited');
    }

    const prepared = await this.prepareInvoiceData(membership, body, true, existing.invoiceNumber);

    const invoice = await (this.prisma as any).invoice.update({
      where: { id: invoiceId },
      data: {
        ...prepared.invoiceData,
        lineItems: {
          deleteMany: {},
          create: prepared.lines,
        },
      },
      include: this.invoiceInclude(),
    });

    return this.serializeInvoice(invoice);
  }

  async finalizeInvoice(userId: string, invoiceId: string) {
    const membership = await this.findMembership(userId);
    const invoice = await this.findInvoiceForCompany(invoiceId, membership.companyId);

    if (!invoice.lineItems?.length) {
      throw new BadRequestException('At least one line item is required to finalize an invoice');
    }

    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException('Only draft invoices can be finalized');
    }

    const updated = await (this.prisma as any).invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'FINALIZED',
        finalizedAt: new Date(),
        amountDue: this.numberValue(invoice.grandTotal),
      },
      include: this.invoiceInclude(),
    });

    return this.serializeInvoice(updated);
  }

  async updateStatus(userId: string, invoiceId: string, body: { status?: string; amountPaid?: number | string }) {
    const membership = await this.findMembership(userId);
    const invoice = await this.findInvoiceForCompany(invoiceId, membership.companyId);
    const status = this.normalizeEnum(body.status, invoiceStatuses, 'Invoice status') as InvoiceStatusValue;
    const now = new Date();
    const amountPaid = body.amountPaid !== undefined
      ? this.numberFrom(body.amountPaid, 'Amount paid', 0, 999999999999)
      : this.numberValue(invoice.amountPaid);
    const grandTotal = this.numberValue(invoice.grandTotal);
    const amountDue = status === 'PAID' ? 0 : this.round2(Math.max(grandTotal - amountPaid, 0));

    const timestampData: Record<string, Date | null> = {};
    if (status === 'FINALIZED') timestampData.finalizedAt = invoice.finalizedAt || now;
    if (status === 'SENT') timestampData.sentAt = invoice.sentAt || now;
    if (status === 'PAID') timestampData.paidAt = invoice.paidAt || now;
    if (status === 'CANCELLED') timestampData.cancelledAt = invoice.cancelledAt || now;

    const updated = await (this.prisma as any).invoice.update({
      where: { id: invoiceId },
      data: {
        status,
        amountPaid: this.round2(amountPaid),
        amountDue,
        ...timestampData,
      },
      include: this.invoiceInclude(),
    });

    return this.serializeInvoice(updated);
  }


  async getInvoicePayments(userId: string, invoiceId: string) {
    const membership = await this.findMembership(userId);
    const invoice = await this.findInvoiceForCompany(invoiceId, membership.companyId);
    const payments = Array.isArray(invoice.payments) ? invoice.payments : [];

    return {
      invoice: this.serializeInvoice(invoice),
      payments: payments.map((payment: any) => this.serializePayment(payment)),
      summary: this.paymentSummary(invoice, payments),
    };
  }

  async recordPayment(userId: string, invoiceId: string, body: PaymentPayload = {}) {
    const membership = await this.findMembership(userId);
    const invoice = await this.findInvoiceForCompany(invoiceId, membership.companyId);
    this.ensurePaymentCanBeRecorded(invoice);

    const amountReceived = this.numberFrom(body.amountReceived, 'Amount received', 0.01, 999999999999);
    const amountDue = this.currentAmountDue(invoice);

    if (amountReceived > amountDue + 0.009) {
      throw new BadRequestException(`Amount received cannot be greater than due amount (${this.round2(amountDue)})`);
    }

    const paymentDate = this.dateFrom(body.paymentDate, 'Payment date') || new Date();
    const paymentMode = this.normalizeEnum(body.paymentMode || 'UPI', paymentModes, 'Payment mode') as PaymentModeValue;

    const payment = await (this.prisma as any).invoicePayment.create({
      data: {
        companyId: membership.companyId,
        invoiceId: invoice.id,
        paymentDate,
        paymentMode,
        referenceNumber: this.cleanOptionalString(body.referenceNumber) || null,
        amountReceived: this.round2(amountReceived),
        notes: this.cleanOptionalString(body.notes) || null,
      },
    });

    const updatedInvoice = await this.recalculateInvoicePaymentState(invoice.id, membership.companyId);

    return {
      invoice: this.serializeInvoice(updatedInvoice),
      payment: this.serializePayment(payment),
      payments: (updatedInvoice.payments || []).map((entry: any) => this.serializePayment(entry)),
      summary: this.paymentSummary(updatedInvoice, updatedInvoice.payments || []),
      message: updatedInvoice.status === 'PAID' ? 'Invoice marked as paid' : 'Partial payment recorded',
    };
  }

  async markInvoicePaid(userId: string, invoiceId: string, body: PaymentPayload = {}) {
    const membership = await this.findMembership(userId);
    const invoice = await this.findInvoiceForCompany(invoiceId, membership.companyId);
    this.ensurePaymentCanBeRecorded(invoice);

    const amountDue = this.currentAmountDue(invoice);
    const paymentDate = this.dateFrom(body.paymentDate, 'Payment date') || new Date();
    const paymentMode = this.normalizeEnum(body.paymentMode || 'UPI', paymentModes, 'Payment mode') as PaymentModeValue;

    let payment: any = null;
    if (amountDue > 0) {
      payment = await (this.prisma as any).invoicePayment.create({
        data: {
          companyId: membership.companyId,
          invoiceId: invoice.id,
          paymentDate,
          paymentMode,
          referenceNumber: this.cleanOptionalString(body.referenceNumber) || null,
          amountReceived: this.round2(amountDue),
          notes: this.cleanOptionalString(body.notes) || null,
        },
      });
    }

    const updatedInvoice = await this.recalculateInvoicePaymentState(invoice.id, membership.companyId);

    return {
      invoice: this.serializeInvoice(updatedInvoice),
      payment: payment ? this.serializePayment(payment) : null,
      payments: (updatedInvoice.payments || []).map((entry: any) => this.serializePayment(entry)),
      summary: this.paymentSummary(updatedInvoice, updatedInvoice.payments || []),
      message: 'Invoice marked as paid',
    };
  }

  async deletePayment(userId: string, invoiceId: string, paymentId: string) {
    const membership = await this.findMembership(userId);
    await this.findInvoiceForCompany(invoiceId, membership.companyId);

    const payment = await (this.prisma as any).invoicePayment.findFirst({
      where: {
        id: paymentId,
        invoiceId,
        companyId: membership.companyId,
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    await (this.prisma as any).invoicePayment.delete({ where: { id: paymentId } });
    const updatedInvoice = await this.recalculateInvoicePaymentState(invoiceId, membership.companyId);

    return {
      invoice: this.serializeInvoice(updatedInvoice),
      payments: (updatedInvoice.payments || []).map((entry: any) => this.serializePayment(entry)),
      summary: this.paymentSummary(updatedInvoice, updatedInvoice.payments || []),
      message: 'Payment entry removed and invoice balance recalculated',
    };
  }

  private async prepareInvoiceData(
    membership: any,
    body: InvoicePayload,
    isUpdate: boolean,
    existingInvoiceNumber?: string,
  ) {
    const company = membership.company;
    const status = this.normalizeInvoiceStatus(body.status || 'DRAFT');
    const fallbackInvoiceNumber = existingInvoiceNumber || (await this.generateInvoiceNumber(company));
    const invoiceNumber = String(body.invoiceNumber || fallbackInvoiceNumber).trim();

    if (!invoiceNumber) {
      throw new BadRequestException('Invoice number is required');
    }

    const client = await this.resolveClient(body.clientId, membership.companyId);
    const invoiceDate = this.dateFrom(body.invoiceDate, 'Invoice date') || new Date();
    const dueDate = this.dateFrom(body.dueDate, 'Due date');
    const currency = String(body.currency || client?.defaultCurrency || company.currency || 'INR').trim().toUpperCase();
    const taxCalculationMode = this.normalizeEnum(
      body.taxCalculationMode || 'EXCLUSIVE',
      taxCalculationModes,
      'Tax calculation mode',
    ) as TaxCalculationModeValue;
    const taxApplicationLevel = this.normalizeEnum(
      body.taxApplicationLevel || 'ITEM_LEVEL',
      taxApplicationLevels,
      'Tax application level',
    ) as TaxApplicationLevelValue;
    const discountType = this.normalizeEnum(
      body.discountType || 'AMOUNT',
      discountTypes,
      'Discount type',
    ) as DiscountTypeValue;
    const discountValue = this.numberFrom(body.discountValue ?? 0, 'Invoice discount', 0, 999999999999);
    const templateSettings = await this.getTemplateSettingsSnapshot(membership.companyId, body);

    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new BadRequestException('At least one invoice item is required');
    }

    const invoiceLevelTaxProfile = taxApplicationLevel === 'INVOICE_LEVEL'
      ? await this.resolveTaxProfile(body.invoiceLevelTaxProfileId, membership.companyId)
      : null;

    const calculation = await this.calculateInvoiceTotals({
      companyId: membership.companyId,
      linePayloads: body.items,
      taxCalculationMode,
      taxApplicationLevel,
      invoiceLevelTaxProfile,
      invoiceDiscountType: discountType,
      invoiceDiscountValue: discountValue,
      isInterState: Boolean(body.isInterState),
    });

    const amountPaid = status === 'PAID' ? calculation.grandTotal : 0;
    const amountDue = status === 'PAID' || status === 'CANCELLED' ? 0 : calculation.grandTotal;
    const now = new Date();

    return {
      invoiceData: {
        clientId: client?.id || null,
        invoiceNumber,
        invoiceDate,
        dueDate,
        status,
        currency,
        notes: this.cleanOptionalString(body.notes),
        terms: this.cleanOptionalString(body.terms),
        discountType,
        discountValue: this.round2(discountValue),
        discountTotal: calculation.discountTotal,
        subTotal: calculation.subTotal,
        taxableAmount: calculation.taxableAmount,
        taxTotal: calculation.taxTotal,
        grandTotal: calculation.grandTotal,
        amountPaid,
        amountDue,
        taxCalculationMode,
        taxApplicationLevel,
        invoiceLevelTaxProfileId: invoiceLevelTaxProfile?.id || null,
        invoiceTaxBreakdown: calculation.invoiceTaxBreakdown,
        templateStyle: templateSettings.templateStyle,
        documentTitle: templateSettings.documentTitle,
        brandColor: templateSettings.brandColor,
        showLogo: templateSettings.showLogo,
        showSignature: templateSettings.showSignature,
        showQrCode: templateSettings.showQrCode,
        showBankDetails: templateSettings.showBankDetails,
        finalizedAt: ['FINALIZED', 'SENT', 'PAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(status) ? now : null,
        sentAt: status === 'SENT' ? now : null,
        paidAt: status === 'PAID' ? now : null,
        cancelledAt: status === 'CANCELLED' ? now : null,
      },
      lines: calculation.lines,
    };
  }

  private async calculateInvoiceTotals(input: {
    companyId: string;
    linePayloads: InvoiceLinePayload[];
    taxCalculationMode: TaxCalculationModeValue;
    taxApplicationLevel: TaxApplicationLevelValue;
    invoiceLevelTaxProfile: any | null;
    invoiceDiscountType: DiscountTypeValue;
    invoiceDiscountValue: number;
    isInterState: boolean;
  }) {
    const preparedLines = [];
    let subTotal = 0;
    let lineLevelTaxTotal = 0;
    let lineLevelTotal = 0;

    for (let index = 0; index < input.linePayloads.length; index += 1) {
      const payload = input.linePayloads[index] || {};
      const product = await this.resolveProductItem(payload.productItemId, input.companyId);
      const taxProfile = input.taxApplicationLevel === 'ITEM_LEVEL'
        ? await this.resolveTaxProfile(payload.taxProfileId || product?.defaultTaxProfileId, input.companyId)
        : null;

      const itemName = this.cleanOptionalString(payload.itemName) || product?.name;
      if (!itemName) {
        throw new BadRequestException(`Item name is required for line ${index + 1}`);
      }

      const quantity = this.numberFrom(payload.quantity ?? 1, `Quantity for line ${index + 1}`, 0.001, 999999999);
      const rate = this.numberFrom(payload.rate ?? product?.defaultPrice ?? 0, `Rate for line ${index + 1}`, 0, 999999999999);
      const lineDiscountType = this.normalizeEnum(payload.discountType || 'AMOUNT', discountTypes, 'Line discount type') as DiscountTypeValue;
      const lineDiscountValue = this.numberFrom(payload.discountValue ?? 0, `Discount for line ${index + 1}`, 0, 999999999999);
      const lineSubTotal = this.round2(quantity * rate);
      const lineDiscountTotal = this.discountAmount(lineSubTotal, lineDiscountType, lineDiscountValue);
      const lineBase = this.round2(Math.max(lineSubTotal - lineDiscountTotal, 0));
      const rawTaxRate = payload.taxRate ?? taxProfile?.defaultRate ?? product?.defaultTax ?? 0;
      const taxRate = input.taxApplicationLevel === 'ITEM_LEVEL'
        ? this.numberFrom(rawTaxRate, `Tax rate for line ${index + 1}`, 0, 100)
        : 0;
      const lineTax = input.taxApplicationLevel === 'ITEM_LEVEL'
        ? this.calculateAmount(lineBase, taxRate, input.taxCalculationMode)
        : { taxableAmount: lineBase, taxAmount: 0, totalAmount: lineBase };
      const taxBreakdown = input.taxApplicationLevel === 'ITEM_LEVEL'
        ? this.buildTaxBreakdown(taxProfile, taxRate, lineTax.taxAmount, Boolean(payload.isInterState ?? input.isInterState))
        : [];

      subTotal += lineSubTotal;
      lineLevelTaxTotal += lineTax.taxAmount;
      lineLevelTotal += lineTax.totalAmount;

      preparedLines.push({
        productItemId: product?.id || null,
        taxProfileId: input.taxApplicationLevel === 'ITEM_LEVEL' ? taxProfile?.id || null : null,
        lineNo: index + 1,
        itemName,
        description: this.cleanOptionalString(payload.description) ?? product?.description ?? null,
        hsnSacSku: this.cleanOptionalString(payload.hsnSacSku) ?? product?.hsnSacSku ?? null,
        unit: this.cleanOptionalString(payload.unit) || product?.unit || 'PCS',
        quantity: this.round3(quantity),
        rate: this.round2(rate),
        discountType: lineDiscountType,
        discountValue: this.round2(lineDiscountValue),
        discountTotal: lineDiscountTotal,
        subTotal: lineSubTotal,
        taxableAmount: lineTax.taxableAmount,
        taxRate: this.round2(taxRate),
        taxAmount: lineTax.taxAmount,
        totalAmount: lineTax.totalAmount,
        taxBreakdown,
      });
    }

    subTotal = this.round2(subTotal);
    const invoiceDiscountTotal = this.discountAmount(subTotal, input.invoiceDiscountType, input.invoiceDiscountValue);

    if (input.taxApplicationLevel === 'INVOICE_LEVEL') {
      const taxableBase = this.round2(Math.max(subTotal - invoiceDiscountTotal, 0));
      const rate = this.numberFrom(input.invoiceLevelTaxProfile?.defaultRate ?? 0, 'Invoice tax rate', 0, 100);
      const invoiceTax = this.calculateAmount(taxableBase, rate, input.taxCalculationMode);
      const invoiceTaxBreakdown = this.buildTaxBreakdown(
        input.invoiceLevelTaxProfile,
        rate,
        invoiceTax.taxAmount,
        input.isInterState,
      );

      return {
        lines: preparedLines,
        subTotal,
        discountTotal: invoiceDiscountTotal,
        taxableAmount: invoiceTax.taxableAmount,
        taxTotal: invoiceTax.taxAmount,
        grandTotal: invoiceTax.totalAmount,
        invoiceTaxBreakdown,
      };
    }

    const grandBeforeInvoiceDiscount = this.round2(lineLevelTotal);
    const grandTotal = this.round2(Math.max(grandBeforeInvoiceDiscount - invoiceDiscountTotal, 0));

    return {
      lines: preparedLines,
      subTotal,
      discountTotal: invoiceDiscountTotal,
      taxableAmount: this.round2(preparedLines.reduce((sum, line) => sum + line.taxableAmount, 0)),
      taxTotal: this.round2(lineLevelTaxTotal),
      grandTotal,
      invoiceTaxBreakdown: [],
    };
  }

  private async resolveClient(clientId: unknown, companyId: string) {
    if (!clientId) return null;
    const client = await (this.prisma as any).client.findFirst({
      where: { id: String(clientId), companyId },
    });

    if (!client) {
      throw new BadRequestException('Selected client was not found for this company');
    }

    if (client.status === 'ARCHIVED') {
      throw new BadRequestException('Archived clients cannot be used on new invoices');
    }

    return client;
  }

  private async resolveProductItem(productItemId: unknown, companyId: string) {
    if (!productItemId) return null;
    const item = await (this.prisma as any).productItem.findFirst({
      where: { id: String(productItemId), companyId },
    });

    if (!item) {
      throw new BadRequestException('Selected product/service item was not found for this company');
    }

    if (item.status === 'INACTIVE') {
      throw new BadRequestException(`Inactive item cannot be used: ${item.name}`);
    }

    return item;
  }

  private async resolveTaxProfile(taxProfileId: unknown, companyId: string) {
    if (!taxProfileId) {
      const defaultProfile = await (this.prisma as any).taxProfile.findFirst({
        where: { companyId, isDefault: true, status: 'ACTIVE' },
        include: { components: { orderBy: { sortOrder: 'asc' } } },
      });
      return defaultProfile;
    }

    const profile = await (this.prisma as any).taxProfile.findFirst({
      where: { id: String(taxProfileId), companyId },
      include: { components: { orderBy: { sortOrder: 'asc' } } },
    });

    if (!profile) {
      throw new BadRequestException('Selected tax profile was not found for this company');
    }

    if (profile.status === 'INACTIVE') {
      throw new BadRequestException(`Inactive tax profile cannot be used: ${profile.name}`);
    }

    return profile;
  }

  private calculateAmount(amount: number, rate: number, mode: TaxCalculationModeValue) {
    if (rate <= 0) {
      return {
        taxableAmount: this.round2(amount),
        taxAmount: 0,
        totalAmount: this.round2(amount),
      };
    }

    if (mode === 'INCLUSIVE') {
      const taxableAmount = this.round2(amount / (1 + rate / 100));
      const taxAmount = this.round2(amount - taxableAmount);
      return {
        taxableAmount,
        taxAmount,
        totalAmount: this.round2(amount),
      };
    }

    const taxableAmount = this.round2(amount);
    const taxAmount = this.round2((taxableAmount * rate) / 100);
    return {
      taxableAmount,
      taxAmount,
      totalAmount: this.round2(taxableAmount + taxAmount),
    };
  }

  private buildTaxBreakdown(profile: any, effectiveRate: number, taxAmount: number, isInterState: boolean) {
    if (!profile || effectiveRate <= 0 || taxAmount <= 0) {
      return [];
    }

    let components = Array.isArray(profile.components) ? profile.components : [];

    if (profile.type === 'INDIA_GST') {
      components = isInterState
        ? components.filter((component: any) => component.type === 'IGST')
        : components.filter((component: any) => ['CGST', 'SGST'].includes(component.type));
    }

    if (!components.length) {
      components = [{ name: profile.name || 'Tax', type: 'CUSTOM', rate: effectiveRate }];
    }

    const componentRateTotal = components.reduce((sum: number, component: any) => sum + this.numberValue(component.rate), 0) || effectiveRate;
    let allocated = 0;

    return components.map((component: any, index: number) => {
      const isLast = index === components.length - 1;
      const proportionalAmount = isLast
        ? this.round2(taxAmount - allocated)
        : this.round2((taxAmount * this.numberValue(component.rate)) / componentRateTotal);
      allocated += proportionalAmount;
      return {
        name: component.name,
        type: component.type,
        rate: this.round2(this.numberValue(component.rate)),
        amount: proportionalAmount,
      };
    });
  }

  private async getTemplateSettingsSnapshot(companyId: string, body: InvoicePayload) {
    const saved = await (this.prisma as any).invoiceTemplateSetting.findUnique({
      where: { companyId },
    });

    const base = {
      ...defaultTemplateSettings,
      ...(saved || {}),
    };

    return {
      templateStyle: body.templateStyle
        ? this.normalizeEnum(body.templateStyle, invoiceTemplateStyles, 'Invoice template style') as InvoiceTemplateStyleValue
        : base.templateStyle,
      documentTitle: body.documentTitle
        ? this.normalizeEnum(body.documentTitle, invoiceDocumentTitles, 'Invoice document title') as InvoiceDocumentTitleValue
        : base.documentTitle,
      brandColor: body.brandColor ? this.normalizeBrandColor(body.brandColor) : base.brandColor,
      showLogo: typeof body.showLogo === 'boolean' ? body.showLogo : Boolean(base.showLogo),
      showSignature: typeof body.showSignature === 'boolean' ? body.showSignature : Boolean(base.showSignature),
      showQrCode: typeof body.showQrCode === 'boolean' ? body.showQrCode : Boolean(base.showQrCode),
      showBankDetails: typeof body.showBankDetails === 'boolean' ? body.showBankDetails : Boolean(base.showBankDetails),
    };
  }

  private normalizeBrandColor(value: unknown) {
    const color = String(value || '').trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
      throw new BadRequestException('Brand color must be a valid hex color, for example #0B57D0');
    }
    return color.toUpperCase();
  }

  private async generateInvoiceNumber(company: any) {
    const prefix = company.invoicePrefix || 'INV-';
    const startingNumber = Number(company.invoiceStartingNumber || 1001);
    const count = await (this.prisma as any).invoice.count({
      where: { companyId: company.id },
    });

    let candidateNumber = startingNumber + count;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const invoiceNumber = `${prefix}${candidateNumber}`;
      const exists = await (this.prisma as any).invoice.findFirst({
        where: { companyId: company.id, invoiceNumber },
        select: { id: true },
      });
      if (!exists) return invoiceNumber;
      candidateNumber += 1;
    }

    throw new BadRequestException('Unable to generate a unique invoice number');
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

  private async findInvoiceForCompany(invoiceId: string, companyId: string) {
    const invoice = await (this.prisma as any).invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: this.invoiceInclude(),
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return invoice;
  }

  private invoiceInclude() {
    return {
      company: true,
      client: true,
      invoiceLevelTaxProfile: { include: { components: { orderBy: { sortOrder: 'asc' } } } },
      lineItems: {
        orderBy: { lineNo: 'asc' },
        include: {
          productItem: true,
          taxProfile: { include: { components: { orderBy: { sortOrder: 'asc' } } } },
        },
      },
      payments: { orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }] },
    };
  }


  private ensurePaymentCanBeRecorded(invoice: any) {
    if (invoice.status === 'DRAFT') {
      throw new BadRequestException('Payments can only be recorded after invoice is finalized');
    }

    if (invoice.status === 'CANCELLED') {
      throw new BadRequestException('Payments cannot be recorded against a cancelled invoice');
    }

    if (this.currentAmountDue(invoice) <= 0) {
      throw new BadRequestException('This invoice has no due amount left');
    }
  }

  private currentAmountDue(invoice: any) {
    const grandTotal = this.numberValue(invoice.grandTotal);
    const paidFromInvoice = this.numberValue(invoice.amountPaid);
    return this.round2(Math.max(grandTotal - paidFromInvoice, 0));
  }

  private async recalculateInvoicePaymentState(invoiceId: string, companyId: string) {
    const invoice = await (this.prisma as any).invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: this.invoiceInclude(),
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const payments = Array.isArray(invoice.payments) ? invoice.payments : [];
    const grandTotal = this.numberValue(invoice.grandTotal);
    const rawAmountPaid = this.round2(payments.reduce((sum: number, payment: any) => sum + this.numberValue(payment.amountReceived), 0));
    const amountPaid = this.round2(Math.min(rawAmountPaid, grandTotal));
    const amountDue = this.round2(Math.max(grandTotal - amountPaid, 0));
    const latestPaymentDate = payments.reduce<Date | null>((latest, payment: any) => {
      const date = payment.paymentDate ? new Date(payment.paymentDate) : null;
      if (!date || Number.isNaN(date.getTime())) return latest;
      if (!latest || date.getTime() > latest.getTime()) return date;
      return latest;
    }, null);

    let status = invoice.status;
    if (status !== 'DRAFT' && status !== 'CANCELLED') {
      if (grandTotal > 0 && amountDue <= 0) {
        status = 'PAID';
      } else if (amountPaid > 0) {
        status = 'PARTIALLY_PAID';
      } else {
        status = this.defaultUnpaidStatus(invoice);
      }
    }

    return (this.prisma as any).invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid,
        amountDue,
        status,
        paidAt: status === 'PAID' ? (invoice.paidAt || latestPaymentDate || new Date()) : null,
      },
      include: this.invoiceInclude(),
    });
  }

  private defaultUnpaidStatus(invoice: any) {
    if (invoice.dueDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dueDate = new Date(invoice.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      if (dueDate.getTime() < today.getTime()) return 'OVERDUE';
    }

    if (invoice.sentAt || invoice.status === 'SENT') return 'SENT';
    return 'FINALIZED';
  }

  private paymentSummary(invoice: any, payments: any[] = []) {
    return {
      totalPayments: payments.length,
      amountReceived: this.round2(payments.reduce((sum, payment) => sum + this.numberValue(payment.amountReceived), 0)),
      amountPaid: this.numberValue(invoice.amountPaid),
      amountDue: this.numberValue(invoice.amountDue),
      grandTotal: this.numberValue(invoice.grandTotal),
      lastPaymentDate: payments[0]?.paymentDate || null,
    };
  }

  private normalizeInvoiceStatus(value: unknown) {
    return this.normalizeEnum(value || 'DRAFT', invoiceStatuses, 'Invoice status') as InvoiceStatusValue;
  }

  private normalizeEnum(value: unknown, allowed: readonly string[], label: string) {
    const normalized = String(value || '').trim().toUpperCase();
    if (!allowed.includes(normalized)) {
      throw new BadRequestException(`${label} must be one of: ${allowed.join(', ')}`);
    }
    return normalized;
  }

  private numberFrom(value: unknown, label: string, min: number, max: number) {
    const numberValue = typeof value === 'number' ? value : Number(String(value ?? '').trim());

    if (!Number.isFinite(numberValue)) {
      throw new BadRequestException(`${label} must be a valid number`);
    }

    if (numberValue < min || numberValue > max) {
      throw new BadRequestException(`${label} must be between ${min} and ${max}`);
    }

    return numberValue;
  }

  private dateFrom(value: unknown, label: string) {
    if (value === undefined || value === null || value === '') return null;
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${label} must be a valid date`);
    }
    return date;
  }

  private discountAmount(base: number, type: DiscountTypeValue, value: number) {
    if (type === 'PERCENT') {
      return this.round2(Math.min((base * value) / 100, base));
    }
    return this.round2(Math.min(value, base));
  }

  private cleanOptionalString(value: unknown) {
    if (value === undefined || value === null) return undefined;
    const cleaned = String(value).trim();
    return cleaned ? cleaned : undefined;
  }

  private numberValue(value: unknown) {
    if (value === undefined || value === null) return 0;
    return Number(value) || 0;
  }

  private round2(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private round3(value: number) {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
  }


  private serializePayment(payment: any) {
    return {
      id: payment.id,
      companyId: payment.companyId,
      invoiceId: payment.invoiceId,
      paymentDate: payment.paymentDate,
      paymentMode: payment.paymentMode,
      referenceNumber: payment.referenceNumber,
      amountReceived: this.numberValue(payment.amountReceived),
      notes: payment.notes,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }

  private serializeInvoice(invoice: any) {
    return {
      id: invoice.id,
      companyId: invoice.companyId,
      clientId: invoice.clientId,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      status: invoice.status,
      currency: invoice.currency,
      notes: invoice.notes,
      terms: invoice.terms,
      discountType: invoice.discountType,
      discountValue: this.numberValue(invoice.discountValue),
      discountTotal: this.numberValue(invoice.discountTotal),
      subTotal: this.numberValue(invoice.subTotal),
      taxableAmount: this.numberValue(invoice.taxableAmount),
      taxTotal: this.numberValue(invoice.taxTotal),
      grandTotal: this.numberValue(invoice.grandTotal),
      amountPaid: this.numberValue(invoice.amountPaid),
      amountDue: this.numberValue(invoice.amountDue),
      taxCalculationMode: invoice.taxCalculationMode,
      taxApplicationLevel: invoice.taxApplicationLevel,
      invoiceLevelTaxProfileId: invoice.invoiceLevelTaxProfileId,
      invoiceTaxBreakdown: invoice.invoiceTaxBreakdown || [],
      templateStyle: invoice.templateStyle || defaultTemplateSettings.templateStyle,
      documentTitle: invoice.documentTitle || defaultTemplateSettings.documentTitle,
      brandColor: invoice.brandColor || defaultTemplateSettings.brandColor,
      showLogo: invoice.showLogo ?? defaultTemplateSettings.showLogo,
      showSignature: invoice.showSignature ?? defaultTemplateSettings.showSignature,
      showQrCode: invoice.showQrCode ?? defaultTemplateSettings.showQrCode,
      showBankDetails: invoice.showBankDetails ?? defaultTemplateSettings.showBankDetails,
      finalizedAt: invoice.finalizedAt,
      sentAt: invoice.sentAt,
      paidAt: invoice.paidAt,
      cancelledAt: invoice.cancelledAt,
      pdfFileName: invoice.pdfFileName,
      pdfFilePath: invoice.pdfFilePath,
      pdfGeneratedAt: invoice.pdfGeneratedAt,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
      payments: Array.isArray(invoice.payments) ? invoice.payments.map((payment: any) => this.serializePayment(payment)) : [],
      client: invoice.client ? {
        id: invoice.client.id,
        companyName: invoice.client.companyName,
        contactPerson: invoice.client.contactPerson,
        email: invoice.client.email,
        phone: invoice.client.phone,
        taxId: invoice.client.taxId,
        billingAddressLine1: invoice.client.billingAddressLine1,
        billingAddressLine2: invoice.client.billingAddressLine2,
        billingCity: invoice.client.billingCity,
        billingState: invoice.client.billingState,
        billingPostalCode: invoice.client.billingPostalCode,
        billingCountry: invoice.client.billingCountry,
        defaultCurrency: invoice.client.defaultCurrency,
        paymentTerms: invoice.client.paymentTerms,
      } : null,
      company: invoice.company ? {
        id: invoice.company.id,
        name: invoice.company.name,
        legalName: invoice.company.legalName,
        workEmail: invoice.company.workEmail,
        addressLine1: invoice.company.addressLine1,
        addressLine2: invoice.company.addressLine2,
        city: invoice.company.city,
        state: invoice.company.state,
        postalCode: invoice.company.postalCode,
        country: invoice.company.country,
        currency: invoice.company.currency,
        taxNumber: invoice.company.taxNumber,
        bankName: invoice.company.bankName,
        accountHolderName: invoice.company.accountHolderName,
        bankAccountNumber: invoice.company.bankAccountNumber,
        bankIfscOrSwift: invoice.company.bankIfscOrSwift,
        upiId: invoice.company.upiId,
        paymentNote: invoice.company.paymentNote,
        showBankDetailsOnInvoice: invoice.company.showBankDetailsOnInvoice,
        showQrCodeOnInvoice: invoice.company.showQrCodeOnInvoice,
        logoDataUrl: invoice.company.logoDataUrl,
        signatureDataUrl: invoice.company.signatureDataUrl,
        qrCodeDataUrl: invoice.company.qrCodeDataUrl,
        defaultInvoiceFooter: invoice.company.defaultInvoiceFooter,
        invoicePrefix: invoice.company.invoicePrefix,
      } : null,
      lineItems: Array.isArray(invoice.lineItems) ? invoice.lineItems.map((line: any) => ({
        id: line.id,
        invoiceId: line.invoiceId,
        productItemId: line.productItemId,
        taxProfileId: line.taxProfileId,
        lineNo: line.lineNo,
        itemName: line.itemName,
        description: line.description,
        hsnSacSku: line.hsnSacSku,
        unit: line.unit,
        quantity: this.numberValue(line.quantity),
        rate: this.numberValue(line.rate),
        discountType: line.discountType,
        discountValue: this.numberValue(line.discountValue),
        discountTotal: this.numberValue(line.discountTotal),
        subTotal: this.numberValue(line.subTotal),
        taxableAmount: this.numberValue(line.taxableAmount),
        taxRate: this.numberValue(line.taxRate),
        taxAmount: this.numberValue(line.taxAmount),
        totalAmount: this.numberValue(line.totalAmount),
        taxBreakdown: line.taxBreakdown || [],
      })) : [],
    };
  }
}
