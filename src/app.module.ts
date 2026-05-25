import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CompanyModule } from './company/company.module';
import { ClientsModule } from './clients/clients.module';
import { ItemsModule } from './items/items.module';
import { TaxesModule } from './taxes/taxes.module';
import { InvoicesModule } from './invoices/invoices.module';
import { InvoiceTemplatesModule } from './templates/templates.module';
import { BillMatchingModule } from './matching/matching.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SettingsModule } from './settings/settings.module';
import { GlobalSearchModule } from './search/search.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    AuthModule,
    CompanyModule,
    ClientsModule,
    ItemsModule,
    TaxesModule,
    InvoicesModule,
    InvoiceTemplatesModule,
    BillMatchingModule,
    DashboardModule,
    SettingsModule,
    GlobalSearchModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}