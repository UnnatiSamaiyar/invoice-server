import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const allowedClientFields = [
  'companyName',
  'contactPerson',
  'email',
  'phone',
  'industry',
  'taxId',
  'openingBalance',
  'creditLimit',
  'taxProfileId',
  'billingAddressLine1',
  'billingAddressLine2',
  'billingCity',
  'billingState',
  'billingPostalCode',
  'billingCountry',
  'shippingSameAsBilling',
  'shippingAddressLine1',
  'shippingAddressLine2',
  'shippingCity',
  'shippingState',
  'shippingPostalCode',
  'shippingCountry',
  'defaultCurrency',
  'paymentTerms',
  'notes',
  'status',
] as const;

type ClientQuery = {
  search?: string;
  status?: string;
  includeArchived?: string | boolean;
};

type ClientContactPayload = {
  id?: string;
  name?: unknown;
  role?: unknown;
  email?: unknown;
  phone?: unknown;
  isPrimary?: unknown;
};

type ClientPayload = Partial<Record<(typeof allowedClientFields)[number], unknown>> & {
  contacts?: ClientContactPayload[];
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const statuses = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
type ClientStatusValue = (typeof statuses)[number];

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async listClients(userId: string, query: ClientQuery = {}) {
    const membership = await this.findMembership(userId);
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const includeArchived = this.toBoolean(query.includeArchived);
    const requestedStatus = typeof query.status === 'string' ? query.status.toUpperCase() : '';

    const where: Record<string, unknown> = {
      companyId: membership.companyId,
    };

    if (statuses.includes(requestedStatus as ClientStatusValue)) {
      where.status = requestedStatus;
    } else if (!includeArchived) {
      where.status = { in: ['ACTIVE', 'INACTIVE'] };
    }

    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { taxId: { contains: search, mode: 'insensitive' } },
        { contacts: { some: { name: { contains: search, mode: 'insensitive' } } } },
        { contacts: { some: { email: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const [clients, activeCount, inactiveCount, archivedCount] = await this.prisma.$transaction([
      (this.prisma as any).client.findMany({
        where,
        include: {
          taxProfile: true,
          contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
          invoices: {
            select: {
              id: true,
              invoiceDate: true,
              dueDate: true,
              status: true,
              grandTotal: true,
              amountPaid: true,
              amountDue: true,
            },
          },
        },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      }),
      (this.prisma as any).client.count({ where: { companyId: membership.companyId, status: 'ACTIVE' } }),
      (this.prisma as any).client.count({ where: { companyId: membership.companyId, status: 'INACTIVE' } }),
      (this.prisma as any).client.count({ where: { companyId: membership.companyId, status: 'ARCHIVED' } }),
    ]);

    const clientIds = clients.map((client: any) => client.id);
    const lastPayments = clientIds.length
      ? await this.getLastPaymentDates(membership.companyId, clientIds)
      : new Map<string, Date>();

    return {
      clients: clients.map((client: any) => this.serializeClient(client, { lastPayments })),
      summary: {
        activeCount,
        inactiveCount,
        archivedCount,
        totalCount: activeCount + inactiveCount + archivedCount,
      },
    };
  }

  async getClient(userId: string, clientId: string) {
    const membership = await this.findMembership(userId);
    const client = await this.findClientForCompany(clientId, membership.companyId, true);
    const ledger = await this.buildLedger(membership.companyId, client);
    return this.serializeClient(client, { includeLedger: true, ledger });
  }

  async getClientLedger(userId: string, clientId: string) {
    const membership = await this.findMembership(userId);
    const client = await this.findClientForCompany(clientId, membership.companyId, true);
    return this.buildLedger(membership.companyId, client);
  }

  async createClient(userId: string, body: ClientPayload = {}) {
    const membership = await this.findMembership(userId);
    const { data, contacts } = await this.buildClientData(body, true, membership.companyId);

    const client = await (this.prisma as any).client.create({
      data: {
        ...data,
        companyId: membership.companyId,
        contacts: contacts.length
          ? { create: contacts.map((contact) => this.toContactCreateData(contact)) }
          : undefined,
      },
      include: { taxProfile: true, contacts: true, invoices: true },
    });

    return this.serializeClient(client);
  }

  async updateClient(userId: string, clientId: string, body: ClientPayload = {}) {
    const membership = await this.findMembership(userId);
    await this.findClientForCompany(clientId, membership.companyId);

    const { data, contacts, hasContacts } = await this.buildClientData(body, false, membership.companyId);

    if (Object.keys(data).length === 0 && !hasContacts) {
      throw new BadRequestException('No client fields were provided');
    }

    const client = await this.prisma.$transaction(async (tx: any) => {
      if (hasContacts) {
        await tx.clientContact.deleteMany({ where: { clientId } });
        if (contacts.length) {
          await tx.clientContact.createMany({
            data: contacts.map((contact) => ({
              ...this.toContactCreateData(contact),
              clientId,
            })),
          });
        }
      }

      return tx.client.update({
        where: { id: clientId },
        data,
        include: { taxProfile: true, contacts: true, invoices: true },
      });
    });

    return this.serializeClient(client);
  }

  async setClientStatus(userId: string, clientId: string, status: ClientStatusValue) {
    const membership = await this.findMembership(userId);
    await this.findClientForCompany(clientId, membership.companyId);

    const client = await (this.prisma as any).client.update({
      where: { id: clientId },
      data: {
        status,
        archivedAt: status === 'ARCHIVED' ? new Date() : null,
      },
      include: { taxProfile: true, contacts: true, invoices: true },
    });

    return this.serializeClient(client);
  }

  async archiveClient(userId: string, clientId: string) {
    return this.setClientStatus(userId, clientId, 'ARCHIVED');
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

  private async findClientForCompany(clientId: string, companyId: string, detailed = false) {
    const client = await (this.prisma as any).client.findFirst({
      where: {
        id: clientId,
        companyId,
      },
      include: detailed
        ? {
            taxProfile: true,
            contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
            invoices: {
              include: { payments: true },
              orderBy: { invoiceDate: 'desc' },
            },
          }
        : undefined,
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    return client;
  }

  private async buildClientData(body: ClientPayload, isCreate: boolean, companyId: string) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Invalid client payload');
    }

    const data: Record<string, unknown> = {};

    for (const field of allowedClientFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        data[field] = this.normalizeField(field, body[field]);
      }
    }

    if (isCreate && !data.companyName) {
      throw new BadRequestException('Client company name is required');
    }

    if (typeof data.companyName === 'string' && data.companyName.trim().length < 2) {
      throw new BadRequestException('Client company name must be at least 2 characters');
    }

    if (typeof data.email === 'string' && data.email && !emailRegex.test(data.email)) {
      throw new BadRequestException('Valid client email is required');
    }

    if (data.taxProfileId) {
      const taxProfile = await (this.prisma as any).taxProfile.findFirst({
        where: { id: data.taxProfileId as string, companyId },
      });
      if (!taxProfile) {
        throw new BadRequestException('Selected tax profile does not exist for this company');
      }
    }

    if (isCreate) {
      data.defaultCurrency = data.defaultCurrency || 'INR';
      data.paymentTerms = data.paymentTerms || 'Net 30';
      data.billingCountry = data.billingCountry || 'India';
      data.shippingSameAsBilling = data.shippingSameAsBilling !== false;
      data.openingBalance = data.openingBalance ?? 0;
      data.creditLimit = data.creditLimit ?? 0;
      data.status = data.status || 'ACTIVE';
    }

    if (data.shippingSameAsBilling === true) {
      if (isCreate || Object.prototype.hasOwnProperty.call(data, 'billingAddressLine1')) {
        data.shippingAddressLine1 = data.billingAddressLine1 ?? null;
      }
      if (isCreate || Object.prototype.hasOwnProperty.call(data, 'billingAddressLine2')) {
        data.shippingAddressLine2 = data.billingAddressLine2 ?? null;
      }
      if (isCreate || Object.prototype.hasOwnProperty.call(data, 'billingCity')) {
        data.shippingCity = data.billingCity ?? null;
      }
      if (isCreate || Object.prototype.hasOwnProperty.call(data, 'billingState')) {
        data.shippingState = data.billingState ?? null;
      }
      if (isCreate || Object.prototype.hasOwnProperty.call(data, 'billingPostalCode')) {
        data.shippingPostalCode = data.billingPostalCode ?? null;
      }
      if (isCreate || Object.prototype.hasOwnProperty.call(data, 'billingCountry')) {
        data.shippingCountry = data.billingCountry ?? 'India';
      }
    }

    if (isCreate) {
      data.shippingCountry = data.shippingCountry || data.billingCountry || 'India';
    }

    const hasContacts = Array.isArray(body.contacts);
    const contacts = hasContacts ? this.normalizeContacts(body.contacts || []) : [];

    return { data, contacts, hasContacts };
  }

  private normalizeContacts(contacts: ClientContactPayload[]) {
    const normalized = contacts
      .map((contact, index) => ({
        name: this.stringOrNull(contact.name),
        role: this.stringOrNull(contact.role),
        email: this.normalizeEmail(contact.email),
        phone: this.stringOrNull(contact.phone),
        isPrimary: Boolean(contact.isPrimary) || index === 0,
      }))
      .filter((contact) => contact.name);

    let primarySet = false;
    return normalized.map((contact) => {
      const isPrimary = !primarySet && contact.isPrimary;
      if (isPrimary) primarySet = true;
      return { ...contact, isPrimary };
    });
  }

  private toContactCreateData(contact: any) {
    return {
      name: contact.name,
      role: contact.role,
      email: contact.email,
      phone: contact.phone,
      isPrimary: Boolean(contact.isPrimary),
    };
  }

  private normalizeField(field: string, value: unknown) {
    if (value === undefined) {
      return undefined;
    }

    if (field === 'shippingSameAsBilling') {
      return Boolean(value);
    }

    if (field === 'openingBalance' || field === 'creditLimit') {
      return this.toDecimalNumber(value, field);
    }

    if (field === 'status') {
      const status = String(value || '').toUpperCase();
      if (!statuses.includes(status as ClientStatusValue)) {
        throw new BadRequestException('Client status must be ACTIVE, INACTIVE, or ARCHIVED');
      }
      return status;
    }

    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();

    if (field === 'email') {
      return trimmed ? trimmed.toLowerCase() : null;
    }

    if (field === 'taxProfileId') {
      return trimmed || null;
    }

    if (field === 'defaultCurrency') {
      return trimmed ? trimmed.toUpperCase() : 'INR';
    }

    return trimmed.length ? trimmed : null;
  }

  private toDecimalNumber(value: unknown, label: string) {
    const numberValue = Number(value ?? 0);
    if (!Number.isFinite(numberValue) || numberValue < 0) {
      throw new BadRequestException(`${label} must be a valid positive number`);
    }
    return numberValue;
  }

  private stringOrNull(value: unknown) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private normalizeEmail(value: unknown) {
    const email = this.stringOrNull(value)?.toLowerCase() || null;
    if (email && !emailRegex.test(email)) {
      throw new BadRequestException('Contact email must be valid');
    }
    return email;
  }

  private toBoolean(value: unknown) {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      return ['1', 'true', 'yes'].includes(value.toLowerCase());
    }

    return false;
  }

  private async getLastPaymentDates(companyId: string, clientIds: string[]) {
    const payments = await (this.prisma as any).invoicePayment.findMany({
      where: {
        companyId,
        invoice: { clientId: { in: clientIds } },
      },
      select: {
        paymentDate: true,
        invoice: { select: { clientId: true } },
      },
      orderBy: { paymentDate: 'desc' },
    });

    const map = new Map<string, Date>();
    for (const payment of payments) {
      const clientId = payment.invoice?.clientId;
      if (clientId && !map.has(clientId)) {
        map.set(clientId, payment.paymentDate);
      }
    }
    return map;
  }

  private async buildLedger(companyId: string, client: any) {
    const invoices = client.invoices || [];
    const payments = await (this.prisma as any).invoicePayment.findMany({
      where: { companyId, invoice: { clientId: client.id } },
      include: { invoice: true },
      orderBy: { paymentDate: 'desc' },
    });

    const entries: Array<Record<string, unknown>> = [];

    const openingBalance = this.toNumber(client.openingBalance);
    if (openingBalance > 0) {
      entries.push({
        id: `opening-${client.id}`,
        type: 'OPENING_BALANCE',
        date: client.createdAt,
        reference: 'Opening Balance',
        debit: openingBalance,
        credit: 0,
        balanceImpact: openingBalance,
        status: 'OPEN',
      });
    }

    for (const invoice of invoices) {
      entries.push({
        id: invoice.id,
        type: 'INVOICE',
        date: invoice.invoiceDate,
        reference: invoice.invoiceNumber,
        debit: this.toNumber(invoice.grandTotal),
        credit: 0,
        balanceImpact: this.toNumber(invoice.grandTotal),
        status: invoice.status,
        href: `/dashboard/invoices/${invoice.id}`,
      });
    }

    for (const payment of payments) {
      entries.push({
        id: payment.id,
        type: 'PAYMENT',
        date: payment.paymentDate,
        reference: payment.referenceNumber || payment.invoice?.invoiceNumber || 'Payment',
        debit: 0,
        credit: this.toNumber(payment.amountReceived),
        balanceImpact: -this.toNumber(payment.amountReceived),
        status: payment.paymentMode,
        href: payment.invoiceId ? `/dashboard/invoices/${payment.invoiceId}` : undefined,
      });
    }

    entries.sort((a, b) => new Date(String(b.date)).getTime() - new Date(String(a.date)).getTime());

    let runningBalance = openingBalance + invoices.reduce((sum: number, invoice: any) => sum + this.toNumber(invoice.grandTotal), 0) - payments.reduce((sum: number, payment: any) => sum + this.toNumber(payment.amountReceived), 0);
    const ledger = entries.map((entry) => {
      const withBalance = { ...entry, runningBalance };
      runningBalance -= Number(entry.balanceImpact || 0);
      return withBalance;
    });

    return {
      entries: ledger,
      payments: payments.map((payment: any) => this.serializePayment(payment)),
    };
  }

  private buildStats(client: any, lastPaymentDate?: Date | null) {
    const invoices = client.invoices || [];
    const now = new Date();
    const openingBalance = this.toNumber(client.openingBalance);
    const totalBilledAmount = invoices.reduce((sum: number, invoice: any) => sum + this.toNumber(invoice.grandTotal), 0);
    const totalPaidAmount = invoices.reduce((sum: number, invoice: any) => sum + this.toNumber(invoice.amountPaid), 0);
    const invoiceOutstanding = invoices.reduce((sum: number, invoice: any) => sum + this.toNumber(invoice.amountDue), 0);
    const overdueAmount = invoices.reduce((sum: number, invoice: any) => {
      const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
      const isOpen = !['PAID', 'CANCELLED'].includes(invoice.status);
      return dueDate && dueDate < now && isOpen ? sum + this.toNumber(invoice.amountDue) : sum;
    }, 0);

    const lastInvoiceDate = invoices
      .map((invoice: any) => invoice.invoiceDate)
      .filter(Boolean)
      .sort((a: Date, b: Date) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

    const creditLimit = this.toNumber(client.creditLimit);
    const outstandingAmount = openingBalance + invoiceOutstanding;

    return {
      totalInvoices: invoices.length,
      totalBilledAmount,
      totalPaidAmount,
      outstandingAmount,
      overdueAmount,
      lastInvoiceDate,
      lastPaymentDate: lastPaymentDate || null,
      creditLimit,
      openingBalance,
      creditAvailable: Math.max(creditLimit - outstandingAmount, 0),
      creditUsedPercent: creditLimit > 0 ? Math.min(Math.round((outstandingAmount / creditLimit) * 100), 100) : 0,
    };
  }

  private serializePayment(payment: any) {
    return {
      id: payment.id,
      invoiceId: payment.invoiceId,
      invoiceNumber: payment.invoice?.invoiceNumber,
      paymentDate: payment.paymentDate,
      paymentMode: payment.paymentMode,
      referenceNumber: payment.referenceNumber,
      amountReceived: this.toNumber(payment.amountReceived),
      notes: payment.notes,
      createdAt: payment.createdAt,
    };
  }

  private serializeClient(client: any, options: { lastPayments?: Map<string, Date>; includeLedger?: boolean; ledger?: any } = {}) {
    const lastPaymentDate = options.lastPayments?.get(client.id) || options.ledger?.payments?.[0]?.paymentDate || null;
    const stats = this.buildStats(client, lastPaymentDate);
    const recentInvoices = (client.invoices || [])
      .slice()
      .sort((a: any, b: any) => new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime())
      .slice(0, 10)
      .map((invoice: any) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        status: invoice.status,
        grandTotal: this.toNumber(invoice.grandTotal),
        amountPaid: this.toNumber(invoice.amountPaid),
        amountDue: this.toNumber(invoice.amountDue),
      }));

    return {
      id: client.id,
      companyId: client.companyId,
      companyName: client.companyName,
      contactPerson: client.contactPerson,
      email: client.email,
      phone: client.phone,
      industry: client.industry,
      taxId: client.taxId,
      openingBalance: this.toNumber(client.openingBalance),
      creditLimit: this.toNumber(client.creditLimit),
      taxProfileId: client.taxProfileId,
      taxProfile: client.taxProfile
        ? {
            id: client.taxProfile.id,
            name: client.taxProfile.name,
            type: client.taxProfile.type,
            defaultRate: this.toNumber(client.taxProfile.defaultRate),
          }
        : null,
      billingAddressLine1: client.billingAddressLine1,
      billingAddressLine2: client.billingAddressLine2,
      billingCity: client.billingCity,
      billingState: client.billingState,
      billingPostalCode: client.billingPostalCode,
      billingCountry: client.billingCountry,
      shippingSameAsBilling: client.shippingSameAsBilling,
      shippingAddressLine1: client.shippingAddressLine1,
      shippingAddressLine2: client.shippingAddressLine2,
      shippingCity: client.shippingCity,
      shippingState: client.shippingState,
      shippingPostalCode: client.shippingPostalCode,
      shippingCountry: client.shippingCountry,
      defaultCurrency: client.defaultCurrency,
      paymentTerms: client.paymentTerms,
      notes: client.notes,
      status: client.status,
      archivedAt: client.archivedAt,
      contacts: (client.contacts || []).map((contact: any) => ({
        id: contact.id,
        name: contact.name,
        role: contact.role,
        email: contact.email,
        phone: contact.phone,
        isPrimary: contact.isPrimary,
      })),
      stats,
      recentInvoices,
      ledger: options.includeLedger ? options.ledger?.entries || [] : undefined,
      payments: options.includeLedger ? options.ledger?.payments || [] : undefined,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    };
  }

  private toNumber(value: unknown) {
    if (value === null || value === undefined) return 0;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : 0;
  }
}
