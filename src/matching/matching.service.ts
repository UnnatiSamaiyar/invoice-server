//@ts-nocheck
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type BillMatchStatusValue = 'UNMATCHED' | 'SUGGESTED' | 'MATCHED' | 'DISCREPANCY' | 'IGNORED';
type BillEntryStatusValue = 'ACTIVE' | 'ARCHIVED';
type BillDiscrepancyTypeValue =
  | 'AMOUNT_MISMATCH'
  | 'TAX_MISMATCH'
  | 'DUPLICATE_BILL'
  | 'PAYMENT_MISSING'
  | 'INVOICE_MISSING'
  | 'SOA_AMOUNT_MISMATCH';

type BillEntryPayload = {
  invoiceId?: string;
  partyName?: string;
  billNumber?: string;
  billDate?: string;
  amount?: number | string;
  taxAmount?: number | string;
  totalAmount?: number | string;
  paymentReference?: string;
  notes?: string;
};

type BillMatchingQuery = {
  search?: string;
  matchStatus?: string;
  status?: string;
  includeArchived?: string | boolean;
};

const matchStatuses: BillMatchStatusValue[] = ['UNMATCHED', 'SUGGESTED', 'MATCHED', 'DISCREPANCY', 'IGNORED'];
const entryStatuses: BillEntryStatusValue[] = ['ACTIVE', 'ARCHIVED'];
const amountTolerance = 1;

@Injectable()
export class BillMatchingService {
  constructor(private readonly prisma: PrismaService) {}

