import { Transaction } from '@mysten/sui/transactions';
import { getClient } from './utils';
import { CONFIG } from './config';
import { log } from 'console';

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

/**
 * 二元期权赢家判断逻辑
 * @param settlementPrice 结算价
 * @param strike 行权价
 * @param isUp 是否看涨
 */
function isWinningPosition(settlementPrice: bigint, strike: bigint, isUp: boolean): boolean {
    if (isUp) {
        return settlementPrice >= strike;
    } else {
        return settlementPrice < strike;
    }
}

export async function findRedeemablePositions(): Promise<RedeemablePosition[]> {
    console.log("=== 正在通过 Predict Server 运行赢家增量扫描 ===");
    const redeemablePositions: RedeemablePosition[] = [];

    try {
        // 1. 获取该 Predict 盘口下所有的 Oracles
        const oraclesUrl = `${CONFIG.SERVER_URL}/predicts/${CONFIG.PREDICT_OBJECT_ID}/oracles`;
        const oracles = await fetch(oraclesUrl).then(res => res.json());

        // 整理出所有已结算的 Oracle 及其结算价格 Map
        // 键: oracle_id, 值: settlement_price (bigint)
        const settledOraclesMap = new Map<string, bigint>();
        
        for (const oracle of oracles) {
            if (oracle.status.toLowerCase() === 'settled' && oracle.settlement_price !== null) {
                settledOraclesMap.set(oracle.oracle_id, BigInt(oracle.settlement_price));
            }
        }

        if (settledOraclesMap.size === 0) {
            console.log("当前暂无已结算且发布了价格的 Oracle，跳过本次轮询。");
            return [];
        }
        console.log(`发现已结算的 Oracle 数量: ${settledOraclesMap.size}`);

        // 2. 获取全网所有的 PredictManager 列表
        const managersUrl = `${CONFIG.SERVER_URL}/managers`;
        const managers = await fetch(managersUrl).then(res => res.json());

        // 3. 遍历用户，精准抓取赢家
        for (const manager of managers) {
            const managerId = manager.manager_id;
            const positionsUrl = `${CONFIG.SERVER_URL}/managers/${managerId}/positions`;
            const positions = await fetch(positionsUrl).then(res => res.json());
            log(`账户 ${managerId} 持仓数量: ${positions.length}`);

            for (const pos of positions) {
                const oracleId = pos.oracle_id;
                const settlementPrice = settledOraclesMap.get(oracleId);

                // 如果该持仓对应的 Oracle 已经结算，且 quantity > 0
                if (settlementPrice !== undefined && BigInt(pos.quantity) > 0n) {
                    
                    // 【增量过滤核心】检查他中奖了没有
                    const strikePrice = BigInt(pos.strike);
                    const isUp = pos.is_up;
                    
                    if (isWinningPosition(settlementPrice, strikePrice, isUp)) {
                        // 发现真正有钱可领的赢家！
                        redeemablePositions.push({
                            managerId: managerId,
                            oracleId: oracleId,
                            marketKey: {
                                oracle_id: oracleId,
                                expiry: BigInt(pos.expiry),
                                strike: strikePrice,
                                is_up: isUp
                            },
                            quantity: BigInt(pos.quantity)
                        });
                        console.log(`🎯 [锁定中奖头寸] 账户 ${managerId} 赌对了！将代领 Oracle ${oracleId} 上的 ${pos.quantity} 份奖金。`);
                    } else {
                        // 如果输了，我们永远不去 redeem 它，这就是一张废纸。
                        // 这样避免了浪费 Gas 去 redeem 那些明知必输的彩票。
                        console.log(`💨 [忽略作废头寸] 账户 ${managerId} 没猜中 Oracle ${oracleId} (Strike: ${strikePrice}, UP: ${isUp}), 忽略。`);
                    }
                }
            }
        }

    } catch (error) {
        console.error("通过 Predict Server 扫描失败:", error);
    }

    console.log(`=== 扫描结束，共锁定可代领中奖头寸: ${redeemablePositions.length} 个 ===`);
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