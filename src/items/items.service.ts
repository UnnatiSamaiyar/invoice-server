import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const allowedItemFields = [
  'type',
  'name',
  'description',
  'hsnSacSku',
  'unit',
  'defaultPrice',
  'defaultTax',
  'status',
] as const;

type ItemPayload = Partial<Record<(typeof allowedItemFields)[number], unknown>>;

type ItemQuery = {
  search?: string;
  status?: string;
  type?: string;
  includeInactive?: string | boolean;
};

@Injectable()
export class ItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async listItems(userId: string, query: ItemQuery = {}) {
    const membership = await this.findMembership(userId);
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const includeInactive = this.toBoolean(query.includeInactive);
    const requestedStatus = typeof query.status === 'string' ? query.status.toUpperCase() : '';
    const requestedType = typeof query.type === 'string' ? query.type.toUpperCase() : '';

    const where: Record<string, unknown> = {
      companyId: membership.companyId,
    };

    if (requestedStatus === 'ACTIVE' || requestedStatus === 'INACTIVE') {
      where.status = requestedStatus;
    } else if (!includeInactive) {
      where.status = 'ACTIVE';
    }

    if (requestedType === 'PRODUCT' || requestedType === 'SERVICE') {
      where.type = requestedType;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { hsnSacSku: { contains: search, mode: 'insensitive' } },
        { unit: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, activeCount, inactiveCount, productCount, serviceCount] = await this.prisma.$transaction([
      (this.prisma as any).productItem.findMany({
        where,
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      }),
      (this.prisma as any).productItem.count({
        where: { companyId: membership.companyId, status: 'ACTIVE' },
      }),
      (this.prisma as any).productItem.count({
        where: { companyId: membership.companyId, status: 'INACTIVE' },
      }),
      (this.prisma as any).productItem.count({
        where: { companyId: membership.companyId, type: 'PRODUCT', status: 'ACTIVE' },
      }),
      (this.prisma as any).productItem.count({
        where: { companyId: membership.companyId, type: 'SERVICE', status: 'ACTIVE' },
      }),
    ]);

    return {
      items: items.map((item: any) => this.serializeItem(item)),
      summary: {
        activeCount,
        inactiveCount,
        totalCount: activeCount + inactiveCount,
        productCount,
        serviceCount,
      },
    };
  }

  async getItem(userId: string, itemId: string) {
    const membership = await this.findMembership(userId);
    const item = await this.findItemForCompany(itemId, membership.companyId);
    return this.serializeItem(item);
  }

  async createItem(userId: string, body: ItemPayload = {}) {
    const membership = await this.findMembership(userId);
    const data = this.buildItemData(body, true);

    const item = await (this.prisma as any).productItem.create({
      data: {
        ...data,
        companyId: membership.companyId,
      },
    });

    return this.serializeItem(item);
  }

  async updateItem(userId: string, itemId: string, body: ItemPayload = {}) {
    const membership = await this.findMembership(userId);
    await this.findItemForCompany(itemId, membership.companyId);

    const data = this.buildItemData(body, false);

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No item fields were provided');
    }

    const item = await (this.prisma as any).productItem.update({
      where: { id: itemId },
      data,
    });

    return this.serializeItem(item);
  }

  async deactivateItem(userId: string, itemId: string) {
    const membership = await this.findMembership(userId);
    await this.findItemForCompany(itemId, membership.companyId);

    const item = await (this.prisma as any).productItem.update({
      where: { id: itemId },
      data: { status: 'INACTIVE' },
    });

    return this.serializeItem(item);
  }

  async activateItem(userId: string, itemId: string) {
    const membership = await this.findMembership(userId);
    await this.findItemForCompany(itemId, membership.companyId);

    const item = await (this.prisma as any).productItem.update({
      where: { id: itemId },
      data: { status: 'ACTIVE' },
    });

    return this.serializeItem(item);
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

  private async findItemForCompany(itemId: string, companyId: string) {
    const item = await (this.prisma as any).productItem.findFirst({
      where: {
        id: itemId,
        companyId,
      },
    });

    if (!item) {
      throw new NotFoundException('Item not found');
    }

    return item;
  }

  private buildItemData(body: ItemPayload, isCreate: boolean) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Invalid item payload');
    }

    const data: Record<string, unknown> = {};

    for (const field of allowedItemFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        data[field] = this.normalizeField(field, body[field]);
      }
    }

    if (isCreate && !data.name) {
      throw new BadRequestException('Item name is required');
    }

    if (typeof data.name === 'string' && data.name.trim().length < 2) {
      throw new BadRequestException('Item name must be at least 2 characters');
    }

    if (isCreate) {
      data.type = data.type || 'SERVICE';
      data.unit = data.unit || 'PCS';
      data.defaultPrice = data.defaultPrice ?? '0.00';
      data.defaultTax = data.defaultTax ?? '0.00';
      data.status = data.status || 'ACTIVE';
    }

    return data;
  }

  private normalizeField(field: string, value: unknown) {
    if (value === undefined) {
      return undefined;
    }

    if (field === 'type') {
      const normalized = String(value || '').trim().toUpperCase();
      if (normalized !== 'PRODUCT' && normalized !== 'SERVICE') {
        throw new BadRequestException('Item type must be PRODUCT or SERVICE');
      }
      return normalized;
    }

    if (field === 'status') {
      const normalized = String(value || '').trim().toUpperCase();
      if (normalized !== 'ACTIVE' && normalized !== 'INACTIVE') {
        throw new BadRequestException('Item status must be ACTIVE or INACTIVE');
      }
      return normalized;
    }

    if (field === 'defaultPrice') {
      return this.normalizeDecimal(value, 'Default price', 0, 999999999999.99);
    }

    if (field === 'defaultTax') {
      return this.normalizeDecimal(value, 'Default tax', 0, 100);
    }

    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();

    if (field === 'name') {
      if (trimmed.length < 2) {
        throw new BadRequestException('Item name must be at least 2 characters');
      }
      return trimmed;
    }

    if (field === 'unit') {
      return trimmed ? trimmed.toUpperCase() : 'PCS';
    }

    return trimmed.length ? trimmed : null;
  }

  private normalizeDecimal(value: unknown, label: string, min: number, max: number) {
    const numberValue = typeof value === 'number' ? value : Number(String(value ?? '').trim());

    if (!Number.isFinite(numberValue)) {
      throw new BadRequestException(`${label} must be a valid number`);
    }

    if (numberValue < min || numberValue > max) {
      throw new BadRequestException(`${label} must be between ${min} and ${max}`);
    }

    return numberValue.toFixed(2);
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

  private serializeItem(item: any) {
    return {
      id: item.id,
      companyId: item.companyId,
      type: item.type,
      name: item.name,
      description: item.description,
      hsnSacSku: item.hsnSacSku,
      unit: item.unit,
      defaultPrice: Number(item.defaultPrice || 0),
      defaultTax: Number(item.defaultTax || 0),
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
