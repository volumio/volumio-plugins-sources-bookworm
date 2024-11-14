import type express from 'express';
export declare function index(req: express.Request, res: express.Response): Promise<void>;
export declare function preview(req: express.Request, res: express.Response): Promise<void>;
export declare function myBackground(params: Record<string, any>, res: express.Response): void;
export declare function api(apiName: string, method: string, params: Record<string, any>, res: express.Response): Promise<void>;
export declare function font(filename: string, res: express.Response): express.Response<any, Record<string, any>> | undefined;
//# sourceMappingURL=Handler.d.ts.map