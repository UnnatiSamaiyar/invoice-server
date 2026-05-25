import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BillMatchingController } from './matching.controller';
import { BillMatchingService } from './matching.service';

@Module({
  imports: [PrismaModule],
  controllers: [BillMatchingController],
  providers: [BillMatchingService],
})
export class BillMatchingModule {}
