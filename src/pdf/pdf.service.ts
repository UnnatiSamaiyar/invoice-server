//@ts-nocheck
import { Injectable, NotFoundException } from '@nestjs/common';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

type PdfBuildResult = {
  buffer: Buffer;
  fileName: string;
};

@Injectable()
export class InvoicePdfService {
  constructor(private readonly prisma: PrismaService) {}

  async getPreviewHtml(userId: string, invoiceId: string) {
    const invoice = await this.getInvoiceForUser(userId, invoiceId);
    return this.buildInvoiceHtml(invoice, { autoPrint: false });
  }

  async getPrintableHtml(userId: string, invoiceId: string) {
    const invoice = await this.getInvoiceForUser(userId, invoiceId);
    return this.buildInvoiceHtml(invoice, { autoPrint: true });
  }

  async generatePdf(userId: string, invoiceId: string): Promise<PdfBuildResult> {
    const invoice = await this.getInvoiceForUser(userId, invoiceId);
    const html = this.buildInvoiceHtml(invoice, { autoPrint: false });
    const buffer = await this.renderPdf(html);
    return {
      buffer,
      fileName: this.buildFileName(invoice),
    };
  }

  async savePdfCopy(userId: string, invoiceId: string) {
    const invoice = await this.getInvoiceForUser(userId, invoiceId);
    const html = this.buildInvoiceHtml(invoice, { autoPrint: false });
    const buffer = await this.renderPdf(html);
    const fileName = this.buildFileName(invoice);
    const relativeDir = 'invoices';
    const storageRoot = this.storageRoot();
    const outputDir = join(storageRoot, relativeDir);
    await mkdir(outputDir, { recursive: true });
    const absolutePath = join(outputDir, fileName);
    await writeFile(absolutePath, buffer);

    const updated = await (this.prisma as any).invoice.update({
      where: { id: invoice.id },
      data: {
        pdfFileName: fileName,
        pdfFilePath: `${relativeDir}/${fileName}`,
        pdfGeneratedAt: new Date(),
      },
      include: this.invoiceInclude(),
    });

    return {
      invoiceId: updated.id,
      invoiceNumber: updated.invoiceNumber,
      pdfFileName: updated.pdfFileName,
      pdfFilePath: updated.pdfFilePath,
      pdfGeneratedAt: updated.pdfGeneratedAt,
      message: 'PDF copy saved successfully',
    };
  }

