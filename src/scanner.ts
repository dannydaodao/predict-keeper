import { Transaction } from '@mysten/sui/transactions';
import { getClient } from './utils';
import { CONFIG } from './config';

    const client = getClient(CONFIG.NETWORK);
    const tx = new Transaction();
// 定义我们需要找到的“猎物”结构
export interface RedeemablePosition {
    managerId: string;
    oracleId: string;
    marketKey: {
        oracle_id: string;
        expiry: bigint;
        strike: bigint;
        is_up: boolean;
    };
    quantity: bigint;
}

export async function findRedeemablePositions(): Promise<RedeemablePosition[]> {
    console.log("=== 通过官方 Indexer API 扫描机会 ===");
    const redeemable: RedeemablePosition[] = [];

    // 假设官方 API 地址是 http://api.testnet.predict...
    const API_BASE = 'http://localhost:8080/api'; // 根据实际配置

    try {
        // 1. 直接向 API 请求所有已经 Settled 的 Oracle 列表
        const settledResponse = await fetch(`${API_BASE}/oracles/settled`);
        const settledOracles = await settledResponse.json() as any[];
        
        if (settledOracles.length === 0) return [];
        const settledIds = settledOracles.map(o => o.oracle_id);

        // 2. 拿到所有用户的 Manager 列表 
        // （你可以通过事件获取所有 managerId，或者直接调 API 查活跃 manager）
        const managersResponse = await fetch(`${API_BASE}/managers`);
        const managers = await managersResponse.json() as any[];

        for (const manager of managers) {
            // 3. 直接调 API 查这个 Manager 的实时持仓聚合
            // 这个 API 是 Rust 服务在数据库里帮你算好（Mint - Redeemed）之后的净余额！
            const posResponse = await fetch(`${API_BASE}/managers/${manager.manager_id}/positions`);
            const positions = await posResponse.json() as any[];

            for (const pos of positions) {
                // 如果这个仓位属于已结算的 Oracle 且数量大于 0
                if (settledIds.includes(pos.oracle_id) && BigInt(pos.quantity) > 0n) {
                    redeemable.push({
                        managerId: manager.manager_id,
                        oracleId: pos.oracle_id,
                        marketKey: {
                            oracle_id: pos.oracle_id,
                            expiry: BigInt(pos.expiry),
                            strike: BigInt(pos.strike),
                            is_up: pos.is_up
                        },
                        quantity: BigInt(pos.quantity)
                    });
                }
            }
        }
    } catch (e) {
        console.error("通过 API 扫描失败，回退到链上事件扫描...", e);
        // 如果 API 没部署好或者连不上，可以优雅回退到我们之前写的 `fetchAllNewEvents` 自力更生版本。
    }

    return redeemable;
}

// export async function findRedeemablePositions(): Promise<RedeemablePosition[]> {
//     console.log("正在扫描链上已结算的 Oracle 和未提取的头寸...");
//     const positions: RedeemablePosition[] = [];
//     positions.push({
//     managerId: "0x926cbf800a051d8d93ac4d1ff9a049116ffd7c3705fe33baf5b45ac981f8b082",
//     oracleId: "0x169c5df118f4655fcb6404bd8e1d328f0bf0789855c7511236a48d936b4f01e3",
//     marketKey: {
//         oracle_id: "0x169c5df118f4655fcb6404bd8e1d328f0bf0789855c7511236a48d936b4f01e3",
//         expiry: 1780398900000n,
//         strike: 69200n * 1_000_000_000n,
//         is_up: true,
//     },
//     quantity: 10n * 1_000_000n,
//     });
    
//     // TODO: 1. 查找 is_settled 的 Oracle
//     // TODO: 2. 查找持有该 Oracle 对应 MarketKey 的 PredictManager
//     // TODO: 3. 过滤出 quantity > 0 的记录
    
//     return positions;
// }