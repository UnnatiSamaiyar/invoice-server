//@ts-nocheck
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const taxProfileTypes = [
  'NO_TAX',
  'INDIA_GST',
  'GENERIC_VAT',
  'GENERIC_SALES_TAX',
  'CUSTOM',
] as const;
const calculationModes = ['EXCLUSIVE', 'INCLUSIVE'] as const;
const applicationLevels = ['ITEM_LEVEL', 'INVOICE_LEVEL'] as const;
const taxStatuses = ['ACTIVE', 'INACTIVE'] as const;
const componentTypes = ['CGST', 'SGST', 'IGST', 'VAT', 'SALES_TAX', 'CUSTOM'] as const;

const allowedProfileFields = [
  'name',
  'type',
  'country',
  'region',
  'taxNumberLabel',
  'taxNumber',
  'hsnSacRequired',
  'defaultRate',
  'calculationMode',
  'applicationLevel',
  'isDefault',
  'status',
  'notes',
  'components',
] as const;

type TaxProfileTypeValue = (typeof taxProfileTypes)[number];
type TaxCalculationModeValue = (typeof calculationModes)[number];
type TaxApplicationLevelValue = (typeof applicationLevels)[number];
type TaxStatusValue = (typeof taxStatuses)[number];
type TaxComponentTypeValue = (typeof componentTypes)[number];

type ProfilePayload = Partial<Record<(typeof allowedProfileFields)[number], unknown>>;

type ProfileQuery = {
  search?: string;
  status?: string;
  type?: string;
  includeInactive?: string | boolean;
};

type ComponentPayload = {
  name?: unknown;
  type?: unknown;
  rate?: unknown;
  sortOrder?: unknown;
};

type CalculateLine = {
  description?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  discount?: number | string;
  taxRate?: number | string;
  hsnSacSku?: string;
  isInterState?: boolean;
};

type CalculatePayload = {
  taxProfileId?: string;
  taxType?: TaxProfileTypeValue;
  defaultRate?: number | string;
  calculationMode?: TaxCalculationModeValue;
  applicationLevel?: TaxApplicationLevelValue;
  isInterState?: boolean;
  items?: CalculateLine[];
  invoiceAmount?: number | string;
};

@Injectable()
export class TaxesService {
  constructor(private readonly prisma: PrismaService) {}

