import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";


// --- TYPES / INTERFACES ---

export interface Response<T> {
  success: boolean;
  data: T;
}


// --- INTERCEPTOR CLASS ---

@Injectable()
export class SuccessResponseInterceptor<T>
  implements NestInterceptor<T, Response<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    return next.handle().pipe(
      map((data) => {
        // Si la respuesta ya tiene el formato estandarizado, la retornamos tal cual.
        if (data && typeof data === "object" && "success" in data && "data" in data) {
          return data;
        }
        return {
          success: true,
          data: data ?? null,
        };
      })
    );
  }
}
