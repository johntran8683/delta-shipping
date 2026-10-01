import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { DeliveryNotesModule } from './delivery-notes/delivery-notes.module';
import { ImportModule } from './import/import.module';
import { AccessControlModule } from './access-control/access-control.module';
import { MeModule } from './me/me.module';
import { UsersModule } from './users/users.module';
import { CustomersModule } from './customers/customers.module';
import { CarrierRatesModule } from './carrier-rates/carrier-rates.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST ?? '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      },
    }),
    PrismaModule,
    AuthModule,
    DeliveryNotesModule,
    ImportModule,
    UsersModule,
    AccessControlModule,
    MeModule,
    CustomersModule,
    CarrierRatesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