  async listProfiles(userId: string, query: ProfileQuery = {}) {
    const membership = await this.findMembership(userId);
    await this.ensureStarterTaxProfiles(membership.company);

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

    if (taxProfileTypes.includes(requestedType as TaxProfileTypeValue)) {
      where.type = requestedType;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { country: { contains: search, mode: 'insensitive' } },
        { region: { contains: search, mode: 'insensitive' } },
        { taxNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [profiles, activeCount, inactiveCount] = await this.prisma.$transaction([
      (this.prisma as any).taxProfile.findMany({
        where,
        include: { components: { orderBy: { sortOrder: 'asc' } } },
        orderBy: [{ isDefault: 'desc' }, { status: 'asc' }, { updatedAt: 'desc' }],
      }),
      (this.prisma as any).taxProfile.count({
        where: { companyId: membership.companyId, status: 'ACTIVE' },
      }),
      (this.prisma as any).taxProfile.count({
        where: { companyId: membership.companyId, status: 'INACTIVE' },
      }),
    ]);

    return {
      profiles: profiles.map((profile: any) => this.serializeProfile(profile)),
      summary: {
        activeCount,
        inactiveCount,
        totalCount: activeCount + inactiveCount,
        defaultProfileId: profiles.find((profile: any) => profile.isDefault)?.id || null,
      },
    };
  }

  async getProfile(userId: string, profileId: string) {
    const membership = await this.findMembership(userId);
    const profile = await this.findProfileForCompany(profileId, membership.companyId);
    return this.serializeProfile(profile);
  }

  async createProfile(userId: string, body: ProfilePayload = {}) {
    const membership = await this.findMembership(userId);
    const { components, shouldReplaceComponents: _ignored, ...data } = this.buildProfileData(body, true);

    if (data.isDefault) {
      await this.unsetCompanyDefault(membership.companyId);
    }

    const profile = await (this.prisma as any).taxProfile.create({
      data: {
        ...data,
        companyId: membership.companyId,
        components: {
          create: components,
        },
      },
      include: { components: { orderBy: { sortOrder: 'asc' } } },
    });

    return this.serializeProfile(profile);
  }

  async updateProfile(userId: string, profileId: string, body: ProfilePayload = {}) {
    const membership = await this.findMembership(userId);
    await this.findProfileForCompany(profileId, membership.companyId);
    const { components, shouldReplaceComponents, ...data } = this.buildProfileData(body, false);

    if (Object.keys(data).length === 0 && !shouldReplaceComponents) {
      throw new BadRequestException('No tax profile fields were provided');
    }

    if (data.isDefault) {
      await this.unsetCompanyDefault(membership.companyId, profileId);
    }

    const profile = await (this.prisma as any).taxProfile.update({
      where: { id: profileId },
      data: {
        ...data,
        ...(shouldReplaceComponents
          ? {
              components: {
                deleteMany: {},
                create: components,
              },
            }
          : {}),
      },
      include: { components: { orderBy: { sortOrder: 'asc' } } },
    });

    return this.serializeProfile(profile);
  }

  async deactivateProfile(userId: string, profileId: string) {
    const membership = await this.findMembership(userId);
    const current = await this.findProfileForCompany(profileId, membership.companyId);

    if (current.isDefault) {
      throw new BadRequestException('Default tax profile cannot be deactivated. Set another default first.');
    }

    const profile = await (this.prisma as any).taxProfile.update({
      where: { id: profileId },
      data: { status: 'INACTIVE' },
      include: { components: { orderBy: { sortOrder: 'asc' } } },
    });

    return this.serializeProfile(profile);
  }

  async activateProfile(userId: string, profileId: string) {
    const membership = await this.findMembership(userId);
    await this.findProfileForCompany(profileId, membership.companyId);

    const profile = await (this.prisma as any).taxProfile.update({
      where: { id: profileId },
      data: { status: 'ACTIVE' },
      include: { components: { orderBy: { sortOrder: 'asc' } } },
    });

    return this.serializeProfile(profile);
  }

  async calculateTax(userId: string, body: CalculatePayload = {}) {
    const membership = await this.findMembership(userId);
    await this.ensureStarterTaxProfiles(membership.company);

    const profile = body.taxProfileId
      ? await this.findProfileForCompany(body.taxProfileId, membership.companyId)
      : await this.resolveCalculationProfile(membership.companyId, body);

    const mode = this.normalizeEnum(
      body.calculationMode || profile.calculationMode,
      calculationModes,
      'Tax calculation mode',
    ) as TaxCalculationModeValue;

    const applicationLevel = this.normalizeEnum(
      body.applicationLevel || profile.applicationLevel,
      applicationLevels,
      'Tax application level',
    ) as TaxApplicationLevelValue;

    const lines = Array.isArray(body.items) && body.items.length
      ? body.items
      : [{ quantity: 1, unitPrice: body.invoiceAmount ?? 0, description: 'Invoice subtotal' }];

    if (!lines.length) {
      throw new BadRequestException('At least one invoice line or invoice amount is required');
    }

    if (applicationLevel === 'INVOICE_LEVEL') {
      return this.calculateInvoiceLevel(profile, mode, lines, Boolean(body.isInterState));
    }

    return this.calculateItemLevel(profile, mode, lines, Boolean(body.isInterState));
  }

  private calculateItemLevel(profile: any, mode: TaxCalculationModeValue, lines: CalculateLine[], invoiceInterState: boolean) {
    let subTotal = 0;
    let taxTotal = 0;
    let total = 0;
    const componentTotals = new Map<string, number>();

    const items = lines.map((line, index) => {
      const quantity = this.numberFrom(line.quantity ?? 1, 'Quantity', 0, 999999999);
      const unitPrice = this.numberFrom(line.unitPrice ?? 0, 'Unit price', 0, 999999999999);
      const discount = this.numberFrom(line.discount ?? 0, 'Discount', 0, 999999999999);
      const lineAmount = Math.max(quantity * unitPrice - discount, 0);
      const rate = this.numberFrom(line.taxRate ?? profile.defaultRate ?? 0, 'Tax rate', 0, 100);
      const calculation = this.calculateAmount(lineAmount, rate, mode);
      const components = this.componentsForProfile(profile, rate, Boolean(line.isInterState ?? invoiceInterState));
      const normalizedComponents = this.allocateComponents(components, calculation.taxAmount, componentTotals);

      subTotal += calculation.taxableAmount;
      taxTotal += calculation.taxAmount;
      total += calculation.totalAmount;

      return {
        lineNo: index + 1,
        description: line.description || `Line item ${index + 1}`,
        quantity,
        unitPrice: this.round2(unitPrice),
        discount: this.round2(discount),
        hsnSacSku: line.hsnSacSku || null,
        taxableAmount: calculation.taxableAmount,
        taxAmount: calculation.taxAmount,
        totalAmount: calculation.totalAmount,
        effectiveTaxRate: rate,
        components: normalizedComponents,
      };
    });

    return {
      profile: this.serializeProfile(profile),
      calculationMode: mode,
      applicationLevel: 'ITEM_LEVEL',
      items,
      summary: this.buildSummary(subTotal, taxTotal, total, componentTotals),
    };
  }

  private calculateInvoiceLevel(profile: any, mode: TaxCalculationModeValue, lines: CalculateLine[], invoiceInterState: boolean) {
    const grossOrNetAmount = lines.reduce((sum, line) => {
      const quantity = this.numberFrom(line.quantity ?? 1, 'Quantity', 0, 999999999);
      const unitPrice = this.numberFrom(line.unitPrice ?? 0, 'Unit price', 0, 999999999999);
      const discount = this.numberFrom(line.discount ?? 0, 'Discount', 0, 999999999999);
      return sum + Math.max(quantity * unitPrice - discount, 0);
    }, 0);

    const rate = this.numberFrom(profile.defaultRate ?? 0, 'Tax rate', 0, 100);
    const calculation = this.calculateAmount(grossOrNetAmount, rate, mode);
    const componentTotals = new Map<string, number>();
    const components = this.allocateComponents(
      this.componentsForProfile(profile, rate, invoiceInterState),
      calculation.taxAmount,
      componentTotals,
    );

    return {
      profile: this.serializeProfile(profile),
      calculationMode: mode,
      applicationLevel: 'INVOICE_LEVEL',
      items: lines.map((line, index) => ({
        lineNo: index + 1,
        description: line.description || `Line item ${index + 1}`,
        quantity: this.numberFrom(line.quantity ?? 1, 'Quantity', 0, 999999999),
        unitPrice: this.round2(this.numberFrom(line.unitPrice ?? 0, 'Unit price', 0, 999999999999)),
        discount: this.round2(this.numberFrom(line.discount ?? 0, 'Discount', 0, 999999999999)),
        hsnSacSku: line.hsnSacSku || null,
      })),
      invoiceTax: {
        taxableAmount: calculation.taxableAmount,
        taxAmount: calculation.taxAmount,
        totalAmount: calculation.totalAmount,
        effectiveTaxRate: rate,
        components,
      },
      summary: this.buildSummary(calculation.taxableAmount, calculation.taxAmount, calculation.totalAmount, componentTotals),
    };
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
      const taxableAmount = amount / (1 + rate / 100);
      const taxAmount = amount - taxableAmount;
      return {
        taxableAmount: this.round2(taxableAmount),
        taxAmount: this.round2(taxAmount),
        totalAmount: this.round2(amount),
      };
    }

    const taxAmount = amount * (rate / 100);
    return {
      taxableAmount: this.round2(amount),
      taxAmount: this.round2(taxAmount),
      totalAmount: this.round2(amount + taxAmount),
    };
  }

  private componentsForProfile(profile: any, rate: number, isInterState: boolean) {
    const profileType = String(profile.type || 'CUSTOM');

    if (profileType === 'NO_TAX' || rate <= 0) {
      return [];
    }

    if (profileType === 'INDIA_GST') {
      if (isInterState) {
        return [{ name: 'IGST', type: 'IGST', rate, sortOrder: 1 }];
      }

      return [
        { name: 'CGST', type: 'CGST', rate: rate / 2, sortOrder: 1 },
        { name: 'SGST', type: 'SGST', rate: rate / 2, sortOrder: 2 },
      ];
    }

    if (Array.isArray(profile.components) && profile.components.length) {
      return profile.components.map((component: any) => ({
        name: component.name,
        type: component.type,
        rate: Number(component.rate || 0),
        sortOrder: Number(component.sortOrder || 0),
      }));
    }

    if (profileType === 'GENERIC_VAT') {
      return [{ name: 'VAT', type: 'VAT', rate, sortOrder: 1 }];
    }

    if (profileType === 'GENERIC_SALES_TAX') {
      return [{ name: 'Sales Tax', type: 'SALES_TAX', rate, sortOrder: 1 }];
    }

    return [{ name: 'Custom Tax', type: 'CUSTOM', rate, sortOrder: 1 }];
  }

  private allocateComponents(components: Array<{ name: string; type: string; rate: number; sortOrder: number }>, taxAmount: number, componentTotals: Map<string, number>) {
    const totalRate = components.reduce((sum, component) => sum + Number(component.rate || 0), 0);

    return components.map((component) => {
      const componentAmount = totalRate > 0 ? this.round2(taxAmount * (Number(component.rate || 0) / totalRate)) : 0;
      const key = component.name || component.type;
      componentTotals.set(key, this.round2((componentTotals.get(key) || 0) + componentAmount));
      return {
        name: component.name,
        type: component.type,
        rate: this.round2(Number(component.rate || 0)),
        amount: componentAmount,
      };
    });
  }

  private buildSummary(subTotal: number, taxTotal: number, total: number, componentTotals: Map<string, number>) {
    return {
      subTotal: this.round2(subTotal),
      taxTotal: this.round2(taxTotal),
      total: this.round2(total),
      componentTotals: Array.from(componentTotals.entries()).map(([name, amount]) => ({
        name,
        amount: this.round2(amount),
      })),
    };
  }

  private async resolveCalculationProfile(companyId: string, body: CalculatePayload) {
    if (body.taxType) {
      const requestedType = this.normalizeEnum(body.taxType, taxProfileTypes, 'Tax type');
      const profile = await (this.prisma as any).taxProfile.findFirst({
        where: { companyId, type: requestedType, status: 'ACTIVE' },
        include: { components: { orderBy: { sortOrder: 'asc' } } },
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      });

      if (profile) {
        return profile;
      }
    }

    const defaultProfile = await (this.prisma as any).taxProfile.findFirst({
      where: { companyId, isDefault: true, status: 'ACTIVE' },
      include: { components: { orderBy: { sortOrder: 'asc' } } },
    });

    if (defaultProfile) {
      return defaultProfile;
    }

    throw new NotFoundException('No active tax profile found');
  }

  private buildProfileData(body: ProfilePayload, isCreate: boolean) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Invalid tax profile payload');
    }

