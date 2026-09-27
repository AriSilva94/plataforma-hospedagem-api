import { Controller, Get, Header } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  @Header('Cache-Control', 'no-store')
  getHealth() {
    return { status: 'ok', revision: process.env.APP_REVISION ?? 'unknown' };
  }
}
