import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const membership = await this.getMembership(userId);
    const notifications = await this.buildNotifications(membership.companyId);
    const reads = await (this.prisma as any).notificationRead.findMany({
      where: { userId, companyId: membership.companyId, notificationKey: { in: notifications.map((notification) => notification.key) } },
      select: { notificationKey: true, readAt: true },
    });
    const readMap = new Map(reads.map((read: any) => [read.notificationKey, read.readAt]));
    const withReadState = notifications.map((notification) => ({
      ...notification,
      read: readMap.has(notification.key),
      readAt: readMap.get(notification.key) || null,
    }));

    return {
      notifications: withReadState,
      summary: {
        total: withReadState.length,
        unread: withReadState.filter((notification) => !notification.read).length,
      },
    };
  }

  async markRead(userId: string, body: Record<string, unknown>) {
    const key = String(body.key || '').trim();
    if (!key) throw new BadRequestException('Notification key is required');
    const membership = await this.getMembership(userId);
    await (this.prisma as any).notificationRead.upsert({
      where: { userId_companyId_notificationKey: { userId, companyId: membership.companyId, notificationKey: key } },
      create: { userId, companyId: membership.companyId, notificationKey: key },
      update: { readAt: new Date() },
    });
    return this.list(userId);
  }

  async markAllRead(userId: string) {
    const membership = await this.getMembership(userId);
    const notifications = await this.buildNotifications(membership.companyId);
    await Promise.all(
      notifications.map((notification) =>
        (this.prisma as any).notificationRead.upsert({
          where: { userId_companyId_notificationKey: { userId, companyId: membership.companyId, notificationKey: notification.key } },
          create: { userId, companyId: membership.companyId, notificationKey: notification.key },
          update: { readAt: new Date() },
        }),
      ),
    );
    return this.list(userId);
  }

  private async buildNotifications(companyId: string) {
    const now = new Date();
    const [overdueInvoices, pendingInvoices, draftInvoices, unmatchedBills, disputedBills] = await Promise.all([
      (this.prisma as any).invoice.findMany({
        where: { companyId, status: { in: ['OVERDUE', 'SENT', 'FINALIZED', 'PARTIALLY_PAID'] }, dueDate: { lt: now }, amountDue: { gt: 0 } },
        include: { client: true },
        orderBy: { dueDate: 'asc' },
        take: 5,
      }),
      (this.prisma as any).invoice.findMany({
        where: { companyId, status: { in: ['SENT', 'FINALIZED', 'PARTIALLY_PAID'] }, amountDue: { gt: 0 } },
        include: { client: true },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
      (this.prisma as any).invoice.findMany({
        where: { companyId, status: 'DRAFT' },
        include: { client: true },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
      (this.prisma as any).billEntry.findMany({
        where: { companyId, status: 'ACTIVE', matchStatus: 'UNMATCHED' },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
      (this.prisma as any).billEntry.findMany({
        where: { companyId, status: 'ACTIVE', matchStatus: 'DISCREPANCY' },
        include: { discrepancies: { where: { resolved: false }, take: 2 } },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
    ]);

    const notifications = [
      ...overdueInvoices.map((invoice: any) => ({
        key: `overdue:${invoice.id}`,
        type: 'OVERDUE_INVOICE',
        title: `Overdue invoice ${invoice.invoiceNumber}`,
        description: `${invoice.client?.companyName || 'Client'} has ${Number(invoice.amountDue || invoice.grandTotal || 0).toLocaleString()} due.`,
        severity: 'HIGH',
        href: `/dashboard/invoices/${invoice.id}`,
        relatedId: invoice.id,
        createdAt: invoice.updatedAt,
      })),
      ...unmatchedBills.map((bill: any) => ({
        key: `unmatched-bill:${bill.id}`,
        type: 'UNMATCHED_BILL',
        title: `Unmatched bill ${bill.billNumber}`,
        description: `${bill.partyName} needs invoice matching.`,
        severity: 'MEDIUM',
        href: `/dashboard/matching?search=${encodeURIComponent(bill.billNumber)}`,
        relatedId: bill.id,
        createdAt: bill.updatedAt,
      })),
      ...disputedBills.map((bill: any) => ({
        key: `disputed-bill:${bill.id}`,
        type: 'DISPUTED_BILL',
        title: `Disputed bill ${bill.billNumber}`,
        description: bill.discrepancies?.[0]?.message || `${bill.partyName} has open discrepancy flags.`,
        severity: 'HIGH',
        href: `/dashboard/matching?search=${encodeURIComponent(bill.billNumber)}`,
        relatedId: bill.id,
        createdAt: bill.updatedAt,
      })),
      ...pendingInvoices.map((invoice: any) => ({
        key: `payment-pending:${invoice.id}`,
        type: 'PAYMENT_PENDING',
        title: `Payment pending for ${invoice.invoiceNumber}`,
        description: `${Number(invoice.amountDue || 0).toLocaleString()} still due from ${invoice.client?.companyName || 'client'}.`,
        severity: 'LOW',
        href: `/dashboard/invoices/${invoice.id}`,
        relatedId: invoice.id,
        createdAt: invoice.updatedAt,
      })),
      ...draftInvoices.map((invoice: any) => ({
        key: `draft:${invoice.id}`,
        type: 'DRAFT_INVOICE',
        title: `Draft invoice ${invoice.invoiceNumber}`,
        description: 'Finalize this draft when ready to send.',
        severity: 'LOW',
        href: `/dashboard/invoices/${invoice.id}`,
        relatedId: invoice.id,
        createdAt: invoice.updatedAt,
      })),
    ];

    return notifications
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 20);
  }

  private async getMembership(userId: string) {
    const membership = await (this.prisma as any).companyMember.findFirst({ where: { userId }, include: { company: true }, orderBy: { createdAt: 'asc' } });
    if (!membership) throw new NotFoundException('Company not found for this user');
    return membership;
  }
}