    const data: Record<string, unknown> = {};
    let shouldReplaceComponents = false;

    for (const field of allowedProfileFields) {
      if (!Object.prototype.hasOwnProperty.call(body, field)) {
        continue;
      }

      if (field === 'components') {
        shouldReplaceComponents = true;
        continue;
      }

      data[field] = this.normalizeProfileField(field, body[field]);
    }

    if (isCreate) {
      data.type = data.type || 'CUSTOM';
      data.name = data.name || this.defaultProfileName(data.type as TaxProfileTypeValue);
      data.country = data.country ?? null;
      data.taxNumberLabel = data.taxNumberLabel || this.defaultTaxNumberLabel(data.type as TaxProfileTypeValue);
      data.hsnSacRequired = data.hsnSacRequired ?? data.type === 'INDIA_GST';
      data.defaultRate = data.defaultRate ?? this.defaultRateForType(data.type as TaxProfileTypeValue).toFixed(2);
      data.calculationMode = data.calculationMode || 'EXCLUSIVE';
      data.applicationLevel = data.applicationLevel || 'ITEM_LEVEL';
      data.isDefault = data.isDefault ?? false;
      data.status = data.status || 'ACTIVE';
    }

    if (!data.name && isCreate) {
      throw new BadRequestException('Tax profile name is required');
    }

