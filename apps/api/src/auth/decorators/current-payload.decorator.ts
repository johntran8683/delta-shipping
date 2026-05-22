import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../jwt-payload';

export const CurrentPayload = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const req = ctx.switchToHttp().getRequest<{ user: JwtPayload }>();
    return req.user;
  },
);
