import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

const VIACEP_URL = 'https://viacep.com.br/ws';
const LOOKUP_TIMEOUT_MS = 4000;

interface ViaCepResponse {
  erro?: boolean | string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
}

export interface PostalCodeAddress {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
}

@Injectable()
export class PostalCodeService {
  async lookup(postalCode: string): Promise<PostalCodeAddress> {
    const data = await this.fetchAddress(postalCode);
    if (data.erro) {
      throw new NotFoundException('CEP não encontrado.');
    }
    return {
      street: data.logradouro ?? '',
      neighborhood: data.bairro ?? '',
      city: data.localidade ?? '',
      state: data.uf ?? '',
    };
  }

  private async fetchAddress(postalCode: string): Promise<ViaCepResponse> {
    try {
      const response = await fetch(`${VIACEP_URL}/${postalCode}/json/`, {
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`ViaCEP respondeu ${response.status}`);
      }
      return (await response.json()) as ViaCepResponse;
    } catch {
      throw new ServiceUnavailableException(
        'Não foi possível consultar o CEP agora. Preencha o endereço manualmente.',
      );
    }
  }
}
