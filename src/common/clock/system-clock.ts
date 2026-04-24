import { Injectable } from '@nestjs/common';

@Injectable()
export class SystemClock {
  now(): Date {
    return new Date();
  }
}
