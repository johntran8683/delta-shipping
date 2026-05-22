import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessControlController } from './access-control.controller';
import { AccessControlService } from './access-control.service';

@Module({
  imports: [AuthModule],
  controllers: [AccessControlController],
  providers: [AccessControlService],
})
export class AccessControlModule {}
