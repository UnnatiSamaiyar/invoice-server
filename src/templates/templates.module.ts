import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InvoiceTemplatesController } from './templates.controller';
import { InvoiceTemplatesService } from './templates.service';

@Module({
  imports: [PrismaModule],
  controllers: [InvoiceTemplatesController],
  providers: [InvoiceTemplatesService],
  exports: [InvoiceTemplatesService],
})
export class InvoiceTemplatesModule {}