  private async renderPdf(html: string) {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
      await page.setContent(html, { waitUntil: 'networkidle' });
      const buffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '14mm',
          right: '12mm',
          bottom: '14mm',
          left: '12mm',
        },
      });
      return Buffer.from(buffer);
    } finally {
      await browser.close();
    }
  }

  private async getInvoiceForUser(userId: string, invoiceId: string) {
    const membership = await (this.prisma as any).companyMember.findFirst({
      where: { userId },
      include: { company: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!membership) {
      throw new NotFoundException('Company not found for this user');
    }

    const invoice = await (this.prisma as any).invoice.findFirst({
      where: { id: invoiceId, companyId: membership.companyId },
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

  private buildFileName(invoice: any) {
    const cleanInvoiceNumber = this.slug(invoice.invoiceNumber || invoice.id);
    return `${cleanInvoiceNumber}.pdf`;
  }

  private storageRoot() {
    const configured = process.env.LOCAL_STORAGE_PATH || './storage';
    const root = resolve(process.cwd(), configured);
    if (!existsSync(root)) {
      return root;
    }
    return root;
  }

  private buildInvoiceHtml(invoice: any, options: { autoPrint?: boolean } = {}) {
    const company = invoice.company || {};
    const client = invoice.client || {};
    const style = invoice.templateStyle || 'CLASSIC';
    const brand = this.safeHex(invoice.brandColor || '#0B57D0');
    const accentSoft = this.hexToRgba(brand, 0.08);
    const title = this.documentTitle(invoice.documentTitle);
    const currency = invoice.currency || company.currency || 'INR';
    const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
    const componentTotals = this.collectComponentTotals(invoice);
    const isPremium = style === 'PREMIUM';
    const isModern = style === 'MODERN';

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${this.escapeHtml(title)} ${this.escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #eef2ff; color: #0f172a; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { padding: 28px; }
    .page { width: 100%; max-width: 1080px; margin: 0 auto; background: #fff; border-radius: ${isPremium ? '28px' : '22px'}; overflow: hidden; box-shadow: 0 30px 90px rgba(15,23,42,.16); border: 1px solid #e2e8f0; }
    .top-band { height: ${isPremium ? '12px' : isModern ? '8px' : '0'}; background: ${brand}; }
    .wrap { padding: 48px; }
    .header { display: flex; justify-content: space-between; gap: 32px; align-items: flex-start; }
    .brand-row { display: flex; align-items: center; gap: 16px; }
    .logo { width: 76px; height: 76px; border-radius: 20px; object-fit: cover; border: 1px solid #e2e8f0; }
    .logo-fallback { display: flex; align-items: center; justify-content: center; width: 76px; height: 76px; border-radius: 20px; color: #fff; background: ${brand}; font-weight: 800; font-size: 26px; }
    .company-name { margin: 0; font-size: 27px; line-height: 1.12; font-weight: 750; letter-spacing: -.03em; }
    .muted { color: #64748b; }
    .tiny { font-size: 12px; line-height: 1.55; }
    .small { font-size: 14px; line-height: 1.6; }
    .invoice-title { margin: 0; color: ${isModern ? '#0f172a' : brand}; font-size: 48px; letter-spacing: -.055em; line-height: .95; font-weight: 800; text-align: right; }
    .invoice-meta { margin-top: 14px; text-align: right; font-size: 14px; color: #475569; }
    .pill { display: inline-flex; border-radius: 999px; padding: 7px 13px; background: ${accentSoft}; color: ${brand}; font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    .divider { height: 1px; background: #e2e8f0; margin: 36px 0; }
    .grid-2 { display: grid; grid-template-columns: 1.2fr .8fr; gap: 28px; }
    .card { border: 1px solid #e2e8f0; background: ${isPremium ? '#f8fafc' : '#fff'}; border-radius: 20px; padding: 22px; }
    .card-title { margin: 0 0 12px; font-size: 11px; color: #64748b; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
    .strong { font-weight: 750; }
    .table-wrap { margin-top: 34px; overflow: hidden; border-radius: 20px; border: 1px solid #e2e8f0; }
    table { width: 100%; border-collapse: collapse; }
    thead th { background: ${isModern ? '#0f172a' : accentSoft}; color: ${isModern ? '#fff' : '#475569'}; padding: 13px 14px; text-align: left; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; }
    tbody td { padding: 15px 14px; vertical-align: top; border-top: 1px solid #e2e8f0; font-size: 12.5px; color: #334155; }
    .right { text-align: right; }
    .item-name { font-weight: 750; color: #0f172a; font-size: 13.5px; }
    .summary { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 36px; margin-top: 34px; align-items: start; }
    .summary-box { border-radius: 22px; border: 1px solid #e2e8f0; overflow: hidden; }
    .summary-row { display: flex; justify-content: space-between; gap: 18px; padding: 13px 18px; border-top: 1px solid #e2e8f0; font-size: 13px; }
    .summary-row:first-child { border-top: 0; }
    .summary-total { background: ${brand}; color: #fff; font-size: 18px; font-weight: 800; }
    .tax-chips { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
    .tax-chip { border: 1px solid #e2e8f0; border-radius: 999px; padding: 8px 12px; font-size: 12px; color: #475569; background: #fff; }
    .footer-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 18px; margin-top: 34px; }
    .payment-history { margin-top: 28px; border-radius: 20px; border: 1px solid #e2e8f0; overflow: hidden; }
    .payment-history .summary-row { background: #fff; }
    .qr { width: 96px; height: 96px; border: 1px solid #e2e8f0; border-radius: 18px; object-fit: cover; }
    .signature { max-width: 180px; max-height: 76px; object-fit: contain; }
    .signature-line { margin-top: 34px; width: 180px; height: 1px; background: #94a3b8; }
    .terms { margin-top: 30px; border-radius: 20px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 18px 20px; }
    .print-actions { position: fixed; top: 16px; right: 16px; display: flex; gap: 10px; }
    .print-actions button { border: 0; border-radius: 999px; background: ${brand}; color: #fff; padding: 11px 16px; font-weight: 750; cursor: pointer; box-shadow: 0 12px 30px rgba(15,23,42,.22); }
    @media print { body { background: #fff; padding: 0; } .page { max-width: none; border-radius: 0; box-shadow: none; border: 0; } .wrap { padding: 30px 32px; } .print-actions { display: none; } thead { display: table-header-group; } tr { break-inside: avoid; } }
    @page { size: A4; margin: 12mm; }
  </style>
</head>
<body>
  <div class="print-actions"><button onclick="window.print()">Print Invoice</button></div>
  <main class="page">
    <div class="top-band"></div>
    <section class="wrap">
      <header class="header">
        <div>
          <div class="brand-row">
            ${invoice.showLogo ? this.logoHtml(company, brand) : ''}
            <div>
              <h1 class="company-name">${this.escapeHtml(company.legalName || company.name || 'Your Company')}</h1>
              <div class="small muted">${this.escapeHtml(this.address([company.addressLine1, company.addressLine2, company.city, company.state, company.postalCode, company.country]))}</div>
              <div class="tiny muted">${this.escapeHtml(company.workEmail || '')}${company.phone ? ' | ' + this.escapeHtml(company.phone) : ''}${company.taxNumber ? ' | GST/VAT: ' + this.escapeHtml(company.taxNumber) : ''}</div>
            </div>
          </div>
        </div>
        <div>
          <h2 class="invoice-title">${this.escapeHtml(title)}</h2>
          <div class="invoice-meta">
            <div class="strong">#${this.escapeHtml(invoice.invoiceNumber || '')}</div>
            <div style="margin-top:8px"><span class="pill">${this.escapeHtml(this.statusLabel(invoice.status))}</span></div>
          </div>
        </div>
      </header>

      <div class="divider"></div>

      <section class="grid-2">
        <div class="card">
          <p class="card-title">Bill To</p>
          <div class="strong" style="font-size:20px">${this.escapeHtml(client.companyName || 'Client')}</div>
          <div class="small muted">${this.escapeHtml(client.contactPerson || '')}${client.email ? ' | ' + this.escapeHtml(client.email) : ''}${client.phone ? ' | ' + this.escapeHtml(client.phone) : ''}</div>
          <div class="small muted" style="margin-top:8px">${this.escapeHtml(this.address([client.billingAddressLine1, client.billingAddressLine2, client.billingCity, client.billingState, client.billingPostalCode, client.billingCountry]))}</div>
          ${client.taxId ? `<div class="tiny strong" style="margin-top:10px;color:${brand}">Tax ID: ${this.escapeHtml(client.taxId)}</div>` : ''}
        </div>
        <div class="card">
          <p class="card-title">Invoice Details</p>
          <div class="summary-row"><span class="muted">Invoice Date</span><span class="strong">${this.formatDate(invoice.invoiceDate)}</span></div>
          <div class="summary-row"><span class="muted">Due Date</span><span class="strong">${this.formatDate(invoice.dueDate)}</span></div>
          <div class="summary-row"><span class="muted">Currency</span><span class="strong">${this.escapeHtml(currency)}</span></div>
          <div class="summary-row"><span class="muted">Tax Mode</span><span class="strong">${this.escapeHtml(this.taxMode(invoice))}</span></div>
        </div>
      </section>

      <section class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width:28%">Item</th>
              <th>HSN/SAC</th>
              <th class="right">Qty</th>
              <th class="right">Rate</th>
              <th class="right">Discount</th>
              <th class="right">Tax</th>
              <th class="right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${lineItems.map((line: any) => this.lineHtml(line, currency)).join('')}
          </tbody>
        </table>
      </section>

      <section class="summary">
        <div>
          <p class="card-title">Tax Breakdown</p>
          ${componentTotals.length ? `<div class="tax-chips">${componentTotals.map((entry: any) => `<span class="tax-chip">${this.escapeHtml(entry.name)}: ${this.money(entry.amount, currency)}</span>`).join('')}</div>` : '<div class="small muted">No tax applied on this invoice.</div>'}
          ${invoice.notes ? `<div class="terms"><p class="card-title">Notes</p><div class="small muted">${this.escapeHtml(invoice.notes).replace(/\n/g, '<br/>')}</div></div>` : ''}
        </div>
        <div class="summary-box">
          <div class="summary-row"><span>Subtotal</span><span class="strong">${this.money(invoice.subTotal, currency)}</span></div>
          <div class="summary-row"><span>Discount</span><span class="strong">-${this.money(invoice.discountTotal, currency)}</span></div>
          <div class="summary-row"><span>Taxable Amount</span><span class="strong">${this.money(invoice.taxableAmount, currency)}</span></div>
          <div class="summary-row"><span>Tax Total</span><span class="strong">${this.money(invoice.taxTotal, currency)}</span></div>
          <div class="summary-row summary-total"><span>Grand Total</span><span>${this.money(invoice.grandTotal, currency)}</span></div>
          <div class="summary-row"><span>Amount Paid</span><span class="strong">${this.money(invoice.amountPaid, currency)}</span></div>
          <div class="summary-row"><span>Amount Due</span><span class="strong">${this.money(invoice.amountDue, currency)}</span></div>
        </div>
      </section>


      ${Array.isArray(invoice.payments) && invoice.payments.length ? `
      <section class="payment-history">
        <div style="padding:14px 18px;background:${accentSoft};color:${brand};font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">Payment History</div>
        ${invoice.payments.map((payment: any) => `<div class="summary-row"><span>${this.formatDate(payment.paymentDate)} · ${this.escapeHtml(this.paymentModeLabel(payment.paymentMode))}${payment.referenceNumber ? ` · Ref: ${this.escapeHtml(payment.referenceNumber)}` : ''}</span><span class="strong">${this.money(payment.amountReceived, currency)}</span></div>`).join('')}
      </section>` : ''}

      ${(invoice.showBankDetails || invoice.showQrCode || invoice.showSignature) ? `
      <section class="footer-grid">
        ${invoice.showBankDetails ? `<div class="card"><p class="card-title">Payment Details</p><div class="small strong">${this.escapeHtml(company.bankName || 'Bank name not set')}</div><div class="small muted">Holder: ${this.escapeHtml(company.accountHolderName || company.name || '-')}</div><div class="small muted">A/C: ${this.escapeHtml(company.bankAccountNumber || '-')}</div><div class="small muted">IFSC/SWIFT/IBAN: ${this.escapeHtml(company.bankIfscOrSwift || '-')}</div><div class="small muted">UPI/Payment ID: ${this.escapeHtml(company.upiId || '-')}</div>${company.paymentNote ? `<div class="small muted">${this.escapeHtml(company.paymentNote).replace(/\n/g, '<br/>')}</div>` : ''}</div>` : ''}
        ${invoice.showQrCode ? `<div class="card"><p class="card-title">Payment QR</p>${company.qrCodeDataUrl ? `<img class="qr" src="${this.safeDataUrl(company.qrCodeDataUrl)}" />` : '<div class="qr" style="display:flex;align-items:center;justify-content:center;color:#94a3b8">QR</div>'}</div>` : ''}
        ${invoice.showSignature ? `<div class="card"><p class="card-title">Signature</p>${company.signatureDataUrl ? `<img class="signature" src="${this.safeDataUrl(company.signatureDataUrl)}" />` : '<div class="signature-line"></div>'}<div class="tiny muted" style="margin-top:8px">Authorized Signatory</div></div>` : ''}
      </section>` : ''}

      <section class="terms">
        <p class="card-title">Terms</p>
        <div class="small muted">${this.escapeHtml(invoice.terms || company.defaultInvoiceFooter || 'Thank you for your business.').replace(/\n/g, '<br/>')}</div>
      </section>
    </section>
  </main>
  ${options.autoPrint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),350));</script>' : ''}
</body>
</html>`;
  }

  private logoHtml(company: any, brand: string) {
    if (company.logoDataUrl) {
      return `<img class="logo" src="${this.safeDataUrl(company.logoDataUrl)}" />`;
    }
    const initials = String(company.name || 'IP').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'IP';
    return `<div class="logo-fallback">${this.escapeHtml(initials)}</div>`;
  }

  private lineHtml(line: any, currency: string) {
    const taxLabel = this.lineTaxLabel(line);
    return `<tr>
      <td><div class="item-name">${this.escapeHtml(line.itemName || '')}</div><div class="tiny muted">${this.escapeHtml(line.description || '').replace(/\n/g, '<br/>')}</div></td>
      <td>${this.escapeHtml(line.hsnSacSku || '-')}</td>
      <td class="right">${this.numberValue(line.quantity).toFixed(3).replace(/\.000$/, '')} ${this.escapeHtml(line.unit || '')}</td>
      <td class="right">${this.money(line.rate, currency)}</td>
      <td class="right">${this.money(line.discountTotal, currency)}</td>
      <td class="right">${this.escapeHtml(taxLabel)}<br/><span class="tiny muted">${this.money(line.taxAmount, currency)}</span></td>
      <td class="right strong">${this.money(line.totalAmount, currency)}</td>
    </tr>`;
  }

  private lineTaxLabel(line: any) {
    const breakdown = Array.isArray(line.taxBreakdown) ? line.taxBreakdown : [];
    if (breakdown.length) {
      return breakdown.map((item: any) => `${item.name || item.type} ${this.numberValue(item.rate)}%`).join(' + ');
    }
    const rate = this.numberValue(line.taxRate);
    return rate > 0 ? `${rate}%` : 'No tax';
  }

  private collectComponentTotals(invoice: any) {
    const totals = new Map<string, number>();
    const collect = (entries: any[]) => {
      for (const entry of entries || []) {
        const name = entry.name || entry.type || 'Tax';
        totals.set(name, this.round2((totals.get(name) || 0) + this.numberValue(entry.amount)));
      }
    };

    collect(Array.isArray(invoice.invoiceTaxBreakdown) ? invoice.invoiceTaxBreakdown : []);
    for (const line of invoice.lineItems || []) {
      collect(Array.isArray(line.taxBreakdown) ? line.taxBreakdown : []);
    }

    return Array.from(totals.entries()).map(([name, amount]) => ({ name, amount }));
  }

  private taxMode(invoice: any) {
    const mode = invoice.taxCalculationMode === 'INCLUSIVE' ? 'Inclusive' : 'Exclusive';
    const level = invoice.taxApplicationLevel === 'INVOICE_LEVEL' ? 'Invoice-level' : 'Item-level';
    return `${mode}, ${level}`;
  }

  private documentTitle(value: string) {
    if (value === 'TAX_INVOICE') return 'TAX INVOICE';
    if (value === 'BILL') return 'BILL';
    return 'INVOICE';
  }


  private paymentModeLabel(value: string) {
    const labels: Record<string, string> = {
      CASH: 'Cash',
      BANK_TRANSFER: 'Bank Transfer',
      UPI: 'UPI',
      CARD: 'Card',
      CHEQUE: 'Cheque',
      ONLINE: 'Online',
      OTHER: 'Other',
    };
    return labels[value] || String(value || 'Payment').replace(/_/g, ' ');
  }

  private statusLabel(value: string) {
    return String(value || 'DRAFT').replace(/_/g, ' ');
  }

  private address(parts: Array<string | null | undefined>) {
    return parts.filter(Boolean).join(', ') || '-';
  }

  private formatDate(value: unknown) {
    if (!value) return '-';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  private money(value: unknown, currency = 'INR') {
    try {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(this.numberValue(value));
    } catch {
      return `${currency} ${this.numberValue(value).toFixed(2)}`;
    }
  }

  private numberValue(value: unknown) {
    if (value === undefined || value === null) return 0;
    return Number(value) || 0;
  }

  private round2(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private escapeHtml(value: unknown) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private safeDataUrl(value: unknown) {
    const dataUrl = String(value || '');
    if (/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/i.test(dataUrl)) {
      return dataUrl;
    }
    return '';
  }

  private safeHex(value: string) {
    return /^#[0-9A-Fa-f]{6}$/.test(value) ? value.toUpperCase() : '#0B57D0';
  }

  private hexToRgba(hex: string, alpha: number) {
    const normalized = this.safeHex(hex).replace('#', '');
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private slug(value: string) {
    return String(value || 'invoice')
      .trim()
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'invoice';
  }
}
