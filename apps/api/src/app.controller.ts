import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): { ok: boolean; service: string } {
    return { ok: true, service: 'delta-shipping-api' };
  }

  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }
}
