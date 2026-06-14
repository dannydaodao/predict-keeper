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
    console.log("=== 正在通过 Predict Server 运行增量扫描 ===");
    const redeemablePositions: RedeemablePosition[] = [];

    try {
        // 1. 获取该 Predict 盘口下所有的 Oracles
        const oraclesUrl = `${CONFIG.SERVER_URL}/predicts/${CONFIG.PREDICT_OBJECT_ID}/oracles`;
        const oracles = await fetch(oraclesUrl).then(res => res.json());

        // 【增量过滤 1】只寻找：已经结算（settled）且全网还有人没领完（remaining_quantity > 0）的 Oracle！
        const activeSettledOracles = oracles.filter((oracle: any) => 
            oracle.status.toLowerCase() === 'settled' && oracle.remaining_quantity > 0
        );

        if (activeSettledOracles.length === 0) {
            console.log("当前暂无包含未领取余额的已结算 Oracle，跳过本次轮询。");
            return [];
        }

        const activeSettledOracleIds = new Set(activeSettledOracles.map((o: any) => o.oracle_id));
        console.log(`发现待收割的活跃已结算 Oracle 数量: ${activeSettledOracleIds.size}`);

        // 2. 获取全网所有的 PredictManager 列表
        const managersUrl = `${CONFIG.SERVER_URL}/managers`;
        const managers = await fetch(managersUrl).then(res => res.json());

        // 3. 对每个 manager，查询他当前的持仓
        for (const manager of managers) {
            const managerId = manager.manager_id;
            const positionsUrl = `${CONFIG.SERVER_URL}/managers/${managerId}/positions`;
            const positions = await fetch(positionsUrl).then(res => res.json());

            for (const pos of positions) {
                // 【增量过滤 2】如果该持仓：属于我们需要收割的 Oracle，且用户手里有还未提取的 quantity > 0
                if (activeSettledOracleIds.has(pos.oracle_id) && BigInt(pos.quantity) > 0n) {
                    
                    // 找到了猎物！
                    redeemablePositions.push({
                        managerId: managerId,
                        oracleId: pos.oracle_id,
                        marketKey: {
                            oracle_id: pos.oracle_id,
                            expiry: BigInt(pos.expiry),
                            strike: BigInt(pos.strike),
                            is_up: pos.is_up
                        },
                        quantity: BigInt(pos.quantity)
                    });
                    
                    console.log(`[发现猎物] 账户 ${managerId} 在 Oracle ${pos.oracle_id} 上有未代领头寸, 数量: ${pos.quantity}`);
                }
            }
        }

    } catch (error) {
        console.error("通过 Predict Server 扫描失败:", error);
    }

    console.log(`=== 扫描结束，共发现可代领头寸: ${redeemablePositions.length} 个 ===`);
    return redeemablePositions;
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