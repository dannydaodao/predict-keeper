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
    console.log("=== 开始扫描代领机会 ===");
    
    // 1. 找出所有已结算的 Oracle (通过查询最近的 OracleSettled 事件)
    // 官方在 oracle.move 里定义了 event::emit(OracleSettled { ... })
    const settledEvents = await client.queryEvents({
        query: { MoveEventType: `${CONFIG.PREDICT_PACKAGE_ID}::oracle::OracleSettled` },
        limit: 20
    });
    
    const settledOracleIds = new Set(settledEvents.data.map(e => (e.parsedJson as any).oracle_id));
    if (settledOracleIds.size === 0) {
        console.log("当前测试网上没有发现已结算的 Oracle。");
        return [];
    }
    console.log(`发现已结算的 Oracle 数量: ${settledOracleIds.size}`);

    // 2. 直接查询全网的 PositionMinted 事件，在内存中聚合成用户的活跃头寸
    // 这就相当于一个轻量级、临时的方案 A
    const mintEvents = await client.queryEvents({
        query: { MoveEventType: `${CONFIG.PREDICT_PACKAGE_ID}::predict::PositionMinted` },
        limit: 100 // 调大这个值以获取更多历史
    });

    const redeemEvents = await client.queryEvents({
        query: { MoveEventType: `${CONFIG.PREDICT_PACKAGE_ID}::predict::PositionRedeemed` },
        limit: 100
    });

    // 内存账本： "managerId_oracleId_strike_direction" -> quantity
    const ledger = new Map<string, bigint>();
    // 临时记录对应的原始数据
    const keyDataMap = new Map<string, any>();

    // 累计 Mint 的头寸
    for (const event of mintEvents.data) {
        const json = event.parsedJson as any;
        const key = `${json.manager_id}_${json.oracle_id}_${json.strike}_${json.is_up ? 'up' : 'down'}`;
        const current = ledger.get(key) || 0n;
        ledger.set(key, current + BigInt(json.quantity));
        keyDataMap.set(key, {
            managerId: json.manager_id,
            oracleId: json.oracle_id,
            expiry: BigInt(json.expiry),
            strike: BigInt(json.strike),
            isUp: json.is_up
        });
    }

    // 扣除已 Redeem 的头寸
    for (const event of redeemEvents.data) {
        const json = event.parsedJson as any;
        const key = `${json.manager_id}_${json.oracle_id}_${json.strike}_${json.is_up ? 'up' : 'down'}`;
        const current = ledger.get(key) || 0n;
        if (current > 0n) {
            ledger.set(key, current - BigInt(json.quantity));
        }
    }

    // 3. 筛选出：属于“已结算 Oracle 列表” 且 “数量 > 0” 的所有内存账本记录
    const redeemable: RedeemablePosition[] = [];

    for (const [key, qty] of ledger.entries()) {
        if (qty > 0n) {
            const info = keyDataMap.get(key);
            if (settledOracleIds.has(info.oracleId)) {
                redeemable.push({
                    managerId: info.managerId,
                    oracleId: info.oracleId,
                    marketKey: {
                        oracle_id: info.oracleId,
                        expiry: info.expiry,
                        strike: info.strike,
                        is_up: info.isUp
                    },
                    quantity: qty
                });
            }
        }
    }

    console.log(`扫描完成！发现可代领头寸: ${redeemable.length} 个`);
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