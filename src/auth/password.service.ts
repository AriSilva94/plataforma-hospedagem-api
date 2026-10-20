import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';

@Injectable()
export class PasswordService {
  private dummyHash?: Promise<string>;

  hash(value: string): Promise<string> {
    return argon2.hash(value);
  }

  verify(hash: string, value: string): Promise<boolean> {
    return argon2.verify(hash, value);
  }

  async verifyIfPresent(
    hash: string | null | undefined,
    value: string,
  ): Promise<boolean> {
    if (hash) {
      return this.verify(hash, value);
    }
    this.dummyHash ??= this.hash(randomBytes(32).toString('hex'));
    await this.verify(await this.dummyHash, value);
    return false;
  }
}