  async listEntries(userId: string, query: BillMatchingQuery = {}) {
    const membership = await this.findMembership(userId);
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const requestedMatchStatus = typeof query.matchStatus === 'string' ? query.matchStatus.toUpperCase() : '';
    const requestedStatus = typeof query.status === 'string' ? query.status.toUpperCase() : '';
    const includeArchived = this.toBoolean(query.includeArchived);

    const where: Record<string, unknown> = { companyId: membership.companyId };

    if (entryStatuses.includes(requestedStatus as BillEntryStatusValue)) {
      where.status = requestedStatus;
    } else if (!includeArchived) {
      where.status = 'ACTIVE';
    }

    if (matchStatuses.includes(requestedMatchStatus as BillMatchStatusValue)) {
      where.matchStatus = requestedMatchStatus;
    }

    if (search) {
      where.OR = [
        { partyName: { contains: search, mode: 'insensitive' } },
        { billNumber: { contains: search, mode: 'insensitive' } },
        { paymentReference: { contains: search, mode: 'insensitive' } },
        { invoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
        { invoice: { client: { companyName: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const [entries, matchCounts, activeCount, archivedCount, flagsCount] = await this.prisma.$transaction([
      (this.prisma as any).billEntry.findMany({
        where,
        include: this.entryInclude(),
        orderBy: [{ updatedAt: 'desc' }],
        take: 75,
      }),
      (this.prisma as any).billEntry.groupBy({
        by: ['matchStatus'],
        where: { companyId: membership.companyId, status: 'ACTIVE' },
        _count: { _all: true },
      }),
      (this.prisma as any).billEntry.count({ where: { companyId: membership.companyId, status: 'ACTIVE' } }),
      (this.prisma as any).billEntry.count({ where: { companyId: membership.companyId, status: 'ARCHIVED' } }),
      (this.prisma as any).billDiscrepancyFlag.count({
        where: { companyId: membership.companyId, resolved: false },
      }),
    ]);

    const counts = matchStatuses.reduce<Record<string, number>>((acc, status) => {
      acc[status] = 0;
      return acc;
    }, {});

    for (const row of matchCounts as Array<{ matchStatus: string; _count: { _all: number } }>) {
      counts[row.matchStatus] = row._count._all;
    }

    return {
      entries: entries.map((entry: any) => this.serializeEntry(entry)),
      summary: {
        activeCount,
        archivedCount,
        totalCount: activeCount + archivedCount,
        unmatchedCount: counts.UNMATCHED,
        suggestedCount: counts.SUGGESTED,
        matchedCount: counts.MATCHED,
        discrepancyCount: counts.DISCREPANCY,
        ignoredCount: counts.IGNORED,
        openFlagsCount: flagsCount,
      },
    };
  }

  async searchInvoices(userId: string, search = '') {
    const membership = await this.findMembership(userId);
    const value = typeof search === 'string' ? search.trim() : '';
    const where: Record<string, unknown> = {
      companyId: membership.companyId,
      status: { in: ['FINALIZED', 'SENT', 'PAID', 'PARTIALLY_PAID', 'ADVANCE_CREDIT', 'OVERDUE'] },
    };

    if (value) {
      where.OR = [
        { invoiceNumber: { contains: value, mode: 'insensitive' } },
        { client: { companyName: { contains: value, mode: 'insensitive' } } },
      ];
    }

    const invoices = await (this.prisma as any).invoice.findMany({
      where,
      include: { client: true, payments: { orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }] } },
      orderBy: [{ invoiceDate: 'desc' }],
      take: 50,
    });

    return {
      invoices: invoices.map((invoice: any) => this.serializeInvoiceLite(invoice)),
    };
  }

  async searchPartyOptions(userId: string, search = '') {
    const membership = await this.findMembership(userId);
    const value = typeof search === 'string' ? search.trim() : '';
    const where: Record<string, unknown> = {
      companyId: membership.companyId,
      status: 'ACTIVE',
    };

    if (value) {
      where.OR = [
        { companyName: { contains: value, mode: 'insensitive' } },
        { contactPerson: { contains: value, mode: 'insensitive' } },
        { email: { contains: value, mode: 'insensitive' } },
        { phone: { contains: value, mode: 'insensitive' } },
        { taxId: { contains: value, mode: 'insensitive' } },
      ];
    }

    const clients = await (this.prisma as any).client.findMany({
      where,
      orderBy: [{ companyName: 'asc' }],
      take: 50,
    });

    return {
      parties: clients.map((client: any) => this.serializePartyOption(client)),
    };
  }

  async getPartyInvoices(userId: string, query: { clientId?: string; search?: string } = {}) {
    const membership = await this.findMembership(userId);
    const clientId = this.cleanString(query.clientId);
    const value = typeof query.search === 'string' ? query.search.trim() : '';

    const where: Record<string, unknown> = {
      companyId: membership.companyId,
      status: { in: ['FINALIZED', 'SENT', 'PAID', 'PARTIALLY_PAID', 'ADVANCE_CREDIT', 'OVERDUE'] },
    };

    if (clientId) {
      const client = await (this.prisma as any).client.findFirst({
        where: { id: clientId, companyId: membership.companyId, status: 'ACTIVE' },
      });

      if (!client) {
        throw new NotFoundException('Selected party was not found for this company');
      }

      where.clientId = clientId;
    }

    if (value) {
      where.OR = [
        { invoiceNumber: { contains: value, mode: 'insensitive' } },
        { client: { companyName: { contains: value, mode: 'insensitive' } } },
        { payments: { some: { referenceNumber: { contains: value, mode: 'insensitive' } } } },
      ];
    }

    const invoices = await (this.prisma as any).invoice.findMany({
      where,
      include: { client: true, payments: { orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }] } },
      orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
      take: 75,
    });

    return {
      invoices: invoices.map((invoice: any) => this.serializeInvoiceLite(invoice)),
    };
  }

  async getEntry(userId: string, id: string) {
    const membership = await this.findMembership(userId);
    const entry = await this.findEntryForCompany(id, membership.companyId);
    return this.serializeEntry(entry);
  }

  async createEntry(userId: string, body: BillEntryPayload = {}) {
    const membership = await this.findMembership(userId);
    const data = this.buildEntryData(body, true);
    const selectedInvoice = body.invoiceId ? await this.findInvoiceForCompany(body.invoiceId, membership.companyId) : null;

    const created = await (this.prisma as any).billEntry.create({
      data: {
        ...data,
        ...(selectedInvoice ? { invoiceId: selectedInvoice.id, matchStatus: 'MATCHED', matchedAt: new Date() } : {}),
        companyId: membership.companyId,
      },
      include: this.entryInclude(),
    });

    await this.rebuildSuggestionsAndFlags(created.id, membership.companyId);
    const entry = await this.findEntryForCompany(created.id, membership.companyId);
    return this.serializeEntry(entry);
  }

  async updateEntry(userId: string, id: string, body: BillEntryPayload = {}) {
    const membership = await this.findMembership(userId);
    await this.findEntryForCompany(id, membership.companyId);
    const data = this.buildEntryData(body, false);

    if (Object.prototype.hasOwnProperty.call(body, 'invoiceId')) {
      const selectedInvoiceId = this.cleanString(body.invoiceId);
      if (selectedInvoiceId) {
        const selectedInvoice = await this.findInvoiceForCompany(selectedInvoiceId, membership.companyId);
        data.invoiceId = selectedInvoice.id;
        data.matchStatus = 'MATCHED';
        data.matchedAt = new Date();
      } else {
        data.invoiceId = null;
        data.matchStatus = 'UNMATCHED';
        data.matchedAt = null;
      }
    }

    if (!Object.keys(data).length) {
      throw new BadRequestException('No bill fields were provided');
    }

    const updated = await (this.prisma as any).billEntry.update({
      where: { id },
      data,
      include: this.entryInclude(),
    });

    await this.rebuildSuggestionsAndFlags(updated.id, membership.companyId);
    const entry = await this.findEntryForCompany(updated.id, membership.companyId);
    return this.serializeEntry(entry);
  }

  async archiveEntry(userId: string, id: string) {
    const membership = await this.findMembership(userId);
    await this.findEntryForCompany(id, membership.companyId);

    const entry = await (this.prisma as any).billEntry.update({
      where: { id },
      data: {
        status: 'ARCHIVED',
        archivedAt: new Date(),
      },
      include: this.entryInclude(),
    });

    return this.serializeEntry(entry);
  }

  async refreshSuggestions(userId: string, id: string) {
    const membership = await this.findMembership(userId);
    await this.findEntryForCompany(id, membership.companyId);
    await this.rebuildSuggestionsAndFlags(id, membership.companyId);
    const entry = await this.findEntryForCompany(id, membership.companyId);
    return this.serializeEntry(entry);
  }

  async matchInvoice(userId: string, id: string, body: { invoiceId?: string } = {}) {
    const membership = await this.findMembership(userId);
    await this.findEntryForCompany(id, membership.companyId);
    const invoiceId = this.cleanString(body.invoiceId);

    if (!invoiceId) {
      throw new BadRequestException('Invoice is required for manual matching');
    }

    const invoice = await (this.prisma as any).invoice.findFirst({
      where: { id: invoiceId, companyId: membership.companyId },
      include: { client: true, payments: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found for this company');
    }

    await (this.prisma as any).billEntry.update({
      where: { id },
      data: {
        invoiceId,
        matchStatus: 'MATCHED',
        matchedAt: new Date(),
      },
    });

    await this.rebuildSuggestionsAndFlags(id, membership.companyId);
    const entry = await this.findEntryForCompany(id, membership.companyId);
    return this.serializeEntry(entry);
  }

  async unmatchInvoice(userId: string, id: string) {
    const membership = await this.findMembership(userId);
    await this.findEntryForCompany(id, membership.companyId);

    await (this.prisma as any).billEntry.update({
      where: { id },
      data: {
        invoiceId: null,
        matchStatus: 'UNMATCHED',
        matchedAt: null,
      },
    });

    await this.rebuildSuggestionsAndFlags(id, membership.companyId);
    const entry = await this.findEntryForCompany(id, membership.companyId);
    return this.serializeEntry(entry);
  }

  private async rebuildSuggestionsAndFlags(id: string, companyId: string) {
    const entry = await this.findEntryForCompany(id, companyId);

    const suggestions = await this.buildSuggestions(entry, companyId);
    const flags = await this.buildDiscrepancyFlags(entry, companyId, suggestions);

    await this.prisma.$transaction([
      (this.prisma as any).billMatchSuggestion.deleteMany({ where: { billEntryId: id } }),
      (this.prisma as any).billDiscrepancyFlag.deleteMany({ where: { billEntryId: id } }),
      ...(suggestions.length
        ? [
            (this.prisma as any).billMatchSuggestion.createMany({
              data: suggestions.map((suggestion: any) => ({
                companyId,
                billEntryId: id,
                invoiceId: suggestion.invoiceId,
                score: suggestion.score,
                ruleHits: suggestion.ruleHits,
                reasons: suggestion.reasons,
              })),
            }),
          ]
        : []),
      ...(flags.length
        ? [
            (this.prisma as any).billDiscrepancyFlag.createMany({
              data: flags.map((flag: any) => ({
                companyId,
                billEntryId: id,
                type: flag.type,
                message: flag.message,
                severity: flag.severity || 'MEDIUM',
              })),
            }),
          ]
        : []),
    ]);

    const nextStatus = entry.invoiceId
      ? flags.length
        ? 'DISCREPANCY'
        : 'MATCHED'
      : suggestions.length
        ? 'SUGGESTED'
        : flags.some((flag: any) => flag.type === 'INVOICE_MISSING')
          ? 'DISCREPANCY'
          : 'UNMATCHED';

    await (this.prisma as any).billEntry.update({
      where: { id },
      data: { matchStatus: nextStatus },
    });
  }

  private async buildSuggestions(entry: any, companyId: string) {
    const billNumber = this.normalizeText(entry.billNumber);
    const partyName = this.normalizeText(entry.partyName);
    const paymentReference = this.normalizeText(entry.paymentReference);
    const billTotal = this.numberValue(entry.totalAmount);
    const billDate = new Date(entry.billDate);

    const where: Record<string, unknown> = {
      companyId,
      status: { in: ['FINALIZED', 'SENT', 'PAID', 'PARTIALLY_PAID', 'ADVANCE_CREDIT', 'OVERDUE'] },
    };

    const invoices = await (this.prisma as any).invoice.findMany({
      where,
      include: { client: true, payments: true },
      orderBy: [{ invoiceDate: 'desc' }],
      take: 250,
    });

    const suggestions = [];

    for (const invoice of invoices) {
      const invoiceNumber = this.normalizeText(invoice.invoiceNumber);
      const clientName = this.normalizeText(invoice.client?.companyName);
      const invoiceTotal = this.numberValue(invoice.grandTotal);
      const invoiceTax = this.numberValue(invoice.taxTotal);
      const invoiceDate = new Date(invoice.invoiceDate);
      const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
      const paymentRefs = Array.isArray(invoice.payments)
        ? invoice.payments.map((payment: any) => this.normalizeText(payment.referenceNumber)).filter(Boolean)
        : [];

      let score = 0;
      const ruleHits: string[] = [];
      const reasons: string[] = [];

      if (billNumber && invoiceNumber && (billNumber === invoiceNumber || billNumber.includes(invoiceNumber) || invoiceNumber.includes(billNumber))) {
        score += 45;
        ruleHits.push('INVOICE_NUMBER_MATCH');
        reasons.push('Bill number matches invoice number');
      }

      if (paymentReference && invoiceNumber && paymentReference.includes(invoiceNumber)) {
        score += 20;
        ruleHits.push('PAYMENT_REFERENCE_MATCH');
        reasons.push('Payment reference includes invoice number');
      }

      if (paymentReference && paymentRefs.some((reference) => reference && (paymentReference.includes(reference) || reference.includes(paymentReference)))) {
        score += 30;
        if (!ruleHits.includes('PAYMENT_REFERENCE_MATCH')) ruleHits.push('PAYMENT_REFERENCE_MATCH');
        reasons.push('Payment reference matches recorded invoice payment reference');
      }

      if (partyName && clientName && (partyName.includes(clientName) || clientName.includes(partyName))) {
        score += 20;
        ruleHits.push('CLIENT_MATCH');
        reasons.push('Party name matches invoice client');
      }

      if (Math.abs(billTotal - invoiceTotal) <= amountTolerance) {
        score += 25;
        ruleHits.push('AMOUNT_MATCH');
        reasons.push('Bill total matches invoice grand total');
      } else if (invoiceTotal > 0) {
        const variance = Math.abs(billTotal - invoiceTotal) / invoiceTotal;
        if (variance <= 0.03) {
          score += 10;
          ruleHits.push('AMOUNT_NEAR_MATCH');
          reasons.push('Bill total is within 3% of invoice grand total');
        }
      }

      if (this.daysBetween(billDate, invoiceDate) <= 30 || (dueDate && this.daysBetween(billDate, dueDate) <= 30)) {
        score += 10;
        ruleHits.push('DATE_RANGE_MATCH');
        reasons.push('Bill date is within 30 days of invoice date or due date');
      }

      if (Math.abs(this.numberValue(entry.taxAmount) - invoiceTax) <= amountTolerance && invoiceTax > 0) {
        score += 5;
        ruleHits.push('TAX_MATCH');
        reasons.push('Tax amount matches invoice tax total');
      }

      if (score >= 20) {
        suggestions.push({
          invoiceId: invoice.id,
          invoice,
          score: Math.min(score, 100),
          ruleHits,
          reasons,
        });
      }
    }

    suggestions.sort((a, b) => b.score - a.score);
    return suggestions.slice(0, 8);
  }

  private async buildDiscrepancyFlags(entry: any, companyId: string, suggestions: any[]) {
    const flags: Array<{ type: BillDiscrepancyTypeValue; message: string; severity?: string }> = [];
    const amount = this.numberValue(entry.amount);
    const taxAmount = this.numberValue(entry.taxAmount);
    const totalAmount = this.numberValue(entry.totalAmount);
    const calculatedTotal = this.round2(amount + taxAmount);

    if (Math.abs(calculatedTotal - totalAmount) > amountTolerance) {
      flags.push({
        type: 'SOA_AMOUNT_MISMATCH',
        severity: 'HIGH',
        message: `Amount + tax (${this.money(calculatedTotal)}) does not match total amount (${this.money(totalAmount)}).`,
      });
    }

    const duplicate = await (this.prisma as any).billEntry.findFirst({
      where: {
        companyId,
        id: { not: entry.id },
        status: 'ACTIVE',
        billNumber: { equals: entry.billNumber, mode: 'insensitive' },
        partyName: { equals: entry.partyName, mode: 'insensitive' },
      },
    });

    if (duplicate) {
      flags.push({
        type: 'DUPLICATE_BILL',
        severity: 'HIGH',
        message: 'Duplicate bill found with the same party name and bill number.',
      });
    }

    const matchedInvoice = entry.invoiceId
      ? await (this.prisma as any).invoice.findFirst({
          where: { id: entry.invoiceId, companyId },
          include: { client: true, payments: true },
        })
      : null;

    if (matchedInvoice) {
      const invoiceTotal = this.numberValue(matchedInvoice.grandTotal);
      const invoiceTax = this.numberValue(matchedInvoice.taxTotal);

      if (Math.abs(invoiceTotal - totalAmount) > amountTolerance) {
        flags.push({
          type: 'AMOUNT_MISMATCH',
          severity: 'HIGH',
          message: `Matched invoice total (${this.money(invoiceTotal)}) differs from bill total (${this.money(totalAmount)}).`,
        });
      }

      if (Math.abs(invoiceTax - taxAmount) > amountTolerance) {
        flags.push({
          type: 'TAX_MISMATCH',
          severity: 'MEDIUM',
          message: `Matched invoice tax (${this.money(invoiceTax)}) differs from bill tax (${this.money(taxAmount)}).`,
        });
      }

      const paymentReference = this.normalizeText(entry.paymentReference);
      const payments = Array.isArray(matchedInvoice.payments) ? matchedInvoice.payments : [];
      const hasPayment = payments.length > 0 || this.numberValue(matchedInvoice.amountPaid) > 0;
      const hasReferenceMatch = paymentReference
        ? payments.some((payment: any) => {
            const reference = this.normalizeText(payment.referenceNumber);
            return reference && (paymentReference.includes(reference) || reference.includes(paymentReference));
          })
        : false;

      if (!hasPayment) {
        flags.push({
          type: 'PAYMENT_MISSING',
          severity: 'MEDIUM',
          message: 'Matched invoice does not have any recorded payment yet.',
        });
      } else if (paymentReference && !hasReferenceMatch) {
        flags.push({
          type: 'PAYMENT_MISSING',
          severity: 'LOW',
          message: 'Payment exists, but the bill payment reference does not match invoice payment references.',
        });
      }
    } else if (!suggestions.length) {
      flags.push({
        type: 'INVOICE_MISSING',
        severity: 'HIGH',
        message: 'No matching invoice found using invoice number, client, amount, date, or payment reference rules.',
      });
    }

    return flags;
  }

  private buildEntryData(body: BillEntryPayload, isCreate: boolean) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Invalid bill entry payload');
    }

    const data: Record<string, unknown> = {};

    if (Object.prototype.hasOwnProperty.call(body, 'partyName')) data.partyName = this.requiredString(body.partyName, 'Party name');
    if (Object.prototype.hasOwnProperty.call(body, 'billNumber')) data.billNumber = this.requiredString(body.billNumber, 'Bill number');
    if (Object.prototype.hasOwnProperty.call(body, 'billDate')) data.billDate = this.dateFrom(body.billDate, 'Bill date');
    if (Object.prototype.hasOwnProperty.call(body, 'amount')) data.amount = this.numberFrom(body.amount, 'Amount', 0, 999999999999);
    if (Object.prototype.hasOwnProperty.call(body, 'taxAmount')) data.taxAmount = this.numberFrom(body.taxAmount, 'Tax amount', 0, 999999999999);
    if (Object.prototype.hasOwnProperty.call(body, 'totalAmount')) data.totalAmount = this.numberFrom(body.totalAmount, 'Total amount', 0, 999999999999);
    if (Object.prototype.hasOwnProperty.call(body, 'paymentReference')) data.paymentReference = this.optionalString(body.paymentReference, 120);
    if (Object.prototype.hasOwnProperty.call(body, 'notes')) data.notes = this.optionalString(body.notes, 1000);

    if (isCreate) {
      if (!data.partyName) throw new BadRequestException('Party name is required');
      if (!data.billNumber) throw new BadRequestException('Bill number is required');
      data.billDate = data.billDate || new Date();
      data.amount = data.amount ?? 0;
      data.taxAmount = data.taxAmount ?? 0;
      data.totalAmount = data.totalAmount ?? this.round2(Number(data.amount || 0) + Number(data.taxAmount || 0));
    }

    return data;
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

  private async findEntryForCompany(id: string, companyId: string) {
    const entry = await (this.prisma as any).billEntry.findFirst({
      where: { id, companyId },
      include: this.entryInclude(),
    });

    if (!entry) {
      throw new NotFoundException('Bill entry not found');
    }

    return entry;
  }

  private async findInvoiceForCompany(id: string, companyId: string) {
    const invoice = await (this.prisma as any).invoice.findFirst({
      where: { id, companyId },
      include: { client: true, payments: true },
    });

    if (!invoice) {
      throw new NotFoundException('Selected invoice was not found for this company');
    }

    return invoice;
  }

  private entryInclude() {
    return {
      invoice: { include: { client: true, payments: true } },
      suggestions: {
        include: { invoice: { include: { client: true, payments: true } } },
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      },
      discrepancies: { orderBy: [{ createdAt: 'desc' }] },
    };
  }

  private serializeEntry(entry: any) {
    return {
      id: entry.id,
      companyId: entry.companyId,
      invoiceId: entry.invoiceId,
      partyName: entry.partyName,
      billNumber: entry.billNumber,
      billDate: entry.billDate?.toISOString?.() || entry.billDate,
      amount: this.numberValue(entry.amount),
      taxAmount: this.numberValue(entry.taxAmount),
      totalAmount: this.numberValue(entry.totalAmount),
      paymentReference: entry.paymentReference,
      notes: entry.notes,
      status: entry.status,
      matchStatus: entry.matchStatus,
      matchedAt: entry.matchedAt?.toISOString?.() || entry.matchedAt,
      archivedAt: entry.archivedAt?.toISOString?.() || entry.archivedAt,
      createdAt: entry.createdAt?.toISOString?.() || entry.createdAt,
      updatedAt: entry.updatedAt?.toISOString?.() || entry.updatedAt,
      invoice: entry.invoice ? this.serializeInvoiceLite(entry.invoice) : null,
      suggestions: Array.isArray(entry.suggestions) ? entry.suggestions.map((item: any) => this.serializeSuggestion(item)) : [],
      discrepancies: Array.isArray(entry.discrepancies) ? entry.discrepancies.map((flag: any) => this.serializeFlag(flag)) : [],
    };
  }

  private serializeSuggestion(item: any) {
    return {
      id: item.id,
      billEntryId: item.billEntryId,
      invoiceId: item.invoiceId,
      score: item.score,
      ruleHits: item.ruleHits || [],
      reasons: Array.isArray(item.reasons) ? item.reasons : item.reasons || [],
      createdAt: item.createdAt?.toISOString?.() || item.createdAt,
      invoice: item.invoice ? this.serializeInvoiceLite(item.invoice) : null,
    };
  }

  private serializeFlag(flag: any) {
    return {
      id: flag.id,
      billEntryId: flag.billEntryId,
      type: flag.type,
      message: flag.message,
      severity: flag.severity,
      resolved: Boolean(flag.resolved),
      createdAt: flag.createdAt?.toISOString?.() || flag.createdAt,
      updatedAt: flag.updatedAt?.toISOString?.() || flag.updatedAt,
    };
  }

  private serializePartyOption(client: any) {
    return {
      id: client.id,
      companyName: client.companyName,
      contactPerson: client.contactPerson,
      email: client.email,
      phone: client.phone,
      taxId: client.taxId,
      defaultCurrency: client.defaultCurrency,
      paymentTerms: client.paymentTerms,
    };
  }

  private serializeInvoiceLite(invoice: any) {
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate?.toISOString?.() || invoice.invoiceDate,
      dueDate: invoice.dueDate?.toISOString?.() || invoice.dueDate,
      status: invoice.status,
      currency: invoice.currency,
      subTotal: this.numberValue(invoice.subTotal),
      taxTotal: this.numberValue(invoice.taxTotal),
      grandTotal: this.numberValue(invoice.grandTotal),
      amountPaid: this.numberValue(invoice.amountPaid),
      amountDue: this.numberValue(invoice.amountDue),
      client: invoice.client
        ? {
            id: invoice.client.id,
            companyName: invoice.client.companyName,
            taxId: invoice.client.taxId,
          }
        : null,
      payments: Array.isArray(invoice.payments)
        ? invoice.payments.map((payment: any) => ({
            id: payment.id,
            paymentDate: payment.paymentDate?.toISOString?.() || payment.paymentDate,
            paymentMode: payment.paymentMode,
            referenceNumber: payment.referenceNumber,
            amountReceived: this.numberValue(payment.amountReceived),
          }))
        : [],
    };
  }

  private requiredString(value: unknown, label: string) {
    const cleaned = this.cleanString(value);
    if (!cleaned) throw new BadRequestException(`${label} is required`);
    if (cleaned.length < 2) throw new BadRequestException(`${label} must be at least 2 characters`);
    return cleaned;
  }

  private optionalString(value: unknown, max = 255) {
    const cleaned = this.cleanString(value);
    return cleaned ? cleaned.slice(0, max) : null;
  }

  private cleanString(value: unknown) {
    if (typeof value !== 'string') return '';
    return value.trim();
  }

  private normalizeText(value: unknown) {
    return this.cleanString(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private dateFrom(value: unknown, label: string) {
    if (!value || typeof value !== 'string') throw new BadRequestException(`${label} is required`);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${label} is invalid`);
    return date;
  }

  private numberFrom(value: unknown, label: string, min = 0, max = 999999999999) {
    const num = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
    if (!Number.isFinite(num)) throw new BadRequestException(`${label} must be a valid number`);
    if (num < min) throw new BadRequestException(`${label} must be at least ${min}`);
    if (num > max) throw new BadRequestException(`${label} is too large`);
    return this.round2(num);
  }

  private numberValue(value: unknown) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    if (typeof (value as any).toNumber === 'function') return (value as any).toNumber();
    return Number(value) || 0;
  }

  private round2(value: number) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  private money(value: number) {
    return this.round2(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private daysBetween(a: Date, b: Date) {
    return Math.abs(Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24)));
  }

  private toBoolean(value: unknown) {
    return value === true || value === 'true' || value === '1' || value === 1;
  }
}
