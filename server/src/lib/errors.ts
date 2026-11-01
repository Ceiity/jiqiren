export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST') => new AppError(400, code, message);
export const unauthorized = (message = '请先登录') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = '没有权限执行此操作', code = 'FORBIDDEN') => new AppError(403, code, message);
export const notFound = (message = '资源不存在', code = 'NOT_FOUND') => new AppError(404, code, message);
export const conflict = (message: string, code = 'CONFLICT', extra?: Record<string, unknown>) =>
  new AppError(409, code, message, extra);
export const tooLarge = (message: string, code = 'TOO_LARGE') => new AppError(413, code, message);
export const gone = (message: string, code = 'GONE') => new AppError(410, code, message);
