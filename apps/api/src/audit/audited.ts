import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { type Observable, concatMap, from, map } from 'rxjs';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from './audit.service';

export const AUDIT_ACTION = 'kora:auditAction';

export interface AuditedOptions {
  action: string;
  entityType?: string;
  /** Route param holding the entity's id, e.g. "id". */
  idParam?: string;
}

/**
 * Mark a route so a successful call is written to the audit log:
 *
 *   @Audited({ action: 'loan.approve', entityType: 'Loan', idParam: 'id' })
 *
 * Use AuditService.record directly when the audit row must share a database
 * transaction with the change (anything that moves money).
 */
export const Audited = (options: AuditedOptions) => SetMetadata(AUDIT_ACTION, options);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<AuditedOptions | undefined>(
      AUDIT_ACTION,
      context.getHandler(),
    );
    if (!options) return next.handle();

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    return next.handle().pipe(
      concatMap((result) =>
        from(
          this.audit.record({
            action: options.action,
            actorId: req.user?.id,
            entityType: options.entityType,
            entityId: options.idParam ? String(req.params[options.idParam] ?? '') : undefined,
            metadata: { method: req.method, path: req.route?.path ?? req.path },
            ip: req.ip,
            userAgent: req.get('user-agent'),
          }),
        ).pipe(map(() => result)),
      ),
    );
  }
}
