//@ts-nocheck
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type DashboardQuery = {
  search?: string;
  invoiceStatus?: string;
  billMatchStatus?: string;
};

const invoiceStatuses = [
  'DRAFT',
  'FINALIZED',
  'SENT',
  'PAID',
  'PARTIALLY_PAID',
  'ADVANCE_CREDIT',
  'OVERDUE',
  'CANCELLED',
];

const billMatchStatuses = ['UNMATCHED', 'SUGGESTED', 'MATCHED', 'DISCREPANCY', 'IGNORED'];

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(userId: string, query: DashboardQuery = {}) {
    const membership = await this.findMembership(userId);
    const companyId = membership.companyId;
    const company = membership.company;
    const search = this.cleanString(query.search);
    const invoiceStatus = this.normalizeOptional(query.invoiceStatus, invoiceStatuses);
    const billMatchStatus = this.normalizeOptional(query.billMatchStatus, billMatchStatuses);
    const now = new Date();

    const invoiceWhere: Record<string, unknown> = { companyId };
    const clientWhere: Record<string, unknown> = { companyId, status: 'ACTIVE' };
    const billWhere: Record<string, unknown> = { companyId, status: 'ACTIVE' };

    if (invoiceStatus) invoiceWhere.status = invoiceStatus;
    if (billMatchStatus) billWhere.matchStatus = billMatchStatus;

    if (search) {
      invoiceWhere.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { client: { companyName: { contains: search, mode: 'insensitive' } } },
      ];
      clientWhere.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { taxId: { contains: search, mode: 'insensitive' } },
      ];
      billWhere.OR = [
        { partyName: { contains: search, mode: 'insensitive' } },
        { billNumber: { contains: search, mode: 'insensitive' } },
        { paymentReference: { contains: search, mode: 'insensitive' } },
        { invoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
        { invoice: { client: { companyName: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const [
      invoiceCounts,
      outstandingAmount,
      overdueAmount,
      recentInvoices,
      clients,
      clientsCount,
      itemCounts,
      billCounts,
      openFlagsCount,
      billEntries,
      highPriorityFlags,
    ] = await this.prisma.$transaction([
      (this.prisma as any).invoice.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { _all: true },
      }),
      (this.prisma as any).invoice.aggregate({
        where: {
          companyId,
          status: { notIn: ['PAID', 'CANCELLED'] },
          amountDue: { gt: 0 },
        },
        _sum: { amountDue: true },
      }),
      (this.prisma as any).invoice.aggregate({
        where: {
          companyId,
          status: { notIn: ['PAID', 'CANCELLED', 'DRAFT'] },
          amountDue: { gt: 0 },
          OR: [{ status: 'OVERDUE' }, { dueDate: { lt: now } }],
        },
        _sum: { amountDue: true },
      }),
      (this.prisma as any).invoice.findMany({
        where: invoiceWhere,
        include: {
          client: true,
          payments: { orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }], take: 1 },
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 8,
      }),
      (this.prisma as any).client.findMany({
        where: clientWhere,
        orderBy: [{ updatedAt: 'desc' }],
        take: 6,
      }),
      (this.prisma as any).client.count({ where: { companyId, status: 'ACTIVE' } }),
      (this.prisma as any).productItem.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { _all: true },
      }),
      (this.prisma as any).billEntry.groupBy({
        by: ['matchStatus'],
        where: { companyId, status: 'ACTIVE' },
        _count: { _all: true },
      }),
      (this.prisma as any).billDiscrepancyFlag.count({
        where: { companyId, resolved: false },
      }),
      (this.prisma as any).billEntry.findMany({
        where: billWhere,
        include: {
          invoice: { include: { client: true } },
          discrepancies: { where: { resolved: false }, orderBy: [{ createdAt: 'desc' }], take: 3 },
          suggestions: {
            include: { invoice: { include: { client: true } } },
            orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
            take: 2,
          },
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 6,
      }),
      (this.prisma as any).billDiscrepancyFlag.findMany({
        where: { companyId, resolved: false },
        include: {
          billEntry: { include: { invoice: { include: { client: true } } } },
        },
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      }),
    ]);

    const invoiceCountMap = this.countMap(invoiceCounts, 'status');
    const itemCountMap = this.countMap(itemCounts, 'status');
    const billCountMap = this.countMap(billCounts, 'matchStatus');

    const totalInvoices = invoiceStatuses.reduce((sum, status) => sum + (invoiceCountMap[status] || 0), 0);
    const totalItems = Object.values(itemCountMap).reduce((sum: number, count: number) => sum + count, 0);

    return {
      company: {
        id: company.id,
        name: company.name,
        currency: company.currency,
        country: company.country,
        taxRegion: company.taxRegion,
      },
      filters: {
        search,
        invoiceStatus: invoiceStatus || 'ALL',
        billMatchStatus: billMatchStatus || 'ALL',
      },
      summary: {
        totalInvoices,
        draftInvoices: invoiceCountMap.DRAFT || 0,
        sentInvoices: invoiceCountMap.SENT || 0,
        paidInvoices: invoiceCountMap.PAID || 0,
        finalizedInvoices: invoiceCountMap.FINALIZED || 0,
        partiallyPaidInvoices: invoiceCountMap.PARTIALLY_PAID || 0,
        advanceCreditInvoices: invoiceCountMap.ADVANCE_CREDIT || 0,
        cancelledInvoices: invoiceCountMap.CANCELLED || 0,
        outstandingAmount: this.numberValue(outstandingAmount?._sum?.amountDue),
        overdueAmount: this.numberValue(overdueAmount?._sum?.amountDue),
        unmatchedBills: billCountMap.UNMATCHED || 0,
        suggestedBills: billCountMap.SUGGESTED || 0,
        matchedBills: billCountMap.MATCHED || 0,
        disputedBills: billCountMap.DISCREPANCY || 0,
        ignoredBills: billCountMap.IGNORED || 0,
        openDiscrepancyFlags: openFlagsCount || 0,
        activeClients: clientsCount || 0,
        activeItems: itemCountMap.ACTIVE || 0,
        inactiveItems: itemCountMap.INACTIVE || 0,
        totalItems,
      },
      invoices: recentInvoices.map((invoice: any) => this.serializeInvoice(invoice)),
      clients: clients.map((client: any) => this.serializeClient(client)),
      billMatches: billEntries.map((entry: any) => this.serializeBillEntry(entry)),
      alerts: this.buildAlerts(highPriorityFlags, billEntries),
      generatedAt: new Date().toISOString(),
    };
  }

  private async findMembership(userId: string) {
    const membership = await (this.prisma as any).companyMember.findFirst({
      where: { userId },
      include: { company: true, user: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!membership) {
      throw new UnauthorizedException('No company access found for this account');
    }

    return membership;
  }

  private countMap(rows: Array<Record<string, any>>, key: string) {
    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row[key]] = row?._count?._all || 0;
      return acc;
    }, {});
  }

  private serializeInvoice(invoice: any) {
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      clientName: invoice.client?.companyName || 'No client selected',
      clientEmail: invoice.client?.email || null,
      invoiceDate: invoice.invoiceDate?.toISOString?.() || invoice.invoiceDate,
      dueDate: invoice.dueDate?.toISOString?.() || invoice.dueDate || null,
      status: invoice.status,
      currency: invoice.currency,
      subTotal: this.numberValue(invoice.subTotal),
      taxTotal: this.numberValue(invoice.taxTotal),
      grandTotal: this.numberValue(invoice.grandTotal),
      amountPaid: this.numberValue(invoice.amountPaid),
      amountDue: this.numberValue(invoice.amountDue),
      lastPaymentReference: invoice.payments?.[0]?.referenceNumber || null,
      updatedAt: invoice.updatedAt?.toISOString?.() || invoice.updatedAt,
    };
  }

  private serializeClient(client: any) {
    return {
      id: client.id,
      companyName: client.companyName,
      contactPerson: client.contactPerson || null,
      email: client.email || null,
      phone: client.phone || null,
      taxId: client.taxId || null,
      defaultCurrency: client.defaultCurrency,
      paymentTerms: client.paymentTerms,
      status: client.status,
      updatedAt: client.updatedAt?.toISOString?.() || client.updatedAt,
    };
  }

  private serializeBillEntry(entry: any) {
    const bestSuggestion = entry.suggestions?.[0] || null;
    return {
      id: entry.id,
      partyName: entry.partyName,
      billNumber: entry.billNumber,
      billDate: entry.billDate?.toISOString?.() || entry.billDate,
      amount: this.numberValue(entry.amount),
      taxAmount: this.numberValue(entry.taxAmount),
      totalAmount: this.numberValue(entry.totalAmount),
      paymentReference: entry.paymentReference || null,
      matchStatus: entry.matchStatus,
      invoiceNumber: entry.invoice?.invoiceNumber || null,
      invoiceId: entry.invoiceId || null,
      suggestionScore: bestSuggestion ? this.numberValue(bestSuggestion.score) : null,
      suggestionInvoiceNumber: bestSuggestion?.invoice?.invoiceNumber || null,
      discrepancyCount: Array.isArray(entry.discrepancies) ? entry.discrepancies.length : 0,
      discrepancies: (entry.discrepancies || []).map((flag: any) => ({
        id: flag.id,
        type: flag.type,
        message: flag.message,
        severity: flag.severity,
      })),
      updatedAt: entry.updatedAt?.toISOString?.() || entry.updatedAt,
    };
  }

  private buildAlerts(flags: any[], entries: any[]) {
    const flagAlerts = (flags || []).map((flag: any) => ({
      id: flag.id,
      title: this.titleFromFlag(flag.type),
      description: flag.message,
      severity: flag.severity || 'MEDIUM',
      billEntryId: flag.billEntryId,
      partyName: flag.billEntry?.partyName || null,
      billNumber: flag.billEntry?.billNumber || null,
      invoiceNumber: flag.billEntry?.invoice?.invoiceNumber || null,
      createdAt: flag.createdAt?.toISOString?.() || flag.createdAt,
    }));

    if (flagAlerts.length) return flagAlerts;

    return (entries || [])
      .filter((entry: any) => entry.matchStatus === 'SUGGESTED' || entry.matchStatus === 'UNMATCHED')
      .slice(0, 3)
      .map((entry: any) => ({
        id: entry.id,
        title: entry.matchStatus === 'SUGGESTED' ? 'Suggested Match Ready' : 'Invoice Match Needed',
        description:
          entry.matchStatus === 'SUGGESTED'
            ? `${entry.partyName} has a suggested invoice match for ${entry.billNumber}.`
            : `${entry.partyName} bill ${entry.billNumber} is still unmatched.`,
        severity: entry.matchStatus === 'SUGGESTED' ? 'LOW' : 'MEDIUM',
        billEntryId: entry.id,
        partyName: entry.partyName,
        billNumber: entry.billNumber,
        invoiceNumber: entry.invoice?.invoiceNumber || entry.suggestions?.[0]?.invoice?.invoiceNumber || null,
        createdAt: entry.updatedAt?.toISOString?.() || entry.updatedAt,
      }));
  }

  private titleFromFlag(type: string) {
    const readable = {
      AMOUNT_MISMATCH: 'Amount Mismatch',
      TAX_MISMATCH: 'Tax Mismatch',
      DUPLICATE_BILL: 'Duplicate Bill',
      PAYMENT_MISSING: 'Payment Missing',
      INVOICE_MISSING: 'Invoice Missing',
      SOA_AMOUNT_MISMATCH: 'SOA Amount Mismatch',
    };

    return readable[type] || 'Matching Attention Needed';
  }

  private normalizeOptional(value: unknown, allowed: string[]) {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!normalized || normalized === 'ALL') return null;
    return allowed.includes(normalized) ? normalized : null;
  }

  private cleanString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private numberValue(value: unknown) {
    if (value === null || value === undefined) return 0;
    const next = Number(value);
    return Number.isFinite(next) ? Math.round(next * 100) / 100 : 0;
  }
}
