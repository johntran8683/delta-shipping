import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeliveryNotesController } from './delivery-notes.controller';
import { DeliveryNotesService } from './delivery-notes.service';

@Module({
  imports: [AuthModule],
  controllers: [DeliveryNotesController],
  providers: [DeliveryNotesService],
})
export class DeliveryNotesModule {}