    if (typeof data.name === 'string' && data.name.trim().length < 2) {
      throw new BadRequestException('Tax profile name must be at least 2 characters');
    }

    const profileType = (data.type as TaxProfileTypeValue) || (typeof body.type === 'string' ? body.type.toUpperCase() : 'CUSTOM');
    const rate = Number(data.defaultRate ?? body.defaultRate ?? this.defaultRateForType(profileType as TaxProfileTypeValue));
    const components = shouldReplaceComponents
      ? this.normalizeComponents(body.components, profileType as TaxProfileTypeValue, rate)
      : isCreate
        ? this.defaultComponents(profileType as TaxProfileTypeValue, rate)
        : [];

    return {
      ...data,
      components,
      shouldReplaceComponents,
    };
  }

  private normalizeProfileField(field: string, value: unknown) {
    if (value === undefined) {
      return undefined;
    }

    if (field === 'type') {
      return this.normalizeEnum(value, taxProfileTypes, 'Tax type');
    }

    if (field === 'calculationMode') {
      return this.normalizeEnum(value, calculationModes, 'Tax calculation mode');
    }

    if (field === 'applicationLevel') {
      return this.normalizeEnum(value, applicationLevels, 'Tax application level');
    }

    if (field === 'status') {
      return this.normalizeEnum(value, taxStatuses, 'Tax profile status');
    }

    if (field === 'defaultRate') {
      return this.numberFrom(value, 'Default tax rate', 0, 100).toFixed(2);
    }

    if (field === 'hsnSacRequired' || field === 'isDefault') {
      return this.toBoolean(value);
    }

    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();

    if (field === 'name') {
      if (trimmed.length < 2) {
        throw new BadRequestException('Tax profile name must be at least 2 characters');
      }
      return trimmed;
    }

    return trimmed.length ? trimmed : null;
  }

  private normalizeComponents(value: unknown, profileType: TaxProfileTypeValue, defaultRate: number) {
    if (!Array.isArray(value)) {
      return this.defaultComponents(profileType, defaultRate);
    }

    const components = value
      .map((component: ComponentPayload, index: number) => {
        const name = typeof component.name === 'string' ? component.name.trim() : '';
        const type = this.normalizeEnum(component.type || 'CUSTOM', componentTypes, 'Tax component type') as TaxComponentTypeValue;
        const rate = this.numberFrom(component.rate ?? 0, 'Component tax rate', 0, 100);
        const sortOrder = Number.isFinite(Number(component.sortOrder)) ? Number(component.sortOrder) : index + 1;

        if (!name || rate <= 0) {
          return null;
        }

        return {
          name,
          type,
          rate: rate.toFixed(2),
          sortOrder,
        };
      })
      .filter(Boolean);

    return components.length ? components : this.defaultComponents(profileType, defaultRate);
  }

  private defaultComponents(profileType: TaxProfileTypeValue, rate: number) {
    if (profileType === 'NO_TAX' || rate <= 0) {
      return [];
    }

    if (profileType === 'INDIA_GST') {
      return [
        { name: 'CGST', type: 'CGST', rate: (rate / 2).toFixed(2), sortOrder: 1 },
        { name: 'SGST', type: 'SGST', rate: (rate / 2).toFixed(2), sortOrder: 2 },
        { name: 'IGST', type: 'IGST', rate: rate.toFixed(2), sortOrder: 3 },
      ];
    }

    if (profileType === 'GENERIC_VAT') {
      return [{ name: 'VAT', type: 'VAT', rate: rate.toFixed(2), sortOrder: 1 }];
    }

    if (profileType === 'GENERIC_SALES_TAX') {
      return [{ name: 'Sales Tax', type: 'SALES_TAX', rate: rate.toFixed(2), sortOrder: 1 }];
    }

    return [{ name: 'Custom Tax', type: 'CUSTOM', rate: rate.toFixed(2), sortOrder: 1 }];
  }

  private async ensureStarterTaxProfiles(company: any) {
    const existingCount = await (this.prisma as any).taxProfile.count({
      where: { companyId: company.id },
    });

    if (existingCount > 0) {
      return;
    }

    const country = company.country || 'India';
    const shouldDefaultToIndiaGst = String(country).toLowerCase().includes('india');

    const starterProfiles = [
      {
        name: 'No Tax',
        type: 'NO_TAX',
        country: null,
        taxNumberLabel: null,
        taxNumber: null,
        hsnSacRequired: false,
        defaultRate: '0.00',
        calculationMode: 'EXCLUSIVE',
        applicationLevel: 'ITEM_LEVEL',
        isDefault: false,
        status: 'ACTIVE',
        notes: 'Use this profile for non-taxable invoices and zero-rated line items.',
        components: [],
      },
      {
        name: 'India GST',
        type: 'INDIA_GST',
        country: 'India',
        taxNumberLabel: 'GSTIN',
        taxNumber: company.taxNumber || null,
        hsnSacRequired: true,
        defaultRate: '18.00',
        calculationMode: 'EXCLUSIVE',
        applicationLevel: 'ITEM_LEVEL',
        isDefault: shouldDefaultToIndiaGst,
        status: 'ACTIVE',
        notes: 'Supports CGST, SGST, IGST, GST number, and HSN/SAC codes.',
        components: this.defaultComponents('INDIA_GST', 18),
      },
      {
        name: 'Generic VAT',
        type: 'GENERIC_VAT',
        country: null,
        taxNumberLabel: 'VAT NO',
        taxNumber: null,
        hsnSacRequired: false,
        defaultRate: '20.00',
        calculationMode: 'EXCLUSIVE',
        applicationLevel: 'ITEM_LEVEL',
        isDefault: !shouldDefaultToIndiaGst,
        status: 'ACTIVE',
        notes: 'Reusable VAT profile for non-India jurisdictions.',
        components: this.defaultComponents('GENERIC_VAT', 20),
      },
      {
        name: 'Generic Sales Tax',
        type: 'GENERIC_SALES_TAX',
        country: null,
        taxNumberLabel: 'Sales Tax ID',
        taxNumber: null,
        hsnSacRequired: false,
        defaultRate: '7.25',
        calculationMode: 'EXCLUSIVE',
        applicationLevel: 'INVOICE_LEVEL',
        isDefault: false,
        status: 'ACTIVE',
        notes: 'Destination or state-based sales tax profile.',
        components: this.defaultComponents('GENERIC_SALES_TAX', 7.25),
      },
      {
        name: 'Custom Tax',
        type: 'CUSTOM',
        country: null,
        taxNumberLabel: 'Tax ID',
        taxNumber: null,
        hsnSacRequired: false,
        defaultRate: '10.00',
        calculationMode: 'EXCLUSIVE',
        applicationLevel: 'ITEM_LEVEL',
        isDefault: false,
        status: 'ACTIVE',
        notes: 'Editable profile for custom business-specific taxes.',
        components: this.defaultComponents('CUSTOM', 10),
      },
    ];

    for (const profile of starterProfiles) {
      await (this.prisma as any).taxProfile.create({
        data: {
          ...profile,
          companyId: company.id,
          components: { create: profile.components },
        },
      });
    }
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

  private async findProfileForCompany(profileId: string, companyId: string) {
    const profile = await (this.prisma as any).taxProfile.findFirst({
      where: { id: profileId, companyId },
      include: { components: { orderBy: { sortOrder: 'asc' } } },
    });

    if (!profile) {
      throw new NotFoundException('Tax profile not found');
    }

    return profile;
  }

  private async unsetCompanyDefault(companyId: string, exceptProfileId?: string) {
    await (this.prisma as any).taxProfile.updateMany({
      where: {
        companyId,
        isDefault: true,
        ...(exceptProfileId ? { id: { not: exceptProfileId } } : {}),
      },
      data: { isDefault: false },
    });
  }

  private defaultProfileName(type: TaxProfileTypeValue) {
    const labels: Record<TaxProfileTypeValue, string> = {
      NO_TAX: 'No Tax',
      INDIA_GST: 'India GST',
      GENERIC_VAT: 'Generic VAT',
      GENERIC_SALES_TAX: 'Generic Sales Tax',
      CUSTOM: 'Custom Tax',
    };
    return labels[type] || 'Custom Tax';
  }

  private defaultTaxNumberLabel(type: TaxProfileTypeValue) {
    const labels: Record<TaxProfileTypeValue, string | null> = {
      NO_TAX: null,
      INDIA_GST: 'GSTIN',
      GENERIC_VAT: 'VAT NO',
      GENERIC_SALES_TAX: 'Sales Tax ID',
      CUSTOM: 'Tax ID',
    };
    return labels[type];
  }

  private defaultRateForType(type: TaxProfileTypeValue) {
    const rates: Record<TaxProfileTypeValue, number> = {
      NO_TAX: 0,
      INDIA_GST: 18,
      GENERIC_VAT: 20,
      GENERIC_SALES_TAX: 7.25,
      CUSTOM: 10,
    };
    return rates[type] ?? 0;
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

  private normalizeEnum(value: unknown, allowed: readonly string[], label: string) {
    const normalized = String(value || '').trim().toUpperCase();
    if (!allowed.includes(normalized)) {
      throw new BadRequestException(`${label} must be one of: ${allowed.join(', ')}`);
    }
    return normalized;
  }

  private toBoolean(value: unknown) {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    }

    return false;
  }

  private round2(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private serializeProfile(profile: any) {
    return {
      id: profile.id,
      companyId: profile.companyId,
      name: profile.name,
      type: profile.type,
      country: profile.country,
      region: profile.region,
      taxNumberLabel: profile.taxNumberLabel,
      taxNumber: profile.taxNumber,
      hsnSacRequired: Boolean(profile.hsnSacRequired),
      defaultRate: Number(profile.defaultRate || 0),
      calculationMode: profile.calculationMode,
      applicationLevel: profile.applicationLevel,
      isDefault: Boolean(profile.isDefault),
      status: profile.status,
      notes: profile.notes,
      components: Array.isArray(profile.components)
        ? profile.components.map((component: any) => ({
            id: component.id,
            taxProfileId: component.taxProfileId,
            name: component.name,
            type: component.type,
            rate: Number(component.rate || 0),
            sortOrder: Number(component.sortOrder || 0),
          }))
        : [],
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}
