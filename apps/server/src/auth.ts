import type { FastifyRequest } from "fastify";

export interface AuthProvider {
  authenticate(request: FastifyRequest): Promise<void>;
}

export class NoopAuthProvider implements AuthProvider {
  async authenticate(_request: FastifyRequest): Promise<void> {
    return;
  }
}
