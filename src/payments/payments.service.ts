//@ts-nocheck
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type PaymentModeValue = 'CASH' | 'BANK_TRANSFER' | 'UPI' | 'CARD' | 'CHEQUE' | 'ONLINE' | 'OTHER';

const paymentModes: PaymentModeValue[] = ['CASH', 'BANK_TRANSFER', 'UPI', 'CARD', 'CHEQUE', 'ONLINE', 'OTHER'];

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPayments(userId: string, query: { search?: string; mode?: string } = {}) {
    const membership = await this.findMembership(userId);
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const mode = typeof query.mode === 'string' ? query.mode.toUpperCase() : '';

    const where: Record<string, unknown> = { companyId: membership.companyId };
    if (paymentModes.includes(mode as PaymentModeValue)) where.paymentMode = mode;

    if (search) {
      where.OR = [
        { referenceNumber: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { invoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
        { invoice: { client: { companyName: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const [payments, total, byMode] = await this.prisma.$transaction([
      (this.prisma as any).invoicePayment.findMany({
        where,
        include: this.paymentInclude(),
        orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
        take: 100,
      }),
      (this.prisma as any).invoicePayment.aggregate({
        where: { companyId: membership.companyId },
        _sum: { amountReceived: true },
        _count: { _all: true },
      }),
      (this.prisma as any).invoicePayment.groupBy({
        by: ['paymentMode'],
        where: { companyId: membership.companyId },
        _sum: { amountReceived: true },
        _count: { _all: true },
      }),
    ]);

    return {
      payments: payments.map((payment: any) => this.serializePayment(payment)),
      summary: {
        totalPayments: total._count._all,
        totalAmountReceived: this.numberValue(total._sum.amountReceived),
        byMode: byMode.map((row: any) => ({
          paymentMode: row.paymentMode,
          count: row._count._all,
          amount: this.numberValue(row._sum.amountReceived),
        })),
      },
    };
  }

  async listPayableInvoices(userId: string, query: { search?: string } = {}) {
    const membership = await this.findMembership(userId);
    const search = typeof query.search === 'string' ? query.search.trim() : '';

    const where: Record<string, unknown> = {
      companyId: membership.companyId,
      status: { notIn: ['DRAFT', 'CANCELLED'] },
    };

    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { client: { companyName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const invoices = await (this.prisma as any).invoice.findMany({
      where,
      include: {
        client: true,
        payments: { orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }] },
      },
      orderBy: [{ invoiceDate: 'desc' }, { updatedAt: 'desc' }],
      take: 100,
    });

    return { invoices: invoices.map((invoice: any) => this.serializeInvoiceOption(invoice)) };
  }

  async createPayment(userId: string, body: any = {}) {
    const membership = await this.findMembership(userId);
    const invoiceId = this.cleanRequiredString(body.invoiceId, 'Invoice is required');
    const invoice = await this.findInvoiceForCompany(invoiceId, membership.companyId);

    if (invoice.status === 'DRAFT') throw new BadRequestException('Payments can only be recorded after invoice is finalized');
    if (invoice.status === 'CANCELLED') throw new BadRequestException('Payments cannot be recorded against a cancelled invoice');

    const amountReceived = this.numberFrom(body.amountReceived, 'Amount received', 0.01, 999999999999);
    const paymentDate = this.dateFrom(body.paymentDate, 'Payment date') || new Date();
    const paymentMode = this.normalizeEnum(body.paymentMode || 'UPI', paymentModes, 'Payment mode') as PaymentModeValue;
    const proof = this.normalizePaymentProof(body);

    const payment = await (this.prisma as any).invoicePayment.create({
      data: {
        companyId: membership.companyId,
        invoiceId,
        paymentDate,
        paymentMode,
        referenceNumber: this.cleanOptionalString(body.referenceNumber) || null,
        amountReceived: this.round2(amountReceived),
        paymentProofDataUrl: proof.paymentProofDataUrl,
        paymentProofFileName: proof.paymentProofFileName,
        paymentProofMimeType: proof.paymentProofMimeType,
        notes: this.cleanOptionalString(body.notes) || null,
      },
      include: this.paymentInclude(),
    });

    const updatedInvoice = await this.recalculateInvoicePaymentState(invoiceId, membership.companyId);

    return {
      payment: this.serializePayment(payment),
      invoice: this.serializeInvoiceOption(updatedInvoice),
      summary: this.paymentSummary(updatedInvoice, updatedInvoice.payments || []),
      message: this.paymentMessage(updatedInvoice),
    };
  }

  async deletePayment(userId: string, paymentId: string) {
    const membership = await this.findMembership(userId);
    const payment = await (this.prisma as any).invoicePayment.findFirst({
      where: { id: paymentId, companyId: membership.companyId },
    });

    if (!payment) throw new NotFoundException('Payment entry not found');

    await (this.prisma as any).invoicePayment.delete({ where: { id: paymentId } });
    const updatedInvoice = await this.recalculateInvoicePaymentState(payment.invoiceId, membership.companyId);

    return {
      invoice: this.serializeInvoiceOption(updatedInvoice),
      summary: this.paymentSummary(updatedInvoice, updatedInvoice.payments || []),
      message: 'Payment removed and invoice balance recalculated',
    };
  }

  private paymentInclude() {
    return {
      invoice: {
        include: {
          client: true,
          payments: { orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }] },
        },
      },
    };
  }

  private async recalculateInvoicePaymentState(invoiceId: string, companyId: string) {
    const invoice = await (this.prisma as any).invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: { client: true, payments: { orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }] } },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');

    const payments = Array.isArray(invoice.payments) ? invoice.payments : [];
    const grandTotal = this.numberValue(invoice.grandTotal);
    const rawReceived = this.round2(payments.reduce((sum: number, payment: any) => sum + this.numberValue(payment.amountReceived), 0));
    const amountPaid = this.round2(Math.min(rawReceived, grandTotal));
    const amountDue = this.round2(Math.max(grandTotal - rawReceived, 0));
    const creditAmount = this.round2(Math.max(rawReceived - grandTotal, 0));
    const latestPaymentDate = payments.reduce<Date | null>((latest, payment: any) => {
      const date = payment.paymentDate ? new Date(payment.paymentDate) : null;
      if (!date || Number.isNaN(date.getTime())) return latest;
      if (!latest || date.getTime() > latest.getTime()) return date;
      return latest;
    }, null);

    let status = invoice.status;
    if (status !== 'DRAFT' && status !== 'CANCELLED') {
      if (grandTotal > 0 && creditAmount > 0) status = 'ADVANCE_CREDIT';
      else if (grandTotal > 0 && amountDue <= 0) status = 'PAID';
      else if (amountPaid > 0) status = 'PARTIALLY_PAID';
      else status = this.defaultUnpaidStatus(invoice);
    }

    return (this.prisma as any).invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid,
        amountDue,
        creditAmount,
        status,
        paidAt: ['PAID', 'ADVANCE_CREDIT'].includes(status) ? (invoice.paidAt || latestPaymentDate || new Date()) : null,
      },
      include: { client: true, payments: { orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }] } },
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

  private async findMembership(userId: string) {
    const membership = await (this.prisma as any).companyMember.findFirst({
      where: { userId },
      include: { company: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new NotFoundException('Company not found for this user');
    return membership;
  }

  private async findInvoiceForCompany(invoiceId: string, companyId: string) {
    const invoice = await (this.prisma as any).invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: { client: true, payments: { orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }] } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  private normalizePaymentProof(body: any) {
    const dataUrl = this.cleanOptionalString(body.paymentProofDataUrl);
    const fileName = this.cleanOptionalString(body.paymentProofFileName);
    const mimeType = this.cleanOptionalString(body.paymentProofMimeType);

    if (!dataUrl) return { paymentProofDataUrl: null, paymentProofFileName: null, paymentProofMimeType: null };

    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];
    const detectedMime = mimeType || (dataUrl.match(/^data:([^;]+);base64,/i)?.[1] ?? '');
    if (!allowed.includes(detectedMime.toLowerCase())) {
      throw new BadRequestException('Payment proof must be PNG, JPG, WEBP, or PDF');
    }
    if (dataUrl.length > 2_500_000) {
      throw new BadRequestException('Payment proof file is too large. Please upload a file under 2 MB.');
    }

    return {
      paymentProofDataUrl: dataUrl,
      paymentProofFileName: fileName || 'payment-proof',
      paymentProofMimeType: detectedMime,
    };
  }

  private paymentSummary(invoice: any, payments: any[] = []) {
    const amountReceived = this.round2(payments.reduce((sum, payment) => sum + this.numberValue(payment.amountReceived), 0));
    return {
      totalPayments: payments.length,
      amountReceived,
      amountPaid: this.numberValue(invoice.amountPaid),
      amountDue: this.numberValue(invoice.amountDue),
      creditAmount: this.numberValue(invoice.creditAmount),
      grandTotal: this.numberValue(invoice.grandTotal),
      lastPaymentDate: payments[0]?.paymentDate || null,
    };
  }

  private paymentMessage(invoice: any) {
    if (this.numberValue(invoice.creditAmount) > 0) return 'Payment recorded with advance credit';
    if (invoice.status === 'PAID') return 'Invoice marked as paid';
    if (invoice.status === 'PARTIALLY_PAID') return 'Partial payment recorded';
    return 'Payment recorded';
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
      paymentProofDataUrl: payment.paymentProofDataUrl,
      paymentProofFileName: payment.paymentProofFileName,
      paymentProofMimeType: payment.paymentProofMimeType,
      notes: payment.notes,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      invoice: payment.invoice ? this.serializeInvoiceOption(payment.invoice) : null,
    };
  }

  private serializeInvoiceOption(invoice: any) {
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      status: invoice.status,
      currency: invoice.currency,
      grandTotal: this.numberValue(invoice.grandTotal),
      amountPaid: this.numberValue(invoice.amountPaid),
      amountDue: this.numberValue(invoice.amountDue),
      creditAmount: this.numberValue(invoice.creditAmount),
      client: invoice.client ? {
        id: invoice.client.id,
        companyName: invoice.client.companyName,
        email: invoice.client.email,
        phone: invoice.client.phone,
      } : null,
      payments: Array.isArray(invoice.payments) ? invoice.payments.map((payment: any) => ({
        id: payment.id,
        paymentDate: payment.paymentDate,
        paymentMode: payment.paymentMode,
        referenceNumber: payment.referenceNumber,
        amountReceived: this.numberValue(payment.amountReceived),
        paymentProofFileName: payment.paymentProofFileName,
      })) : [],
    };
  }

  private normalizeEnum(value: unknown, allowed: readonly string[], label: string) {
    const normalized = String(value || '').trim().toUpperCase();
    if (!allowed.includes(normalized)) throw new BadRequestException(`${label} must be one of: ${allowed.join(', ')}`);
    return normalized;
  }

  private numberFrom(value: unknown, label: string, min: number, max: number) {
    const numberValue = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    if (!Number.isFinite(numberValue)) throw new BadRequestException(`${label} must be a valid number`);
    if (numberValue < min || numberValue > max) throw new BadRequestException(`${label} must be between ${min} and ${max}`);
    return numberValue;
  }

  private dateFrom(value: unknown, label: string) {
    if (value === undefined || value === null || value === '') return null;
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${label} must be a valid date`);
    return date;
  }

  private cleanRequiredString(value: unknown, label: string) {
    const cleaned = this.cleanOptionalString(value);
    if (!cleaned) throw new BadRequestException(label);
    return cleaned;
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
}
