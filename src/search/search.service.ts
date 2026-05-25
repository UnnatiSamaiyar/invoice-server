import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(userId: string, rawQuery: string) {
    const membership = await this.getMembership(userId);
    const companyId = membership.companyId;
    const query = rawQuery.trim();

    if (query.length < 2) {
      return { query, results: [], summary: { total: 0, invoices: 0, clients: 0, items: 0, bills: 0 } };
    }

    const [invoices, clients, items, bills] = await Promise.all([
      (this.prisma as any).invoice.findMany({
        where: {
          companyId,
          OR: [
            { invoiceNumber: { contains: query, mode: 'insensitive' } },
            { client: { companyName: { contains: query, mode: 'insensitive' } } },
          ],
        },
        include: { client: true },
        orderBy: { updatedAt: 'desc' },
        take: 6,
      }),
      (this.prisma as any).client.findMany({
        where: {
          companyId,
          OR: [
            { companyName: { contains: query, mode: 'insensitive' } },
            { contactPerson: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
            { taxId: { contains: query, mode: 'insensitive' } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 6,
      }),
      (this.prisma as any).productItem.findMany({
        where: {
          companyId,
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
            { hsnSacSku: { contains: query, mode: 'insensitive' } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 6,
      }),
      (this.prisma as any).billEntry.findMany({
        where: {
          companyId,
          OR: [
            { partyName: { contains: query, mode: 'insensitive' } },
            { billNumber: { contains: query, mode: 'insensitive' } },
            { paymentReference: { contains: query, mode: 'insensitive' } },
            { invoice: { invoiceNumber: { contains: query, mode: 'insensitive' } } },
          ],
        },
        include: { invoice: true },
        orderBy: { updatedAt: 'desc' },
        take: 6,
      }),
    ]);

    const results = [
      ...invoices.map((invoice: any) => ({
        id: invoice.id,
        type: 'INVOICE',
        title: invoice.invoiceNumber,
        subtitle: invoice.client?.companyName || 'No client selected',
        status: invoice.status,
        amount: Number(invoice.grandTotal || 0),
        href: `/dashboard/invoices/${invoice.id}`,
        meta: invoice.currency || membership.company.currency,
      })),
      ...clients.map((client: any) => ({
        id: client.id,
        type: 'CLIENT',
        title: client.companyName,
        subtitle: client.email || client.contactPerson || 'Client record',
        status: client.status,
        href: `/dashboard/clients?search=${encodeURIComponent(client.companyName)}`,
        meta: client.defaultCurrency,
      })),
      ...items.map((item: any) => ({
        id: item.id,
        type: 'ITEM',
        title: item.name,
        subtitle: item.hsnSacSku || item.description || item.type,
        status: item.status,
        amount: Number(item.defaultPrice || 0),
        href: `/dashboard/products?search=${encodeURIComponent(item.name)}`,
        meta: item.unit,
      })),
      ...bills.map((bill: any) => ({
        id: bill.id,
        type: 'BILL',
        title: bill.billNumber,
        subtitle: bill.partyName,
        status: bill.matchStatus,
        amount: Number(bill.totalAmount || 0),
        href: `/dashboard/matching?search=${encodeURIComponent(bill.billNumber)}`,
        meta: bill.invoice?.invoiceNumber || bill.paymentReference || 'SOA entry',
      })),
    ];

    return {
      query,
      results: results.slice(0, 18),
      summary: { total: results.length, invoices: invoices.length, clients: clients.length, items: items.length, bills: bills.length },
    };
  }

  private async getMembership(userId: string) {
    const membership = await (this.prisma as any).companyMember.findFirst({
      where: { userId },
      include: { company: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!membership) throw new NotFoundException('Company not found for this user');
    return membership;
  }
}
