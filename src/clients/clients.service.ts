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
] as const;

type ClientQuery = {
  search?: string;
  status?: string;
  includeArchived?: string | boolean;
};

type ClientPayload = Partial<Record<(typeof allowedClientFields)[number], unknown>>;

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    if (requestedStatus === 'ACTIVE' || requestedStatus === 'ARCHIVED') {
      where.status = requestedStatus;
    } else if (!includeArchived) {
      where.status = 'ACTIVE';
    }

    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { taxId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [clients, activeCount, archivedCount] = await this.prisma.$transaction([
      (this.prisma as any).client.findMany({
        where,
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      }),
      (this.prisma as any).client.count({
        where: { companyId: membership.companyId, status: 'ACTIVE' },
      }),
      (this.prisma as any).client.count({
        where: { companyId: membership.companyId, status: 'ARCHIVED' },
      }),
    ]);

    return {
      clients: clients.map((client: any) => this.serializeClient(client)),
      summary: {
        activeCount,
        archivedCount,
        totalCount: activeCount + archivedCount,
      },
    };
  }

  async getClient(userId: string, clientId: string) {
    const membership = await this.findMembership(userId);
    const client = await this.findClientForCompany(clientId, membership.companyId);
    return this.serializeClient(client);
  }

  async createClient(userId: string, body: ClientPayload = {}) {
    const membership = await this.findMembership(userId);
    const data = this.buildClientData(body, true);

    const client = await (this.prisma as any).client.create({
      data: {
        ...data,
        companyId: membership.companyId,
      },
    });

    return this.serializeClient(client);
  }

  async updateClient(userId: string, clientId: string, body: ClientPayload = {}) {
    const membership = await this.findMembership(userId);
    await this.findClientForCompany(clientId, membership.companyId);

    const data = this.buildClientData(body, false);

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No client fields were provided');
    }

    const client = await (this.prisma as any).client.update({
      where: { id: clientId },
      data,
    });

    return this.serializeClient(client);
  }

  async archiveClient(userId: string, clientId: string) {
    const membership = await this.findMembership(userId);
    await this.findClientForCompany(clientId, membership.companyId);

    const client = await (this.prisma as any).client.update({
      where: { id: clientId },
      data: {
        status: 'ARCHIVED',
        archivedAt: new Date(),
      },
    });

    return this.serializeClient(client);
  }

  async restoreClient(userId: string, clientId: string) {
    const membership = await this.findMembership(userId);
    await this.findClientForCompany(clientId, membership.companyId);

    const client = await (this.prisma as any).client.update({
      where: { id: clientId },
      data: {
        status: 'ACTIVE',
        archivedAt: null,
      },
    });

    return this.serializeClient(client);
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

  private async findClientForCompany(clientId: string, companyId: string) {
    const client = await (this.prisma as any).client.findFirst({
      where: {
        id: clientId,
        companyId,
      },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    return client;
  }

  private buildClientData(body: ClientPayload, isCreate: boolean) {
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

    if (isCreate) {
      data.defaultCurrency = data.defaultCurrency || 'INR';
      data.paymentTerms = data.paymentTerms || 'Net 30';
      data.billingCountry = data.billingCountry || 'India';
      data.shippingSameAsBilling = data.shippingSameAsBilling !== false;
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

    return data;
  }

  private normalizeField(field: string, value: unknown) {
    if (value === undefined) {
      return undefined;
    }

    if (field === 'shippingSameAsBilling') {
      return Boolean(value);
    }

    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();

    if (field === 'email') {
      return trimmed ? trimmed.toLowerCase() : null;
    }

    if (field === 'defaultCurrency') {
      return trimmed ? trimmed.toUpperCase() : 'INR';
    }

    return trimmed.length ? trimmed : null;
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

  private serializeClient(client: any) {
    return {
      id: client.id,
      companyId: client.companyId,
      companyName: client.companyName,
      contactPerson: client.contactPerson,
      email: client.email,
      phone: client.phone,
      industry: client.industry,
      taxId: client.taxId,
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
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    };
  }
}
