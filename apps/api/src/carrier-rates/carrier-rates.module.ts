import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CarrierRatesController } from './carrier-rates.controller';
import { CarrierRatesService } from './carrier-rates.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CarrierRatesController],
  providers: [CarrierRatesService],
  exports: [CarrierRatesService],
})
export class CarrierRatesModule {}
